import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { loadConfig } from "../src/config.js";
import { buildWhatsAppMessage, templateText } from "../src/lib/notify.js";
import { boot, login } from "./helpers.js";

const cfg = { waTemplateLang: "en_US", waTemplate: "", waTemplates: { quote: "hc_quote", dispatch: "", invoice: "hc_invoice" } };
const row = (extra = {}) => ({ channel: "whatsapp", to: "919876543210", body: "Dear Ravi,\nQuote Q/1 is ready.", ...extra });
const quoteTpl = { kind: "quote", params: ["Ravi", "Q/2026-27/0001", "₹1,180.00"], button: "tok_abc123" };

describe("WhatsApp payloads (Graph API v21.0)", () => {
  it("inside the 24-hour window: free-form link button or text", () => {
    const link = buildWhatsAppMessage(cfg, row({ button: { label: "View & approve", url: "https://x.example/doc/quote/t" }, template: quoteTpl }), true);
    assert.deepEqual(link.payload, { messaging_product: "whatsapp", recipient_type: "individual", to: "919876543210", type: "interactive",
      interactive: { type: "cta_url", body: { text: "Dear Ravi,\nQuote Q/1 is ready." }, action: { name: "cta_url", parameters: { display_text: "View & approve", url: "https://x.example/doc/quote/t" } } } });
    assert.equal(buildWhatsAppMessage(cfg, row(), true).payload.type, "text");
  });

  it("outside the window: the kind's approved template with body variables and URL button suffix", () => {
    const out = buildWhatsAppMessage(cfg, row({ template: quoteTpl }), false);
    assert.equal(out.via, "template:hc_quote");
    assert.deepEqual(out.payload, {
      messaging_product: "whatsapp", recipient_type: "individual", to: "919876543210", type: "template",
      template: { name: "hc_quote", language: { code: "en_US" }, components: [
        { type: "body", parameters: [{ type: "text", text: "Ravi" }, { type: "text", text: "Q/2026-27/0001" }, { type: "text", text: "₹1,180.00" }] },
        { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "tok_abc123" }] },
      ] },
    });
  });

  it("sends exactly the variables the template declares, cleaned the way Meta requires", () => {
    const out = buildWhatsAppMessage(cfg, row({ template: { kind: "invoice", params: ["Ravi\nKumar", "INV/1", "", "2026-11-30", "extra"], button: "" } }), false);
    const [body, ...rest] = out.payload.template.components;
    assert.deepEqual(body.parameters.map((p) => p.text), ["Ravi · Kumar", "INV/1", "-", "2026-11-30"], "4 variables, no new lines, no empty values");
    assert.equal(rest.length, 0, "no button component without a suffix");
    assert.equal(templateText("a\tb      c"), "a b   c");
  });

  it("falls back to the one-variable general template, then to sending by hand", () => {
    const general = { ...cfg, waTemplate: "hc_update", waTemplates: { quote: "", dispatch: "", invoice: "" } };
    const g = buildWhatsAppMessage(general, row({ template: quoteTpl }), false);
    assert.deepEqual(g.payload.template, { name: "hc_update", language: { code: "en_US" }, components: [{ type: "body", parameters: [{ type: "text", text: "Dear Ravi, · Quote Q/1 is ready." }] }] });
    const none = { ...general, waTemplate: "" };
    assert.match(buildWhatsAppMessage(none, row({ template: quoteTpl }), false).manual, /WHATSAPP_TEMPLATE_QUOTE/);
    assert.equal(buildWhatsAppMessage(none, row(), null).payload.type, "text", "window unknown (no inbound webhook): free-form as before");
  });

  it("bot replies always go as written", () => {
    const out = buildWhatsAppMessage(cfg, row({ payload: { type: "text", text: { body: "menu" } } }), false);
    assert.deepEqual(out.payload, { messaging_product: "whatsapp", recipient_type: "individual", to: "919876543210", type: "text", text: { body: "menu" } });
  });

  it("refuses template names Meta would not accept", () => {
    const base = { NODE_ENV: "test", JWT_SECRET: "t".repeat(48) };
    assert.throws(() => loadConfig({ ...base, WHATSAPP_TEMPLATE_QUOTE: "HC Quote!" }), /WHATSAPP_TEMPLATE_QUOTE/);
    assert.throws(() => loadConfig({ ...base, WHATSAPP_TEMPLATE_LANG: "english" }), /WHATSAPP_TEMPLATE_LANG/);
    assert.equal(loadConfig({ ...base, WHATSAPP_TEMPLATE_INVOICE: "hc_invoice_v2" }).waTemplates.invoice, "hc_invoice_v2");
  });
});

