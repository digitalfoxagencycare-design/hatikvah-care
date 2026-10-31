import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { collection, dispatchQueue, whatsappStats } from "../src/routes/hubs.js";
import { posCategory, POS_CATEGORIES } from "../../web/src/admin/posCategories.js";
import { cashChange, stockMeter } from "../../web/src/admin/posMath.js";
import { boot, client, login } from "./helpers.js";

describe("hub numbers", () => {
  it("counts each message once, and read messages as delivered and sent", () => {
    const stats = whatsappStats([{ status: "sent", deliveryStatus: "read" }, { status: "sent", deliveryStatus: "delivered" }, { status: "sent" }, { status: "failed" }, { status: "sent", deliveryStatus: "failed" }, { status: "queued" }, { status: "logged" }]);
    assert.deepEqual(stats, { sent: 3, delivered: 2, read: 1, failed: 2 });
  });
  it("collection counts today and this month, and only links for the amount still owed", () => {
    const pays = [{ amount: 500, date: "2026-10-30" }, { amount: 200, date: "2026-10-02" }, { amount: 900, date: "2026-09-30" }];
    const inv = (amount, paid = 0, status = "unpaid") => ({ status, paid, totals: { total: 1000 }, payments: [], payLink: amount ? { url: "https://rzp.io/x", amount } : null });
    const got = collection(pays, [inv(1000), inv(700), inv(0), inv(1000, 1000, "paid")], "2026-10-30");
    assert.equal(got.today, 500);
    assert.equal(got.month, 700);
    assert.equal(got.activeLinks, 1);
  });
  it("the dispatch queue holds orders without a live pickup", () => {
    const q = dispatchQueue([{ id: 1, status: "confirmed" }, { id: 2, status: "packed" }, { id: 3, status: "dispatched" }, { id: 4, status: "dispatched", shipment: { status: "assigned" } }, { id: 5, status: "dispatched", shipment: { status: "cancelled" } }, { id: 6, status: "delivered" }, { id: 7, status: "cancelled" }]);
    assert.deepEqual(q.map((o) => o.id), [1, 2, 3, 5]);
  });
});

describe("counter helpers", () => {
  it("sorts products into the counter's category chips", () => {
    assert.deepEqual(POS_CATEGORIES.map((c) => c.label), ["All", "Hotel Amenities", "Linen", "Dispensers", "Kits"]);
    const p = (name, collection = "", category = "") => ({ name, collection, category });
    assert.ok(posCategory(p("650 gms Hotel Bath Towels", "Hotel Towels", "hotel-linen"), "linen"));
    assert.ok(posCategory(p("Boutique Royal", "Dispensers", "bath-body"), "dispensers"));
    assert.ok(posCategory(p("BIO Dental Kit", "", "biotique-dry-amenities"), "kits"));
    assert.ok(posCategory(p("BIO Dental Kit", "", "biotique-dry-amenities"), "amenities"));
    assert.equal(posCategory(p("Tea Bags", "", "tray-amenities"), "linen"), false);
    assert.ok(posCategory(p("Tea Bags"), "all"));
  });
  it("works out cash change in paise and flags a short payment", () => {
    assert.deepEqual(cashChange(47_500, 50_000), { change: 2_500, short: 0 });
    assert.deepEqual(cashChange(47_500, 47_500), { change: 0, short: 0 });
    assert.deepEqual(cashChange(47_500, 20_000), { change: 0, short: 27_500 });
    assert.deepEqual(cashChange(47_500, 0), { change: 0, short: 0 }, "nothing typed means exact cash");
  });
  it("fills the stock meter against twice the reorder level", () => {
    assert.equal(stockMeter(10, 10), 50);
    assert.equal(stockMeter(500, 10), 100);
    assert.equal(stockMeter(0, 10), 0);
    assert.equal(stockMeter(-3, 10), 0);
    assert.equal(stockMeter(20, 0), 100, "no reorder level set");
    assert.equal(stockMeter(0, 0), 0);
  });
});

