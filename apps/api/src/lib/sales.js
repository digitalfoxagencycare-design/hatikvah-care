import crypto from "node:crypto";
import { addDays, calcTotals, nextNumber, stateName, todayIST } from "./gst.js";
import { getSettings } from "../model.js";
import { expandLines, pieces } from "./units.js";

/** Shared business rules for quotes, orders, invoices, payments and stock. Routes and automations both call these. */
export const now = () => new Date().toISOString();
export const token = () => crypto.randomBytes(18).toString("base64url");
/** A mistake in what was sent (shown to the person as a 400), as opposed to a server fault. */
export const userError = (message, status = 400) => Object.assign(new Error(message), { status, userError: true });

export function customerSnapshot(c) {
  return { name: c.name, contactName: c.contactName || "", phone: c.phone || "", email: c.email || "", gstin: c.gstin || "", stateCode: c.stateCode || "", state: stateName(c.stateCode || ""), billingAddress: c.billingAddress || "", shippingAddress: c.shippingAddress || c.billingAddress || "" };
}

/** Builds the money part of a document: place of supply decides CGST+SGST (same state) or IGST (other state). */
export async function priced(store, { items, customer, placeOfSupply }) {
  const s = await getSettings(store);
  const pos = placeOfSupply || customer.stateCode || s.stateCode;
  const interState = pos !== s.stateCode;
  const ids = [...new Set(items.map((i) => i.productId).filter(Boolean))];
  const byId = Object.fromEntries((await Promise.all(ids.map((id) => store.products.get(id)))).filter(Boolean).map((p) => [p.id, p]));
  const ex = expandLines(items, byId);
  if (ex.error) throw userError(ex.error);
  const { lines, totals } = calcTotals(ex.items, interState);
  return { items: lines, totals, interState, placeOfSupply: pos, placeOfSupplyName: stateName(pos) };
}

/** Rate for a customer: their price list's fixed price, else list price minus the price list discount. */
export async function rateFor(store, customer, product) {
  const pl = customer?.priceListId ? await store.priceLists.get(customer.priceListId) : null;
  if (pl?.prices?.[product.id] != null) return pl.prices[product.id];
  if (product.price == null) return 0;
  return Math.round(product.price * (1 - (pl?.discountPct || 0) / 100));
}

/** Website price for a quantity: the highest bulk tier the quantity reaches, else the list price. The web product page mirrors this for display. */
export function tierPrice(product, qty) {
  let rate = product.price;
  for (const t of product.priceTiers || []) if (qty >= t.minQty) rate = t.price;
  return rate;
}

/** Physical stock (pieces on the warehouse floor) per product, from the ledger of movements. */
export async function stockLevels(store) {
  const moves = await store.stockMoves.all();
  const lv = {};
  for (const m of moves) lv[m.productId] = (lv[m.productId] || 0) + m.qty;
  return lv;
}

/** Orders that hold stock: confirmed or packed, not cancelled, not yet invoiced or dispatched (those take the stock out). */
export const reservesStock = (o) => ["confirmed", "packed"].includes(o.status) && !o.invoiceId;

/** physical, reserved (in open sales orders) and available = physical - reserved, in pieces, per product id. */
export async function stockBuckets(store) {
  const [physical, orders] = await Promise.all([stockLevels(store), store.orders.all()]);
  const reserved = {};
  for (const o of orders.filter(reservesStock)) for (const it of o.items) if (it.productId) reserved[it.productId] = (reserved[it.productId] || 0) + pieces(it);
  const out = {};
  for (const id of new Set([...Object.keys(physical), ...Object.keys(reserved)])) {
    const ph = physical[id] || 0, rs = reserved[id] || 0;
    out[id] = { physical: ph, reserved: rs, available: ph - rs };
  }
  return out;
}
export const bucketOf = (b, id) => b[id] || { physical: 0, reserved: 0, available: 0 };
/** Low stock is judged on what can still be sold (available), not on what is on the floor. */
export const isLow = (p, b) => !!p.stockTracked && bucketOf(b, p.id).available <= (p.reorderLevel || 0);

export async function moveStock(store, { productId, sku, qty, kind, ref = "", note = "", by = "system", batch = null }) {
  return store.stockMoves.insert({ productId, sku, qty, kind, ref, note, by, at: now(), ...(batch ? { batch } : {}) });
}

/**
 * Batch stock (batch number, mfg and expiry dates) from the movements. Stock received with a batch adds to it; a stock-out
 * naming a batch takes from it; any other stock-out is taken first-expiring-first-out (FEFO).
 */
