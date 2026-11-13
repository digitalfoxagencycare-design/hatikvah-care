import { MongoClient } from "mongodb";
import fs from "node:fs/promises";
import path from "node:path";

const MONGO_URI = process.env.MONGODB_URI || "mongodb+srv://novasaas_admin:km6nEqgcCiMFuj6S@cluster0.wlbsole.mongodb.net/?retryWrites=true&w=majority";
const DB_NAME = process.env.MONGODB_DB || "hatikvah_care";

async function cleanMongo() {
  console.log(`Connecting to MongoDB Atlas: ${DB_NAME}...`);
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(DB_NAME);

  const collectionsToClear = ["invoices", "quotes", "orders", "payments", "creditNotes"];
  for (const collName of collectionsToClear) {
    const res = await db.collection(collName).deleteMany({});
    console.log(`[Mongo] Cleared ${collName}: deleted ${res.deletedCount} documents.`);
  }

  // Clear transactional ledger rows
  const ledgerRes = await db.collection("ledger").deleteMany({
    $or: [
      { source: { $in: ["invoice", "payment", "credit_note", "order"] } },
      { sourceKey: { $regex: /^(inv|quote|order|pay|cn)/i } },
    ],
  });
  console.log(`[Mongo] Cleared test ledger entries: deleted ${ledgerRes.deletedCount} rows.`);

  // Clear transactional stock moves from test invoices/orders
  const stockRes = await db.collection("stockMoves").deleteMany({
    reason: { $in: ["invoice", "order", "credit_note", "pos"] },
  });
  console.log(`[Mongo] Cleared test stock moves: deleted ${stockRes.deletedCount} rows.`);

  // Reset sequential counters for clean numbers
  await db.collection("counters").deleteMany({
    _id: { $in: ["INV", "SO", "QT", "CN", "PAY"] },
  });
  console.log(`[Mongo] Reset sequence counters (INV, SO, QT, CN).`);

  await client.close();
  console.log("[Mongo] Cleanup finished successfully.");
}

async function cleanLocalFileStore() {
  const dataDir = path.resolve(".data");
  const statePath = path.join(dataDir, "state.json");
  try {
    const raw = await fs.readFile(statePath, "utf8");
    const state = JSON.parse(raw);
    if (state.collections) {
      state.collections.invoices = [];
      state.collections.quotes = [];
      state.collections.orders = [];
      state.collections.payments = [];
      state.collections.creditNotes = [];
      if (Array.isArray(state.collections.ledger)) {
        state.collections.ledger = state.collections.ledger.filter(
          (l) => !["invoice", "payment", "credit_note", "order"].includes(l.source)
        );
      }
      if (Array.isArray(state.collections.stockMoves)) {
        state.collections.stockMoves = state.collections.stockMoves.filter(
          (m) => !["invoice", "order", "credit_note", "pos"].includes(m.reason)
        );
      }
    }
    if (state.counters) {
      delete state.counters["INV"];
      delete state.counters["SO"];
      delete state.counters["QT"];
      delete state.counters["CN"];
    }
    await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf8");
    console.log("[FileStore] Cleaned .data/state.json successfully.");
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.warn("[FileStore] Notice:", err.message);
    }
  }
}

async function main() {
  try {
    await cleanMongo();
  } catch (err) {
    console.error("[Mongo] Error cleaning MongoDB:", err.message);
  }
  await cleanLocalFileStore();
}

main();

