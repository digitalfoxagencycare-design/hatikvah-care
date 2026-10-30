import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createFileStore } from '../src/store/file.js';
import { calcTotals, nextNumber } from '../src/lib/gst.js';
import { buildWhatsAppMessage, createNotifier, templateText } from '../src/lib/notify.js';
import { createPaymentLink, verifyWebhook } from '../src/lib/razorpay.js';
import { verifyMetaSignature } from '../src/routes/whatsapp.js';
import { normaliseStatus } from '../src/services/delivery_shadowfax.js';
import { loadConfig } from '../src/config.js';
import { createCreditNote, deductForInvoice } from '../src/lib/sales.js';
import { logisticsWebhook } from '../src/routes/logistics.js';
import { stockRoutes } from '../src/routes/stock.js';
import { opsRoutes } from '../src/routes/ops.js';
import { salesRoutes } from '../src/routes/sales.js';
import { seedDemoData } from '../src/seedDemo.js';
import { crmRoutes } from '../src/routes/crm.js';
import { assertBalancedJournals } from '../../../scripts/assert-journals.mjs';

async function callRoute(router, route, req = {}) {
  const layer = router.stack.find(l => l.route?.path === route && (!req.method || l.route.methods[req.method.toLowerCase()]));
  let data, status = 200;
  const res = { status(n) { status = n; return this; }, json(v) { data = v; return this; }, set() { return this; }, send(v) { data = v; return this; }, end() { return this; } };
  await layer.route.stack.at(-1).handle({ body: {}, params: {}, query: {}, admin: { email: 'test', role: 'owner' }, ...req }, res, e => { throw e; });
  return { status, data };
}

