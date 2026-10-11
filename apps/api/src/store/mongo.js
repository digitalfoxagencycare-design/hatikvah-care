import crypto from "node:crypto";
import { MongoClient, Binary } from "mongodb";

const COLLECTIONS = ["products", "categories", "enquiries", "admins", "audit", "settings"];

/** Production store (MongoDB Atlas). Same interface as the file store; documents use a string `id` as `_id`. */
export async function createMongoStore(uri, dbName) {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
  await client.connect();
  const db = client.db(dbName);
  const out = (d) => { if (!d) return null; const { _id, ...rest } = d; return { id: _id, ...rest }; };
  const col = (name) => {
    const c = db.collection(name);
    return {
      async all({ sort, limit } = {}) {
        let cur = c.find({});
        if (sort) cur = cur.sort(sort);
        if (limit) cur = cur.limit(limit);
        return (await cur.toArray()).map(out);
      },
      async get(id) { return out(await c.findOne({ _id: id })); },
      async findBy(field, value) { return out(await c.findOne({ [field]: value })); },
      async insert(doc) { const id = crypto.randomUUID(); await c.insertOne({ _id: id, ...doc }); return { id, ...doc }; },
      async update(id, patch) {
        const { id: _drop, ...rest } = patch;
        return out(await c.findOneAndUpdate({ _id: id }, { $set: rest }, { returnDocument: "after" }));
      },
      async remove(id) { return (await c.deleteOne({ _id: id })).deletedCount === 1; },
      async count() { return c.countDocuments({}); },
      async replaceAll(docs) {
        await c.deleteMany({});
        if (docs.length) await c.insertMany(docs.map((d) => ({ _id: crypto.randomUUID(), ...d })));
      },
    };
  };
  const store = { kind: "mongo", async close() { await client.close(); } };
  for (const n of COLLECTIONS) store[n] = col(n);
  const media = db.collection("media");
  store.saveMedia = async (buf, contentType) => {
    const id = crypto.randomUUID();
    await media.insertOne({ _id: id, contentType, data: new Binary(buf), createdAt: new Date().toISOString() });
    return id;
  };
  store.getMedia = async (id) => {
    const d = await media.findOne({ _id: id });
    return d ? { data: Buffer.from(d.data.buffer), contentType: d.contentType } : null;
  };
  store.deleteMedia = async (id) => { await media.deleteOne({ _id: id }); };
  await Promise.all([
    db.collection("products").createIndex({ slug: 1 }, { unique: true }),
    db.collection("products").createIndex({ sku: 1 }),
    db.collection("admins").createIndex({ email: 1 }, { unique: true }),
    db.collection("enquiries").createIndex({ createdAt: -1 }),
    db.collection("audit").createIndex({ at: -1 }),
  ]);
  return store;
}
