import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { todayIST } from "../lib/gst.js";
import { shopFlags } from "../lib/notify.js";
import { createPaymentLink } from "../lib/razorpay.js";
import { balance, bucketOf, now, refundDue, respondToQuote, stockBuckets, tierPrice } from "../lib/sales.js";
import { pieces } from "../lib/units.js";
import { normaliseStatus } from "../services/delivery_shadowfax.js";
import { getSettings } from "../model.js";
import { wrap } from "./public.js";
import { buyerSession, requireBuyer } from "./shop.js";

/**
 * Buyer portal for hotel and clinic procurement managers (signed in with their mobile number + WhatsApp code, see shop.js).
 * Every query is scoped to the signed-in customer's id: another customer's record is answered as "not found".
 * Only what a customer may see leaves this file (no internal notes, activities, cost prices or staff names).
 */
const acceptInput = z.object({ name: z.string().trim().min(2, "Type your name to approve").max(100), note: z.string().trim().max(500).default(""), pay: z.boolean().default(true) }).strict();
const notFound = (res, what) => res.status(404).json({ error: "NOT_FOUND", message: `${what} not found` });
const doc = (kind, t) => `/doc/${kind}/${t}`;
const line = (it) => ({ name: it.name, sku: it.sku || "", hsn: it.hsn || "", qty: it.qty, unit: it.unit || "pcs", perUnit: it.perUnit || 1, pieces: pieces(it), rate: it.rate, discountPct: it.discountPct || 0, gstRate: it.gstRate ?? 0, amount: it.amount ?? 0, tax: it.tax ?? 0, total: it.total ?? 0 });
const totals = (t) => ({ taxable: t.taxable, cgst: t.cgst, sgst: t.sgst, igst: t.igst, tax: t.tax, roundOff: t.roundOff, total: t.total });
/** Drafts are internal; a sent quote past its validity date already shows as expired. */
const quoteStatus = (q, today) => (q.status === "sent" && q.validUntil && q.validUntil < today ? "expired" : q.status);

