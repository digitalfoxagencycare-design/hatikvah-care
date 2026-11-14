import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { boot, login } from "./helpers.js";

let t, owner, product, supplier, po;

before(async () => {
  t = await boot();
  owner = await login(t.base);

  // Use existing seeded product
  const all = (await owner.get("/api/admin/products")).data;
  product = (await owner.patch(`/api/admin/products/${all[0].id}`, { stockTracked: true, price: 5000 })).data;

  // Create supplier
  const supRes = await owner.post("/api/admin/suppliers", {
    name: "Cosmetics Supplier India",
    gstin: "36AABCC1234D1Z5",
    phone: "+91 98765 43210",
  });
  supplier = supRes.data;

  // Create purchase order for 100 units
  const poRes = await owner.post("/api/admin/purchases", {
    supplierId: supplier.id,
    items: [
      { productId: product.id, qty: 100, rate: 2000 },
    ],
  });
  assert.equal(poRes.status, 201);
  po = poRes.data;

  // Receive only 50 units
  const recRes = await owner.post(`/api/admin/purchases/${po.id}/receive`, {
    lines: [{ productId: product.id, qty: 50 }],
  });
  assert.equal(recRes.status, 200);
});

after(async () => {
  await t.close();
});

describe("Purchase Returns & Debit Notes Statutory Integrity (Astra C5)", () => {
  it("refuses returning more quantity than received", async () => {
    const res = await owner.post(`/api/admin/purchases/${po.id}/debit-note`, {
      items: [{ productId: product.id, qty: 60 }], // 60 > 50 received!
      reason: "Damaged bottles",
    });

    assert.equal(res.status, 400);
    assert.match(res.data.message, /returnable/i);
  });

  it("successfully creates valid debit note, posts balanced ledger journal and tracks returnedQty", async () => {
    const res = await owner.post(`/api/admin/purchases/${po.id}/debit-note`, {
      items: [{ productId: product.id, qty: 10, rate: 999999 }], // rate 999999 must be ignored; server rate 2000 used!
      reason: "Leaking caps",
    });

    assert.equal(res.status, 201);
    const dn = res.data.debitNote;
    assert.ok(dn.dnNumber.startsWith("DN-"));
    // 10 units @ 2000 = 20000 paise taxable + 18% tax (3600) = 23600 paise (₹236.00)
    assert.equal(dn.amount, 23600);

    // Verify purchase items returnedQty tracked
    const updatedPo = res.data.purchase;
    const item = updatedPo.items.find((i) => i.productId === product.id);
    assert.equal(item.returnedQty, 10);

    // Verify double-entry ledger entry was posted
    const ledgerAll = await t.store.ledger.all();
    const dnEntry = ledgerAll.find((l) => l.sourceKey === `debit-note:${dn.dnNumber}`);
    assert.ok(dnEntry, "Ledger entry must exist for debit note");
    assert.equal(dnEntry.amount, 23600);
    // Lines: debit accounts_payable 23600, credit purchase_returns 20000, credit input_gst 3600
    const debits = dnEntry.lines.reduce((a, b) => a + (b.debit || 0), 0);
    const credits = dnEntry.lines.reduce((a, b) => a + (b.credit || 0), 0);
    assert.equal(debits, credits, "Debit note journal lines must balance");
  });

  it("subsequent return is capped by remaining returnable balance (50 - 10 = 40)", async () => {
    // Attempting to return 45 (which exceeds 40 remaining) must fail
    const badRes = await owner.post(`/api/admin/purchases/${po.id}/debit-note`, {
      items: [{ productId: product.id, qty: 45 }],
      reason: "Excess stock return",
    });
    assert.equal(badRes.status, 400);
    assert.match(badRes.data.message, /returnable/i);

    // Returning 20 must succeed
    const goodRes = await owner.post(`/api/admin/purchases/${po.id}/debit-note`, {
      items: [{ productId: product.id, qty: 20 }],
      reason: "Excess stock return",
    });
    assert.equal(goodRes.status, 201);
    const item = goodRes.data.purchase.items.find((i) => i.productId === product.id);
    assert.equal(item.returnedQty, 30); // 10 + 20
  });

  it("enforces idempotency key on repeated debit note submissions", async () => {
    const key = `idem-${Date.now()}`;
    const res1 = await owner.post(`/api/admin/purchases/${po.id}/debit-note`, {
      items: [{ productId: product.id, qty: 5 }],
      reason: "Wrong variant",
      idempotencyKey: key,
    });
    assert.equal(res1.status, 201);

    // Repeated call with same idempotency key returns existing debit note without deducting duplicate stock
    const res2 = await owner.post(`/api/admin/purchases/${po.id}/debit-note`, {
      items: [{ productId: product.id, qty: 5 }],
      reason: "Wrong variant",
      idempotencyKey: key,
    });
    assert.equal(res2.status, 200);
    assert.equal(res2.data.duplicated, true);
    assert.equal(res2.data.debitNote.dnNumber, res1.data.debitNote.dnNumber);
  });
});
