import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { loadConfig } from "../src/config.js";
import { boot, client } from "./helpers.js";

let t, calls = [], novaStatus = 200;
// Stands in for Nova's client API (POST /v2/integrations/whatsapp/otp).
const fakeFetch = async (url, init) => {
  calls.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
  return new Response(novaStatus === 200 ? JSON.stringify({ sent: true, channel: "whatsapp" }) : JSON.stringify({ detail: { code: "RATE_LIMITED" } }), { status: novaStatus });
};

before(async () => { t = await boot({ env: { NOVA_URL: "https://nova.example.com/", NOVA_CLIENT_KEY: "nck_test", NOVA_TENANT_SLUG: "hatikvah" }, fetchImpl: fakeFetch }); });
after(async () => { await t.close(); });

describe("Nova central engine", () => {
  it("sends website login codes on Nova's WhatsApp, never showing the code", async () => {
    const c = client(t.base);
    const r = await c.post("/api/shop/otp/request", { phone: "98765 43210" });
    assert.equal(r.status, 200); assert.equal(r.data.devCode, undefined);
    const [call] = calls;
    assert.equal(call.url, "https://nova.example.com/v2/integrations/whatsapp/otp");
    assert.equal(call.headers["X-Nova-Client-Key"], "nck_test"); assert.equal(call.headers["X-Tenant-Slug"], "hatikvah");
    assert.equal(call.body.phone, "919876543210"); assert.match(call.body.code, /^\d{6}$/);
    assert.equal((await c.post("/api/shop/otp/verify", { phone: "9876543210", code: call.body.code })).status, 200);
    assert.equal((await t.store.outbox.all()).some((m) => m.body.includes(call.body.code)), false);
    assert.equal((await client(t.base).get("/api/public/settings")).data.shop.otp, true);
  });

  it("passes Nova's per-phone limit on to the buyer and frees the code", async () => {
    novaStatus = 429;
    const r = await client(t.base).post("/api/shop/otp/request", { phone: "9123456789" });
    assert.equal(r.status, 429); assert.match(r.data.message, /Too many codes/);
    assert.equal((await t.store.otps.all()).filter((o) => o.phone === "9123456789").length, 0);
    novaStatus = 200;
  });

  it("refuses half a Nova setup and plain http in production", () => {
    assert.throws(() => loadConfig({ JWT_SECRET: "x".repeat(40), NOVA_URL: "https://nova.example.com" }), /NOVA_CLIENT_KEY/);
    assert.throws(() => loadConfig({ NODE_ENV: "production", MONGODB_URI: "mongodb://db", JWT_SECRET: "k".repeat(48), NOVA_URL: "http://nova", NOVA_CLIENT_KEY: "nck_x" }), /https/);
  });
});
