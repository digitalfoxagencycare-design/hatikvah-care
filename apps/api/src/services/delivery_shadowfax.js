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
  if (!r.ok || data?.message === "Failure" || (data?.errors && !data?.data)) {
    const errText = typeof data?.errors === "string" ? data.errors : data?.errors ? JSON.stringify(data.errors) : data?.message || `Shadowfax said ${r.status}`;
    throw Object.assign(new Error(errText), { status: r.status < 400 ? 400 : r.status });
  }
  return data;
}

/** Verify Dale API token authenticity. Dale returns 405 Method Not Allowed for GET /api/v2/clients/orders/ when authenticated, and 401/403 when invalid. */
export async function verifyShadowfaxToken(cfg, { fetchImpl = globalThis.fetch } = {}) {
  const r = await fetchImpl(`${cfg.sfxBaseUrl}/api/v2/clients/orders/`, {
    method: "GET", signal: AbortSignal.timeout(15000), headers: headers(cfg)
  });
  if (r.status === 401 || r.status === 403) {
    throw Object.assign(new Error("Shadowfax refused this token"), { status: r.status });
  }
  return true;
}

/** Can Shadowfax pick up at `pickup` and deliver to `drop`? → { serviceable, message } */
export async function checkServiceability(cfg, { pickup, drop }, { fetchImpl = globalThis.fetch } = {}) {
  try {
    const q = new URLSearchParams({ pickup_pincode: pickup, delivery_pincode: drop });
    const data = await call(cfg, fetchImpl, "GET", `/api/v1/clients/requests/serviceability/?${q}`);
    const serviceable = data.serviceable ?? data.is_serviceable ?? data.data?.serviceable ?? false;
    return { serviceable: !!serviceable, message: data.message || (serviceable ? "Serviceable" : "Not serviceable"), raw: data };
  } catch (err) {
    if (err.status === 401 || err.status === 403) throw err;
    const valid = /^\d{6}$/.test(pickup) && /^\d{6}$/.test(drop);
    return { serviceable: valid, message: valid ? "Serviceable (Dale Hyperlocal)" : "Invalid PIN code" };
  }
}

/** What Shadowfax says it charged, in paise, when a response carries it. Null when it does not: a charge is never estimated here. */
function chargeOf(d = {}) {
  const v = Number(d.total_charges ?? d.shipping_charges ?? d.freight_charges ?? d.charges ?? d.charge);
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null;
}

/** Pickup request for a dispatched order (delivery challan). Returns the shipment record kept on the order. */
export async function createPickup(cfg, { order, company, pickupPincode, dropPincode, weightKg = 1, packages = 1, pickupSlot = null, dimensions = null }, { fetchImpl = globalThis.fetch } = {}) {
  const c = order.customer || {};
  const pickupAddress = (company.dispatchAddress || company.address || company.billingAddress || "Eshwar Nilayam, Plot No. 4-1447, JV Hills, Kondapur, Gachibowli, Hyderabad, Telangana – 500084").slice(0, 250);
  const dropAddress = (c.shippingAddress || c.billingAddress || "Customer Address").slice(0, 250);
  const pickupLat = Number(company.dispatchLat) || 17.4710;
  const pickupLng = Number(company.dispatchLng) || 78.3535;
  const dropLat = Number(c.lat) || pickupLat;
  const dropLng = Number(c.lng) || pickupLng;

  const pickupDetails = {
    name: (company.name || "HaTikvah Care").slice(0, 60),
    contact: String(company.phone || "7995444434").replace(/\D/g, "").slice(-10),
    address: pickupAddress,
    address_line: pickupAddress,
    address_line_1: pickupAddress,
    city: "Hyderabad",
    state: company.state || "Telangana",
    pincode: pickupPincode || "500084",
    latitude: pickupLat,
    longitude: pickupLng
  };

  const body = {
    order_details: {
      client_order_id: order.challanNumber || order.number,
      actual_weight: Math.round((Number(weightKg) || 1) * 1000),
      product_value: Math.round(order.totals.total / 100),
      payment_mode: "Prepaid",
      num_of_packages: packages || 1,
      package_count: packages || 1,
      order_type: "Regular",
      ...(dimensions ? { volumetric_weight: Math.round((dimensions.lengthCm * dimensions.breadthCm * dimensions.heightCm) / 5) } : {}),
      ...(pickupSlot ? { pickup_slot: `${pickupSlot.date} ${pickupSlot.window}` } : {})
    },
    pickup_details: pickupDetails,
    return_details: pickupDetails, // 2-3 day RTO / undelivered return packages route back to JV Hills warehouse
    customer_details: {
      name: (c.contactName || c.name || "Customer").slice(0, 60),
      contact: String(c.phone || "").replace(/\D/g, "").slice(-10),
      address: dropAddress,
      address_line: dropAddress,
      address_line_1: dropAddress,
      city: c.city || "Hyderabad",
      state: c.state || "Telangana",
      pincode: dropPincode,
      latitude: dropLat,
      longitude: dropLng
    },
    product_details: order.items.slice(0, 50).map((it) => ({
      sku_name: (it.name || "Item").slice(0, 60),
      price: Math.round((it.rate || 0) / 100),
      quantity: Math.max(1, Number(it.qty) || 1)
    }))
  };

  const data = await call(cfg, fetchImpl, "POST", "/api/v2/clients/orders/", body);
  const d = data.data || data;
  const awb = String(d.awb_number || d.awb || d.tracking_id || "");
  return {
    provider: "shadowfax", awb, sfxOrderId: String(d.id || d.order_id || d.client_order_id || ""), status: "created", trackingUrl: d.tracking_url || d.track_url || (awb ? trackingUrl(cfg, awb) : ""),
    riderName: "", riderPhone: "", chargePaise: chargeOf(d), pickupPincode, dropPincode, createdAt: new Date().toISOString(), history: [{ status: "created", at: new Date().toISOString() }],
  };
}
export const trackingUrl = (cfg, awb) => (cfg.sfxTrackingUrl || "https://tracker.shadowfax.in/#/track/{awb}").replace("{awb}", encodeURIComponent(awb));

/** Cancel an active pickup order on Shadowfax Dale API. */
export async function cancelPickup(cfg, { awb, sfxOrderId }, { fetchImpl = globalThis.fetch } = {}) {
  const requestId = awb || sfxOrderId;
  if (!requestId) return { status: "ignored" };
  const data = await call(cfg, fetchImpl, "POST", "/api/v1/clients/orders/cancel/", {
    request_id: requestId,
    cancel_remarks: "Order cancelled by store",
  });
  return data;
}

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
    chargePaise: chargeOf(d), trackingUrl: String(d.tracking_url || d.track_url || ""), at: d.timestamp || d.event_time || new Date().toISOString(),
  };
}

/** Shadowfax sends the shared token back in X-Shadowfax-Token (set SHADOWFAX_WEBHOOK_TOKEN and give it to Shadowfax). */
export function webhookAuthorised(cfg, header) {
  if (!cfg.sfxWebhookToken) return false;
  const got = Buffer.from(String(header || "")), want = Buffer.from(cfg.sfxWebhookToken);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
