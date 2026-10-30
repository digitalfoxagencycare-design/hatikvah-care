/**
 * Outgoing messages go through an outbox (a database table) so nothing is lost when a provider is down:
 * queue() records the message, flush() sends what is queued and retries failures up to 5 times.
 * Providers are switched on by environment variables only. When a channel is not configured the message is kept as
 * "logged": it is visible in Admin > Automation with a click-to-send WhatsApp / email link, so staff can still send it by hand.
 */
import crypto from "node:crypto";

export const waNumber = (phone = "") => { const d = String(phone).replace(/\D/g, ""); return d.length === 10 ? "91" + d : d.replace(/^0+/, ""); };
const emailOk = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s || "");
const DAY_MS = 24 * 3600_000, WINDOW_MARGIN_MS = 30 * 60_000; // treat the last half hour of the window as closed: the send may queue or retry

/**
 * WhatsApp's 24-hour rule: free-form messages (text, link buttons) reach a customer only within 24 hours of their last
 * message to us. Outside it, only an approved template is delivered. Each kind below is one Utility template to create in
 * Meta (WhatsApp Manager > Message templates) with exactly these body variables and one "Visit website" URL button whose
 * URL is the site's document page with a dynamic suffix, e.g. https://YOUR-DOMAIN/doc/quote/{{1}}. Name it in the env var.
 * Other messages (payment receipts, enquiry replies, team alerts) use WHATSAPP_TEMPLATE: a template whose body is just {{1}}.
 */
export const WA_TEMPLATES = {
  quote: { env: "WHATSAPP_TEMPLATE_QUOTE", body: ["customer name", "quotation number", "total incl. GST"], button: "/doc/quote/{{1}}",
    sample: "Dear {{1}}, our quotation {{2}} for {{3}} (incl. GST) is ready. Tap below to view and approve it." },
  dispatch: { env: "WHATSAPP_TEMPLATE_DISPATCH", body: ["customer name", "order number", "delivery details"], button: "/doc/challan/{{1}}",
    sample: "Dear {{1}}, your order {{2}} is on its way. {{3}} Tap below for the delivery challan." },
  invoice: { env: "WHATSAPP_TEMPLATE_INVOICE", body: ["customer name", "invoice number", "amount due", "due date"], button: "/doc/invoice/{{1}}",
    sample: "Dear {{1}}, invoice {{2}} for {{3}} is due on {{4}}. Tap below to view, download or pay it." },
};

/**
 * The WhatsApp Manager templates the business uses, for the preview in the inbox. approved reflects docs/INTEGRATIONS.md, not a live
 * call to Meta. hc_order_confirm has not been created yet: order confirmations outside the window use the general template.
 */
