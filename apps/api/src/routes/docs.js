import crypto from "node:crypto";
import express, { Router } from "express";
import rateLimit from "express-rate-limit";
import { amountInWords, stateName } from "../lib/gst.js";
import { verifyWebhook } from "../lib/razorpay.js";
import { balance, createInvoice, createOrderFromQuote, deductForInvoice, invoiceWebsiteOrder, logActivity, now, recordPayment, respondToQuote } from "../lib/sales.js";
import { getSettings } from "../model.js";
import { wrap } from "./public.js";

const company = (s) => ({ name: s.name, legalName: s.legalName, address: s.billingAddress || "Door No.12-7-134/BITNO.2/C/103, Flat No 103, C Block, R V Advaita, Road No.6, Sri Raghavendra Nagar, Habeeb Nagar, Hyderabad, Medchal Malkajgiri, TELANGANA, 500072", phone: s.phone, email: s.email, website: s.website, gstin: s.gstin, stateCode: s.stateCode, state: stateName(s.stateCode), bankDetails: s.bankDetails, upiId: s.upiId, invoiceTerms: s.invoiceTerms, whatsapp: s.whatsapp });
const strip = ({ token, createdBy, remindersSent, activities, ...d }) => d;

/** Customer-facing documents by secret link (quote, invoice, delivery challan), online quote acceptance, payment webhooks, scheduler trigger. */
export function docRoutes({ cfg, store, automation }) {
  const r = Router();
  const limiter = rateLimit({ windowMs: 15 * 60_000, limit: 120, standardHeaders: true, legacyHeaders: false });
  const find = async (kind, t) => {
    if (!/^[\w-]{20,40}$/.test(t)) return null;
    // packing slip and gate pass are print views of the delivery challan
    const col = { quote: store.quotes, invoice: store.invoices, challan: store.orders, packing: store.orders, gatepass: store.orders }[kind];
    return col ? col.findBy("token", t) : null;
  };

  r.get("/api/public/doc/:kind/:token", limiter, wrap(async (req, res) => {
    const d = await find(req.params.kind, req.params.token);
    if (!d || (["challan", "packing", "gatepass"].includes(req.params.kind) && !d.challanNumber)) return res.status(404).json({ error: "NOT_FOUND", message: "This document link is not valid" });
    res.set({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex" });
    const extra = req.params.kind === "invoice" ? { balance: balance(d), amountInWords: amountInWords(d.totals.total) } : req.params.kind === "quote" ? { amountInWords: amountInWords(d.totals.total) } : {};
    res.json({ kind: req.params.kind, doc: { ...strip(d), ...extra }, company: company(await getSettings(store)) });
  }));
  r.post("/api/public/doc/quote/:token/:action", limiter, express.json({ limit: "10kb" }), wrap(async (req, res) => {
    const q = await find("quote", req.params.token), action = req.params.action;
    if (!q || !["accept", "reject"].includes(action)) return res.status(404).json({ error: "NOT_FOUND", message: "This document link is not valid" });
    const name = String(req.body?.name || "").trim().slice(0, 100), note = String(req.body?.note || "").trim().slice(0, 500);
    if (action === "accept" && q.status === "sent" && name.length < 2) return res.status(400).json({ error: "INVALID", message: "Please type your name to accept", field: "name" });
    const out = await respondToQuote(store, automation, q, { action, name, note });
    if (out.error) return res.status(out.error.status).json({ error: "INVALID", message: out.error.message });
    res.json({ ok: true, status: out.quote.status === "converted" ? "accepted" : out.quote.status });
  }));

  // Razorpay calls this when a payment link is paid. Configure the URL https://YOUR-DOMAIN/api/webhooks/razorpay with event payment_link.paid.
  r.post("/api/webhooks/razorpay", express.raw({ type: () => true, limit: "200kb" }), wrap(async (req, res) => {
    if (!verifyWebhook(req.body, req.get("x-razorpay-signature"), cfg.razorpayWebhookSecret)) return res.status(401).json({ error: "BAD_SIGNATURE" });
    let ev; try { ev = JSON.parse(req.body.toString("utf8")); } catch { return res.status(400).end(); }
    if (ev.event !== "payment_link.paid") return res.json({ ok: true, ignored: ev.event });
    const link = ev.payload?.payment_link?.entity, pay = ev.payload?.payment?.entity;
    if (pay?.id && (await store.payments.all()).some((p) => p.external === pay.id)) return res.json({ ok: true, duplicate: true }); // Razorpay retries webhooks
    let inv = link?.notes?.invoiceId ? await store.invoices.get(String(link.notes.invoiceId)) : null;
    const quote = !inv && link?.notes?.quoteId ? await store.quotes.get(String(link.notes.quoteId)) : null;
    if (quote && pay?.id) inv = await invoicePaidQuote(quote, pay.id);
    const order = !inv && link?.notes?.orderId ? await store.orders.get(String(link.notes.orderId)) : null;
    if (order && pay?.id) { // website checkout: the GST invoice is raised now that the money is in
      const fresh = !order.invoiceId;
      inv = await invoiceWebsiteOrder(store, order);
      await store.orders.update(order.id, { paymentStatus: "paid", updatedAt: now() });
      await logActivity(store, { entity: "order", entityId: order.id, text: `Paid online (${pay.id}); invoice ${inv.number}`, by: "razorpay" });
      if (fresh) await automation.on.invoiceCreated(inv);
    }
    if (!inv || !pay?.id) return res.json({ ok: true, ignored: "unknown invoice" });
    const amount = Math.min(pay.amount, balance(inv));
    if (amount > 0) { const out = await recordPayment(store, inv, { amount, mode: "razorpay", reference: pay.id, by: "razorpay", external: pay.id }); await automation.on.paymentReceived(out.invoice, out.payment); }
    res.json({ ok: true });
  }));

  /** A quote paid by its payment link: accept it, raise the sales order and the GST invoice (stock leaves the warehouse), once. */
  async function invoicePaidQuote(q, payId) {
    if (q.invoiceId) return store.invoices.get(q.invoiceId);
    if (!["accepted", "converted"].includes(q.status)) q = await store.quotes.update(q.id, { status: "accepted", acceptedAt: now(), customerResponse: { name: q.customer.name, note: "Paid online", at: now() }, updatedAt: now() });
    const order = q.orderId ? await store.orders.get(q.orderId) : await createOrderFromQuote(store, q, "razorpay");
    if (order.invoiceId) return store.invoices.get(order.invoiceId);
    const customer = { ...(await store.customers.get(q.customerId)), id: q.customerId, paymentTermsDays: 0 };
    const inv = await createInvoice(store, { customer, items: order.items.map(({ amount, tax, total, ...l }) => l), placeOfSupply: order.placeOfSupply, notes: order.notes,
      orderId: order.id, orderNumber: order.number, by: "razorpay" });
    await deductForInvoice(store, inv, "razorpay");
    await store.orders.update(order.id, { paymentStatus: "paid", updatedAt: now() });
    await store.quotes.update(q.id, { invoiceId: inv.id, invoiceNumber: inv.number, updatedAt: now() });
    if (q.enquiryId) await store.enquiries.update(q.enquiryId, { status: "won" });
    await logActivity(store, { entity: "quote", entityId: q.id, text: `Paid online (${payId}); order ${order.number}, invoice ${inv.number}`, by: "razorpay" });
    await automation.on.invoiceCreated(inv);
    return inv;
  }

  // External scheduler (Cloud Scheduler / cron-job.org): POST with header X-Cron-Secret.
  r.post("/api/internal/cron", wrap(async (req, res) => {
    const got = Buffer.from(String(req.get("x-cron-secret") || "")), want = Buffer.from(cfg.cronSecret || "");
    if (!cfg.cronSecret || got.length !== want.length || !crypto.timingSafeEqual(got, want)) return res.status(401).json({ error: "UNAUTHORIZED" });
    res.json(await automation.run());
  }));
  return r;
}
