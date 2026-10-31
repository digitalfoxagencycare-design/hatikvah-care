import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, describe, it } from "node:test";
import { normalisePorterStatus, parsePorterWebhook } from "../src/services/delivery_porter.js";
import { boot, login } from "./helpers.js";

const WH = "whsec_hub", SFX_HOOK = "s".repeat(24), PORTER_HOOK = "p".repeat(24);
const calls = { qr: [], qrPayments: {}, closed: [], links: [], courier: [], wa: [] };
let seq = 0;
const json = (b, status = 200) => new Response(JSON.stringify(b), { status });

// Stands in for Razorpay, Shadowfax and Porter.
const fakeFetch = async (url, init = {}) => {
  const u = String(url), body = init.body ? JSON.parse(init.body) : null;
  if (u.includes("/payments/qr_codes") && u.endsWith("/close")) { calls.closed.push(u); return json({ status: "closed" }); }
  if (u.includes("/payments/qr_codes/") && u.endsWith("/payments")) return json({ items: calls.qrPayments[u.split("/").at(-2)] || [] });
  if (u.endsWith("/payments/qr_codes")) { calls.qr.push(body); return json({ id: `qr_${++seq}`, image_url: `https://rzp.io/i/qr${seq}`, close_by: body.close_by, status: "active" }); }
  if (u.includes("/payment_links")) { calls.links.push(body); return json({ id: `plink_${++seq}`, short_url: `https://rzp.io/i/pl${seq}` }); }
  if (u.includes("shadowfax.example")) { calls.courier.push({ u, body }); return json({ data: { id: 11, awb_number: `SFX${++seq}`, tracking_url: "https://track.example/sfx" } }); }
  if (u.includes("porter.example")) { calls.courier.push({ u, body, key: init.headers["x-api-key"] }); return json({ order_id: `CRN${++seq}`, tracking_url: "https://track.example/porter" }); }
  if (u.includes("graph.facebook.com")) { calls.wa.push(body); return json({ messages: [{ id: "wamid.1" }] }); }
  return json({});
};

let t, owner, cashier, product;
const line = (qty = 1, rate = 100000) => ({ productId: product.id, sku: product.sku, name: product.name, qty, rate, gstRate: 18 });
const signedHook = (payload) => {
  const body = JSON.stringify(payload);
  return fetch(t.base + "/api/webhooks/razorpay", { method: "POST", headers: { "content-type": "application/json", "x-razorpay-signature": crypto.createHmac("sha256", WH).update(body).digest("hex") }, body });
};
const qrEvent = (qrId, invoiceId, payId, amount) => ({ event: "qr_code.credited", payload: { qr_code: { entity: { id: qrId, status: "active", notes: { invoiceId } } }, payment: { entity: { id: payId, amount, currency: "INR", status: "captured", vpa: "buyer@upi" } } } });
const payEntity = (id, amount) => ({ id, amount, currency: "INR", status: "captured" });
const courierHook = (path, header, token, body) => fetch(`${t.base}/api/webhooks/${path}`, { method: "POST", headers: { "content-type": "application/json", [header]: token }, body: JSON.stringify(body) });

async function counterInvoice() {
  const r = await cashier.post("/api/admin/pos/invoice", { walkIn: { name: "Walk In", phone: "", gstin: "", stateCode: "36" }, items: [line()], placeOfSupply: "36", payment: null });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.invoice;
}
async function dispatched() {
  const customer = (await owner.post("/api/admin/customers", { name: "Hotel Sai", phone: "+91 90000 11111", stateCode: "36", shippingAddress: "Road 3, Hyderabad - 500034", billingAddress: "Road 3, Hyderabad - 500034" })).data;
  const order = (await owner.post("/api/admin/orders", { customerId: customer.id, items: [line()], notes: "", poNumber: "", expectedDate: "", placeOfSupply: "36" })).data;
  const d = await owner.post(`/api/admin/orders/${order.id}/dispatch`, { transporter: "VRL Logistics", trackingNo: "" });
  assert.equal(d.status, 200, JSON.stringify(d.data));
  return d.data;
}