describe("over the API", () => {
  let t, owner, product, customer;
  const line = (p) => ({ productId: p.id, sku: p.sku, name: p.name, hsn: "3401", unit: "pcs", qty: 2, rate: 10_000, discountPct: 0, gstRate: 18, uom: "piece", perUnit: 1 });
  before(async () => {
    t = await boot(); owner = await login(t.base);
    product = (await owner.get("/api/admin/products")).data[0];
    customer = (await owner.post("/api/admin/customers", { name: "Hotel Sitara", phone: "9876500011", stateCode: "36", paymentTermsDays: 15 })).data;
  });
  after(() => t.close());

  it("rates carry the photo, category and stock the counter shows", async () => {
    const r = (await owner.get("/api/admin/rates")).data.find((x) => x.productId === product.id);
    assert.ok(r.image.startsWith("/catalog/"));
    assert.equal(r.category, product.category);
    assert.equal(typeof r.available, "number");
    assert.equal(typeof r.reorderLevel, "number");
  });
  it("the product list carries available stock", async () => {
    assert.equal(typeof (await owner.get("/api/admin/products")).data[0].available, "number");
  });
  it("hubs need a sign-in, and thumbs map products to photos", async () => {
    for (const p of ["thumbs", "hubs/whatsapp", "hubs/payments", "hubs/logistics"]) assert.equal((await client(t.base).get(`/api/admin/${p}`)).status, 401);
    assert.ok((await owner.get("/api/admin/thumbs")).data[product.id].startsWith("/catalog/"));
  });
  it("pay later uses the customer's terms and creates no payment", async () => {
    const r = await owner.post("/api/admin/pos/invoice", { customerId: customer.id, items: [line(product)], credit: true });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.payment, null);
    assert.equal(r.data.invoice.status, "unpaid");
    const days = (Date.parse(r.data.invoice.dueDate) - Date.parse(r.data.invoice.date)) / 86_400_000;
    assert.equal(days, 15);
  });
  it("pay later is refused for walk-ins and customers without terms, and those bills are not created", async () => {
    const before = (await owner.get("/api/admin/invoices")).data.length;
    const none = (await owner.post("/api/admin/customers", { name: "Cash Buyer", phone: "9876500012", stateCode: "36", paymentTermsDays: 0 })).data;
    assert.equal((await owner.post("/api/admin/pos/invoice", { walkIn: { name: "Walk In", phone: "", gstin: "", stateCode: "36" }, items: [line(product)], credit: true })).status, 409);
    assert.equal((await owner.post("/api/admin/pos/invoice", { customerId: none.id, items: [line(product)], credit: true })).status, 409);
    assert.equal((await owner.post("/api/admin/pos/invoice", { customerId: customer.id, items: [line(product)], credit: true, payment: { mode: "cash" } })).status, 409);
    assert.equal((await owner.get("/api/admin/invoices")).data.length, before);
  });
  it("a normal counter bill stays due today", async () => {
    const r = await owner.post("/api/admin/pos/invoice", { customerId: customer.id, items: [line(product)], payment: { mode: "cash" } });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.invoice.dueDate, r.data.invoice.date);
    assert.equal(r.data.invoice.status, "paid");
  });
  it("the payments hub leaves that cash bill out, and still lists what is owed", async () => {
    const h = (await owner.get("/api/admin/hubs/payments")).data;
    assert.equal(h.today, 0);
    assert.equal(h.transactions.length, 0);
    assert.ok(h.open.some((i) => i.customer === "Hotel Sitara"));
  });
  it("the dashboard reports the last seven days of sales", async () => {
    const d = (await owner.get("/api/admin/dashboard")).data;
    assert.equal(d.revenueDays.length, 7);
    assert.ok(d.revenueDays[6].total > 0);
    assert.ok(d.revenueDays[0].day < d.revenueDays[6].day);
  });
  it("saves a typed courier balance, keeps the other courier's, and validates it", async () => {
    assert.equal((await owner.put("/api/admin/hubs/logistics/wallet", { provider: "shadowfax", balance: 120_000, lowAt: 50_000 })).status, 200);
    assert.equal((await owner.put("/api/admin/hubs/logistics/wallet", { provider: "porter", balance: 40_000, lowAt: 50_000 })).status, 200);
    assert.equal((await owner.put("/api/admin/hubs/logistics/wallet", { provider: "dhl", balance: 1, lowAt: 1 })).status, 400);
    assert.equal((await owner.put("/api/admin/hubs/logistics/wallet", { provider: "porter", balance: -1, lowAt: 1 })).status, 400);
    const { wallets } = (await owner.get("/api/admin/hubs/logistics")).data;
    assert.equal(wallets.shadowfax.balance, 120_000);
    assert.equal(wallets.porter.balance, 40_000);
    assert.equal(wallets.porter.updatedBy, "owner@example.com");
  });
  describe("converting when the customer record is missing", () => {
    const quoteFor = async (who) => {
      const c = (await owner.post("/api/admin/customers", { stateCode: "36", paymentTermsDays: 7, ...who })).data;
      const q = (await owner.post("/api/admin/quotes", { customerId: c.id, items: [line(product)] })).data;
      assert.ok(q.id, JSON.stringify(q));
      return { c, q };
    };
    const convert = (q) => owner.post(`/api/admin/quotes/${q.id}/invoice`);
    const customers = async () => (await owner.get("/api/admin/customers")).data;

    it("still converts normally when the customer exists", async () => {
      const { c, q } = await quoteFor({ name: "Normal Hotel", phone: "9876500021" });
      const r = await convert(q);
      assert.equal(r.status, 201, JSON.stringify(r.data));
      assert.equal(r.data.customerId, c.id);
      assert.equal(r.data.dueDate > r.data.date, true, "the customer's own terms apply");
    });
    it("brings the customer back from the quote and creates the invoice", async () => {
      const { c, q } = await quoteFor({ name: "Gone Hotel", phone: "9876500022", billingAddress: "1 Lake Road, Hyderabad" });
      await t.store.customers.remove(c.id);
      const r = await convert(q);
      assert.equal(r.status, 201, JSON.stringify(r.data));
      const back = (await customers()).filter((x) => x.name === "Gone Hotel");
      assert.equal(back.length, 1);
      assert.equal(back[0].phone, "9876500022");
      assert.equal(back[0].billingAddress, "1 Lake Road, Hyderabad");
      assert.equal(r.data.customerId, back[0].id);
      assert.equal((await owner.get(`/api/admin/quotes/${q.id}`)).data.customerId, back[0].id);
      assert.equal(r.data.customer.name, "Gone Hotel");
    });
    it("matches a surviving customer by phone instead of adding a duplicate", async () => {
      const { c, q } = await quoteFor({ name: "Phone Hotel", phone: "+91 98765 00023" });
      await t.store.customers.remove(c.id);
      const twin = (await owner.post("/api/admin/customers", { name: "Phone Hotel (renamed)", phone: "9876500023", stateCode: "36" })).data;
      const r = await convert(q);
      assert.equal(r.status, 201, JSON.stringify(r.data));
      assert.equal(r.data.customerId, twin.id);
      assert.equal((await customers()).filter((x) => x.name.startsWith("Phone Hotel")).length, 1);
    });
    it("matches a surviving customer by GSTIN", async () => {
      const { c, q } = await quoteFor({ name: "Tax Hotel", phone: "9876500024", gstin: "36AAAAA0000A1Z5" });
      await t.store.customers.remove(c.id);
      const twin = (await owner.post("/api/admin/customers", { name: "Tax Hotel Pvt Ltd", phone: "9876500025", gstin: "36AAAAA0000A1Z5", stateCode: "36" })).data;
      const r = await convert(q);
      assert.equal(r.status, 201, JSON.stringify(r.data));
      assert.equal(r.data.customerId, twin.id);
    });
    it("carries the customer through a quote that already has a sales order", async () => {
      const { c, q } = await quoteFor({ name: "Order Hotel", phone: "9876500026" });
      const o = (await owner.post(`/api/admin/quotes/${q.id}/order`)).data;
      await t.store.customers.remove(c.id);
      const r = await convert(q);
      assert.equal(r.status, 201, JSON.stringify(r.data));
      const back = (await customers()).find((x) => x.name === "Order Hotel");
      assert.equal(r.data.customerId, back.id);
      assert.equal((await owner.get(`/api/admin/orders/${o.id}`)).data.customerId, back.id);
    });
    it("does the same for an order invoiced directly", async () => {
      const { c, q } = await quoteFor({ name: "Direct Hotel", phone: "9876500027" });
      const o = (await owner.post(`/api/admin/quotes/${q.id}/order`)).data;
      await t.store.customers.remove(c.id);
      const r = await owner.post(`/api/admin/orders/${o.id}/invoice`);
      assert.equal(r.status, 201, JSON.stringify(r.data));
      assert.equal(r.data.customerId, (await customers()).find((x) => x.name === "Direct Hotel").id);
    });
    it("explains itself when the quote holds no customer details at all", async () => {
      const { c, q } = await quoteFor({ name: "Blank Hotel", phone: "9876500028" });
      await t.store.customers.remove(c.id);
      await t.store.quotes.update(q.id, { customer: null });
      const r = await convert(q);
      assert.equal(r.status, 409);
      assert.match(r.data.message, /choose a customer/i);
    });
  });
  it("the company settings are untouched by the courier balance", async () => {
    assert.ok((await owner.get("/api/admin/settings")).data.name);
  });
});
