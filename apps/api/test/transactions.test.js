import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFileStore } from '../src/store/file.js';
async function fixture(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hc-tx-'));
  const s = await createFileStore(dir);
  try { await fn(s, dir); } finally { await s.close(); await fs.rm(dir, { recursive: true, force: true }); }
}
test('atomic failure rolls back documents, stock, journals and counters', () => fixture(async s => {
  await assert.rejects(s.atomic(async () => {
    await s.invoices.insert({ number: 'INV' }); await s.stockMoves.insert({ qty: -1 });
    await s.ledger.insert({ amount: 100 }); await s.nextSeq('INV'); throw Error('injected failure');
  }), /injected/);
  assert.equal(await s.invoices.count(), 0); assert.equal(await s.stockMoves.count(), 0); assert.equal(await s.ledger.count(), 0);
  assert.equal(await s.nextSeq('INV'), 1);
}));
test('atomic concurrent read modify write does not lose increments', () => fixture(async s => {
  const row = await s.settings.insert({ key: 'counter', n: 0 });
  await Promise.all(Array.from({ length: 12 }, () => s.atomic(async () => {
    const old = await s.settings.get(row.id); await new Promise(r => setImmediate(r));
    await s.settings.update(row.id, { n: old.n + 1 });
  })));
  assert.equal((await s.settings.get(row.id)).n, 12);
}));
test('nested atomic work commits once and effects run only after commit', () => fixture(async (s, dir) => {
  let effects = 0;
  await assert.rejects(s.atomic(async () => {
    await s.atomic(async () => { await s.customers.insert({ name: 'rollback' }); await s.afterCommit(() => effects++); });
    throw Error('rollback');
  }));
  assert.equal(effects, 0);
  await s.atomic(async () => {
    await s.customers.insert({ name: 'committed' });
    await s.afterCommit(async () => { assert.equal(s.inAtomic(), false); effects++; });
  });
  assert.equal(effects, 1);
  const reopened = await createFileStore(dir);
  assert.equal(await reopened.customers.count(), 1); await reopened.close();
}));
