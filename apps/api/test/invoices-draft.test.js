import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { boot, client, login } from "./helpers.js";

let t, owner, anon, product, customer;

before(async () => {
  t = await boot();
  owner = await login(t.base);
  anon = client(t.base);

  const all = (await owner.get("/api/admin/products")).data;
  product = (await owner.patch(`/api/admin/products/${all[0].id}`, { price: 2500, stockTracked: true })).data;
  await owner.post("/api/admin/stock/adjust", { productId: product.id, kind: "in", qty: 50 });
  customer = (await owner.post("/api/admin/customers", { name: "Swipe Draft Hotel", phone: "+91 99887 76655", stateCode: "36" })).data;
});

after(async () => { await t.close(); });

describe("Draft Invoices Lifecycle", () => {
  let draftId;
  let draftToken;

  it("saves a draft invoice without deducting stock or posting to ledger", async () => {
    const stockBefore = (await owner.get("/api/admin/stock")).data.find((p) => p.id === product.id);
    const ledgerBefore = (await owner.get("/api/admin/ledger")).data.rows.length;

    const res = await owner.post("/api/admin/invoices/draft", {
      customerId: customer.id,
      items: [
        { productId: product.id, name: product.name, qty: 10, rate: 2500, gstRate: 18, hsn: "3307" },
      ],
      notes: "Hold until purchase confirmation",
    });

    assert.equal(res.status, 201);
    assert.equal(res.data.status, "draft");
    assert.match(res.data.number, /^DRAFT-/);
    assert.equal(res.data.balance, 0, "Draft invoice has 0 balance due before issue");
    draftId = res.data.id;
    draftToken = res.data.token;

    // Verify stock is untouched
    const stockAfter = (await owner.get("/api/admin/stock")).data.find((p) => p.id === product.id);
    assert.equal(stockAfter.physical, stockBefore.physical);

    // Verify ledger has no new entries
    const ledgerAfter = (await owner.get("/api/admin/ledger")).data.rows.length;
    assert.equal(ledgerAfter, ledgerBefore);
  });

  it("refuses public doc viewing/PDF for unissued draft invoices", async () => {
    const pubDoc = await anon.get(`/api/public/doc/invoice/${draftToken}`);
    assert.equal(pubDoc.status, 404);

    const pubPdf = await anon.get(`/doc/invoice/${draftToken}/pdf`);
    assert.equal(pubPdf.status, 404);
  });

  it("updates an existing draft invoice safely", async () => {
    const res = await owner.put(`/api/admin/invoices/draft/${draftId}`, {
      customerId: customer.id,
      items: [
        { productId: product.id, name: product.name, qty: 15, rate: 2500, gstRate: 18, hsn: "3307" },
      ],
      notes: "Updated qty to 15",
    });

    assert.equal(res.status, 200);
    assert.equal(res.data.status, "draft");
    assert.equal(res.data.items[0].qty, 15);
    assert.equal(res.data.notes, "Updated qty to 15");
  });

  it("issues the draft invoice: assigns INV number, deducts stock, and posts to ledger", async () => {
    const stockBefore = (await owner.get("/api/admin/stock")).data.find((p) => p.id === product.id);

    const res = await owner.post(`/api/admin/invoices/${draftId}/issue`, {});
    assert.equal(res.status, 200);
    assert.equal(res.data.status, "unpaid");
    assert.match(res.data.number, /^INV\/\d{4}-\d{2}\/\d{4}$/);
    assert.ok(res.data.balance > 0, "Issued invoice now has balance due");

    // Stock should now be deducted by 15 pieces
    const stockAfter = (await owner.get("/api/admin/stock")).data.find((p) => p.id === product.id);
    assert.equal(stockAfter.physical, stockBefore.physical - 15);

    // Ledger should now contain invoice entry
    const ledger = (await owner.get("/api/admin/ledger")).data;
    const entry = ledger.rows.find((r) => r.ref === res.data.number && r.account === "accounts_receivable");
    assert.ok(entry, "Accounts receivable ledger row posted on issue");

    // Now public doc view is accessible
    const pubDoc = await anon.get(`/api/public/doc/invoice/${draftToken}`);
    assert.equal(pubDoc.status, 200);
  });

  it("refuses to issue an already issued invoice", async () => {
    const res = await owner.post(`/api/admin/invoices/${draftId}/issue`, {});
    assert.equal(res.status, 409);
  });

  it("allows discarding unissued draft invoices, but refuses deleting issued ones", async () => {
    // Attempt deleting issued invoice
    const delIssued = await owner.del(`/api/admin/invoices/${draftId}`);
    assert.equal(delIssued.status, 409);

    // Create a new draft
    const newDraft = (await owner.post("/api/admin/invoices/draft", {
      customerId: customer.id,
      items: [{ productId: product.id, name: product.name, qty: 1, rate: 2500, gstRate: 18 }],
    })).data;

    // Discard draft
    const delDraft = await owner.del(`/api/admin/invoices/${newDraft.id}`);
    assert.equal(delDraft.status, 204);

    // Verify it is gone
    const check = await owner.get(`/api/admin/invoices/${newDraft.id}`);
    assert.equal(check.status, 404);
  });
});
