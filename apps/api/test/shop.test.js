import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, describe, it } from "node:test";
import { tierPrice } from "../src/lib/sales.js";
import { boot, client, login } from "./helpers.js";

let t, owner, product, links = [];
const wait = (ms = 60) => new Promise((r) => setTimeout(r, ms));
// Stands in for Razorpay: every payment link request succeeds and is remembered.
const fakeFetch = async (url, init) => {
  if (String(url).includes("razorpay.com")) { links.push(JSON.parse(init.body)); return new Response(JSON.stringify({ id: "plink_" + links.length, short_url: "https://rzp.io/i/test" + links.length }), { status: 200 }); }
  return new Response("{}", { status: 200 });
};

before(async () => {
  t = await boot({ env: { RAZORPAY_KEY_ID: "rzp_test", RAZORPAY_KEY_SECRET: "secret", RAZORPAY_WEBHOOK_SECRET: "whsec_shop" }, fetchImpl: fakeFetch });
  owner = await login(t.base);
  const all = (await owner.get("/api/admin/products")).data;
  product = (await owner.patch(`/api/admin/products/${all[0].id}`, {
    price: 750, priceUnit: "per Nos", unit: "Nos", gstRate: 18, packSize: 288, priceTiers: [{ minQty: 576, price: 735 }], brand: "Farm Fresh", manufacturer: "Bio Veda Pharmacy",
    shortDescription: "An invigorating 20 ml conditioner.", variants: ["20ml", "30ml"], variantLabel: "Size/Volume", dispatchInfo: "Dispatched within 24-48 hours", returnable: false,
    specs: [{ label: "Volume", value: "20 ml" }],
  })).data;
});
after(async () => { await t.close(); });

const cart = (extra = {}) => ({ items: [{ productId: product.id, qty: 576, variant: "20ml" }], name: "Ravi Kumar", company: "Hotel Sai", email: "ravi@hotel.example", gstin: "",
  address: "Plot 12, Road 3, Banjara Hills", city: "Hyderabad", pincode: "500034", stateCode: "36", notes: "", payment: "later", ...extra });

async function signIn(phone = "9876543210") {
  const c = client(t.base);
  const r = await c.post("/api/shop/otp/request", { phone });
  assert.equal(r.status, 200); assert.match(r.data.devCode, /^\d{6}$/);
  assert.equal((await c.post("/api/shop/otp/verify", { phone, code: r.data.devCode === "000000" ? "111111" : "000000" })).status, 400);
  const ok = await c.post("/api/shop/otp/verify", { phone, code: r.data.devCode });
  assert.equal(ok.status, 200);
  return c;
}

