import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { templateLibrary, WA_TEMPLATES, WA_TEMPLATE_LIBRARY } from "../src/lib/notify.js";
import { fillTemplate, serviceWindow } from "../../web/src/admin/waWindow.js";
import { boot, client, login } from "./helpers.js";

const HOUR = 3600_000, at = Date.parse("2026-10-30T12:00:00Z");
const ago = (ms) => new Date(at - ms).toISOString();

describe("24-hour service window", () => {
  it("counts down from the customer's last message", () => {
    const w = serviceWindow(ago(HOUR + 90_000), at);
    assert.equal(w.open, true);
    assert.equal(w.label, "22h 58m 30s");
  });
  it("closes at exactly 24 hours and shows template only", () => {
    assert.equal(serviceWindow(ago(24 * HOUR - 1000), at).open, true);
    for (const last of [ago(24 * HOUR), ago(72 * HOUR), "", undefined]) assert.deepEqual(serviceWindow(last, at), { open: false, msLeft: 0, label: "Template only" });
  });
  it("a message stamped slightly ahead of this clock never shows more than 24 hours", () => {
    assert.equal(serviceWindow(new Date(at + 5000).toISOString(), at).msLeft, 24 * HOUR);
  });
});

describe("template library", () => {
  it("covers the six templates and only hc_order_confirm is unapproved", () => {
    assert.deepEqual(WA_TEMPLATE_LIBRARY.map((t) => t.name), ["hc_otp", "hc_quote", "hc_dispatch", "hc_invoice", "hc_order_confirm", "hc_update"]);
    assert.deepEqual(WA_TEMPLATE_LIBRARY.filter((t) => !t.approved).map((t) => t.name), ["hc_order_confirm"]);
  });
  it("every {{n}} in a body has a mapped variable, and the sent templates keep the send order", () => {
    for (const t of WA_TEMPLATE_LIBRARY) {
      const holes = [...new Set(t.body.match(/\{\{\d+\}\}/g))];
      assert.equal(holes.length, t.variables.length, t.name);
      assert.ok(t.variables.every((v) => v.label && v.source && v.sample), t.name);
    }
    for (const kind of Object.keys(WA_TEMPLATES)) assert.deepEqual(WA_TEMPLATE_LIBRARY.find((t) => t.name === `hc_${kind}`).variables.map((v) => v.label), WA_TEMPLATES[kind].body);
  });
  it("reports the name each template is connected under, and none for an unset env", () => {
    const list = templateLibrary({ waTemplateLang: "en_US", waOtpTemplate: "hc_otp", waTemplate: "", waTemplates: { quote: "hc_quote_v2", dispatch: "", invoice: "" } });
    const of = (n) => list.find((t) => t.name === n);
    assert.equal(of("hc_quote").connected, "hc_quote_v2");
    assert.equal(of("hc_otp").connected, "hc_otp");
    assert.equal(of("hc_update").connected, "");
    assert.equal(of("hc_order_confirm").connected, "");
    assert.equal(of("hc_quote").language, "en_US");
    assert.ok(list.every((t) => typeof t.configured === "undefined"));
  });
  it("fills the preview and leaves an empty variable visible", () => {
    assert.equal(fillTemplate("Dear {{1}}, order {{2}} for {{1}}", ["Ravi", "  "]), "Dear Ravi, order {{2}} for Ravi");
  });
});

describe("over the API", () => {
  let t, owner;
  before(async () => { t = await boot(); owner = await login(t.base); });
  after(() => t.close());

  it("GET /whatsapp/templates needs a sign-in and returns the library", async () => {
    assert.equal((await client(t.base).get("/api/admin/whatsapp/templates")).status, 401);
    const r = await owner.get("/api/admin/whatsapp/templates");
    assert.equal(r.status, 200);
    assert.equal(r.data.length, 6);
    assert.equal(r.data.find((x) => x.name === "hc_order_confirm").approved, false);
  });
});
