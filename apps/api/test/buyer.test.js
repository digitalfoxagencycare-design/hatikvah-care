import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { boot, client, login } from "./helpers.js";

let t, owner, a, b, priced, porProduct, quoteA, quoteB, links = [];
const fakeFetch = async (url, init) => {
  if (String(url).includes("razorpay.com")) { links.push(JSON.parse(init.body)); return new Response(JSON.stringify({ id: "plink_b" + links.length, short_url: "https://rzp.io/i/buyer" + links.length }), { status: 200 }); }
  return new Response("{}", { status: 200 });
};

async function signIn(phone) {
  const c = client(t.base);
  const r = await c.post("/api/shop/auth/request-code", { phone });
  assert.equal(r.status, 200); assert.match(r.data.devCode, /^\d{6}$/);
  const v = await c.post("/api/shop/auth/verify-code", { phone, code: r.data.devCode });
  assert.equal(v.status, 200);
  c.setCookie = v.headers.getSetCookie().join("; ");
  return c;
}
const line = (p, qty, rate) => ({ productId: p.id, sku: p.sku, name: p.name, qty, rate, gstRate: 18 });

before(async () => {
  t = await boot({ fetchImpl: fakeFetch, env: { RAZORPAY_KEY_ID: "rzp_test", RAZORPAY_KEY_SECRET: "secret", RAZORPAY_WEBHOOK_SECRET: "whsec_buyer" } });
  owner = await login(t.base);
  const all = (await owner.get("/api/admin/products")).data;
  priced = (await owner.patch(`/api/admin/products/${all[0].id}`, { price: 1000, packSize: 10, priceTiers: [{ minQty: 100, price: 900 }] })).data;
  porProduct = (await owner.patch(`/api/admin/products/${all[1].id}`, { price: null })).data;
  const ca = (await owner.post("/api/admin/customers", { name: "Hotel Sai", phone: "+91 98765 43210", stateCode: "36" })).data;
  const cb = (await owner.post("/api/admin/customers", { name: "City Clinic", phone: "+91 91234 56780", stateCode: "36" })).data;
  quoteA = (await owner.post("/api/admin/quotes", { customerId: ca.id, items: [line(priced, 25, 1000), line(porProduct, 2, 500)] })).data;
  quoteB = (await owner.post("/api/admin/quotes", { customerId: cb.id, items: [line(priced, 5, 1000)] })).data;
  await owner.post("/api/admin/quotes", { customerId: ca.id, items: [line(priced, 1, 1000)] }); // a draft: never shown to the buyer
  for (const q of [quoteA, quoteB]) assert.equal((await owner.post(`/api/admin/quotes/${q.id}/send`)).status, 200);
  a = await signIn("9876543210");
  b = await signIn("9123456780");
});
after(async () => { await t.close(); });

