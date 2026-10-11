import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const COLLECTIONS = ["products", "categories", "enquiries", "admins", "audit", "settings"];

/** Development / test store: one JSON file per collection, written atomically. Same interface as the Mongo store. */
export async function createFileStore(dir) {
  await fs.mkdir(path.join(dir, "media"), { recursive: true });
  const cache = new Map();
  let chain = Promise.resolve();

  async function load(name) {
    if (cache.has(name)) return cache.get(name);
    let rows = [];
    try { rows = JSON.parse(await fs.readFile(path.join(dir, `${name}.json`), "utf8")); } catch { /* new */ }
    cache.set(name, rows);
    return rows;
  }
  function save(name) {
    // serialise writes so two requests never interleave a half-written file
    chain = chain.then(async () => {
      const tmp = path.join(dir, `${name}.json.tmp`);
      await fs.writeFile(tmp, JSON.stringify(cache.get(name), null, 1));
      await fs.rename(tmp, path.join(dir, `${name}.json`));
    });
    return chain;
  }
  const clone = (x) => (x === undefined ? x : structuredClone(x));

  const col = (name) => ({
    async all({ sort, limit } = {}) {
      let rows = clone(await load(name));
      if (sort) { const [[k, dir_]] = Object.entries(sort); rows.sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * dir_); }
      return limit ? rows.slice(0, limit) : rows;
    },
    async get(id) { return clone((await load(name)).find((r) => r.id === id)) ?? null; },
    async findBy(field, value) { return clone((await load(name)).find((r) => r[field] === value)) ?? null; },
    async insert(doc) {
      const rows = await load(name);
      const row = { id: crypto.randomUUID(), ...clone(doc) };
      rows.push(row); await save(name); return clone(row);
    },
    async update(id, patch) {
      const rows = await load(name); const i = rows.findIndex((r) => r.id === id);
      if (i < 0) return null;
      rows[i] = { ...rows[i], ...clone(patch), id }; await save(name); return clone(rows[i]);
    },
    async remove(id) {
      const rows = await load(name); const i = rows.findIndex((r) => r.id === id);
      if (i < 0) return false;
      rows.splice(i, 1); await save(name); return true;
    },
    async count() { return (await load(name)).length; },
    async replaceAll(docs) { cache.set(name, docs.map((d) => ({ id: crypto.randomUUID(), ...clone(d) }))); await save(name); },
  });

  const store = { kind: "file", async close() { await chain; } };
  for (const n of COLLECTIONS) store[n] = col(n);
  store.saveMedia = async (buf, contentType) => {
    const id = crypto.randomUUID();
    await fs.writeFile(path.join(dir, "media", id), buf);
    await fs.writeFile(path.join(dir, "media", id + ".type"), contentType);
    return id;
  };
  store.getMedia = async (id) => {
    if (!/^[0-9a-f-]{36}$/.test(id)) return null;
    try {
      return { data: await fs.readFile(path.join(dir, "media", id)), contentType: await fs.readFile(path.join(dir, "media", id + ".type"), "utf8") };
    } catch { return null; }
  };
  store.deleteMedia = async (id) => {
    if (!/^[0-9a-f-]{36}$/.test(id)) return;
    await fs.rm(path.join(dir, "media", id), { force: true }); await fs.rm(path.join(dir, "media", id + ".type"), { force: true });
  };
  return store;
}
