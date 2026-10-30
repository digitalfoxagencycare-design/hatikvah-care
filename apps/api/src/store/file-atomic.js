import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { COLLECTIONS, UNIQUE, LEGACY_UNIQUE, conflict, document, page, scalarField } from './contract.js';

/** Single-process development store; a single snapshot commit covers collections and counters. */
export async function createFileStore(dir) {
  await fs.mkdir(path.join(dir, 'media'), { recursive: true });
  const context = new AsyncLocalStorage();
  let committed, loading, chain = Promise.resolve();
  const snapshot = path.join(dir, 'state.json');
  const readJson = async (file, fallback) => {
    try { return JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw e; return fallback; }
  };
  async function loaded() {
    if (!loading) loading = (async () => {
      committed = await readJson(snapshot, null);
      if (!committed) {
        const rows = await Promise.all(COLLECTIONS.map(async n => [n, await readJson(path.join(dir, `${n}.json`), [])]));
        committed = { version: 1, collections: Object.fromEntries(rows), counters: await readJson(path.join(dir, 'counters.json'), {}) };
      }
      if (committed.version !== 1 || !committed.collections || !committed.counters || typeof committed.counters !== 'object' || Array.isArray(committed.counters)) throw new Error('Invalid store snapshot');
      for (const n of COLLECTIONS) {
        committed.collections[n] ??= [];
        if (!Array.isArray(committed.collections[n])) throw new Error(`Invalid collection JSON: ${n}`);
      }
      for (const v of Object.values(committed.counters)) if (!Number.isSafeInteger(v) || v < 0) throw new Error('Invalid sequence counter');
    })();
    return loading;
  }
  async function state() { await loaded(); return context.getStore()?.state || committed; }
  async function persist(value) {
    const tmp = snapshot + '.' + crypto.randomUUID() + '.tmp';
    const handle = await fs.open(tmp, 'wx');
    try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
    try { await fs.rename(tmp, snapshot); } catch (e) { await fs.rm(tmp, { force: true }); throw e; }
  }
  const store = {
    kind: 'file', inAtomic: () => !!context.getStore(),
    async afterCommit(fn) { const tx = context.getStore(); if (tx) { tx.effects.push(fn); return; } return fn(); },
    atomic(fn) {
      if (context.getStore()) return Promise.resolve().then(fn);
      const operation = chain.then(async () => {
        await loaded(); const tx = { state: structuredClone(committed), effects: [] };
        const result = await context.run(tx, fn);
        await persist(tx.state); committed = tx.state;
        return { result, effects: tx.effects };
      });
      chain = operation.then(() => {}, () => {});
      return operation.then(async ({ result, effects }) => { for (const effect of effects) await effect(); return result; });
    },
    async close() { await chain; },
  };
  function checkUnique(name, rows, row) {
    if (rows.some(r => r.id === row.id)) throw conflict(`Duplicate ${name}.id`);
    for (const field of UNIQUE[name] || []) {
      const required=LEGACY_UNIQUE.has(name+':'+field);
      if ((required || (typeof row[field] === 'string' && row[field])) && rows.some(r => (r[field]??null) === (row[field]??null))) throw conflict(`Duplicate ${name}.${field}`);
    }
  }
  for (const name of COLLECTIONS) store[name] = {
    async all(options) {
      const { sort, skip, limit } = page(options); let rows = structuredClone((await state()).collections[name]);
      if (sort) rows.sort((a,b) => { for (const [k,d] of Object.entries(sort)) { const cmp = a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0; if (cmp) return cmp*d; } return String(a.id).localeCompare(String(b.id)); });
      return rows.slice(skip, limit ? skip + limit : undefined);
    },
    async get(id) { return structuredClone((await state()).collections[name].find(r => r.id === id) || null); },
    async findBy(field,value) { scalarField(field,value); return structuredClone((await state()).collections[name].find(r => r[field] === value) || null); },
    insert(doc) { return store.atomic(async () => { const rows = (await state()).collections[name], row = document(doc, doc.id ?? crypto.randomUUID()); checkUnique(name,rows,row); rows.push(row); return structuredClone(row); }); },
    update(id, patch) { return store.atomic(async () => { const rows = (await state()).collections[name], i = rows.findIndex(r => r.id === id); if (i<0) return null; if(name==='ledger'&&rows[i].immutable)throw conflict('Posted journals are immutable'); const row=document({...rows[i],...patch},id); checkUnique(name,rows.filter((_,j)=>j!==i),row); rows[i]=row; return structuredClone(row); }); },
    compareAndUpdate(id, expected, patch) { return store.atomic(async () => { const row = await store[name].get(id); if (!row || !Object.entries(expected).every(([k,v]) => row[k] === v)) return null; return store[name].update(id,patch); }); },
    remove(id) { return store.atomic(async () => { const rows=(await state()).collections[name], i=rows.findIndex(r=>r.id===id); if(i<0)return false; if(name==='ledger'&&rows[i].immutable)throw conflict('Posted journals cannot be deleted'); rows.splice(i,1); return true; }); },
    async count() { return (await state()).collections[name].length; },
    replaceAll(docs) { return store.atomic(async()=> { if(name==='ledger'&&(await state()).collections[name].some(j=>j.immutable))throw conflict('Posted journals cannot be replaced');const rows=[]; for(const d of docs){const row=document(d,d.id??crypto.randomUUID());checkUnique(name,rows,row);rows.push(row);} (await state()).collections[name]=rows; }); },
  };
  store.nextSeq = key => store.atomic(async()=> { const s=await state(); const value=(s.counters[key]||0)+1; if(!Number.isSafeInteger(value))throw new RangeError('Sequence exhausted');s.counters[key]=value;return value; });
  store.exportCounters = async()=>structuredClone((await state()).counters);
  store.saveMedia = async(buf,contentType)=> { const id=crypto.randomUUID();await fs.writeFile(path.join(dir,'media',id),buf);await fs.writeFile(path.join(dir,'media',id+'.type'),contentType);return id; };
  store.getMedia = async id => { if(!/^[0-9a-f-]{36}$/.test(id))return null;try{return{data:await fs.readFile(path.join(dir,'media',id)),contentType:await fs.readFile(path.join(dir,'media',id+'.type'),'utf8')};}catch(e){if(e.code==='ENOENT')return null;throw e;} };
  store.deleteMedia = async id => { if(!/^[0-9a-f-]{36}$/.test(id))return;await fs.rm(path.join(dir,'media',id),{force:true});await fs.rm(path.join(dir,'media',id+'.type'),{force:true}); };
  return store;
}
