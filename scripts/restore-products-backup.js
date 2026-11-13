import fs from "node:fs/promises";
import path from "node:path";
import { MongoClient } from "mongodb";

const MONGO_URI = process.env.MONGODB_URI || "mongodb+srv://novasaas_admin:km6nEqgcCiMFuj6S@cluster0.wlbsole.mongodb.net/?retryWrites=true&w=majority";
const DB_NAME = process.env.MONGODB_DB || "hatikvah_care";

async function main() {
  const fileArg = process.argv[2];
  if (!fileArg) {
    console.error("Usage: node scripts/restore-products-backup.js <path-to-backup.json>");
    process.exit(1);
  }

  const backupFile = path.resolve(fileArg);
  const raw = await fs.readFile(backupFile, "utf8");
  const products = JSON.parse(raw);

  if (!Array.isArray(products) || products.length === 0) {
    console.error("Invalid backup file: expected non-empty array of products.");
    process.exit(1);
  }

  console.log(`[Restore] Connecting to MongoDB Atlas: ${DB_NAME}...`);
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(DB_NAME);

  await db.collection("products").deleteMany({});
  const res = await db.collection("products").insertMany(products);
  console.log(`[Restore] Successfully restored ${res.insertedCount} products from ${backupFile}!`);

  await client.close();
}

main().catch((err) => {
  console.error("Restore failed:", err);
  process.exit(1);
});

