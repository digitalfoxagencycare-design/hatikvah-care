import crypto from "node:crypto";

const authHeader = (cfg) => "Basic " + Buffer.from(`${cfg.razorpayKeyId}:${cfg.razorpaySecret}`).toString("base64");

/** Razorpay payment links (https://razorpay.com/docs/api/payments/payment-links/). Keys come from the environment only. */
export async function createPaymentLink(cfg, invoice, { fetchImpl = globalThis.fetch, callbackUrl = "", reference = "", notes } = {}) {
  const due = invoice.totals.total - (invoice.amountPaid || 0) - (invoice.creditedAmount || 0);
  if (invoice.status === "void" || !Number.isSafeInteger(due) || due <= 0) throw new Error("No positive safe-integer balance is payable"); // works for a sales order too (no amountPaid)
  const body = {
    amount: due, currency: "INR", accept_partial: false, reference_id: (reference || invoice.number).slice(0, 40),
    description: `${notes?.orderId ? "Order" : notes?.quoteId ? "Quotation" : "Invoice"} ${invoice.number}`.slice(0, 2048),
    customer: { name: invoice.customer.name.slice(0, 100), ...(invoice.customer.email ? { email: invoice.customer.email } : {}), ...(invoice.customer.phone ? { contact: invoice.customer.phone } : {}) },
    notify: { sms: false, email: false }, reminder_enable: false, notes: notes || { invoiceId: invoice.id },
    ...(callbackUrl ? { callback_url: callbackUrl, callback_method: "get" } : {}), // website checkout: bring the buyer back after paying
  };
  const r = await fetchImpl("https://api.razorpay.com/v1/payment_links", {
    method: "POST", signal: AbortSignal.timeout(15000), headers: { Authorization: authHeader(cfg), "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error?.description || `Razorpay said ${r.status}`);
  let validUrl=false;try{validUrl=new URL(data.short_url).protocol==='https:';}catch{ /* invalid provider result */ }
  if(!data.id || !validUrl)throw new Error('Razorpay did not return a valid payment link identity and HTTPS URL');
  return { id: data.id, url: data.short_url, amount: due };
}

/** Longest life Razorpay gives a single-use QR is 2 hours; the counter wants a short one. Its docs give 2 and 15 minutes as the minimum, so 20 suits both. */
const QR_MINUTES = 20;

async function rzpJson(cfg, fetchImpl, method, path, body) {
  const r = await fetchImpl(`https://api.razorpay.com/v1${path}`, { method, signal: AbortSignal.timeout(15000), headers: { Authorization: authHeader(cfg), "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data?.error?.description || `Razorpay said ${r.status}`), { status: r.status });
  return data;
}

/** Single-use UPI QR for one amount (https://razorpay.com/docs/api/qr-codes/). Falls back to payment link with QR if merchant account lacks dedicated UPI QR approval. */
export async function createUpiQr(cfg, invoice, amount, { fetchImpl = globalThis.fetch } = {}) {
  try {
    const data = await rzpJson(cfg, fetchImpl, "POST", "/payments/qr_codes", { type: "upi_qr", name: invoice.number.slice(0, 40), usage: "single_use", fixed_amount: true, payment_amount: amount,
      description: `Invoice ${invoice.number}`, close_by: Math.floor(Date.now() / 1000) + QR_MINUTES * 60, notes: { invoiceId: invoice.id } });
    let validUrl = false; try { validUrl = new URL(data.image_url).protocol === "https:"; } catch { /* invalid provider result */ }
    if (!data.id || !validUrl) throw new Error("Razorpay did not return a valid QR code");
    return { id: data.id, imageUrl: data.image_url, amount, closeBy: data.close_by ? new Date(data.close_by * 1000).toISOString() : "", status: "active", createdAt: new Date().toISOString() };
  } catch (err) {
    if (err.message?.includes("The requested URL was not found on the server") || err.status === 400 || err.status === 404) {
      const link = await createPaymentLink(cfg, invoice, { fetchImpl, notes: { invoiceId: invoice.id, source: "pos_upi" } });
      const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=10&data=${encodeURIComponent(link.url)}`;
      return {
        id: link.id,
        imageUrl: qrImageUrl,
        payUrl: link.url,
        amount,
        closeBy: new Date(Date.now() + QR_MINUTES * 60 * 1000).toISOString(),
        status: "active",
        createdAt: new Date().toISOString(),
        isLink: true,
      };
    }
    throw err;
  }
}

export const closeUpiQr = async (cfg, id, { fetchImpl = globalThis.fetch } = {}) => {
  if (id.startsWith("plink_")) return rzpJson(cfg, fetchImpl, "POST", `/payment_links/${encodeURIComponent(id)}/cancel`);
  return rzpJson(cfg, fetchImpl, "POST", `/payments/qr_codes/${encodeURIComponent(id)}/close`);
};

/** Captured payments on a QR: the same payment entity the qr_code.credited webhook carries, for when that call is late or missing. */
export async function fetchQrPayments(cfg, id, { fetchImpl = globalThis.fetch } = {}) {
  if (id.startsWith("plink_")) {
    const data = await rzpJson(cfg, fetchImpl, "GET", `/payment_links/${encodeURIComponent(id)}`);
    if (data.status === "paid") {
      return [{ id: data.id, amount: data.amount_paid || data.amount, status: "captured" }];
    }
    return [];
  }
  const data = await rzpJson(cfg, fetchImpl, "GET", `/payments/qr_codes/${encodeURIComponent(id)}/payments`);
  return (data.items || []).filter((p) => p.status === "captured");
}

/** Webhook signature: HMAC-SHA256 of the raw body with the webhook secret. */
export function verifyWebhook(raw, signature, secret) {
  if (!secret || typeof signature !== "string" || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const want = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  return want.length === signature.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(signature));
}