export const WA_TEMPLATE_LIBRARY = [
  { name: "hc_otp", label: "Sign-in code", category: "Authentication", approved: true, env: "WHATSAPP_OTP_TEMPLATE", configured: (c) => c.waOtpTemplate, usedFor: "Website sign-in",
    body: "*{{1}}* is your verification code.", variables: [{ label: "sign-in code", source: "Generated at sign-in", sample: "482913" }], button: { label: "Copy Code" } },
  { name: "hc_quote", label: "Quotation", category: "Utility", approved: true, env: WA_TEMPLATES.quote.env, configured: (c) => c.waTemplates?.quote, usedFor: "Sending a quotation",
    body: WA_TEMPLATES.quote.sample, variables: [{ label: "customer name", source: "Quote: customer", sample: "Hotel Sitara" }, { label: "quotation number", source: "Quote: number", sample: "Q/2026-27/0042" }, { label: "total incl. GST", source: "Quote: total", sample: "₹18,450.00" }], button: { label: "View & approve", url: WA_TEMPLATES.quote.button } },
  { name: "hc_dispatch", label: "Dispatch", category: "Utility", approved: true, env: WA_TEMPLATES.dispatch.env, configured: (c) => c.waTemplates?.dispatch, usedFor: "Dispatching an order",
    body: WA_TEMPLATES.dispatch.sample, variables: [{ label: "customer name", source: "Order: customer", sample: "Hotel Sitara" }, { label: "order number", source: "Order: number", sample: "SO/2026-27/0117" }, { label: "delivery details", source: "Dispatch: courier and tracking", sample: "Shadowfax, AWB SFX880142." }], button: { label: "View challan", url: WA_TEMPLATES.dispatch.button } },
  { name: "hc_invoice", label: "Invoice", category: "Utility", approved: true, env: WA_TEMPLATES.invoice.env, configured: (c) => c.waTemplates?.invoice, usedFor: "Sending an invoice",
    body: WA_TEMPLATES.invoice.sample, variables: [{ label: "customer name", source: "Invoice: customer", sample: "Hotel Sitara" }, { label: "invoice number", source: "Invoice: number", sample: "INV/2026-27/0231" }, { label: "amount due", source: "Invoice: balance", sample: "₹18,450.00" }, { label: "due date", source: "Invoice: due date", sample: "14 Nov 2026" }], button: { label: "View invoice", url: WA_TEMPLATES.invoice.button } },
  { name: "hc_order_confirm", label: "Order confirmation", category: "Utility", approved: false, env: "", configured: () => "", usedFor: "Confirming a booked order",
    body: "Dear {{1}}, your order {{2}} for {{3}} is confirmed. Thank you for choosing HaTikvah Care.", variables: [{ label: "customer name", source: "Order: customer", sample: "Hotel Sitara" }, { label: "order number", source: "Order: number", sample: "SO/2026-27/0117" }, { label: "order total", source: "Order: total", sample: "₹18,450.00" }], button: null },
  { name: "hc_update", label: "General update", category: "Utility", approved: true, env: "WHATSAPP_TEMPLATE", configured: (c) => c.waTemplate, usedFor: "Any other message outside the window",
    body: "Dear customer, {{1}}. - HaTikvah Care", variables: [{ label: "message", source: "The message text", sample: "your delivery is rescheduled to Friday" }], button: null },
];

/** The library as the inbox shows it: configured is the name set in the environment, if any. */
export const templateLibrary = (cfg) => WA_TEMPLATE_LIBRARY.map(({ configured, ...t }) => ({ ...t, connected: configured(cfg) || "", language: cfg.waTemplateLang }));

/** Meta refuses template variables containing new lines, tabs or more than four spaces in a row, and empty ones. */
export const templateText = (v, max = 1000) => String(v ?? "").replace(/\s*[\r\n]+\s*/g, " · ").replace(/\t/g, " ").replace(/ {4,}/g, "   ").trim().slice(0, max).trim() || "-";

/**
 * The Graph API (v21.0) message for an outbox row. inWindow: true / false from the inbox, or null when unknown (no inbound
 * webhook connected, so the old behaviour stays: template if one is set, else free-form).
 * Returns { payload, via } or { manual } when the message cannot be delivered and should be sent by hand.
 */
export function buildWhatsAppMessage(cfg, m, inWindow) {
  const base = { messaging_product: "whatsapp", recipient_type: "individual", to: m.to };
  if (m.payload && inWindow === true) return { payload: { ...m.payload, ...base }, via: "bot" }; // bot replies answer the customer, so the window is open
  const freeForm = () => (m.button
    ? { payload: { ...base, type: "interactive", interactive: { type: "cta_url", body: { text: m.body.slice(0, 1024) }, action: { name: "cta_url", parameters: { display_text: m.button.label, url: m.button.url } } } }, via: "link" }
    : { payload: { ...base, type: "text", text: { preview_url: true, body: m.body } }, via: "text" });
  if (inWindow === true) return freeForm();
  const lang = { code: cfg.waTemplateLang || "en" };
  const named = m.template && cfg.waTemplates?.[m.template.kind];
  if (named) {
    const spec = WA_TEMPLATES[m.template.kind];
    const components = [{ type: "body", parameters: spec.body.map((_, i) => ({ type: "text", text: templateText(m.template.params?.[i]) })) }];
    if (m.template.button) components.push({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: String(m.template.button) }] });
    return { payload: { ...base, type: "template", template: { name: named, language: lang, components } }, via: `template:${named}` };
  }
  if (cfg.waTemplate) return { payload: { ...base, type: "template", template: { name: cfg.waTemplate, language: lang, components: [{ type: "body", parameters: [{ type: "text", text: templateText(m.body) }] }] } }, via: `template:${cfg.waTemplate}` };
  return { manual: m.template
    ? `Outside WhatsApp's 24-hour window: set ${WA_TEMPLATES[m.template.kind].env} (or WHATSAPP_TEMPLATE) to an approved template, or send this by hand.`
    : "Outside WhatsApp's 24-hour window: set WHATSAPP_TEMPLATE to an approved template, or send this by hand." };
}

