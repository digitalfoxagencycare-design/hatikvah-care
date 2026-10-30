import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { hashPassword } from "../src/auth.js";
import { boot, login, PW } from "./helpers.js";

let t, owner, product, seq = 0;
const line = (qty = 2, rate = 1000) => ({ productId: product.id, sku: product.sku, name: product.name, qty, rate, gstRate: 18 });
const body = (over = {}) => ({ items: [line()], deliveryAddress: "Road 3, Banjara Hills, Hyderabad", pincode: "500034", ...over });
const enquiry = (over = {}) => t.store.enquiries.insert({ ref: `HC-T${++seq}`, name: "Ravi", company: "Hotel Sai", phone: `+91 90000 0${String(seq).padStart(4, "0")}`, email: "", message: "", items: [{ productId: product.id, sku: product.sku, name: product.name, qty: 2 }],
  source: {}, status: "new", notes: "", assignedTo: "", customerId: "", followUpAt: "", createdAt: new Date().toISOString(), ...over });
const book = (e, b = body()) => owner.post(`/api/admin/enquiries/${e.id}/book`, b);
const counts = async () => ({ customers: (await t.store.customers.all()).length, orders: (await t.store.orders.all()).length });

before(async () => {
  t = await boot();
  owner = await login(t.base);
  const all = (await owner.get("/api/admin/products")).data;
  product = (await owner.patch(`/api/admin/products/${all[0].id}`, { price: 1000, gstRate: 18, stockTracked: true })).data;
  await owner.post("/api/admin/stock/adjust", { productId: product.id, kind: "in", qty: 100, note: "opening" });
});
after(async () => { await t.close(); });

