import fs from "node:fs/promises";
import { DEFAULT_SETTINGS } from "./model.js";
import { hashPassword, passwordProblem } from "./auth.js";

/** First boot only: loads the catalogue extracted from the PDF. Never overwrites existing data. */
export async function seedIfEmpty(store, seedFile, log = console) {
  if (!(await store.settings.findBy("key", "company"))) await store.settings.insert(DEFAULT_SETTINGS);

  // Optional first-owner bootstrap for automated setups. Both values must come from the environment; nothing is ever hard-coded.
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase(), password = process.env.ADMIN_PASSWORD;
  if (email && password && (await store.admins.count()) === 0) {
    const problem = passwordProblem(password, email);
    if (problem) log.warn?.(`ADMIN_PASSWORD rejected (${problem}); no admin created`);
    else {
      await store.admins.insert({ email, name: "Owner", role: "owner", passwordHash: await hashPassword(password), active: true, tokenVersion: 0, createdAt: new Date().toISOString() });
      log.info?.(`Created first owner account ${email}`);
    }
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