export function channels(cfg) {
  return {
    email: cfg.resendKey && cfg.mailFrom ? "resend" : "off",
    whatsapp: cfg.waToken && cfg.waPhoneId ? "whatsapp-cloud-api" : "off",
    payments: cfg.razorpayKeyId && cfg.razorpaySecret ? "razorpay" : "off",
    otp: cfg.novaUrl && cfg.novaKey ? "nova" : cfg.waToken && cfg.waPhoneId ? "whatsapp-cloud-api" : "off", // website sign-in codes
    whatsappInbound: cfg.waVerifyToken ? "webhook" : "off",
    logistics: cfg.sfxToken ? "shadowfax" : "off",
    couriers: [cfg.sfxToken && "shadowfax", cfg.porterKey && cfg.porterBaseUrl && "porter"].filter(Boolean),
    // approved templates for messages outside the 24-hour window, e.g. "quote, invoice + general"
    whatsappTemplates: [...Object.entries(cfg.waTemplates || {}).filter(([, v]) => v).map(([k]) => k), ...(cfg.waTemplate ? ["general"] : [])].join(", ") || "off",
  };
}

/** What the website may offer right now: the owner's switches in settings, limited by which integrations have keys. */
export function shopFlags(cfg, s) {
  const on = channels(cfg);
  const cart = s.shopEnabled !== false && !!s.showPrices;
  const online = cart && s.onlinePayments !== false && on.payments !== "off";
  const payLater = cart && s.payLater !== false;
  return { cart: cart && (online || payLater), online, payLater, otp: s.otpLogin !== false && (on.otp !== "off" || !cfg.prod) };
}

