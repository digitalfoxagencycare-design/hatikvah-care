import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { boot, client, login } from "./helpers.js";

let t, owner, boxed, lot, custA, custB, inv, invB;
const stockOf = async (id) => (await owner.get("/api/admin/stock")).data.find((p) => p.id === id);
const batchQty = async (id, n) => (await owner.get(`/api/admin/stock/batches?productId=${id}`)).data.find((b) => b.batchNumber === n)?.qty ?? 0;
const cn = (body) => owner.post("/api/admin/credit-notes", body);

before(async () => {
  t = await boot();
  owner = await login(t.base);
  const all = (await owner.get("/api/admin/products")).data;
  boxed = (await owner.patch(`/api/admin/products/${all[0].id}`, { price: 500, packaging: { innerPack: { name: "box", qty: 10 } }, packPrices: { box: 5000, carton: null } })).data;
  lot = (await owner.patch(`/api/admin/products/${all[1].id}`, { price: 1000, batchTracked: true })).data;
  await owner.post("/api/admin/stock/adjust", { productId: boxed.id, kind: "in", qty: 100 });
  await owner.post("/api/admin/stock/adjust", { productId: lot.id, kind: "in", qty: 10, batch: { batchNumber: "LOT-1", mfgDate: "2026-01-01", expDate: "2027-06-30" } });
  custA = (await owner.post("/api/admin/customers", { name: "Hotel Sai", phone: "+91 98765 43210", stateCode: "36" })).data;
  custB = (await owner.post("/api/admin/customers", { name: "Mumbai Spa", phone: "+91 91234 56780", stateCode: "27" })).data;
  inv = (await owner.post("/api/admin/invoices", { customerId: custA.id, items: [
    { productId: boxed.id, name: boxed.name, qty: 2, rate: 5000, uom: "box", gstRate: 18, hsn: "3401" },
    { productId: lot.id, name: lot.name, qty: 5, rate: 1000, gstRate: 12, hsn: "3808" },
  ] })).data;
  invB = (await owner.post("/api/admin/invoices", { customerId: custB.id, items: [{ productId: boxed.id, name: boxed.name, qty: 1, rate: 5000, uom: "box", gstRate: 18 }] })).data;
});
after(async () => { await t.close(); });

