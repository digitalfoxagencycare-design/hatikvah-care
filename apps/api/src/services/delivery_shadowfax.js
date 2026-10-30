import crypto from "node:crypto";

/**
 * Shadowfax logistics (hyperlocal and B2B dispatch). Turned on by SHADOWFAX_API_TOKEN; base URL SHADOWFAX_BASE_URL.
 * Every call to Shadowfax is in this file, so when their API version or field names differ for your account, only this
 * file changes. The request shapes follow the Shadowfax client order API (token auth, JSON); confirm them against the API
 * document Shadowfax shares when the account is opened, and test on their staging URL first.
 */
export const shadowfaxOn = (cfg) => !!cfg.sfxToken;
const headers = (cfg) => ({ Authorization: `Token ${cfg.sfxToken}`, "Content-Type": "application/json", Accept: "application/json" });

/** Last 6-digit number in an address ("…Hyderabad – 500084" → "500084"). */
export const pincodeOf = (address = "") => (String(address).match(/\b\d{6}\b/g) || []).pop() || "";

async function call(cfg, fetchImpl, method, path, body) {
  const r = await fetchImpl(`${cfg.sfxBaseUrl}${path}`, { method, signal: AbortSignal.timeout(15000), headers: headers(cfg), ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data?.message || data?.errors?.[0] || data?.error || `Shadowfax said ${r.status}`), { status: r.status });
  return data;
}

/** Can Shadowfax pick up at `pickup` and deliver to `drop`? → { serviceable, message } */
export async function checkServiceability(cfg, { pickup, drop }, { fetchImpl = globalThis.fetch } = {}) {
  const q = new URLSearchParams({ pickup_pincode: pickup, delivery_pincode: drop });
  const data = await call(cfg, fetchImpl, "GET", `/api/v1/clients/requests/serviceability/?${q}`);
  const serviceable = data.serviceable ?? data.is_serviceable ?? data.data?.serviceable ?? false;
  return { serviceable: !!serviceable, message: data.message || (serviceable ? "Serviceable" : "Not serviceable"), raw: data };
}

/** Pickup request for a dispatched order (delivery challan). Returns the shipment record kept on the order. */
export async function createPickup(cfg, { order, company, pickupPincode, dropPincode, weightKg = 1, packages = 1 }, { fetchImpl = globalThis.fetch } = {}) {
  const c = order.customer;
  const body = {
    order_details: { client_order_id: order.challanNumber || order.number, actual_weight: Math.round(weightKg * 1000), product_value: Math.round(order.totals.total / 100), payment_mode: "Prepaid", total_amount: 0, cod_amount: 0, num_of_packages: packages },
    customer_details: { name: (c.contactName || c.name).slice(0, 100), contact: c.phone.replace(/\D/g, "").slice(-10), address_line_1: (c.shippingAddress || c.billingAddress).slice(0, 250), pincode: dropPincode, state: c.state || "" },
    pickup_details: { name: company.name, contact: String(company.phone || "").replace(/\D/g, "").slice(-10), address_line_1: (company.address || company.billingAddress || "").slice(0, 250), pincode: pickupPincode, state: company.state || "" },
    product_details: order.items.slice(0, 50).map((it) => ({ sku_name: it.name.slice(0, 100), sku_id: it.sku || "", hsn_code: it.hsn || "", price: Math.round((it.rate || 0) / 100), qty: it.qty })),
  };
  const data = await call(cfg, fetchImpl, "POST", "/api/v3/clients/orders/", body);
  const d = data.data || data;
  const awb = String(d.awb_number || d.awb || d.tracking_id || "");
  return {
    provider: "shadowfax", awb, sfxOrderId: String(d.id || d.order_id || ""), status: "created", trackingUrl: d.tracking_url || d.track_url || (awb ? trackingUrl(cfg, awb) : ""),
    riderName: "", riderPhone: "", pickupPincode, dropPincode, createdAt: new Date().toISOString(), history: [{ status: "created", at: new Date().toISOString() }],
  };
}
export const trackingUrl = (cfg, awb) => (cfg.sfxTrackingUrl || "https://tracker.shadowfax.in/#/track/{awb}").replace("{awb}", encodeURIComponent(awb));

/** Shadowfax status words → ours: created, assigned, picked, in_transit, out_for_delivery, delivered, cancelled, returned. */
export function normaliseStatus(s = "") {
  const v = String(s).toLowerCase().replace(/[\s-]+/g, "_");
  if (/rto|return/.test(v)) return "returned";
  if (/cancel/.test(v)) return "cancelled";
  if (/^delivered$|delivered_to|order_delivered/.test(v)) return "delivered";
  if (/out_for_delivery|ofd/.test(v)) return "out_for_delivery";
  if (/pick(ed|up_done|up_complete)|picked/.test(v)) return "picked";
  if (/transit|reached|hub|shipped/.test(v)) return "in_transit";
  if (/assign|allot|accepted/.test(v)) return "assigned";
  return "created";
}

/** Status webhook body → { awb, clientOrderId, status, riderName, riderPhone, trackingUrl, at } (several field spellings accepted). */
export function parseWebhook(b = {}) {
  const d = b.data || b;
  return {
    awb: String(d.awb_number || d.awb || d.tracking_id || ""), clientOrderId: String(d.client_order_id || d.order_id || ""),
    status: normaliseStatus(d.status || d.order_status || d.event || ""), rawStatus: String(d.status || d.order_status || d.event || ""),
    riderName: String(d.rider_name || d.rider?.name || ""), riderPhone: String(d.rider_contact || d.rider_phone || d.rider?.contact || ""),
    trackingUrl: String(d.tracking_url || d.track_url || ""), at: d.timestamp || d.event_time || new Date().toISOString(),
  };
}

/** Shadowfax sends the shared token back in X-Shadowfax-Token (set SHADOWFAX_WEBHOOK_TOKEN and give it to Shadowfax). */
export function webhookAuthorised(cfg, header) {
  if (!cfg.sfxWebhookToken) return false;
  const got = Buffer.from(String(header || "")), want = Buffer.from(cfg.sfxWebhookToken);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
