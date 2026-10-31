import assert from "node:assert/strict";
import fs from "node:fs";
import { after, before, describe, it } from "node:test";
import { stockBuckets } from "../src/lib/sales.js";
import { channelSplit, paymentVia } from "../src/routes/hubs.js";
import { estimateWeightKg } from "../src/routes/logistics.js";
import { conversationList } from "../src/routes/whatsapp.js";
import { boot, login } from "./helpers.js";

const SFX_HOOK = "s".repeat(24);
const courier = { fail: 0, status: 200, bodies: [] };
let seq = 0;
const json = (b, status = 200) => new Response(JSON.stringify(b), { status });
const fakeFetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes("/serviceability/")) return courier.status === 200 ? json({ serviceable: true }) : json({ message: "Invalid token" }, courier.status);
  if (u.includes("shadowfax.example")) {
    courier.bodies.push(JSON.parse(init.body));
    if (courier.fail > 0) { courier.fail -= 1; return json({ message: "Pincode blocked" }, 400); }
    return json({ data: { id: 11, awb_number: `SFX${++seq}`, tracking_url: "https://track.example/sfx" } });
  }
  return json({});
};

let t, owner, product;
const line = () => ({ productId: product.id, sku: product.sku, name: product.name, qty: 1, rate: 100000, gstRate: 18 });
const onHand = async () => (await stockBuckets(t.store))[product.id].physical;
async function order(phone = "+91 90000 33333") {
  const customer = (await owner.post("/api/admin/customers", { name: "Hotel Crm", phone, stateCode: "36", shippingAddress: "Road 3, Hyderabad - 500034", billingAddress: "Road 3, Hyderabad - 500034" })).data;
  return (await owner.post("/api/admin/orders", { customerId: customer.id, items: [line()], notes: "", poNumber: "", expectedDate: "", placeOfSupply: "36" })).data;
}

before(async () => {
  t = await boot({ fetchImpl: fakeFetch, env: { SHADOWFAX_API_TOKEN: "sfx_test", SHADOWFAX_BASE_URL: "https://staging.shadowfax.example", SHADOWFAX_WEBHOOK_TOKEN: SFX_HOOK, SHADOWFAX_PICKUP_PINCODE: "500034" } });
  owner = await login(t.base);
  const all = (await owner.get("/api/admin/products")).data;
  product = (await owner.patch(`/api/admin/products/${all[0].id}`, { price: 100000, gstRate: 18, stockTracked: true })).data;
  await owner.post("/api/admin/stock/adjust", { productId: product.id, kind: "in", qty: 500, note: "opening" });
});
after(async () => { await t.close(); });

describe("hub calculations", () => {
  it("estimates weight from the product's measure, with a floor", () => {
    const products = { a: { measure: { domain: "volume", unit: "ml", value: 500 } }, b: { measure: { domain: "weight", unit: "kg", value: 2 } }, c: {} };
    assert.equal(estimateWeightKg([{ productId: "a", qty: 4 }, { productId: "b", qty: 1, perUnit: 3 }, { productId: "c", qty: 5 }], products), 9);
    assert.equal(estimateWeightKg([{ productId: "c", qty: 1 }], products), 0.5);
  });
  it("names how a Razorpay payment came in, and never guesses an old one", () => {
    assert.equal(paymentVia({ notes: "Counter UPI QR", method: "upi" }), "UPI QR");
    assert.equal(paymentVia({ method: "card" }), "Card");
    assert.equal(paymentVia({ method: "netbanking" }), "NetBanking");
    assert.equal(paymentVia({}), "Razorpay");
  });
  it("splits this month's collections into QR and link", () => {
    const got = channelSplit([{ date: "2026-10-30", amount: 500, notes: "Counter UPI QR" }, { date: "2026-10-02", amount: 200, method: "card" }, { date: "2026-09-30", amount: 900, method: "upi" }], "2026-10-31");
    assert.deepEqual(got, { qr: { count: 1, amount: 500 }, links: { count: 1, amount: 200 } });
  });
  it("merges both directions by number and leaves out staff alerts", () => {
    const rows = conversationList(
      [{ from: "919000011111", name: "Ravi", text: "Price?", type: "text", at: "2026-10-30T10:00:00Z" }, { from: "919000011111", text: "Hello", type: "text", at: "2026-10-30T09:00:00Z", readAt: "2026-10-30T09:05:00Z" }],
      [{ channel: "whatsapp", to: "919000011111", body: "Quote sent", event: "quoteSend", sentAt: "2026-10-30T11:00:00Z" }, { channel: "whatsapp", to: "919000099999", body: "New enquiry", event: "enquiryAlert", sentAt: "2026-10-30T12:00:00Z" }, { channel: "email", to: "a@b.in", body: "x", event: "quoteSend", sentAt: "2026-10-30T13:00:00Z" }],
      [{ id: "c1", name: "Hotel Ravi", phone: "+91 90000 11111" }]);
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].name, rows[0].customerId, rows[0].unread, rows[0].lastInboundAt, rows[0].preview], ["Hotel Ravi", "c1", 1, "2026-10-30T10:00:00Z", "Quote sent"]);
  });
});

