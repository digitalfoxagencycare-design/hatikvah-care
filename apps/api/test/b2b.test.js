import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, describe, it } from "node:test";
import { hashPassword } from "../src/auth.js";
import { batchLevels } from "../src/lib/sales.js";
import { expandLines, measureLabel, uomOptions } from "../src/lib/units.js";
import { normaliseStatus } from "../src/services/delivery_shadowfax.js";
import { boot, login, PW } from "./helpers.js";

const APP_SECRET = "meta-app-secret-for-tests", VERIFY = "verify-token-0123456789", SFX_HOOK = "s".repeat(32);
let t, owner, product, customer, sent = [], sfx = [];
// Stands in for Meta Graph, Razorpay and Shadowfax.
const fakeFetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes("graph.facebook.com")) { const b = JSON.parse(init.body); sent.push(b); return new Response(JSON.stringify({ messages: [{ id: `wamid.T${sent.length}` }] }), { status: 200 }); }
  if (u.includes("razorpay.com")) return new Response(JSON.stringify({ id: "plink_q1", short_url: "https://rzp.io/i/quote1" }), { status: 200 });
  if (u.includes("shadowfax")) {
    sfx.push({ url: u, body: init.body ? JSON.parse(init.body) : null });
    if (u.includes("serviceability")) return new Response(JSON.stringify({ serviceable: u.includes("delivery_pincode=500034") }), { status: 200 });
    return new Response(JSON.stringify({ data: { awb_number: "SF123456", id: 99 } }), { status: 200 });
  }
  return new Response("{}", { status: 200 });
};
const wait = (ms = 60) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  t = await boot({ fetchImpl: fakeFetch, env: {
    WHATSAPP_TOKEN: "wa_test", WHATSAPP_PHONE_ID: "1368252233043036", WHATSAPP_WEBHOOK_VERIFY_TOKEN: VERIFY, WHATSAPP_APP_SECRET: APP_SECRET,
    RAZORPAY_KEY_ID: "rzp_test", RAZORPAY_KEY_SECRET: "secret", RAZORPAY_WEBHOOK_SECRET: "whsec_b2b",
    SHADOWFAX_API_TOKEN: "sfx_test", SHADOWFAX_BASE_URL: "https://staging.shadowfax.example", SHADOWFAX_WEBHOOK_TOKEN: SFX_HOOK, SHADOWFAX_PICKUP_PINCODE: "500084",
  } });
  owner = await login(t.base);
  const all = (await owner.get("/api/admin/products")).data;
  product = (await owner.patch(`/api/admin/products/${all[0].id}`, {
    price: 1000, gstRate: 18, unit: "pcs", measure: { domain: "volume", unit: "ml", value: 30 },
    packaging: { baseUnit: "bottle", innerPack: { name: "box", qty: 50 }, masterCarton: { name: "carton", qty: 10 } }, packPrices: { box: 45000, carton: null },
  })).data;
  customer = (await owner.post("/api/admin/customers", { name: "Hotel Sai", contactName: "Ravi", phone: "+91 98765 43210", stateCode: "36", shippingAddress: "Road 3, Banjara Hills, Hyderabad 500034" })).data;
});
after(async () => { await t.close(); });

describe("measurements and packaging", () => {
  it("labels measurements and expands piece / box / carton", () => {
    assert.equal(measureLabel({ domain: "dimensions", unit: "inch", length: 27, width: 54 }), "27 x 54 inch");
    assert.equal(measureLabel({ domain: "weight", unit: "g", value: 15 }), "15 g");
    const opts = uomOptions(product);
    assert.deepEqual(opts.map((o) => [o.uom, o.perUnit, o.rate]), [["piece", 1, 1000], ["box", 50, 45000], ["carton", 500, 500000]], "box has its own wholesale price; carton falls back to pieces x price");
    assert.match(expandLines([{ productId: "x", uom: "box", qty: 1 }], { x: { name: "Soap", price: 10 } }).error, /not sold by the box/);
  });
  it("rejects a carton without an inner pack", async () => {
    const r = await owner.patch(`/api/admin/products/${product.id}`, { packaging: { innerPack: null, masterCarton: { name: "carton", qty: 10 } } });
    assert.equal(r.status, 400);
  });
  it("quotes by the carton keep the ordered unit and record pieces", async () => {
    const rates = (await owner.get(`/api/admin/rates?customerId=${customer.id}`)).data.find((r) => r.productId === product.id);
    assert.equal(rates.uoms.find((u) => u.uom === "carton").perUnit, 500);
    const q = await owner.post("/api/admin/quotes", { customerId: customer.id, items: [{ productId: product.id, name: product.name, qty: 2, rate: 500000, uom: "carton", perUnit: 1 }] });
    assert.equal(q.status, 201, JSON.stringify(q.data));
    assert.equal(q.data.items[0].perUnit, 500, "pieces per carton come from the product, not the browser");
    assert.equal(q.data.items[0].unit, "carton of 500");
    assert.equal(q.data.totals.taxable, 1_000_000);
    const badUom = await owner.post("/api/admin/quotes", { customerId: customer.id, items: [{ productId: (await owner.get("/api/admin/products")).data[1].id, name: "x", qty: 1, rate: 1, uom: "box" }] });
    assert.equal(badUom.status, 400); assert.match(badUom.data.message, /not sold by the box/);
  });
});

