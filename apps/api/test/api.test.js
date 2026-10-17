import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { boot, client, login, PW } from "./helpers.js";

let t;
before(async () => { t = await boot(); });
after(async () => { await t.close(); });

describe("public site API", () => {
  it("serves the whole catalogue from the PDF, with prices hidden because none are set", async () => {
    const r = await client(t.base).get("/api/public/catalog");
    assert.equal(r.status, 200);
    assert.equal(r.data.products.length, 149);
    assert.equal(r.data.categories.length, 8);
    assert.ok(r.data.categories.every((c) => c.count > 0), "every category has products");
    assert.ok(r.data.products.every((p) => p.pricePaise === null));
    assert.ok(r.data.products.every((p) => p.images.length > 0 && p.images.every((i) => i.startsWith("/catalog/"))));
    assert.equal(JSON.stringify(r.data).includes("passwordHash"), false);
  });

  it("returns one product, and 404 for unknown", async () => {
    const c = client(t.base);
    const all = (await c.get("/api/public/catalog")).data.products;
    const one = await c.get(`/api/public/products/${all[0].slug}`);
    assert.equal(one.status, 200); assert.equal(one.data.sku, "HC-001");
    assert.equal((await c.get("/api/public/products/nope")).status, 404);
  });

  it("exposes company settings and the sitemap/robots", async () => {
    const c = client(t.base);
    const s = (await c.get("/api/public/settings")).data;
    assert.equal(s.name, "HaTikvah Care"); assert.equal(s.email, "hatvikcare@gmail.com");
    const sm = await c.get("/sitemap.xml");
    assert.match(sm.data, /<loc>.*\/product\//); assert.ok(sm.data.split("<url>").length > 150);
    assert.match((await c.get("/robots.txt")).data, /Disallow: \/admin/);
  });
});

describe("enquiries", () => {
  const good = (items = []) => ({ name: "Ravi Kumar", company: "Hotel Sai", phone: "9876543210", email: "ravi@hotel.example", message: "Need a quote", items });

  it("accepts a valid enquiry for real products and records it", async () => {
    const c = client(t.base);
    const p = (await c.get("/api/public/catalog")).data.products[3];
    const r = await c.post("/api/public/enquiries", good([{ productId: p.id, qty: 500 }]), { headers: { "x-requested-with": "x" } });
    assert.equal(r.status, 201); assert.match(r.data.ref, /^HC-\d{6}$/);
    const saved = (await t.store.enquiries.all()).at(-1);
    assert.equal(saved.items[0].name, p.name); assert.equal(saved.status, "new");
  });

  it("rejects bad input with a clear message", async () => {
    const c = client(t.base);
    for (const bad of [{ ...good(), phone: "abc" }, { ...good(), name: "" }, { ...good(), email: "nope" }, { ...good(), items: [{ productId: "missing", qty: 1 }] }, { ...good(), items: [{ productId: "x", qty: 0 }] }, { name: "A B", phone: "9876543210" }]) {
      const r = await c.post("/api/public/enquiries", bad);
      assert.equal(r.status, 400, JSON.stringify(bad)); assert.ok(r.data.message);
    }
  });

  it("silently drops bot submissions (honeypot) and stores nothing", async () => {
    const before = await t.store.enquiries.count();
    const r = await client(t.base).post("/api/public/enquiries", { ...good(), website: "http://spam.example" });
    assert.equal(r.status, 201);
    assert.equal(await t.store.enquiries.count(), before);
  });

  it("rate-limits repeated submissions from one network", async () => {
    const c = client(t.base); let limited = false;
    for (let i = 0; i < 12; i++) if ((await c.post("/api/public/enquiries", good())).status === 429) limited = true;
    assert.ok(limited);
  });
});

describe("admin sign-in and protection", () => {
  it("every admin endpoint needs a session", async () => {
    const c = client(t.base);
    for (const [m, u] of [["get", "/api/admin/products"], ["get", "/api/admin/enquiries"], ["get", "/api/admin/dashboard"], ["get", "/api/admin/users"], ["get", "/api/admin/products/export.csv"]]) {
      assert.equal((await c[m](u)).status, 401, u);
    }
  });

  it("wrong password gives a generic error; right password sets an httpOnly cookie", async () => {
    const c = client(t.base);
    const wrong = await c.post("/api/admin/login", { email: "owner@example.com", password: "wrong-wrong-1" });
    const ghost = await c.post("/api/admin/login", { email: "nobody@example.com", password: "wrong-wrong-1" });
    assert.equal(wrong.status, 401); assert.deepEqual(wrong.data, ghost.data);
    const ok = await fetch(t.base + "/api/admin/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "owner@example.com", password: PW }) });
    assert.equal(ok.status, 200);
    const sc = ok.headers.getSetCookie()[0];
    assert.match(sc, /HttpOnly/i); assert.match(sc, /SameSite=Strict/i);
  });

  it("mutations without the anti-CSRF header are refused even with a valid session", async () => {
    const c = await login(t.base);
    const r = await c.post("/api/admin/categories", { name: "Sneaky" }, { headers: { "x-requested-with": "" } });
    assert.equal(r.status, 403);
  });

  it("locks the account after repeated wrong passwords", async () => {
    await t.store.admins.insert({ email: "lock@example.com", name: "L", role: "staff", passwordHash: "$2a$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012345", active: true, tokenVersion: 0, createdAt: "x" });
    const c = client(t.base); let last;
    for (let i = 0; i < 6; i++) last = await c.post("/api/admin/login", { email: "lock@example.com", password: "nope-nope-12" });
    assert.ok([429].includes(last.status) || last.status === 401);
    const u = await t.store.admins.findBy("email", "lock@example.com");
    assert.ok(u.lockedUntil, "account has a lock time");
  });
});

describe("product management", () => {
  let c;
  before(async () => { c = await login(t.base); });

  it("creates, edits a price (shown on the public site) and deletes a product, with an audit trail", async () => {
    const cat = (await c.get("/api/admin/categories")).data[0];
    const made = await c.post("/api/admin/products", { name: "Test Slipper Pro", category: cat.slug, pack: "100 pairs", price: 1250, priceUnit: "per pair" });
    assert.equal(made.status, 201); assert.match(made.data.sku, /^HC-\d{3}$/);
    const pub = (await client(t.base).get(`/api/public/products/${made.data.slug}`)).data;
    assert.equal(pub.pricePaise, 1250); assert.equal(pub.priceUnit, "per pair");
    const edit = await c.patch(`/api/admin/products/${made.data.id}`, { price: 1500 });
    assert.equal(edit.data.price, 1500);
    const log = (await c.get("/api/admin/audit")).data;
    assert.ok(log.some((a) => a.action === "product.update" && a.detail.price.from === 1250 && a.detail.price.to === 1500));
    assert.equal((await c.del(`/api/admin/products/${made.data.id}`)).status, 204);
    assert.equal((await client(t.base).get(`/api/public/products/${made.data.slug}`)).status, 404);
  });

  it("hides inactive products from the public site but keeps them in admin", async () => {
    const p = (await c.get("/api/admin/products")).data[5];
    await c.patch(`/api/admin/products/${p.id}`, { active: false });
    const pub = (await client(t.base).get("/api/public/catalog")).data.products;
    assert.ok(!pub.some((x) => x.id === p.id));
    assert.ok((await c.get("/api/admin/products")).data.some((x) => x.id === p.id));
    await c.patch(`/api/admin/products/${p.id}`, { active: true });
  });

  it("the owner can switch prices off site-wide", async () => {
    const p = (await c.get("/api/admin/products")).data[6];
    await c.patch(`/api/admin/products/${p.id}`, { price: 999 });
    const s = (await c.get("/api/admin/settings")).data;
    await c.put("/api/admin/settings", { ...s, showPrices: false });
    assert.equal((await client(t.base).get(`/api/public/products/${p.slug}`)).data.pricePaise, null);
    await c.put("/api/admin/settings", { ...s, showPrices: true });
    assert.equal((await client(t.base).get(`/api/public/products/${p.slug}`)).data.pricePaise, 999);
  });

  it("validates input: bad category, duplicate SKU, negative price, unknown fields, foreign image URLs", async () => {
    const cat = (await c.get("/api/admin/categories")).data[0].slug;
    const existing = (await c.get("/api/admin/products")).data[0];
    for (const body of [
      { name: "X Y", category: "nope" }, { name: "X Y", category: cat, sku: existing.sku }, { name: "X Y", category: cat, price: -5 },
      { name: "X Y", category: cat, price: 1.5 }, { name: "X Y", category: cat, evil: 1 }, { name: "X Y", category: cat, images: ["https://evil.example/x.jpg"] },
      { name: "X Y", category: cat, images: ["javascript:alert(1)"] },
    ]) assert.equal((await c.post("/api/admin/products", body)).status, 400, JSON.stringify(body));
  });

  it("bulk price import: dry run previews, real run applies, bad rows are reported not fatal", async () => {
    const all = (await c.get("/api/admin/products")).data;
    const csv = `sku,price_rupees,price_unit\n${all[10].sku},12.50,per pack\n${all[11].sku},abc,per pack\nHC-999,5,x\n${all[12].sku},"1,200",per case\n`;
    const dry = (await c.post("/api/admin/products/import", { csv, dryRun: true })).data;
    assert.equal(dry.updated, 2); assert.equal(dry.errorCount, 2);
    assert.equal((await c.get("/api/admin/products")).data[10].price, null, "dry run changed nothing");
    const real = (await c.post("/api/admin/products/import", { csv })).data;
    assert.equal(real.updated, 2);
    const after = (await c.get("/api/admin/products")).data;
    assert.equal(after[10].price, 1250); assert.equal(after[12].price, 120000);
  });

  it("exports products as CSV and neutralises spreadsheet formulas", async () => {
    const p = (await c.get("/api/admin/products")).data[20];
    await c.patch(`/api/admin/products/${p.id}`, { pack: '=HYPERLINK("http://evil.example")' });
    const csv = (await c.get("/api/admin/products/export.csv")).data;
    assert.match(csv, /^sku,name,category/); assert.ok(csv.includes("'=HYPERLINK"));
  });

  it("accepts real images by file signature only", async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)]);
    const up = await c.post("/api/admin/media", png, { raw: true, headers: { "content-type": "image/png" } });
    assert.equal(up.status, 201);
    const got = await fetch(t.base + up.data.url);
    assert.equal(got.status, 200); assert.equal(got.headers.get("content-type"), "image/png"); assert.equal(got.headers.get("x-content-type-options"), "nosniff");
    const fake = await c.post("/api/admin/media", Buffer.from("<svg onload=alert(1)>".padEnd(300, " ")), { raw: true, headers: { "content-type": "image/png" } });
    assert.equal(fake.status, 400);
  });

  it("cannot delete a category that still has products", async () => {
    const cat = (await c.get("/api/admin/categories")).data[0];
    assert.equal((await c.del(`/api/admin/categories/${cat.id}`)).status, 409);
  });
});

