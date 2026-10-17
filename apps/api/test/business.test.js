import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, describe, it } from "node:test";
import { codeAt } from "../src/lib/totp.js";
import { amountInWords, calcTotals } from "../src/lib/gst.js";
import { boot, client, login, PW } from "./helpers.js";

let t, owner;
const wait = (ms = 60) => new Promise((r) => setTimeout(r, ms));
before(async () => {
  t = await boot({ env: { CRON_SECRET: "c".repeat(32), RAZORPAY_WEBHOOK_SECRET: "whsec_test" } });
  owner = await login(t.base);
  const s = (await owner.get("/api/admin/settings")).data;
  await owner.put("/api/admin/settings", { ...s, gstin: "36ABCDE1234F1Z5", stateCode: "36" });
});
after(async () => { await t.close(); });

describe("GST maths", () => {
  it("splits CGST/SGST inside the state, IGST outside, and rounds the total to the rupee", () => {
    const items = [{ qty: 100, rate: 1250, discountPct: 10, gstRate: 18 }, { qty: 3, rate: 33333, discountPct: 0, gstRate: 5 }];
    const intra = calcTotals(items, false).totals, inter = calcTotals(items, true).totals;
    assert.equal(intra.taxable, 112500 + 99999); assert.equal(intra.cgst + intra.sgst, inter.igst); assert.equal(inter.cgst, 0);
    assert.equal(intra.total % 100, 0); assert.equal(intra.total, intra.taxable + intra.tax + intra.roundOff);
    assert.equal(amountInWords(150000050), "Rupees Fifteen Lakh and Fifty Paise Only");
  });
});