describe("stock buckets and batches", () => {
  let order;
  it("an open sales order reserves stock; invoicing takes it out", async () => {
    await owner.patch(`/api/admin/stock/${product.id}`, { reorderLevel: 950 });
    assert.equal((await owner.post("/api/admin/stock/adjust", { productId: product.id, kind: "in", qty: 1000, note: "opening" })).status, 201);
    order = (await owner.post("/api/admin/orders", { customerId: customer.id, items: [{ productId: product.id, name: product.name, qty: 2, rate: 45000, uom: "box" }] })).data;
    let row = (await owner.get("/api/admin/stock")).data.find((p) => p.id === product.id);
    assert.deepEqual([row.physical, row.reserved, row.available, row.low], [1000, 100, 900, true], "low is judged on available stock");
    const dash = (await owner.get("/api/admin/dashboard")).data;
    assert.ok(dash.lowStockItems.some((p) => p.id === product.id && "reorderQty" in p && "physical" in p)); assert.ok(dash.dispatchQueue.some((o) => o.id === order.id)); assert.equal(dash.aging.length, 5);
    assert.equal((await owner.post(`/api/admin/orders/${order.id}/invoice`)).status, 201);
    row = (await owner.get("/api/admin/stock")).data.find((p) => p.id === product.id);
    assert.deepEqual([row.physical, row.reserved, row.available], [900, 0, 900], "2 boxes = 100 pieces left the warehouse");
  });
  it("batch-tracked stock needs a batch, and goes out first-expiring-first", async () => {
    await owner.patch(`/api/admin/stock/${product.id}`, { batchTracked: true });
    assert.equal((await owner.post("/api/admin/stock/adjust", { productId: product.id, kind: "in", qty: 10 })).status, 400);
    for (const [n, exp] of [["B-LATE", "2027-12-31"], ["B-SOON", "2026-11-15"]]) {
      assert.equal((await owner.post("/api/admin/stock/adjust", { productId: product.id, kind: "in", qty: 20, batch: { batchNumber: n, mfgDate: "2026-01-01", expDate: exp } })).status, 201);
    }
    await owner.post("/api/admin/stock/adjust", { productId: product.id, kind: "out", qty: 25, note: "sample" });
    const b = (await owner.get(`/api/admin/stock/batches?productId=${product.id}`)).data;
    assert.deepEqual(b.map((x) => [x.batchNumber, x.qty]), [["B-LATE", 15]], "the soon-expiring batch was used up first");
    assert.equal(batchLevels([{ productId: "p", qty: 5, at: "1", batch: { batchNumber: "A", expDate: "2026-01-01" } }], "2026-01-11")[0].daysToExpiry, -10);
    await owner.patch(`/api/admin/stock/${product.id}`, { batchTracked: false });
  });
});

describe("counter billing (POS) and cash book", () => {
  it("bills a walk-in buyer, takes cash and posts the cash book", async () => {
    const before = (await owner.get("/api/admin/stock")).data.find((p) => p.id === product.id).physical;
    const r = await owner.post("/api/admin/pos/invoice", { walkIn: { name: "Walk-in Spa", phone: "", gstin: "", stateCode: "" }, items: [{ productId: product.id, name: product.name, qty: 1, rate: 45000, uom: "box", gstRate: 5 }], payment: { mode: "cash" } });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.invoice.status, "paid"); assert.equal(r.data.invoice.customer.name, "Walk-in Spa");
    assert.equal(r.data.invoice.totals.tax, 2250, "5% GST chosen at the counter");
    const after_ = (await owner.get("/api/admin/stock")).data.find((p) => p.id === product.id).physical;
    assert.equal(before - after_, 50);
    const book = (await owner.get("/api/admin/ledger?account=cash")).data;
    assert.ok(book.rows.some((e) => e.ref === r.data.invoice.number && e.amount === r.data.payment.amount));
    assert.equal((await owner.del(`/api/admin/payments/${r.data.payment.id}`)).status, 204);
    assert.equal((await owner.get("/api/admin/ledger?account=cash")).data.rows.filter((e) => e.paymentId === r.data.payment.id).length, 2, "payment reversal preserves the receipt and compensating entry");
  });
});

