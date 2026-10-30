import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';
import { createMongoStore } from '../src/store/mongo.js';
import { createInvoice, createCreditNote } from '../src/lib/sales.js';
import { assertBalancedJournals } from '../../../scripts/assert-journals.mjs';

test('two independent Mongo clients serialize credit caps and rollback injected failures', { skip: !process.env.MONGODB_TEST_URI, timeout: 60000 }, async()=>{
  const uri=process.env.MONGODB_TEST_URI, name='hc_test_tx_'+crypto.randomUUID().replaceAll('-','');
  const a=await createMongoStore(uri,name),b=await createMongoStore(uri,name);
  try{
    const customer=await a.customers.insert({name:'Test buyer',stateCode:'36'});
    const invoice=await createInvoice(a,{customer,items:[{name:'Kit',qty:2,rate:10000,gstRate:18}],by:'test'});
    const note={reason:'damaged',restock:false,items:[{line:0,qty:2}]};
    const outcomes=await Promise.allSettled([createCreditNote(a,invoice,note,'a'),createCreditNote(b,invoice,note,'b')]);
    assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(await a.creditNotes.count(),1);assertBalancedJournals(await a.ledger.all());
    const other=await createInvoice(a,{customer,items:[{name:'Other',qty:1,rate:10000,gstRate:0}],by:'test'});
    const original=b.ledger.insert;b.ledger.insert=async()=>{throw Error('injected');};
    await assert.rejects(createCreditNote(b,other,{reason:'damaged',items:[{line:0,qty:1}]},'test'),/injected/);b.ledger.insert=original;
    assert.equal((await a.invoices.get(other.id)).creditedAmount||0,0);assert.equal(await a.creditNotes.count(),1);
  }finally{
    await a.close();await b.close();
    assert.match(name,/^hc_test_tx_[a-f0-9]+$/);
    const cleanup=new MongoClient(uri);await cleanup.connect();try{await cleanup.db(name).dropDatabase();}finally{await cleanup.close();}
  }
});
