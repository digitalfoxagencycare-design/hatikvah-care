import { addDays, daysBetween, todayIST } from "./gst.js";
import { balance, createOrderFromQuote, logActivity, now, stockBuckets } from "./sales.js";
import { getSettings } from "../model.js";

/** Every automation the business runs. "event" rules fire when something happens; the others run on the schedule (every few minutes, or daily). */
export const RULES = [
  { id: "enquiryAssign", group: "Leads", when: "event", label: "New enquiry: assign it to the next salesperson in turn (team members marked “receives leads”)" },
  { id: "enquiryAlert", group: "Leads", when: "event", label: "New enquiry: alert the team by email and WhatsApp" },
  { id: "enquiryAck", group: "Leads", when: "event", label: "New enquiry: thank the customer with their reference number" },
  { id: "enquiryStale", group: "Leads", when: "schedule", label: "Enquiry still “new” after the set hours: remind the assigned person and the owner" },
  { id: "followUps", group: "Leads", when: "daily", label: "Every morning: send each person their follow-ups due today" },
  { id: "quoteSend", group: "Quotes", when: "event", label: "Quote sent: message the customer a link to view and accept it" },
  { id: "quoteReminder", group: "Quotes", when: "schedule", label: "Quote not answered after the set days: polite reminder to the customer" },
  { id: "quoteExpire", group: "Quotes", when: "schedule", label: "Quote past its validity date: mark it expired" },
  { id: "quoteAccepted", group: "Quotes", when: "event", label: "Quote accepted: create the sales order and tell the team" },
  { id: "websiteOrder", group: "Orders", when: "event", label: "Website order placed: confirm to the customer and alert the team" },
  { id: "orderBooked", group: "Orders", when: "event", label: "Order booked from an enquiry: send the customer a WhatsApp booking receipt" },
  { id: "orderDispatched", group: "Orders", when: "event", label: "Order dispatched: send the customer the challan and tracking details" },
  { id: "shipmentUpdate", group: "Orders", when: "event", label: "Courier update (Shadowfax): send the customer the live tracking link when the rider picks up, and when delivered" },
  { id: "waBot", group: "WhatsApp", when: "event", label: "Customer messages on WhatsApp: reply with the quick menu (quote request, hotel amenities, clinic supplies) and log the lead" },
  { id: "invoiceSend", group: "Payments", when: "event", label: "Invoice created: send the customer the invoice link (with payment link when Razorpay is on)" },
  { id: "paymentReceipt", group: "Payments", when: "event", label: "Payment received: send a thank-you receipt" },
  { id: "invoiceOverdue", group: "Payments", when: "schedule", label: "Invoice overdue: reminders after the set days past due" },
  { id: "lowStock", group: "Stock", when: "schedule", label: "Stock at or below reorder level: alert the team (once, until restocked)" },
  { id: "reorderNudge", group: "Customers", when: "daily", label: "Regular buyer due to re-order (customer “re-order every N days”): nudge them and the salesperson" },
  { id: "dailySummary", group: "Reports", when: "daily", label: "Every morning: business summary to the owner" },
];
export const DEFAULT_AUTOMATION = {
  key: "automation", enabled: Object.fromEntries(RULES.map((r) => [r.id, true])), alertEmail: "", alertWhatsapp: "",
  staleHours: 24, quoteReminderDays: [3, 7], overdueDays: [1, 7, 15], dailyHour: 9, rrIndex: 0, lastDaily: "", lastRunAt: "", lastResult: null,
};
const money = (p) => "₹" + (p / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function createAutomation({ cfg, store, notifier, log = console }) {
  const base = () => cfg.publicUrl || `http://localhost:${cfg.port}`;
  const docLink = (kind, t) => `${base()}/doc/${kind}/${t}`;

  async function config() { return store.atomic(configCore); }
  async function configCore() {
    const s = await store.settings.findBy("key", "automation");
    if (!s) return { ...(await store.settings.insert(structuredClone(DEFAULT_AUTOMATION))) };
    return { ...DEFAULT_AUTOMATION, ...s, enabled: { ...DEFAULT_AUTOMATION.enabled, ...s.enabled } };
  }
  const isOn = (a, id) => a.enabled[id] !== false;

  /** The team's alert addresses, plus (optionally) one team member. */
  async function teamTargets(a, company, adminId) {
    const t = [];
    const email = a.alertEmail || company.email, wa = a.alertWhatsapp || company.whatsapp;
    if (email) t.push({ channel: "email", to: email }); if (wa) t.push({ channel: "whatsapp", to: wa });
    const person = adminId ? await store.admins.get(adminId) : null;
    if (person?.active) { if (person.email && person.email !== email) t.push({ channel: "email", to: person.email }); if (person.phone) t.push({ channel: "whatsapp", to: person.phone }); }
    return t;
  }
  const toCustomer = (c) => [c.email && { channel: "email", to: c.email }, c.phone && { channel: "whatsapp", to: c.phone }].filter(Boolean);
  async function send(targets, { subject, body, event, ref, button = null, template = null }) { for (const t of targets) await notifier.queue({ ...t, subject, body, event, ref, button, template }); }
  // Template variables for messages outside WhatsApp's 24-hour window (order and meaning: WA_TEMPLATES in notify.js)
  const name = (c) => c.contactName || c.name;
  const quoteTpl = (q) => ({ kind: "quote", params: [name(q.customer), q.number, money(q.totals.total)], button: q.token });
  const invoiceTpl = (inv, amount) => ({ kind: "invoice", params: [name(inv.customer), inv.number, money(amount), inv.dueDate], button: inv.token });
  const dispatchTpl = (o, details) => ({ kind: "dispatch", params: [name(o.customer), o.number, details], button: o.token });

  // ---------- events
  async function enquiryCreated(enq) {
    try {
      const [a, company] = await Promise.all([config(), getSettings(store)]);
      const patch = {};
      const digits = enq.phone.replace(/\D/g, "").slice(-10);
      const cust = (await store.customers.all()).find((c) => c.phone && c.phone.replace(/\D/g, "").slice(-10) === digits);
      if (cust) { patch.customerId = cust.id; if (cust.assignedTo) patch.assignedTo = cust.assignedTo; }
      if (!patch.assignedTo && isOn(a, "enquiryAssign")) {
        const team = (await store.admins.all({ sort: { createdAt: 1 } })).filter((u) => u.active && u.receivesLeads);
        if (team.length) { const u = team[a.rrIndex % team.length]; patch.assignedTo = u.id; await store.settings.update(a.id, { rrIndex: (a.rrIndex + 1) % 10000 }); }
      }
      if (Object.keys(patch).length) await store.enquiries.update(enq.id, patch);
      const items = enq.items.map((i) => `• ${i.qty} x ${i.name}`).join("\n");
      if (isOn(a, "enquiryAlert")) {
        await send(await teamTargets(a, company, patch.assignedTo), { event: "enquiryAlert", ref: enq.ref, subject: `New enquiry ${enq.ref} from ${enq.name}`,
          body: `New enquiry ${enq.ref}\n${enq.name}${enq.company ? ", " + enq.company : ""}\nPhone: ${enq.phone}${enq.email ? "\nEmail: " + enq.email : ""}${items ? "\n" + items : ""}${enq.message ? "\nMessage: " + enq.message : ""}\nOpen: ${base()}/admin/enquiries` });
      }
      if (isOn(a, "enquiryAck") && enq.source?.channel !== "whatsapp") { // WhatsApp leads get their reference from the bot
        await send(toCustomer(enq), { event: "enquiryAck", ref: enq.ref, subject: `We received your enquiry (${enq.ref})`,
          body: `Dear ${enq.name},\nThank you for contacting ${company.name}. Your enquiry reference is ${enq.ref}. Our team will get back to you shortly with availability and pricing.\n${company.phone ? "Call us: " + company.phone : ""}\n– ${company.name}` });
      }
      await notifier.flush();
    } catch (e) { log.error?.("enquiry automation failed", e); }
  }

  async function quoteSent(q) {
    const [a, company] = await Promise.all([config(), getSettings(store)]);
    if (!isOn(a, "quoteSend")) return;
    await send(toCustomer(q.customer), { event: "quoteSend", ref: q.number, subject: `Quotation ${q.number} from ${company.name}`,
      body: `Dear ${q.customer.contactName || q.customer.name},\nPlease find our quotation ${q.number} for ${money(q.totals.total)} (incl. GST)${q.validUntil ? `, valid until ${q.validUntil}` : ""}.\nView and accept online: ${docLink("quote", q.token)}${q.payLink?.url ? `\nPay now to confirm: ${q.payLink.url}` : ""}\n– ${company.name}`,
      button: { label: "View & approve", url: docLink("quote", q.token) }, template: quoteTpl(q) });
    await notifier.flush();
  }

  async function quoteAccepted(q, by = "customer") {
    const [a, company] = await Promise.all([config(), getSettings(store)]);
    let order = null;
    if (isOn(a, "quoteAccepted") && q.status === "accepted") order = await createOrderFromQuote(store, q, by);
    await send(await teamTargets(a, company, (await store.customers.get(q.customerId))?.assignedTo), { event: "quoteAccepted", ref: q.number, subject: `Quote ${q.number} accepted by ${q.customer.name}`,
      body: `${q.customer.name} accepted quotation ${q.number} (${money(q.totals.total)}).${order ? `\nSales order ${order.number} created.` : ""}\nOpen: ${base()}/admin/${order ? "orders/" + order.id : "quotes/" + q.id}` });
    await notifier.flush();
    return order;
  }

  async function websiteOrder(o) {
    const [a, company] = await Promise.all([config(), getSettings(store)]);
    if (!isOn(a, "websiteOrder")) return;
    const pay = o.payment === "online" ? "online payment" : "pay later (we will send the invoice)";
    await send(toCustomer(o.customer), { event: "websiteOrder", ref: o.number, subject: `Order ${o.number} received`,
      body: `Dear ${o.customer.contactName || o.customer.name},\nThank you for your order ${o.number} for ${money(o.totals.total)} (${pay}).\nTrack it at ${base()}/account\n– ${company.name}` });
    await send(await teamTargets(a, company), { event: "websiteOrder", ref: o.number, subject: `New website order ${o.number}`,
      body: `New website order ${o.number} from ${o.customer.name}${o.customer.phone ? " (" + o.customer.phone + ")" : ""}: ${money(o.totals.total)}, ${pay}.\nOpen: ${base()}/admin/orders/${o.id}` });
    await notifier.flush();
  }

  async function orderBooked(o) {
    const [a, company] = await Promise.all([config(), getSettings(store)]);
    if (!isOn(a, "orderBooked") || !o.customer.phone) return;
    await send([{ channel: "whatsapp", to: o.customer.phone }], { event: "orderBooked", ref: o.number, subject: `Order ${o.number} confirmed`,
      body: `Dear ${name(o.customer)},\nYour order ${o.number} for ${money(o.totals.total)} (incl. GST) is confirmed and your goods are reserved. We will send the tracking details when it is dispatched.\n– ${company.name}` });
    await notifier.flush();
  }

  async function orderDispatched(o) {
    const [a, company] = await Promise.all([config(), getSettings(store)]);
    if (!isOn(a, "orderDispatched")) return;
    const d = o.dispatch || {};
    await send(toCustomer(o.customer), { event: "orderDispatched", ref: o.number, subject: `Your order ${o.number} has been dispatched`,
      body: `Dear ${o.customer.contactName || o.customer.name},\nYour order ${o.number} has been dispatched${d.transporter ? ` via ${d.transporter}` : ""}${d.trackingNo ? ` (tracking ${d.trackingNo})` : ""}.${o.shipment?.trackingUrl ? `\nLive tracking: ${o.shipment.trackingUrl}` : ""}\nDelivery challan: ${docLink("challan", o.token)}\n– ${company.name}`,
      button: o.shipment?.trackingUrl ? { label: "Track delivery", url: o.shipment.trackingUrl } : { label: "Delivery challan", url: docLink("challan", o.token) },
      template: dispatchTpl(o, [d.transporter && `Courier: ${d.transporter}.`, (o.shipment?.awb || d.trackingNo) && `Tracking no: ${o.shipment?.awb || d.trackingNo}.`, o.shipment?.trackingUrl && `Live tracking: ${o.shipment.trackingUrl}`].filter(Boolean).join(" ") || "Dispatched today.") });
    await notifier.flush();
  }

  /** Courier status from Shadowfax: tell the customer when the rider has picked up (with live tracking) and when it is delivered. */
  async function shipmentUpdate(o, status) {
    const [a, company] = await Promise.all([config(), getSettings(store)]);
    if (!isOn(a, "shipmentUpdate") || !["picked", "out_for_delivery", "delivered"].includes(status)) return;
    const t = o.shipment?.trackingUrl || "";
    const what = status === "delivered" ? "has been delivered. Thank you for your business!" : status === "picked" ? "has been picked up by our delivery partner." : "is out for delivery today.";
    await send(toCustomer(o.customer).filter((x) => x.channel === "whatsapp"), { event: "shipmentUpdate", ref: o.number, subject: `Order ${o.number}: ${status}`,
      body: `Dear ${o.customer.contactName || o.customer.name},\nYour order ${o.number} ${what}${t && status !== "delivered" ? `\nLive tracking: ${t}` : ""}${o.shipment?.awb ? `\nAWB: ${o.shipment.awb}` : ""}\n– ${company.name}`,
      button: t && status !== "delivered" ? { label: "Track rider", url: t } : null,
      template: dispatchTpl(o, `${status === "delivered" ? "Delivered." : status === "picked" ? "Picked up by our delivery partner." : "Out for delivery today."}${o.shipment?.awb ? ` AWB ${o.shipment.awb}.` : ""}${t && status !== "delivered" ? ` Live tracking: ${t}` : ""}`) });
    await notifier.flush();
  }

  async function invoiceCreated(inv) {
    const [a, company] = await Promise.all([config(), getSettings(store)]);
    if (!isOn(a, "invoiceSend")) return;
    await send(toCustomer(inv.customer), { event: "invoiceSend", ref: inv.number, subject: `Invoice ${inv.number} from ${company.name}`,
      body: `Dear ${inv.customer.contactName || inv.customer.name},\nInvoice ${inv.number} for ${money(inv.totals.total)} is due on ${inv.dueDate}.\nView / download: ${docLink("invoice", inv.token)}${inv.payLink?.url ? `\nPay online: ${inv.payLink.url}` : ""}${company.upiId ? `\nUPI: ${company.upiId}` : ""}\n– ${company.name}`,
      button: inv.payLink?.url && balance(inv) > 0 ? { label: "Pay now", url: inv.payLink.url } : { label: "View invoice", url: docLink("invoice", inv.token) },
      template: invoiceTpl(inv, balance(inv) || inv.totals.total) });
    await notifier.flush();
  }

  async function paymentReceived(inv, p) {
    const [a, company] = await Promise.all([config(), getSettings(store)]);
    if (!isOn(a, "paymentReceipt")) return;
    await send(toCustomer(inv.customer), { event: "paymentReceipt", ref: inv.number, subject: `Payment received for ${inv.number}`,
      body: `Dear ${inv.customer.contactName || inv.customer.name},\nThank you. We received ${money(p.amount)} against invoice ${inv.number}.${balance(inv) > 0 ? ` Balance due: ${money(balance(inv))}.` : " The invoice is fully paid."}\n– ${company.name}` });
    await notifier.flush();
  }

  // ---------- scheduled
  async function run(at = new Date()) { return store.atomic(() => runCore(at)); }
  async function runCore(at) {
    for (const order of await store.orders.all()) if (order.payment === 'online' && order.paymentStatus !== 'paid' && !order.invoiceId && ['confirmed','packed'].includes(order.status) && order.reservationExpiresAt && Date.parse(order.reservationExpiresAt) < at.getTime()) await store.orders.update(order.id,{status:'cancelled',cancelReason:'payment_timeout',updatedAt:now()});
    const a = await config(), company = await getSettings(store), today = todayIST(at), res = {};
    const count = (k, n = 1) => { res[k] = (res[k] || 0) + n; };
    const istHour = new Date(at.getTime() + 5.5 * 3600_000).getUTCHours();

    if (isOn(a, "enquiryStale")) {
      for (const e of await store.enquiries.all()) {
        if (e.status !== "new" || e.staleRemindedAt || at - new Date(e.createdAt) < a.staleHours * 3600_000) continue;
        await send(await teamTargets(a, company, e.assignedTo), { event: "enquiryStale", ref: e.ref, subject: `Reminder: enquiry ${e.ref} not answered yet`,
          body: `Enquiry ${e.ref} from ${e.name}${e.company ? " (" + e.company + ")" : ""} is still new after ${a.staleHours} hours. Phone: ${e.phone}\nOpen: ${base()}/admin/enquiries` });
        await store.enquiries.update(e.id, { staleRemindedAt: now() }); count("enquiryStale");
      }
    }
    const quotes = await store.quotes.all();
    for (const q of quotes.filter((x) => x.status === "sent")) {
      if (isOn(a, "quoteExpire") && q.validUntil && q.validUntil < today) {
        await store.quotes.update(q.id, { status: "expired", updatedAt: now() }); await logActivity(store, { entity: "quote", entityId: q.id, text: "Expired (validity date passed)" }); count("quoteExpire"); continue;
      }
      if (!isOn(a, "quoteReminder") || !q.sentAt) continue;
      const age = daysBetween(todayIST(new Date(q.sentAt)), today), done = q.remindersSent || [];
      const due = a.quoteReminderDays.filter((d) => age >= d && !done.includes(d));
      if (!due.length) continue;
      await send(toCustomer(q.customer), { event: "quoteReminder", ref: q.number, subject: `Following up on quotation ${q.number}`,
        body: `Dear ${q.customer.contactName || q.customer.name},\nJust following up on our quotation ${q.number} (${money(q.totals.total)}). You can view and accept it here: ${docLink("quote", q.token)}\nHappy to adjust quantities or answer any questions.\n– ${company.name}`, template: quoteTpl(q) });
      await store.quotes.update(q.id, { remindersSent: [...done, ...due] }); count("quoteReminder");
    }
    if (isOn(a, "invoiceOverdue")) {
      for (const inv of (await store.invoices.all()).filter((x) => ["unpaid", "partial"].includes(x.status) && x.dueDate < today)) {
        const late = daysBetween(inv.dueDate, today), done = inv.remindersSent || [];
        const due = a.overdueDays.filter((d) => late >= d && !done.includes(d));
        if (!due.length) continue;
        await send(toCustomer(inv.customer), { event: "invoiceOverdue", ref: inv.number, subject: `Payment reminder: invoice ${inv.number}`,
          body: `Dear ${inv.customer.contactName || inv.customer.name},\nThis is a reminder that invoice ${inv.number} (balance ${money(balance(inv))}) was due on ${inv.dueDate}.\nView: ${docLink("invoice", inv.token)}${inv.payLink?.url ? `\nPay online: ${inv.payLink.url}` : ""}${company.upiId ? `\nUPI: ${company.upiId}` : ""}\nPlease ignore if already paid.\n– ${company.name}`, template: invoiceTpl(inv, balance(inv)) });
        await store.invoices.update(inv.id, { remindersSent: [...done, ...due] }); count("invoiceOverdue");
      }
    }
    if (isOn(a, "lowStock")) {
      const b = await stockBuckets(store), lv = Object.fromEntries(Object.entries(b).map(([id, x]) => [id, x.available])), low = [];
      for (const p of (await store.products.all()).filter((x) => x.stockTracked)) {
        const q = lv[p.id] || 0, isLow = q <= (p.reorderLevel || 0);
        if (isLow && !p.lowStockAlertedAt) { low.push(`• ${p.name} (${p.sku}): ${q} available, reorder level ${p.reorderLevel}`); await store.products.update(p.id, { lowStockAlertedAt: now() }); }
        if (!isLow && p.lowStockAlertedAt) await store.products.update(p.id, { lowStockAlertedAt: null });
      }
      if (low.length) { await send(await teamTargets(a, company), { event: "lowStock", subject: `Low stock: ${low.length} item(s)`, body: `These items are at or below their reorder level:\n${low.join("\n")}\nCreate purchase orders: ${base()}/admin/stock` }); count("lowStock", low.length); }
    }

    if (istHour >= a.dailyHour && a.lastDaily !== today) {
      const enquiries = await store.enquiries.all(), customers = await store.customers.all();
      if (isOn(a, "followUps")) {
        const byPerson = {};
        for (const e of enquiries) if (e.followUpAt && e.followUpAt <= today && !["won", "closed"].includes(e.status)) (byPerson[e.assignedTo || ""] ||= []).push(`• Enquiry ${e.ref}: ${e.name} ${e.phone}`);
        for (const c of customers) if (c.followUpAt && c.followUpAt <= today) (byPerson[c.assignedTo || ""] ||= []).push(`• Customer ${c.name} ${c.phone}`);
        for (const [adminId, list] of Object.entries(byPerson)) {
          const person = adminId ? await store.admins.get(adminId) : null;
          const targets = person?.active ? [person.email && { channel: "email", to: person.email }, person.phone && { channel: "whatsapp", to: person.phone }].filter(Boolean) : await teamTargets(a, company);
          await send(targets, { event: "followUps", subject: `Your follow-ups for ${today}`, body: `Follow-ups due today (${list.length}):\n${list.join("\n")}\nOpen: ${base()}/admin` }); count("followUps", list.length);
        }
      }
      if (isOn(a, "reorderNudge")) {
        const orders = await store.orders.all();
        for (const c of customers.filter((x) => x.reorderDays > 0)) {
          const last = orders.filter((o) => o.customerId === c.id && o.status !== "cancelled").map((o) => o.createdAt).sort().at(-1);
          if (!last || c.reorderNudgedFor === last || daysBetween(todayIST(new Date(last)), today) < c.reorderDays) continue;
          await send(toCustomer(c), { event: "reorderNudge", ref: c.name, subject: `Time to restock, ${c.name}?`, body: `Dear ${c.contactName || c.name},\nIt has been a while since your last order with ${company.name}. Shall we prepare your regular supplies? Reply to this message or call ${company.phone}.\n– ${company.name}` });
          await send(await teamTargets(a, company, c.assignedTo), { event: "reorderNudge", ref: c.name, subject: `Re-order due: ${c.name}`, body: `${c.name} usually re-orders every ${c.reorderDays} days; the last order was ${todayIST(new Date(last))}. Give them a call: ${c.phone}` });
          await store.customers.update(c.id, { reorderNudgedFor: last }); count("reorderNudge");
        }
      }
      if (isOn(a, "dailySummary")) {
        const y = addDays(today, -1), on = (iso) => iso && todayIST(new Date(iso)) === y;
        const invoices = await store.invoices.all(), payments = await store.payments.all(), orders = await store.orders.all();
        const overdue = invoices.filter((i) => ["unpaid", "partial"].includes(i.status) && i.dueDate < today);
        const lines = [
          `New enquiries: ${enquiries.filter((e) => on(e.createdAt)).length} (still new: ${enquiries.filter((e) => e.status === "new").length})`,
          `Quotes sent: ${quotes.filter((q) => on(q.sentAt)).length} · open quotes: ${quotes.filter((q) => q.status === "sent").length}`,
          `Orders: ${orders.filter((o) => on(o.createdAt)).length} new · ${orders.filter((o) => ["confirmed", "packed"].includes(o.status)).length} waiting to dispatch`,
          `Invoiced: ${money(invoices.filter((i) => i.date === y && i.status !== "void").reduce((n, i) => n + i.totals.total, 0))}`,
          `Received: ${money(payments.filter((p) => p.date === y).reduce((n, p) => n + p.amount, 0))}`,
          `Overdue: ${overdue.length} invoice(s), ${money(overdue.reduce((n, i) => n + balance(i), 0))}`,
        ];
        await send(await teamTargets(a, company), { event: "dailySummary", subject: `${company.name} daily summary for ${y}`, body: `Summary for ${y}\n${lines.join("\n")}\nDashboard: ${base()}/admin` }); count("dailySummary");
      }
      await store.settings.update(a.id, { lastDaily: today });
    }
    const sent = await notifier.flush();
    if (sent) res.sent = sent;
    await store.settings.update(a.id, { lastRunAt: now(), lastResult: res });
    return res;
  }

  return { config, run, on: { enquiryCreated, quoteSent, quoteAccepted, websiteOrder, orderBooked, orderDispatched, shipmentUpdate, invoiceCreated, paymentReceived } };
}