describe("admin palette", () => {
  const css = fs.readFileSync(new URL("../../web/src/admin/admin.css", import.meta.url), "utf8");
  const token = (n) => css.match(new RegExp(`--${n}: (#[0-9A-Fa-f]{6})`))[1];
  const lum = (hex) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  it("keeps every text colour readable on the surfaces it sits on (WCAG AA)", () => {
    for (const text of ["text-primary", "text-secondary", "text-muted", "accent-gold", "accent-green"]) for (const surface of ["bg-surface", "bg-app"]) assert.ok(ratio(token(text), token(surface)) >= 4.5, `${text} on ${surface}`);
    for (const text of ["text-primary", "text-secondary"]) assert.ok(ratio(token(text), token("bg-surface-raised")) >= 4.5, `${text} on raised`);
    for (const fill of ["accent-gold", "accent-green"]) assert.ok(ratio("#FFFFFF", token(fill)) >= 4.5, `white on ${fill}`);
  });
});

describe("Shadowfax from any confirmed order", () => {
  it("raises the challan and books in one call, using the brief's courier field", async () => {
    const o = await order(), stock = await onHand();
    const r = await owner.post(`/api/admin/orders/${o.id}/shipment`, { courier: "shadowfax", weightKg: 2.5, lengthCm: 40, breadthCm: 30, heightCm: 20 });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.status, "dispatched");
    assert.match(r.data.challanNumber, /^DC/);
    assert.match(r.data.shipment.awb, /^SFX/);
    assert.equal(r.data.shipment.trackingUrl, "https://track.example/sfx");
    assert.equal(courier.bodies.at(-1).order_details.volumetric_weight, 4800);
    assert.equal(await onHand(), stock - 1);
  });
  it("uses what staff typed for the delivery, for a buyer with nothing on file", async () => {
    const o = await order("+91 90000 44444");
    await t.store.orders.update(o.id, { customer: { ...o.customer, phone: "", shippingAddress: "", billingAddress: "" } });
    const r = await owner.post(`/api/admin/orders/${o.id}/shipment`, { courier: "shadowfax", dropName: "Asha", dropPhone: "9000055555", dropAddress: "Plot 4, Madhapur", dropPincode: "500081" });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(courier.bodies.at(-1).customer_details.contact, "9000055555");
    assert.equal(r.data.customer.shippingAddress, "Plot 4, Madhapur");
  });
  it("says the challan stands when Shadowfax refuses, and a retry books without a second challan", async () => {
    const o = await order("+91 90000 66666"), stock = await onHand();
    courier.fail = 1;
    const r = await owner.post(`/api/admin/orders/${o.id}/shipment`, { courier: "shadowfax" });
    assert.equal(r.status, 502);
    assert.match(r.data.message, /Challan DC.*Pincode blocked/);
    const held = (await owner.get(`/api/admin/orders/${o.id}`)).data;
    assert.equal(held.status, "dispatched");
    assert.equal(await onHand(), stock - 1);
    const again = await owner.post(`/api/admin/orders/${o.id}/shipment`, { courier: "shadowfax" });
    assert.equal(again.status, 200, JSON.stringify(again.data));
    assert.equal(again.data.challanNumber, held.challanNumber);
    assert.equal(await onHand(), stock - 1);
  });
  it("sends a counter sale out without taking its stock twice", async () => {
    const pos = await owner.post("/api/admin/pos/invoice", { walkIn: { name: "Walk In", phone: "9000077777", gstin: "", stateCode: "36" }, items: [line()], placeOfSupply: "36", payment: null });
    assert.equal(pos.status, 201, JSON.stringify(pos.data));
    const stock = await onHand();
    const o = (await owner.post(`/api/admin/invoices/${pos.data.invoice.id}/delivery-order`, {})).data;
    assert.equal(o.status, "confirmed");
    assert.equal((await owner.post(`/api/admin/invoices/${pos.data.invoice.id}/delivery-order`, {})).data.id, o.id, "one delivery order per invoice");
    const r = await owner.post(`/api/admin/orders/${o.id}/shipment`, { courier: "shadowfax", dropAddress: "Plot 9, Kondapur", dropPincode: "500084" });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(await onHand(), stock);
  });
  it("reports whether Shadowfax accepts the token", async () => {
    assert.equal((await owner.get("/api/admin/logistics/shadowfax/status")).data.verified, true);
    courier.status = 401;
    const bad = (await owner.get("/api/admin/logistics/shadowfax/status")).data;
    courier.status = 200;
    assert.deepEqual([bad.connected, bad.verified, bad.message], [true, false, "Shadowfax refused this token"]);
  });
  it("logs a deduction only when one is reported or entered", async () => {
    const o = (await owner.post(`/api/admin/orders/${(await order("+91 90000 88888")).id}/shipment`, { courier: "shadowfax" })).data;
    const row = async () => (await owner.get("/api/admin/hubs/logistics")).data.charges.find((c) => c.id === o.id);
    assert.equal((await row()).charge, null);
    const hook = await fetch(`${t.base}/api/webhooks/shadowfax`, { method: "POST", headers: { "content-type": "application/json", "x-shadowfax-token": SFX_HOOK }, body: JSON.stringify({ awb_number: o.shipment.awb, status: "assigned", total_charges: 86.5 }) });
    assert.equal(hook.status, 200);
    assert.equal((await row()).charge, 8650);
    assert.equal((await owner.put(`/api/admin/orders/${o.id}/shipment/charge`, { amount: 9000 })).status, 200);
    const hub = (await owner.get("/api/admin/hubs/logistics")).data;
    assert.equal(hub.charges.find((c) => c.id === o.id).charge, 9000);
    assert.ok(hub.pending.some((c) => c.id === o.id));
  });
});

