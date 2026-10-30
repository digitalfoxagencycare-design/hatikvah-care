import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createFileStore } from "../src/store/file.js";
import { createMongoStore } from "../src/store/mongo.js";
import { loadConfig } from "../src/config.js";

/** One contract, run against every store. The Mongo run happens when MONGODB_TEST_URI is set (CI starts a Mongo service). */
async function contract(store) {
  const a = await store.products.insert({ slug: "a", sku: "S1", name: "A", n: 2 });
  const b = await store.products.insert({ slug: "b", sku: "S2", name: "B", n: 1 });
  assert.ok(a.id && b.id && a.id !== b.id);
  assert.equal((await store.products.get(a.id)).name, "A");
  assert.equal((await store.products.findBy("sku", "S2")).id, b.id);
  assert.deepEqual((await store.products.all({ sort: { n: 1 } })).map((x) => x.slug), ["b", "a"]);
  assert.equal((await store.products.all({ limit: 1 })).length, 1);
  assert.equal((await store.products.update(a.id, { name: "A2" })).name, "A2");
  assert.equal((await store.products.get(a.id)).slug, "a", "patch merges");
  assert.equal(await store.products.update("missing", { x: 1 }), null);
  assert.equal(await store.products.count(), 2);
  assert.equal(await store.products.remove(a.id), true);
  assert.equal(await store.products.remove(a.id), false);
  await store.products.replaceAll([{ slug: "z", sku: "Z" }]);
  assert.equal(await store.products.count(), 1);
  const seqs = await Promise.all([1, 2, 3, 4, 5].map(() => store.nextSeq("t")));
  assert.deepEqual(seqs.sort(), [1, 2, 3, 4, 5], "sequence numbers are unique under concurrency");
  assert.equal(await store.nextSeq("other"), 1);
  for (const n of ["customers", "quotes", "orders", "invoices", "payments", "stockMoves", "suppliers", "purchases", "outbox", "activities", "priceLists", "ledger", "inbox", "creditNotes"]) assert.equal(typeof store[n].insert, "function", n);
  const msg = await store.outbox.insert({ channel: "whatsapp", waMessageId: "wamid.X1", status: "sent" });
  assert.equal((await store.outbox.findBy("waMessageId", "wamid.X1")).id, msg.id, "outbox found by WhatsApp message id (status callbacks)");
  const le = await store.ledger.insert({ account: "bank", amount: 500, paymentId: "p1", date: "2026-10-01" });
  assert.equal((await store.ledger.findBy("paymentId", "p1")).id, le.id);
  const nested = await store.products.insert({ slug: "n", packaging: { innerPack: { name: "box", qty: 50 }, masterCarton: { name: "carton", qty: 10 } }, measure: { domain: "volume", unit: "ml", value: 30 } });
  assert.deepEqual((await store.products.get(nested.id)).packaging.masterCarton, { name: "carton", qty: 10 }, "nested packaging survives");
  await store.products.remove(nested.id);
  const id = await store.saveMedia(Buffer.from([1, 2, 3, 4]), "image/png");
  const m = await store.getMedia(id);
  assert.deepEqual([...m.data], [1, 2, 3, 4]); assert.equal(m.contentType, "image/png");
  assert.equal(await store.getMedia("../etc/passwd"), null);
  await store.deleteMedia(id);
  assert.equal(await store.getMedia(id), null);
}

describe("stores", () => {
  it("file store follows the contract", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hc-store-"));
    const s = await createFileStore(dir); await contract(s); await s.close();
    const again = await createFileStore(dir); assert.equal(await again.products.count(), 1, "data survives a restart");
    assert.equal(await again.nextSeq("t"), 6, "counters survive a restart");
    await fs.rm(dir, { recursive: true, force: true });
  });
  it("mongo store follows the contract", { skip: !process.env.MONGODB_TEST_URI }, async () => {
    const s = await createMongoStore(process.env.MONGODB_TEST_URI, "hc_test_" + Date.now());
    await contract(s); await s.close();
  });
});

describe("config safety", () => {
  it("production refuses weak secrets and the file store", () => {
    assert.throws(() => loadConfig({ NODE_ENV: "production", JWT_SECRET: "short", MONGODB_URI: "mongodb://x" }), /JWT_SECRET/);
    assert.throws(() => loadConfig({ NODE_ENV: "production", JWT_SECRET: "x".repeat(40) }), /MONGODB_URI/);
    assert.throws(() => loadConfig({ NODE_ENV: "production", JWT_SECRET: "change-me-".repeat(5), MONGODB_URI: "mongodb://x" }), /placeholder/);
    assert.ok(loadConfig({ NODE_ENV: "production", JWT_SECRET: "q".repeat(48), MONGODB_URI: "mongodb://x" }).prod);
  });
});