describe("credit notes", () => {
  it("credits a returned box: GST split, number, invoice balance, ledger and stock", async () => {
    const before_ = (await stockOf(boxed.id)).physical;
    assert.equal(before_, 70, "100 in, 2 boxes (20) invoiced, 1 box (10) to the other customer");
    const r = await cn({ invoiceId: inv.id, reason: "return", items: [{ line: 0, qty: 1 }] });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.match(r.data.number, /^CN-\d{2}-0001$/);
    assert.deepEqual([r.data.totals.taxable, r.data.totals.cgst, r.data.totals.sgst, r.data.totals.igst, r.data.totals.total], [5000, 450, 450, 0, 5900]);
    assert.equal(r.data.items[0].hsn, "3401", "HSN and GST come from the invoice line");
    assert.equal(r.data.invoice.balance, inv.totals.total - 5900);
    assert.equal((await stockOf(boxed.id)).physical, before_ + 10, "1 box = 10 pieces back on the floor");
    const book = (await owner.get("/api/admin/ledger")).data;
    assert.ok(book.rows.some((e) => e.account === "credit_notes" && e.ref === r.data.number && e.amount === 5900));
    assert.equal(book.totals.credit_notes, -5900, "sales reversed");
    const full = (await owner.get(`/api/admin/invoices/${inv.id}`)).data;
    assert.deepEqual(full.creditNotesList.map((c) => c.number), [r.data.number]);
    assert.equal(full.status, "partial");
  });

  it("refuses to credit more than was invoiced or at a higher rate", async () => {
    assert.match((await cn({ invoiceId: inv.id, reason: "return", items: [{ line: 0, qty: 2 }] })).data.message, /Only 1 box/);
    assert.equal((await cn({ invoiceId: inv.id, reason: "other", items: [{ line: 0, qty: 1, rate: 9999 }] })).status, 400);
    assert.equal((await cn({ invoiceId: inv.id, reason: "other", items: [{ line: 7, qty: 1 }] })).status, 400);
    assert.equal((await cn({ invoiceId: "nope", reason: "other", items: [{ line: 0, qty: 1 }] })).status, 404);
    assert.equal((await cn({ invoiceId: inv.id, reason: "bogus", items: [{ line: 0, qty: 1 }] })).status, 400, "reason is validated");
  });

  it("puts batch-tracked returns back into their batch", async () => {
    assert.equal(await batchQty(lot.id, "LOT-1"), 5, "5 of 10 went out on the invoice");
    assert.match((await cn({ invoiceId: inv.id, reason: "return", items: [{ line: 1, qty: 2 }] })).data.message, /batch/);
    const r = await cn({ invoiceId: inv.id, reason: "return", items: [{ line: 1, qty: 2, batch: { batchNumber: "LOT-1" } }] });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(await batchQty(lot.id, "LOT-1"), 7);
    assert.equal(r.data.totals.tax, 240, "12% GST on ₹20");
  });

  it("damaged goods and price adjustments do not go back into stock", async () => {
    const s0 = (await stockOf(lot.id)).physical;
    assert.equal((await cn({ invoiceId: inv.id, reason: "damaged", items: [{ line: 1, qty: 1 }] })).status, 201);
    assert.equal((await stockOf(lot.id)).physical, s0);
    const adj = await cn({ invoiceId: inv.id, reason: "pricing_adjustment", items: [{ line: 0, qty: 1, rate: 500 }] });
    assert.equal(adj.status, 201); assert.equal(adj.data.totals.taxable, 500);
    assert.equal((await stockOf(boxed.id)).physical, 80);
  });

  it("uses IGST for an inter-state invoice and fully credits it", async () => {
    const r = await cn({ invoiceId: invB.id, reason: "incorrect_item", items: [{ line: 0, qty: 1 }] });
    assert.deepEqual([r.data.totals.cgst, r.data.totals.sgst, r.data.totals.igst, r.data.totals.total], [0, 0, 900, 5900]);
    assert.equal(r.data.invoice.status, "credited"); assert.equal(r.data.invoice.balance, 0);
    assert.match((await cn({ invoiceId: invB.id, reason: "return", items: [{ line: 0, qty: 1 }] })).data.message, /Only 0/, "goods cannot be returned twice");
    assert.match((await cn({ invoiceId: invB.id, reason: "pricing_adjustment", items: [{ line: 0, qty: 1, rate: 100 }] })).data.message, /more than was invoiced/);
    assert.equal((await owner.post(`/api/admin/invoices/${invB.id}/void`, { reason: "x" })).status, 409, "an invoice with credit notes cannot be voided");
  });

  it("a credit note on a paid invoice shows the refund due", async () => {
    const paid = (await owner.post("/api/admin/invoices", { customerId: custA.id, items: [{ name: "Custom kit", qty: 1, rate: 10000, gstRate: 18 }] })).data;
    await owner.post(`/api/admin/invoices/${paid.id}/payments`, { amount: paid.totals.total, mode: "bank" });
    const r = await cn({ invoiceId: paid.id, reason: "other", items: [{ line: 0, qty: 1, rate: 2000 }] });
    assert.equal(r.data.totals.total, 2400, "₹23.60 rounds to ₹24, like invoices"); assert.equal(r.data.invoice.refundDue, 2400); assert.equal(r.data.invoice.status, "paid");
  });

  it("has a printable document link and shows only the owner's notes in the buyer portal", async () => {
    const list = (await owner.get(`/api/admin/credit-notes?invoiceId=${inv.id}`)).data;
    assert.equal(list.length, 4);
    const d = await client(t.base).get(`/api/public/doc/creditnote/${list[0].token}`);
    assert.equal(d.status, 200); assert.match(d.data.doc.amountInWords, /^Rupees/); assert.ok(!("createdBy" in d.data.doc));
    const signIn = async (phone) => { const c = client(t.base); const r = await c.post("/api/shop/auth/request-code", { phone }); await c.post("/api/shop/auth/verify-code", { phone, code: r.data.devCode }); return c; };
    const a = await signIn("9876543210"), b = await signIn("9123456780");
    const ia = (await a.get("/api/buyer/invoices")).data.find((i) => i.id === inv.id);
    assert.equal(ia.creditNotes.length, 4); assert.match(ia.creditNotes[0].link, /^\/doc\/creditnote\//);
    assert.ok(!(await b.get("/api/buyer/invoices")).data.some((i) => i.id === inv.id));
    assert.ok((await b.get("/api/buyer/invoices")).data.every((i) => i.creditNotes.every((c) => !list.some((x) => x.id === c.id))));
  });
});