describe("lead to cash", () => {
  let cust, quote, order, invoice;
  it("a website enquiry is assigned in turn, alerts the team and thanks the customer", async () => {
    const team = await owner.post("/api/admin/users", { email: "sales@example.com", name: "Sales One", role: "sales", password: "Quote-Maker-123", phone: "9000000001", receivesLeads: true });
    assert.equal(team.status, 201);
    const p = (await client(t.base).get("/api/public/catalog")).data.products[0];
    const r = await client(t.base).post("/api/public/enquiries", { name: "Anita Rao", company: "Lakeview Resort", phone: "98480 12345", email: "anita@lakeview.example", items: [{ productId: p.id, qty: 200 }], source: { utm_source: "google", utm_campaign: "amenities" } });
    assert.equal(r.status, 201); await wait(150);
    const e = await t.store.enquiries.findBy("ref", r.data.ref);
    assert.equal(e.assignedTo, team.data.id); assert.equal(e.source.utm_source, "google");
    const out = (await owner.get("/api/admin/outbox")).data.filter((m) => m.ref === e.ref);
    assert.ok(out.some((m) => m.event === "enquiryAlert" && m.channel === "whatsapp" && m.to === "919000000001"), "salesperson alerted on WhatsApp");
    assert.ok(out.some((m) => m.event === "enquiryAck" && m.to === "anita@lakeview.example"));
    assert.ok(out.every((m) => m.status === "logged" && m.manualLink), "no provider configured: kept for sending by hand");
  });

  it("converts the enquiry to a customer and builds a quote from it at catalogue rates", async () => {
    const e = (await owner.get("/api/admin/enquiries")).data.find((x) => x.name === "Anita Rao");
    await owner.patch(`/api/admin/products/${e.items[0].productId}`, { price: 1500, hsn: "3305", gstRate: 18 });
    const conv = await owner.post(`/api/admin/enquiries/${e.id}/convert`);
    assert.equal(conv.status, 200); cust = conv.data.customer;
    assert.equal(cust.name, "Lakeview Resort");
    const again = await owner.post(`/api/admin/enquiries/${e.id}/convert`);
    assert.equal(again.data.customer.id, cust.id, "no duplicate customer");
    await owner.patch(`/api/admin/customers/${cust.id}`, { gstin: "29AAACL1234A1Z2", billingAddress: "MG Road, Bengaluru" });
    const q = await owner.post(`/api/admin/quotes/from-enquiry/${e.id}`);
    assert.equal(q.status, 201, JSON.stringify(q.data)); quote = q.data;
    assert.match(quote.number, /^Q\/\d{4}-\d{2}\/0001$/);
    assert.equal(quote.items[0].rate, 1500); assert.equal(quote.interState, true, "Karnataka customer, Telangana company: IGST");
    assert.equal(quote.totals.igst, Math.round(200 * 1500 * 0.18)); assert.equal(quote.customer.state, "Karnataka");
  });

  it("price lists give customers special rates", async () => {
    const pl = await owner.post("/api/admin/price-lists", { name: "Resorts 10%", discountPct: 10 });
    await owner.patch(`/api/admin/customers/${cust.id}`, { priceListId: pl.data.id });
    const rates = (await owner.get(`/api/admin/rates?customerId=${cust.id}`)).data;
    assert.equal(rates.find((x) => x.productId === quote.items[0].productId).rate, 1350);
  });

  it("sending the quote messages the customer a link; the customer accepts online and an order is created", async () => {
    const sent = await owner.post(`/api/admin/quotes/${quote.id}/send`);
    assert.equal(sent.data.status, "sent");
    const msg = (await t.store.outbox.all()).find((m) => m.event === "quoteSend" && m.ref === quote.number);
    const tok = msg.body.match(/\/doc\/quote\/([\w-]+)/)[1];
    const doc = await client(t.base).get(`/api/public/doc/quote/${tok}`);
    assert.equal(doc.status, 200); assert.equal(doc.data.doc.number, quote.number); assert.equal(doc.data.doc.token, undefined); assert.match(doc.data.doc.amountInWords, /^Rupees/);
    assert.equal((await client(t.base).post(`/api/public/doc/quote/${tok}/accept`, { name: "" })).status, 400);
    const acc = await client(t.base).post(`/api/public/doc/quote/${tok}/accept`, { name: "Anita Rao" });
    assert.equal(acc.status, 200);
    assert.equal((await client(t.base).post(`/api/public/doc/quote/${tok}/accept`, { name: "Anita Rao" })).status, 409, "cannot accept twice");
    const q = (await owner.get(`/api/admin/quotes/${quote.id}`)).data;
    assert.equal(q.status, "converted"); assert.ok(q.orderId);
    order = (await owner.get(`/api/admin/orders/${q.orderId}`)).data;
    assert.match(order.number, /^SO\//); assert.equal(order.totals.total, quote.totals.total);
    assert.equal((await client(t.base).get("/api/public/doc/quote/not-a-real-token-123456")).status, 404);
  });

  it("dispatching takes stock out and issues a delivery challan; invoicing numbers per financial year", async () => {
    const pid = order.items[0].productId;
    await owner.post("/api/admin/stock/adjust", { productId: pid, qty: 500, kind: "in", note: "Opening stock" });
    const d = await owner.post(`/api/admin/orders/${order.id}/dispatch`, { transporter: "VRL Logistics", trackingNo: "VRL123" });
    assert.equal(d.data.status, "dispatched"); assert.match(d.data.challanNumber, /^DC\//);
    assert.equal((await owner.get("/api/admin/stock")).data.find((s) => s.id === pid).qty, 300);
    assert.equal((await client(t.base).get(`/api/public/doc/challan/${d.data.token}`)).status, 200);
    const inv = await owner.post(`/api/admin/orders/${order.id}/invoice`);
    assert.equal(inv.status, 201); invoice = inv.data;
    assert.match(invoice.number, /^INV\/\d{4}-\d{2}\/0001$/); assert.ok(invoice.number.length <= 16);
    assert.equal(invoice.status, "unpaid"); assert.equal(invoice.customer.gstin, "29AAACL1234A1Z2");
    assert.equal((await owner.post(`/api/admin/orders/${order.id}/invoice`)).status, 409, "one invoice per order");
    const inv2 = await owner.post("/api/admin/invoices", { customerId: cust.id, items: [{ name: "Custom printing", qty: 1, rate: 50000, gstRate: 18 }] });
    assert.match(inv2.data.number, /\/0002$/);
    assert.equal((await owner.post(`/api/admin/invoices/${inv2.data.id}/void`, { reason: "test" })).data.status, "void");
  });

  it("records part and full payments, refuses over-payment, and sends receipts", async () => {
    const half = Math.floor(invoice.totals.total / 2);
    const p1 = await owner.post(`/api/admin/invoices/${invoice.id}/payments`, { amount: half, mode: "upi", reference: "UPI1" });
    assert.equal(p1.data.invoice.status, "partial");
    assert.equal((await owner.post(`/api/admin/invoices/${invoice.id}/payments`, { amount: invoice.totals.total })).status, 400);
    const p2 = await owner.post(`/api/admin/invoices/${invoice.id}/payments`, { amount: invoice.totals.total - half, mode: "bank" });
    assert.equal(p2.data.invoice.status, "paid");
    assert.ok((await t.store.outbox.all()).filter((m) => m.event === "paymentReceipt").length >= 2);
    assert.equal((await owner.post(`/api/admin/invoices/${invoice.id}/void`)).status, 409, "cannot void a paid invoice");
    const cd = (await owner.get(`/api/admin/customers/${cust.id}`)).data;
    assert.equal(cd.outstanding, 0); assert.equal(cd.invoices.length, 2);
  });

  it("reports and accountant exports add up", async () => {
    const r = (await owner.get("/api/admin/reports")).data;
    assert.equal(r.totals.invoiced, invoice.totals.total); assert.equal(r.totals.received, invoice.totals.total);
    assert.equal(r.funnel.enquiries >= 1, true); assert.equal(r.funnel.accepted, 1);
    assert.ok(r.sources.some((s) => s.source === "google"));
    const reg = (await owner.get("/api/admin/reports/sales-register.csv")).data;
    assert.match(reg, /^invoice_no,date,status,customer,gstin/); assert.ok(reg.includes(invoice.number)); assert.ok(reg.includes("29-Karnataka"));
    assert.match((await owner.get("/api/admin/reports/hsn-summary.csv")).data, /3305,18/);
    const dash = (await owner.get("/api/admin/dashboard")).data;
    assert.equal(dash.salesThisMonth, invoice.totals.total);
  });
});

describe("automations on a schedule", () => {
  it("expires old quotes, reminds about unanswered quotes and overdue invoices, alerts low stock, sends the daily summary once", async () => {
    const c = (await t.store.customers.all())[0];
    const pid = (await t.store.products.all())[2].id;
    const q = (await owner.post("/api/admin/quotes", { customerId: c.id, items: [{ productId: pid, name: "Soap", qty: 10, rate: 1000 }] })).data;
    await owner.post(`/api/admin/quotes/${q.id}/send`);
    await t.store.quotes.update(q.id, { sentAt: new Date(Date.now() - 4 * 86400_000).toISOString() });
    const old = (await owner.post("/api/admin/quotes", { customerId: c.id, items: [{ name: "Linen", qty: 1, rate: 1000 }], validUntil: "2020-01-01" })).data;
    await owner.post(`/api/admin/quotes/${old.id}/send`);
    const inv = (await owner.post("/api/admin/invoices", { customerId: c.id, items: [{ name: "Towels", qty: 2, rate: 10000 }], date: "2026-01-01", dueDate: "2026-01-10" })).data;
    await owner.patch(`/api/admin/stock/${pid}`, { stockTracked: true, reorderLevel: 50 });
    const run = (await owner.post("/api/admin/automation/run")).data;
    assert.equal(run.quoteExpire, 1); assert.equal(run.quoteReminder, 1); assert.ok(run.invoiceOverdue >= 1); assert.ok(run.lowStock >= 1);
    assert.equal((await owner.get(`/api/admin/quotes/${old.id}`)).data.status, "expired");
    assert.deepEqual((await t.store.invoices.get(inv.id)).remindersSent.sort((a, b) => a - b), [1, 7, 15]);
    const again = (await owner.post("/api/admin/automation/run")).data;
    assert.equal(again.quoteReminder, undefined, "no repeat reminders"); assert.equal(again.lowStock, undefined, "low stock alerted once"); assert.equal(again.dailySummary, undefined);
  });

  it("rules can be switched off by the owner", async () => {
    const cfg = (await owner.get("/api/admin/automation")).data;
    assert.ok(cfg.rules.length >= 15);
    await owner.put("/api/admin/automation", { enabled: { enquiryAck: false } });
    const before = (await t.store.outbox.all()).filter((m) => m.event === "enquiryAck").length;
    await client(t.base).post("/api/public/enquiries", { name: "Second Person", phone: "9123456780", email: "p2@example.com", message: "Need slippers" });
    await wait(150);
    assert.equal((await t.store.outbox.all()).filter((m) => m.event === "enquiryAck").length, before);
    await owner.put("/api/admin/automation", { enabled: { enquiryAck: true } });
  });

  it("the external scheduler needs the secret", async () => {
    assert.equal((await client(t.base).post("/api/internal/cron", {}, { headers: { "x-cron-secret": "wrong" } })).status, 401);
    assert.equal((await client(t.base).post("/api/internal/cron", {}, { headers: { "x-cron-secret": "c".repeat(32) } })).status, 200);
  });
});

describe("stock and purchasing", () => {
  it("creates purchase orders for low stock and receiving them adds stock", async () => {
    const sup = (await owner.post("/api/admin/suppliers", { name: "Deccan Amenities Pvt Ltd", phone: "9000011111" })).data;
    const p = (await t.store.products.all())[2];
    await owner.patch(`/api/admin/stock/${p.id}`, { supplierId: sup.id, reorderQty: 400, costPrice: 700 });
    const auto = (await owner.post("/api/admin/purchases/from-low-stock")).data;
    const po = auto.created.find((x) => x.supplierId === sup.id);
    assert.ok(po); assert.match(po.number, /^PO\//); assert.equal(po.items[0].qty, 400); assert.equal(po.total, 400 * 700);
    await owner.post(`/api/admin/purchases/${po.id}/status`, { status: "sent" });
    const part = (await owner.post(`/api/admin/purchases/${po.id}/receive`, { lines: [{ productId: p.id, qty: 150 }] })).data;
    assert.equal(part.status, "partial");
    const full = (await owner.post(`/api/admin/purchases/${po.id}/receive`, { lines: [{ productId: p.id, qty: 250 }] })).data;
    assert.equal(full.status, "received");
    assert.equal((await owner.get("/api/admin/stock")).data.find((s) => s.id === p.id).qty, 400);
  });
});

describe("roles, two-step sign-in, payments webhook, content, backup", () => {
  it("each role only reaches its own modules", async () => {
    await owner.post("/api/admin/users", { email: "wh@example.com", name: "Warehouse", role: "warehouse", password: "Store-Room-55" });
    await owner.post("/api/admin/users", { email: "acc@example.com", name: "Accounts", role: "accounts", password: "Ledger-Book-77" });
    const wh = await login(t.base, "wh@example.com", "Store-Room-55"), acc = await login(t.base, "acc@example.com", "Ledger-Book-77"), sales = await login(t.base, "sales@example.com", "Quote-Maker-123");
    assert.equal((await wh.get("/api/admin/stock")).status, 200); assert.equal((await wh.get("/api/admin/orders")).status, 200);
    for (const u of ["/api/admin/invoices", "/api/admin/enquiries", "/api/admin/reports", "/api/admin/customers"]) assert.equal((await wh.get(u)).status, 403, u);
    assert.equal((await acc.get("/api/admin/invoices")).status, 200); assert.equal((await acc.get("/api/admin/stock")).status, 403); assert.equal((await acc.get("/api/admin/products")).status, 403);
    assert.equal((await sales.get("/api/admin/quotes")).status, 200); assert.equal((await sales.get("/api/admin/invoices")).status, 403);
    assert.equal((await sales.put("/api/admin/automation", {})).status, 403);
    assert.deepEqual((await wh.get("/api/admin/me")).data.permissions, ["catalog", "orders", "stock"]);
  });

  it("two-step sign-in asks for the authenticator code", async () => {
    await owner.post("/api/admin/users", { email: "tf@example.com", name: "Two Factor", role: "manager", password: "Two-Factor-88" });
    const u = await login(t.base, "tf@example.com", "Two-Factor-88");
    const setup = (await u.post("/api/admin/me/2fa/setup")).data;
    assert.match(setup.otpauth, /^otpauth:\/\/totp\//);
    assert.equal((await u.post("/api/admin/me/2fa/enable", { code: "000000" })).status, 400);
    assert.equal((await u.post("/api/admin/me/2fa/enable", { code: codeAt(setup.secret) })).data.twoFactor, true);
    const c = client(t.base);
    const noCode = await c.post("/api/admin/login", { email: "tf@example.com", password: "Two-Factor-88" });
    assert.equal(noCode.status, 401); assert.equal(noCode.data.error, "CODE_REQUIRED");
    assert.equal((await c.post("/api/admin/login", { email: "tf@example.com", password: "Two-Factor-88", code: "123456" })).data.error, "BAD_CODE");
    assert.equal((await c.post("/api/admin/login", { email: "tf@example.com", password: "Two-Factor-88", code: codeAt(setup.secret) })).status, 200);
  });

  it("a signed Razorpay webhook records the payment once; a forged one is refused", async () => {
    const c = (await t.store.customers.all())[0];
    const inv = (await owner.post("/api/admin/invoices", { customerId: c.id, items: [{ name: "Kits", qty: 1, rate: 100000, gstRate: 0 }] })).data;
    const body = JSON.stringify({ event: "payment_link.paid", payload: { payment_link: { entity: { notes: { invoiceId: inv.id } } }, payment: { entity: { id: "pay_ABC", amount: 100000 } } } });
    const sig = crypto.createHmac("sha256", "whsec_test").update(body).digest("hex");
    const post = (s) => fetch(t.base + "/api/webhooks/razorpay", { method: "POST", headers: { "content-type": "application/json", "x-razorpay-signature": s }, body });
    assert.equal((await post("bad".repeat(21) + "a")).status, 401);
    assert.equal((await post(sig)).status, 200); assert.equal((await post(sig)).status, 200);
    const after = await t.store.invoices.get(inv.id);
    assert.equal(after.status, "paid"); assert.equal((await t.store.payments.all()).filter((p) => p.external === "pay_ABC").length, 1);
  });

  it("home page content is editable and public", async () => {
    const home = (await owner.get("/api/admin/content/home")).data;
    const r = await owner.put("/api/admin/content/home", { ...home, hero: { ...home.hero, title: "Hotel supplies, delivered." }, testimonials: [{ quote: "Reliable partner for 10 years.", name: "GM, Hotel Sai" }] });
    assert.equal(r.status, 200);
    const pub = (await client(t.base).get("/api/public/settings")).data;
    assert.equal(pub.home.hero.title, "Hotel supplies, delivered."); assert.equal(pub.home.testimonials.length, 1);
    assert.equal(pub.bankDetails, undefined, "private settings are not public");
    assert.equal((await owner.put("/api/admin/content/home", { ...home, hero: { ...home.hero, image: "https://evil.example/x.png" } })).status, 400);
  });

  it("the owner's backup has every module but no password hashes", async () => {
    const b = (await owner.get("/api/admin/backup")).data;
    const j = typeof b === "string" ? JSON.parse(b) : b;
    assert.ok(j.invoices.length && j.customers.length && j.quotes.length);
    assert.ok(!JSON.stringify(j).includes("passwordHash")); assert.ok(!JSON.stringify(j).includes("totpSecret"));
    const sales = await login(t.base, "sales@example.com", "Quote-Maker-123");
    assert.equal((await sales.get("/api/admin/backup")).status, 403);
  });
});

describe("first-owner bootstrap", () => {
  it("never creates an admin with a built-in password", async () => {
    const b = await boot({ seed: true, owner: false });
    assert.equal(await b.store.admins.count(), 0);
    await b.close();
  });
});
void PW;