describe("WhatsApp window through the outbox", () => {
  let t, owner, sent = [];
  const fakeFetch = async (url, init) => {
    if (String(url).includes("graph.facebook.com")) { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ messages: [{ id: `wamid.O${sent.length}` }] }), { status: 200 }); }
    return new Response("{}", { status: 200 });
  };
  before(async () => {
    t = await boot({ fetchImpl: fakeFetch, env: { WHATSAPP_TOKEN: "wa", WHATSAPP_PHONE_ID: "1368252233043036", WHATSAPP_WEBHOOK_VERIFY_TOKEN: "verify-token-0123456789",
      WHATSAPP_APP_SECRET: "s", WHATSAPP_TEMPLATE_QUOTE: "hc_quote" } });
    owner = await login(t.base);
  });
  after(async () => { await t.close(); });
  const customer = (name, phone) => owner.post("/api/admin/customers", { name, phone, stateCode: "36" }).then((r) => r.data);
  const quote = async (c) => { const q = (await owner.post("/api/admin/quotes", { customerId: c.id, items: [{ name: "Kit", qty: 10, rate: 10000, gstRate: 18 }] })).data; await owner.post(`/api/admin/quotes/${q.id}/send`); return q; };
  const outboxFor = async (to, event) => (await t.store.outbox.all()).filter((m) => m.channel === "whatsapp" && m.to === to && m.event === event);

  it("uses the approved template for a customer who has not written in 24 hours", async () => {
    const q = await quote(await customer("Hotel Sai", "+91 98765 43210"));
    const [m] = await outboxFor("919876543210", "quoteSend");
    assert.equal(m.status, "sent"); assert.equal(m.via, "template:hc_quote");
    const p = sent.find((x) => x.to === "919876543210");
    assert.equal(p.type, "template"); assert.equal(p.template.components[1].parameters[0].text, q.token, "button opens /doc/quote/<token>");
    assert.equal(p.template.components[0].parameters[1].text, q.number);
  });

  it("sends free-form to a customer who wrote within the window", async () => {
    const c = await customer("City Clinic", "+91 91234 56780");
    await t.store.inbox.insert({ waMessageId: "wamid.r1", from: "919123456780", at: new Date(Date.now() - 3 * 3600_000).toISOString(), type: "text", text: "Please send the quote", items: [], readAt: null });
    await quote(c);
    const [m] = await outboxFor("919123456780", "quoteSend");
    assert.equal(m.via, "link"); assert.equal(sent.find((x) => x.to === "919123456780").interactive.type, "cta_url");
  });

  it("keeps a message for sending by hand when no template covers it", async () => {
    const c = await customer("Lake Resort", "+91 99887 76655");
    await t.store.inbox.insert({ waMessageId: "wamid.old", from: "919988776655", at: new Date(Date.now() - 30 * 3600_000).toISOString(), type: "text", text: "hi", items: [], readAt: null });
    const inv = (await owner.post("/api/admin/invoices", { customerId: c.id, items: [{ name: "Kit", qty: 1, rate: 10000, gstRate: 18 }] })).data;
    const [m] = await outboxFor("919988776655", "invoiceSend");
    assert.equal(m.status, "logged"); assert.match(m.error, /WHATSAPP_TEMPLATE_INVOICE/); assert.match(m.manualLink, /^https:\/\/wa\.me\/919988776655/);
    assert.ok(!sent.some((x) => x.to === "919988776655"), "nothing sent that WhatsApp would reject");
    assert.ok(inv.number);
  });
});
