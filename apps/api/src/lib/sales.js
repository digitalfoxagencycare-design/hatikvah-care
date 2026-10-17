import crypto from "node:crypto";
import { addDays, calcTotals, nextNumber, stateName, todayIST } from "./gst.js";
import { getSettings } from "../model.js";

/** Shared business rules for quotes, orders, invoices, payments and stock. Routes and automations both call these. */
export const now = () => new Date().toISOString();
export const token = () => crypto.randomBytes(18).toString("base64url");

export function customerSnapshot(c) {
  return { name: c.name, contactName: c.contactName || "", phone: c.phone || "", email: c.email || "", gstin: c.gstin || "", stateCode: c.stateCode || "", state: stateName(c.stateCode || ""), billingAddress: c.billingAddress || "", shippingAddress: c.shippingAddress || c.billingAddress || "" };
}

/** Builds the money part of a document: place of supply decides CGST+SGST (same state) or IGST (other state). */
export async function priced(store, { items, customer, placeOfSupply }) {
  const s = await getSettings(store);
  const pos = placeOfSupply || customer.stateCode || s.stateCode;
  const interState = pos !== s.stateCode;
  const { lines, totals } = calcTotals(items, interState);
  return { items: lines, totals, interState, placeOfSupply: pos, placeOfSupplyName: stateName(pos) };
}

/** Rate for a customer: their price list's fixed price, else list price minus the price list discount. */
export async function rateFor(store, customer, product) {
  const pl = customer?.priceListId ? await store.priceLists.get(customer.priceListId) : null;
  if (pl?.prices?.[product.id] != null) return pl.prices[product.id];
  if (product.price == null) return 0;
  return Math.round(product.price * (1 - (pl?.discountPct || 0) / 100));
}

export async function stockLevels(store) {
  const moves = await store.stockMoves.all();
  const lv = {};
  for (const m of moves) lv[m.productId] = (lv[m.productId] || 0) + m.qty;
  return lv;
}

export async function moveStock(store, { productId, sku, qty, kind, ref = "", note = "", by = "system" }) {
  return store.stockMoves.insert({ productId, sku, qty, kind, ref, note, by, at: now() });
}

export async function logActivity(store, { entity, entityId, kind = "system", text, by = "system" }) {
  return store.activities.insert({ entity, entityId, kind, text, by, at: now() });
}

export async function createOrderFromQuote(store, quote, by) {
  const number = await nextNumber(store, "SO");
  const order = await store.orders.insert({
    number, token: token(), quoteId: quote.id, quoteNumber: quote.number, customerId: quote.customerId, customer: quote.customer, items: quote.items, totals: quote.totals,
    interState: quote.interState, placeOfSupply: quote.placeOfSupply, placeOfSupplyName: quote.placeOfSupplyName, poNumber: "", status: "confirmed",
    expectedDate: "", notes: quote.notes || "", dispatch: null, challanNumber: "", invoiceId: "", createdBy: by, createdAt: now(), updatedAt: now(),
  });
  await store.quotes.update(quote.id, { status: "converted", orderId: order.id, updatedAt: now() });
  await logActivity(store, { entity: "quote", entityId: quote.id, text: `Converted to order ${number}`, by });
  return order;
}

export async function createInvoice(store, { customer, items, placeOfSupply, date, dueDate, notes = "", poNumber = "", orderId = "", orderNumber = "", by }) {
  const s = await getSettings(store);
  const d = date || todayIST();
  const doc = await priced(store, { items, customer, placeOfSupply });
  const number = await nextNumber(store, "INV", new Date(d + "T12:00:00Z"));
  const inv = await store.invoices.insert({
    number, token: token(), date: d, dueDate: dueDate || addDays(d, customer.paymentTermsDays ?? s.paymentTermsDays), customerId: customer.id, customer: customerSnapshot(customer),
    orderId, orderNumber, poNumber, ...doc, notes, status: "unpaid", amountPaid: 0, payLink: null, remindersSent: [], createdBy: by, createdAt: now(), updatedAt: now(),
  });
  if (orderId) await store.orders.update(orderId, { invoiceId: inv.id, invoiceNumber: number, updatedAt: now() });
  return inv;
}

/** Re-adds the payments of an invoice and sets paid / partial / unpaid. */
export async function refreshInvoice(store, invoiceId) {
  const inv = await store.invoices.get(invoiceId);
  if (!inv || inv.status === "void") return inv;
  const paid = (await store.payments.all()).filter((p) => p.invoiceId === invoiceId).reduce((n, p) => n + p.amount, 0);
  const status = paid >= inv.totals.total ? "paid" : paid > 0 ? "partial" : "unpaid";
  return store.invoices.update(invoiceId, { amountPaid: paid, status, paidAt: status === "paid" ? inv.paidAt || now() : null, updatedAt: now() });
}

export async function recordPayment(store, inv, { amount, date, mode, reference = "", notes = "", by, external = "" }) {
  const p = await store.payments.insert({ invoiceId: inv.id, invoiceNumber: inv.number, customerId: inv.customerId, customerName: inv.customer.name, amount, date: date || todayIST(), mode, reference, notes, external, by, createdAt: now() });
  await logActivity(store, { entity: "invoice", entityId: inv.id, text: `Payment ₹${(amount / 100).toFixed(2)} received (${mode}${reference ? " " + reference : ""})`, by });
  return { payment: p, invoice: await refreshInvoice(store, inv.id) };
}

export const balance = (inv) => (inv.status === "void" ? 0 : inv.totals.total - (inv.amountPaid || 0));
