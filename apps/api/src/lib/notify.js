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
  };
}

export function createNotifier({ cfg, store, fetchImpl = globalThis.fetch, log = console }) {
  const on = channels(cfg);
  const manualLink = (m) => (m.channel === "whatsapp" ? `https://wa.me/${m.to}?text=${encodeURIComponent(m.body)}` : `mailto:${m.to}?subject=${encodeURIComponent(m.subject || "")}&body=${encodeURIComponent(m.body)}`);

  async function queue({ channel, to, subject = "", body, event = "", ref = "" }) {
    const dest = channel === "whatsapp" ? waNumber(to) : String(to || "").trim();
    if (channel === "whatsapp" ? dest.length < 10 : !emailOk(dest)) return null; // no usable address: nothing to send
    const live = on[channel] !== "off";
    const m = { channel, to: dest, subject, body: String(body).slice(0, 4000), event, ref, status: live ? "queued" : "logged", attempts: 0, error: "", createdAt: new Date().toISOString(), sentAt: null };
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
      return;
    }
    // WhatsApp Cloud API. Business-initiated messages need an approved template: set WHATSAPP_TEMPLATE to a template with one
    // body variable ({{1}}) and the message text is sent in it. Without a template, plain text works only inside the 24-hour reply window.
    const payload = cfg.waTemplate
      ? { messaging_product: "whatsapp", to: m.to, type: "template", template: { name: cfg.waTemplate, language: { code: cfg.waTemplateLang }, components: [{ type: "body", parameters: [{ type: "text", text: m.body.replace(/\s*\n+\s*/g, " · ").slice(0, 1000) }] }] } }
      : { messaging_product: "whatsapp", to: m.to, type: "text", text: { body: m.body } };
    const r = await fetchImpl(`https://graph.facebook.com/v21.0/${cfg.waPhoneId}/messages`, { method: "POST", headers: { Authorization: `Bearer ${cfg.waToken}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!r.ok) throw new Error(`WhatsApp said ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }

  async function flush() {
    const queued = (await store.outbox.all({ sort: { createdAt: 1 } })).filter((m) => m.status === "queued" || (m.status === "failed" && m.attempts < 5));
    let sent = 0;
    for (const m of queued.slice(0, 50)) {
      if (on[m.channel] === "off") { await store.outbox.update(m.id, { status: "logged" }); continue; }
      try { await sendOne(m); await store.outbox.update(m.id, { status: "sent", sentAt: new Date().toISOString(), attempts: m.attempts + 1, error: "" }); sent++; }
      catch (e) { await store.outbox.update(m.id, { status: "failed", attempts: m.attempts + 1, error: String(e.message).slice(0, 300) }); log.warn?.("Message not sent:", e.message); }
    }
    return sent;
  }
  return { queue, flush, channels: on };
}
