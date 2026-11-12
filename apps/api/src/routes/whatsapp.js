import crypto from "node:crypto";
import express, { Router } from "express";
import { can, requirePerm } from "../lib/permissions.js";
import { dispatchTpl, invoiceTpl, quoteTpl } from "../lib/automation.js";
import { balance, logActivity, now, priced, token, customerSnapshot } from "../lib/sales.js";
import { nextNumber, todayIST } from "../lib/gst.js";
import { DEFAULT_WAREHOUSE, haversineKm, calculateDeliveryEstimate } from "../lib/geo.js";
import { getDeliveryWallet } from "./logistics.js";
import { templateLibrary, WA_TEMPLATES } from "../lib/notify.js";
import { getSettings } from "../model.js";
import { wrap } from "./public.js";
import { bad, notFound } from "./shared.js";
import { atomicWrap } from "./atomic.js";

/**
 * WhatsApp Cloud API webhook (Meta app > WhatsApp > Configuration > Callback URL https://YOUR-DOMAIN/api/webhooks/whatsapp,
 * subscribe to "messages"). GET answers Meta's verification; POST brings customer messages and delivery statuses.
 * Customer messages land in the inbox (Admin > WhatsApp inbox), are matched to a customer by mobile number (a new lead is
 * created when the number is unknown), and the bot answers with a quick menu for hotels and clinics.
 */
const digits10 = (phone) => String(phone || "").replace(/\D/g, "").slice(-10);
const GREETING = /^\s*(hi+|hello|hey|hai|namaste|menu|start|help)\b/i;

/** X-Hub-Signature-256: "sha256=" + HMAC-SHA256 of the raw body with the Meta app secret. */
export function verifyMetaSignature(raw, header, secret) {
  if (!secret || typeof header !== "string" || !/^sha256=[a-f0-9]{64}$/.test(header)) return false;
  const want = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
  return want.length === header.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(header));
}

/** Text, button reply, list reply, template quick-reply button or catalogue order, as one shape. */
export function parseMessage(m) {
  const base = { waMessageId: m.id, from: m.from, at: m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : now(), type: m.type, text: "", buttonId: "", items: [] };
  if (m.type === "text") return { ...base, text: m.text?.body || "" };
  if (m.type === "interactive") {
    const r = m.interactive?.button_reply || m.interactive?.list_reply || {};
    return { ...base, buttonId: r.id || "", text: r.title || "" };
  }
  if (m.type === "button") return { ...base, buttonId: m.button?.payload || "", text: m.button?.text || "" };
  if (m.type === "order") {
    return { ...base, text: m.order?.text || "", items: (m.order?.product_items || []).map((i) => ({ sku: String(i.product_retailer_id || ""), qty: Number(i.quantity) || 1, price: i.item_price ?? null })) };
  }
  return { ...base, text: m[m.type]?.caption || `[${m.type}]` };
}

const buttons = (text, list) => ({ type: "interactive", interactive: { type: "button", body: { text }, action: { buttons: list.map(([id, title]) => ({ type: "reply", reply: { id, title } })) } } });
const link = (text, label, url) => ({ type: "interactive", interactive: { type: "cta_url", body: { text }, action: { name: "cta_url", parameters: { display_text: label, url } } } });

