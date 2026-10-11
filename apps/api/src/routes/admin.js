import express, { Router } from "express";
import rateLimit from "express-rate-limit";
import { authenticate, checkPassword, hashPassword, passwordProblem, requireOwner, setSessionCookie, signSession, COOKIE } from "../auth.js";
import { parseCsv, toCsv } from "../csv.js";
import { categoryInput, productInput, productPatch, settingsInput, slugify, uniqueSlug } from "../model.js";
import { z } from "zod";
import { wrap } from "./public.js";

const bad = (res, issue, status = 400) => res.status(status).json({ error: "INVALID", message: typeof issue === "string" ? issue : `${issue.path.join(".") || "request"}: ${issue.message}`, field: issue.path?.join(".") });
const now = () => new Date().toISOString();
const rupees = (p) => (p == null ? "" : (p / 100).toFixed(2));
const toPaise = (s) => { if (s === "" || s == null) return null; const n = Number(String(s).replace(/,/g, "")); return Number.isFinite(n) && n >= 0 && n <= 1_000_000 ? Math.round(n * 100) : NaN; };
const IMG_TYPES = { "image/jpeg": [[0xff, 0xd8, 0xff]], "image/png": [[0x89, 0x50, 0x4e, 0x47]], "image/webp": [[0x52, 0x49, 0x46, 0x46]] };
const sniff = (buf) => Object.entries(IMG_TYPES).find(([, sigs]) => sigs.some((s) => s.every((b, i) => buf[i] === b)))?.[0];

