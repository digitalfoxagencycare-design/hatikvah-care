import crypto from "node:crypto";

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
    method: "POST", signal: AbortSignal.timeout(15000), headers: { Authorization: "Basic " + Buffer.from(`${cfg.razorpayKeyId}:${cfg.razorpaySecret}`).toString("base64"), "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error?.description || `Razorpay said ${r.status}`);
  let validUrl=false;try{validUrl=new URL(data.short_url).protocol==='https:';}catch{ /* invalid provider result */ }
  if(!data.id || !validUrl)throw new Error('Razorpay did not return a valid payment link identity and HTTPS URL');
  return { id: data.id, url: data.short_url, amount: due };
}

/** Webhook signature: HMAC-SHA256 of the raw body with the webhook secret. */
export function verifyWebhook(raw, signature, secret) {
  if (!secret || typeof signature !== "string" || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const want = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  return want.length === signature.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(signature));
}