export function whatsappWebhook({ cfg, store, automation, notifier, log = console }) {
  const r = Router();
  const site = () => cfg.publicUrl || `http://localhost:${cfg.port}`;

  r.get("/api/webhooks/whatsapp", (req, res) => {
    const q = req.query;
    if (!cfg.waVerifyToken) return res.status(404).end();
    const got = Buffer.from(String(q["hub.verify_token"] || "")), want = Buffer.from(cfg.waVerifyToken);
    if (q["hub.mode"] === "subscribe" && got.length === want.length && crypto.timingSafeEqual(got, want)) return res.type("text/plain").send(String(q["hub.challenge"] || ""));
    res.status(403).end();
  });

  r.post("/api/webhooks/whatsapp", express.raw({ type: () => true, limit: "1mb" }), atomicWrap(store, async (req, res) => {
    // Signed by Meta when the app secret is set (always in production: config.js refuses to start without it)
    if ((cfg.waAppSecret || cfg.prod) && !verifyMetaSignature(req.body, req.get("x-hub-signature-256"), cfg.waAppSecret)) return res.status(401).json({ error: "BAD_SIGNATURE" });
    let ev; try { ev = JSON.parse(req.body.toString("utf8")); } catch { return res.status(400).end(); }
    if (ev.object !== "whatsapp_business_account") return res.json({ ok: true, ignored: ev.object });
    try {
      for (const entry of ev.entry || []) for (const ch of entry.changes || []) {
        const v = ch.value || {};
        if (cfg.waPhoneId && v.metadata?.phone_number_id && v.metadata.phone_number_id !== cfg.waPhoneId) continue; // another number on the same app
        for (const s of v.statuses || []) await notifier.markStatus(s.id, s.status, s.timestamp ? new Date(Number(s.timestamp) * 1000).toISOString() : "", s.errors?.[0]?.title || s.errors?.[0]?.message || "");
        const names = Object.fromEntries((v.contacts || []).map((c) => [c.wa_id, c.profile?.name || ""]));
        for (const m of v.messages || []) await incoming(parseMessage(m), names[m.from] || "");
      }
      await notifier.flush();
    } catch (e) { log.error?.("WhatsApp webhook failed", e); return res.status(500).json({ error: "RETRY" }); } // Meta retries; messages already stored are skipped
    res.json({ ok: true });
  }));

  async function customerFor(from, name) {
    const ph = digits10(from);
    const found = (await store.customers.all()).find((c) => c.phone && digits10(c.phone) === ph);
    if (found) return { customer: found, isNew: false };
    const customer = await store.customers.insert({ name: name || `+91 ${ph}`, contactName: name || "", phone: `+91 ${ph}`, email: "", gstin: "", stateCode: "", city: "", billingAddress: "", shippingAddress: "",
      priceListId: "", paymentTermsDays: 30, reorderDays: 0, tags: ["whatsapp", "lead"], notes: "", assignedTo: "", followUpAt: "", source: "whatsapp", createdAt: now(), updatedAt: now() });
    await logActivity(store, { entity: "customer", entityId: customer.id, kind: "whatsapp", text: "New lead from WhatsApp", by: "whatsapp" });
    return { customer, isNew: true };
  }

  const recentMsgIds = new Set();
  async function incoming(msg, profileName) {
    if (!msg.waMessageId || recentMsgIds.has(msg.waMessageId) || await store.inbox.findBy("waMessageId", msg.waMessageId)) return; // Meta retries deliveries
    await store.afterCommit(() => {
      recentMsgIds.add(msg.waMessageId);
      setTimeout(() => recentMsgIds.delete(msg.waMessageId), 60_000).unref?.();
    });
    const { customer, isNew } = await customerFor(msg.from, profileName);
    const row = await store.inbox.insert({ ...msg, name: profileName, customerId: customer.id, customerName: customer.name, readAt: null, enquiryId: "", direction: "in" });
    await logActivity(store, { entity: "customer", entityId: customer.id, kind: "whatsapp", text: `WhatsApp: ${msg.text || (msg.items.length ? `catalogue order (${msg.items.length} items)` : msg.type)}`.slice(0, 2000), by: "whatsapp" });
    const a = await automation.config();
    if (a.enabled.waBot === false) return;
    await bot(msg, row, customer, isNew);
  }

  const reply = (to, body, payload, ref = "") => notifier.queue({ channel: "whatsapp", to, body, payload: payload || { type: "text", text: { body } }, event: "waBot", ref });

  async function enquiry(customer, msg, { message = "", items = [] }) {
    const yy = new Date().getFullYear().toString().slice(2);
    let ref; do ref = `HC-${yy}${String(await store.nextSeq("enquiry:" + yy)).padStart(4, "0")}`; while (await store.enquiries.findBy("ref", ref));
    const enq = await store.enquiries.insert({ ref, name: customer.contactName || customer.name, company: customer.name.startsWith("+91 ") ? "" : customer.name, phone: customer.phone, email: customer.email || "",
      message, items, source: { utm_source: "whatsapp", channel: "whatsapp" }, status: "new", notes: "", assignedTo: customer.assignedTo || "", customerId: customer.id, followUpAt: "", createdAt: now() });
    await automation.on.enquiryCreated(enq); // assignment and team alert (the customer's acknowledgement comes from the bot)
    return enq;
  }

  async function bot(msg, row, customer, isNew) {
    const company = await getSettings(store);
    const to = msg.from, state = customer.waBotState || "";
    const menu = () => reply(to, "menu", buttons(`Welcome to ${company.name}! 👋\nHotel amenities, housekeeping, hygiene and clinic supplies across India.\nHow can we help?`,
      [["quote", "Request a quote"], ["hotel", "Hotel amenities"], ["clinic", "Clinic supplies"]]));

    if (msg.type === "order" && msg.items.length) { // order from the WhatsApp catalogue: product_retailer_id is our SKU
      const products = await store.products.all();
      const items = msg.items.map((i) => { const p = products.find((x) => x.sku && x.sku === i.sku); return p ? { productId: p.id, sku: p.sku, name: p.name, qty: i.qty } : null; }).filter(Boolean);
      const missing = msg.items.filter((i) => !products.some((x) => x.sku === i.sku)).map((i) => `${i.qty} x ${i.sku}`);
      const enq = await enquiry(customer, msg, { items, message: [msg.text, missing.length ? `Not matched: ${missing.join(", ")}` : ""].filter(Boolean).join("\n") });
      await store.inbox.update(row.id, { enquiryId: enq.id });
      return reply(to, `Thank you! We received your catalogue request (ref ${enq.ref}) for ${msg.items.length} item(s). Our team will send you a quotation with GST shortly.`, null, enq.ref);
    }
    if (msg.buttonId === "quote") {
      await store.customers.update(customer.id, { waBotState: "awaitingQuote", updatedAt: now() });
      return reply(to, "Please type the items and quantities you need (for example: 500 shampoo 30 ml, 200 bath towels 27x54), and your property name and city.");
    }
    if (msg.buttonId === "hotel" || msg.buttonId === "clinic") {
      const url = `${site()}/catalog${msg.buttonId === "clinic" ? "?q=clinic" : ""}`;
      await reply(to, "catalogue", link(msg.buttonId === "hotel" ? "Guest amenities, bathroom kits, linen, F&B disposables and housekeeping supplies, with bulk pricing by box and carton." : "Hand rubs, sanitisers, disposables, gloves, masks and hygiene consumables for clinics and hospitals.", "Open catalogue", url));
      return reply(to, "next", buttons("Would you like a quotation?", [["quote", "Request a quote"], ["agent", "Talk to our team"]]));
    }
    if (msg.buttonId === "agent") {
      const enq = await enquiry(customer, msg, { message: "Asked on WhatsApp to talk to the team" });
      return reply(to, `Thank you. Our team will call you shortly (ref ${enq.ref}).${company.phone ? ` You can also call ${company.phone}.` : ""}`, null, enq.ref);
    }
    if (state === "awaitingQuote" && msg.type === "text" && msg.text.trim().length >= 3) {
      await store.customers.update(customer.id, { waBotState: "", updatedAt: now() });
      const enq = await enquiry(customer, msg, { message: msg.text.trim() });
      await store.inbox.update(row.id, { enquiryId: enq.id });
      return reply(to, `Thank you! Your quote request is noted (ref ${enq.ref}). We will send the quotation with GST shortly, with a link to view and approve it online.`, null, enq.ref);
    }
    const txt = (msg.text || "").trim().toLowerCase();
    if (msg.type === "text" && /^(catalog|catalogue|products|items|brochure|price list|pricelist)$/i.test(txt)) {
      const url = `${site()}/catalog`;
      await reply(to, "catalogue", link("Browse our full range of hotel amenities, hygiene consumables, and clinic supplies online:", "Open catalogue", url));
      return reply(to, "next", buttons("Would you like a quotation?", [["quote", "Request a quote"], ["agent", "Talk to our team"]]));
    }
    if (msg.type === "text" && /^(track|tracking|shipment|status|where is my order)$/i.test(txt)) {
      const ph = digits10(to);
      const orders = (await store.orders.all()).filter((o) => o.customerId === customer.id || (o.customer?.phone && digits10(o.customer.phone) === ph));
      const latest = orders.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))[0];
      if (latest) {
        let text = `Your latest order ${latest.number} is ${latest.status.toUpperCase()}.`;
        if (latest.shipment?.awb) {
          text += `\nCourier: ${latest.shipment.provider || "Shadowfax"}\nAWB: ${latest.shipment.awb}\nStatus: ${latest.shipment.status}`;
          if (latest.shipment.trackingUrl) text += `\nTrack: ${latest.shipment.trackingUrl}`;
        }
        return reply(to, text);
      }
      return reply(to, "We could not find any active orders for this number. If you need help, please tap below:", buttons("How can we help?", [["quote", "Request a quote"], ["agent", "Talk to our team"]]));
    }
    // Menu on a greeting, for a new contact, or when the last menu is a day old. Other messages wait for the team in the inbox.
    if (isNew || GREETING.test(msg.text) || !customer.waMenuAt || Date.now() - Date.parse(customer.waMenuAt) > 24 * 3600_000) {
      await store.customers.update(customer.id, { waMenuAt: now() });
      return menu();
    }
  }
  return r;
}

