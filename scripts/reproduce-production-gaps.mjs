/** Runs only against isolated temporary data. Non-zero exit means a production invariant still fails. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFileStore } from '../apps/api/src/store/file.js';
import { calcTotals } from '../apps/api/src/lib/gst.js';
import { createCreditNote, stockBuckets } from '../apps/api/src/lib/sales.js';
import { salesRoutes } from '../apps/api/src/routes/sales.js';
import { shopRoutes } from '../apps/api/src/routes/shop.js';
import { assertBalancedJournals } from './assert-journals.mjs';

const automation = { on: { paymentReceived() {}, websiteOrder() {} } };
async function call(router, route, req) {
  const h = router.stack.find(l => l.route?.path === route).route.stack.at(-1).handle;
  let data, status = 200;
  const res = { status(n) { status = n; return this; }, json(v) { data = v; return this; } };
  await h({ params: {}, query: {}, body: {}, admin: { email: 'audit' }, ...req }, res, e => { throw e; });
  return { status, data };
}
async function isolated(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hc-gap-'));
  const store = await createFileStore(dir);
  try { return await fn(store); } finally { await store.close(); await fs.rm(dir, { recursive: true, force: true }); }
}
let failures = 0;
async function check(name, fn) {
  try { await isolated(fn); console.log('PASS', name); }
  catch (e) { failures++; console.log('OPEN', name, '-', e.message.split('\n')[0]); }
}
async function invoice(store) {
  const c = await store.customers.insert({ name: 'Audit buyer', phone: '919876543210', stateCode: '36' });
  const d = calcTotals([{ name: 'Kit', qty: 1, rate: 10000, gstRate: 0 }], false);
  return store.invoices.insert({ number: 'INV', customerId: c.id, customer: c, status: 'unpaid', items: d.lines, totals: d.totals, creditedAmount: 0 });
}
await check('Concurrent credit notes cannot exceed the original invoice', async store => {
  const inv = await invoice(store);
  // Both commands start concurrently; the store transaction must serialize their invariant checks.
  const original = store.creditNotes.all;
  const d = { reason: 'damaged', restock: false, items: [{ line: 0, qty: 1 }] };
  await Promise.allSettled([createCreditNote(store, inv, d, 'a'), createCreditNote(store, inv, d, 'b')]);
  const notes = await original();
  assert.ok(notes.reduce((n, c) => n + c.totals.total, 0) <= inv.totals.total, 'credit notes exceed original invoice');
});
await check('Concurrent payments cannot exceed the balance', async store => {
  const inv = await invoice(store);
  const r = salesRoutes({ cfg: {}, store, audit: async () => {}, automation });
  await Promise.allSettled([1,2].map(() => call(r, '/invoices/:id/payments', { params: { id: inv.id }, body: { amount: 10000, mode: 'cash' } })));
  const paid = (await store.payments.all()).reduce((n,p) => n + p.amount, 0);
  assert.ok(paid <= inv.totals.total, 'accepted payments exceed balance');
});
await check('Checkout reserves the last piece only once', async store => {
  const c = await store.customers.insert({ name: 'Audit buyer', phone: '919876543210', stateCode: '36' });
  const p = await store.products.insert({ name: 'Kit', active: true, price: 10000, stockTracked: true, sku: 'AUDIT', gstRate: 0 });
  await store.stockMoves.insert({ productId: p.id, qty: 1 });
  const r = shopRoutes({ cfg: {}, store, automation, notifier: { channels: { otp: 'off' } } });
  const body = { items: [{ productId: p.id, qty: 1 }], name: 'Audit buyer', address: 'Audit building street', city: 'Hyderabad', pincode: '500084', stateCode: '36', payment: 'later' };
  await Promise.all([1,2].map(() => call(r, '/checkout', { customer: c, body })));
  assert.ok((await stockBuckets(store))[p.id].available >= 0, 'stock oversold');
});
await check('Every posted ledger entry has balanced journal lines', async store => {
  const inv = await invoice(store);
  const r = salesRoutes({ cfg: {}, store, audit: async () => {}, automation });
  await call(r, '/invoices/:id/payments', { params: { id: inv.id }, body: { amount: 10000, mode: 'cash' } });
  assertBalancedJournals(await store.ledger.all());
});
console.log(JSON.stringify({ openInvariants: failures }));
process.exitCode = failures ? 1 : 0;