describe("enquiry inbox and team", () => {
  it("staff can work the inbox but cannot manage users, settings or the audit log", async () => {
    const owner = await login(t.base);
    const mk = await owner.post("/api/admin/users", { email: "staff@example.com", name: "Staff One", role: "staff", password: "Another-Pass-77" });
    assert.equal(mk.status, 201); assert.equal(mk.data.passwordHash, undefined);
    assert.equal((await owner.post("/api/admin/users", { email: "w@example.com", name: "Weak", password: "short" })).status, 400);
    const staff = await login(t.base, "staff@example.com", "Another-Pass-77");
    const inbox = (await staff.get("/api/admin/enquiries")).data;
    assert.ok(inbox.length > 0);
    assert.equal((await staff.patch(`/api/admin/enquiries/${inbox[0].id}`, { status: "contacted", notes: "Called" })).data.status, "contacted");
    assert.equal((await staff.get("/api/admin/users")).status, 403);
    assert.equal((await staff.get("/api/admin/audit")).status, 403);
    assert.equal((await staff.put("/api/admin/settings", { name: "Hacked" })).status, 403);
    assert.equal((await staff.del(`/api/admin/enquiries/${inbox[0].id}`)).status, 403);
    const csv = (await staff.get("/api/admin/enquiries/export.csv")).data;
    assert.match(csv, /^ref,date,status/);
  });

  it("disabling a user ends their session at once", async () => {
    const owner = await login(t.base);
    const u = (await owner.get("/api/admin/users")).data.find((x) => x.email === "staff@example.com");
    const staff = await login(t.base, "staff@example.com", "Another-Pass-77");
    assert.equal((await staff.get("/api/admin/me")).status, 200);
    await owner.patch(`/api/admin/users/${u.id}`, { active: false });
    assert.equal((await staff.get("/api/admin/me")).status, 401);
  });

  it("an owner cannot lock themselves out; password change ends old sessions", async () => {
    const owner = await login(t.base); const other = await login(t.base);
    const me = (await owner.get("/api/admin/users")).data.find((x) => x.email === "owner@example.com");
    assert.equal((await owner.patch(`/api/admin/users/${me.id}`, { active: false })).status, 400);
    assert.equal((await other.post("/api/admin/me/password", { current: PW, next: "Brand-New-Pass-5" })).status, 204);
    assert.equal((await owner.get("/api/admin/me")).status, 401, "other session ended");
    assert.equal((await other.get("/api/admin/me")).status, 200, "this session continues");
    await other.post("/api/admin/me/password", { current: "Brand-New-Pass-5", next: PW });
  });
});

describe("safety", () => {
  it("sends security headers and never reveals the stack on errors", async () => {
    const r = await client(t.base).get("/api/health");
    assert.equal(r.headers.get("x-powered-by"), null);
    assert.match(r.headers.get("content-security-policy"), /default-src 'self'/);
    const bad = await fetch(t.base + "/api/public/enquiries", { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
    assert.equal(bad.status, 400); assert.equal((await bad.text()).includes("at "), false);
  });
});
