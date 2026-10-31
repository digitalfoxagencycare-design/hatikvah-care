import crypto from "node:crypto";
import { invoiceLines, postJournal } from "./accounting.js";
import { safePaise, roundMoneyProduct } from "./money.js";
import { addDays, calcTotals, finYear, nextNumber, stateName, todayIST } from "./gst.js";
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
  let lines, totals;
  try { ({ lines, totals } = calcTotals(ex.items, interState)); } catch (e) { if (e instanceof RangeError) throw userError(e.message); throw e; }
  return { items: lines, totals, interState, placeOfSupply: pos, placeOfSupplyName: stateName(pos) };
}

/** Rate for a customer: their price list's fixed price, else list price minus the price list discount. */
export async function rateFor(store, customer, product) {
  const pl = customer?.priceListId ? await store.priceLists.get(customer.priceListId) : null;
  if (pl?.prices?.[product.id] != null) return pl.prices[product.id];
  if (product.price == null) return 0;
  return roundMoneyProduct(product.price, 100 - (pl?.discountPct || 0), 100);
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
export function deductForInvoice(store, ...args) { return store.atomic(() => deductForInvoiceCore(store, ...args)); }
async function deductForInvoiceCore(store, inv, by) {
  inv=(await store.invoices.get(inv.id))||inv;
  if(inv.stockConsumedAt)return;
  const order=inv.orderId?await store.orders.get(inv.orderId):null;
  if (order && (order.stockConsumedAt || ["dispatched", "delivered"].includes(order.status))) {
    if(inv.id)await store.invoices.update(inv.id,{stockConsumedAt:order.stockConsumedAt||now(),stockAllocations:order.stockAllocations||[],allocationStatus:order.stockAllocations?'verified':'legacy_unverified'});
    return;
  }
  const stockAllocations=await consumeStock(store,inv.items||[],{ref:inv.number,by,excludeOrderId:inv.orderId});
  if(inv.id)await store.invoices.update(inv.id,{stockConsumedAt:now(),stockAllocations,allocationStatus:'verified'});
}

export async function logActivity(store, { entity, entityId, kind = "system", text, by = "system" }) {
  return store.activities.insert({ entity, entityId, kind, text, by, at: now() });
}

export function createOrderFromQuote(store, ...args) { return store.atomic(() => createOrderFromQuoteCore(store, ...args)); }
async function createOrderFromQuoteCore(store, quote, by) {
  quote = (await store.quotes.get(quote.id)) || quote;
  if (quote.orderId) return store.orders.get(quote.orderId);
  if (!["draft", "sent", "accepted"].includes(quote.status)) throw userError("Quote cannot become an order",409);
  await assertStockAvailable(store, quote.items);
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

const last10 = (phone) => String(phone || "").replace(/\D/g, "").slice(-10);
/** The customer behind a document. If the record is gone, the copy saved on the document finds them by GSTIN, phone or name, or brings them back. */
export async function resolveCustomer(store, doc) {
  const c = doc.customerId ? await store.customers.get(doc.customerId) : null;
  if (c) return c;
  const s = doc.customer;
  if (!s?.name) return null;
  const all = await store.customers.all();
  const phone = last10(s.phone), name = s.name.trim().toLowerCase();
  const match = (s.gstin && all.find((x) => x.gstin === s.gstin)) || (phone.length === 10 && all.find((x) => last10(x.phone) === phone)) || all.find((x) => x.name.trim().toLowerCase() === name);
  return match || store.customers.insert({ name: s.name, contactName: s.contactName || "", phone: s.phone || "", email: s.email || "", gstin: s.gstin || "", stateCode: s.stateCode || (s.gstin ? s.gstin.slice(0, 2) : ""), city: "", billingAddress: s.billingAddress || "", shippingAddress: s.shippingAddress || s.billingAddress || "",
    priceListId: "", paymentTermsDays: 30, reorderDays: 0, tags: [], notes: "", assignedTo: "", followUpAt: "", source: "restored", createdAt: now(), updatedAt: now() });
}

async function bookingCustomer(store, e, d, address) {
  if (d.customerId) { const c = await store.customers.get(d.customerId); if (!c) throw userError("Customer not found", 404); return c; }
  let c = e.customerId ? await store.customers.get(e.customerId) : null;
  if (!c && !d.customer) {
    const digits = e.phone.replace(/\D/g, "").slice(-10);
    c = (await store.customers.all()).find((x) => x.phone && x.phone.replace(/\D/g, "").slice(-10) === digits) || null;
  }
  if (c) return c;
  const n = d.customer || {};
  return store.customers.insert({ name: n.name || e.company || e.name, contactName: n.contactName || e.name, phone: n.phone || e.phone, email: n.email || e.email, gstin: n.gstin || "", stateCode: n.stateCode || (n.gstin ? n.gstin.slice(0, 2) : ""), city: "", billingAddress: address, shippingAddress: address,
    priceListId: "", paymentTermsDays: 30, reorderDays: 0, tags: [], notes: "", assignedTo: e.assignedTo || "", followUpAt: "", source: e.source?.utm_source || "website", createdAt: now(), updatedAt: now() });
}

/**
 * Enquiry → customer → confirmed sales order, all or nothing. The confirmed order is what holds the stock (reservesStock).
 * Booking again returns the same order. An open quote blocks it: accepting that quote later would sell the goods twice.
 */
export function bookEnquiry(store, ...args) { return store.atomic(() => bookEnquiryCore(store, ...args)); }
async function bookEnquiryCore(store, enquiryId, d, by) {
  const e = await store.enquiries.get(enquiryId);
  if (!e) throw userError("Enquiry not found", 404);
  const prior = e.orderId ? await store.orders.get(e.orderId) : null;
  if (prior && prior.status !== "cancelled") return { enquiry: e, order: prior, duplicate: true };
  if (e.status === "closed") throw userError("This enquiry is closed. Reopen it before booking", 409);
  const quote = e.quoteId ? await store.quotes.get(e.quoteId) : null;
  if (quote && !["rejected", "expired"].includes(quote.status)) throw userError(`Quotation ${quote.number} is open on this enquiry. Use it, or reject it before booking`, 409);
  const address = d.pincode && !d.deliveryAddress.includes(d.pincode) ? `${d.deliveryAddress} - ${d.pincode}` : d.deliveryAddress;
  let c = await bookingCustomer(store, e, d, address);
  if (!c.shippingAddress) c = await store.customers.update(c.id, { shippingAddress: address, updatedAt: now() });
  const doc = await priced(store, { items: d.items, customer: c, placeOfSupply: d.placeOfSupply });
  await assertStockAvailable(store, doc.items);
  const number = await nextNumber(store, "SO");
  const order = await store.orders.insert({ number, token: token(), quoteId: "", quoteNumber: "", enquiryId: e.id, enquiryRef: e.ref, source: "enquiry", customerId: c.id, customer: { ...customerSnapshot(c), shippingAddress: address }, ...doc,
    poNumber: d.poNumber, status: "confirmed", expectedDate: d.expectedDate, notes: d.notes, dispatch: null, challanNumber: "", invoiceId: "", createdBy: by, createdAt: now(), updatedAt: now() });
  const enquiry = await store.enquiries.update(e.id, { customerId: c.id, orderId: order.id, orderNumber: number, status: "won", lastActivityAt: now() });
  await logActivity(store, { entity: "enquiry", entityId: e.id, text: `Booked as order ${number}`, by });
  await logActivity(store, { entity: "order", entityId: order.id, text: `Booked from enquiry ${e.ref}`, by });
  await logActivity(store, { entity: "customer", entityId: c.id, text: `Order ${number} created`, by });
  return { enquiry, order };
}

/**
 * The customer accepts or rejects a sent quotation (from the document link or the buyer portal). A quote past its validity
 * date counts as expired even before the scheduled job marks it. Accepting runs the "quote accepted" automation, which
 * raises the sales order. Returns { quote } or { error: { status, message } }.
 */
export function respondToQuote(store, ...args) { return store.atomic(() => respondToQuoteCore(store, ...args)); }
async function respondToQuoteCore(store, automation, q, { action, name = "", note = "", via = "online" }) {
  q = (await store.quotes.get(q.id)) || q;
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

export function createInvoice(store, ...args) { return store.atomic(() => createInvoiceCore(store, ...args)); }
async function createInvoiceCore(store, { customer, items, placeOfSupply, date, dueDate, notes = "", poNumber = "", orderId = "", orderNumber = "", quoteId = "", by }) {
  const s = await getSettings(store);
  const d = date || todayIST();
  const order = orderId ? await store.orders.get(orderId) : null;
  if (order?.invoiceId) return store.invoices.get(order.invoiceId);
  if (order?.status === 'cancelled') throw userError('A cancelled order cannot be invoiced',409);
  const quote = quoteId ? await store.quotes.get(quoteId) : null;
  if (quote?.invoiceId) return store.invoices.get(quote.invoiceId);
  if (quote && !['draft','sent','accepted','converted'].includes(quote.status)) throw userError('Quote cannot be invoiced',409);
  let doc;
  if (order || quote) {
    const snapshot=order||quote;
    doc={items:structuredClone(snapshot.items),totals:structuredClone(snapshot.totals),interState:!!snapshot.interState,placeOfSupply:snapshot.placeOfSupply,placeOfSupplyName:snapshot.placeOfSupplyName};
    customer={...customer,...snapshot.customer,id:snapshot.customerId};
  } else doc = await priced(store, { items, customer, placeOfSupply });
  const number = await nextNumber(store, "INV", new Date(d + "T12:00:00Z"));
  const inv = await store.invoices.insert({
    number, token: token(), date: d, dueDate: dueDate || addDays(d, customer.paymentTermsDays ?? s.paymentTermsDays), customerId: customer.id, customer: customerSnapshot(customer),
    orderId, orderNumber, poNumber, ...doc, notes, status: "unpaid", amountPaid: 0, payLink: null, remindersSent: [], createdBy: by, createdAt: now(), updatedAt: now(),
  });
  if (orderId) await store.orders.update(orderId, { invoiceId: inv.id, invoiceNumber: number, updatedAt: now() });
  if (quote) await store.quotes.update(quote.id,{invoiceId:inv.id,invoiceNumber:number,status:'accepted',updatedAt:now()});
  const lines=invoiceLines(inv.totals);
  if(lines.length) await postLedger(store,{sourceKey:'invoice:'+inv.id,kind:'invoice',account:'accounts_receivable',amount:inv.totals.total,invoiceId:inv.id,ref:inv.number,date:inv.date,party:inv.customer.name,by,lines});
  await deductForInvoice(store,inv,by);
  return (await store.invoices.get(inv.id)) || inv;
}

/** GST invoice for a paid website order (raised only once the money arrives, so abandoned checkouts never become invoices). Takes stock out, as dispatch then skips it. */
export function invoiceWebsiteOrder(store, ...args) { return store.atomic(() => invoiceWebsiteOrderCore(store, ...args)); }
async function invoiceWebsiteOrderCore(store, order) {
  order = (await store.orders.get(order.id)) || order;
  if (order.invoiceId) return store.invoices.get(order.invoiceId);
  const customer = { ...(await store.customers.get(order.customerId)), ...order.customer, id: order.customerId, paymentTermsDays: 0 };
  const inv = await createInvoice(store, { customer, items: order.items.map(({ amount, tax, total, ...l }) => l), placeOfSupply: order.placeOfSupply, notes: order.notes,
    orderId: order.id, orderNumber: order.number, by: "website" });
  return inv;
}

/** Re-adds the payments and credit notes of an invoice and sets paid / credited / partial / unpaid. */
export function refreshInvoice(store, ...args) { return store.atomic(() => refreshInvoiceCore(store, ...args)); }
async function refreshInvoiceCore(store, invoiceId) {
  const inv = await store.invoices.get(invoiceId);
  if (!inv) return inv;
  const paid = safePaise(Number((await store.payments.all()).filter((p) => p.invoiceId === invoiceId && !p.reversedAt).reduce((n, p) => n + BigInt(p.amount), 0n)));
  const credited = inv.creditedAmount || 0, total = inv.totals.total;
  if (inv.status === 'void') return store.invoices.update(invoiceId, { amountPaid: paid, updatedAt: now() });
  const status = paid + credited >= total ? (paid === 0 ? "credited" : "paid") : paid + credited > 0 ? "partial" : "unpaid";
  return store.invoices.update(invoiceId, { amountPaid: paid, status, paidAt: status === "paid" ? inv.paidAt || now() : null, updatedAt: now() });
}

export function recordPayment(store, ...args) { return store.atomic(() => recordPaymentCore(store, ...args)); }
async function recordPaymentCore(store, inv, { amount, date, mode, reference = "", notes = "", by, external = "" }) {
  inv=(await store.invoices.get(inv.id))||inv;
  try { safePaise(amount); } catch { throw userError('Payment must be safe-integer paise'); }
  if (amount <= 0) throw userError('Payment must be positive');
  if(external){const old=await store.payments.findBy('external',external);if(old){if(old.invoiceId!==inv.id||old.amount!==amount)throw userError('External payment identity mismatch',409);return{payment:old,invoice:await store.invoices.get(inv.id),duplicate:true};}}
  if(!external && (inv.status==='void'||amount>balance(inv)))throw userError('Payment exceeds current balance or invoice is void',409);
  const appliedAmount=Math.min(amount,balance(inv)),unappliedAmount=amount-appliedAmount;
  const p = await store.payments.insert({ invoiceId: inv.id, invoiceNumber: inv.number, customerId: inv.customerId, customerName: inv.customer.name, amount, appliedAmount, unappliedAmount, reconciliationStatus:unappliedAmount?'refund_or_allocation_required':'allocated', date: date || todayIST(), mode, reference, notes, external, by, createdAt: now() });
  const receiptLines=[{account:ledgerAccount(mode),debit:amount,credit:0},...(appliedAmount?[{account:'accounts_receivable',debit:0,credit:appliedAmount}]:[]),...(unappliedAmount?[{account:'customer_credits',debit:0,credit:unappliedAmount}]:[])];
  await postLedger(store, { sourceKey: "payment:" + p.id, lines: receiptLines, date: p.date, account: ledgerAccount(mode), kind: "receipt", amount, ref: inv.number, paymentId: p.id, invoiceId: inv.id, party: inv.customer.name, narration: `${mode}${reference ? " " + reference : ""}`, by });
  await logActivity(store, { entity: "invoice", entityId: inv.id, text: `Payment ₹${(amount / 100).toFixed(2)} received (${mode}${reference ? " " + reference : ""})`, by });
  return { payment: p, invoice: await refreshInvoice(store, inv.id) };
}

/** Cash and bank book. Every payment received posts a receipt; removing the payment posts nothing but deletes its entry. */
export const ledgerAccount = (mode) => (mode === "cash" ? "cash" : mode === "razorpay" ? "razorpay" : "bank");
export async function postLedger(store,e) {
  const amount=e.amount ?? 0;
  let lines=e.lines;
  if(!lines && e.contraAccount && ['receipt','payment'].includes(e.kind)) {
    const debit=e.kind==='receipt'?e.account:e.contraAccount, credit=e.kind==='receipt'?e.contraAccount:e.account;
    lines=[{account:debit,debit:amount,credit:0},{account:credit,debit:0,credit:amount}];
  }
  const { id: ignoredId, _id: ignoredMongo, ...entry } = e;
  return postJournal(store,{...entry,lines,date:e.date||todayIST(),sourceKey:e.sourceKey||'manual:'+token(),account:e.account||'',kind:e.kind||'journal',amount,ref:e.ref||'',paymentId:e.paymentId||'',invoiceId:e.invoiceId||'',party:e.party||'',narration:e.narration||'',by:e.by||'system'});
}
export function removePaymentLedger(store,paymentId,by='system') {
  return store.atomic(async()=>{
    const p=await store.payments.get(paymentId);if(!p||p.reversedAt)return p;
    if(p.external && p.mode==='razorpay')throw userError('Captured gateway payments require the provider refund/reconciliation workflow',409);
    const original=await store.ledger.findBy('sourceKey','payment:'+paymentId) || await store.ledger.findBy('paymentId',paymentId);
    if(!original?.lines)throw userError('Legacy payment requires reconciled journal migration before reversal',409);
    await postLedger(store,{...original,id:undefined,sourceKey:'payment-reversal:'+paymentId,reversalOf:original.id,kind:'payment',lines:original.lines.map(l=>({...l,debit:l.credit,credit:l.debit})),date:todayIST(),by});
    await store.payments.update(paymentId,{reversedAt:now(),reversedBy:by});await refreshInvoice(store,p.invoiceId);return p;
  });
}

/** What the customer still owes: total less payments and credit notes (never below zero; see refundDue). */
export const balance = (inv) => (inv.status === "void" ? 0 : Math.max(0, inv.totals.total - (inv.amountPaid || 0) - (inv.creditedAmount || 0)));
/** Money to give back when credit notes land on an invoice that was already paid. */
export const refundDue = (inv) => (inv.status === "void" ? (inv.amountPaid || 0) : Math.max(0, (inv.amountPaid || 0) + (inv.creditedAmount || 0) - inv.totals.total));

// ---------- credit notes (sales returns and price adjustments)
export const CREDIT_REASONS = ["damaged", "incorrect_item", "return", "pricing_adjustment", "other"];
/** Goods that come back sellable go back into stock unless staff say otherwise; damaged goods and price adjustments do not. */
export const restocksByDefault = (reason) => reason === "return" || reason === "incorrect_item";

/** CN-26-0001: one sequence per financial year (26 = FY 2026-27), 10 characters (GST allows 16). */
export async function creditNoteNumber(store, d = new Date()) {
  const fy = finYear(d);
  return `CN-${fy.slice(2, 4)}-${String(await store.nextSeq(`CN:${fy}`)).padStart(4, "0")}`;
}

/**
 * Issues a GST credit note against an invoice. Lines point at invoice lines (`line` = index), so the HSN, GST rate, unit,
 * pieces per unit and discount come from the invoice; the rate may be lowered (price adjustment) but never raised.
 * Caps: a line cannot be credited for more value than it was invoiced, and goods cannot be returned twice.
 * Restocked goods move back into physical stock in pieces (batch-tracked products need the batch they came from).
 * Posts a `credit_notes` ledger row and reduces the invoice balance. Returns { creditNote } or throws a userError.
 */
export function createCreditNote(store, ...args) { return store.atomic(() => createCreditNoteCore(store, ...args)); }
async function createCreditNoteCore(store, inv, d, by) {
  // The enclosing store transaction serializes caps, stock, invoice aggregates and journal posting.
  if (inv?.id) inv = (await store.invoices.get(inv.id)) || inv;
  if (!inv || inv.status === "void") throw userError("A void invoice cannot get a credit note", 409);
  if (d.reason === "pricing_adjustment" && d.restock === true) throw userError("Pricing adjustments cannot restock goods");
  if (d.reason === 'damaged' && d.restock === true) throw userError('Damaged goods must be quarantined, not returned to sellable stock');
  const prior = (await store.creditNotes.all()).filter((c) => c.invoiceId === inv.id);
  const done = {}; // per invoice line: value already credited, quantity already returned
  for (const c of prior) for (const l of c.items) {
    const x = (done[l.line] ||= { amount: 0, qty: 0 });
    x.amount += l.amount; if (c.reason !== "pricing_adjustment") x.qty += l.qty;
  }
  const restock = d.restock ?? restocksByDefault(d.reason);
  const lines = [], seen = new Set();
  for (const it of d.items) {
    const L = inv.items[it.line];
    if (!L) throw userError("That line is not on the invoice");
    if (seen.has(it.line)) throw userError(`${L.name} is listed twice`);
    seen.add(it.line);
    const x = done[it.line] || { amount: 0, qty: 0 };
    if (d.reason !== "pricing_adjustment" && it.qty > L.qty - x.qty) throw userError(`Only ${L.qty - x.qty} ${L.unit || "pcs"} of ${L.name} can still be credited`);
    if (it.qty > L.qty) throw userError(`${L.name} was invoiced for ${L.qty} ${L.unit || "pcs"}`);
    const rate = it.rate ?? L.rate;
    if (rate > L.rate) throw userError(`The credit rate for ${L.name} cannot be more than the invoiced rate`);
    const p = restock && L.productId ? await store.products.get(L.productId) : null;
    if (p?.batchTracked && !it.batch) throw userError(`${L.name} is batch tracked: enter the batch number being returned`);
    let originalBatch = it.batch || null;
    if (p?.batchTracked) {
      const sold = (inv.stockAllocations || []).filter(a => a.line === it.line && a.productId === p.id && a.batch?.batchNumber === it.batch.batchNumber);
      const returned = prior.filter(c => c.restock).flatMap(c => c.items).filter(l => l.line === it.line && l.batch?.batchNumber === it.batch.batchNumber).reduce((n,l)=>n+pieces(l),0);
      if (!sold.length || pieces({ ...L, qty: it.qty }) > sold.reduce((n,a)=>n+a.qty,0)-returned) throw userError('Return exceeds the original sold batch allocation; legacy invoices require reconciliation',409);
      originalBatch = sold[0].batch;
      if (originalBatch.expDate && originalBatch.expDate < todayIST()) throw userError('Expired returns must be quarantined, not restocked',409);
    }
    lines.push({ line: it.line, productId: L.productId || "", sku: L.sku || "", name: L.name, hsn: L.hsn || "", unit: L.unit || "pcs", uom: L.uom || "piece", perUnit: L.perUnit || 1,
      qty: it.qty, rate, discountPct: L.discountPct || 0, gstRate: L.gstRate ?? 0, ...(originalBatch ? { batch: originalBatch } : {}) });
  }
  const { lines: priced_, totals } = calcTotals(lines, !!inv.interState); // GST maths only in gst.js
  // Several partial notes must never reverse more of a tax head than the original invoice posted.
  for (const head of ['cgst','sgst','igst']) totals[head] = Math.min(totals[head], Math.max(0,(inv.totals[head]||0)-prior.reduce((n,c)=>n+(c.totals[head]||0),0)));
  totals.tax = totals.cgst + totals.sgst + totals.igst;
  let excessTax = priced_.reduce((n,l)=>n+l.tax,0)-totals.tax;
  for (const l of [...priced_].reverse()) { const adjustment=Math.min(l.tax,excessTax);l.tax-=adjustment;l.total=l.amount+l.tax;excessTax-=adjustment; }
  const exactCredit=totals.taxable+totals.tax;
  totals.total=roundMoneyProduct(exactCredit,1,100)*100;totals.roundOff=totals.total-exactCredit;
  for (const l of priced_) {
    const x = done[l.line] || { amount: 0 }, L = inv.items[l.line];
    if (x.amount + l.amount > (L.amount ?? Math.round(L.qty * L.rate))) throw userError(`${L.name}: this would credit more than was invoiced`);
  }
  const left = inv.totals.total - (inv.creditedAmount || 0);
  if (totals.total > left) { // rupee rounding over several notes: the last one takes only what is left
    if (totals.total - left >= 100) throw userError("This would credit more than the invoice total");
    totals.roundOff -= totals.total - left; totals.total = left;
  }
  if (totals.total <= 0) throw userError("The credit note total must be more than zero");
  const date = d.date || todayIST();
  const cn = await store.creditNotes.insert({
    number: await creditNoteNumber(store, new Date(date + "T12:00:00Z")), token: token(), date, invoiceId: inv.id, invoiceNumber: inv.number, invoiceDate: inv.date,
    customerId: inv.customerId, customer: inv.customer, placeOfSupply: inv.placeOfSupply, placeOfSupplyName: inv.placeOfSupplyName, interState: !!inv.interState,
    reason: d.reason, restock, items: priced_, totals, notes: d.notes || "", createdBy: by, createdAt: now(),
  });
  if (restock) for (const l of priced_) {
    const p = l.productId ? await store.products.get(l.productId) : null;
    if (!p) continue;
    if (!p.stockTracked) await store.products.update(p.id, { stockTracked: true });
    await moveStock(store, { productId: p.id, sku: p.sku, qty: pieces(l), kind: "in", ref: cn.number, note: `Sales return (credit note ${cn.number} on ${inv.number})`, by, batch: l.batch || null });
  }
  await store.invoices.update(inv.id, { creditedAmount: (inv.creditedAmount || 0) + totals.total, creditNotes: [...(inv.creditNotes || []), { id: cn.id, number: cn.number }], updatedAt: now() });
  const fresh = await refreshInvoice(store, inv.id);
  const reversalLines=invoiceLines(totals,true),receivableCredit=Math.min(totals.total,balance(inv)),customerCredit=totals.total-receivableCredit;
  const creditLines=reversalLines.filter(l=>l.account!=='accounts_receivable');
  if(receivableCredit)creditLines.push({account:'accounts_receivable',debit:0,credit:receivableCredit});
  if(customerCredit)creditLines.push({account:'customer_credits',debit:0,credit:customerCredit});
  await postLedger(store, { sourceKey: "credit-note:" + cn.id, lines: creditLines, date, account: "credit_notes", kind: "credit_note", amount: totals.total, ref: cn.number, invoiceId: inv.id, party: inv.customer.name,
    narration: `Credit note on ${inv.number} (${d.reason.replace(/_/g, " ")}): sales reversed${refundDue(fresh) ? `, refund due ₹${(refundDue(fresh) / 100).toFixed(2)}` : ""}`, by });
  await logActivity(store, { entity: "invoice", entityId: inv.id, text: `Credit note ${cn.number} issued for ₹${(totals.total / 100).toFixed(2)} (${d.reason.replace(/_/g, " ")}${restock ? ", goods back in stock" : ""})`, by });
  await logActivity(store, { entity: "customer", entityId: inv.customerId, text: `Credit note ${cn.number} on invoice ${inv.number}`, by });
  return { creditNote: cn, invoice: fresh };
}

/** Must run inside the same atomic unit that creates/reserves the order. */
export async function assertStockAvailable(store,items,excludeOrderId='') {
  const buckets=await stockBuckets(store);const own=excludeOrderId?await store.orders.get(excludeOrderId):null;
  const needed={};for(const it of items)if(it.productId)needed[it.productId]=(needed[it.productId]||0)+pieces(it);
  for(const[id,qty]of Object.entries(needed)){const p=await store.products.get(id);if(!p?.stockTracked)continue;const reservedOwn=own&&reservesStock(own)?own.items.filter(l=>l.productId===id).reduce((n,l)=>n+pieces(l),0):0;if(qty>bucketOf(buckets,id).available+reservedOwn)throw userError(p.name+' has insufficient available stock',409);}
}

/** Persist the exact batch/line movements at sale time; returns must reference these allocations. */
export function consumeStock(store,items,{ref,by='system',excludeOrderId=''}={}) {
  return store.atomic(async()=>{
    await assertStockAvailable(store,items,excludeOrderId);
    const allocations=[];
    for(const [line,it]of items.entries()){
      const p=it.productId?await store.products.get(it.productId):null;if(!p?.stockTracked)continue;
      let left=pieces(it);
      const batches=p.batchTracked?batchLevels(await store.stockMoves.all()).filter(b=>b.productId===p.id&&(!b.expDate||b.expDate>=todayIST())):[{qty:left,batchNumber:null}];
      if(p.batchTracked&&batches.reduce((n,b)=>n+b.qty,0)<left)throw userError(p.name+' has insufficient non-expired batch stock',409);
      for(const b of batches){if(left<=0)break;const qty=Math.min(left,b.qty),batch=b.batchNumber?{batchNumber:b.batchNumber,mfgDate:b.mfgDate||'',expDate:b.expDate||''}:null;
        const move=await store.stockMoves.insert({productId:p.id,sku:p.sku,qty:-qty,kind:'out',ref,note:'Goods issued',by,at:now(),line,...(batch?{batch}:{})});
        allocations.push({line,productId:p.id,qty,batch,moveId:move.id});left-=qty;
      }
    }
    return allocations;
  });
}