export function adminRoutes({ cfg, store }) {
  const r = Router();
  const audit = (req, action, target, detail) => store.audit.insert({ at: now(), by: req.admin?.email || "system", action, target, detail: detail ?? null });

  // ---------- session
  const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, skipSuccessfulRequests: true, standardHeaders: true, legacyHeaders: false, message: { error: "RATE_LIMITED", message: "Too many sign-in attempts. Try again in 15 minutes." } });
  r.post("/login", loginLimiter, wrap(async (req, res) => {
    const { email = "", password = "" } = req.body || {};
    const admin = typeof email === "string" ? await store.admins.findBy("email", email.trim().toLowerCase()) : null;
    const fail = () => res.status(401).json({ error: "BAD_LOGIN", message: "Email or password is wrong" });
    if (!admin || !admin.active) { await checkPassword(String(password), "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi"); return fail(); }
    if (admin.lockedUntil && admin.lockedUntil > now()) return res.status(429).json({ error: "LOCKED", message: "Account temporarily locked after repeated wrong passwords. Try again later." });
    if (!(await checkPassword(String(password), admin.passwordHash))) {
      const fails = (admin.failedLogins || 0) + 1;
      await store.admins.update(admin.id, { failedLogins: fails % 5 === 0 ? 0 : fails, lockedUntil: fails % 5 === 0 ? new Date(Date.now() + 15 * 60_000).toISOString() : null });
      return fail();
    }
    await store.admins.update(admin.id, { failedLogins: 0, lockedUntil: null, lastLoginAt: now() });
    setSessionCookie(cfg, res, signSession(cfg, admin));
    res.json({ email: admin.email, name: admin.name, role: admin.role });
  }));
  r.post("/logout", (_req, res) => { res.clearCookie(COOKIE, { path: "/" }); res.status(204).end(); });

  const auth = authenticate(cfg, store);
  r.use(auth);
  r.get("/me", (req, res) => res.json({ email: req.admin.email, name: req.admin.name, role: req.admin.role }));

  r.post("/me/password", wrap(async (req, res) => {
    const { current = "", next = "" } = req.body || {};
    if (!(await checkPassword(String(current), req.admin.passwordHash))) return bad(res, "Current password is wrong");
    const problem = passwordProblem(next, req.admin.email);
    if (problem) return bad(res, problem);
    await store.admins.update(req.admin.id, { passwordHash: await hashPassword(next), tokenVersion: (req.admin.tokenVersion || 0) + 1 });
    const fresh = await store.admins.get(req.admin.id);
    setSessionCookie(cfg, res, signSession(cfg, fresh));
    await audit(req, "password.change", req.admin.email);
    res.status(204).end();
  }));

  // ---------- dashboard
  r.get("/dashboard", wrap(async (_req, res) => {
    const [products, cats, enquiries] = await Promise.all([store.products.all(), store.categories.all(), store.enquiries.all({ sort: { createdAt: -1 } })]);
    res.json({
      products: products.length, active: products.filter((p) => p.active).length, withoutPrice: products.filter((p) => p.active && p.price == null).length,
      withoutImage: products.filter((p) => !p.images.length).length, categories: cats.length,
      newEnquiries: enquiries.filter((e) => e.status === "new").length, totalEnquiries: enquiries.length, recentEnquiries: enquiries.slice(0, 5),
    });
  }));

  // ---------- categories
  r.get("/categories", wrap(async (_req, res) => {
    const [cats, prods] = await Promise.all([store.categories.all(), store.products.all()]);
    res.json(cats.sort((a, b) => a.order - b.order).map((c) => ({ ...c, products: prods.filter((p) => p.category === c.slug).length })));
  }));
  r.post("/categories", wrap(async (req, res) => {
    const p = categoryInput.safeParse(req.body); if (!p.success) return bad(res, p.error.issues[0]);
    const cats = await store.categories.all();
    const c = await store.categories.insert({ ...p.data, slug: await uniqueSlug(cats, slugify(p.data.name)) });
    await audit(req, "category.create", c.slug); res.status(201).json(c);
  }));
  r.patch("/categories/:id", wrap(async (req, res) => {
    const p = categoryInput.partial().safeParse(req.body); if (!p.success) return bad(res, p.error.issues[0]);
    const c = await store.categories.update(req.params.id, p.data); if (!c) return res.status(404).json({ error: "NOT_FOUND", message: "Category not found" });
    await audit(req, "category.update", c.slug, p.data); res.json(c);
  }));
  r.delete("/categories/:id", wrap(async (req, res) => {
    const c = await store.categories.get(req.params.id); if (!c) return res.status(404).json({ error: "NOT_FOUND", message: "Category not found" });
    if ((await store.products.all()).some((p) => p.category === c.slug)) return bad(res, "Move or delete the products in this category first", 409);
    await store.categories.remove(c.id); await audit(req, "category.delete", c.slug); res.status(204).end();
  }));

  // ---------- products
  r.get("/products", wrap(async (_req, res) => res.json((await store.products.all()).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)))));
  r.get("/products/export.csv", wrap(async (_req, res) => {
    const rows = (await store.products.all()).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((p) => ({
      sku: p.sku, name: p.name, category: p.category, collection: p.collection, pack: p.pack, price_rupees: rupees(p.price), price_unit: p.priceUnit,
      min_order: p.minOrder, active: p.active ? "yes" : "no", featured: p.featured ? "yes" : "no",
    }));
    res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="hatikvah-products.csv"' });
    res.send(toCsv(["sku", "name", "category", "collection", "pack", "price_rupees", "price_unit", "min_order", "active", "featured"], rows));
  }));

  const checkCategory = async (slug) => (await store.categories.all()).some((c) => c.slug === slug);
  const checkSku = async (sku, selfId) => !sku || !(await store.products.all()).some((p) => p.sku === sku && p.id !== selfId);

  r.post("/products", wrap(async (req, res) => {
    const p = productInput.safeParse(req.body); if (!p.success) return bad(res, p.error.issues[0]);
    if (!(await checkCategory(p.data.category))) return bad(res, "Unknown category");
    if (!(await checkSku(p.data.sku))) return bad(res, "That SKU is already used");
    const all = await store.products.all();
    const nextOrder = Math.max(0, ...all.map((x) => x.order ?? 0)) + 1;
    const sku = p.data.sku || `HC-${String(nextOrder).padStart(3, "0")}`;
    const doc = { ...p.data, sku, order: p.data.order ?? nextOrder, slug: await uniqueSlug(all, slugify(p.data.name)), createdAt: now(), updatedAt: now() };
    const row = await store.products.insert(doc);
    await audit(req, "product.create", row.sku, { name: row.name }); res.status(201).json(row);
  }));

  r.patch("/products/:id", wrap(async (req, res) => {
    const cur = await store.products.get(req.params.id); if (!cur) return res.status(404).json({ error: "NOT_FOUND", message: "Product not found" });
    const p = productPatch.safeParse(req.body); if (!p.success) return bad(res, p.error.issues[0]);
    if (p.data.category && !(await checkCategory(p.data.category))) return bad(res, "Unknown category");
    if (p.data.sku && !(await checkSku(p.data.sku, cur.id))) return bad(res, "That SKU is already used");
    const changes = {};
    for (const [k, v] of Object.entries(p.data)) if (JSON.stringify(cur[k]) !== JSON.stringify(v)) changes[k] = { from: cur[k], to: v };
    if (!Object.keys(changes).length) return res.json(cur);
    const row = await store.products.update(cur.id, { ...p.data, updatedAt: now() });
    await audit(req, "product.update", cur.sku, Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, k === "description" || k === "images" ? "changed" : v])));
    res.json(row);
  }));

  r.delete("/products/:id", wrap(async (req, res) => {
    const cur = await store.products.get(req.params.id); if (!cur) return res.status(404).json({ error: "NOT_FOUND", message: "Product not found" });
    await store.products.remove(cur.id); await audit(req, "product.delete", cur.sku, { name: cur.name }); res.status(204).end();
  }));

  // Bulk update from a spreadsheet: only prices, price unit, minimum order, pack, active and featured can change this way.
  r.post("/products/import", express.json({ limit: "2mb" }), wrap(async (req, res) => {
    const { csv = "", dryRun = false } = req.body || {};
    if (typeof csv !== "string" || !csv.trim()) return bad(res, "Paste or upload a CSV file");
    const rows = parseCsv(csv);
    if (rows.length > 3000) return bad(res, "Too many rows (max 3000)");
    if (!rows.length || !("sku" in rows[0])) return bad(res, 'The first row must have column names including "sku"');
    const products = await store.products.all();
    const changes = [], errors = [];
    rows.forEach((row, i) => {
      const line = i + 2, p = products.find((x) => x.sku === row.sku);
      if (!p) { errors.push({ line, error: `Unknown SKU "${row.sku}"` }); return; }
      const patch = {};
      if ("price_rupees" in row) { const v = toPaise(row.price_rupees); if (Number.isNaN(v)) { errors.push({ line, error: `Bad price "${row.price_rupees}"` }); return; } patch.price = v; }
      if ("price_unit" in row) patch.priceUnit = row.price_unit.slice(0, 40);
      if ("min_order" in row) patch.minOrder = row.min_order.slice(0, 60);
      if ("pack" in row) patch.pack = row.pack.slice(0, 120);
      if ("active" in row && row.active) patch.active = /^(yes|y|true|1)$/i.test(row.active);
      if ("featured" in row && row.featured) patch.featured = /^(yes|y|true|1)$/i.test(row.featured);
      const diff = Object.fromEntries(Object.entries(patch).filter(([k, v]) => JSON.stringify(p[k]) !== JSON.stringify(v)));
      if (Object.keys(diff).length) changes.push({ line, id: p.id, sku: p.sku, name: p.name, diff });
    });
    if (!dryRun) {
      for (const c of changes) await store.products.update(c.id, { ...c.diff, updatedAt: now() });
      if (changes.length) await audit(req, "product.import", "csv", { updated: changes.length, errors: errors.length });
    }
    res.json({ dryRun: !!dryRun, updated: changes.length, errors: errors.slice(0, 100), errorCount: errors.length, preview: changes.slice(0, 50).map(({ sku, name, diff }) => ({ sku, name, diff })) });
  }));

  // ---------- images (raw body, type checked by file signature, not by what the browser claims)
  r.post("/media", express.raw({ type: () => true, limit: "2mb" }), wrap(async (req, res) => {
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length < 100) return bad(res, "No image received");
    const type = sniff(buf);
    if (!type) return bad(res, "Only JPG, PNG or WebP images are allowed");
    const id = await store.saveMedia(buf, type);
    await audit(req, "media.upload", id, { bytes: buf.length });
    res.status(201).json({ url: `/media/${id}` });
  }));

  // ---------- enquiries
  r.get("/enquiries", wrap(async (req, res) => {
    let rows = await store.enquiries.all({ sort: { createdAt: -1 } });
    if (req.query.status) rows = rows.filter((e) => e.status === req.query.status);
    res.json(rows);
  }));
  r.get("/enquiries/export.csv", wrap(async (_req, res) => {
    const rows = (await store.enquiries.all({ sort: { createdAt: -1 } })).map((e) => ({
      ref: e.ref, date: e.createdAt, status: e.status, name: e.name, company: e.company, phone: e.phone, email: e.email,
      items: e.items.map((i) => `${i.qty} x ${i.name}`).join("; "), message: e.message, notes: e.notes,
    }));
    res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="hatikvah-enquiries.csv"' });
    res.send(toCsv(["ref", "date", "status", "name", "company", "phone", "email", "items", "message", "notes"], rows));
  }));
  const enquiryPatch = z.object({ status: z.enum(["new", "contacted", "quoted", "won", "closed"]).optional(), notes: z.string().max(2000).optional() }).strict();
  r.patch("/enquiries/:id", wrap(async (req, res) => {
    const p = enquiryPatch.safeParse(req.body); if (!p.success) return bad(res, p.error.issues[0]);
    const e = await store.enquiries.update(req.params.id, p.data); if (!e) return res.status(404).json({ error: "NOT_FOUND", message: "Enquiry not found" });
    await audit(req, "enquiry.update", e.ref, p.data); res.json(e);
  }));
  r.delete("/enquiries/:id", requireOwner, wrap(async (req, res) => {
    const e = await store.enquiries.get(req.params.id); if (!e) return res.status(404).json({ error: "NOT_FOUND", message: "Enquiry not found" });
    await store.enquiries.remove(e.id); await audit(req, "enquiry.delete", e.ref); res.status(204).end();
  }));

  // ---------- settings
  r.get("/settings", wrap(async (_req, res) => { const { id, key, ...s } = (await store.settings.findBy("key", "company")) || {}; res.json(s); }));
  r.put("/settings", requireOwner, wrap(async (req, res) => {
    const p = settingsInput.safeParse(req.body); if (!p.success) return bad(res, p.error.issues[0]);
    const cur = await store.settings.findBy("key", "company");
    await store.settings.update(cur.id, p.data); await audit(req, "settings.update", "company", { showPrices: p.data.showPrices });
    res.json(p.data);
  }));

  // ---------- team (owner only)
  const view = ({ id, email, name, role, active, lastLoginAt, createdAt }) => ({ id, email, name, role, active, lastLoginAt, createdAt });
  r.get("/users", requireOwner, wrap(async (_req, res) => res.json((await store.admins.all()).map(view))));
  const userInput = z.object({ email: z.string().trim().toLowerCase().email().max(160), name: z.string().trim().min(2).max(80), role: z.enum(["owner", "staff"]).default("staff"), password: z.string() }).strict();
  r.post("/users", requireOwner, wrap(async (req, res) => {
    const p = userInput.safeParse(req.body); if (!p.success) return bad(res, p.error.issues[0]);
    const problem = passwordProblem(p.data.password, p.data.email); if (problem) return bad(res, problem);
    if (await store.admins.findBy("email", p.data.email)) return bad(res, "A user with this email already exists", 409);
    const { password, ...rest } = p.data;
    const u = await store.admins.insert({ ...rest, passwordHash: await hashPassword(password), active: true, tokenVersion: 0, createdAt: now() });
    await audit(req, "user.create", u.email, { role: u.role }); res.status(201).json(view(u));
  }));
  const userPatch = z.object({ active: z.boolean().optional(), role: z.enum(["owner", "staff"]).optional(), password: z.string().optional() }).strict();
  r.patch("/users/:id", requireOwner, wrap(async (req, res) => {
    const p = userPatch.safeParse(req.body); if (!p.success) return bad(res, p.error.issues[0]);
    const u = await store.admins.get(req.params.id); if (!u) return res.status(404).json({ error: "NOT_FOUND", message: "User not found" });
    if (u.id === req.admin.id && (p.data.active === false || (p.data.role && p.data.role !== "owner"))) return bad(res, "You cannot lock yourself out");
    const patch = {};
    if (p.data.active !== undefined) patch.active = p.data.active;
    if (p.data.role) patch.role = p.data.role;
    if (p.data.password) { const pr = passwordProblem(p.data.password, u.email); if (pr) return bad(res, pr); patch.passwordHash = await hashPassword(p.data.password); }
    patch.tokenVersion = (u.tokenVersion || 0) + 1; // ends that person's current sessions
    await store.admins.update(u.id, patch); await audit(req, "user.update", u.email, { ...p.data, password: p.data.password ? "reset" : undefined });
    res.json(view(await store.admins.get(u.id)));
  }));

  r.get("/audit", requireOwner, wrap(async (_req, res) => res.json(await store.audit.all({ sort: { at: -1 }, limit: 300 }))));
  return r;
}
