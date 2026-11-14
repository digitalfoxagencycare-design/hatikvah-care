import { Router } from "express";
import { requirePerm } from "../lib/permissions.js";
import { channels } from "../lib/notify.js";
import { applyQrPayment, qrView, refreshUpiQr } from "../lib/payments.js";
import { closeUpiQr, fetchQrPayments } from "../lib/razorpay.js";
import { balance, createInvoice, deductForInvoice, logActivity, now, recordPayment, postLedger } from "../lib/sales.js";
import { posInput, upiCloseInput } from "../schemas.js";
import { wrap as plainWrap } from "./public.js";
import { atomicWrap } from "./atomic.js";
import { bad, csvHeaders, notFound, parse, rupees } from "./shared.js";
import { toCsv } from "../csv.js";

const digits10 = (phone) => String(phone || "").replace(/\D/g, "").slice(-10);
const WALK_IN = "Walk-in (counter sale)";

/** Counter billing (walk-in buyers: GST invoice + payment in one step) and the cash / bank book. */
export function posRoutes({ cfg, store, audit, automation, fetchImpl, log = console }) {
  const r = Router();
  const wrap = fn => atomicWrap(store, fn);
  const by = (req) => req.admin.email;

  /** The buyer: a chosen customer, a customer with the walk-in's phone, a new one for that phone, or the shared walk-in record. */
  async function buyer(d) {
    if (d.customerId) return store.customers.get(d.customerId);
    const w = d.walkIn, ph = digits10(w.phone);
    const all = await store.customers.all();
    let c = ph.length === 10 ? all.find((x) => x.phone && digits10(x.phone) === ph) : all.find((x) => x.name === WALK_IN);
    if (!c) {
      c = await store.customers.insert({
        name: ph.length === 10 ? w.name : (w.name || WALK_IN),
        contactName: ph.length === 10 ? w.name : "",
        phone: w.phone || "",
        email: "",
        gstin: ph.length === 10 ? w.gstin : "",
        stateCode: ph.length === 10 ? w.stateCode : "",
        city: "",
        billingAddress: w.address || "",
        shippingAddress: w.address || "",
        deliveryPincode: w.pincode || "",
        priceListId: "",
        paymentTermsDays: 0,
        reorderDays: 0,
        tags: ["walk-in"],
        notes: "",
        assignedTo: "",
        followUpAt: "",
        source: "pos",
        createdAt: now(),
        updatedAt: now(),
      });
    } else if (ph.length === 10 && (w.address || w.pincode)) {
      await store.customers.update(c.id, {
        ...(w.address ? { shippingAddress: w.address } : {}),
        ...(w.pincode ? { deliveryPincode: w.pincode } : {}),
        updatedAt: now(),
      });
      c = await store.customers.get(c.id);
    }
    return {
      ...c,
      name: w.name || c.name,
      phone: w.phone || c.phone,
      shippingAddress: w.address || c.shippingAddress,
      deliveryPincode: w.pincode || c.deliveryPincode,
      gstin: w.gstin || c.gstin,
      stateCode: w.stateCode || c.stateCode,
    };
  }

  r.post("/pos/invoice", requirePerm("pos"), wrap(async (req, res) => {
    const d = parse(posInput, req.body, res); if (!d) return;
    const c = await buyer(d); if (!c) return notFound(res, "Customer");
    if (d.credit && (d.payment || !d.customerId || !(c.paymentTermsDays > 0))) return bad(res, "Pay later is only for saved customers with credit terms", 409);
    const inv = await createInvoice(store, { customer: { ...c, paymentTermsDays: d.credit ? c.paymentTermsDays : 0 }, items: d.items, placeOfSupply: d.placeOfSupply, notes: d.notes, by: by(req) });
    await store.invoices.update(inv.id, { source: "pos" });
    await deductForInvoice(store, inv, by(req));
    let out = { ...inv, source: "pos" }, payment = null;
    if (d.payment) {
      const amount = Math.min(d.payment.amount ?? balance(inv), balance(inv));
      if (amount > 0) {
        const p = await recordPayment(store, inv, { amount, mode: d.payment.mode, reference: d.payment.reference, notes: "Counter sale", by: by(req) });
        out = p.invoice; payment = p.payment;
      }
    }
    await logActivity(store, { entity: "customer", entityId: inv.customerId, text: `Counter invoice ${inv.number} raised${payment ? ` and paid (${payment.mode})` : ""}`, by: by(req) });
    await automation.on.invoiceCreated(out);
    if (payment) await automation.on.paymentReceived(out, payment);
    await audit(req, "pos.invoice", inv.number, { total: inv.totals.total, paid: payment?.amount || 0 });
    res.status(201).json({ invoice: out, payment });
  }));

  // ---------- dynamic UPI QR for a counter invoice. The invoice comes first (POST /pos/invoice without a payment); paying the QR settles it.
  const posInvoice = async (req, res) => {
    const i = await store.invoices.get(req.params.id);
    if (!i || i.source !== "pos") { notFound(res, "Counter invoice"); return null; }
    return i;
  };
  /** Asks Razorpay what was paid: the qr_code.credited webhook normally gets there first, and this covers a late or missing call. */
  async function syncQr(i) {
    if (!i.upiQr?.id || i.upiQr.status !== "active") return i;
    const paid = await fetchQrPayments(cfg, i.upiQr.id, fetchImpl ? { fetchImpl } : {});
    for (const pay of paid) await store.atomic(() => applyQrPayment({ store, automation }, { qrId: i.upiQr.id, invoiceId: i.id, pay }));
    return store.invoices.get(i.id);
  }
  r.post("/pos/invoices/:id/upi-qr", requirePerm("pos"), plainWrap(async (req, res) => {
    if (channels(cfg).payments === "off") return bad(res, "Online payments are not set up yet (Razorpay keys are needed)", 409);
    const i = await posInvoice(req, res); if (!i) return;
    if (balance(i) <= 0) return bad(res, "Nothing left to pay on this invoice", 409);
    try { res.json(qrView(await refreshUpiQr({ cfg, store, fetchImpl }, i))); } catch (e) { bad(res, e.message, 502); }
  }));
  r.get("/pos/invoices/:id/upi-qr", requirePerm("pos"), plainWrap(async (req, res) => {
    let i = await posInvoice(req, res); if (!i) return;
    if (req.query.sync && channels(cfg).payments !== "off") { try { i = await syncQr(i); } catch (e) { log.warn?.("QR status check failed:", e.message); } }
    res.set("Cache-Control", "no-store").json(qrView(i));
  }));
  r.post("/pos/invoices/:id/upi-qr/close", requirePerm("pos"), plainWrap(async (req, res) => {
    const d = parse(upiCloseInput, req.body || {}, res); if (!d) return;
    let i = await posInvoice(req, res); if (!i) return;
    if (i.upiQr?.status === "active") {
      try { await closeUpiQr(cfg, i.upiQr.id, fetchImpl ? { fetchImpl } : {}); } catch (e) { log.warn?.("QR close failed:", e.message); }
      i = await syncQr(i).catch(() => store.invoices.get(i.id)); // the customer may have paid a moment before the close: never take the money twice
      if (i.upiQr?.status === "active") i = await store.invoices.update(i.id, { upiQr: { ...i.upiQr, status: "closed" }, updatedAt: now() });
    }
    if (d.payment && balance(i) > 0) {
      const p = await recordPayment(store, i, { amount: balance(i), mode: d.payment.mode, reference: d.payment.reference, notes: "Counter sale", by: by(req) });
      i = p.invoice; await automation.on.paymentReceived(p.invoice, p.payment);
      await audit(req, "pos.payment", i.number, { amount: p.payment.amount, mode: p.payment.mode });
    }
    res.json(qrView(i));
  }));

  // ---------- cash / bank book (receipts posted by every payment)
  r.get("/ledger", requirePerm("ledger"), wrap(async (req, res) => {
    const { account = "", from = "", to = "" } = req.query;
    const rows = (await store.ledger.all({ sort: { date: -1 } })).filter((e) => !e.legacySupersededBy && (!account || e.account === account || e.lines?.some(l=>l.account===account)) && (!from || e.date >= from) && (!to || e.date <= to));
    const totals = {};
    for (const e of rows) {
      if (e.lines) {
        for (const l of e.lines) totals[l.account] = (totals[l.account] || 0) + l.debit - l.credit;
        if (e.account === "credit_notes") totals.credit_notes = (totals.credit_notes || 0) - e.amount;
      } else {
        totals[e.account] = (totals[e.account] || 0) + (e.kind === 'payment' || e.kind === 'credit_note' ? -e.amount : e.amount);
      }
    }
    if (req.query.format === "csv") {
      csvHeaders(res, "cash-bank-book.csv");
      return res.send(toCsv(["date", "account", "kind", "amount", "ref", "party", "narration"], rows.map((e) => ({ date: e.date, account: e.account, kind: e.kind, amount: rupees(e.amount), ref: e.ref, party: e.party, narration: e.narration }))));
    }
    res.json({ rows: rows.slice(0, 1000), totals });
  }));
  r.post("/ledger", requirePerm("ledger"), wrap(async (req, res) => {
    // manual entries: bank charges, cash deposited, expenses paid from the till
    const b = req.body || {};
    if (!["cash", "bank", "razorpay"].includes(b.account)) return bad(res, "Account must be cash, bank or razorpay");
    if (!["receipt", "payment"].includes(b.kind)) return bad(res, "Kind must be receipt or payment");
    if (!Number.isInteger(b.amount) || b.amount <= 0 || b.amount > 10_000_000_000) return bad(res, "Amount must be paise above zero");
    if (b.date && !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) return bad(res, "Use a date like 2026-10-31");
    if (!/^[a-z][a-z0-9_]{1,60}$/.test(b.contraAccount || "") || b.contraAccount === b.account) return bad(res, "Choose a different counter-account");
    const e = await postLedger(store, { contraAccount: b.contraAccount, date: b.date || now().slice(0, 10), account: b.account, kind: b.kind, amount: b.amount, ref: String(b.ref || "").slice(0, 60), paymentId: "", invoiceId: "",
      party: String(b.party || "").slice(0, 160), narration: String(b.narration || "").slice(0, 300), by: by(req), createdAt: now() });
    await audit(req, "ledger.create", e.ref || e.account, { amount: e.amount, kind: e.kind }); res.status(201).json(e);
  }));

  // Swipe Expenses+ & Indirect Income entries
  r.post("/ledger/entries", requirePerm("ledger"), wrap(async (req, res) => {
    const b = req.body || {};
    const amount = Number(b.amount);
    if (!Number.isInteger(amount) || amount <= 0 || amount > 10_000_000_000) {
      return bad(res, "Amount must be positive integer paise");
    }
    const mode = ["cash", "bank", "razorpay"].includes(b.mode) ? b.mode : "bank";
    const date = b.date && /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : now().slice(0, 10);
    const payee = String(b.payee || "").slice(0, 160);
    const category = String(b.category || "General").slice(0, 100);
    const notes = String(b.notes || "").slice(0, 300);
    const narration = notes ? `${category}: ${notes}` : category;

    const hasGst = Boolean(b.hasGst);
    const gstRate = Number(b.gstRate) || 0;
    let taxAmount = 0;
    let netAmount = amount;
    if (hasGst && gstRate > 0) {
      taxAmount = Math.round(amount - (amount / (1 + gstRate / 100)));
      netAmount = amount - taxAmount;
    }

    if (b.kind === "income") {
      const e = await postLedger(store, {
        contraAccount: "indirect_income",
        date,
        account: mode,
        kind: "receipt",
        amount,
        taxAmount,
        netAmount,
        hasGst,
        gstRate,
        ref: String(b.category || "INCOME").toUpperCase().slice(0, 60),
        party: payee,
        narration,
        category,
        by: by(req),
        createdAt: now(),
      });
      await audit(req, "income.create", e.ref, { amount, mode, category });
      return res.status(201).json(e);
    } else {
      const e = await postLedger(store, {
        contraAccount: "operating_expense",
        date,
        account: mode,
        kind: "payment",
        amount,
        taxAmount,
        netAmount,
        hasGst,
        gstRate,
        ref: String(b.category || "EXPENSE").toUpperCase().slice(0, 60),
        party: payee,
        narration,
        category,
        by: by(req),
        createdAt: now(),
      });
      await audit(req, "expense.create", e.ref, { amount, mode, category });
      return res.status(201).json(e);
    }
  }));

  r.patch("/ledger/entries/:id", requirePerm("ledger"), wrap(async (req, res) => {
    const existing = await store.ledger.get(req.params.id);
    if (!existing) return notFound(res, "Ledger entry not found");
    const b = req.body || {};
    const updates = {};
    if (b.payee !== undefined) updates.party = String(b.payee).slice(0, 160);
    if (b.category !== undefined) updates.category = String(b.category).slice(0, 100);
    if (b.notes !== undefined) updates.narration = String(b.notes).slice(0, 300);
    if (b.date !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(b.date)) updates.date = b.date;
    const updated = await store.ledger.patch(req.params.id, updates);
    await audit(req, "ledger.patch", existing.ref || req.params.id, updates);
    res.json(updated);
  }));
  return r;
}
