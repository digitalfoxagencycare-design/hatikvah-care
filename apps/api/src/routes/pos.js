import { Router } from "express";
import { requirePerm } from "../lib/permissions.js";
import { balance, createInvoice, deductForInvoice, logActivity, now, recordPayment } from "../lib/sales.js";
import { posInput } from "../schemas.js";
import { wrap } from "./public.js";
import { bad, csvHeaders, notFound, parse, rupees } from "./shared.js";
import { toCsv } from "../csv.js";

const digits10 = (phone) => String(phone || "").replace(/\D/g, "").slice(-10);
const WALK_IN = "Walk-in (counter sale)";

/** Counter billing (walk-in buyers: GST invoice + payment in one step) and the cash / bank book. */
export function posRoutes({ store, audit, automation }) {
  const r = Router();
  const by = (req) => req.admin.email;

  /** The buyer: a chosen customer, a customer with the walk-in's phone, a new one for that phone, or the shared walk-in record. */
  async function buyer(d) {
    if (d.customerId) return store.customers.get(d.customerId);
    const w = d.walkIn, ph = digits10(w.phone);
    const all = await store.customers.all();
    let c = ph.length === 10 ? all.find((x) => x.phone && digits10(x.phone) === ph) : all.find((x) => x.name === WALK_IN);
    if (!c) {
      c = await store.customers.insert({ name: ph.length === 10 ? w.name : WALK_IN, contactName: ph.length === 10 ? w.name : "", phone: w.phone || "", email: "", gstin: ph.length === 10 ? w.gstin : "",
        stateCode: ph.length === 10 ? w.stateCode : "", city: "", billingAddress: "", shippingAddress: "", priceListId: "", paymentTermsDays: 0, reorderDays: 0, tags: ["walk-in"], notes: "",
        assignedTo: "", followUpAt: "", source: "pos", createdAt: now(), updatedAt: now() });
    }
    // the shared walk-in record carries no name or GSTIN: this bill shows what was typed at the counter
    return c.name === WALK_IN ? { ...c, name: w.name, gstin: w.gstin, stateCode: w.stateCode || c.stateCode } : c;
  }

  r.post("/pos/invoice", requirePerm("pos"), wrap(async (req, res) => {
    const d = parse(posInput, req.body, res); if (!d) return;
    const c = await buyer(d); if (!c) return notFound(res, "Customer");
    const inv = await createInvoice(store, { customer: { ...c, paymentTermsDays: 0 }, items: d.items, placeOfSupply: d.placeOfSupply, notes: d.notes, by: by(req) });
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

  // ---------- cash / bank book (receipts posted by every payment)
  r.get("/ledger", requirePerm("ledger"), wrap(async (req, res) => {
    const { account = "", from = "", to = "" } = req.query;
    const rows = (await store.ledger.all({ sort: { date: -1 } })).filter((e) => (!account || e.account === account) && (!from || e.date >= from) && (!to || e.date <= to));
    const totals = {};
    for (const e of rows) totals[e.account] = (totals[e.account] || 0) + (e.kind === "payment" || e.kind === "credit_note" ? -e.amount : e.amount); // credit notes reverse sales
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
    const e = await store.ledger.insert({ date: b.date || now().slice(0, 10), account: b.account, kind: b.kind, amount: b.amount, ref: String(b.ref || "").slice(0, 60), paymentId: "", invoiceId: "",
      party: String(b.party || "").slice(0, 160), narration: String(b.narration || "").slice(0, 300), by: by(req), createdAt: now() });
    await audit(req, "ledger.create", e.ref || e.account, { amount: e.amount, kind: e.kind }); res.status(201).json(e);
  }));
  return r;
}
