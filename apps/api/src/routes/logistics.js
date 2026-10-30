import express, { Router } from "express";
import { requirePerm } from "../lib/permissions.js";
import { logActivity, now } from "../lib/sales.js";
import { getSettings } from "../model.js";
import { shipmentInput } from "../schemas.js";
import { checkServiceability, createPickup, parseWebhook, pincodeOf, shadowfaxOn, webhookAuthorised } from "../services/delivery_shadowfax.js";
import { wrap } from "./public.js";
import { bad, notFound, parse } from "./shared.js";

/** Books a Shadowfax pickup for a dispatched order and keeps the AWB / tracking link on it. Shared by dispatch and the retry button. */
export async function bookShipment({ cfg, store, fetchImpl }, order, d, by) {
  const company = await getSettings(store);
  const pickupPincode = d.pickupPincode || cfg.sfxPickupPincode || pincodeOf(company.address);
  const dropPincode = d.dropPincode || pincodeOf(order.customer.shippingAddress || order.customer.billingAddress);
  if (!/^\d{6}$/.test(pickupPincode) || !/^\d{6}$/.test(dropPincode)) throw Object.assign(new Error("Pickup and delivery PIN codes are needed for Shadowfax"), { userError: true, status: 400 });
  const shipment = await createPickup(cfg, { order, company, pickupPincode, dropPincode, weightKg: d.weightKg || 1, packages: d.packages || 1 }, fetchImpl ? { fetchImpl } : {});
  const upd = await store.orders.update(order.id, { shipment, dispatch: { ...(order.dispatch || {}), transporter: order.dispatch?.transporter || "Shadowfax", trackingNo: shipment.awb || order.dispatch?.trackingNo || "" }, updatedAt: now() });
  await logActivity(store, { entity: "order", entityId: order.id, text: `Shadowfax pickup booked${shipment.awb ? ` (AWB ${shipment.awb})` : ""}`, by });
  return upd;
}

export function logisticsRoutes({ cfg, store, audit, fetchImpl }) {
  const r = Router();
  r.use("/logistics", requirePerm("orders", "stock"));
  r.get("/logistics/serviceability", wrap(async (req, res) => {
    if (!shadowfaxOn(cfg)) return bad(res, "Shadowfax is not connected (SHADOWFAX_API_TOKEN)", 409);
    const drop = String(req.query.pincode || ""), pickup = String(req.query.pickup || cfg.sfxPickupPincode || pincodeOf((await getSettings(store)).address));
    if (!/^\d{6}$/.test(drop) || !/^\d{6}$/.test(pickup)) return bad(res, "PIN code is 6 digits");
    try { res.json({ pickup, drop, ...(await checkServiceability(cfg, { pickup, drop }, fetchImpl ? { fetchImpl } : {})), raw: undefined }); } catch (e) { bad(res, e.message, 502); }
  }));
  r.post("/orders/:id/shipment", requirePerm("orders"), wrap(async (req, res) => {
    if (!shadowfaxOn(cfg)) return bad(res, "Shadowfax is not connected (SHADOWFAX_API_TOKEN)", 409);
    const o = await store.orders.get(req.params.id); if (!o) return notFound(res, "Order");
    if (o.status !== "dispatched") return bad(res, "Dispatch the order (delivery challan) before booking the pickup", 409);
    if (o.shipment?.awb && !["cancelled", "returned"].includes(o.shipment.status)) return bad(res, "A pickup is already booked for this order", 409);
    const d = parse(shipmentInput.partial({ dropPincode: true }), req.body || {}, res); if (!d) return;
    try { const upd = await bookShipment({ cfg, store, fetchImpl }, o, d, req.admin.email); await audit(req, "order.shipment", o.number, { awb: upd.shipment.awb }); res.json(upd); }
    catch (e) { if (e.userError) throw e; bad(res, `Shadowfax: ${e.message}`, 502); }
  }));
  return r;
}

/** Shadowfax status callbacks: POST /api/webhooks/shadowfax with header X-Shadowfax-Token. */
export function logisticsWebhook({ cfg, store, automation, log = console }) {
  const r = Router();
  r.post("/api/webhooks/shadowfax", express.json({ limit: "100kb" }), wrap(async (req, res) => {
    if (!webhookAuthorised(cfg, req.get("x-shadowfax-token"))) return res.status(401).json({ error: "UNAUTHORIZED" });
    const ev = parseWebhook(req.body);
    const orders = await store.orders.all();
    const o = orders.find((x) => x.shipment && ((ev.awb && x.shipment.awb === ev.awb) || (ev.clientOrderId && (x.challanNumber === ev.clientOrderId || x.number === ev.clientOrderId))));
    if (!o) return res.json({ ok: true, ignored: "unknown shipment" });
    if (o.shipment.history?.some((h) => h.status === ev.status)) return res.json({ ok: true, duplicate: true });
    const shipment = { ...o.shipment, status: ev.status, rawStatus: ev.rawStatus, riderName: ev.riderName || o.shipment.riderName, riderPhone: ev.riderPhone || o.shipment.riderPhone,
      trackingUrl: ev.trackingUrl || o.shipment.trackingUrl, history: [...(o.shipment.history || []), { status: ev.status, raw: ev.rawStatus, at: ev.at }].slice(-30) };
    const upd = await store.orders.update(o.id, { shipment, ...(ev.status === "delivered" && o.status === "dispatched" ? { status: "delivered", deliveredAt: now() } : {}), updatedAt: now() });
    await logActivity(store, { entity: "order", entityId: o.id, text: `Shadowfax: ${ev.rawStatus || ev.status}${ev.riderName ? ` (rider ${ev.riderName})` : ""}`, by: "shadowfax" });
    try { await automation.on.shipmentUpdate(upd, ev.status); } catch (e) { log.error?.("shipment message failed", e); }
    res.json({ ok: true });
  }));
  return r;
}
