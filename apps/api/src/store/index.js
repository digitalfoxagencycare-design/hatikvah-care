import { createFileStore } from "./file.js";
import { createMongoStore } from "./mongo.js";

export async function createStore(cfg) {
  return cfg.mongoUri ? createMongoStore(cfg.mongoUri, cfg.dbName) : createFileStore(cfg.dataDir);
}