before(async () => {
  t = await boot({ fetchImpl: fakeFetch, env: {
    RAZORPAY_KEY_ID: "rzp_test", RAZORPAY_KEY_SECRET: "secret", RAZORPAY_WEBHOOK_SECRET: WH,
    SHADOWFAX_API_TOKEN: "sfx_test", SHADOWFAX_BASE_URL: "https://staging.shadowfax.example", SHADOWFAX_WEBHOOK_TOKEN: SFX_HOOK, SHADOWFAX_PICKUP_PINCODE: "500084",
    PORTER_API_KEY: "porter_test", PORTER_BASE_URL: "https://api.porter.example", PORTER_WEBHOOK_TOKEN: PORTER_HOOK, PORTER_PICKUP_LAT: "17.44", PORTER_PICKUP_LNG: "78.38",
  } });
  owner = await login(t.base); cashier = owner;
  const all = (await owner.get("/api/admin/products")).data;
  product = (await owner.patch(`/api/admin/products/${all[0].id}`, { price: 100000, gstRate: 18, stockTracked: true })).data;
  await owner.post("/api/admin/stock/adjust", { productId: product.id, kind: "in", qty: 500, note: "opening" });
});
after(async () => { await t.close(); });

describe("courier pickup", () => {
  it("books Shadowfax with the package details and pickup slot, and stops a second booking", async () => {
    const o = await dispatched();
    const r = await owner.post(`/api/admin/orders/${o.id}/shipment`, { provider: "shadowfax", weightKg: 3.5, packages: 2, pickupDate: "2026-11-02", pickupWindow: "12:00-15:00" });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const s = r.data.shipment;
    assert.deepEqual([s.provider, s.status, s.weightKg, s.packages, s.pickupSlot], ["shadowfax", "created", 3.5, 2, { date: "2026-11-02", window: "12:00-15:00" }]);
    assert.equal(r.data.dispatch.transporter, "Shadowfax");
    const sent = calls.courier.at(-1).body.order_details;
    assert.deepEqual([sent.actual_weight, sent.num_of_packages, sent.pickup_slot], [3500, 2, "2026-11-02 12:00-15:00"]);
    assert.equal((await owner.post(`/api/admin/orders/${o.id}/shipment`, { provider: "porter", dropLat: 17.4, dropLng: 78.4 })).status, 409);
  });

  it("books Porter by map location with its own key", async () => {
    const o = await dispatched();
    const noMap = await owner.post(`/api/admin/orders/${o.id}/shipment`, { provider: "porter" });
    assert.equal(noMap.status, 400);
    const r = await owner.post(`/api/admin/orders/${o.id}/shipment`, { provider: "porter", dropLat: 17.41, dropLng: 78.45, weightKg: 2, packages: 1, pickupDate: "2026-11-02", pickupWindow: "09:00-12:00" });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const call = calls.courier.at(-1);
    assert.equal(call.key, "porter_test"); assert.ok(call.u.endsWith("/v1/orders/create"));
    assert.equal(call.body.request_id, o.challanNumber);
    assert.deepEqual([call.body.pickup_details.address.lat, call.body.drop_details.address.lng, call.body.drop_details.address.pincode], [17.44, 78.45, "500034"]);
    assert.equal(call.body.drop_details.address.contact_details.phone_number, "+919000011111");
    assert.equal(r.data.shipment.provider, "porter"); assert.match(r.data.shipment.awb, /^CRN/);
    assert.equal(r.data.dispatch.transporter, "Porter", "the label names the courier actually booked");
  });

  it("raises nothing without a delivery address, and needs both slot fields together", async () => {
    const customer = (await owner.post("/api/admin/customers", { name: "Hotel Two", phone: "+91 90000 22222", stateCode: "36" })).data;
    const order = (await owner.post("/api/admin/orders", { customerId: customer.id, items: [line()], notes: "", poNumber: "", expectedDate: "", placeOfSupply: "36" })).data;
    assert.equal((await owner.post(`/api/admin/orders/${order.id}/shipment`, { courier: "shadowfax" })).status, 400);
    assert.equal((await owner.get(`/api/admin/orders/${order.id}`)).data.status, "confirmed", "no challan is raised for a booking that cannot go through");
    const o = await dispatched();
    assert.equal((await owner.post(`/api/admin/orders/${o.id}/shipment`, { provider: "shadowfax", pickupDate: "2026-11-02" })).status, 400);
  });

  it("webhooks move Porter through the timeline, rider details included, and reject a bad token", async () => {
    const o = await dispatched();
    const awb = (await owner.post(`/api/admin/orders/${o.id}/shipment`, { provider: "porter", dropLat: 17.41, dropLng: 78.45 })).data.shipment.awb;
    assert.equal((await courierHook("porter", "x-porter-token", "wrong".repeat(5), { order_id: awb, status: "accepted" })).status, 401);
    assert.equal((await courierHook("porter", "x-porter-token", PORTER_HOOK, { order_id: awb, status: "accepted", partner_info: { name: "Imran", mobile: { mobile_number: "9811112222" } } })).status, 200);
    let s = (await owner.get(`/api/admin/orders/${o.id}`)).data.shipment;
    assert.deepEqual([s.status, s.riderName, s.riderPhone], ["assigned", "Imran", "9811112222"]);
    await courierHook("porter", "x-porter-token", PORTER_HOOK, { order_id: awb, status: "live" });
    await courierHook("porter", "x-porter-token", PORTER_HOOK, { order_id: awb, status: "accepted" }); // late: must not go backwards
    assert.equal((await owner.get(`/api/admin/orders/${o.id}`)).data.shipment.status, "picked");
    await courierHook("porter", "x-porter-token", PORTER_HOOK, { order_id: awb, status: "ended" });
    const done = (await owner.get(`/api/admin/orders/${o.id}`)).data;
    assert.deepEqual([done.shipment.status, done.status], ["delivered", "delivered"]);
    assert.deepEqual(done.shipment.history.map((h) => h.status), ["created", "assigned", "picked", "delivered"]);
  });

  it("does not let one courier's webhook touch another courier's shipment", async () => {
    const o = await dispatched();
    const awb = (await owner.post(`/api/admin/orders/${o.id}/shipment`, { provider: "shadowfax" })).data.shipment.awb;
    const r = await (await courierHook("porter", "x-porter-token", PORTER_HOOK, { order_id: awb, status: "ended" })).json();
    assert.equal(r.ignored, "unknown shipment");
    assert.equal((await owner.get(`/api/admin/orders/${o.id}`)).data.shipment.status, "created");
  });

  it("takes the rider's details when they arrive after the assignment, without repeating the step", async () => {
    const o = await dispatched();
    const awb = (await owner.post(`/api/admin/orders/${o.id}/shipment`, { provider: "shadowfax" })).data.shipment.awb;
    await courierHook("shadowfax", "x-shadowfax-token", SFX_HOOK, { awb_number: awb, status: "rider_assigned" });
    await courierHook("shadowfax", "x-shadowfax-token", SFX_HOOK, { awb_number: awb, status: "rider_assigned", rider_name: "Salma", rider_contact: "9822223333" });
    const s = (await owner.get(`/api/admin/orders/${o.id}`)).data.shipment;
    assert.deepEqual([s.riderName, s.riderPhone], ["Salma", "9822223333"]);
    assert.equal(s.history.filter((h) => h.status === "assigned").length, 1);
  });

  it("allows a new pickup after the courier cancels", async () => {
    const o = await dispatched();
    const awb = (await owner.post(`/api/admin/orders/${o.id}/shipment`, { provider: "shadowfax" })).data.shipment.awb;
    await courierHook("shadowfax", "x-shadowfax-token", SFX_HOOK, { awb_number: awb, status: "cancelled" });
    const again = await owner.post(`/api/admin/orders/${o.id}/shipment`, { provider: "shadowfax" });
    assert.equal(again.status, 200, JSON.stringify(again.data));
    assert.notEqual(again.data.shipment.awb, awb);
  });

  it("maps Porter's stages", () => {
    assert.deepEqual(["Accepted", "Live", "Ended", "Cancelled", "Reopened"].map(normalisePorterStatus), ["assigned", "picked", "delivered", "cancelled", "created"]);
    assert.equal(parsePorterWebhook({ data: { order_id: "CRN1", order_status: "live" } }).awb, "CRN1");
  });

  it("serves the shipping label only once the challan exists", async () => {
    const o = await dispatched();
    const r = await fetch(`${t.base}/api/public/doc/label/${o.token}`);
    assert.equal(r.status, 200);
    const b = await r.json();
    assert.equal(b.doc.challanNumber, o.challanNumber); assert.equal(b.doc.token, undefined);
    const customer = (await owner.post("/api/admin/customers", { name: "Hotel Three", phone: "+91 90000 33333", stateCode: "36" })).data;
    const open = (await owner.post("/api/admin/orders", { customerId: customer.id, items: [line()], notes: "", poNumber: "", expectedDate: "", placeOfSupply: "36" })).data;
    assert.equal((await fetch(`${t.base}/api/public/doc/label/${open.token}`)).status, 404);
  });
});