describe("direct booking from an enquiry", () => {
  beforeEach(async () => { for (const o of await t.store.orders.all()) if (["confirmed", "packed"].includes(o.status)) await t.store.orders.update(o.id, { status: "cancelled" }); });

  it("creates the customer and a confirmed order that holds stock, and closes the enquiry as won", async () => {
    const e = await enquiry();
    const r = await book(e);
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const { order, enquiry: upd } = r.data;
    assert.equal(order.status, "confirmed");
    assert.equal(order.enquiryId, e.id); assert.equal(order.enquiryRef, e.ref);
    assert.equal(order.customer.name, "Hotel Sai");
    assert.equal(order.customer.shippingAddress, "Road 3, Banjara Hills, Hyderabad - 500034", "the PIN stays readable for the courier booking");
    assert.deepEqual([upd.status, upd.orderId, upd.orderNumber, upd.customerId], ["won", order.id, order.number, order.customerId]);
    const row = (await owner.get("/api/admin/stock")).data.find((p) => p.id === product.id);
    assert.deepEqual([row.physical, row.reserved, row.available], [100, 2, 98]);
    const c = await t.store.customers.get(order.customerId);
    assert.equal(c.shippingAddress, order.customer.shippingAddress);
  });

  it("reuses a customer with the same phone", async () => {
    const c = (await owner.post("/api/admin/customers", { name: "Existing Hotel", phone: "+91 91111 22222", stateCode: "27" })).data;
    const r = await book(await enquiry({ phone: "9111122222" }));
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.order.customerId, c.id);
    assert.equal(r.data.order.interState, true, "another state gets IGST");
    assert.ok(r.data.order.totals.igst > 0);
  });

  it("uses the new customer's GSTIN state for the tax split", async () => {
    const r = await book(await enquiry(), body({ customer: { name: "Hotel Mumbai", gstin: "27ABCDE1234F1Z5" } }));
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.order.customer.stateCode, "27");
    assert.equal(r.data.order.interState, true);
  });

  it("returns the same order when repeated, in parallel or later", async () => {
    const e = await enquiry(), before = await counts();
    const rs = await Promise.all([book(e), book(e), book(e)]);
    assert.deepEqual(rs.map((r) => r.status).sort(), [200, 200, 201]);
    assert.equal(new Set(rs.map((r) => r.data.order.id)).size, 1);
    assert.equal((await counts()).orders, before.orders + 1);
    const again = await book(e);
    assert.equal(again.status, 200); assert.equal(again.data.duplicate, true);
  });

  it("gives the last stock to one enquiry and leaves the other untouched", async () => {
    const [a, b] = [await enquiry(), await enquiry()], before = await counts();
    const rs = await Promise.all([book(a, body({ items: [line(60)] })), book(b, body({ items: [line(60)] }))]);
    assert.deepEqual(rs.map((r) => r.status).sort(), [201, 409]);
    assert.match(rs.find((r) => r.status === 409).data.message, /insufficient available stock/);
    const after = await counts();
    assert.equal(after.orders, before.orders + 1);
    assert.equal(after.customers, before.customers + 1, "the refused booking leaves no customer behind");
    const loser = await t.store.enquiries.get(rs[0].status === 409 ? a.id : b.id);
    assert.deepEqual([loser.status, loser.orderId, loser.customerId], ["new", undefined, ""]);
  });

  it("rolls everything back when a later step fails", async () => {
    const e = await enquiry(), before = await counts(), real = t.store.enquiries.update;
    t.store.enquiries.update = async () => { throw new Error("disk full"); };
    try { assert.equal((await book(e)).status, 500); } finally { t.store.enquiries.update = real; }
    assert.deepEqual(await counts(), before);
    assert.equal((await t.store.enquiries.get(e.id)).status, "new");
  });

  it("refuses an enquiry with an open quote, so it cannot sell twice", async () => {
    const c = (await owner.post("/api/admin/customers", { name: "Quoted Hotel", phone: "+91 92222 33333" })).data;
    const q = (await owner.post("/api/admin/quotes", { customerId: c.id, items: [line()] })).data;
    const e = await enquiry({ customerId: c.id, quoteId: q.id });
    const r = await book(e);
    assert.equal(r.status, 409); assert.match(r.data.message, new RegExp(q.number.replace(/[/]/g, "\\/")));
    await t.store.quotes.update(q.id, { status: "rejected" });
    assert.equal((await book(e)).status, 201, "a rejected quote no longer blocks the booking");
  });

  it("refuses a closed enquiry, no items, and an unknown enquiry or customer", async () => {
    assert.equal((await book(await enquiry({ status: "closed" }))).status, 409);
    assert.equal((await book(await enquiry(), body({ items: [] }))).status, 400);
    assert.equal((await book({ id: "nope" })).status, 404);
    assert.equal((await book(await enquiry(), body({ customerId: "nope" }))).status, 404);
    assert.equal((await book(await enquiry(), body({ pincode: "12" }))).status, 400);
  });

  it("needs both the enquiries and orders permissions", async () => {
    await t.store.admins.insert({ email: "rep@example.com", name: "Rep", role: "sales_representative", passwordHash: await hashPassword(PW), active: true, tokenVersion: 0, createdAt: "x" });
    await t.store.admins.insert({ email: "wh@example.com", name: "Store", role: "warehouse_manager", passwordHash: await hashPassword(PW), active: true, tokenVersion: 0, createdAt: "x" });
    const e = await enquiry();
    for (const email of ["rep@example.com", "wh@example.com"]) assert.equal((await (await login(t.base, email)).post(`/api/admin/enquiries/${e.id}/book`, body())).status, 403);
  });

  it("queues the customer's booking receipt only when asked", async () => {
    const yes = (await book(await enquiry({ phone: "+91 93333 44444" }))).data.order;
    const receipts = (await t.store.outbox.all()).filter((m) => m.event === "orderBooked");
    const mine = receipts.filter((m) => m.ref === yes.number);
    assert.equal(mine.length, 1); assert.equal(mine[0].channel, "whatsapp");
    assert.match(mine[0].body, new RegExp(yes.number.replace(/[/]/g, "\\/")));
    const no = (await book(await enquiry({ phone: "+91 94444 55555" }), body({ notifyWhatsApp: false }))).data.order;
    assert.equal((await t.store.outbox.all()).filter((m) => m.ref === no.number && m.event === "orderBooked").length, 0);
  });

  it("gives the line editor stock figures with the rates", async () => {
    await book(await enquiry());
    const r = (await owner.get("/api/admin/rates")).data.find((x) => x.productId === product.id);
    assert.deepEqual([r.stockTracked, r.physical, r.reserved, r.available], [true, 100, 2, 98]);
  });
});
