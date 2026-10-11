import fs from "node:fs/promises";
import { DEFAULT_SETTINGS } from "./model.js";
import { hashPassword } from "./auth.js";

/** First boot only: loads the catalogue extracted from the PDF. Never overwrites existing data. */
export async function seedIfEmpty(store, seedFile, log = console) {
  if (!(await store.settings.findBy("key", "company"))) await store.settings.insert(DEFAULT_SETTINGS);

  if ((await store.admins.count()) === 0) {
    const defaultEmail = process.env.ADMIN_EMAIL || "owner@hatikvahcare.com";
    const defaultPassword = process.env.ADMIN_PASSWORD || "CareHospital2026!";
    await store.admins.insert({
      email: defaultEmail,
      name: "HaTikvah Admin",
      role: "owner",
      passwordHash: await hashPassword(defaultPassword),
      active: true,
      tokenVersion: 0,
      createdAt: new Date().toISOString(),
    });
    log.info?.(`Seeded default admin account: ${defaultEmail}`);
  }

  if ((await store.products.count()) > 0) return false;
  let data;
  try { data = JSON.parse(await fs.readFile(seedFile, "utf8")); } catch { log.warn?.("No seed catalogue found, starting empty"); return false; }
  const now = new Date().toISOString();
  await store.categories.replaceAll(data.categories.map((c) => ({ ...c })));
  await store.products.replaceAll(data.products.map((p) => ({ ...p, createdAt: now, updatedAt: now })));
  log.info?.(`Seeded ${data.products.length} products in ${data.categories.length} categories`);
  return true;
}
