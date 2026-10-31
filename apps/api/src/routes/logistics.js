import express, { Router } from "express";
import crypto from "node:crypto";
import { requirePerm } from "../lib/permissions.js";
import { dispatchOrder, logActivity, now, userError } from "../lib/sales.js";
import { pieces } from "../lib/units.js";
import { getSettings } from "../model.js";
import { shipmentChargeInput, shipmentInput } from "../schemas.js";
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

/** Rough parcel weight for the booking form: product weight or volume (liquids taken as 1 g per ml), 200 g a piece when the product has neither. Staff can correct it. */
export function estimateWeightKg(items, productsById) {
  let grams = 0;
  for (const it of items) {
    const m = productsById[it.productId]?.measure;
    grams += pieces(it) * (m?.domain === "weight" ? m.value * (m.unit === "kg" ? 1000 : 1) : m?.domain === "volume" ? m.value * (m.unit === "l" ? 1000 : 1) : 200);
  }
  return Math.min(1000, Math.max(0.5, Math.ceil(grams / 100) / 10));
}

/** The delivery details a booking needs, with what staff typed over the customer's record. Checked before a challan is raised, so a missing PIN costs nothing. */
function deliveryFor(cfg, company, order, d, label) {
  const customer = { ...order.customer, ...(d.dropName ? { contactName: d.dropName } : {}), ...(d.dropPhone ? { phone: d.dropPhone } : {}), ...(d.dropAddress ? { shippingAddress: d.dropAddress } : {}) };
  const pickupPincode = d.pickupPincode || cfg.sfxPickupPincode || pincodeOf(company.address);
  const dropPincode = d.dropPincode || pincodeOf(customer.shippingAddress || customer.billingAddress);
  if (!/^\d{6}$/.test(pickupPincode) || !/^\d{6}$/.test(dropPincode)) throw userError(`Pickup and delivery PIN codes are needed for ${label}`);
  if (String(customer.phone || "").replace(/\D/g, "").length < 10) throw userError(`${label} needs the delivery phone number`);
  if (!(customer.shippingAddress || customer.billingAddress)) throw userError(`${label} needs the delivery address`);
  return { customer, pickupPincode, dropPincode };
}

/** Books a courier pickup for a dispatched order and keeps the AWB / tracking link on it. Shared by dispatch and the Book Courier Pickup modal. */
export async function bookShipment({ cfg, store, fetchImpl }, order, d, by) {
  const courier = COURIERS[d.provider || "shadowfax"];
  const company = await getSettings(store);
  const { customer, pickupPincode, dropPincode } = deliveryFor(cfg, company, order, d, courier.label);
  const dimensions = d.lengthCm && d.breadthCm && d.heightCm ? { lengthCm: d.lengthCm, breadthCm: d.breadthCm, heightCm: d.heightCm } : null;
  const pickupSlot = d.pickupDate ? { date: d.pickupDate, window: d.pickupWindow } : null, weightKg = d.weightKg || 1, packages = d.packages || 1;
  const claim=crypto.randomUUID();
  order=await store.atomic(async()=>{
    const fresh=await store.orders.get(order.id);
    if(!fresh || fresh.status!=='dispatched' || ['pending','reconcile'].includes(fresh.shipmentBooking?.status) || shipmentLive(fresh))throw Object.assign(new Error('Pickup already exists or needs provider reconciliation'),{userError:true,status:409});
    return store.orders.update(fresh.id,{customer,shipmentBooking:{claim,status:'pending',at:now()}});
  });
  let shipment;
  try {
    shipment=await courier.book(cfg, { order, company, pickupPincode, dropPincode, weightKg, packages, pickupSlot, dimensions, dropLat: d.dropLat, dropLng: d.dropLng }, fetchImpl ? { fetchImpl } : {});
    if(!shipment.awb&&!shipment.sfxOrderId)throw new Error('Provider did not return a booking identity');
  } catch(e) {
    await store.orders.update(order.id,{shipmentBooking:{claim,status:e.status>=400&&e.status<500&&!([408,429].includes(e.status))?'failed':'reconcile',at:now(),reason:'Confirm provider booking outcome before retry'}});throw e;
  }
  const upd = await store.orders.update(order.id, { shipment: { ...shipment, weightKg, packages, pickupSlot, dimensions }, shipmentBooking:{claim,status:'booked',at:now()}, dispatch: { ...(order.dispatch || {}), transporter: courier.label, trackingNo: shipment.awb || order.dispatch?.trackingNo || "" }, updatedAt: now() });
  await logActivity(store, { entity: "order", entityId: order.id, text: `${courier.label} pickup booked${shipment.awb ? ` (AWB ${shipment.awb})` : ""}${pickupSlot ? ` for ${pickupSlot.date} ${pickupSlot.window}` : ""}`, by });
  return upd;
}

