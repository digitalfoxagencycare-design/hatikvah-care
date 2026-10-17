import { createFileStore } from "./file.js";
import { createMongoStore } from "./mongo.js";

/** MongoDB when MONGODB_URI is set, falling back to file store if MongoDB connection fails (e.g. bad credentials or network in preview). */
export async function createStore(cfg) {
  if (cfg.mongoUri) {
    try {
      return await createMongoStore(cfg.mongoUri, cfg.dbName);
    } catch (err) {
      console.warn(`[store] MongoDB connection failed (${err.message}). Falling back to file store at ${cfg.dataDir}...`);
      return createFileStore(cfg.dataDir);
    }
  }
  return createFileStore(cfg.dataDir);
}
