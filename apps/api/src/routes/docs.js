import crypto from "node:crypto";
import express, { Router } from "express";
import rateLimit from "express-rate-limit";
import { amountInWords, stateName } from "../lib/gst.js";
import { verifyWebhook } from "../lib/razorpay.js";
import { balance, logActivity, now, recordPayment } from "../lib/sales.js";
import { getSettings } from "../model.js";
import { wrap } from "./public.js";

const company = (s) => ({ name: s.name, legalName: s.legalName, address: s.address, phone: s.phone, email: s.email, website: s.website, gstin: s.gstin, stateCode: s.stateCode, state: stateName(s.stateCode), bankDetails: s.bankDetails, upiId: s.upiId, invoiceTerms: s.invoiceTerms, whatsapp: s.whatsapp });
const strip = ({ token, createdBy, remindersSent, activities, ...d }) => d;

/** Customer-facing documents by secret link (quote, invoice, delivery challan), online quote acceptance, payment webhooks, scheduler trigger. */
export function docRoutes({ cfg, store, automation }) {
  const r = Router();
  const limiter = rateLimit({ windowMs: 15 * 60_000, limit: 120, standardHeaders: true, legacyHeaders: false });
  const find = async (kind, t) => {
    if (!/^[\w-]{20,40}$/.test(t)) return null;
    const col = { quote: store.quotes, invoice: store.invoices, challan: store.orders }[kind];
    return col ? col.findBy("token", t) : null;
  };

  r.get("/api/public/doc/:kind/:token", limiter, wrap(async (req, res) => {
    const d = await find(req.params.kind, req.params.token);
    if (!d || (req.params.kind === "challan" && !d.challanNumber)) return res.status(404).json({ error: "NOT_FOUND", message: "This document link is not valid" });
    res.set({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex" });
    const extra = req.params.kind === "invoice" ? { balance: balance(d), amountInWords: amountInWords(d.totals.total) } : req.params.kind === "quote" ? { amountInWords: amountInWords(d.totals.total) } : {};
    res.json({ kind: req.params.kind, doc: { ...strip(d), ...extra }, company: company(await getSettings(store)) });
  }));
  r.post("/api/public/doc/quote/:token/:action", limiter, express.json({ limit: "10kb" }), wrap(async (req, res) => {
    const q = await find("quote", req.params.token), action = req.params.action;
    if (!q || !["accept", "reject"].includes(action)) return res.status(404).json({ error: "NOT_FOUND", message: "This document link is not valid" });
    if (q.status !== "sent") return res.status(409).json({ error: "INVALID", message: q.status === "expired" ? "This quotation has expired. Please contact us for an updated quote." : `This quotation is already ${q.status}.` });
    const name = String(req.body?.name || "").trim().slice(0, 100), note = String(req.body?.note || "").trim().slice(0, 500);
    if (action === "accept" && name.length < 2) return res.status(400).json({ error: "INVALID", message: "Please type your name to accept", field: "name" });
    const status = action === "accept" ? "accepted" : "rejected";
    const upd = await store.quotes.update(q.id, { status, [status + "At"]: now(), customerResponse: { name, note, at: now() }, updatedAt: now() });
    await logActivity(store, { entity: "quote", entityId: q.id, text: `Customer ${status} online${name ? " (" + name + ")" : ""}${note ? ": " + note : ""}`, by: "customer" });
    if (q.enquiryId) await store.enquiries.update(q.enquiryId, { status: status === "accepted" ? "won" : "closed" });
    if (status === "accepted") await automation.on.quoteAccepted(upd);
    res.json({ ok: true, status });
  }));

  // Razorpay calls this when a payment link is paid. Configure the URL https://YOUR-DOMAIN/api/webhooks/razorpay with event payment_link.paid.
  r.post("/api/webhooks/razorpay", express.raw({ type: () => true, limit: "200kb" }), wrap(async (req, res) => {
    if (!verifyWebhook(req.body, req.get("x-razorpay-signature"), cfg.razorpayWebhookSecret)) return res.status(401).json({ error: "BAD_SIGNATURE" });
    let ev; try { ev = JSON.parse(req.body.toString("utf8")); } catch { return res.status(400).end(); }
    if (ev.event !== "payment_link.paid") return res.json({ ok: true, ignored: ev.event });
    const link = ev.payload?.payment_link?.entity, pay = ev.payload?.payment?.entity;
    const inv = link?.notes?.invoiceId ? await store.invoices.get(String(link.notes.invoiceId)) : null;
    if (!inv || !pay?.id) return res.json({ ok: true, ignored: "unknown invoice" });
    if ((await store.payments.all()).some((p) => p.external === pay.id)) return res.json({ ok: true, duplicate: true }); // Razorpay retries webhooks
    const amount = Math.min(pay.amount, balance(inv));
    if (amount > 0) { const out = await recordPayment(store, inv, { amount, mode: "razorpay", reference: pay.id, by: "razorpay", external: pay.id }); await automation.on.paymentReceived(out.invoice, out.payment); }
    res.json({ ok: true });
  }));

  // External scheduler (Cloud Scheduler / cron-job.org): POST with header X-Cron-Secret.
  r.post("/api/internal/cron", wrap(async (req, res) => {
    const got = Buffer.from(String(req.get("x-cron-secret") || "")), want = Buffer.from(cfg.cronSecret || "");
    if (!cfg.cronSecret || got.length !== want.length || !crypto.timingSafeEqual(got, want)) return res.status(401).json({ error: "UNAUTHORIZED" });
    res.json(await automation.run());
  }));
  return r;
}