describe("buyer portal", () => {
  it("needs a signed-in buyer, and the session lasts 12 hours", async () => {
    assert.equal((await client(t.base).get("/api/buyer/quotes")).status, 401);
    assert.match(a.setCookie, /hc_shop=.*Max-Age=43200.*HttpOnly/i);
    assert.equal((await client(t.base).post("/api/shop/auth/verify-code", { phone: "9876543210", code: "12" })).status, 400, "codes are validated");
  });

  it("lists only the buyer's own sent quotes", async () => {
    const qa = (await a.get("/api/buyer/quotes")).data;
    assert.deepEqual(qa.map((q) => q.number), [quoteA.number], "drafts and other customers' quotes are hidden");
    assert.equal(qa[0].status, "sent"); assert.equal(qa[0].canAccept, true);
    assert.equal(qa[0].items[0].pieces, 25); assert.equal(qa[0].totals.total, quoteA.totals.total);
    assert.ok(!("activities" in qa[0]) && !("createdBy" in qa[0]) && !("token" in qa[0]));
  });

  it("cannot approve someone else's quote, and needs a name", async () => {
    assert.equal((await a.post(`/api/buyer/quotes/${quoteB.id}/accept`, { name: "Ravi" })).status, 404);
    assert.equal((await a.post(`/api/buyer/quotes/${quoteA.id}/accept`, {})).status, 400);
    assert.equal((await a.post(`/api/buyer/quotes/${quoteA.id}/accept`, { name: "Ravi" }, { headers: { "x-requested-with": "" } })).status, 403, "anti-CSRF header");
  });

  it("approve & pay: accepts, raises the sales order and returns a Razorpay link for the quote", async () => {
    const r = await a.post(`/api/buyer/quotes/${quoteA.id}/accept`, { name: "Ravi Kumar", note: "Deliver Monday" });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.match(r.data.orderNumber, /^SO\//); assert.match(r.data.payUrl, /rzp\.io/);
    assert.equal(links.at(-1).notes.quoteId, quoteA.id, "the webhook will raise the invoice from this quote");
    assert.equal(links.at(-1).amount, quoteA.totals.total);
    assert.equal((await a.post(`/api/buyer/quotes/${quoteA.id}/accept`, { name: "Ravi Kumar" })).status, 409);
    const q = (await a.get("/api/buyer/quotes")).data[0];
    assert.equal(q.canAccept, false); assert.equal(q.orderNumber, r.data.orderNumber); assert.equal(q.payUrl, r.data.payUrl);
  });

  it("an out-of-date quote shows as expired and cannot be approved", async () => {
    await t.store.quotes.update(quoteB.id, { validUntil: "2020-01-01" });
    assert.equal((await b.get("/api/buyer/quotes")).data[0].status, "expired");
    assert.equal((await b.post(`/api/buyer/quotes/${quoteB.id}/accept`, { name: "Dr Rao" })).status, 409);
  });

  it("orders show items, tracking and invoices for their owner only", async () => {
    const order = (await a.get("/api/buyer/orders")).data[0];
    assert.ok(order); assert.equal((await b.get("/api/buyer/orders")).data.length, 0);
    await owner.post(`/api/admin/orders/${order.id}/dispatch`, { transporter: "Shadowfax" });
    await t.store.orders.update(order.id, { shipment: { provider: "shadowfax", awb: "SF777", status: "out_for_delivery", trackingUrl: "https://tracker.example/SF777", riderPhone: "9000000000", history: [{ status: "picked", at: "2026-10-30T05:00:00Z" }] } });
    const inv = (await owner.post(`/api/admin/orders/${order.id}/invoice`)).data;
    const o = (await a.get("/api/buyer/orders")).data[0];
    assert.equal(o.status, "dispatched"); assert.match(o.dispatch.challanNumber, /^DC\//);
    assert.deepEqual([o.tracking.courier, o.tracking.awb, o.tracking.status, o.tracking.url], ["Shadowfax", "SF777", "out_for_delivery", "https://tracker.example/SF777"]);
    assert.ok(!("riderPhone" in o.tracking));
    assert.equal(o.invoice.number, inv.number);
    const invs = (await a.get("/api/buyer/invoices")).data;
    assert.equal(invs.length, 1); assert.equal(invs[0].balance, inv.totals.total); assert.match(invs[0].link, /^\/doc\/invoice\//);
    assert.equal(invs[0].totals.cgst + invs[0].totals.sgst, invs[0].totals.tax, "intra-state GST split");
    assert.equal((await b.get("/api/buyer/invoices")).data.length, 0);
  });

  it("reorder returns basket lines at today's prices, rounded to the pack, skipping price-on-request items", async () => {
    const order = (await a.get("/api/buyer/orders")).data[0];
    assert.equal((await b.get(`/api/buyer/orders/${order.id}/reorder`)).status, 404);
    const r = (await a.get(`/api/buyer/orders/${order.id}/reorder`)).data;
    assert.deepEqual(r.items.map((i) => [i.productId, i.qty, i.rate]), [[priced.id, 30, 1000]], "25 pieces → 3 packs of 10 at the current price");
    assert.deepEqual(r.skipped.map((s) => s.name), [porProduct.name]);
    await owner.patch(`/api/admin/products/${priced.id}`, { price: 1100 });
    assert.equal((await a.get(`/api/buyer/orders/${order.id}/reorder`)).data.items[0].rate, 1100, "current catalogue price, not the old one");
  });
});
