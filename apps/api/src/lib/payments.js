import { createPaymentLink, createUpiQr } from "./razorpay.js";
import { balance, logActivity, now, postLedger, recordPayment } from "./sales.js";

/** Money that came in but belongs to nothing payable: it stays out of the invoices until staff reconcile it. */
export async function holdForReconciliation(store, pay, details) {
  await postLedger(store, { sourceKey: "unapplied:" + pay.id, kind: "unapplied_receipt", account: "razorpay", amount: pay.amount, ref: pay.id, lines: [{ account: "razorpay", debit: pay.amount, credit: 0 }, { account: "unapplied_receipts", debit: 0, credit: pay.amount }], narration: "Captured payment requires reconciliation; no goods issued" });
  await store.webhookEvents.insert({ eventKey: "razorpay:" + pay.id, status: "reconciliation_required", paymentId: pay.id, amount: pay.amount, currency: pay.currency, ...details, createdAt: now() });
}

/**
 * The link to show for an invoice or order: the current one while it still asks for what is owed, else a new one.
 * The old link stays in payLinkHistory, because a customer can still pay it and the webhook must recognise that payment.
 */
export async function refreshPayLink({ cfg, store, fetchImpl }, collection, doc, due, notes) {
  if (doc.payLink?.url && doc.payLink.amount === due) return doc;
  const link = await createPaymentLink(cfg, doc, { ...(fetchImpl ? { fetchImpl } : {}), notes, reference: `${doc.number}-${Date.now().toString(36)}` });
  return store.atomic(async () => {
    const fresh = await collection.get(doc.id);
    return collection.update(doc.id, { payLink: link, ...(fresh.payLink ? { payLinkHistory: [...(fresh.payLinkHistory || []), fresh.payLink] } : {}), updatedAt: now() });
  });
}

const qrLive = (qr) => qr?.status === "active" && (!qr.closeBy || Date.parse(qr.closeBy) > Date.now());

/** The QR to show for a counter invoice: the live one for this balance, else a new one (older QRs stay recognised in upiQrHistory). */
export async function refreshUpiQr({ cfg, store, fetchImpl }, inv) {
  const due = balance(inv);
  if (qrLive(inv.upiQr) && inv.upiQr.amount === due) return inv;
  const qr = await createUpiQr(cfg, inv, due, fetchImpl ? { fetchImpl } : {});
  return store.atomic(async () => {
    const fresh = await store.invoices.get(inv.id);
    return store.invoices.update(inv.id, { upiQr: qr, ...(fresh.upiQr ? { upiQrHistory: [...(fresh.upiQrHistory || []), fresh.upiQr] } : {}), updatedAt: now() });
  });
}

/** What the counter screen polls. */
export const qrView = (inv) => {
  const qr = inv.upiQr, paid = balance(inv) <= 0;
  return { id: inv.id, number: inv.number, token: inv.token, total: inv.totals.total, balance: balance(inv), status: paid ? "paid" : !qr ? "none" : qrLive(qr) ? "pending" : qr.status === "closed" ? "closed" : "expired",
    qr: qr ? { imageUrl: qr.imageUrl, amount: qr.amount, closeBy: qr.closeBy } : null };
};

/** A captured QR payment, from the qr_code.credited webhook or the status check. Safe to call twice for one payment. */
export async function applyQrPayment({ store, automation }, { qrId, invoiceId, pay }) {
  const eventKey = "razorpay:" + pay.id;
  if ((await store.webhookEvents.findBy("eventKey", eventKey)) || (await store.payments.findBy("external", pay.id))) return { duplicate: true };
  const inv = invoiceId ? await store.invoices.get(invoiceId) : null;
  const recognised = inv && (inv.upiQr?.id === qrId || inv.upiQrHistory?.some((q) => q.id === qrId));
  if (!recognised || inv.status === "void") {
    await holdForReconciliation(store, pay, { qrId, reference: "invoiceId", documentId: invoiceId });
    return { reconciliationRequired: true };
  }
  const out = await recordPayment(store, inv, { amount: pay.amount, mode: "razorpay", method: "upi", reference: pay.id, notes: "Counter UPI QR", by: "razorpay", external: pay.id });
  if (inv.upiQr?.id === qrId) await store.invoices.update(inv.id, { upiQr: { ...inv.upiQr, status: "paid", paymentId: pay.id }, updatedAt: now() });
  await logActivity(store, { entity: "invoice", entityId: inv.id, text: `UPI QR paid (${pay.vpa || pay.id})`, by: "razorpay" });
  await store.webhookEvents.insert({ eventKey, status: "processed", paymentId: pay.id, qrId, amount: pay.amount, invoiceId: inv.id, createdAt: now() });
  await automation.on.paymentReceived(out.invoice, out.payment);
  return { ok: true };
}