describe("roles", () => {
  it("billing, warehouse and sales roles see only their modules", async () => {
    const mk = async (role) => { const email = `${role}@example.com`; await t.store.admins.insert({ email, name: role, role, passwordHash: await hashPassword(PW), active: true, tokenVersion: 0, createdAt: "x" }); return login(t.base, email); };
    const billing = await mk("billing_executive"), wh = await mk("warehouse_manager"), rep = await mk("sales_representative");
    assert.equal((await billing.post("/api/admin/pos/invoice", {})).status, 400, "billing may use the counter");
    assert.equal((await billing.get("/api/admin/stock")).status, 403);
    assert.equal((await billing.get("/api/admin/ledger")).status, 403, "ledgers are for admin / accounts");
    assert.equal((await wh.get("/api/admin/stock")).status, 200);
    assert.equal((await wh.get("/api/admin/invoices")).status, 403);
    assert.equal((await rep.get("/api/admin/quotes")).status, 200);
    assert.equal((await rep.get("/api/admin/orders")).status, 403);
    assert.deepEqual((await rep.get("/api/admin/me")).data.permissions, ["catalog", "enquiries", "customers", "quotes"]);
  });
});

describe("WhatsApp webhook", () => {
  const sign = (body) => "sha256=" + crypto.createHmac("sha256", APP_SECRET).update(body).digest("hex");
  const post = (payload, sig) => { const body = JSON.stringify(payload); return fetch(t.base + "/api/webhooks/whatsapp", { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": sig ?? sign(body) }, body }); };
  const msg = (id, from, m) => ({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { metadata: { phone_number_id: "1368252233043036" }, contacts: [{ wa_id: from, profile: { name: "Dr. Mehta" } }], messages: [{ id, from, timestamp: String(Math.floor(Date.now() / 1000)), ...m }] } }] }] });

  it("answers Meta's verification", async () => {
    const ok = await fetch(`${t.base}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=12345`);
    assert.equal(ok.status, 200); assert.equal(await ok.text(), "12345");
    assert.equal((await fetch(`${t.base}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong-token-0000000&hub.challenge=1`)).status, 403);
  });
  it("refuses unsigned posts", async () => {
    assert.equal((await post(msg("wamid.bad", "919000000001", { type: "text", text: { body: "hi" } }), "sha256=00")).status, 401);
  });
  it("creates a lead, sends the menu, and turns a quote request into an enquiry", async () => {
    sent = [];
    assert.equal((await post(msg("wamid.in1", "919812345678", { type: "text", text: { body: "Hello" } }))).status, 200);
    const c = (await owner.get("/api/admin/customers")).data.find((x) => x.phone.endsWith("9812345678"));
    assert.ok(c, "new lead created by mobile number"); assert.equal(c.name, "Dr. Mehta");
    assert.equal(sent.at(-1).interactive.type, "button", "quick menu with reply buttons");
    assert.deepEqual(sent.at(-1).interactive.action.buttons.map((b) => b.reply.id), ["quote", "hotel", "clinic"]);
    assert.equal((await post(msg("wamid.in1", "919812345678", { type: "text", text: { body: "Hello" } }))).status, 200);
    assert.equal((await owner.get("/api/admin/whatsapp/inbox")).data.filter((m) => m.waMessageId === "wamid.in1").length, 1, "Meta retries are stored once");
    await post(msg("wamid.in2", "919812345678", { type: "interactive", interactive: { type: "button_reply", button_reply: { id: "quote", title: "Request a quote" } } }));
    await post(msg("wamid.in3", "919812345678", { type: "text", text: { body: "200 hand sanitiser 500 ml for City Clinic, Hyderabad" } }));
    const enq = (await owner.get("/api/admin/enquiries")).data.find((e) => e.customerId === c.id);
    assert.ok(enq); assert.match(enq.message, /hand sanitiser/); assert.match(sent.at(-1).text.body, new RegExp(enq.ref));
  });
  it("maps a catalogue order to products by SKU", async () => {
    await post(msg("wamid.in4", "919812345678", { type: "order", order: { product_items: [{ product_retailer_id: product.sku, quantity: "3", item_price: 10 }, { product_retailer_id: "NOPE", quantity: 1 }] } }));
    const enq = (await owner.get("/api/admin/enquiries")).data.find((e) => e.items.some((i) => i.productId === product.id) && e.source?.channel === "whatsapp");
    assert.ok(enq); assert.match(enq.message, /NOPE/);
  });
  it("status callbacks move the outbox row to delivered and read", async () => {
    const m = (await t.store.outbox.all()).find((x) => x.waMessageId);
    const st = (id, status) => ({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { statuses: [{ id, status, timestamp: "1790000100" }] } }] }] });
    await post(st(m.waMessageId, "read")); await post(st(m.waMessageId, "delivered"));
    assert.equal((await t.store.outbox.get(m.id)).deliveryStatus, "read", "never goes backwards");
  });
});

