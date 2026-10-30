import crypto from "node:crypto";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { nextNumber } from "../lib/gst.js";
import { shopFlags } from "../lib/notify.js";
import { createPaymentLink } from "../lib/razorpay.js";
import { balance, bucketOf, customerSnapshot, logActivity, now, priced, stockBuckets, tierPrice, token } from "../lib/sales.js";
import { getSettings } from "../model.js";
import { wrap as plainWrap } from "./public.js";
import { atomicWrap } from "./atomic.js";

/**
 * Website shop: WhatsApp OTP sign-in for buyers, cart checkout into a sales order, Razorpay payment and "my orders".
 * Every part follows the owner's switches in settings (shopFlags); prices are always worked out here, never trusted from the browser.
 */
export const SHOP_COOKIE = "hc_shop";
const OTP_MINUTES = 10, OTP_TRIES = 5;
const digits10 = (phone) => String(phone || "").replace(/\D/g, "").slice(-10);
const mobileOk = (d) => /^[6-9]\d{9}$/.test(d);
const text = (max) => z.string().trim().max(max);

const checkoutInput = z.object({
  items: z.array(z.object({ productId: z.string().max(60), qty: z.number().int().min(1).max(1_000_000), variant: text(60).default("") }).strict()).min(1, "Your cart is empty").max(60),
  name: text(100).min(2, "Enter your name"), company: text(120).default(""), phone: text(20).default(""),
  email: z.union([z.literal(""), z.string().trim().toLowerCase().email("Enter a valid email").max(160)]).default(""),
  gstin: z.union([z.literal(""), z.string().trim().toUpperCase().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, "GSTIN should look like 36ABCDE1234F1Z5")]).default(""),
  address: text(400).min(10, "Enter the full delivery address"), city: text(80).min(2, "Enter the city"), pincode: z.string().trim().regex(/^\d{6}$/, "PIN code is 6 digits"),
  stateCode: z.string().regex(/^\d{2}$/, "Choose your state"), notes: text(500).default(""), payment: z.enum(["online", "later"]),
}).strict();
const otpRequestInput = z.object({ phone: text(20).min(10, "Enter a 10-digit Indian mobile number") }).strict();
const otpVerifyInput = z.object({ phone: text(20).min(10, "Enter a 10-digit Indian mobile number"), code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code") }).strict();
const invalid = (res, message, field, status = 400) => res.status(status).json({ error: "INVALID", message, ...(field ? { field } : {}) });

export function shopRoutes({ cfg, store, automation, notifier, fetchImpl = globalThis.fetch }) {
  const r = Router();
  const wrap = fn => atomicWrap(store, fn, { commitErrors: req => /(?:otp\/verify|auth\/verify-code)$/.test(req.path || "") });
  const flags = async () => shopFlags(cfg, await getSettings(store));
  const hashOtp = (phone, code) => crypto.createHmac("sha256", cfg.jwtSecret).update(`otp:${phone}:${code}`).digest("hex");
  const siteUrl = (req) => cfg.publicUrl || `${req.protocol}://${req.get("host")}`;
  const findCustomer = async (d) => (await store.customers.all()).find((c) => c.phone && digits10(c.phone) === d) || null;

  r.use(buyerSession({ cfg, store }));
  const signedIn = requireBuyer;

  // ---------- WhatsApp OTP sign-in
  const limit = (n) => rateLimit({ windowMs: 15 * 60_000, limit: n, standardHeaders: true, legacyHeaders: false, message: { error: "RATE_LIMITED", message: "Too many attempts. Please try again in a few minutes." } });
  // /auth/request-code and /auth/verify-code are the buyer portal's names; /otp/* stay for the checkout page.
  r.post(["/otp/request", "/auth/request-code"], limit(5), wrap(async (req, res) => {
    if (!(await flags()).otp) return res.status(403).json({ error: "OFF", message: "Sign-in by WhatsApp code is switched off" });
    const p = otpRequestInput.safeParse(req.body ?? {});
    if (!p.success) return invalid(res, p.error.issues[0].message, "phone");
    const phone = digits10(p.data.phone);
    if (!mobileOk(phone)) return invalid(res, "Enter a 10-digit Indian mobile number", "phone");
    const quotaKey='otp-send:'+phone;
    const previous=await store.settings.findBy('key',quotaKey);
    const requests=(previous?.requests||[]).filter(t=>Date.now()-Date.parse(t)<15*60000);
    if(requests.length>=5)return res.status(429).json({error:'RATE_LIMITED',message:'Too many codes sent to this number. Please try again later.'});
    if(previous)await store.settings.update(previous.id,{requests:[...requests,now()]});else await store.settings.insert({key:quotaKey,requests:[now()]});
    const old = (await store.otps.all()).filter((o) => o.phone === phone);
    if (old.some((o) => Date.now() - Date.parse(o.createdAt) < 60_000)) return res.status(429).json({ error: "RATE_LIMITED", message: "Please wait a minute before asking for another code" });
    for (const o of old) await store.otps.remove(o.id);
    const code = String(crypto.randomInt(100000, 1000000));
    const otp = await store.otps.insert({ phone, hash: hashOtp(phone, code), attempts: 0, expiresAt: new Date(Date.now() + OTP_MINUTES * 60_000).toISOString(), createdAt: now() });
    if (notifier.channels.otp === "off") return res.json({ ok: true, devCode: code }); // development only: shopFlags hides OTP in production without WhatsApp
    const response = { ok: true };
    await store.afterCommit(async () => {
      try { await notifier.sendOtp(phone, code); }
      catch (e) {
        await store.otps.remove(otp.id); delete response.ok;
        Object.assign(response, { error: e.status === 429 ? 'RATE_LIMITED' : 'NOT_SENT', message: e.status === 429 ? 'Too many codes sent to this number. Please try again in a few minutes.' : 'We could not send the code on WhatsApp. Please try again.' });
        res.status(e.status === 429 ? 429 : 502);
      }
    });
    res.json(response);
  }));

  r.post(["/otp/verify", "/auth/verify-code"], limit(15), wrap(async (req, res) => {
    const p = otpVerifyInput.safeParse(req.body ?? {});
    if (!p.success) return invalid(res, p.error.issues[0].message, p.error.issues[0].path.join(".") || "code");
    const phone = digits10(p.data.phone), code = p.data.code;
    const otp = (await store.otps.all()).find((o) => o.phone === phone);
    if (!otp || Date.parse(otp.expiresAt) < Date.now()) return invalid(res, "This code has expired. Please ask for a new one.", "code");
    if (otp.attempts >= OTP_TRIES) { await store.otps.remove(otp.id); return res.status(429).json({ error: "RATE_LIMITED", message: "Too many wrong codes. Please ask for a new one." }); }
    const want = Buffer.from(otp.hash), got = Buffer.from(hashOtp(phone, code));
    if (!/^\d{6}$/.test(code) || (want.length !== got.length || !crypto.timingSafeEqual(want, got))) { await store.otps.update(otp.id, { attempts: otp.attempts + 1 }); return invalid(res, "That code is not right", "code"); }
    await store.otps.remove(otp.id);
    let c = await findCustomer(phone);
    if (!c) {
      c = await store.customers.insert({ name: `+91 ${phone}`, contactName: "", phone: `+91 ${phone}`, email: "", gstin: "", stateCode: "", city: "", billingAddress: "", shippingAddress: "",
        priceListId: "", paymentTermsDays: 0, reorderDays: 0, tags: ["website"], notes: "", assignedTo: "", followUpAt: "", source: "website", createdAt: now(), updatedAt: now() });
    }
    setBuyerCookie(cfg, res, c);
    res.json({ ok: true, customer: view(c) });
  }));

  r.post("/logout", (_req, res) => { res.clearCookie(SHOP_COOKIE, { path: "/" }); res.status(204).end(); });
  r.get("/me", signedIn, (req, res) => res.json(view(req.customer)));

  r.get("/orders", signedIn, wrap(async (req, res) => {
    const [orders, invoices] = await Promise.all([store.orders.all({ sort: { createdAt: -1 } }), store.invoices.all()]);
    res.set("Cache-Control", "no-store");
    res.json(orders.filter((o) => o.customerId === req.customer.id).map((o) => {
      const inv = o.invoiceId ? invoices.find((i) => i.id === o.invoiceId) : null;
      return { id: o.id, number: o.number, createdAt: o.createdAt, status: o.status, payment: o.payment || "", paymentStatus: o.paymentStatus || "", total: o.totals.total,
        items: o.items.map(({ name, qty, rate }) => ({ name, qty, rate })), challan: o.challanNumber ? `/doc/challan/${o.token}` : "",
        invoice: inv && inv.status !== "void" ? { number: inv.number, status: inv.status, balance: balance(inv), link: `/doc/invoice/${inv.token}`, payUrl: inv.payLink?.url || "" } : null };
    }));
  }));

  /** Online payment (again) for an unpaid website order. */
  r.post("/orders/:id/pay", signedIn, plainWrap(async (req, res) => {
    const o = await store.orders.get(req.params.id);
    if (!o || o.customerId !== req.customer.id) return res.status(404).json({ error: "NOT_FOUND", message: "Order not found" });
    if (!(await flags()).online) return res.status(403).json({ error: "OFF", message: "Online payment is not available. Please contact us." });
    if (o.paymentStatus === "paid" || o.invoiceId || o.status === "cancelled") return invalid(res, "This order does not need a payment", "", 409);
    res.json({ payUrl: await payLink(req, o) });
  }));

  // ---------- checkout
  r.post("/checkout", limit(20), wrap(async (req, res) => {
    const f = await flags(), s = await getSettings(store);
    if (!f.cart) return res.status(403).json({ error: "OFF", message: "Online ordering is switched off. Please send us a quote request instead." });
    const parsed = checkoutInput.safeParse(req.body);
    if (!parsed.success) { const i = parsed.error.issues[0]; return invalid(res, i.message, i.path.join(".")); }
    const d = parsed.data;
    const checkoutFingerprint=crypto.createHash('sha256').update(JSON.stringify(d)).digest('hex');
    const requestKey=String(req.get?.("idempotency-key")||"");
    if(requestKey && !/^[A-Za-z0-9_-]{16,100}$/.test(requestKey))return invalid(res,"Invalid checkout request key");
    if(requestKey){const old=await store.orders.findBy("checkoutKey",requestKey);if(old){if(!req.customer || old.customerId!==req.customer.id || old.checkoutFingerprint!==checkoutFingerprint)return invalid(res,"Checkout key conflict","",409);return res.status(200).json({ok:true,order:{id:old.id,number:old.number,total:old.totals.total},payUrl:old.payLink?.url||"",payError:""});}}
    if (d.payment === "online" && !f.online) return invalid(res, "Online payment is not available. Choose pay later.", "payment");
    if (d.payment === "later" && !f.payLater) return invalid(res, "Please pay online to place this order", "payment");

    let customer = req.customer;
    if(customer?.id)customer=await store.customers.get(customer.id);
    if (!customer) {
      if (f.otp) return res.status(401).json({ error: "LOGIN_REQUIRED", message: "Please verify your mobile number first" });
      const phone = digits10(d.phone);
      if (!mobileOk(phone)) return invalid(res, "Enter a 10-digit Indian mobile number", "phone");
      customer = (await findCustomer(phone)) || await store.customers.insert({ name: `+91 ${phone}`, contactName: "", phone: `+91 ${phone}`, email: "", gstin: "", stateCode: "", city: "", billingAddress: "", shippingAddress: "",
        priceListId: "", paymentTermsDays: 0, reorderDays: 0, tags: ["website"], notes: "", assignedTo: "", followUpAt: "", source: "website", createdAt: now(), updatedAt: now() });
    }

    const [products, buckets] = await Promise.all([store.products.all(), stockBuckets(store)]);
    const lv = Object.fromEntries(products.map((p) => [p.id, bucketOf(buckets, p.id).available])); // stock held for open orders cannot be sold again
    const items = [];
    for (const it of d.items) {
      const p = products.find((x) => x.id === it.productId && x.active);
      if (!p) return invalid(res, "A product in your cart is no longer available. Please refresh the page.");
      if (p.price == null || !s.showPrices) return invalid(res, `${p.name} has no online price. Please request a quote for it.`);
      if (p.variants?.length && !p.variants.includes(it.variant)) return invalid(res, `Choose ${p.variantLabel || "an option"} for ${p.name}`);
      const pack = p.packSize || 1, min = Math.max(p.minQty || 0, pack);
      if (it.qty < min) return invalid(res, `Minimum order for ${p.name} is ${min} ${p.unit || "pcs"}`);
      if (it.qty % pack) return invalid(res, `${p.name} is sold in packs of ${pack}. Choose ${pack}, ${pack * 2}, ${pack * 3}…`);
      const used = items.filter((x) => x.productId === p.id).reduce((n, x) => n + x.qty, 0);
      if (p.stockTracked && used + it.qty > (lv[p.id] || 0)) return invalid(res, (lv[p.id] || 0) > 0 ? `Only ${lv[p.id]} ${p.unit || "pcs"} of ${p.name} in stock` : `${p.name} is out of stock`);
      items.push({ productId: p.id, sku: p.sku, name: it.variant ? `${p.name} (${it.variant})` : p.name, hsn: p.hsn || "", unit: p.unit || "pcs", qty: it.qty, rate: tierPrice(p, it.qty), discountPct: 0, gstRate: p.gstRate ?? 18 });
    }

    const address = `${d.address}, ${d.city} – ${d.pincode}`;
    customer = await store.customers.update(customer.id, { ...profilePatch(customer, d), updatedAt: now() });
    const snap = customerSnapshot({ ...customer, name: d.company || d.name, contactName: d.name, email: d.email || customer.email, gstin: d.gstin, stateCode: d.stateCode, billingAddress: address, shippingAddress: address });
    const doc = await priced(store, { items, customer: snap, placeOfSupply: d.stateCode });
    const order = await store.orders.insert({ number: await nextNumber(store, "SO"), token: token(), quoteId: "", quoteNumber: "", customerId: customer.id, customer: snap, ...doc,
      poNumber: "", status: "confirmed", expectedDate: "", notes: d.notes, dispatch: null, challanNumber: "", invoiceId: "",
      checkoutKey: requestKey || undefined, checkoutFingerprint, reservationExpiresAt: d.payment === "online" ? new Date(Date.now()+30*60000).toISOString() : "", source: "website", payment: d.payment, paymentStatus: d.payment === "online" ? "pending" : "unpaid", createdBy: "website", createdAt: now(), updatedAt: now() });
    await logActivity(store, { entity: "customer", entityId: customer.id, text: `Website order ${order.number} placed (${d.payment === "online" ? "online payment" : "pay later"})`, by: "website" });
    await automation.on.websiteOrder(order);

    const response = { ok: true, order: { id: order.id, number: order.number, total: order.totals.total }, payUrl: '', payError: '' };
    if (d.payment === 'online') await store.afterCommit(async () => {
      try { response.payUrl = await payLink(req, order); }
      catch { response.payError = 'Order saved. Open My account to retry payment or contact our team.'; }
    });
    res.status(201).json(response);
  }));

  async function payLink(req, order) {
    const link = await createPaymentLink(cfg, order, { fetchImpl, notes: { orderId: order.id }, reference: `${order.number}-${Date.now().toString(36)}`, callbackUrl: `${siteUrl(req)}/account?order=${encodeURIComponent(order.number)}` });
    await store.orders.update(order.id, { payLink: link, updatedAt: now() });
    return link.url;
  }
  return r;
}

/**
 * Buyer session (website shoppers and the buyer portal): httpOnly cookie for BUYER_SESSION_DAYS (30 by default), shared by
 * /api/shop and /api/buyer. It slides: a session older than a day is re-issued on the next request, so a buyer who keeps
 * using the site is not asked for a WhatsApp code again, and one who stays away for the whole period is.
 */
const RENEW_AFTER_S = 86_400;
export function setBuyerCookie(cfg, res, c) {
  const days = cfg.buyerSessionDays || 30;
  res.cookie(SHOP_COOKIE, jwt.sign({ sub: c.id }, cfg.jwtSecret, { algorithm: "HS256", audience: "shop", expiresIn: `${days}d` }),
    { httpOnly: true, sameSite: "lax", secure: cfg.cookieSecure, maxAge: days * 86400_000, path: "/" }); // lax: the buyer comes back signed in from the Razorpay page
}
/** Reads the buyer cookie into req.customer (signed out when missing or expired). Writes need the same anti-CSRF header as the admin API. */
export const buyerSession = ({ cfg, store }) => plainWrap(async (req, res, next) => {
  if (!["GET", "HEAD"].includes(req.method) && req.get("x-requested-with") !== "hc-admin") return res.status(403).json({ error: "CSRF", message: "Missing request header" });
  const t = req.cookies?.[SHOP_COOKIE];
  if (t) {
    let c = null;
    try { c = jwt.verify(t, cfg.jwtSecret, { algorithms: ["HS256"], audience: "shop" }); } catch { /* expired or tampered: treat as signed out */ }
    if (c) {
      req.customer = await store.customers.get(c.sub);
      if (req.customer && Date.now() / 1000 - c.iat > RENEW_AFTER_S) setBuyerCookie(cfg, res, req.customer);
    }
  }
  next();
});
export const requireBuyer = (req, res, next) => (req.customer ? next() : res.status(401).json({ error: "LOGIN_REQUIRED", message: "Please sign in with your mobile number" }));

const view = (c) => ({ id: c.id, name: c.contactName || "", company: c.name.startsWith("+91 ") ? "" : c.name, phone: c.phone, email: c.email || "", gstin: c.gstin || "",
  stateCode: c.stateCode || "", city: c.city || "", address: c.shippingAddress || c.billingAddress || "" });

/** Fills the buyer's customer record from what they typed. Details the team already holds (name, GSTIN, addresses) are only filled in when blank. */
function profilePatch(c, d) {
  const blank = (k) => !c[k] || (k === "name" && c.name.startsWith("+91 "));
  const p = {};
  if (d.name && !c.contactName) p.contactName = d.name;
  if ((d.company || d.name) && blank("name")) p.name = d.company || d.name;
  if (d.email && !c.email) p.email = d.email;
  if (d.gstin && !c.gstin) p.gstin = d.gstin;
  if (d.stateCode && !c.stateCode) p.stateCode = d.stateCode;
  if (d.city && !c.city) p.city = d.city;
  if (d.address && !c.shippingAddress) p.shippingAddress = d.pincode ? `${d.address}, ${d.city} – ${d.pincode}` : d.address;
  if (d.address && !c.billingAddress) p.billingAddress = p.shippingAddress || d.address;
  return p;
}
