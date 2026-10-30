/**
 * Outgoing messages go through an outbox (a database table) so nothing is lost when a provider is down:
 * queue() records the message, flush() sends what is queued and retries failures up to 5 times.
 * Providers are switched on by environment variables only. When a channel is not configured the message is kept as
 * "logged": it is visible in Admin > Automation with a click-to-send WhatsApp / email link, so staff can still send it by hand.
 */
export const waNumber = (phone = "") => { const d = String(phone).replace(/\D/g, ""); return d.length === 10 ? "91" + d : d.replace(/^0+/, ""); };
const emailOk = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s || "");

export function channels(cfg) {
  return {
    email: cfg.resendKey && cfg.mailFrom ? "resend" : "off",
    whatsapp: cfg.waToken && cfg.waPhoneId ? "whatsapp-cloud-api" : "off",
    payments: cfg.razorpayKeyId && cfg.razorpaySecret ? "razorpay" : "off",
    otp: cfg.novaUrl && cfg.novaKey ? "nova" : cfg.waToken && cfg.waPhoneId ? "whatsapp-cloud-api" : "off", // website sign-in codes
    whatsappInbound: cfg.waVerifyToken ? "webhook" : "off",
    logistics: cfg.sfxToken ? "shadowfax" : "off",
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
   */
  async function queue({ channel, to, subject = "", body, event = "", ref = "", button = null, payload = null }) {
    const dest = channel === "whatsapp" ? waNumber(to) : String(to || "").trim();
    if (channel === "whatsapp" ? dest.length < 10 : !emailOk(dest)) return null; // no usable address: nothing to send
    const live = on[channel] !== "off";
    const m = { channel, to: dest, subject, body: String(body).slice(0, 4000), event, ref, status: live ? "queued" : "logged", attempts: 0, error: "", createdAt: new Date().toISOString(), sentAt: null,
      ...(channel === "whatsapp" && button?.url ? { button: { label: String(button.label || "Open").slice(0, 20), url: button.url } } : {}), ...(channel === "whatsapp" && payload ? { payload } : {}) };
    m.manualLink = manualLink(m);
    return store.outbox.insert(m);
  }

  async function sendOne(m) {
    if (m.channel === "email") {
      const r = await fetchImpl("https://api.resend.com/emails", {
        method: "POST", headers: { Authorization: `Bearer ${cfg.resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: cfg.mailFrom, to: [m.to], subject: m.subject || "HaTikvah Care", text: m.body, ...(cfg.mailReplyTo ? { reply_to: cfg.mailReplyTo } : {}) }),
      });
      if (!r.ok) throw new Error(`Email provider said ${r.status}: ${(await r.text()).slice(0, 200)}`);
      return {};
    }
    // WhatsApp Cloud API. Business-initiated messages need an approved template: set WHATSAPP_TEMPLATE to a template with one
    // body variable ({{1}}) and the message text is sent in it. Without a template, plain text works only inside the 24-hour reply window.
    // Bot replies (payload) answer a message the customer just sent, so they are inside the 24-hour window and need no template.
    const payload = m.payload ? { messaging_product: "whatsapp", recipient_type: "individual", to: m.to, ...m.payload }
      : cfg.waTemplate
        ? { messaging_product: "whatsapp", to: m.to, type: "template", template: { name: cfg.waTemplate, language: { code: cfg.waTemplateLang }, components: [{ type: "body", parameters: [{ type: "text", text: m.body.replace(/\s*\n+\s*/g, " · ").slice(0, 1000) }] }] } }
        : m.button ? { messaging_product: "whatsapp", to: m.to, type: "interactive", interactive: { type: "cta_url", body: { text: m.body.slice(0, 1024) }, action: { name: "cta_url", parameters: { display_text: m.button.label, url: m.button.url } } } }
          : { messaging_product: "whatsapp", to: m.to, type: "text", text: { body: m.body } };
    const r = await fetchImpl(`${graph()}/${cfg.waPhoneId}/messages`, { method: "POST", headers: { Authorization: `Bearer ${cfg.waToken}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!r.ok) throw new Error(`WhatsApp said ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const data = await r.json().catch(() => ({}));
    return { waMessageId: data?.messages?.[0]?.id || "" }; // status callbacks (sent / delivered / read) refer to this id
  }

  async function flush() {
    const queued = (await store.outbox.all({ sort: { createdAt: 1 } })).filter((m) => m.status === "queued" || (m.status === "failed" && m.attempts < 5));
    let sent = 0;
    for (const m of queued.slice(0, 50)) {
      if (on[m.channel] === "off") { await store.outbox.update(m.id, { status: "logged" }); continue; }
      try {
        const got = await sendOne(m);
        await store.outbox.update(m.id, { status: "sent", sentAt: new Date().toISOString(), attempts: m.attempts + 1, error: "", ...(got?.waMessageId ? { waMessageId: got.waMessageId, deliveryStatus: "sent" } : {}) });
        sent++;
      }
      catch (e) { await store.outbox.update(m.id, { status: "failed", attempts: m.attempts + 1, error: String(e.message).slice(0, 300) }); log.warn?.("Message not sent:", e.message); }
    }
    return sent;
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
      const r = await fetchImpl(`${cfg.novaUrl}/v2/integrations/whatsapp/otp`, { method: "POST",
        headers: { "X-Nova-Client-Key": cfg.novaKey, "Content-Type": "application/json", ...(cfg.novaSlug ? { "X-Tenant-Slug": cfg.novaSlug } : {}) }, body: JSON.stringify({ phone: to, code }) });
      if (r.ok) return;
      const err = new Error(`Nova said ${r.status}: ${(await r.text()).slice(0, 200)}`);
      err.status = r.status;
      throw err;
    }
    const payload = cfg.waOtpTemplate
      ? { messaging_product: "whatsapp", to, type: "template", template: { name: cfg.waOtpTemplate, language: { code: cfg.waTemplateLang }, components: [
        { type: "body", parameters: [{ type: "text", text: code }] }, { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] }] } }
      : { messaging_product: "whatsapp", to, type: "text", text: { body: `${code} is your HaTikvah Care login code. It expires in 10 minutes. Do not share it.` } };
    const r = await fetchImpl(`${graph()}/${cfg.waPhoneId}/messages`, { method: "POST", headers: { Authorization: `Bearer ${cfg.waToken}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!r.ok) throw new Error(`WhatsApp said ${r.status}: ${(await r.text()).slice(0, 200)}`);
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