describe("counter UPI QR", () => {
  it("creates a single-use QR for the balance and shows the same one on a repeat", async () => {
    const inv = await counterInvoice();
    const r = await cashier.post(`/api/admin/pos/invoices/${inv.id}/upi-qr`);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.status, "pending"); assert.equal(r.data.qr.amount, inv.totals.total);
    const sent = calls.qr.at(-1);
    assert.deepEqual([sent.type, sent.usage, sent.fixed_amount, sent.payment_amount, sent.notes.invoiceId], ["upi_qr", "single_use", true, inv.totals.total, inv.id]);
    const count = calls.qr.length;
    assert.equal((await cashier.post(`/api/admin/pos/invoices/${inv.id}/upi-qr`)).data.qr.imageUrl, r.data.qr.imageUrl);
    assert.equal(calls.qr.length, count);
  });

  it("settles the invoice from the signed webhook, once", async () => {
    const inv = await counterInvoice();
    await cashier.post(`/api/admin/pos/invoices/${inv.id}/upi-qr`);
    const qrId = (await t.store.invoices.get(inv.id)).upiQr.id;
    const ev = qrEvent(qrId, inv.id, "pay_QR1", inv.totals.total);
    assert.equal((await signedHook(ev)).status, 200);
    assert.equal((await signedHook(ev)).status, 200);
    const v = (await cashier.get(`/api/admin/pos/invoices/${inv.id}/upi-qr`)).data;
    assert.deepEqual([v.status, v.balance], ["paid", 0]);
    const pays = (await t.store.payments.all()).filter((p) => p.invoiceId === inv.id);
    assert.equal(pays.length, 1); assert.deepEqual([pays[0].mode, pays[0].external, pays[0].amount], ["razorpay", "pay_QR1", inv.totals.total]);
    assert.ok((await owner.get("/api/admin/ledger?account=razorpay")).data.rows.some((e) => e.ref === inv.number));
  });

  it("refuses a forged QR webhook", async () => {
    const inv = await counterInvoice();
    const r = await fetch(t.base + "/api/webhooks/razorpay", { method: "POST", headers: { "content-type": "application/json", "x-razorpay-signature": "0".repeat(64) }, body: JSON.stringify(qrEvent("qr_x", inv.id, "pay_F", 1)) });
    assert.equal(r.status, 401);
    assert.equal((await t.store.invoices.get(inv.id)).status, "unpaid");
  });

  it("holds a payment for an unknown QR or a void invoice instead of applying it", async () => {
    const inv = await counterInvoice();
    await cashier.post(`/api/admin/pos/invoices/${inv.id}/upi-qr`);
    assert.equal((await signedHook(qrEvent("qr_other", inv.id, "pay_U1", 5000))).status, 202);
    assert.equal((await t.store.invoices.get(inv.id)).amountPaid, 0);
    const qrId = (await t.store.invoices.get(inv.id)).upiQr.id;
    await owner.post(`/api/admin/invoices/${inv.id}/void`, { reason: "buyer left" });
    assert.equal((await signedHook(qrEvent(qrId, inv.id, "pay_U2", inv.totals.total))).status, 202);
    const rows = (await t.store.ledger.all()).filter((e) => e.kind === "unapplied_receipt").map((e) => e.ref);
    assert.ok(rows.includes("pay_U1") && rows.includes("pay_U2"));
  });

  it("catches a payment whose webhook never came, and does not double count when it comes late", async () => {
    const inv = await counterInvoice();
    await cashier.post(`/api/admin/pos/invoices/${inv.id}/upi-qr`);
    const qrId = (await t.store.invoices.get(inv.id)).upiQr.id;
    assert.equal((await cashier.get(`/api/admin/pos/invoices/${inv.id}/upi-qr?sync=1`)).data.status, "pending");
    calls.qrPayments[qrId] = [payEntity("pay_PULL", inv.totals.total)];
    assert.equal((await cashier.get(`/api/admin/pos/invoices/${inv.id}/upi-qr?sync=1`)).data.status, "paid");
    await signedHook(qrEvent(qrId, inv.id, "pay_PULL", inv.totals.total));
    assert.equal((await t.store.payments.all()).filter((p) => p.invoiceId === inv.id).length, 1);
  });

  it("closing with cash records it, unless the QR was paid a moment earlier", async () => {
    const a = await counterInvoice();
    await cashier.post(`/api/admin/pos/invoices/${a.id}/upi-qr`);
    const cash = await cashier.post(`/api/admin/pos/invoices/${a.id}/upi-qr/close`, { payment: { mode: "cash", reference: "" } });
    assert.equal(cash.data.status, "paid");
    assert.equal((await t.store.payments.all()).find((p) => p.invoiceId === a.id).mode, "cash");
    assert.ok(calls.closed.length >= 1);

    const b = await counterInvoice();
    await cashier.post(`/api/admin/pos/invoices/${b.id}/upi-qr`);
    calls.qrPayments[(await t.store.invoices.get(b.id)).upiQr.id] = [payEntity("pay_RACE", b.totals.total)];
    assert.equal((await cashier.post(`/api/admin/pos/invoices/${b.id}/upi-qr/close`, { payment: { mode: "cash", reference: "" } })).data.status, "paid");
    const pays = (await t.store.payments.all()).filter((p) => p.invoiceId === b.id);
    assert.deepEqual(pays.map((p) => p.mode), ["razorpay"]);
  });

  it("cancelling leaves the invoice unpaid, and an expired QR is replaced", async () => {
    const inv = await counterInvoice();
    await cashier.post(`/api/admin/pos/invoices/${inv.id}/upi-qr`);
    assert.equal((await cashier.post(`/api/admin/pos/invoices/${inv.id}/upi-qr/close`, {})).data.status, "closed");
    assert.equal((await t.store.invoices.get(inv.id)).status, "unpaid");
    const x = await counterInvoice();
    await cashier.post(`/api/admin/pos/invoices/${x.id}/upi-qr`);
    const old = (await t.store.invoices.get(x.id)).upiQr;
    await t.store.invoices.update(x.id, { upiQr: { ...old, closeBy: new Date(Date.now() - 1000).toISOString() } });
    assert.equal((await cashier.get(`/api/admin/pos/invoices/${x.id}/upi-qr`)).data.status, "expired");
    assert.equal((await cashier.post(`/api/admin/pos/invoices/${x.id}/upi-qr`)).data.status, "pending");
    const fresh = await t.store.invoices.get(x.id);
    assert.notEqual(fresh.upiQr.id, old.id); assert.equal(fresh.upiQrHistory[0].id, old.id);
    assert.equal((await signedHook(qrEvent(old.id, x.id, "pay_OLD", x.totals.total))).status, 200); // a customer who scanned the old one still counts
    assert.equal((await t.store.invoices.get(x.id)).status, "paid");
  });

  it("is limited to counter invoices", async () => {
    const customer = (await owner.post("/api/admin/customers", { name: "Hotel Four", phone: "+91 90000 44444", stateCode: "36" })).data;
    const inv = (await owner.post("/api/admin/invoices", { customerId: customer.id, items: [line()], notes: "", date: "", dueDate: "", poNumber: "", placeOfSupply: "36" })).data;
    assert.equal((await cashier.post(`/api/admin/pos/invoices/${inv.id}/upi-qr`)).status, 404);
  });

  it("allows the QR image through the Content-Security-Policy", async () => {
    const csp = (await fetch(t.base + "/api/public/doc/invoice/x")).headers.get("content-security-policy");
    assert.match(csp, /img-src[^;]*https:\/\/rzp\.io/);
  });
});