export function createNotifier({ cfg, store, fetchImpl = globalThis.fetch, log = console }) {
  const on = channels(cfg);
  const graph = () => `https://graph.facebook.com/${cfg.waApiVersion || "v21.0"}`;
  const manualLink = (m) => (m.channel === "whatsapp" ? `https://wa.me/${m.to}?text=${encodeURIComponent(m.body)}` : `mailto:${m.to}?subject=${encodeURIComponent(m.subject || "")}&body=${encodeURIComponent(m.body)}`);

  /**
   * button: { label, url } adds a tap-to-open link button on WhatsApp (interactive cta_url) when no template is configured.
   * payload: a raw WhatsApp message object (interactive buttons, list…) for bot replies inside the customer's 24-hour window.
   * template: { kind: "quote" | "dispatch" | "invoice", params: [...], button: "doc token" } used when the window is closed (WA_TEMPLATES).
   */
  async function queue({ channel, to, subject = "", body, event = "", ref = "", button = null, payload = null, template = null }) {
    const dest = channel === "whatsapp" ? waNumber(to) : String(to || "").trim();
    if (channel === "whatsapp" ? dest.length < 10 : !emailOk(dest)) return null; // no usable address: nothing to send
    const live = on[channel] !== "off";
    const m = { channel, to: dest, subject, body: String(body).slice(0, 4000), event, ref, status: live ? "queued" : "logged", attempts: 0, error: live ? "" : "Sending provider is not configured; send by hand.", createdAt: new Date().toISOString(), sentAt: null,
      ...(channel === "whatsapp" && button?.url ? { button: { label: String(button.label || "Open").slice(0, 20), url: button.url } } : {}), ...(channel === "whatsapp" && payload ? { payload } : {}),
      ...(channel === "whatsapp" && template && WA_TEMPLATES[template.kind] ? { template: { kind: template.kind, params: (template.params || []).map((p) => String(p ?? "")), button: String(template.button || "") } } : {}) };
    m.manualLink = manualLink(m);
    return store.outbox.insert(m);
  }

  async function sendOne(m, inWindow = null) {
    if (m.channel === "email") {
      const r = await fetchImpl("https://api.resend.com/emails", {
        method: "POST", signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${cfg.resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: cfg.mailFrom, to: [m.to], subject: m.subject || "HaTikvah Care", text: m.body, ...(cfg.mailReplyTo ? { reply_to: cfg.mailReplyTo } : {}) }),
      });
      if (!r.ok) throw Object.assign(new Error(`Email provider said ${r.status}`), {knownResponse:true,retryable:r.status===429||r.status>=500});
      return {};
    }
    // WhatsApp Cloud API: free-form inside the customer's 24-hour window, an approved template outside it (buildWhatsAppMessage).
    const built = buildWhatsAppMessage(cfg, m, inWindow);
    if (built.manual) return { manual: built.manual };
    const payload = built.payload;
    const r = await fetchImpl(`${graph()}/${cfg.waPhoneId}/messages`, { method: "POST", signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${cfg.waToken}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!r.ok) throw Object.assign(new Error(`WhatsApp said ${r.status}`), {knownResponse:true,retryable:r.status===429||r.status>=500});
    const data = await r.json().catch(() => ({}));
    return { waMessageId: data?.messages?.[0]?.id || "", via: built.via }; // status callbacks (sent / delivered / read) refer to this id
  }

  let flushing = null, flushRequested = false;
  function flush() {
    if (store.inAtomic?.()) { store.afterCommit(() => flush()); return Promise.resolve(0); }
    // One sender per process. Cross-instance durable claims are still needed on Cloud Run.
    flushRequested = true;
    if (!flushing) flushing = (async () => {
      let sent = 0;
      do { flushRequested = false; sent += await flushQueued(); } while (flushRequested);
      return sent;
    })().finally(() => { flushing = null; });
    return flushing;
  }
  async function flushQueued() {
    for (const old of (await store.outbox.all()).filter(m => m.status === 'sending' && Date.now()-Date.parse(m.claimedAt)>120000)) {
      await store.outbox.compareAndUpdate(old.id, { status: 'sending', claim: old.claim }, { status: 'logged', error: 'Previous send was interrupted; reconcile provider delivery before retry' });
    }
    const queued = (await store.outbox.all({ sort: { createdAt: 1 } })).filter((m) => (m.status === "queued" || (m.status === "failed" && m.attempts < 5)) && (!m.retryAt || Date.parse(m.retryAt) <= Date.now()));
    let sent = 0;
    const inWindow = await windowCheck();
    for (let m of queued.slice(0, 50)) {
      const claim = crypto.randomUUID();
      m = await store.atomic(async () => { const row=await store.outbox.get(m.id); if(!row || !["queued","failed"].includes(row.status) || row.attempts>=5)return null; return store.outbox.update(row.id,{status:"sending",claim,claimedAt:new Date().toISOString(),attempts:(row.attempts||0)+1}); });
      if (!m) continue;
      if (on[m.channel] === "off") { await store.outbox.update(m.id, { status: "logged", error: "Sending provider is not configured; send by hand." }); continue; }
      try {
        const got = await sendOne(m, m.channel === "whatsapp" ? (await windowCheck())(m.to) : null);
        if (got.manual) { await store.outbox.update(m.id, { status: "logged", error: got.manual }); continue; } // staff send it with the manual link
        await store.outbox.update(m.id, { status: "sent", sentAt: new Date().toISOString(), attempts: m.attempts, error: "", ...(got?.via ? { via: got.via } : {}), ...(got?.waMessageId ? { waMessageId: got.waMessageId, deliveryStatus: "sent" } : {}) });
        sent++;
      }
      catch (e) { await store.outbox.update(m.id, { status: e.knownResponse ? "failed" : "logged", attempts: e.knownResponse && e.retryable ? m.attempts : 5, retryAt: new Date(Date.now() + Math.min(3600000, 30000 * 2 ** m.attempts)).toISOString(), error: e.knownResponse ? String(e.message).slice(0,300) : "Delivery outcome unknown; reconcile with provider before manual retry" }); log.warn?.("Message not sent:", e.message); }
    }
    return sent;
  }
  /**
   * Is a WhatsApp number inside its 24-hour customer service window? Known only when the inbound webhook is connected (the
   * inbox holds the customer's messages); otherwise null. Read once per flush.
   */
  async function windowCheck(now = Date.now()) {
    if (!cfg.waVerifyToken) return () => null;
    const last = {};
    for (const m of await store.inbox.all()) {
      const k = waNumber(m.from), t = Date.parse(m.at);
      if (k && t && (!last[k] || t > last[k])) last[k] = t;
    }
    return (to) => !!last[to] && now >= last[to] && now - last[to] < DAY_MS - WINDOW_MARGIN_MS;
  }

  /**
   * Login codes go straight to WhatsApp and are NOT written to the outbox: staff can read the outbox, and a stored code would let them sign in as the customer.
   * With Nova connected (NOVA_URL + NOVA_CLIENT_KEY) the code goes out on Nova's WhatsApp number (POST /v2/integrations/whatsapp/otp); Nova applies
   * its own per-phone limits and never stores the code. Otherwise WHATSAPP_OTP_TEMPLATE, an approved "Authentication" template, is used directly.
   * Throws an Error with `status` 429 when the code may not be sent yet.
   */
  async function sendOtp(phone, code) {
    if (on.otp === "off") throw new Error("WhatsApp is not connected");
    const to = waNumber(phone);
    if (on.otp === "nova") {
      const r = await fetchImpl(`${cfg.novaUrl}/v2/integrations/whatsapp/otp`, { method: "POST", signal: AbortSignal.timeout(15000),
        headers: { "X-Nova-Client-Key": cfg.novaKey, "Content-Type": "application/json", ...(cfg.novaSlug ? { "X-Tenant-Slug": cfg.novaSlug } : {}) }, body: JSON.stringify({ phone: to, code }) });
      if (r.ok) return;
      const err = new Error(`Nova said ${r.status}: ${(await r.text()).slice(0, 200)}`);
      err.status = r.status;
      throw err;
    }
    if (!cfg.waOtpTemplate) throw new Error("Configure an approved authentication template (WHATSAPP_OTP_TEMPLATE)");
    const payload = cfg.waOtpTemplate
      ? { messaging_product: "whatsapp", to, type: "template", template: { name: cfg.waOtpTemplate, language: { code: cfg.waTemplateLang }, components: [
        { type: "body", parameters: [{ type: "text", text: code }] }, { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] }] } }
      : { messaging_product: "whatsapp", to, type: "text", text: { body: `${code} is your HaTikvah Care login code. It expires in 10 minutes. Do not share it.` } };
    const r = await fetchImpl(`${graph()}/${cfg.waPhoneId}/messages`, { method: "POST", signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${cfg.waToken}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!r.ok) throw Object.assign(new Error(`WhatsApp said ${r.status}`), {knownResponse:true,retryable:r.status===429||r.status>=500});
  }

  /** WhatsApp status callback: sent → delivered → read (never goes backwards); failed marks the outbox row failed with Meta's reason. */
  const RANK = { sent: 1, delivered: 2, read: 3 };
  async function markStatus(waMessageId, status, at, error = "") {
    const m = waMessageId ? await store.outbox.findBy("waMessageId", waMessageId) : null;
    if (!m) return null;
    if (status === "failed") return store.outbox.update(m.id, { status: "failed", deliveryStatus: "failed", attempts: 5, error: String(error || "WhatsApp could not deliver this message").slice(0, 300) });
    if (!RANK[status] || (RANK[m.deliveryStatus] || 0) >= RANK[status]) return m;
    return store.outbox.update(m.id, { deliveryStatus: status, [status + "At"]: at || new Date().toISOString() });
  }
  return { queue, flush, sendOtp, markStatus, channels: on };
}