/** Admin: the WhatsApp inbox (customer messages), replies inside the 24-hour window, and the outbox delivery log. */
const TEAM_EVENTS = new Set(["enquiryAlert", "lowStock", "followUps", "dailySummary"]); // these go to staff phones, not customers
const TEMPLATE_DOCS = { quote: { path: "quote", list: "quotes", perm: "quotes" }, invoice: { path: "invoice", list: "invoices", perm: "invoices" }, dispatch: { path: "challan", list: "orders", perm: "orders" } };

/** A document link opens without sign-in, so a message only shows one to staff who may see that kind of document. */
export function hideDocLinks(admin, text) {
  return String(text || "").replace(/\/doc\/([\w-]+)\/[\w-]+/g, (link, kind) => (can(admin, { quote: "quotes", invoice: "invoices" }[kind] || "orders") ? link : `/doc/${kind}/…`));
}

/** One row per customer number across what they sent us and what we sent them, newest first. */
export function conversationList(inbox, outbox, customers) {
  const names = Object.fromEntries(customers.filter((c) => c.phone).map((c) => [digits10(c.phone), c]));
  const by = new Map();
  const row = (phone) => {
    const key = digits10(phone);
    if (!by.has(key)) by.set(key, { key, phone: String(phone).replace(/\D/g, ""), name: names[key]?.name || "", customerId: names[key]?.id || "", lastAt: "", lastInboundAt: "", preview: "", unread: 0 });
    return by.get(key);
  };
  const seen = (t, at, text) => { if (at > t.lastAt) { t.lastAt = at; t.preview = String(text || "").slice(0, 80); } };
  for (const m of inbox) {
    const t = row(m.from);
    t.name ||= m.name || m.customerName || ""; t.customerId ||= m.customerId || "";
    if (m.at > t.lastInboundAt) t.lastInboundAt = m.at;
    if (!m.readAt) t.unread += 1;
    seen(t, m.at, m.text || `[${m.type}]`);
  }
  for (const m of outbox) if (m.channel === "whatsapp" && !TEAM_EVENTS.has(m.event)) seen(row(m.to), m.sentAt || m.createdAt, m.body);
  return [...by.values()].sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
}

