import { Router } from "express";
import { atomicWrap } from "./atomic.js";
import { invoiceLines } from "../lib/accounting.js";
import { addDays, todayIST } from "../lib/gst.js";
import { channels } from "../lib/notify.js";
import { requirePerm } from "../lib/permissions.js";
import { refreshPayLink } from "../lib/payments.js";
import { createPaymentLink } from "../lib/razorpay.js";
import { balance, bucketOf, stockBuckets, createCreditNote, createInvoice, saveDraftInvoice, issueDraftInvoice, createOrderFromQuote, dispatchOrder, customerSnapshot, deductForInvoice, logActivity, moveStock, now, priced, rateFor, recordPayment, refreshInvoice, refundDue, resolveCustomer, removePaymentLedger, postLedger, assertStockAvailable, consumeStock, token } from "../lib/sales.js";
import { measureLabel, pieces, uomOptions } from "../lib/units.js";
import { nextNumber } from "../lib/gst.js";
import { getSettings } from "../model.js";
import { shadowfaxOn } from "../services/delivery_shadowfax.js";
import { bookShipment } from "./logistics.js";
import { buildEwbGovtJson, generateSandboxEwb } from "../services/ewaybill.js";
import { buildEinvoiceGovtJson, generateSandboxEinvoice, cancelSandboxEinvoice } from "../services/einvoice.js";
import { creditNoteInput, dispatchInput, invoiceInput, invoiceDraftInput, orderInput, paymentInput, quoteInput } from "../schemas.js";
import { wrap } from "./public.js";
import { bad, notFound, parse } from "./shared.js";