describe("payment links on invoices and orders", () => {
  const invoiceFor = async () => {
    const customer = (await owner.post("/api/admin/customers", { name: "Hotel Five", phone: "+91 90000 55555", stateCode: "36" })).data;
    return (await owner.post("/api/admin/invoices", { customerId: customer.id, items: [line()], notes: "", date: "", dueDate: "", poNumber: "", placeOfSupply: "36" })).data;
  };

  it("keeps one link per amount, makes a new one when the balance changes, and still recognises the old link", async () => {
    const inv = await invoiceFor();
    await t.store.invoices.update(inv.id, { payLink: null });
    const first = (await owner.post(`/api/admin/invoices/${inv.id}/paylink`)).data;
    assert.equal(first.payLink.amount, inv.totals.total);
    const count = calls.links.length;
    assert.equal((await owner.post(`/api/admin/invoices/${inv.id}/paylink`)).data.payLink.id, first.payLink.id);
    assert.equal(calls.links.length, count);
    await owner.post(`/api/admin/invoices/${inv.id}/payments`, { amount: 10000, mode: "bank", reference: "", notes: "", date: "" });
    const second = (await owner.post(`/api/admin/invoices/${inv.id}/paylink`)).data;
    assert.equal(second.payLink.amount, inv.totals.total - 10000);
    assert.notEqual(second.payLink.id, first.payLink.id);
    assert.equal(second.payLinkHistory.at(-1).id, first.payLink.id);
    assert.notEqual(calls.links.at(-1).reference_id, calls.links.at(-2).reference_id, "Razorpay refuses a repeated reference_id");
  });

  it("generates a link on an uninvoiced order; paying it raises the invoice", async () => {
    const customer = (await owner.post("/api/admin/customers", { name: "Hotel Six", phone: "+91 90000 66666", stateCode: "36" })).data;
    const order = (await owner.post("/api/admin/orders", { customerId: customer.id, items: [line()], notes: "", poNumber: "", expectedDate: "", placeOfSupply: "36" })).data;
    const r = await owner.post(`/api/admin/orders/${order.id}/paylink`);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(calls.links.at(-1).notes.orderId, order.id);
    const hook = await signedHook({ event: "payment_link.paid", payload: { payment_link: { entity: { id: r.data.payLink.id, currency: "INR", status: "paid", notes: { orderId: order.id } } }, payment: { entity: { id: "pay_ORD", amount: order.totals.total, currency: "INR", status: "captured" } } } });
    assert.equal(hook.status, 200);
    const paid = (await owner.get(`/api/admin/orders/${order.id}`)).data;
    assert.equal(paid.paymentStatus, "paid"); assert.ok(paid.invoiceId);
    assert.equal((await t.store.invoices.get(paid.invoiceId)).status, "paid");
    assert.equal((await owner.post(`/api/admin/orders/${order.id}/paylink`)).status, 409);
  });

  it("Send via WhatsApp goes through the outbox and hands back a by-hand link when it cannot send", async () => {
    const inv = await invoiceFor();
    const bare = await invoiceFor();
    await t.store.invoices.update(bare.id, { payLink: null });
    assert.equal((await owner.post(`/api/admin/invoices/${bare.id}/paylink/send`)).status, 409);
    const withLink = (await owner.post(`/api/admin/invoices/${inv.id}/paylink`)).data;
    const r = await owner.post(`/api/admin/invoices/${inv.id}/paylink/send`);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.sent, false); assert.match(r.data.manualLink, /^https:\/\/wa\.me\//);
    const row = (await t.store.outbox.all()).find((m) => m.event === "paymentLink" && m.ref === inv.number);
    assert.ok(row.body.includes(withLink.payLink.url));
  });
});
