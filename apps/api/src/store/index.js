import { createFileStore } from "./file.js";
import { createMongoStore } from "./mongo.js";

export async function createStore(cfg) {
  if (cfg.mongoUri) {
    try {
      return await createMongoStore(cfg.mongoUri, cfg.dbName);
    } catch (err) {
      console.warn("MongoDB connection failed, falling back to file store for preview:", err.message);
      return createFileStore(cfg.dataDir);
    }
  }
  return createFileStore(cfg.dataDir);
}