/** Quotations → sales orders → GST invoices → payments. Numbers are per financial year (Q/2026-27/0001, SO/…, INV/…, DC/…). */
export function salesRoutes({ cfg, store, audit, automation, fetchImpl }) {
  const r = Router();
  const by = (req) => req.admin.email;
  const customerOr404 = async (id, res) => { const c = await store.customers.get(id); if (!c) notFound(res, "Customer"); return c; };
  /** Who to invoice. `links` are [collection, document] pairs: each is re-pointed if the customer had to be found or restored, because the invoice copies its customer id from them. */
  const billTo = async (req, res, links) => {
    const c = await resolveCustomer(store, links[0][1]);
    if (!c) { bad(res, "This document has no customer details. Open it and choose a customer.", 409); return null; }
    if (links[0][1].customerId === c.id) return c;
    for (const [rows, row] of links) await rows.update(row.id, { customerId: c.id, updatedAt: now() });
    await logActivity(store, { entity: "customer", entityId: c.id, text: `Linked to ${links[0][1].number} because its customer record was missing`, by: by(req) });
    await audit(req, "customer.relink", c.name, { document: links[0][1].number });
    return c;
  };
  const withActivity = async (row) => ({ ...row, activities: (await store.activities.all({ sort: { at: -1 } })).filter((a) => a.entityId === row.id) });
  const overdue = (i) => ["unpaid", "partial"].includes(i.status) && i.dueDate < todayIST();

  // Default rates for the line editor: customer price list, else catalogue price; plus tax details of each product.
  r.get("/rates", requirePerm("quotes", "orders", "invoices"), wrap(async (req, res) => {
    const c = req.query.customerId ? await store.customers.get(String(req.query.customerId)) : null;
    const out = [], buckets = await stockBuckets(store);
    for (const p of await store.products.all({ sort: { order: 1 } })) {
      const rVal = await rateFor(store, c, p);
      const rate = rVal ?? p.price ?? 0;
      out.push({ productId: p.id, sku: p.sku, name: p.name, image: p.images?.[0] || "", category: p.category || "", collection: p.collection || "", reorderLevel: p.reorderLevel || 0, pack: p.pack || measureLabel(p.measure), hsn: p.hsn || "", gstRate: p.gstRate ?? 18, unit: p.unit || "pcs", rate, price: p.price, pricePaise: p.price, priceTiers: p.priceTiers || [], active: p.active, stockTracked: !!p.stockTracked, ...bucketOf(buckets, p.id),
        // piece / box / carton with pieces per unit and the default rate (customer's piece rate scaled; own box / carton prices win when no price list applies)
        uoms: uomOptions(rVal != null && rVal !== p.price ? { ...p, packPrices: {} } : p, rate) });
    }
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
    const base = {
      customerId: c.id, customer: customerSnapshot(c), enquiryId: d.enquiryId, ...doc,
      notes: d.notes, terms: d.terms || s.quoteTerms, validUntil: d.validUntil || addDays(todayIST(), s.quoteValidityDays),
      paymentTerms: d.paymentTerms || "prepaid", creditDays: d.creditDays ?? 30,
      shippingType: d.shippingType || "free", shippingCharge: d.shippingCharge ?? 0,
      updatedAt: now()
    };
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
    if (!["draft", "sent", "accepted", "converted"].includes(q.status)) return bad(res, `A ${q.status} quote cannot become an invoice`, 409);
    const order = q.orderId ? await store.orders.get(q.orderId) : null;
    if (order?.invoiceId) return bad(res, "This quote's order already has an invoice", 409);
    if (q.invoiceId) return bad(res, "This quote already has an invoice", 409);
    const c = await billTo(req, res, [[store.quotes, q], ...(order ? [[store.orders, order]] : [])]); if (!c) return;
    const inv = await createInvoice(store, {
      customer: c,
      items: q.items.map(({ amount, tax, total, ...l }) => l),
      placeOfSupply: q.placeOfSupply,
      notes: q.notes,
      poNumber: "",
      quoteId: q.id,
      orderId: q.orderId || "",
      orderNumber: q.orderNumber || "",
      by: by(req),
    });
    await store.quotes.update(q.id, { invoiceId: inv.id, invoiceNumber: inv.number, status: "accepted", updatedAt: now() });
    if (q.enquiryId) await store.enquiries.update(q.enquiryId, { status: "won" });
    await logActivity(store, { entity: "quote", entityId: q.id, text: `Converted directly to Tax Invoice ${inv.number}`, by: by(req) });
    res.status(201).json(await afterInvoice(req, inv));
  }));
  // Razorpay link for the quote total: paying it accepts the quote and raises the order and GST invoice (webhook).
  r.post("/quotes/:id/paylink", requirePerm("quotes"), wrap(async (req, res) => {
    const q = await store.quotes.get(req.params.id); if (!q) return notFound(res, "Quote");
    if (channels(cfg).payments === "off") return bad(res, "Online payments are not set up yet (Razorpay keys are needed)", 409);
    if (!["draft", "sent", "accepted"].includes(q.status) || q.invoiceId) return bad(res, `A ${q.status} quote cannot be paid online`, 409);
    try {
      const link = await createPaymentLink(cfg, q, { ...(fetchImpl ? { fetchImpl } : {}), notes: { quoteId: q.id }, reference: `${q.number}-${Date.now().toString(36)}` });
      const upd = await store.quotes.update(q.id, { payLink: link, updatedAt: now() });
      await logActivity(store, { entity: "quote", entityId: q.id, text: `Payment link created (${link.url})`, by: by(req) });
      await audit(req, "quote.paylink", q.number); res.json(upd);
    } catch (e) { bad(res, e.message, 502); }
  }));
  r.post("/quotes/:id/duplicate", requirePerm("quotes"), wrap(async (req, res) => {
    const q = await store.quotes.get(req.params.id); if (!q) return notFound(res, "Quote");
    req.body = { customerId: q.customerId, items: q.items.map(({ amount, tax, total, ...l }) => l), notes: q.notes, terms: q.terms, placeOfSupply: q.placeOfSupply };
    return saveQuote(req, res);
  }));
  r.post("/quotes/:id/convert-doc", requirePerm("quotes"), wrap(async (req, res) => {
    const q = await store.quotes.get(req.params.id);
    if (!q) return notFound(res, "Quote");
    const { targetType = "proforma" } = req.body || {};
    const prefixMap = {
      proforma: "PF",
      challan: "DC",
      packing_list: "PK",
    };
    const pfx = prefixMap[targetType] || "PF";
    const newNumber = await nextNumber(store, pfx);
    const conversionEntry = {
      fromQuoteId: q.id,
      fromQuoteNumber: q.number,
      targetType,
      newNumber,
      convertedAt: now(),
      by: by(req),
    };
    const cloned = await store.quotes.insert({
      ...q,
      id: undefined,
      number: newNumber,
      docType: targetType,
      token: token(),
      status: "draft",
      parentQuoteId: q.id,
      parentQuoteNumber: q.number,
      createdAt: now(),
      updatedAt: now(),
      createdBy: by(req),
    });
    const existingHist = Array.isArray(q.conversionHistory) ? q.conversionHistory : [];
    await store.quotes.update(q.id, {
      conversionHistory: [...existingHist, conversionEntry],
      updatedAt: now(),
    });
    await audit(req, "quote.convert", q.number, { targetType, newNumber });
    res.status(201).json(cloned);
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
  r.post("/orders", requirePerm("orders"), atomicWrap(store, async (req, res) => {
    const d = parse(orderInput, req.body, res); if (!d) return;
    const c = await customerOr404(d.customerId, res); if (!c) return;
    const doc = await priced(store, { items: d.items, customer: c, placeOfSupply: d.placeOfSupply });
    await assertStockAvailable(store, doc.items);
    const o = await store.orders.insert({ number: await nextNumber(store, "SO"), token: token(), quoteId: "", quoteNumber: "", customerId: c.id, customer: customerSnapshot(c), ...doc,
      poNumber: d.poNumber, status: "confirmed", expectedDate: d.expectedDate, notes: d.notes,
      paymentTerms: d.paymentTerms || "prepaid", creditDays: d.creditDays ?? 30,
      shippingType: d.shippingType || "free", shippingCharge: d.shippingCharge ?? 0,
      dispatch: null, challanNumber: "", invoiceId: "", createdBy: by(req), createdAt: now(), updatedAt: now() });
    await logActivity(store, { entity: "customer", entityId: c.id, text: `Order ${o.number} created`, by: by(req) });
    await audit(req, "order.create", o.number); res.status(201).json(o);
  }));
  r.put("/orders/:id", requirePerm("orders"), atomicWrap(store, async (req, res) => {
    const o = await store.orders.get(req.params.id); if (!o) return notFound(res, "Order");
    if (!["confirmed", "packed"].includes(o.status) || o.invoiceId) return bad(res, "Only orders not yet dispatched or invoiced can be edited", 409);
    const d = parse(orderInput, req.body, res); if (!d) return;
    const c = await customerOr404(d.customerId, res); if (!c) return;
    const doc = await priced(store, { items: d.items, customer: c, placeOfSupply: d.placeOfSupply });
    await assertStockAvailable(store, doc.items, o.id);
    const upd = await store.orders.update(o.id, {
      customerId: c.id, customer: customerSnapshot(c), ...doc, poNumber: d.poNumber, expectedDate: d.expectedDate, notes: d.notes,
      paymentTerms: d.paymentTerms || o.paymentTerms || "prepaid", creditDays: d.creditDays ?? o.creditDays ?? 30,
      shippingType: d.shippingType || o.shippingType || "free", shippingCharge: d.shippingCharge ?? o.shippingCharge ?? 0,
      updatedAt: now()
    });
    await audit(req, "order.update", o.number); res.json(upd);
  }));
  r.post("/orders/:id/status", requirePerm("orders"), atomicWrap(store, async (req, res) => {
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
    const d = parse(dispatchInput, req.body || {}, res); if (!d) return;
    const { courier, dropPincode, weightKg, packages, ...dispatch } = d;
    let upd = await dispatchOrder(store, req.params.id, dispatch, by(req));
    const o=upd, challanNumber=upd.challanNumber;
    if (courier === "shadowfax") { // the challan stands even if the courier booking fails: staff can retry from the order
      if (!shadowfaxOn(cfg)) await logActivity(store, { entity: "order", entityId: o.id, text: "Shadowfax pickup not booked: Shadowfax is not connected", by: by(req) });
      else try { upd = await bookShipment({ cfg, store, fetchImpl }, upd, { dropPincode, weightKg, packages }, by(req)); }
      catch (e) { await logActivity(store, { entity: "order", entityId: o.id, text: `Shadowfax pickup not booked: ${e.message}`, by: by(req) }); }
    }
    await automation.on.orderDispatched(upd); await audit(req, "order.dispatch", o.number, { challanNumber }); res.json(upd);
  }));
  /** Counter and direct invoices have no sales order: this makes one for the delivery, so they reach the same dispatch queue. The stock left with the invoice. */
  r.post("/invoices/:id/delivery-order", requirePerm("orders"), atomicWrap(store, async (req, res) => {
    const inv = await store.invoices.get(req.params.id); if (!inv) return notFound(res, "Invoice");
    if (inv.status === "void") return bad(res, "This invoice is void", 409);
    if (inv.orderId) { const held = await store.orders.get(inv.orderId); if (held) return res.json(held); }
    const { items, totals, interState, placeOfSupply, placeOfSupplyName } = inv;
    const o = await store.orders.insert({ number: await nextNumber(store, "SO"), token: token(), quoteId: "", quoteNumber: "", customerId: inv.customerId || "", customer: inv.customer, items, totals, interState, placeOfSupply, placeOfSupplyName,
      source: "counter", poNumber: inv.poNumber || "", status: "confirmed", expectedDate: "", notes: `Delivery for invoice ${inv.number}`, dispatch: null, challanNumber: "", invoiceId: inv.id, invoiceNumber: inv.number, createdBy: by(req), createdAt: now(), updatedAt: now() });
    await store.invoices.update(inv.id, { orderId: o.id, orderNumber: o.number, updatedAt: now() });
    await logActivity(store, { entity: "invoice", entityId: inv.id, text: `Delivery order ${o.number} created`, by: by(req) });
    await audit(req, "order.create", o.number); res.status(201).json(o);
  }));
  r.post("/orders/:id/paylink", requirePerm("orders"), wrap(async (req, res) => {
    const o = await store.orders.get(req.params.id); if (!o) return notFound(res, "Order");
    if (channels(cfg).payments === "off") return bad(res, "Online payments are not set up yet (Razorpay keys are needed)", 409);
    if (o.status === "cancelled" || o.paymentStatus === "paid") return bad(res, "Nothing left to pay on this order", 409);
    if (o.invoiceId) return bad(res, "This order is invoiced: make the link on the invoice", 409);
    try { res.json(await refreshPayLink({ cfg, store, fetchImpl }, store.orders, o, o.totals.total, { orderId: o.id })); } catch (e) { bad(res, e.message, 502); }
  }));
  r.post("/orders/:id/paylink/send", requirePerm("orders"), wrap(async (req, res) => {
    const o = await store.orders.get(req.params.id); if (!o) return notFound(res, "Order");
    if (!o.payLink?.url || o.invoiceId || o.status === "cancelled" || o.paymentStatus === "paid") return bad(res, "Generate a payment link first", 409);
    const m = await automation.on.paymentLinkSend(o, "order", o.payLink.amount, o.payLink.url);
    await logActivity(store, { entity: "order", entityId: o.id, text: "Payment link sent on WhatsApp", by: by(req) });
    res.json(linkSent(m));
  }));
  r.post("/orders/:id/invoice", requirePerm("invoices"), wrap(async (req, res) => {
    const o = await store.orders.get(req.params.id); if (!o) return notFound(res, "Order");
    if (o.invoiceId) return bad(res, "This order is already invoiced", 409);
    if (o.status === "cancelled") return bad(res, "A cancelled order cannot be invoiced", 409);
    const c = await billTo(req, res, [[store.orders, o]]); if (!c) return;
    const inv = await createInvoice(store, { customer: c, items: o.items.map(({ amount, tax, total, ...l }) => l), placeOfSupply: o.placeOfSupply, notes: o.notes, poNumber: o.poNumber, orderId: o.id, orderNumber: o.number, by: by(req) });
    res.status(201).json(await afterInvoice(req, inv));
  }));

  /** What the Send via WhatsApp button shows; manualLink opens WhatsApp with the text filled in when the message could not go out by itself. */
  const linkSent = (m) => ({ status: m?.status || "no_number", sent: m?.status === "sent", manualLink: m && m.status !== "sent" ? m.manualLink : "", note: m?.error || "" });

  // ---------- invoices and payments
  async function afterInvoice(req, inv) {
    let out = inv;
    await deductForInvoice(store, inv, by(req)); // the order's reservation ends here: the goods leave stock
    if (channels(cfg).payments !== "off") { try { out = await store.invoices.update(inv.id, { payLink: await createPaymentLink(cfg, inv, { fetchImpl }) }); } catch (e) { await logActivity(store, { entity: "invoice", entityId: inv.id, text: `Payment link not created: ${e.message}` }); } }
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
    res.json({ ...(await withActivity(i)), overdue: overdue(i), balance: balance(i), refundDue: refundDue(i), payments: (await store.payments.all({ sort: { date: 1 } })).filter((p) => p.invoiceId === i.id),
      creditNotesList: (await store.creditNotes.all({ sort: { createdAt: 1 } })).filter((c) => c.invoiceId === i.id).map(({ id, number, date, reason, restock, totals, token, items }) => ({ id, number, date, reason, restock, total: totals.total, token, items: items.map(({ line, qty, amount }) => ({ line, qty, amount })) })) });
  }));
  r.post("/invoices", requirePerm("invoices"), wrap(async (req, res) => {
    const d = parse(invoiceInput, req.body, res); if (!d) return;
    const c = await customerOr404(d.customerId, res); if (!c) return;
    const inv = await createInvoice(store, { customer: c, ...d, by: by(req) });
    res.status(201).json(await afterInvoice(req, inv));
  }));
  r.post("/invoices/draft", requirePerm("invoices"), wrap(async (req, res) => {
    const d = parse(invoiceDraftInput, req.body, res); if (!d) return;
    const c = await customerOr404(d.customerId, res); if (!c) return;
    const inv = await saveDraftInvoice(store, { customer: c, ...d, by: by(req) });
    await audit(req, "invoice.draft", inv.number, { total: inv.totals.total });
    res.status(201).json({ ...inv, balance: balance(inv) });
  }));
  r.put("/invoices/draft/:id", requirePerm("invoices"), wrap(async (req, res) => {
    const d = parse(invoiceDraftInput, req.body, res); if (!d) return;
    const c = await customerOr404(d.customerId, res); if (!c) return;
    const inv = await saveDraftInvoice(store, { draftId: req.params.id, customer: c, ...d, by: by(req) });
    await audit(req, "invoice.draft.update", inv.number, { total: inv.totals.total });
    res.json({ ...inv, balance: balance(inv) });
  }));
  r.post("/invoices/:id/issue", requirePerm("invoices"), wrap(async (req, res) => {
    const inv = await issueDraftInvoice(store, req.params.id, { by: by(req), date: req.body?.date, dueDate: req.body?.dueDate });
    const issued = await afterInvoice(req, inv);
    res.json({ ...issued, balance: balance(issued) });
  }));
  r.delete("/invoices/:id", requirePerm("invoices"), wrap(async (req, res) => {
    const inv = await store.invoices.get(req.params.id); if (!inv) return notFound(res, "Invoice");
    if (inv.status !== "draft") return bad(res, "Only draft invoices can be discarded. Void an issued invoice instead.", 409);
    await store.invoices.remove(inv.id);
    await logActivity(store, { entity: "invoice", entityId: inv.id, text: `Draft ${inv.number} discarded`, by: by(req) });
    await audit(req, "invoice.draft.delete", inv.number);
    res.status(204).end();
  }));
  r.post("/invoices/:id/void", requirePerm("invoices"), atomicWrap(store, async (req, res) => {
    const i = await store.invoices.get(req.params.id); if (!i) return notFound(res, "Invoice");
    if (i.status === "void") return bad(res, "Already void", 409);
    if (i.amountPaid > 0) return bad(res, "Remove the payments on this invoice first, or issue a credit note instead", 409);
    if (i.creditedAmount > 0) return bad(res, "This invoice has credit notes, so it cannot be voided", 409);
    const reason = String(req.body?.reason || "").slice(0, 300);
    const journalLines = invoiceLines(i.totals, true);
    if (journalLines.length) await postLedger(store, { sourceKey: "invoice-void:" + i.id, lines: journalLines, kind: "invoice_void", account: "accounts_receivable", amount: i.totals.total, invoiceId: i.id, ref: i.number, by: by(req) });
    const upd = await store.invoices.update(i.id, { status: "void", voidReason: reason, voidedAt: now(), updatedAt: now() });
    if (i.orderId) await store.orders.update(i.orderId, { invoiceId: "", invoiceNumber: "" });
    // Restore stock if it was deducted by this invoice
    let dispatched = false;
    if (i.orderId) {
      const ord = await store.orders.get(i.orderId);
      if (ord && ["dispatched", "delivered"].includes(ord.status)) dispatched = true;
    }
    if (!dispatched) {
      for (const it of i.items || []) {
        if (it.productId) {
          const p = await store.products.get(it.productId);
          if (p) await moveStock(store, { productId: p.id, sku: p.sku, qty: Math.abs(pieces(it)), kind: "in", ref: i.number, note: `Voided invoice ${i.number}`, by: by(req) });
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
    try { res.json(await refreshPayLink({ cfg, store, fetchImpl }, store.invoices, i, balance(i), { invoiceId: i.id })); } catch (e) { bad(res, e.message, 502); }
  }));
  r.post("/invoices/:id/paylink/send", requirePerm("invoices"), wrap(async (req, res) => {
    const i = await store.invoices.get(req.params.id); if (!i) return notFound(res, "Invoice");
    if (!i.payLink?.url || balance(i) <= 0) return bad(res, "Generate a payment link first", 409);
    const m = await automation.on.paymentLinkSend(i, "invoice", i.payLink.amount, i.payLink.url);
    await logActivity(store, { entity: "invoice", entityId: i.id, text: "Payment link sent on WhatsApp", by: by(req) });
    res.json(linkSent(m));
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

  // ---------- E-Way Bill Integration
  r.post("/invoices/:id/ewaybill/generate", requirePerm("invoices"), wrap(async (req, res) => {
    const inv = await store.invoices.get(req.params.id);
    if (!inv) return notFound(res, "Invoice");
    if (inv.status === "void") return bad(res, "Cannot generate E-Way Bill for a void invoice", 409);

    const settings = await getSettings(store);
    const transport = req.body || {};
    const result = await generateSandboxEwb({ invoice: inv, settings, transport, cfg, fetchImpl });

    if (result.ewbNo) {
      const ewaybill = {
        ewbNo: result.ewbNo,
        ewbDate: result.ewbDate,
        validUpto: result.validUpto,
        vehicleNo: transport.vehicleNo,
        distance: transport.transDistance,
      };
      await store.invoices.update(inv.id, { ewaybill, updatedAt: now() });
      await logActivity(store, { entity: "invoice", entityId: inv.id, text: `E-Way Bill ${result.ewbNo} generated`, by: by(req) });
      await audit(req, "invoice.ewaybill.generate", inv.number, { ewbNo: result.ewbNo });
      return res.json({ ok: true, ewbNo: result.ewbNo, ewaybill, alert: result.alert });
    }

    if (result.error) {
      return bad(res, `E-Way Bill: ${result.error}`, 400);
    }

    // Return the Govt JSON payload for 100% free direct bulk upload
    res.json(result);
  }));

  r.get("/invoices/:id/ewaybill/json", requirePerm("invoices"), wrap(async (req, res) => {
    const inv = await store.invoices.get(req.params.id);
    if (!inv) return notFound(res, "Invoice");

    const settings = await getSettings(store);
    const transport = {
      vehicleNo: req.query.vehicleNo || inv.ewaybill?.vehicleNo || "",
      transDistance: req.query.distance || inv.ewaybill?.distance || "20",
      transporterName: req.query.transporter || "",
      toPincode: req.query.pincode || "",
    };
    const govtJson = buildEwbGovtJson({ invoice: inv, settings, transport });
    res.setHeader("Content-Disposition", `attachment; filename="EWB_${inv.number.replace(/\//g, "-")}.json"`);
    res.json(govtJson);
  }));

  r.post("/invoices/:id/ewaybill/save", requirePerm("invoices"), wrap(async (req, res) => {
    const inv = await store.invoices.get(req.params.id);
    if (!inv) return notFound(res, "Invoice");

    const { ewbNo = "", ewbDate = "", validUpto = "", vehicleNo = "" } = req.body || {};
    const ewaybill = {
      ewbNo: String(ewbNo).trim(),
      ewbDate: ewbDate || new Date().toISOString(),
      validUpto: validUpto || "",
      vehicleNo: String(vehicleNo).trim().toUpperCase(),
    };
    await store.invoices.update(inv.id, { ewaybill, updatedAt: now() });
    await logActivity(store, { entity: "invoice", entityId: inv.id, text: `E-Way Bill ${ewaybill.ewbNo} recorded`, by: by(req) });
    await audit(req, "invoice.ewaybill.save", inv.number, { ewbNo: ewaybill.ewbNo });
    res.json({ ok: true, ewaybill });
  }));

  // ---------- Government IRP E-Invoice Integration (IRN & Signed QR)
  r.post("/invoices/:id/einvoice/generate", requirePerm("invoices"), wrap(async (req, res) => {
    const inv = await store.invoices.get(req.params.id);
    if (!inv) return notFound(res, "Invoice");
    if (inv.status === "draft") return bad(res, "Cannot generate Government E-Invoice for an unissued draft invoice. Issue the invoice first.", 400);
    if (inv.status === "void") return bad(res, "Cannot generate E-Invoice for a void invoice", 409);
    if (inv.einvoice?.status === "active") return bad(res, "This invoice already has an active Government E-Invoice registered.", 409);

    // Concurrency / In-Progress lock
    if (inv.einvoice?.status === "in_progress") {
      const claimAge = Date.now() - new Date(inv.einvoice.claimedAt || 0).getTime();
      if (claimAge < 120_000) {
        return bad(res, "An E-Invoice registration request is currently in progress for this invoice. Please wait.", 409);
      }
    }

    // Set lock
    await store.invoices.update(inv.id, {
      einvoice: { status: "in_progress", claimedAt: now() },
      updatedAt: now(),
    });

    const settings = await getSettings(store);
    const result = await generateSandboxEinvoice({ invoice: inv, settings, cfg, fetchImpl });

    if (result.ok && result.source === "sandbox_irp_api" && result.irn) {
      const einvoice = {
        irn: result.irn,
        ackNo: result.ackNo || "",
        ackDate: result.ackDate || new Date().toISOString(),
        signedInvoice: result.signedInvoice || "",
        signedQrCode: result.signedQrCode || "",
        status: "active",
        generatedAt: now(),
      };
      await store.invoices.update(inv.id, { einvoice, updatedAt: now() });
      await logActivity(store, { entity: "invoice", entityId: inv.id, text: `Government E-Invoice IRN registered: ${result.irn.slice(0, 16)}...`, by: by(req) });
      await audit(req, "invoice.einvoice.generate", inv.number, { irn: result.irn });
      return res.json({ ok: true, irn: result.irn, einvoice, source: result.source });
    }

    if (result.ok && result.source === "govt_json_ready") {
      const einvoice = {
        status: "prepared",
        preparedAt: now(),
      };
      await store.invoices.update(inv.id, { einvoice, updatedAt: now() });
      return res.json({
        ok: true,
        source: "govt_json_ready",
        status: "prepared",
        message: result.message || "Official Government JSON prepared for portal upload",
        govtJson: result.govtJson,
      });
    }

    // Revert lock on failure
    await store.invoices.update(inv.id, {
      einvoice: { status: "failed", lastError: result.error || "Generation failed", failedAt: now() },
      updatedAt: now(),
    });

    return bad(res, `E-Invoice: ${result.error || "Generation rejected by IRP"}`, 400);
  }));

  r.post("/invoices/:id/einvoice/cancel", requirePerm("invoices"), wrap(async (req, res) => {
    const inv = await store.invoices.get(req.params.id);
    if (!inv) return notFound(res, "Invoice");
    if (!inv.einvoice?.irn || inv.einvoice.status !== "active") {
      return bad(res, "Invoice does not have an active Government IRN to cancel", 409);
    }

    // Enforce 24-hour statutory cancellation window
    if (inv.einvoice.ackDate) {
      const ackTime = new Date(inv.einvoice.ackDate).getTime();
      const diffHours = (Date.now() - ackTime) / (3600 * 1000);
      if (diffHours > 24) {
        return bad(res, "Government IRP rules strictly prohibit cancelling an e-invoice after 24 hours of generation. You must issue a Credit Note instead.", 400);
      }
    }

    const { reason = "1", remarks = "Cancelled by admin" } = req.body || {};
    if (!["1", "2", "3", "4"].includes(String(reason))) {
      return bad(res, "Invalid cancellation reason code. Must be 1 (Duplicate), 2 (Data entry error), 3 (Order cancelled), or 4 (Other)", 400);
    }

    const cancelRes = await cancelSandboxEinvoice({
      irn: inv.einvoice.irn,
      reason,
      remarks,
      cfg,
      fetchImpl,
    });

    if (!cancelRes.ok) {
      return bad(res, cancelRes.error || "Government IRP rejected cancellation", 400);
    }

    const einvoice = {
      ...inv.einvoice,
      status: "cancelled",
      cancelledAt: now(),
      cancelReason: reason,
      cancelRemarks: remarks,
    };
    await store.invoices.update(inv.id, { einvoice, updatedAt: now() });
    await logActivity(store, { entity: "invoice", entityId: inv.id, text: `E-Invoice cancelled (${remarks})`, by: by(req) });
    await audit(req, "invoice.einvoice.cancel", inv.number, { irn: inv.einvoice.irn });
    res.json({ ok: true, einvoice, cancelRes });
  }));

  r.get("/invoices/:id/einvoice/json", requirePerm("invoices"), wrap(async (req, res) => {
    const inv = await store.invoices.get(req.params.id);
    if (!inv) return notFound(res, "Invoice");

    const settings = await getSettings(store);
    const govtJson = buildEinvoiceGovtJson({ invoice: inv, settings, cfg });
    res.setHeader("Content-Disposition", `attachment; filename="EINV_${inv.number.replace(/\//g, "-")}.json"`);
    res.json(govtJson);
  }));

  r.post("/invoices/:id/einvoice/save", requirePerm("invoices"), wrap(async (req, res) => {
    const inv = await store.invoices.get(req.params.id);
    if (!inv) return notFound(res, "Invoice");

    const { irn = "", ackNo = "", ackDate = "", signedQrCode = "" } = req.body || {};
    if (!irn.trim()) return bad(res, "Valid IRN is required");

    const einvoice = {
      irn: String(irn).trim(),
      ackNo: String(ackNo).trim(),
      ackDate: ackDate || new Date().toISOString(),
      signedQrCode: String(signedQrCode).trim(),
      status: "active",
      savedAt: now(),
    };
    await store.invoices.update(inv.id, { einvoice, updatedAt: now() });
    await logActivity(store, { entity: "invoice", entityId: inv.id, text: `E-Invoice IRN ${einvoice.irn.slice(0, 16)}... recorded`, by: by(req) });
    await audit(req, "invoice.einvoice.save", inv.number, { irn: einvoice.irn });
    res.json({ ok: true, einvoice });
  }));

  // ---------- credit notes (GST sales returns / price adjustments against an invoice)
  r.get("/credit-notes", requirePerm("invoices"), wrap(async (req, res) => {
    let rows = await store.creditNotes.all({ sort: { createdAt: -1 } });
    if (req.query.invoiceId) rows = rows.filter((c) => c.invoiceId === req.query.invoiceId);
    if (req.query.customerId) rows = rows.filter((c) => c.customerId === req.query.customerId);
    res.json(rows.map(({ id, number, date, invoiceId, invoiceNumber, customerId, customer, reason, restock, totals, token }) => ({ id, number, date, invoiceId, invoiceNumber, customerId, customerName: customer.name, reason, restock, totals, token })));
  }));
  r.get("/credit-notes/:id", requirePerm("invoices"), wrap(async (req, res) => {
    const c = await store.creditNotes.get(req.params.id); if (!c) return notFound(res, "Credit note");
    res.json(c);
  }));
  r.post("/credit-notes", requirePerm("invoices"), wrap(async (req, res) => {
    const d = parse(creditNoteInput, req.body, res); if (!d) return;
    const inv = await store.invoices.get(d.invoiceId); if (!inv) return notFound(res, "Invoice");
    const out = await createCreditNote(store, inv, d, by(req)); // throws a 400/409 for anything the invoice does not allow
    await audit(req, "creditnote.create", out.creditNote.number, { invoice: inv.number, total: out.creditNote.totals.total, reason: d.reason });
    res.status(201).json({ ...out.creditNote, invoice: { id: inv.id, number: inv.number, balance: balance(out.invoice), refundDue: refundDue(out.invoice), status: out.invoice.status } });
  }));

  r.get("/payments", requirePerm("invoices"), wrap(async (_req, res) => res.json((await store.payments.all({ sort: { createdAt: -1 } })).filter(p => !p.reversedAt))));
  r.delete("/payments/:id", requirePerm("invoices"), atomicWrap(store, async (req, res) => {
    const p = await store.payments.get(req.params.id); if (!p) return notFound(res, "Payment");
    await removePaymentLedger(store, p.id, by(req)); await refreshInvoice(store, p.invoiceId);
    await logActivity(store, { entity: "invoice", entityId: p.invoiceId, text: `Payment of ₹${(p.amount / 100).toFixed(2)} removed`, by: by(req) });
    await audit(req, "payment.delete", p.invoiceNumber, { amount: p.amount }); res.status(204).end();
  }));
  return r;
}
