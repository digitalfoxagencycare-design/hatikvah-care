import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseRupees } from '../src/lib/money.js';
import { drainServer } from '../src/lib/lifecycle.js';
import { createFileStore } from '../src/store/file.js';
import { assertAccountingReady } from '../src/lib/accounting-readiness.js';
import { createNotifier } from '../src/lib/notify.js';
import { createInvoice, createCreditNote } from '../src/lib/sales.js';

async function fixture(fn){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hc-final-'));const s=await createFileStore(dir);try{await fn(s);}finally{await s.close();await fs.rm(dir,{recursive:true,force:true});}}
test('rupee input uses exact half-up paise and rejects formulas/hex/scientific notation',()=>{
  assert.equal(parseRupees('1.005'),101);assert.equal(parseRupees('0'),0);assert.equal(parseRupees(''),null);assert.equal(parseRupees('1,23,456.78'),12345678);
  for(const input of ['0x10','1e3','=1+2','1,2,3','-1','Infinity'])assert.ok(Number.isNaN(parseRupees(input)),input);
});
test('shutdown closes storage after requests and jobs have drained',async()=>{
  let drained=false,jobDone=false,closed=false;
  const server={close(cb){setImmediate(()=>{drained=true;cb();});}};
  const job=new Promise(r=>setImmediate(()=>{jobDone=true;r();}));
  await drainServer(server,{async close(){assert.ok(drained&&jobDone);closed=true;}},[job]);assert.ok(closed);
});
test('legacy unbalanced cashbook prevents production accounting clearance',()=>fixture(async s=>{
  await s.ledger.insert({account:'cash',amount:100,kind:'receipt'});await assert.rejects(assertAccountingReady(s),/reconciliation/);
}));
test('posted journal rows cannot be edited or deleted',()=>fixture(async s=>{
  const c=await s.customers.insert({name:'A',stateCode:'36'});await createInvoice(s,{customer:c,items:[{name:'Kit',qty:1,rate:10000,gstRate:0}]});
  const [j]=await s.ledger.all();await assert.rejects(s.ledger.update(j.id,{amount:1}),/immutable/);await assert.rejects(s.ledger.remove(j.id),/deleted/);
}));
test('two notifier instances claim and send an outbox row only once',()=>fixture(async store=>{
  let sends=0;const cfg={waToken:'test',waPhoneId:'123',waTemplate:'hc_update'},fetchImpl=async()=>{sends++;await new Promise(r=>setImmediate(r));return new Response('{}');};
  const a=createNotifier({store,cfg,fetchImpl}),b=createNotifier({store,cfg,fetchImpl});await a.queue({channel:'whatsapp',to:'919876543210',body:'Update'});
  await Promise.all([a.flush(),b.flush()]);assert.equal(sends,1);
}));
test('a return cannot name a batch that was never sold on the invoice',()=>fixture(async s=>{
  const p=await s.products.insert({slug:'tracked',name:'Kit',stockTracked:true,batchTracked:true});
  await s.stockMoves.insert({productId:p.id,qty:5,at:new Date().toISOString(),batch:{batchNumber:'SOLD',expDate:'2099-12-31'}});
  const c=await s.customers.insert({name:'Buyer',stateCode:'36'});
  const i=await createInvoice(s,{customer:c,items:[{name:'Kit',productId:p.id,qty:1,rate:10000,gstRate:0}]});
  await assert.rejects(createCreditNote(s,i,{reason:'return',items:[{line:0,qty:1,batch:{batchNumber:'OTHER'}}]},'test'),/sold batch/);
  await createCreditNote(s,i,{reason:'return',items:[{line:0,qty:1,batch:{batchNumber:'SOLD'}}]},'test');
}));