describe("online shop", () => {
  it("shows the shop details of a product, and bulk tiers only with a price", async () => {
    const p = (await client(t.base).get(`/api/public/products/${product.slug}`)).data;
    assert.equal(p.brand, "Farm Fresh"); assert.equal(p.packSize, 288); assert.equal(p.returnable, false); assert.deepEqual(p.priceTiers, [{ minQty: 576, price: 735 }]);
    assert.equal(p.stock, null);
    const other = (await client(t.base).get("/api/public/catalog")).data.products.find((x) => x.id !== product.id);
    assert.deepEqual(other.priceTiers, []); assert.equal(other.pricePaise, null);
    const s = (await client(t.base).get("/api/public/settings")).data;
    assert.deepEqual(s.shop, { cart: true, online: true, payLater: true, otp: true });
    assert.equal(tierPrice({ price: 750, priceTiers: [{ minQty: 576, price: 735 }] }, 575), 750);
    assert.equal(tierPrice({ price: 750, priceTiers: [{ minQty: 576, price: 735 }] }, 576), 735);
  });

  it("rejects tiers that do not go up in quantity", async () => {
    const r = await owner.patch(`/api/admin/products/${product.id}`, { priceTiers: [{ minQty: 500, price: 700 }, { minQty: 400, price: 690 }] });
    assert.equal(r.status, 400);
  });

  it("needs the WhatsApp code before checkout, then prices the order on the server", async () => {
    const guest = client(t.base);
    assert.equal((await guest.post("/api/shop/checkout", cart())).status, 401);
    const c = await signIn();
    assert.equal((await c.post("/api/shop/checkout", cart({ items: [{ productId: product.id, qty: 300, variant: "20ml" }] }))).data.message.includes("packs of 288"), true);
    assert.equal((await c.post("/api/shop/checkout", cart({ items: [{ productId: product.id, qty: 576, variant: "" }] }))).data.message, "Choose Size/Volume for " + product.name);
    const r = await c.post("/api/shop/checkout", cart());
    assert.equal(r.status, 201); assert.equal(r.data.payUrl, "");
    const o = await t.store.orders.get(r.data.order.id);
    assert.equal(o.source, "website"); assert.equal(o.items[0].rate, 735); assert.equal(o.items[0].name, product.name + " (20ml)");
    assert.equal(o.totals.taxable, 576 * 735); assert.equal(o.interState, false);
    assert.equal(o.customer.name, "Hotel Sai"); assert.match(o.customer.shippingAddress, /500034/);
    const mine = (await c.get("/api/shop/orders")).data;
    assert.equal(mine.length, 1); assert.equal(mine[0].number, o.number); assert.equal(mine[0].paymentStatus, "unpaid");
    assert.equal((await c.get("/api/shop/me")).data.company, "Hotel Sai");
    await wait();
    assert.ok((await t.store.outbox.all()).some((m) => m.event === "websiteOrder" && m.ref === o.number));
  });

  it("refuses requests without the anti-CSRF header", async () => {
    const r = await client(t.base).post("/api/shop/otp/request", { phone: "9876500000" }, { headers: { "x-requested-with": "" } });
    assert.equal(r.status, 403);
  });

  it("online payment: Razorpay link for the order, invoice only after the paid webhook", async () => {
    const c = await signIn("9123456780");
    const r = await c.post("/api/shop/checkout", cart({ payment: "online", stateCode: "27" }));
    assert.equal(r.status, 201); assert.match(r.data.payUrl, /^https:\/\/rzp\.io\//);
    const link = links.at(-1);
    assert.equal(link.notes.orderId, r.data.order.id); assert.match(link.callback_url, /\/account\?order=/);
    let o = await t.store.orders.get(r.data.order.id);
    assert.equal(o.invoiceId, ""); assert.equal(o.interState, true); assert.equal(link.amount, o.totals.total);
    const body = JSON.stringify({ event: "payment_link.paid", payload: { payment_link: { entity: { id: o.payLink.id, currency: "INR", status: "paid", notes: { orderId: o.id } } }, payment: { entity: { id: "pay_SHOP1", amount: o.totals.total, currency: "INR", status: "captured" } } } });
    const sig = crypto.createHmac("sha256", "whsec_shop").update(body).digest("hex");
    const post = () => fetch(t.base + "/api/webhooks/razorpay", { method: "POST", headers: { "content-type": "application/json", "x-razorpay-signature": sig }, body });
    assert.equal((await post()).status, 200); assert.equal((await post()).status, 200); // retried webhook: no second payment
    o = await t.store.orders.get(o.id);
    assert.equal(o.paymentStatus, "paid");
    const inv = await t.store.invoices.get(o.invoiceId);
    assert.equal(inv.status, "paid"); assert.equal(inv.totals.total, o.totals.total);
    assert.equal((await t.store.payments.all()).filter((p) => p.external === "pay_SHOP1").length, 1);
    const mine = (await c.get("/api/shop/orders")).data[0];
    assert.equal(mine.invoice.status, "paid"); assert.match(mine.invoice.link, /^\/doc\/invoice\//);
  });

  it("follows the owner's switches", async () => {
    const s = (await owner.get("/api/admin/settings")).data;
    await owner.put("/api/admin/settings", { ...s, otpLogin: false, onlinePayments: false });
    const guest = client(t.base);
    assert.equal((await guest.post("/api/shop/otp/request", { phone: "9000000001" })).status, 403);
    assert.equal((await guest.post("/api/shop/checkout", cart({ payment: "online", phone: "9000000001" }))).data.field, "payment");
    const r = await guest.post("/api/shop/checkout", cart({ phone: "9000000001" }));
    assert.equal(r.status, 201);
    await owner.put("/api/admin/settings", { ...s, shopEnabled: false });
    assert.equal((await client(t.base).get("/api/public/settings")).data.shop.cart, false);
    assert.equal((await guest.post("/api/shop/checkout", cart({ phone: "9000000001" }))).status, 403);
    await owner.put("/api/admin/settings", s);
  });
});
