import { Router } from "express";
import { nextNumber } from "../lib/gst.js";
import { requirePerm } from "../lib/permissions.js";
import { batchLevels, bucketOf, isLow, logActivity, moveStock, now, stockBuckets, token } from "../lib/sales.js";
import { measureLabel } from "../lib/units.js";
import { purchaseInput, receiveInput, stockAdjustInput, supplierInput } from "../schemas.js";
import { wrap as plainWrap } from "./public.js";
import { atomicWrap } from "./atomic.js";
import { bad, notFound, parse } from "./shared.js";

/**
 * Stock levels (from a ledger of movements, in pieces), suppliers, purchase orders and goods received.
 * Each product has physical stock, reserved stock (in open sales orders) and available = physical - reserved.
 */
export function stockRoutes({ store, audit }) {
  const r = Router();
  const wrap = fn => atomicWrap(store, fn);
  r.use(["/stock", "/suppliers", "/purchases"], requirePerm("stock"));
  const by = (req) => req.admin.email;

  r.get("/stock", wrap(async (_req, res) => {
    const [b, products, purchases] = await Promise.all([stockBuckets(store), store.products.all({ sort: { order: 1 } }), store.purchases.all()]);
    const onOrder = {};
    for (const po of purchases.filter((p) => ["sent", "partial"].includes(p.status))) for (const it of po.items) onOrder[it.productId] = (onOrder[it.productId] || 0) + Math.max(0, it.qty - (it.received || 0));
    res.json(products.map((p) => { const x = bucketOf(b, p.id); return { id: p.id, sku: p.sku, name: p.name, pack: p.pack || measureLabel(p.measure), unit: p.unit || "pcs", category: p.category, stockTracked: !!p.stockTracked,
      qty: x.physical, physical: x.physical, reserved: x.reserved, available: x.available, batchTracked: !!p.batchTracked, packaging: p.packaging || null,
      reorderLevel: p.reorderLevel || 0, reorderQty: p.reorderQty || 0, supplierId: p.supplierId || "", costPrice: p.costPrice ?? null, onOrder: onOrder[p.id] || 0, low: isLow(p, b) }; }));
  }));
  // Batch stock with expiry (FEFO), soonest expiry first. ?days=60 lists only batches expiring within 60 days (or already expired).
  r.get("/stock/batches", wrap(async (req, res) => {
    const [moves, products] = await Promise.all([store.stockMoves.all(), store.products.all()]);
    const names = Object.fromEntries(products.map((p) => [p.id, { name: p.name, sku: p.sku }]));
    const id = String(req.query.productId || ""), days = req.query.days != null ? Number(req.query.days) : null;
    res.json(batchLevels(moves).filter((x) => (!id || x.productId === id) && (days == null || (x.daysToExpiry != null && x.daysToExpiry <= days))).map((x) => ({ ...x, ...names[x.productId] })));
  }));
  r.get("/stock/moves", wrap(async (req, res) => {
    const id = String(req.query.productId || "");
    res.json((await store.stockMoves.all({ sort: { at: -1 } })).filter((m) => !id || m.productId === id).slice(0, 500));
  }));
  r.post("/stock/adjust", wrap(async (req, res) => {
    const d = parse(stockAdjustInput, req.body, res); if (!d) return;
    const p = await store.products.get(d.productId); if (!p) return notFound(res, "Product");
    const qty = d.kind === "out" ? -Math.abs(d.qty) : d.kind === "in" ? Math.abs(d.qty) : d.qty;
    if (p.batchTracked && qty > 0 && !d.batch) return bad(res, `${p.name} is batch tracked: enter the batch number and expiry`);
    if (!p.stockTracked) await store.products.update(p.id, { stockTracked: true });
    const m = await moveStock(store, { productId: p.id, sku: p.sku, qty, kind: d.kind, note: d.note, ref: "manual", by: by(req), batch: d.batch || null });
    await audit(req, "stock.adjust", p.sku, { qty, note: d.note }); res.status(201).json(m);
  }));
  r.patch("/stock/:productId", wrap(async (req, res) => {
    const p = await store.products.get(req.params.productId); if (!p) return notFound(res, "Product");
    const allow = ["stockTracked", "batchTracked", "reorderLevel", "reorderQty", "supplierId", "costPrice"], patch = {};
    for (const k of allow) if (k in (req.body || {})) patch[k] = req.body[k];
    for (const k of ["stockTracked", "batchTracked"]) if (k in patch && typeof patch[k] !== "boolean") return bad(res, `${k} must be true or false`);
    for (const k of ["reorderLevel", "reorderQty"]) if (k in patch && !(Number.isFinite(patch[k]) && patch[k] >= 0 && patch[k] <= 10_000_000)) return bad(res, `${k} must be a number`);
    if ("costPrice" in patch && patch.costPrice !== null && !(Number.isInteger(patch.costPrice) && patch.costPrice >= 0)) return bad(res, "costPrice must be paise or null");
    if ("supplierId" in patch && patch.supplierId && !(await store.suppliers.get(String(patch.supplierId)))) return bad(res, "Unknown supplier");
    const upd = await store.products.update(p.id, { ...patch, updatedAt: now() });
    await audit(req, "stock.settings", p.sku, patch); res.json(upd);
  }));

  // ---------- suppliers
  r.get("/suppliers", wrap(async (_req, res) => res.json(await store.suppliers.all({ sort: { name: 1 } }))));
  r.post("/suppliers", wrap(async (req, res) => {
    const d = parse(supplierInput, req.body, res); if (!d) return;
    const s = await store.suppliers.insert({ ...d, createdAt: now() }); await audit(req, "supplier.create", s.name); res.status(201).json(s);
  }));
  r.patch("/suppliers/:id", wrap(async (req, res) => {
    const d = parse(supplierInput.partial().strict(), req.body, res); if (!d) return;
    const s = await store.suppliers.update(req.params.id, d); if (!s) return notFound(res, "Supplier");
    await audit(req, "supplier.update", s.name); res.json(s);
  }));
  r.delete("/suppliers/:id", wrap(async (req, res) => {
    const s = await store.suppliers.get(req.params.id); if (!s) return notFound(res, "Supplier");
    if ((await store.purchases.all()).some((p) => p.supplierId === s.id)) return bad(res, "This supplier has purchase orders, so it cannot be deleted", 409);
    await store.suppliers.remove(s.id); await audit(req, "supplier.delete", s.name); res.status(204).end();
  }));

  // ---------- purchase orders
  async function build(d, res) {
    const sup = await store.suppliers.get(d.supplierId); if (!sup) { notFound(res, "Supplier"); return null; }
    const items = [];
    for (const it of d.items) {
      const p = await store.products.get(it.productId); if (!p) { bad(res, "A product in this purchase order no longer exists"); return null; }
      if (d.receiveNow && p.batchTracked) { bad(res, `${p.name} requires receiving with batch details`); return null; }
      items.push({ productId: p.id, sku: p.sku, name: p.name, unit: p.unit || "pcs", qty: it.qty, rate: it.rate || p.costPrice || 0, received: d.receiveNow ? it.qty : 0 });
    }
    return { supplierId: sup.id, supplierName: sup.name, items, total: items.reduce((n, i) => n + Math.round(i.qty * i.rate), 0), expectedDate: d.expectedDate, notes: d.notes, billNumber: d.billNumber || "" };
  }
  r.get("/purchases", wrap(async (_req, res) => res.json(await store.purchases.all({ sort: { createdAt: -1 } }))));
  r.get("/purchases/:id", wrap(async (req, res) => {
    const p = await store.purchases.get(req.params.id); if (!p) return notFound(res, "Purchase order");
    res.json({ ...p, activities: (await store.activities.all({ sort: { at: -1 } })).filter((a) => a.entityId === p.id) });
  }));
  r.post("/purchases", wrap(async (req, res) => {
    const d = parse(purchaseInput, req.body, res); if (!d) return;
    const b = await build(d, res); if (!b) return;
    const poNumber = await nextNumber(store, "PO");
    const status = d.receiveNow ? "received" : "draft";
    const po = await store.purchases.insert({
      ...b, number: poNumber, token: token(), status, receivedAt: d.receiveNow ? now() : null, createdBy: by(req), createdAt: now(), updatedAt: now(),
    });
    if (d.receiveNow) {
      for (const it of b.items) {
        const p = await store.products.get(it.productId);
        if (p && !p.stockTracked) await store.products.update(p.id, { stockTracked: true });
        await moveStock(store, { productId: it.productId, sku: it.sku, qty: it.qty, kind: "in", ref: po.number, note: `Purchased / Inward bill ${b.billNumber || po.number}`, by: by(req) });
      }
      await logActivity(store, { entity: "purchase", entityId: po.id, text: `Goods received & stock auto-incremented (+${b.items.reduce((n, i) => n + i.qty, 0)})`, by: by(req) });
    }
    await audit(req, "purchase.create", po.number); res.status(201).json(po);
  }));
  r.put("/purchases/:id", wrap(async (req, res) => {
    const po = await store.purchases.get(req.params.id); if (!po) return notFound(res, "Purchase order");
    if (po.status !== "draft") return bad(res, "Only draft purchase orders can be edited", 409);
    if (req.body?.receiveNow) return bad(res, "Receive goods through the receiving action, not purchase editing", 409);
    const d = parse(purchaseInput, req.body, res); if (!d) return;
    const b = await build(d, res); if (!b) return;
    const upd = await store.purchases.update(po.id, { ...b, updatedAt: now() }); await audit(req, "purchase.update", po.number); res.json(upd);
  }));
  r.post("/purchases/from-low-stock", wrap(async (req, res) => {
    const b = await stockBuckets(store), lv = Object.fromEntries(Object.entries(b).map(([id, x]) => [id, x.available])), groups = {}, skipped = [];
    const open = new Set((await store.purchases.all()).filter((p) => ["draft", "sent", "partial"].includes(p.status)).flatMap((p) => p.items.map((i) => i.productId)));
    for (const p of await store.products.all()) {
      if (!p.stockTracked || (lv[p.id] || 0) > (p.reorderLevel || 0) || open.has(p.id)) continue;
      if (!p.supplierId) { skipped.push(p.sku); continue; }
      (groups[p.supplierId] ||= []).push({ productId: p.id, qty: p.reorderQty || Math.max(1, (p.reorderLevel || 0) * 2 - (lv[p.id] || 0)), rate: p.costPrice || 0 });
    }
    const made = [];
    for (const [supplierId, items] of Object.entries(groups)) {
      const b = await build({ supplierId, items, expectedDate: "", notes: "Created from low stock" }, res); if (!b) return;
      made.push(await store.purchases.insert({ ...b, number: await nextNumber(store, "PO"), token: token(), status: "draft", createdBy: by(req), createdAt: now(), updatedAt: now() }));
    }
    if (made.length) await audit(req, "purchase.auto", made.map((m) => m.number).join(", "));
    res.json({ created: made, skippedNoSupplier: skipped });
  }));
  r.post("/purchases/:id/status", wrap(async (req, res) => {
    const po = await store.purchases.get(req.params.id); if (!po) return notFound(res, "Purchase order");
    const status = req.body?.status, allowed = { draft: ["sent", "cancelled"], sent: ["cancelled"], partial: [] };
    if (!(allowed[po.status] || []).includes(status)) return bad(res, `A ${po.status} purchase order cannot become ${status}`, 409);
    const upd = await store.purchases.update(po.id, { status, [status + "At"]: now(), updatedAt: now() });
    await logActivity(store, { entity: "purchase", entityId: po.id, text: `Marked ${status}`, by: by(req) });
    await audit(req, "purchase." + status, po.number); res.json(upd);
  }));
  r.post("/purchases/:id/receive-all", wrap(async (req, res) => {
    const po = await store.purchases.get(req.params.id); if (!po) return notFound(res, "Purchase order");
    if (!["draft", "sent", "partial"].includes(po.status)) return bad(res, `A ${po.status} purchase order cannot be received`, 409);
    for (const it of po.items) {
      const p = await store.products.get(it.productId);
      if (!p) return bad(res, "A product on this purchase order no longer exists");
      if (p.batchTracked && it.qty > (it.received || 0)) return bad(res, `${p.name} is batch tracked: receive it with batch details`);
    }
    const billNumber = req.body?.billNumber || po.billNumber || "";
    const items = po.items.map((i) => ({ ...i }));
    for (const it of items) {
      const remaining = Math.max(0, it.qty - (it.received || 0));
      if (remaining > 0) {
        it.received = it.qty;
        const p = await store.products.get(it.productId);
        if (p && !p.stockTracked) await store.products.update(p.id, { stockTracked: true });
        await moveStock(store, {
          productId: it.productId, sku: it.sku, qty: remaining, kind: "in", ref: po.number,
          note: `Received to stock${billNumber ? ` (Bill #${billNumber})` : ""}`, by: by(req),
        });
      }
    }
    const upd = await store.purchases.update(po.id, { items, status: "received", billNumber, receivedAt: now(), updatedAt: now() });
    await logActivity(store, { entity: "purchase", entityId: po.id, text: "Received all items into stock (Auto +)", by: by(req) });
    await audit(req, "purchase.receive_all", po.number);
    res.json(upd);
  }));
  r.post("/purchases/:id/receive", wrap(async (req, res) => {
    const po = await store.purchases.get(req.params.id); if (!po) return notFound(res, "Purchase order");
    if (!["sent", "partial", "draft"].includes(po.status)) return bad(res, `A ${po.status} purchase order cannot be received`, 409);
    const d = parse(receiveInput, req.body, res); if (!d) return;
    const items = po.items.map((i) => ({ ...i }));
    const received = new Map();
    for (const l of d.lines) { // validate all lines and aggregate repeats before any stock moves
      const it = items.find((i) => i.productId === l.productId);
      if (!it) return bad(res, "That product is not on this purchase order");
      const qty = (received.get(l.productId) || 0) + l.qty;
      if (qty > it.qty - (it.received || 0)) return bad(res, "Cannot receive more than the remaining purchase quantity");
      received.set(l.productId, qty);
      const p = await store.products.get(l.productId);
      if (!p) return bad(res, "A product on this purchase order no longer exists");
      if (p?.batchTracked && !l.batch) return bad(res, `${p.name} is batch tracked: enter the batch number and expiry`);
    }
    for (const l of d.lines) {
      const it = items.find((i) => i.productId === l.productId); if (!it) return bad(res, "That product is not on this purchase order");
      it.received = (it.received || 0) + l.qty;
      const p = await store.products.get(it.productId);
      if (p && !p.stockTracked) await store.products.update(p.id, { stockTracked: true });
      await moveStock(store, { productId: it.productId, sku: it.sku, qty: l.qty, kind: "in", ref: po.number, note: "Goods received", by: by(req), batch: l.batch || null });
    }
    const full = items.every((i) => (i.received || 0) >= i.qty);
    const upd = await store.purchases.update(po.id, { items, status: full ? "received" : "partial", ...(full ? { receivedAt: now() } : {}), updatedAt: now() });
    await logActivity(store, { entity: "purchase", entityId: po.id, text: `Goods received: ${d.lines.map((l) => `${l.qty} x ${items.find((i) => i.productId === l.productId).name}`).join(", ")}`, by: by(req) });
    await audit(req, "purchase.receive", po.number, { lines: d.lines.length }); res.json(upd);
  }));
  return r;
}
