import { Router } from "express";
import { addDays, todayIST } from "../lib/gst.js";
import { channels } from "../lib/notify.js";
import { requirePerm } from "../lib/permissions.js";
import { createPaymentLink } from "../lib/razorpay.js";
import { balance, createInvoice, createOrderFromQuote, customerSnapshot, logActivity, moveStock, now, priced, rateFor, recordPayment, refreshInvoice, token } from "../lib/sales.js";
import { nextNumber } from "../lib/gst.js";
import { getSettings } from "../model.js";
import { dispatchInput, invoiceInput, orderInput, paymentInput, quoteInput } from "../schemas.js";
import { wrap } from "./public.js";
import { bad, notFound, parse } from "./shared.js";

/** Quotations → sales orders → GST invoices → payments. Numbers are per financial year (Q/2026-27/0001, SO/…, INV/…, DC/…). */
export function salesRoutes({ cfg, store, audit, automation }) {
  const r = Router();
  const by = (req) => req.admin.email;
  const customerOr404 = async (id, res) => { const c = await store.customers.get(id); if (!c) notFound(res, "Customer"); return c; };
  const withActivity = async (row) => ({ ...row, activities: (await store.activities.all({ sort: { at: -1 } })).filter((a) => a.entityId === row.id) });
  const overdue = (i) => ["unpaid", "partial"].includes(i.status) && i.dueDate < todayIST();

  // Default rates for the line editor: customer price list, else catalogue price; plus tax details of each product.
  r.get("/rates", requirePerm("quotes", "orders", "invoices"), wrap(async (req, res) => {
    const c = req.query.customerId ? await store.customers.get(String(req.query.customerId)) : null;
    const out = [];
    for (const p of await store.products.all({ sort: { order: 1 } })) out.push({ productId: p.id, sku: p.sku, name: p.name, pack: p.pack, hsn: p.hsn || "", gstRate: p.gstRate ?? 18, unit: p.unit || "pcs", rate: await rateFor(store, c, p), active: p.active });
    res.json(out);
  }));

  // ---------- quotations
  r.get("/quotes", requirePerm("quotes"), wrap(async (req, res) => {
    let rows = await store.quotes.all({ sort: { createdAt: -1 } });
    if (req.query.status) rows = rows.filter((q) => q.status === req.query.status);
    res.json(rows);
  }));
  r.get("/quotes/:id", requirePerm("quotes"), wrap(async (req, res) => { const q = await store.quotes.get(req.params.id); if (!q) return notFound(res, "Quote"); res.json(await withActivity(q)); }));

  async function saveQuote(req, res, cur) {
    const d = parse(quoteInput, req.body, res); if (!d) return;
    const c = await customerOr404(d.customerId, res); if (!c) return;
    const s = await getSettings(store);
    const doc = await priced(store, { items: d.items, customer: c, placeOfSupply: d.placeOfSupply });
    const base = { customerId: c.id, customer: customerSnapshot(c), enquiryId: d.enquiryId, ...doc, notes: d.notes, terms: d.terms || s.quoteTerms, validUntil: d.validUntil || addDays(todayIST(), s.quoteValidityDays), updatedAt: now() };
    if (cur) {
      if (!["draft", "sent"].includes(cur.status)) return bad(res, `A ${cur.status} quote cannot be changed. Duplicate it instead.`, 409);
      const q = await store.quotes.update(cur.id, { ...base, version: cur.status === "sent" ? (cur.version || 1) + 1 : cur.version || 1 });
      await audit(req, "quote.update", q.number, { total: q.totals.total, version: q.version }); return res.json(q);
    }
    const q = await store.quotes.insert({ ...base, number: await nextNumber(store, "Q"), version: 1, token: token(), status: "draft", remindersSent: [], orderId: "", sentAt: null, createdBy: by(req), createdAt: now() });
    if (d.enquiryId) { await store.enquiries.update(d.enquiryId, { quoteId: q.id, customerId: c.id }); }
    await logActivity(store, { entity: "customer", entityId: c.id, text: `Quote ${q.number} created`, by: by(req) });
    await audit(req, "quote.create", q.number, { total: q.totals.total }); res.status(201).json(q);
  }
  r.post("/quotes", requirePerm("quotes"), wrap((req, res) => saveQuote(req, res)));
  r.put("/quotes/:id", requirePerm("quotes"), wrap(async (req, res) => { const q = await store.quotes.get(req.params.id); if (!q) return notFound(res, "Quote"); return saveQuote(req, res, q); }));

  r.post("/quotes/from-enquiry/:id", requirePerm("quotes"), wrap(async (req, res) => {
    const e = await store.enquiries.get(req.params.id); if (!e) return notFound(res, "Enquiry");
    if (!e.customerId) return bad(res, "Link this enquiry to a customer first (Create customer)", 409);
    const c = await customerOr404(e.customerId, res); if (!c) return;
    const items = [];
    for (const it of e.items) {
      const p = await store.products.get(it.productId); if (!p) continue;
      items.push({ productId: p.id, sku: p.sku, name: p.name, hsn: p.hsn || "", unit: p.unit || "pcs", qty: it.qty, rate: await rateFor(store, c, p), discountPct: 0, gstRate: p.gstRate ?? 18 });
    }
    if (!items.length) return bad(res, "This enquiry has no catalogue items. Create the quote by hand.", 409);
    req.body = { customerId: c.id, enquiryId: e.id, items };
    return saveQuote(req, res);
  }));

  r.post("/quotes/:id/send", requirePerm("quotes"), wrap(async (req, res) => {
    const q = await store.quotes.get(req.params.id); if (!q) return notFound(res, "Quote");
    if (!["draft", "sent"].includes(q.status)) return bad(res, `A ${q.status} quote cannot be sent`, 409);
    const upd = await store.quotes.update(q.id, { status: "sent", sentAt: now(), remindersSent: [], updatedAt: now() });
    if (q.enquiryId) { const e = await store.enquiries.get(q.enquiryId); if (e && ["new", "contacted"].includes(e.status)) await store.enquiries.update(e.id, { status: "quoted" }); }
    await logActivity(store, { entity: "quote", entityId: q.id, text: "Sent to customer", by: by(req) });
    await automation.on.quoteSent(upd); await audit(req, "quote.send", q.number); res.json(upd);
  }));
  r.post("/quotes/:id/status", requirePerm("quotes"), wrap(async (req, res) => {
    const q = await store.quotes.get(req.params.id); if (!q) return notFound(res, "Quote");
    const status = req.body?.status;
    if (!["accepted", "rejected"].includes(status)) return bad(res, "Status must be accepted or rejected");
    if (!["draft", "sent", "expired"].includes(q.status)) return bad(res, `A ${q.status} quote cannot be changed`, 409);
    const upd = await store.quotes.update(q.id, { status, [status + "At"]: now(), updatedAt: now() });
    await logActivity(store, { entity: "quote", entityId: q.id, text: `Marked ${status}`, by: by(req) });
    if (q.enquiryId && status === "accepted") await store.enquiries.update(q.enquiryId, { status: "won" });
    await audit(req, "quote." + status, q.number); res.json(upd);
  }));
  r.post("/quotes/:id/order", requirePerm("orders"), wrap(async (req, res) => {
    const q = await store.quotes.get(req.params.id); if (!q) return notFound(res, "Quote");
    if (q.orderId) return bad(res, "This quote already has an order", 409);
    if (!["draft", "sent", "accepted"].includes(q.status)) return bad(res, `A ${q.status} quote cannot become an order`, 409);
    const o = await createOrderFromQuote(store, q, by(req));
    if (q.enquiryId) await store.enquiries.update(q.enquiryId, { status: "won" });
    await audit(req, "order.create", o.number, { from: q.number }); res.status(201).json(o);
  }));
  r.post("/quotes/:id/invoice", requirePerm("invoices"), wrap(async (req, res) => {
    const q = await store.quotes.get(req.params.id); if (!q) return notFound(res, "Quote");
    if (q.invoiceId) return bad(res, "This quote already has an invoice", 409);
    const c = await customerOr404(q.customerId, res); if (!c) return;
    const inv = await createInvoice(store, {
      customer: c,
      items: q.items.map(({ amount, tax, total, ...l }) => l),
      placeOfSupply: q.placeOfSupply,
      notes: q.notes,
      poNumber: "",
      orderId: q.orderId || "",
      orderNumber: q.orderNumber || "",
      by: by(req),
    });
    await store.quotes.update(q.id, { invoiceId: inv.id, invoiceNumber: inv.number, status: "accepted", updatedAt: now() });
    if (q.enquiryId) await store.enquiries.update(q.enquiryId, { status: "won" });
    await logActivity(store, { entity: "quote", entityId: q.id, text: `Converted directly to Tax Invoice ${inv.number}`, by: by(req) });
    res.status(201).json(await afterInvoice(req, inv));
  }));
  r.post("/quotes/:id/duplicate", requirePerm("quotes"), wrap(async (req, res) => {
    const q = await store.quotes.get(req.params.id); if (!q) return notFound(res, "Quote");
    req.body = { customerId: q.customerId, items: q.items.map(({ amount, tax, total, ...l }) => l), notes: q.notes, terms: q.terms, placeOfSupply: q.placeOfSupply };
    return saveQuote(req, res);
  }));
  r.delete("/quotes/:id", requirePerm("quotes"), wrap(async (req, res) => {
    const q = await store.quotes.get(req.params.id); if (!q) return notFound(res, "Quote");
    if (q.status !== "draft") return bad(res, "Only draft quotes can be deleted. Mark it rejected instead.", 409);
    await store.quotes.remove(q.id); await audit(req, "quote.delete", q.number); res.status(204).end();
  }));

  // ---------- sales orders
  r.get("/orders", requirePerm("orders"), wrap(async (req, res) => {
    let rows = await store.orders.all({ sort: { createdAt: -1 } });
    if (req.query.status) rows = rows.filter((o) => o.status === req.query.status);
    res.json(rows);
  }));
  r.get("/orders/:id", requirePerm("orders"), wrap(async (req, res) => { const o = await store.orders.get(req.params.id); if (!o) return notFound(res, "Order"); res.json(await withActivity(o)); }));
  r.post("/orders", requirePerm("orders"), wrap(async (req, res) => {
    const d = parse(orderInput, req.body, res); if (!d) return;
    const c = await customerOr404(d.customerId, res); if (!c) return;
    const doc = await priced(store, { items: d.items, customer: c, placeOfSupply: d.placeOfSupply });
    const o = await store.orders.insert({ number: await nextNumber(store, "SO"), token: token(), quoteId: "", quoteNumber: "", customerId: c.id, customer: customerSnapshot(c), ...doc,
      poNumber: d.poNumber, status: "confirmed", expectedDate: d.expectedDate, notes: d.notes, dispatch: null, challanNumber: "", invoiceId: "", createdBy: by(req), createdAt: now(), updatedAt: now() });
    await logActivity(store, { entity: "customer", entityId: c.id, text: `Order ${o.number} created`, by: by(req) });
    await audit(req, "order.create", o.number); res.status(201).json(o);
  }));
  r.put("/orders/:id", requirePerm("orders"), wrap(async (req, res) => {
    const o = await store.orders.get(req.params.id); if (!o) return notFound(res, "Order");
    if (!["confirmed", "packed"].includes(o.status) || o.invoiceId) return bad(res, "Only orders not yet dispatched or invoiced can be edited", 409);
    const d = parse(orderInput, req.body, res); if (!d) return;
    const c = await customerOr404(d.customerId, res); if (!c) return;
    const doc = await priced(store, { items: d.items, customer: c, placeOfSupply: d.placeOfSupply });
    const upd = await store.orders.update(o.id, { customerId: c.id, customer: customerSnapshot(c), ...doc, poNumber: d.poNumber, expectedDate: d.expectedDate, notes: d.notes, updatedAt: now() });
    await audit(req, "order.update", o.number); res.json(upd);
  }));
  r.post("/orders/:id/status", requirePerm("orders"), wrap(async (req, res) => {
    const o = await store.orders.get(req.params.id); if (!o) return notFound(res, "Order");
    const status = req.body?.status;
    const allowed = { confirmed: ["packed", "cancelled"], packed: ["confirmed", "cancelled"], dispatched: ["delivered"], delivered: [], cancelled: [] };
    if (!(allowed[o.status] || []).includes(status)) return bad(res, `An order that is ${o.status} cannot become ${status}`, 409);
    if (status === "cancelled" && o.invoiceId) return bad(res, "Void the invoice before cancelling this order", 409);
    const upd = await store.orders.update(o.id, { status, [status + "At"]: now(), updatedAt: now() });
    await logActivity(store, { entity: "order", entityId: o.id, text: `Marked ${status}`, by: by(req) });
    await audit(req, "order." + status, o.number); res.json(upd);
  }));
  r.post("/orders/:id/dispatch", requirePerm("orders"), wrap(async (req, res) => {
    const o = await store.orders.get(req.params.id); if (!o) return notFound(res, "Order");
    if (!["confirmed", "packed"].includes(o.status)) return bad(res, `An order that is ${o.status} cannot be dispatched`, 409);
    const d = parse(dispatchInput, req.body || {}, res); if (!d) return;
    const challanNumber = await nextNumber(store, "DC");
    // If not already deducted by an earlier invoice, deduct on dispatch
    if (!o.invoiceId) {
      for (const it of o.items) {
        const p = it.productId ? await store.products.get(it.productId) : null;
        if (p?.stockTracked) await moveStock(store, { productId: p.id, sku: p.sku, qty: -it.qty, kind: "out", ref: o.number, note: "Dispatched", by: by(req) });
      }
    }
    const upd = await store.orders.update(o.id, { status: "dispatched", dispatch: { ...d, date: d.date || todayIST() }, challanNumber, dispatchedAt: now(), updatedAt: now() });
    await logActivity(store, { entity: "order", entityId: o.id, text: `Dispatched (challan ${challanNumber})${d.transporter ? " via " + d.transporter : ""}`, by: by(req) });
    await automation.on.orderDispatched(upd); await audit(req, "order.dispatch", o.number, { challanNumber }); res.json(upd);
  }));
  r.post("/orders/:id/invoice", requirePerm("invoices"), wrap(async (req, res) => {
    const o = await store.orders.get(req.params.id); if (!o) return notFound(res, "Order");
    if (o.invoiceId) return bad(res, "This order is already invoiced", 409);
    if (o.status === "cancelled") return bad(res, "A cancelled order cannot be invoiced", 409);
    const c = await customerOr404(o.customerId, res); if (!c) return;
    const inv = await createInvoice(store, { customer: c, items: o.items.map(({ amount, tax, total, ...l }) => l), placeOfSupply: o.placeOfSupply, notes: o.notes, poNumber: o.poNumber, orderId: o.id, orderNumber: o.number, by: by(req) });
    res.status(201).json(await afterInvoice(req, inv));
  }));

  // ---------- invoices and payments
  async function afterInvoice(req, inv) {
    let out = inv;
    // Auto-minus stock on invoice creation if not already dispatched
    let alreadyDispatched = false;
    if (inv.orderId) {
      const ord = await store.orders.get(inv.orderId);
      if (ord && ord.status === "dispatched") alreadyDispatched = true;
    }
    if (!alreadyDispatched) {
      for (const it of inv.items || []) {
        if (it.productId) {
          const p = await store.products.get(it.productId);
          if (p) {
            if (!p.stockTracked) await store.products.update(p.id, { stockTracked: true });
            await moveStock(store, { productId: p.id, sku: p.sku, qty: -Math.abs(it.qty), kind: "out", ref: inv.number, note: `Sale invoice ${inv.number}`, by: by(req) });
          }
        }
      }
    }
    if (channels(cfg).payments !== "off") { try { out = await store.invoices.update(inv.id, { payLink: await createPaymentLink(cfg, inv) }); } catch (e) { await logActivity(store, { entity: "invoice", entityId: inv.id, text: `Payment link not created: ${e.message}` }); } }
    await logActivity(store, { entity: "customer", entityId: inv.customerId, text: `Invoice ${inv.number} raised`, by: by(req) });
    await automation.on.invoiceCreated(out); await audit(req, "invoice.create", inv.number, { total: inv.totals.total });
    return out;
  }
  r.get("/invoices", requirePerm("invoices"), wrap(async (req, res) => {
    let rows = (await store.invoices.all({ sort: { createdAt: -1 } })).map((i) => ({ ...i, overdue: overdue(i), balance: balance(i) }));
    if (req.query.status === "overdue") rows = rows.filter((i) => i.overdue); else if (req.query.status) rows = rows.filter((i) => i.status === req.query.status);
    res.json(rows);
  }));
  r.get("/invoices/:id", requirePerm("invoices"), wrap(async (req, res) => {
    const i = await store.invoices.get(req.params.id); if (!i) return notFound(res, "Invoice");
    res.json({ ...(await withActivity(i)), overdue: overdue(i), balance: balance(i), payments: (await store.payments.all({ sort: { date: 1 } })).filter((p) => p.invoiceId === i.id) });
  }));
  r.post("/invoices", requirePerm("invoices"), wrap(async (req, res) => {
    const d = parse(invoiceInput, req.body, res); if (!d) return;
    const c = await customerOr404(d.customerId, res); if (!c) return;
    const inv = await createInvoice(store, { customer: c, ...d, by: by(req) });
    res.status(201).json(await afterInvoice(req, inv));
  }));
  r.post("/invoices/:id/void", requirePerm("invoices"), wrap(async (req, res) => {
    const i = await store.invoices.get(req.params.id); if (!i) return notFound(res, "Invoice");
    if (i.status === "void") return bad(res, "Already void", 409);
    if (i.amountPaid > 0) return bad(res, "Remove the payments on this invoice first (or issue a credit note in your accounts)", 409);
    const reason = String(req.body?.reason || "").slice(0, 300);
    const upd = await store.invoices.update(i.id, { status: "void", voidReason: reason, voidedAt: now(), updatedAt: now() });
    if (i.orderId) await store.orders.update(i.orderId, { invoiceId: "", invoiceNumber: "" });
    // Restore stock if it was deducted by this invoice
    let dispatched = false;
    if (i.orderId) {
      const ord = await store.orders.get(i.orderId);
      if (ord && ord.status === "dispatched") dispatched = true;
    }
    if (!dispatched) {
      for (const it of i.items || []) {
        if (it.productId) {
          const p = await store.products.get(it.productId);
          if (p) await moveStock(store, { productId: p.id, sku: p.sku, qty: Math.abs(it.qty), kind: "in", ref: i.number, note: `Voided invoice ${i.number}`, by: by(req) });
        }
      }
    }
    await logActivity(store, { entity: "invoice", entityId: i.id, text: `Voided${reason ? ": " + reason : ""}`, by: by(req) });
    await audit(req, "invoice.void", i.number, { reason }); res.json(upd);
  }));
  r.post("/invoices/:id/send", requirePerm("invoices"), wrap(async (req, res) => {
    const i = await store.invoices.get(req.params.id); if (!i) return notFound(res, "Invoice");
    await automation.on.invoiceCreated(i); await logActivity(store, { entity: "invoice", entityId: i.id, text: "Sent to customer again", by: by(req) }); res.json(i);
  }));
  r.post("/invoices/:id/paylink", requirePerm("invoices"), wrap(async (req, res) => {
    const i = await store.invoices.get(req.params.id); if (!i) return notFound(res, "Invoice");
    if (channels(cfg).payments === "off") return bad(res, "Online payments are not set up yet (Razorpay keys are needed)", 409);
    if (balance(i) <= 0) return bad(res, "Nothing left to pay on this invoice", 409);
    try { res.json(await store.invoices.update(i.id, { payLink: await createPaymentLink(cfg, i) })); } catch (e) { bad(res, e.message, 502); }
  }));
  r.post("/invoices/:id/payments", requirePerm("invoices"), wrap(async (req, res) => {
    const i = await store.invoices.get(req.params.id); if (!i) return notFound(res, "Invoice");
    if (i.status === "void") return bad(res, "This invoice is void", 409);
    const d = parse(paymentInput, req.body, res); if (!d) return;
    if (d.amount > balance(i)) return bad(res, `That is more than the balance due (₹${(balance(i) / 100).toFixed(2)})`);
    const out = await recordPayment(store, i, { ...d, by: by(req) });
    await automation.on.paymentReceived(out.invoice, out.payment); await audit(req, "payment.create", i.number, { amount: d.amount, mode: d.mode });
    res.status(201).json(out);
  }));
  r.get("/payments", requirePerm("invoices"), wrap(async (_req, res) => res.json(await store.payments.all({ sort: { createdAt: -1 } }))));
  r.delete("/payments/:id", requirePerm("invoices"), wrap(async (req, res) => {
    const p = await store.payments.get(req.params.id); if (!p) return notFound(res, "Payment");
    await store.payments.remove(p.id); await refreshInvoice(store, p.invoiceId);
    await logActivity(store, { entity: "invoice", entityId: p.invoiceId, text: `Payment of ₹${(p.amount / 100).toFixed(2)} removed`, by: by(req) });
    await audit(req, "payment.delete", p.invoiceNumber, { amount: p.amount }); res.status(204).end();
  }));
  return r;
}
