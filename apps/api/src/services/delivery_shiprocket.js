/**
 * Shiprocket Logistics Integration for HaTikvah Care.
 * Routes through Nova SaaS Central Gateway (X-Nova-Client-Key) or direct Shiprocket API.
 */
export const shiprocketOn = (cfg) => !!(cfg.novaKey || cfg.shiprocketToken);

export async function createShiprocketPickup(
  cfg,
  { order, company, pickupPincode, dropPincode, weightKg = 1, packages = 1, pickupSlot = null, dimensions = null, dropLat = null, dropLng = null },
  { fetchImpl = globalThis.fetch } = {}
) {
  const c = order.customer || {};
  const pickupAddress = (company.dispatchAddress || company.address || company.billingAddress || "Eshwar Nilayam, Plot No. 4-1447, JV Hills, Kondapur, Hyderabad – 500084").slice(0, 250);
  const dropAddress = (c.shippingAddress || c.billingAddress || "Customer Address").slice(0, 250);

  // If connected via Nova SaaS Central Logistics Hub
  if (cfg.novaUrl && cfg.novaKey) {
    const payload = {
      order_id: order.challanNumber || order.number,
      provider: "shiprocket",
      customer_name: (c.contactName || c.name || "Customer").slice(0, 60),
      customer_phone: String(c.phone || "").replace(/\D/g, "").slice(-10),
      drop_address: dropAddress,
      drop_pincode: Number(dropPincode || 500084),
      drop_lat: dropLat ? Number(dropLat) : null,
      drop_lng: dropLng ? Number(dropLng) : null,
      drop_city: c.city || "Hyderabad",
      drop_state: c.state || "Telangana",
      product_value_rupees: Math.max(1, Math.round((order.totals?.total || 10000) / 100)),
      weight_kg: Number(weightKg) || 1.0,
      vehicle: "2W",
    };

    const res = await fetchImpl(`${cfg.novaUrl}/v2/integrations/logistics/dispatch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Nova-Client-Key": cfg.novaKey,
        "X-Tenant-Slug": cfg.novaSlug || "hatikvah-care",
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      const msg = data.detail?.message || data.message || `Nova Logistics Gateway error: HTTP ${res.status}`;
      throw Object.assign(new Error(msg), { status: res.status });
    }

    return {
      awb: data.awb || data.tracking_id,
      trackingUrl: data.tracking_url,
      status: data.status || "booked",
      provider: "shiprocket",
      chargePaise: 7500, // standard base charge 75 INR
      riderName: data.rider?.name || null,
      riderPhone: data.rider?.phone || null,
    };
  }

  // Direct Shiprocket API fallback (if token is provided in cfg)
  const token = cfg.shiprocketToken;
  if (!token) {
    throw Object.assign(new Error("Shiprocket is not configured (missing NOVA_CLIENT_KEY or SHIPROCKET_TOKEN)"), { status: 503 });
  }

  const body = {
    order_id: order.challanNumber || order.number,
    order_date: new Date().toISOString().slice(0, 10),
    pickup_location: "HaTikvah-Care-Kondapur",
    billing_customer_name: (c.contactName || c.name || "Customer").slice(0, 60),
    billing_last_name: "",
    billing_address: dropAddress,
    billing_city: c.city || "Hyderabad",
    billing_pincode: Number(dropPincode || 500084),
    billing_state: c.state || "Telangana",
    billing_country: "India",
    billing_phone: String(c.phone || "").replace(/\D/g, "").slice(-10),
    shipping_is_billing: true,
    order_items: [{ name: "Medical/Care Package", sku: "med-01", units: 1, selling_price: Math.max(1, Math.round((order.totals?.total || 10000) / 100)) }],
    payment_method: "Prepaid",
    sub_total: Math.max(1, Math.round((order.totals?.total || 10000) / 100)),
    length: dimensions?.lengthCm || 15,
    breadth: dimensions?.breadthCm || 15,
    height: dimensions?.heightCm || 10,
    weight: Math.max(0.5, Number(weightKg) || 1),
  };

  const r = await fetchImpl("https://apiv2.shiprocket.in/v1/external/orders/create/adhoc", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.order_id) {
    throw Object.assign(new Error(data.message || `Shiprocket error: HTTP ${r.status}`), { status: r.status });
  }

  return {
    awb: String(data.shipment_id || data.order_id),
    trackingUrl: `https://shiprocket.co/tracking/${data.shipment_id || data.order_id}`,
    status: "booked",
    provider: "shiprocket",
    chargePaise: 7500,
  };
}
