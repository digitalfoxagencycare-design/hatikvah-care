import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { seedIfEmpty } from "./seed.js";
import { createStore } from "./store/index.js";

const cfg = loadConfig();
const store = await createStore(cfg);
await seedIfEmpty(store, cfg.seedFile);
const app = createApp({ cfg, store });
const server = app.listen(cfg.port, () => console.log(`HaTikvah Care API on :${cfg.port} (${store.kind} store, ${cfg.prod ? "production" : "development"})`));
const stop = async () => { server.close(); await store.close(); process.exit(0); };
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
