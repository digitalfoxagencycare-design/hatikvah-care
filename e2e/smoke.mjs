import { chromium } from "playwright-core";
// Browser smoke test. Needs: npm i -D playwright-core, a running server (npm start) with an owner account created, and a Chrome/Chromium binary.
//   BASE_URL=http://localhost:8080 ADMIN_EMAIL=... ADMIN_PASSWORD=... CHROME=/path/to/chrome node e2e/smoke.mjs
const B = process.env.BASE_URL || "http://localhost:8080";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD");
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ["--no-sandbox"] });
const errors = [];
const mk = async (w, h) => { const c = await browser.newContext({ viewport: { width: w, height: h } }); const p = await c.newPage(); p.on("console", (m) => m.type() === "error" && errors.push(m.text())); p.on("pageerror", (e) => errors.push("PAGEERR " + e.message)); p.on("requestfailed", (r) => !r.url().includes("fonts.g") && errors.push("REQFAIL " + r.url())); return p; };
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) process.exitCode = 1; };

const p = await mk(1280, 900);
await p.goto(B + "/"); await p.waitForSelector(".cat-grid");
ok((await p.locator(".cat").count()) === 8, "home shows 8 categories");
ok((await p.locator(".card").count()) >= 8, "home shows featured products");
await p.screenshot({ path: "e2e/out/home.png", fullPage: false });
await p.goto(B + "/catalog"); await p.waitForSelector(".card");
ok((await p.locator(".card").count()) === 24, "catalog first page 24");
await p.fill('input[type=search]', "towel");
await p.waitForTimeout(300);
const towels = await p.locator(".card").count(); ok(towels >= 5, `search 'towel' → ${towels}`);
await p.fill('input[type=search]', "zzzzqq"); ok(await p.locator(".empty").isVisible(), "empty state on no match");
await p.goto(B + "/catalog?category=bath-body"); await p.waitForSelector(".card");
ok((await p.locator(".chip").count()) > 3, "collection chips");
await p.screenshot({ path: "e2e/out/catalog.png" });
await p.locator(".card h3 a").first().click(); await p.waitForSelector(".p-grid");
ok((await p.title()).includes("HaTikvah Care"), "product title");
await p.screenshot({ path: "e2e/out/product.png" });
await p.click("text=Add to quote"); ok(await p.locator(".notice").isVisible(), "added to quote");
await p.goto(B + "/quote"); await p.waitForSelector(".lines li");
await p.fill('input[autocomplete=name]', "Ravi Kumar"); await p.fill('input[type=tel]', "9876543210");
await p.fill("textarea", "Need 500 pieces by month end");
await p.click("text=Send quote request"); await p.waitForSelector(".success");
ok((await p.locator(".success").innerText()).includes("HC-"), "quote submitted with ref");
await p.goto(B + "/quote"); await p.fill('input[autocomplete=name]', "X"); await p.click("text=Send quote request");
ok(await p.locator(".alert").isVisible(), "validation error shown for missing phone/empty");
await p.goto(B + "/nonexistent"); ok((await p.locator("h1").innerText()).includes("couldn't find"), "404 page");
await p.goto(B + "/product/nope"); ok((await p.locator("h1").innerText()).includes("couldn't find"), "unknown product page");

// mobile
const m = await mk(390, 800);
await m.goto(B + "/"); await m.waitForSelector(".hero");
const overflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
ok(!overflow, "no horizontal scroll on phone (home)");
await m.click(".menu-btn"); ok(await m.locator("nav#nav.open").isVisible(), "mobile menu opens");
await m.screenshot({ path: "e2e/out/home-mobile.png" });
await m.goto(B + "/catalog"); await m.waitForSelector(".card");
ok(!(await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), "no horizontal scroll on phone (catalog)");

// admin
const a = await mk(1280, 900);
await a.goto(B + "/admin"); await a.waitForSelector("form");
await a.fill('input[type=email]', ADMIN_EMAIL); await a.fill('input[type=password]', "wrong-password-1"); await a.click("button.btn");
await a.waitForSelector(".alert"); ok(true, "bad login shows error");
await a.fill('input[type=password]', ADMIN_PASSWORD); await a.click("button.btn"); await a.waitForSelector(".tiles");
await a.screenshot({ path: "e2e/out/admin-dash.png" });
await a.click("text=Products"); await a.waitForSelector(".tbl tbody tr");
ok((await a.locator(".tbl tbody tr").count()) >= 140, "admin lists all products");
const row = a.locator(".tbl tbody tr").first();
await row.locator(".price-in input").fill("199.50"); await row.locator(".price-in input").press("Enter");
await a.waitForTimeout(600);
await row.locator(".unit-in").fill("per kit"); await row.locator(".unit-in").blur(); await a.waitForTimeout(600);
await a.screenshot({ path: "e2e/out/admin-products.png" });
const fresh = await mk(1280, 900); await fresh.goto(B + "/catalog"); await fresh.waitForSelector(".card");
ok((await fresh.locator(".card").first().innerText()).includes("₹199.50"), "price typed in admin shows on public site");
await a.goto(B + "/admin/enquiries"); await a.waitForSelector(".enq");
await a.locator(".enq-head").first().click(); await a.waitForSelector(".enq-body");
await a.screenshot({ path: "e2e/out/admin-enq.png" });
await a.goto(B + "/admin/products/new"); await a.waitForSelector("form");
await a.fill('label:has-text("Name *") input', "Test Brand New Item"); await a.fill('label:has-text("Price (₹)") input', "50");
await a.click("text=Save product"); await a.waitForURL(/\/admin\/products\/[0-9a-f-]{36}$/);
ok(true, "created product from the form");
await a.screenshot({ path: "e2e/out/admin-form.png" });
await a.goto(B + "/admin/settings"); await a.waitForSelector("form"); ok(true, "settings page");
console.log("console/network errors:", errors.length ? errors : "none");
await browser.close();
