import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { templateLibrary, WA_TEMPLATES, WA_TEMPLATE_LIBRARY } from "../src/lib/notify.js";
import { fillTemplate, serviceWindow } from "../../web/src/admin/waWindow.js";
import { rfqItems, rfqMessage } from "../../web/src/rfq.js";
import { inSector, SECTORS, sectorOf, spreadByCategory } from "../../web/src/sectors.js";
import { tiltAngles } from "../../web/src/tilt.js";
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

describe("institution filter", () => {
  const catalog = JSON.parse(readFileSync(fileURLToPath(new URL("../../../data/catalog.json", import.meta.url)), "utf8")).products;
  const of = (k) => catalog.filter((p) => inSector(p, k));
  it("every sector has products, and every product is in at least one", () => {
    for (const s of SECTORS) assert.ok(of(s.key).length >= 8, s.key);
    assert.deepEqual(catalog.filter((p) => !SECTORS.some((s) => inSector(p, s.key))).map((p) => p.name), []);
  });
  it("keeps hospital linen out of hotels and in hospitals; 'spandex' is not a spa", () => {
    const hosp = catalog.filter((p) => p.category === "hospital-linen");
    assert.ok(hosp.length > 0 && hosp.every((p) => inSector(p, "hospitals") && !inSector(p, "hotels")));
    assert.equal(inSector({ category: "hotel-linen", collection: "Napkins & Event Covers", name: "Spandex Chair Covers" }, "spas"), false);
    assert.equal(inSector({ category: "hotel-linen", collection: "Bath Robes", name: "Terry Bath Robes for Hotels & Spas" }, "spas"), true);
  });
  it("the home preview takes one from each category before repeating one", () => {
    const list = [{ id: 1, category: "a" }, { id: 2, category: "a" }, { id: 3, category: "a" }, { id: 4, category: "b" }, { id: 5, category: "c" }];
    assert.deepEqual(spreadByCategory(list, 4).map((p) => p.id), [1, 4, 5, 2]);
    assert.equal(spreadByCategory(list, 9).length, 5);
  });
  it("an unknown or empty sector filters nothing", () => {
    assert.equal(inSector({ category: "x", collection: "", name: "y" }, ""), true);
    assert.equal(inSector({ category: "x", collection: "", name: "y" }, "casinos"), true);
    assert.equal(sectorOf("casinos"), undefined);
  });
});

describe("hover tilt", () => {
  it("is flat at the centre and reaches the maximum at the corners", () => {
    assert.deepEqual(tiltAngles(100, 50, 200, 100, 8), { rx: 0, ry: 0, gx: 50, gy: 50 });
    assert.deepEqual(tiltAngles(200, 0, 200, 100, 8), { rx: 8, ry: 8, gx: 100, gy: 0 });
    assert.deepEqual(tiltAngles(0, 100, 200, 100, 8), { rx: -8, ry: -8, gx: 0, gy: 100 });
  });
  it("stays within the maximum when the pointer leaves the element", () => {
    assert.deepEqual(tiltAngles(-50, 400, 200, 100, 8), { rx: -8, ry: -8, gx: 0, gy: 100 });
  });
});

describe("sample and quote request", () => {
  it("writes the details the enquiry has no field for into the message", () => {
    assert.equal(rfqMessage({ mode: "rfq", sector: "spas", city: " Pune ", volume: "500 robes", note: " Monogram please ", names: ["Farm Fresh Shampoo"] }),
      "Request for quotation\nSector: Spas\nCity: Pune\nExpected volume: 500 robes\nInterested in: Farm Fresh Shampoo\nMonogram please");
  });
  it("a sample request ignores volume and stays long enough to pass the enquiry check", () => {
    const m = rfqMessage({ mode: "sample", volume: "500" });
    assert.equal(m, "Sample request");
    assert.ok(m.length >= 5);
  });
  it("stays within the enquiry's 2000 character limit", () => {
    assert.equal(rfqMessage({ mode: "rfq", note: "x".repeat(3000) }).length, 2000);
  });
  it("sends one of each product for samples, the asked quantity for quotes, and drops showcase items", () => {
    const lines = [{ productId: "a", qty: 200, variant: "30ml", name: "A" }, { productId: "b", qty: 5, name: "B" }, { productId: null, qty: 1, name: "Showcase" }];
    assert.deepEqual(rfqItems("sample", lines), [{ productId: "a", qty: 1, variant: "30ml" }, { productId: "b", qty: 1 }]);
    assert.deepEqual(rfqItems("rfq", lines), [{ productId: "a", qty: 200, variant: "30ml" }, { productId: "b", qty: 5 }]);
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

  it("a drawer request lands as an enquiry with its sector and products", async () => {
    const { data: { products } } = await client(t.base).get("/api/public/catalog");
    const r = await client(t.base).post("/api/public/enquiries", { name: "Asha Rao", company: "Lotus Spa", phone: "9876543210", email: "", website: "",
      items: rfqItems("sample", [{ productId: products[0].id, qty: 40 }]), message: rfqMessage({ mode: "sample", sector: "spas", city: "Goa" }) });
    assert.equal(r.status, 201);
    const e = (await owner.get("/api/admin/enquiries")).data.find((x) => x.ref === r.data.ref);
    assert.equal(e.message, "Sample request\nSector: Spas\nCity: Goa");
    assert.deepEqual(e.items.map((i) => i.qty), [1]);
  });
});
