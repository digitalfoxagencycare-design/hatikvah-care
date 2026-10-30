import express, { Router } from "express";
import crypto from "node:crypto";
import { requirePerm } from "../lib/permissions.js";
import { logActivity, now } from "../lib/sales.js";
import { getSettings } from "../model.js";
import { shipmentInput } from "../schemas.js";
import { checkServiceability, createPickup, parseWebhook, pincodeOf, shadowfaxOn, webhookAuthorised } from "../services/delivery_shadowfax.js";
import { createPorterPickup, parsePorterWebhook, porterOn, porterWebhookAuthorised } from "../services/delivery_porter.js";
import { wrap } from "./public.js";
import { bad, notFound, parse } from "./shared.js";
import { atomicWrap } from "./atomic.js";

const COURIERS = {
  shadowfax: { label: "Shadowfax", on: shadowfaxOn, book: createPickup, env: "SHADOWFAX_API_TOKEN" },
  porter: { label: "Porter", on: porterOn, book: createPorterPickup, env: "PORTER_API_KEY and PORTER_BASE_URL" },
};
const shipmentLive = (o) => !!o.shipment && !["cancelled", "returned"].includes(o.shipment.status);

/** Books a courier pickup for a dispatched order and keeps the AWB / tracking link on it. Shared by dispatch and the Book Courier Pickup modal. */
export async function bookShipment({ cfg, store, fetchImpl }, order, d, by) {
  const courier = COURIERS[d.provider || "shadowfax"];
  const company = await getSettings(store);
  const pickupPincode = d.pickupPincode || cfg.sfxPickupPincode || pincodeOf(company.address);
  const dropPincode = d.dropPincode || pincodeOf(order.customer.shippingAddress || order.customer.billingAddress);
  if (!/^\d{6}$/.test(pickupPincode) || !/^\d{6}$/.test(dropPincode)) throw Object.assign(new Error(`Pickup and delivery PIN codes are needed for ${courier.label}`), { userError: true, status: 400 });
  const pickupSlot = d.pickupDate ? { date: d.pickupDate, window: d.pickupWindow } : null, weightKg = d.weightKg || 1, packages = d.packages || 1;
  const claim=crypto.randomUUID();
  order=await store.atomic(async()=>{
    const fresh=await store.orders.get(order.id);
    if(!fresh || fresh.status!=='dispatched' || ['pending','reconcile'].includes(fresh.shipmentBooking?.status) || shipmentLive(fresh))throw Object.assign(new Error('Pickup already exists or needs provider reconciliation'),{userError:true,status:409});
    return store.orders.update(fresh.id,{shipmentBooking:{claim,status:'pending',at:now()}});
  });
  let shipment;
  try {
    shipment=await courier.book(cfg, { order, company, pickupPincode, dropPincode, weightKg, packages, pickupSlot, dropLat: d.dropLat, dropLng: d.dropLng }, fetchImpl ? { fetchImpl } : {});
    if(!shipment.awb&&!shipment.sfxOrderId)throw new Error('Provider did not return a booking identity');
  } catch(e) {
    await store.orders.update(order.id,{shipmentBooking:{claim,status:e.status>=400&&e.status<500&&!([408,429].includes(e.status))?'failed':'reconcile',at:now(),reason:'Confirm provider booking outcome before retry'}});throw e;
  }
  const upd = await store.orders.update(order.id, { shipment: { ...shipment, weightKg, packages, pickupSlot }, shipmentBooking:{claim,status:'booked',at:now()}, dispatch: { ...(order.dispatch || {}), transporter: courier.label, trackingNo: shipment.awb || order.dispatch?.trackingNo || "" }, updatedAt: now() });
  await logActivity(store, { entity: "order", entityId: order.id, text: `${courier.label} pickup booked${shipment.awb ? ` (AWB ${shipment.awb})` : ""}${pickupSlot ? ` for ${pickupSlot.date} ${pickupSlot.window}` : ""}`, by });
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
    const d = parse(shipmentInput, req.body || {}, res); if (!d) return;
    const courier = COURIERS[d.provider];
    if (!courier.on(cfg)) return bad(res, `${courier.label} is not connected (${courier.env})`, 409);
    if (d.provider === "porter" && !(Number.isFinite(cfg.porterPickupLat) && Number.isFinite(cfg.porterPickupLng))) return bad(res, "Set PORTER_PICKUP_LAT and PORTER_PICKUP_LNG to the shop's location", 409);
    const o = await store.orders.get(req.params.id); if (!o) return notFound(res, "Order");
    if (o.status !== "dispatched") return bad(res, "Dispatch the order (delivery challan) before booking the pickup", 409);
    if (shipmentLive(o)) return bad(res, "A pickup is already booked for this order", 409);
    try { const upd = await bookShipment({ cfg, store, fetchImpl }, o, d, req.admin.email); await audit(req, "order.shipment", o.number, { provider: d.provider, awb: upd.shipment.awb }); res.json(upd); }
    catch (e) { if (e.userError) throw e; bad(res, `${courier.label}: ${e.message}`, 502); }
  }));
  return r;
}