export function buyerRoutes({ cfg, store, automation, fetchImpl = globalThis.fetch }) {
  const r = Router();
  r.use(buyerSession({ cfg, store }), requireBuyer, (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  const mine = (req, row) => row && row.customerId === req.customer.id;
  const siteUrl = (req) => cfg.publicUrl || `${req.protocol}://${req.get("host")}`;

  r.get("/quotes", wrap(async (req, res) => {
    const today = todayIST();
    const [quotes, orders] = await Promise.all([store.quotes.all({ sort: { createdAt: -1 } }), store.orders.all()]);
    const rows = quotes.filter((q) => mine(req, q) && q.status !== "draft");
    const orderNo = (id) => orders.find((o) => o.id === id)?.number || "";
    res.json(rows.map((q) => ({
      id: q.id, number: q.number, version: q.version || 1, createdAt: q.createdAt, sentAt: q.sentAt || null, validUntil: q.validUntil || "", status: quoteStatus(q, today),
      items: q.items.map(line), totals: totals(q.totals), interState: !!q.interState, link: doc("quote", q.token),
      canAccept: quoteStatus(q, today) === "sent", payUrl: !q.invoiceId && q.payLink?.url ? q.payLink.url : "", orderNumber: q.orderId ? orderNo(q.orderId) : "", invoiceNumber: q.invoiceNumber || "",
    })));
  }));

  /** Approve a quote. With online payments on, it also returns a Razorpay link; paying it raises the GST invoice (webhook). */
  r.post("/quotes/:id/accept", rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false }), wrap(async (req, res) => {
    const q = await store.quotes.get(req.params.id);
    if (!mine(req, q) || q.status === "draft") return notFound(res, "Quotation");
    const p = acceptInput.safeParse(req.body ?? {});
    if (!p.success) return res.status(400).json({ error: "INVALID", message: p.error.issues[0].message, field: p.error.issues[0].path.join(".") });
    const out = await respondToQuote(store, automation, q, { action: "accept", name: p.data.name, note: p.data.note, via: "in the buyer portal" });
    if (out.error) return res.status(out.error.status).json({ error: "INVALID", message: out.error.message });
    let payUrl = "", payError = "";
    if (p.data.pay && shopFlags(cfg, await getSettings(store)).online && out.quote.totals.total > 0) {
      try {
        const link = await createPaymentLink(cfg, out.quote, { fetchImpl, notes: { quoteId: q.id }, reference: `${q.number}-${Date.now().toString(36)}`, callbackUrl: `${siteUrl(req)}/account?tab=quotes&paid=${encodeURIComponent(q.number)}` });
        await store.quotes.update(q.id, { payLink: link, updatedAt: now() });
        payUrl = link.url;
      } catch { payError = "Your approval is saved, but the payment page could not be opened. We will send you the invoice with payment details."; }
    }
    const order = out.quote.orderId ? await store.orders.get(out.quote.orderId) : null;
    res.json({ ok: true, status: "accepted", orderNumber: order?.number || "", payUrl, payError });
  }));

  r.get("/orders", wrap(async (req, res) => {
    const [orders, invoices] = await Promise.all([store.orders.all({ sort: { createdAt: -1 } }), store.invoices.all()]);
    res.json(orders.filter((o) => mine(req, o)).map((o) => {
      const inv = o.invoiceId ? invoices.find((i) => i.id === o.invoiceId) : null;
      const s = o.shipment;
      return {
        id: o.id, number: o.number, createdAt: o.createdAt, status: o.status, poNumber: o.poNumber || "", quoteNumber: o.quoteNumber || "", expectedDate: o.expectedDate || "",
        items: o.items.map(line), totals: totals(o.totals), interState: !!o.interState, payment: o.payment || "", paymentStatus: o.paymentStatus || "",
        dispatch: o.challanNumber ? { challanNumber: o.challanNumber, date: o.dispatch?.date || "", transporter: o.dispatch?.transporter || "", trackingNo: o.dispatch?.trackingNo || "", link: doc("challan", o.token) } : null,
        tracking: s ? { courier: s.provider === "shadowfax" ? "Shadowfax" : s.provider || "", awb: s.awb || "", status: normaliseStatus(s.status), url: s.trackingUrl || "",
          history: (s.history || []).map((h) => ({ status: normaliseStatus(h.status), at: h.at })) } : null,
        invoice: inv && inv.status !== "void" ? { id: inv.id, number: inv.number, status: inv.status, balance: balance(inv), link: doc("invoice", inv.token), payUrl: balance(inv) > 0 ? inv.payLink?.url || "" : "" } : null,
      };
    }));
  }));

  r.get("/invoices", wrap(async (req, res) => {
    const today = todayIST();
    const [all, notes] = await Promise.all([store.invoices.all({ sort: { createdAt: -1 } }), store.creditNotes.all({ sort: { createdAt: 1 } })]);
    const rows = all.filter((i) => mine(req, i) && i.status !== "void");
    res.json(rows.map((i) => ({
      id: i.id, number: i.number, date: i.date, dueDate: i.dueDate, status: i.status, orderNumber: i.orderNumber || "", poNumber: i.poNumber || "",
      totals: totals(i.totals), interState: !!i.interState, amountPaid: i.amountPaid || 0, balance: balance(i), overdue: balance(i) > 0 && i.dueDate < today,
      link: doc("invoice", i.token), payUrl: balance(i) > 0 ? i.payLink?.url || "" : "",
      creditedAmount: i.creditedAmount || 0, refundDue: refundDue(i),
      creditNotes: notes.filter((c) => c.invoiceId === i.id && mine(req, c)).map((c) => ({ id: c.id, number: c.number, date: c.date, reason: c.reason, totals: totals(c.totals), link: doc("creditnote", c.token) })),
    })));
  }));

  /**
   * Reorder: the order's items as website basket lines at today's catalogue prices. Quantities are pieces, rounded up to the
   * product's pack multiple and minimum. Items no longer sold online come back in `skipped` with the reason.
   */
  r.get("/orders/:id/reorder", wrap(async (req, res) => {
    const o = await store.orders.get(req.params.id);
    if (!mine(req, o)) return notFound(res, "Order");
    const [s, products, buckets] = await Promise.all([getSettings(store), store.products.all(), stockBuckets(store)]);
    const items = [], skipped = [];
    for (const it of o.items) {
      const p = it.productId ? products.find((x) => x.id === it.productId) : null;
      if (!p || !p.active) { skipped.push({ name: it.name, reason: "no longer in the catalogue" }); continue; }
      if (p.price == null || !s.showPrices) { skipped.push({ name: it.name, reason: "price on request: ask us for a quote" }); continue; }
      const variant = (p.variants || []).find((v) => it.name === `${p.name} (${v})`) || "";
      if (p.variants?.length && !variant) { skipped.push({ name: it.name, reason: `choose ${p.variantLabel || "an option"} on the product page` }); continue; }
      const pack = p.packSize || 1, min = Math.max(p.minQty || 0, pack);
      const qty = Math.min(1_000_000, Math.max(min, Math.ceil(pieces(it) / pack) * pack));
      const rate = tierPrice(p, qty), available = p.stockTracked ? bucketOf(buckets, p.id).available : null;
      items.push({ productId: p.id, variant, name: it.name, qty, rate, lineTotal: Math.round(rate * qty), gstRate: p.gstRate ?? 18, previousRate: it.perUnit > 1 ? Math.round(it.rate / it.perUnit) : it.rate,
        stock: available == null ? null : available >= qty ? "in" : available > 0 ? "short" : "out" });
    }
    res.json({ orderNumber: o.number, items, skipped });
  }));
  return r;
}
