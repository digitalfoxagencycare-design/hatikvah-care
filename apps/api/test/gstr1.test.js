import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { boot, login } from "./helpers.js";

let t, owner, product, b2bCustomer, b2cCustomer, b2bInvoice, b2cInvoice, draftInvoice;

before(async () => {
  t = await boot();
  owner = await login(t.base);

  const all = (await owner.get("/api/admin/products")).data;
  product = (await owner.patch(`/api/admin/products/${all[0].id}`, { price: 10000, hsn: "3307", unit: "pcs" })).data;

  // Registered Customer (B2B)
  b2bCustomer = (await owner.post("/api/admin/customers", {
    name: "Athome Hospitality Pvt Ltd",
    gstin: "36AAFCA4407P1ZG",
    stateCode: "36",
    phone: "+91 99887 71122",
  })).data;

  // Unregistered Retail Customer (B2C)
  b2cCustomer = (await owner.post("/api/admin/customers", {
    name: "Walk-in Guest",
    stateCode: "36",
    phone: "+91 99887 72233",
  })).data;

  // Create B2B Invoice
  b2bInvoice = (await owner.post("/api/admin/invoices", {
    customerId: b2bCustomer.id,
    date: "2024-03-20",
    items: [{ productId: product.id, name: product.name, qty: 5, rate: 10000, gstRate: 18, hsn: "3307", unit: "pcs" }],
  })).data;

  // Create B2C Invoice
  b2cInvoice = (await owner.post("/api/admin/invoices", {
    customerId: b2cCustomer.id,
    date: "2024-03-25",
    items: [{ productId: product.id, name: product.name, qty: 2, rate: 10000, gstRate: 18, hsn: "3307", unit: "pcs" }],
  })).data;

  // Create Draft Invoice (must NOT appear in GSTR-1)
  draftInvoice = (await owner.post("/api/admin/invoices/draft", {
    customerId: b2bCustomer.id,
    date: "2024-03-28",
    items: [{ productId: product.id, name: product.name, qty: 10, rate: 10000, gstRate: 18, hsn: "3307", unit: "pcs" }],
  })).data;
});

after(async () => { await t.close(); });

describe("GSTR-1 Tax Hub & Government JSON Generation", () => {
  it("provides preview data categorized into B2B, B2CS, HSN, and doc issue", async () => {
    const res = await owner.get("/api/admin/reports/gstr-1/preview?period=032024");
    assert.equal(res.status, 200);
    const data = res.data;

    assert.equal(data.b2b.length, 1);
    assert.equal(data.b2b[0].gstin, "36AAFCA4407P1ZG");
    assert.equal(data.b2b[0].invoiceNumber, b2bInvoice.number);
    assert.equal(data.b2b[0].date, "20-03-2024");
    assert.equal(data.b2b[0].value, b2bInvoice.totals.total / 100);

    assert.equal(data.b2cs.length, 1);
    assert.equal(data.b2cs[0].supplyType, "INTRA");
    assert.equal(data.b2cs[0].rate, 18);

    assert.ok(data.hsn.length >= 1);
    const hsnItem = data.hsn.find((h) => h.hsn_sc === "3307");
    assert.ok(hsnItem);
    assert.equal(hsnItem.qty, 7, "5 B2B + 2 B2C items = 7 pieces (drafts excluded)");
    assert.equal(hsnItem.uqc, "NOS");

    assert.ok(data.docIssue.length >= 1);
    const invDocs = data.docIssue.find((d) => d.doc_num === 1);
    assert.ok(invDocs);
    assert.equal(invDocs.docs[0].totnum, 2, "Only 2 issued invoices in period, draft excluded");
  });

  it("exports official GSTR-1 JSON adhering strictly to GST portal schema", async () => {
    const res = await owner.get("/api/admin/reports/gstr-1.json?period=032024");
    assert.equal(res.status, 200);
    const json = typeof res.data === "string" ? JSON.parse(res.data) : res.data;

    assert.equal(json.fp, "032024");
    assert.ok(json.gstin);
    assert.ok(Array.isArray(json.b2b));
    assert.equal(json.b2b[0].ctin, "36AAFCA4407P1ZG");
    assert.equal(json.b2b[0].inv[0].inum, b2bInvoice.number);
    assert.equal(json.b2b[0].inv[0].idt, "20-03-2024");
    assert.equal(json.b2b[0].inv[0].itms[0].itm_det.rt, 18);

    assert.ok(Array.isArray(json.b2cs));
    assert.ok(json.hsn && Array.isArray(json.hsn.data));
    assert.ok(json.doc_issue && Array.isArray(json.doc_issue.doc_det));
  });

  it("handles financial year query e.g. FY 23-24", async () => {
    const res = await owner.get("/api/admin/reports/gstr-1/preview?fy=23-24");
    assert.equal(res.status, 200);
    assert.equal(res.data.b2b.length, 1);
  });
});