export function batchLevels(moves, today = todayIST()) {
  const byProduct = {};
  const key = (b) => b.batchNumber;
  for (const m of [...moves].sort((a, b) => (a.at < b.at ? -1 : 1))) {
    const list = (byProduct[m.productId] ||= []);
    if (m.qty > 0 && m.batch) {
      let b = list.find((x) => key(x) === key(m.batch));
      if (!b) list.push(b = { ...m.batch, qty: 0 });
      b.qty += m.qty;
    } else if (m.qty < 0) {
      let left = -m.qty;
      const named = m.batch ? list.filter((x) => key(x) === key(m.batch)) : [];
      const fefo = list.filter((x) => x.qty > 0 && !named.includes(x)).sort((a, b) => (a.expDate || "9999") < (b.expDate || "9999") ? -1 : 1);
      for (const b of [...named, ...fefo]) { const take = Math.min(b.qty, left); b.qty -= take; left -= take; if (!left) break; }
    }
  }
  const out = [];
  for (const [productId, list] of Object.entries(byProduct)) for (const b of list) if (b.qty > 0) {
    out.push({ productId, ...b, daysToExpiry: b.expDate ? Math.round((Date.parse(b.expDate) - Date.parse(today)) / 86400_000) : null });
  }
  return out.sort((a, b) => (a.expDate || "9999") < (b.expDate || "9999") ? -1 : 1);
}

/** Takes an invoice's goods out of stock (in pieces) unless its order was already dispatched, which took them out then. */
export async function deductForInvoice(store, inv, by) {
  if (inv.orderId && (await store.orders.get(inv.orderId))?.status === "dispatched") return;
  for (const it of inv.items || []) {
    const p = it.productId ? await store.products.get(it.productId) : null;
    if (!p) continue;
    if (!p.stockTracked) await store.products.update(p.id, { stockTracked: true });
    await moveStock(store, { productId: p.id, sku: p.sku, qty: -Math.abs(pieces(it)), kind: "out", ref: inv.number, note: `Sale invoice ${inv.number}`, by });
  }
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

/**
 * The customer accepts or rejects a sent quotation (from the document link or the buyer portal). A quote past its validity
 * date counts as expired even before the scheduled job marks it. Accepting runs the "quote accepted" automation, which
 * raises the sales order. Returns { quote } or { error: { status, message } }.
 */
export async function respondToQuote(store, automation, q, { action, name = "", note = "", via = "online" }) {
  if (q.status === "sent" && q.validUntil && q.validUntil < todayIST()) {
    await store.quotes.update(q.id, { status: "expired", updatedAt: now() });
    q = { ...q, status: "expired" };
  }
  if (q.status !== "sent") return { error: { status: 409, message: q.status === "expired" ? "This quotation has expired. Please contact us for an updated quote." : `This quotation is already ${q.status}.` } };
  const status = action === "accept" ? "accepted" : "rejected";
  const upd = await store.quotes.update(q.id, { status, [status + "At"]: now(), customerResponse: { name, note, via, at: now() }, updatedAt: now() });
  await logActivity(store, { entity: "quote", entityId: q.id, text: `Customer ${status} ${via}${name ? " (" + name + ")" : ""}${note ? ": " + note : ""}`, by: "customer" });
  if (q.enquiryId) await store.enquiries.update(q.enquiryId, { status: status === "accepted" ? "won" : "closed" });
  if (status === "accepted") await automation.on.quoteAccepted(upd);
  return { quote: (await store.quotes.get(q.id)) || upd };
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

/** GST invoice for a paid website order (raised only once the money arrives, so abandoned checkouts never become invoices). Takes stock out, as dispatch then skips it. */
export async function invoiceWebsiteOrder(store, order) {
  if (order.invoiceId) return store.invoices.get(order.invoiceId);
  const customer = { ...(await store.customers.get(order.customerId)), ...order.customer, id: order.customerId, paymentTermsDays: 0 };
  const inv = await createInvoice(store, { customer, items: order.items.map(({ amount, tax, total, ...l }) => l), placeOfSupply: order.placeOfSupply, notes: order.notes,
    orderId: order.id, orderNumber: order.number, by: "website" });
  for (const it of order.items) {
    const p = it.productId ? await store.products.get(it.productId) : null;
    if (p?.stockTracked) await moveStock(store, { productId: p.id, sku: p.sku, qty: -pieces(it), kind: "out", ref: inv.number, note: `Website order ${order.number}`, by: "website" });
  }
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
  await postLedger(store, { date: p.date, account: ledgerAccount(mode), kind: "receipt", amount, ref: inv.number, paymentId: p.id, invoiceId: inv.id, party: inv.customer.name, narration: `${mode}${reference ? " " + reference : ""}`, by });
  await logActivity(store, { entity: "invoice", entityId: inv.id, text: `Payment ₹${(amount / 100).toFixed(2)} received (${mode}${reference ? " " + reference : ""})`, by });
  return { payment: p, invoice: await refreshInvoice(store, inv.id) };
}

/** Cash and bank book. Every payment received posts a receipt; removing the payment posts nothing but deletes its entry. */
export const ledgerAccount = (mode) => (mode === "cash" ? "cash" : mode === "razorpay" ? "razorpay" : "bank");
export async function postLedger(store, e) {
  return store.ledger.insert({ date: e.date || todayIST(), account: e.account, kind: e.kind, amount: e.amount, ref: e.ref || "", paymentId: e.paymentId || "", invoiceId: e.invoiceId || "",
    party: e.party || "", narration: e.narration || "", by: e.by || "system", createdAt: now() });
}
export async function removePaymentLedger(store, paymentId) {
  const e = await store.ledger.findBy("paymentId", paymentId);
  if (e) await store.ledger.remove(e.id);
}

export const balance = (inv) => (inv.status === "void" ? 0 : inv.totals.total - (inv.amountPaid || 0));