export function whatsappAdminRoutes({ cfg, store, notifier, audit }) {
  const r = Router();
  r.use("/whatsapp", requirePerm("enquiries", "automation"));
  const docUrl = (path, tok) => `${cfg.publicUrl || `http://localhost:${cfg.port}`}/doc/${path}/${tok}`;
  const lists = async () => { const [inbox, outbox, customers] = await Promise.all([store.inbox.all({ sort: { at: -1 } }), store.outbox.all({ sort: { createdAt: -1 } }), store.customers.all()]); return { inbox, outbox, customers }; };
  const summaries = (req, l) => conversationList(l.inbox, l.outbox, l.customers).map((t) => ({ ...t, preview: hideDocLinks(req.admin, t.preview) }));
  r.get("/whatsapp/threads", wrap(async (req, res) => res.json(summaries(req, await lists()))));
  /** One conversation, oldest first, with each sent document's current status and the customer's documents a template can carry. */
  r.get("/whatsapp/threads/:phone", wrap(async (req, res) => {
    const key = digits10(req.params.phone);
    if (key.length !== 10) return bad(res, "Enter the WhatsApp number");
    const allowed = (kind) => (can(req.admin, TEMPLATE_DOCS[kind].perm) ? store[TEMPLATE_DOCS[kind].list].all({ sort: { createdAt: -1 } }) : []);
    const [l, quotes, invoices, orders] = await Promise.all([lists(), allowed("quote"), allowed("invoice"), allowed("dispatch")]);
    const own = (d) => digits10(d.customer?.phone) === key;
    const docOf = (ref) => {
      if (!ref) return null;
      const q = quotes.find((d) => d.number === ref); if (q) return { kind: "Quotation", number: q.number, status: q.status, url: docUrl("quote", q.token) };
      const i = invoices.find((d) => d.number === ref); if (i) return { kind: "Invoice", number: i.number, status: i.status, url: docUrl("invoice", i.token) };
      const o = orders.find((d) => d.number === ref); if (o) return { kind: "Order", number: o.number, status: o.shipment?.status || o.status, url: o.shipment?.trackingUrl || (o.challanNumber ? docUrl("challan", o.token) : "") };
      return null;
    };
    const inbound = l.inbox.filter((m) => digits10(m.from) === key).map((m) => ({ id: m.id, dir: "in", text: m.text || `[${m.type}]`, at: m.at, items: m.items || [], enquiryId: m.enquiryId || "" }));
    const outbound = l.outbox.filter((m) => m.channel === "whatsapp" && !TEAM_EVENTS.has(m.event) && digits10(m.to) === key)
      .map((m) => { const text = hideDocLinks(req.admin, m.body); return { id: m.id, dir: "out", text, at: m.sentAt || m.createdAt, event: m.event, status: m.deliveryStatus || m.status, error: m.error || "", button: m.button?.label || "", manualLink: text === m.body ? m.manualLink || "" : "", doc: docOf(m.ref) }; });
    const summary = summaries(req, l).find((t) => t.key === key) || { key, phone: req.params.phone.replace(/\D/g, ""), name: quotes.concat(invoices, orders).find(own)?.customer.name || "", customerId: "", lastAt: "", lastInboundAt: "", preview: "", unread: 0 };
    res.json({ ...summary, messages: [...inbound, ...outbound].sort((a, b) => (a.at < b.at ? -1 : 1)),
      docs: { quote: quotes.filter(own).slice(0, 8).map((d) => ({ id: d.id, number: d.number, status: d.status })), invoice: invoices.filter((d) => own(d) && d.status !== "void").slice(0, 8).map((d) => ({ id: d.id, number: d.number, status: d.status })),
        dispatch: orders.filter((d) => own(d) && d.challanNumber).slice(0, 8).map((d) => ({ id: d.id, number: d.number, status: d.shipment?.status || d.status })) } });
  }));
  r.post("/whatsapp/threads/:phone/read", wrap(async (req, res) => {
    const key = digits10(req.params.phone), rows = (await store.inbox.all()).filter((m) => digits10(m.from) === key && !m.readAt);
    for (const m of rows) await store.inbox.update(m.id, { readAt: now(), readBy: req.admin.email });
    res.json({ read: rows.length });
  }));
  /** hc_quote, hc_dispatch or hc_invoice for one of this customer's documents. The notifier sends it free-form inside the 24-hour window and as the approved template outside it. */
  r.post("/whatsapp/threads/:phone/template", wrap(async (req, res) => {
    const key = digits10(req.params.phone), kind = String(req.body?.kind || ""), spec = Object.hasOwn(TEMPLATE_DOCS, kind) ? TEMPLATE_DOCS[kind] : null;
    if (key.length !== 10) return bad(res, "Enter the WhatsApp number");
    if (!spec) return bad(res, "Choose a template");
    if (!can(req.admin, spec.perm)) return bad(res, "Your role does not allow this", 403);
    const doc = await store[spec.list].get(String(req.body?.docId || ""));
    if (!doc || digits10(doc.customer?.phone) !== key) return bad(res, "Choose one of this customer's documents");
    if (kind === "dispatch" && !doc.challanNumber) return bad(res, "This order has not been dispatched", 409);
    const details = kind === "dispatch" ? [doc.dispatch?.transporter && `Courier: ${doc.dispatch.transporter}.`, (doc.shipment?.awb || doc.dispatch?.trackingNo) && `Tracking no: ${doc.shipment?.awb || doc.dispatch.trackingNo}.`].filter(Boolean).join(" ") || "Details on the challan." : "";
    const template = kind === "quote" ? quoteTpl(doc) : kind === "invoice" ? invoiceTpl(doc, balance(doc) || doc.totals.total) : dispatchTpl(doc, details);
    const body = WA_TEMPLATES[kind].sample.replace(/\{\{(\d)\}\}/g, (_, n) => template.params[n - 1] ?? "");
    const label = { quote: "View & approve", invoice: "View invoice", dispatch: "View challan" }[kind];
    const pdfUrl = `${cfg.publicUrl || `http://localhost:${cfg.port}`}/doc/${spec.path}/${doc.token}/pdf`;
    const docMeta = ["quote", "invoice"].includes(kind) ? {
      link: pdfUrl,
      filename: `${kind === "invoice" ? "Invoice" : "Quotation"}_${(doc.number || "document").replace(/[^a-zA-Z0-9_-]/g, "_")}.pdf`,
      caption: `${kind === "quote" ? "Quotation" : "Tax Invoice"} ${doc.number} - HaTikvah Care`
    } : null;
    const m = await notifier.queue({ channel: "whatsapp", to: doc.customer.phone, body, event: { quote: "quoteSend", invoice: "invoiceSend", dispatch: "orderDispatched" }[kind], ref: doc.number, button: { label, url: docUrl(spec.path, doc.token) }, template, document: docMeta });
    if (!m) return bad(res, "That number cannot receive WhatsApp");
    await notifier.flush();
    await audit(req, "whatsapp.template", doc.number, { kind });
    res.status(201).json(await store.outbox.get(m.id));
  }));
  r.get("/whatsapp/inbox", wrap(async (req, res) => {
    let rows = await store.inbox.all({ sort: { at: -1 } });
    if (req.query.customerId) rows = rows.filter((m) => m.customerId === req.query.customerId);
    if (req.query.unread) rows = rows.filter((m) => !m.readAt);
    res.json(rows.slice(0, 300));
  }));
  r.get("/whatsapp/templates", wrap(async (req, res) => res.json(templateLibrary(cfg))));
  r.post("/whatsapp/inbox/:id/read", wrap(async (req, res) => {
    const m = await store.inbox.get(req.params.id); if (!m) return notFound(res, "Message");
    res.json(await store.inbox.update(m.id, { readAt: m.readAt || now(), readBy: req.admin.email }));
  }));
  r.post("/whatsapp/reply", wrap(async (req, res) => {
    const to = String(req.body?.to || ""), body = String(req.body?.body || "").trim();
    if (!/^\d{10,15}$/.test(to.replace(/\D/g, ""))) return bad(res, "Enter the WhatsApp number");
    if (body.length < 1 || body.length > 4000) return bad(res, "Type a message (up to 4000 characters)");
    const last = (await store.inbox.all({ sort: { at: -1 } })).find((m) => digits10(m.from) === digits10(to));
    if (!last || Date.now() - Date.parse(last.at) > 24 * 3600_000) return bad(res, "WhatsApp allows free-text replies only within 24 hours of the customer's last message. Use a template message instead.", 409);
    const m = await notifier.queue({ channel: "whatsapp", to: last.from, body, event: "waReply", ref: last.customerId });
    await notifier.flush();
    if (last.customerId) await logActivity(store, { entity: "customer", entityId: last.customerId, kind: "whatsapp", text: `WhatsApp reply: ${body}`.slice(0, 2000), by: req.admin.email });
    await audit(req, "whatsapp.reply", to);
    res.status(201).json(await store.outbox.get(m.id));
  }));
  return r;
}