export function logisticsRoutes({ cfg, store, audit, automation, fetchImpl }) {
  const r = Router();
  r.use("/logistics", requirePerm("orders", "stock"));
  r.get("/logistics/serviceability", wrap(async (req, res) => {
    if (!shadowfaxOn(cfg)) return bad(res, "Shadowfax is not connected (SHADOWFAX_API_TOKEN)", 409);
    const drop = String(req.query.pincode || ""), pickup = String(req.query.pickup || cfg.sfxPickupPincode || pincodeOf((await getSettings(store)).address));
    if (!/^\d{6}$/.test(drop) || !/^\d{6}$/.test(pickup)) return bad(res, "PIN code is 6 digits");
    try { res.json({ pickup, drop, ...(await checkServiceability(cfg, { pickup, drop }, fetchImpl ? { fetchImpl } : {})), raw: undefined }); } catch (e) { bad(res, e.message, 502); }
  }));
  /** Is the token set, and does Shadowfax accept it right now? Asked with a harmless serviceability check, since Shadowfax has no account-status call. */
  r.get("/logistics/shadowfax/status", wrap(async (_req, res) => {
    const pickup = cfg.sfxPickupPincode || pincodeOf((await getSettings(store)).address);
    if (!shadowfaxOn(cfg)) return res.json({ connected: false, verified: false, pickup, message: "No Shadowfax token on the server (SHADOWFAX_API_TOKEN)" });
    if (!/^\d{6}$/.test(pickup)) return res.json({ connected: true, verified: false, pickup, message: "Token is set. Add the pickup PIN to check it (SHADOWFAX_PICKUP_PINCODE)" });
    try { await checkServiceability(cfg, { pickup, drop: pickup }, fetchImpl ? { fetchImpl } : {}); res.json({ connected: true, verified: true, pickup, message: "Token connected: Shadowfax answered just now" }); }
    catch (e) { res.json({ connected: true, verified: false, pickup, message: [401, 403].includes(e.status) ? "Shadowfax refused this token" : `Shadowfax did not answer: ${e.message}` }); }
  }));
  r.get("/logistics/estimate/:id", wrap(async (req, res) => {
    const o = await store.orders.get(req.params.id); if (!o) return notFound(res, "Order");
    const ids = [...new Set(o.items.map((i) => i.productId).filter(Boolean))];
    const byId = Object.fromEntries((await Promise.all(ids.map((id) => store.products.get(id)))).filter(Boolean).map((p) => [p.id, p]));
    res.json({ weightKg: estimateWeightKg(o.items, byId), pieces: o.items.reduce((n, i) => n + pieces(i), 0) });
  }));
  /** Staff copy a charge from the Shadowfax statement when the API did not report one. */
  r.put("/orders/:id/shipment/charge", requirePerm("orders"), wrap(async (req, res) => {
    const d = parse(shipmentChargeInput, req.body || {}, res); if (!d) return;
    const o = await store.orders.get(req.params.id); if (!o) return notFound(res, "Order");
    if (!o.shipment) return bad(res, "This order has no shipment", 409);
    const upd = await store.orders.update(o.id, { shipment: { ...o.shipment, chargePaise: d.amount, chargeBy: req.admin.email }, updatedAt: now() });
    await audit(req, "order.shipmentCharge", o.number, { amount: d.amount }); res.json(upd);
  }));
  r.post("/orders/:id/shipment", requirePerm("orders"), wrap(async (req, res) => {
    const { courier: alias, ...input } = req.body || {};
    const d = parse(shipmentInput, { ...input, ...(alias && !input.provider ? { provider: alias } : {}) }, res); if (!d) return;
    const courier = COURIERS[d.provider];
    if (!courier.on(cfg)) return bad(res, `${courier.label} is not connected (${courier.env})`, 409);
    if (d.provider === "porter" && !(Number.isFinite(cfg.porterPickupLat) && Number.isFinite(cfg.porterPickupLng))) return bad(res, "Set PORTER_PICKUP_LAT and PORTER_PICKUP_LNG to the shop's location", 409);
    let o = await store.orders.get(req.params.id); if (!o) return notFound(res, "Order");
    const packed = ["confirmed", "packed"].includes(o.status); // one click from the queue: the challan is raised here
    if (!packed && o.status !== "dispatched") return bad(res, `A ${o.status} order cannot be booked`, 409);
    if (shipmentLive(o)) return bad(res, "A pickup is already booked for this order", 409);
    if (packed) {
      deliveryFor(cfg, await getSettings(store), o, d, courier.label);
      o = await dispatchOrder(store, o.id, { transporter: courier.label, trackingNo: "", vehicleNo: "", date: "", notes: "" }, req.admin.email);
      await audit(req, "order.dispatch", o.number, { challanNumber: o.challanNumber });
    }
    try {
      const upd = await bookShipment({ cfg, store, fetchImpl }, o, d, req.admin.email);
      await audit(req, "order.shipment", o.number, { provider: d.provider, awb: upd.shipment.awb });
      if (packed || o.dispatchMessagePending) { await automation.on.orderDispatched(upd); if (o.dispatchMessagePending) await store.orders.update(o.id, { dispatchMessagePending: false }); }
      res.json(upd);
    } catch (e) { // the challan stands; the customer hears nothing until a pickup is really booked
      if (!packed) { if (e.userError) throw e; return bad(res, `${courier.label}: ${e.message}`, 502); }
      await store.orders.update(o.id, { dispatchMessagePending: true });
      bad(res, `Challan ${o.challanNumber} is raised and the stock is out, but ${courier.label} did not take the booking: ${e.message}. Open the order to try again.`, 502);
    }
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
    const charged = ev.chargePaise != null && ev.chargePaise !== o.shipment.chargePaise;
    const repeat = o.shipment.history?.some((h) => h.status === ev.status);
    const newRider = (ev.riderName && ev.riderName !== o.shipment.riderName) || (ev.riderPhone && ev.riderPhone !== o.shipment.riderPhone); // rider details can follow the assignment, or the rider can change
    if (repeat && !newRider && !charged) return res.json({ ok: true, duplicate: true });
    const shipment = { ...o.shipment, ...(charged ? { chargePaise: ev.chargePaise } : {}), status: ev.status, rawStatus: ev.rawStatus, riderName: ev.riderName || o.shipment.riderName, riderPhone: ev.riderPhone || o.shipment.riderPhone,
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
