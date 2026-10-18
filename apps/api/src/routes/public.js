import { Router } from "express";
import rateLimit from "express-rate-limit";
import { enquiryInput, getSettings, publicProduct } from "../model.js";
import { DEFAULT_HOME } from "../schemas.js";
import { STATES } from "../lib/gst.js";
import { stockLevels } from "../lib/sales.js";
import { shopFlags } from "../lib/notify.js";

export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function publicRoutes({ cfg, store, automation }) {
  const r = Router();
  const settings = async () => (await store.settings.findBy("key", "company")) || {};

  r.get("/catalog", wrap(async (_req, res) => {
    const s = await settings();
    const [cats, prods, lv] = await Promise.all([store.categories.all(), store.products.all(), stockLevels(store)]);
    const products = prods.filter((p) => p.active).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((p) => publicProduct(p, s, lv[p.id]));
    const categories = cats.sort((a, b) => a.order - b.order).map(({ id, slug, name, description, order }) => ({
      id, slug, name, description, order, count: products.filter((p) => p.category === slug).length,
    }));
    res.set("Cache-Control", "public, max-age=60");
    res.json({ categories, products, showPrices: !!s.showPrices });
  }));

  r.get("/products/:slug", wrap(async (req, res) => {
    const s = await settings();
    const p = await store.products.findBy("slug", req.params.slug);
    if (!p || !p.active) return res.status(404).json({ error: "NOT_FOUND", message: "Product not found" });
    res.json(publicProduct(p, s, (await stockLevels(store))[p.id]));
  }));

  r.get("/settings", wrap(async (_req, res) => {
    const s = await getSettings(store), home = await store.settings.findBy("key", "home");
    const { name, legalName, tagline, about, phone, whatsapp, email, website, address, hours, showPrices, ga4Id, metaPixelId, brochureUrl, gstin } = s;
    res.set("Cache-Control", "public, max-age=60");
    res.json({ name, legalName, tagline, about, phone, whatsapp, email, website, address, hours, showPrices, ga4Id, metaPixelId, brochureUrl, gstin, stateCode: s.stateCode,
      shop: shopFlags(cfg, s), states: STATES, home: home ? { ...DEFAULT_HOME, ...home.value } : DEFAULT_HOME });
  }));

  const limiter = rateLimit({
    windowMs: 60 * 60 * 1000, limit: 8, standardHeaders: true, legacyHeaders: false,
    message: { error: "RATE_LIMITED", message: "Too many requests from this network. Please try again later or call us." },
  });
  r.post("/enquiries", limiter, wrap(async (req, res) => {
    const parsed = enquiryInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "INVALID", message: parsed.error.issues[0].message, field: parsed.error.issues[0].path.join(".") });
    const d = parsed.data;
    if (d.website) return res.status(201).json({ ok: true, ref: "HC-000000" }); // bot: pretend success, store nothing
    if (!d.items.length && d.message.length < 5) return res.status(400).json({ error: "INVALID", message: "Add some products or tell us what you need" });
    const products = await store.products.all();
    const items = [];
    for (const it of d.items) {
      const p = products.find((x) => x.id === it.productId && x.active);
      if (!p) return res.status(400).json({ error: "INVALID", message: "A product in your list is no longer available. Please refresh." });
      items.push({ productId: p.id, sku: p.sku, name: it.variant && p.variants?.includes(it.variant) ? `${p.name} (${it.variant})` : p.name, qty: it.qty });
    }
    const yy = new Date().getFullYear().toString().slice(2);
    let ref; // skip numbers already used (databases created before the counter existed)
    do ref = `HC-${yy}${String(await store.nextSeq("enquiry:" + yy)).padStart(4, "0")}`; while (await store.enquiries.findBy("ref", ref));
    const enq = await store.enquiries.insert({ ref, name: d.name, company: d.company, phone: d.phone, email: d.email, message: d.message, items, source: d.source || {}, status: "new", notes: "",
      assignedTo: "", customerId: "", followUpAt: "", createdAt: new Date().toISOString() });
    res.status(201).json({ ok: true, ref });
    automation?.on.enquiryCreated(enq); // alerts, auto-reply and assignment run after the visitor gets their answer
  }));

  return r;
}

export function mediaRoute({ store }) {
  const r = Router();
  r.get("/:id", wrap(async (req, res) => {
    const m = await store.getMedia(req.params.id);
    if (!m) return res.status(404).end();
    res.set({ "Content-Type": m.contentType, "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" });
    res.send(m.data);
  }));
  return r;
}