const cfg = { waToken: 'test', waPhoneId: '1368252233043036', waVerifyToken: 'test', waTemplates: {}, waTemplateLang: 'en_US' };
const message = { to: '919876543210', body: 'hello' };
async function withStore(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hc-audit-'));
  const store = await createFileStore(dir);
  try { await fn(store, dir); } finally { await store.close(); await fs.rm(dir, { recursive: true, force: true }); }
}
test('unknown WhatsApp window stays manual', () => {
  assert.match(buildWhatsAppMessage(cfg, message, null).manual, /window/i);
});
test('expired bot payload obeys the window', () => {
  assert.ok(buildWhatsAppMessage(cfg, { ...message, payload: { type: 'text', text: { body: 'menu' } } }, false).manual);
});
test('truncating a template variable never leaves trailing spaces', () => {
  assert.equal(templateText('abc def', 4), 'abc');
});
test('future inbound timestamps do not open a service window', () => withStore(async store => {
  await store.inbox.insert({ from: message.to, at: new Date(Date.now() + 86400_000).toISOString() });
  let sends = 0;
  const n = createNotifier({ cfg, store, fetchImpl: async () => { sends++; return new Response('{}'); } });
  await n.queue({ channel: 'whatsapp', ...message }); await n.flush();
  assert.equal(sends, 0); assert.equal((await store.outbox.all())[0].status, 'logged');
}));
test('overlapping flushes send an outbox message only once in one process', () => withStore(async store => {
  let sends = 0;
  const n = createNotifier({ cfg: { ...cfg, waTemplate: 'hc_update' }, store, fetchImpl: async () => { sends++; await new Promise(r => setTimeout(r, 5)); return new Response('{}'); } });
  await n.queue({ channel: 'whatsapp', ...message }); await Promise.all([n.flush(), n.flush()]);
  assert.equal(sends, 1);
}));
test('OTP never falls back to free-form when its authentication template is missing', async () => {
  let sends = 0;
  const n = createNotifier({ cfg, store: {}, fetchImpl: async () => { sends++; return new Response('{}'); } });
  await assert.rejects(n.sendOtp(message.to, '123456'), /template/i); assert.equal(sends, 0);
});
test('Razorpay link subtracts existing credit notes', async () => {
  let body;
  const link = await createPaymentLink({}, { id: 'i', number: 'INV', customer: { name: 'A' }, totals: { total: 10000 }, amountPaid: 1000, creditedAmount: 3000 }, { fetchImpl: async (_, init) => { body = JSON.parse(init.body); return new Response('{"id":"p","short_url":"https://rzp.io/test"}'); } });
  assert.equal(body.amount, 6000); assert.equal(link.amount, 6000);
});
test('unicode webhook signatures are rejected without throwing', () => {
  assert.equal(verifyWebhook(Buffer.from('{}'), 'é'.repeat(64), 'test'), false);
  assert.equal(verifyMetaSignature(Buffer.from('{}'), 'sha256=' + 'é'.repeat(64), 'test'), false);
});
test('GST calculations reject unsafe totals instead of silently losing paise', () => {
  assert.throws(() => calcTotals([{ qty: 10000000, rate: 10000000000, gstRate: 18 }], false), /safe|range|large/i);
});
test('GST decimal multiplication rounds exact halves without binary drift', () => {
  assert.equal(calcTotals([{ qty: 1.005, rate: 100, gstRate: 0 }], false).lines[0].amount, 101);
});
test('GST document number never exceeds sixteen characters', async () => {
  await assert.rejects(nextNumber({ nextSeq: async () => 100000 }, 'INV', new Date('2026-10-30')), /16|exhaust/i);
});
test('staff session configuration cannot exceed the required twelve hours', () => {
  assert.throws(() => loadConfig({ SESSION_HOURS: '720' }), /SESSION_HOURS/);
});
test('Shadowfax canonical status can be normalised repeatedly', () => {
  assert.equal(normaliseStatus('picked'), 'picked');
  assert.equal(normaliseStatus('pickup_scheduled'), 'created');
});
test('concurrent first inserts do not lose file-store rows', () => withStore(async store => {
  await Promise.all(Array.from({ length: 8 }, (_, n) => store.customers.insert({ name: String(n) })));
  assert.equal(await store.customers.count(), 8);
}));
test('corrupted file-store data is not treated as an empty database', () => withStore(async (store, dir) => {
  await fs.writeFile(path.join(dir, 'invoices.json'), '{broken');
  await assert.rejects(store.invoices.all(), /JSON|Unexpected|property/i);
}));
test('pricing adjustments cannot add physical inventory', () => withStore(async store => {
  const inv = { id: 'i', status: 'unpaid', totals: { total: 10000 }, items: [{ name: 'Kit', qty: 1, rate: 10000 }], customer: { name: 'A' } };
  await assert.rejects(createCreditNote(store, inv, { reason: 'pricing_adjustment', restock: true, items: [{ line: 0, qty: 1, rate: 1000 }] }, 'test'), /restock|stock/i);
}));
test('invoicing an already delivered order never takes stock twice', () => withStore(async store => {
  const p = await store.products.insert({ name: 'Kit', stockTracked: true });
  const o = await store.orders.insert({ status: 'delivered', dispatchedAt: '2026-10-30', items: [] });
  await deductForInvoice(store, { orderId: o.id, number: 'INV', items: [{ productId: p.id, qty: 1 }] }, 'test');
  assert.equal(await store.stockMoves.count(), 0);
}));
test('late courier callbacks cannot regress delivery state', () => withStore(async store => {
  const o = await store.orders.insert({ status: 'delivered', shipment: { awb: 'A', status: 'delivered', history: [{ status: 'delivered' }] } });
  const router = logisticsWebhook({ cfg: { sfxWebhookToken: 'test' }, store, automation: { on: { shipmentUpdate() {} } } });
  await callRoute(router, '/api/webhooks/shadowfax', { body: { awb: 'A', status: 'in_transit' }, get: () => 'test' });
  assert.equal((await store.orders.get(o.id)).shipment.status, 'delivered');
}));
test('unknown courier status does not reset a shipment to created', () => withStore(async store => {
  const o = await store.orders.insert({ status: 'dispatched', shipment: { awb: 'A', status: 'in_transit', history: [] } });
  const router = logisticsWebhook({ cfg: { sfxWebhookToken: 'test' }, store, automation: { on: { shipmentUpdate() {} } } });
  await callRoute(router, '/api/webhooks/shadowfax', { body: { awb: 'A', status: 'something_new' }, get: () => 'test' });
  assert.equal((await store.orders.get(o.id)).shipment.status, 'in_transit');
}));
test('cancelled purchase cannot receive all goods', () => withStore(async store => {
  const po = await store.purchases.insert({ number: 'PO', status: 'cancelled', items: [{ productId: 'p', qty: 5, received: 0 }] });
  const out = await callRoute(stockRoutes({ store, audit: async () => {} }), '/purchases/:id/receive-all', { params: { id: po.id } });
  assert.equal(out.status, 409); assert.equal(await store.stockMoves.count(), 0);
}));
test('invalid later receipt line does not partially increment stock', () => withStore(async store => {
  const p = await store.products.insert({ name: 'Kit' });
  const po = await store.purchases.insert({ number: 'PO', status: 'sent', items: [{ productId: p.id, qty: 5, received: 0 }] });
  const out = await callRoute(stockRoutes({ store, audit: async () => {} }), '/purchases/:id/receive', { params: { id: po.id }, body: { lines: [{ productId: p.id, qty: 2 }, { productId: 'missing', qty: 1 }] } });
  assert.equal(out.status, 400); assert.equal(await store.stockMoves.count(), 0);
}));
test('purchase receipt cannot exceed remaining quantity', () => withStore(async store => {
  const p = await store.products.insert({ name: 'Kit' });
  const po = await store.purchases.insert({ number: 'PO', status: 'sent', items: [{ productId: p.id, qty: 5, received: 3 }] });
  const out = await callRoute(stockRoutes({ store, audit: async () => {} }), '/purchases/:id/receive', { params: { id: po.id }, body: { lines: [{ productId: p.id, qty: 3 }] } });
  assert.equal(out.status, 400); assert.equal(await store.stockMoves.count(), 0);
}));
test('backup excludes pending TOTP secrets and includes accounting collections', () => withStore(async store => {
  await store.admins.insert({ email: 'a', passwordHash: 'hash', totpSecret: 'secret', totpPending: 'pending' });
  const out = await callRoute(opsRoutes({ cfg: {}, store, audit: async () => {} }), '/backup');
  const backup = JSON.parse(out.data);
  assert.equal(backup.admins[0].totpPending, undefined);
  for (const name of ['ledger', 'creditNotes', 'inbox']) assert.ok(Array.isArray(backup[name]), name);
}));
test('a rejected quote cannot be converted directly into an invoice', () => withStore(async store => {
  const c = await store.customers.insert({ name: 'Buyer', stateCode: '36' });
  const q = await store.quotes.insert({ status: 'rejected', customerId: c.id, items: [{ name: 'Kit', qty: 1, rate: 10000 }], totals: { total: 10000 } });
  const out = await callRoute(salesRoutes({ cfg: {}, store, audit: async () => {}, automation: { on: { invoiceCreated() {} } } }), '/quotes/:id/invoice', { params: { id: q.id } });
  assert.equal(out.status, 409); assert.equal(await store.invoices.count(), 0);
}));
test('stale sequential credit-note calls still accumulate the actual invoice credit', () => withStore(async store => {
  const items = [{ name: 'Kit', qty: 2, rate: 10000, gstRate: 0 }];
  const doc = calcTotals(items, false);
  const inv = await store.invoices.insert({ status: 'unpaid', number: 'INV', customer: { name: 'A' }, items: doc.lines, totals: doc.totals, creditedAmount: 0 });
  const d = { reason: 'damaged', restock: false, items: [{ line: 0, qty: 1 }] };
  await createCreditNote(store, inv, d, 'test'); await createCreditNote(store, inv, d, 'test');
  assert.equal((await store.invoices.get(inv.id)).creditedAmount, 20000);
}));
test('demo seeding refuses production before touching the database', async () => {
  const previous = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
  let touched = false;
  try { await assert.rejects(seedDemoData({ customers: { count: async () => { touched = true; return 0; } } }), /production/i); assert.equal(touched, false); }
  finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
});
test('approved OTP template repeats the same code in body and URL button', async () => {
  let payload;
  const n = createNotifier({ cfg: { ...cfg, waOtpTemplate: 'hc_otp' }, store: {}, fetchImpl: async (_, init) => { payload = JSON.parse(init.body); return new Response('{}'); } });
  await n.sendOtp(message.to, '123456');
  const [body, button] = payload.template.components;
  assert.equal(body.parameters[0].text, '123456'); assert.equal(button.parameters[0].text, '123456'); assert.equal(button.sub_type, 'url');
});
test('activity listing respects the users module permissions', () => withStore(async store => {
  await store.activities.insert({ entity: 'invoice', entityId: 'i', text: 'Confidential payment' });
  const r = await callRoute(crmRoutes({ store, audit: async () => {} }), '/activities', { admin: { role: 'warehouse_manager' } });
  assert.deepEqual(r.data, []);
}));
test('activity posting cannot mutate modules outside the users role', () => withStore(async store => {
  const r = await callRoute(crmRoutes({ store, audit: async () => {} }), '/activities', { method: 'POST', admin: { role: 'warehouse_manager' }, body: { entity: 'invoice', entityId: 'i', text: 'Unauthorised note' } });
  assert.equal(r.status, 403); assert.equal(await store.activities.count(), 0);
}));
test('a valid zero customer price does not fall back to catalogue price', () => withStore(async store => {
  const p = await store.products.insert({ name: 'Kit', price: 10000 });
  const pl = await store.priceLists.insert({ prices: { [p.id]: 0 } });
  const c = await store.customers.insert({ name: 'Buyer', priceListId: pl.id });
  const r = await callRoute(salesRoutes({ store }), '/rates', { query: { customerId: c.id } });
  assert.equal(r.data[0].rate, 0);
}));
test('accounting release gate rejects unbalanced, unsafe and later malformed journals', () => {
  const valid = { lines: [{ debit: 100, credit: 0 }, { debit: 0, credit: 100 }] };
  assert.doesNotThrow(() => assertBalancedJournals([valid]));
  assert.throws(() => assertBalancedJournals([{ lines: [{ debit: 100 }, { credit: 99 }] }]), /equal/);
  for (const amount of [0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => assertBalancedJournals([{ lines: [{ debit: amount }, { credit: amount }] }]), /safe-integer/);
  }
  assert.throws(() => assertBalancedJournals([valid, { lines: [] }]), /journal/);
});
