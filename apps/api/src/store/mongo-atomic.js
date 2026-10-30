import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { MongoClient, Binary } from 'mongodb';
import { COLLECTIONS, UNIQUE, LEGACY_UNIQUE, conflict, document, page, scalarField } from './contract.js';

/** All business writers serialize on a database fence inside a majority-committed transaction. */
export async function createMongoStore(uri, dbName) {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
  await client.connect();
  const db = client.db(dbName), context = new AsyncLocalStorage(), fence = db.collection('transactionFence');
  try {
    const hello = await db.command({ hello: 1 });
    if (!hello.setName && hello.msg !== 'isdbgrid') throw new Error('MongoDB transactions require a replica set or sharded cluster');
    await fence.updateOne({ _id: 'business' }, { $setOnInsert: { revision: 0 } }, { upsert: true });
    for (const n of COLLECTIONS) {
      for (const field of UNIQUE[n] || []) await db.collection(n).createIndex({ [field]: 1 }, LEGACY_UNIQUE.has(n+':'+field) ? { unique: true } : { unique: true, partialFilterExpression: { [field]: { $type: 'string', $gt: '' } } });
    }
    for (const [n,keys] of [['enquiries',{createdAt:-1}],['audit',{at:-1}],['stockMoves',{productId:1}],['payments',{invoiceId:1}],['creditNotes',{invoiceId:1}],['outbox',{status:1,createdAt:1}],['inbox',{from:1,at:-1}],['activities',{entityId:1,at:-1}]]) await db.collection(n).createIndex(keys);
  } catch (e) { await client.close(); throw e; }
  const out = value => { if (!value) return null; const { _id, id: ignored, ...rest } = value; return { ...rest, id: _id }; };
  const options = () => context.getStore() ? { session: context.getStore().session } : {};
  function runDb(fn) {
    const tx = context.getStore(); if (!tx) return fn();
    const result = tx.dbChain.then(fn); tx.dbChain = result.then(()=>{},()=>{}); return result;
  }
  const store = {
    kind: 'mongo', inAtomic: () => !!context.getStore(),
    async afterCommit(fn) { const tx=context.getStore(); if(tx){tx.effects.push(fn);return;} return fn(); },
    async atomic(fn) {
      if(context.getStore())return fn();
      const session=client.startSession();let effects=[];
      try {
        const result=await session.withTransaction(async()=>{
          const tx={session,effects:[],dbChain:Promise.resolve()};
          return context.run(tx,async()=>{
            await runDb(()=>fence.updateOne({_id:'business'},{$inc:{revision:1}},options()));
            const value=await fn();await tx.dbChain;effects=tx.effects;return value;
          });
        },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'},readPreference:'primary',maxCommitTimeMS:15000});
        for(const effect of effects)await effect();return result;
      } catch(e) { if(e.code===11000)throw conflict('Duplicate business identity'); throw e; }
      finally {await session.endSession();}
    },
    async close(){await client.close();},
  };
  for(const name of COLLECTIONS){
    const c=db.collection(name);
    store[name]={
      all(args){const {sort,skip,limit}=page(args);return runDb(async()=>{let cur=c.find({},options());if(sort)cur=cur.sort({...sort,_id:1});if(skip)cur=cur.skip(skip);if(limit)cur=cur.limit(limit);return(await cur.toArray()).map(out);});},
      get(id){return runDb(async()=>out(await c.findOne({_id:id},options())));},
      findBy(field,value){scalarField(field,value);return runDb(async()=>out(await c.findOne({[field==='id'?'_id':field]:value},options())));},
      insert(doc){return store.atomic(()=>runDb(async()=>{const row=document(doc,doc.id??crypto.randomUUID());const{id,...rest}=row;await c.insertOne({_id:id,...rest},options());return row;}));},
      update(id,patch){return store.atomic(async()=>{if(name==='ledger'&&(await store[name].get(id))?.immutable)throw conflict('Posted journals are immutable');const{id:ignored,_id:drop,...rest}=patch;return runDb(async()=>out(await c.findOneAndUpdate({_id:id},{$set:rest},{...options(),returnDocument:'after'})));});},
      compareAndUpdate(id,expected,patch){for(const[k,v]of Object.entries(expected))scalarField(k,v);return store.atomic(async()=>{if(name==='ledger'&&(await store[name].get(id))?.immutable)throw conflict('Posted journals are immutable');return runDb(async()=>{const{id:ignored,_id:drop,...rest}=patch;return out(await c.findOneAndUpdate({_id:id,...expected},{$set:rest},{...options(),returnDocument:'after'}));});});},
      remove(id){return store.atomic(async()=>{if(name==='ledger'&&(await store[name].get(id))?.immutable)throw conflict('Posted journals cannot be deleted');return runDb(async()=>(await c.deleteOne({_id:id},options())).deletedCount===1);});},
      count(){return runDb(()=>c.countDocuments({},options()));},
      replaceAll(docs){return store.atomic(async()=>{if(name==='ledger'&&(await store[name].all()).some(j=>j.immutable))throw conflict('Posted journals cannot be replaced');return runDb(async()=>{const rows=docs.map(d=>{const{id,...rest}=document(d,d.id??crypto.randomUUID());return{_id:id,...rest};});await c.deleteMany({},options());if(rows.length)await c.insertMany(rows,options());});});},
    };
  }
  const counters=db.collection('counters'),media=db.collection('media');
  store.nextSeq=key=>store.atomic(()=>runDb(async()=>{const row=await counters.findOneAndUpdate({_id:key},{$inc:{seq:1}},{...options(),upsert:true,returnDocument:'after'});if(!Number.isSafeInteger(row.seq))throw new RangeError('Sequence exhausted');return row.seq;}));
  store.exportCounters=()=>runDb(async()=>Object.fromEntries((await counters.find({},options()).toArray()).map(d=>[d._id,d.seq])));
  store.saveMedia=async(buf,contentType)=>{const id=crypto.randomUUID();await media.insertOne({_id:id,contentType,data:new Binary(buf),createdAt:new Date().toISOString()});return id;};
  store.getMedia=async id=>{if(!/^[0-9a-f-]{36}$/.test(id))return null;const d=await media.findOne({_id:id});return d?{data:Buffer.from(d.data.buffer),contentType:d.contentType}:null;};
  store.deleteMedia=async id=>{if(/^[0-9a-f-]{36}$/.test(id))await media.deleteOne({_id:id});};
  return store;
}