describe("Shadowfax", () => {
  it("checks serviceability, books the pickup on dispatch and relays status to the customer", async () => {
    assert.equal((await owner.get("/api/admin/logistics/serviceability?pincode=500034")).data.serviceable, true);
    assert.equal((await owner.get("/api/admin/logistics/serviceability?pincode=110001")).data.serviceable, false);
    const o = (await owner.post("/api/admin/orders", { customerId: customer.id, items: [{ productId: product.id, name: product.name, qty: 1, rate: 1000 }] })).data;
    const d = await owner.post(`/api/admin/orders/${o.id}/dispatch`, { courier: "shadowfax", weightKg: 2 });
    assert.equal(d.status, 200, JSON.stringify(d.data));
    assert.equal(d.data.shipment.awb, "SF123456"); assert.match(d.data.shipment.trackingUrl, /SF123456/);
    assert.equal(sfx.at(-1).body.customer_details.pincode, "500034", "drop PIN taken from the shipping address");
    const hook = (body, token = SFX_HOOK) => fetch(t.base + "/api/webhooks/shadowfax", { method: "POST", headers: { "content-type": "application/json", "x-shadowfax-token": token }, body: JSON.stringify(body) });
    assert.equal((await hook({ awb_number: "SF123456", status: "PICKED" }, "x".repeat(32))).status, 401);
    sent = [];
    // the customer wrote to us within the last day, so WhatsApp's 24-hour window is open and a free-form link button is allowed
    await t.store.inbox.insert({ waMessageId: "wamid.recent", from: "919876543210", at: new Date().toISOString(), type: "text", text: "When will it arrive?", items: [], readAt: null });
    assert.equal((await hook({ awb_number: "SF123456", status: "Picked", rider_name: "Anil" })).status, 200);
    await wait();
    assert.ok(sent.some((m) => m.interactive?.action?.parameters?.url?.includes("SF123456")), "tracking link sent on WhatsApp");
    await hook({ awb_number: "SF123456", status: "delivered" });
    assert.equal((await owner.get(`/api/admin/orders/${o.id}`)).data.status, "delivered");
    assert.equal(normaliseStatus("OUT FOR DELIVERY"), "out_for_delivery"); assert.equal(normaliseStatus("RTO initiated"), "returned");
  });
});

describe("Razorpay link on a quote", () => {
  it("paying it accepts the quote, raises order + invoice, records the payment and posts the bank book", async () => {
    const q = (await owner.post("/api/admin/quotes", { customerId: customer.id, items: [{ productId: product.id, name: product.name, qty: 1, rate: 45000, uom: "box" }] })).data;
    const l = await owner.post(`/api/admin/quotes/${q.id}/paylink`);
    assert.equal(l.status, 200); assert.equal(l.data.payLink.url, "https://rzp.io/i/quote1");
    const body = JSON.stringify({ event: "payment_link.paid", payload: { payment_link: { entity: { id: l.data.payLink.id, currency: "INR", status: "paid", notes: { quoteId: q.id } } }, payment: { entity: { id: "pay_Q1", amount: q.totals.total, currency: "INR", status: "captured" } } } });
    const sig = crypto.createHmac("sha256", "whsec_b2b").update(body).digest("hex");
    const r = await fetch(t.base + "/api/webhooks/razorpay", { method: "POST", headers: { "content-type": "application/json", "x-razorpay-signature": sig }, body });
    assert.equal(r.status, 200);
    const fresh = (await owner.get(`/api/admin/quotes/${q.id}`)).data;
    assert.ok(fresh.invoiceId && fresh.orderId);
    const inv = (await owner.get(`/api/admin/invoices/${fresh.invoiceId}`)).data;
    assert.equal(inv.status, "paid");
    assert.ok((await owner.get("/api/admin/ledger?account=razorpay")).data.rows.some((e) => e.ref === inv.number));
    const again = await fetch(t.base + "/api/webhooks/razorpay", { method: "POST", headers: { "content-type": "application/json", "x-razorpay-signature": sig }, body });
    assert.equal((await again.json()).duplicate, true);
  });
});
