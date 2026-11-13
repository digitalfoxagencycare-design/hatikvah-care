import fs from "node:fs/promises";
import path from "node:path";
import { createStore } from "../apps/api/src/store/index.js";

const MONGO_URI = process.env.MONGODB_URI || "mongodb+srv://novasaas_admin:km6nEqgcCiMFuj6S@cluster0.wlbsole.mongodb.net/?retryWrites=true&w=majority";
const DB_NAME = process.env.MONGODB_DB || "hatikvah_care";

async function main() {
  const store = await createStore({ mongoUri: MONGO_URI, dbName: DB_NAME, dataDir: ".data" });
  const products = await store.products.all();
  await fs.mkdir("backups", { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.resolve(`backups/products-backup-${ts}.json`);
  await fs.writeFile(backupPath, JSON.stringify(products, null, 2), "utf8");
  console.log(`[Backup] Successfully saved ${products.length} products to:`);
  console.log(`         ${backupPath}`);
  await store.close();
}

main().catch((err) => {
  console.error("Backup failed:", err);
  process.exit(1);
});

