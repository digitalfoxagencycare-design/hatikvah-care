import crypto from "node:crypto";

/**
 * Porter (same-city two-wheeler deliveries). Turned on by PORTER_API_KEY and PORTER_BASE_URL; the shop's location by
 * PORTER_PICKUP_LAT / PORTER_PICKUP_LNG. Every call to Porter is in this file. Porter's API document is only shared with
 * account holders, so the paths, field names and webhook words below must be confirmed against it before going live.
 */
export const porterOn = (cfg) => !!(cfg.porterKey && cfg.porterBaseUrl);

async function call(cfg, fetchImpl, method, path, body) {
  const r = await fetchImpl(`${cfg.porterBaseUrl}${path}`, { method, signal: AbortSignal.timeout(15000), headers: { "x-api-key": cfg.porterKey, "Content-Type": "application/json", Accept: "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data?.message || data?.error?.message || `Porter said ${r.status}`), { status: r.status });
  return data;
}

const phone = (s) => `+91${String(s || "").replace(/\D/g, "").slice(-10)}`;
const place = ({ address, state, pincode, lat, lng, name, contact }) => ({ address: { street_address1: String(address || "").slice(0, 250), state: state || "", pincode, country: "India", lat, lng, contact_details: { name: String(name || "").slice(0, 100), phone_number: phone(contact) } } });

/** Pickup request for a dispatched order. Returns the shipment record kept on the order (the Porter order id is its AWB). */
export async function createPorterPickup(cfg, { order, company, pickupPincode, dropPincode, weightKg = 1, packages = 1, pickupSlot = null, dropLat, dropLng }, { fetchImpl = globalThis.fetch } = {}) {
  const c = order.customer;
  const body = {
    request_id: order.challanNumber || order.number,
    pickup_details: place({ address: company.address || company.billingAddress, state: company.state, pincode: pickupPincode, lat: cfg.porterPickupLat, lng: cfg.porterPickupLng, name: company.name, contact: company.phone }),
    drop_details: place({ address: c.shippingAddress || c.billingAddress, state: c.state, pincode: dropPincode, lat: dropLat, lng: dropLng, name: c.contactName || c.name, contact: c.phone }),
    additional_comments: [`${packages} package(s), ${weightKg} kg`, pickupSlot && `Pickup ${pickupSlot.date} ${pickupSlot.window}`].filter(Boolean).join(". "),
  };
  const data = await call(cfg, fetchImpl, "POST", "/v1/orders/create", body);
  const d = data.data || data, at = new Date().toISOString();
  return { provider: "porter", awb: String(d.order_id || d.id || ""), status: "created", trackingUrl: String(d.tracking_url || ""), riderName: "", riderPhone: "", pickupPincode, dropPincode, createdAt: at, history: [{ status: "created", at }] };
}

/** Porter's order stages (Accepted, Live, Ended, Cancelled) → our shipment statuses. Reopened goes back to waiting for a rider. */
export function normalisePorterStatus(s = "") {
  const v = String(s).toLowerCase().replace(/[\s-]+/g, "_");
  if (/cancel/.test(v)) return "cancelled";
  if (/ended|end_trip|complete/.test(v)) return "delivered";
  if (/live|start_trip/.test(v)) return "picked";
  if (/accept|allot/.test(v)) return "assigned";
  return "created";
}

/** Status webhook body → the same event shape as Shadowfax's parseWebhook. */
export function parsePorterWebhook(b = {}) {
  const d = b.data || b, raw = String(d.status || d.order_status || d.event || d.event_type || ""), p = d.partner_info || d.partner || d.driver || {};
  return {
    awb: String(d.order_id || d.id || ""), clientOrderId: String(d.request_id || ""), status: normalisePorterStatus(raw), rawStatus: raw,
    riderName: String(p.name || d.rider_name || ""), riderPhone: String(p.mobile?.mobile_number || p.mobile || p.phone || d.rider_phone || ""),
    trackingUrl: String(d.tracking_url || ""), at: d.timestamp || d.event_time || new Date().toISOString(),
  };
}

/** Porter sends the shared token back in X-Porter-Token (set PORTER_WEBHOOK_TOKEN and give it to Porter). */
export function porterWebhookAuthorised(cfg, header) {
  if (!cfg.porterWebhookToken) return false;
  const got = Buffer.from(String(header || "")), want = Buffer.from(cfg.porterWebhookToken);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