describe("Razorpay hub", () => {
  it("leaves out everything that did not come through Razorpay", async () => {
    const inv = (await owner.post("/api/admin/pos/invoice", { walkIn: { name: "Online Buyer", phone: "9000012345", gstin: "", stateCode: "36" }, items: [line()], placeOfSupply: "36", payment: null })).data.invoice;
    const row = { invoiceId: inv.id, invoiceNumber: inv.number, customerName: "Online Buyer", amount: 5000, date: new Date().toISOString().slice(0, 10), createdAt: new Date().toISOString() };
    await t.store.payments.insert({ ...row, mode: "cash", reference: "" });
    await t.store.payments.insert({ ...row, mode: "razorpay", reference: "pay_card1", method: "card" });
    await t.store.payments.insert({ ...row, mode: "razorpay", reference: "pay_qr1", method: "upi", notes: "Counter UPI QR" });
    const d = (await owner.get("/api/admin/hubs/payments")).data;
    assert.equal(d.transactions.filter((p) => p.invoiceId === inv.id).length, 2);
    assert.deepEqual(d.transactions.find((p) => p.paymentId === "pay_card1") && [d.transactions.find((p) => p.paymentId === "pay_card1").via, d.transactions.find((p) => p.paymentId === "pay_card1").status, d.transactions.find((p) => p.paymentId === "pay_card1").customerPhone], ["Card", "Captured", "9000012345"]);
    assert.equal(d.qr.count, 1);
    assert.equal(d.links.count, 1);
  });
});

describe("WhatsApp conversations", () => {
  it("shows both directions, sends a template outside the window, and refuses someone else's document", async () => {
    const o = await order("+91 90000 12121");
    const quote = (await owner.post("/api/admin/quotes", { customerId: o.customerId, items: [line()], notes: "", placeOfSupply: "36" })).data;
    assert.ok(quote.id, JSON.stringify(quote));
    await t.store.inbox.insert({ from: "919000012121", text: "Any update?", type: "text", at: new Date(Date.now() - 30 * 3600_000).toISOString() });
    const list = (await owner.get("/api/admin/whatsapp/threads")).data;
    assert.equal(list.find((x) => x.key === "9000012121").unread, 1);
    const sent = await owner.post("/api/admin/whatsapp/threads/9000012121/template", { kind: "quote", docId: quote.id });
    assert.equal(sent.status, 201, JSON.stringify(sent.data));
    const thread = (await owner.get("/api/admin/whatsapp/threads/9000012121")).data;
    assert.deepEqual(thread.messages.map((m) => m.dir), ["in", "out"]);
    assert.equal(thread.messages[1].doc.number, quote.number);
    assert.equal(thread.docs.quote[0].id, quote.id);
    const other = await order("+91 90000 13131");
    assert.equal((await owner.post("/api/admin/whatsapp/threads/9000013131/template", { kind: "quote", docId: quote.id })).status, 400);
    assert.equal((await owner.post(`/api/admin/whatsapp/threads/9000013131/template`, { kind: "dispatch", docId: other.id })).status, 409);
    assert.equal((await owner.post("/api/admin/whatsapp/threads/9000012121/read", {})).data.read, 1);
    assert.equal((await owner.get("/api/admin/whatsapp/threads")).data.find((x) => x.key === "9000012121").unread, 0);
  });
});
