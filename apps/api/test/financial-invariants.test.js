import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFileStore } from '../src/store/file.js';
import { createInvoice, createCreditNote, recordPayment, postLedger, removePaymentLedger } from '../src/lib/sales.js';
import { assertBalancedJournals } from '../../../scripts/assert-journals.mjs';
async function fixture(fn) { const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hc-fin-'));const s=await createFileStore(dir);try{const c=await s.customers.insert({name:'Buyer',stateCode:'36'});const i=await createInvoice(s,{customer:c,items:[{name:'Kit',qty:1,rate:10000,gstRate:18}],by:'test'});await fn(s,i,c);}finally{await s.close();await fs.rm(dir,{recursive:true,force:true});} }
test('invoice posts balanced revenue and correct output GST heads',()=>fixture(async(s,i)=>{
  const journals=await s.ledger.all();assertBalancedJournals(journals);
  const j=journals.find(j=>j.sourceKey===`invoice:${i.id}`);assert.ok(j);
  assert.equal(j.lines.find(l=>l.account==='output_cgst').credit,900);assert.equal(j.lines.find(l=>l.account==='output_sgst').credit,900);
}));
test('simultaneous credit notes cannot credit the last unit twice',()=>fixture(async(s,i)=>{
  const d={reason:'damaged',restock:false,items:[{line:0,qty:1}]};
  const results=await Promise.allSettled([createCreditNote(s,i,d,'a'),createCreditNote(s,i,d,'b')]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(await s.creditNotes.count(),1);
  assert.equal((await s.invoices.get(i.id)).creditedAmount,i.totals.total);assertBalancedJournals(await s.ledger.all());
}));
test('simultaneous manual payments cannot over-collect the balance',()=>fixture(async(s,i)=>{
  const results=await Promise.allSettled([recordPayment(s,i,{amount:11800,mode:'cash'}),recordPayment(s,i,{amount:11800,mode:'cash'})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(await s.payments.count(),1);
}));
test('duplicate external payment is idempotent and excess remains fully recorded',()=>fixture(async(s,i)=>{
  const p={amount:12000,mode:'razorpay',external:'pay_once'};
  await Promise.all([recordPayment(s,i,p),recordPayment(s,i,p)]);
  assert.equal(await s.payments.count(),1);assert.equal((await s.payments.all())[0].amount,12000);
  assert.equal((await s.invoices.get(i.id)).amountPaid,12000);assertBalancedJournals(await s.ledger.all());
}));
test('unbalanced journals are rejected before persistence',()=>fixture(async(s,i)=>{
  const before=await s.ledger.count();await assert.rejects(postLedger(s,{amount:100,lines:[{account:'cash',debit:100,credit:0},{account:'sales',debit:0,credit:99}]}),/balance|equal/i);assert.equal(await s.ledger.count(),before);
}));
test('payment removal posts one compensating reversal and preserves original history',()=>fixture(async(s,i)=>{
  const {payment}=await recordPayment(s,i,{amount:1000,mode:'cash'});
  await removePaymentLedger(s,payment.id);await removePaymentLedger(s,payment.id);
  assert.ok(await s.payments.get(payment.id));assert.ok((await s.payments.get(payment.id)).reversedAt);
  const rows=await s.ledger.all();assert.equal(rows.filter(j=>j.reversalOf).length,1);assertBalancedJournals(rows);
  assert.equal((await s.invoices.get(i.id)).amountPaid,0);
}));
test('a failure during credit-note posting leaves no partial note or invoice update',()=>fixture(async(s,i)=>{
  const insert=s.ledger.insert;s.ledger.insert=async()=>{throw Error('injected journal failure');};
  await assert.rejects(createCreditNote(s,i,{reason:'damaged',restock:false,items:[{line:0,qty:1}]},'test'),/injected/);
  s.ledger.insert=insert;assert.equal(await s.creditNotes.count(),0);assert.equal((await s.invoices.get(i.id)).creditedAmount||0,0);
}));