/** Courier status callbacks: POST /api/webhooks/shadowfax (header X-Shadowfax-Token) and /api/webhooks/porter (header X-Porter-Token). */
export function logisticsWebhook({ cfg, store, automation, log = console }) {
  const r = Router();
  const hook = (provider, authorised, parseEvent) => atomicWrap(store, async (req, res) => {
    if (!authorised(req)) return res.status(401).json({ error: "UNAUTHORIZED" });
    const ev = parseEvent(req.body);
    const orders = await store.orders.all();
    const o = orders.find((x) => x.shipment && (x.shipment.provider || "shadowfax") === provider && ((ev.awb && x.shipment.awb === ev.awb) || (ev.clientOrderId && (x.challanNumber === ev.clientOrderId || x.number === ev.clientOrderId))));
    if (!o) return res.json({ ok: true, ignored: "unknown shipment" });
    if(ev.awb && o.shipment.awb && ev.awb!==o.shipment.awb)return res.status(400).json({error:'SHIPMENT_IDENTITY_MISMATCH'});
    const rank = { created: 0, assigned: 1, picked: 2, in_transit: 3, out_for_delivery: 4, delivered: 5 };
    const current = o.shipment.status;
    if (["returned", "cancelled"].includes(current) ||
        (current === "delivered" && ev.status !== "returned") ||
        (ev.status in rank && current in rank && rank[ev.status] < rank[current])) {
      return res.json({ ok: true, ignored: "stale shipment status" });
    }
    const repeat = o.shipment.history?.some((h) => h.status === ev.status);
    const newRider = (ev.riderName && ev.riderName !== o.shipment.riderName) || (ev.riderPhone && ev.riderPhone !== o.shipment.riderPhone); // rider details can follow the assignment, or the rider can change
    if (repeat && !newRider) return res.json({ ok: true, duplicate: true });
    const shipment = { ...o.shipment, status: ev.status, rawStatus: ev.rawStatus, riderName: ev.riderName || o.shipment.riderName, riderPhone: ev.riderPhone || o.shipment.riderPhone,
      trackingUrl: ev.trackingUrl || o.shipment.trackingUrl, history: repeat ? o.shipment.history : [...(o.shipment.history || []), { status: ev.status, raw: ev.rawStatus, at: ev.at }].slice(-30) };
    const upd = await store.orders.update(o.id, { shipment, ...(ev.status === "delivered" && o.status === "dispatched" ? { status: "delivered", deliveredAt: now() } : {}), updatedAt: now() });
    await logActivity(store, { entity: "order", entityId: o.id, text: `${COURIERS[provider].label}: ${ev.rawStatus || ev.status}${ev.riderName ? ` (rider ${ev.riderName})` : ""}`, by: provider });
    if (!repeat) try { await automation.on.shipmentUpdate(upd, ev.status); } catch (e) { log.error?.("shipment message failed", e); }
    res.json({ ok: true });
  });
  r.post("/api/webhooks/shadowfax", express.json({ limit: "100kb" }), hook("shadowfax", (req) => webhookAuthorised(cfg, req.get("x-shadowfax-token")), parseWebhook));
  r.post("/api/webhooks/porter", express.json({ limit: "100kb" }), hook("porter", (req) => porterWebhookAuthorised(cfg, req.get("x-porter-token")), parsePorterWebhook));
  return r;
}
