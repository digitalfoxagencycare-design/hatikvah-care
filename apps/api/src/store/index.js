import { createFileStore } from "./file.js";
import { createMongoStore } from "./mongo.js";

/** MongoDB when MONGODB_URI is set (a connection failure stops the server: never fall back to a store that loses data), else the dev file store. */
export async function createStore(cfg) {
  return cfg.mongoUri ? createMongoStore(cfg.mongoUri, cfg.dbName) : createFileStore(cfg.dataDir);
}
