import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';
import { createMongoStore } from '../src/store/mongo.js';
import { bookEnquiry, createInvoice, createCreditNote } from '../src/lib/sales.js';
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

test('two independent Mongo clients book the last stock once and rollback a failed booking', { skip: !process.env.MONGODB_TEST_URI, timeout: 60000 }, async()=>{
  const uri=process.env.MONGODB_TEST_URI, name='hc_test_tx_'+crypto.randomUUID().replaceAll('-','');
  const a=await createMongoStore(uri,name),b=await createMongoStore(uri,name);
  try{
    const product=await a.products.insert({slug:'kit',sku:'KIT',name:'Kit',price:10000,gstRate:18,stockTracked:true});
    await a.stockMoves.insert({productId:product.id,sku:'KIT',qty:10,kind:'in',at:new Date().toISOString()});
    const enquiry=(phone)=>a.enquiries.insert({ref:'HC-'+phone,name:'Ravi',phone,email:'',items:[],status:'new',customerId:''});
    const booking={items:[{productId:product.id,name:'Kit',qty:8,rate:10000,gstRate:18}],deliveryAddress:'Road 3, Hyderabad',pincode:'',placeOfSupply:''};
    const [x,y]=[await enquiry('9000000001'),await enquiry('9000000002')];
    const outcomes=await Promise.allSettled([bookEnquiry(a,x.id,booking,'a'),bookEnquiry(b,y.id,booking,'b')]);
    assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(await a.orders.count(),1);assert.equal(await a.customers.count(),1);
    const z=await enquiry('9000000003'),original=b.enquiries.update;
    b.enquiries.update=async()=>{throw Error('injected');};
    await assert.rejects(bookEnquiry(b,z.id,{...booking,items:[{...booking.items[0],qty:1}]},'test'),/injected/);b.enquiries.update=original;
    assert.equal(await a.orders.count(),1);assert.equal(await a.customers.count(),1);
  }finally{
    await a.close();await b.close();
    assert.match(name,/^hc_test_tx_[a-f0-9]+$/);
    const cleanup=new MongoClient(uri);await cleanup.connect();try{await cleanup.db(name).dropDatabase();}finally{await cleanup.close();}
  }
});
