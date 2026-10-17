import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { seedIfEmpty } from "./seed.js";
import { seedDemoData } from "./seedDemo.js";
import { createStore } from "./store/index.js";

const cfg = loadConfig();
const store = await createStore(cfg);
await seedIfEmpty(store, cfg.seedFile);
if (process.env.SEED_DEMO_DATA !== "false") {
  try { await seedDemoData(store); } catch (e) { console.warn("Failed to seed demo data", e); }
}
const app = createApp({ cfg, store });
const server = app.listen(cfg.port, () => console.log(`HaTikvah Care API on :${cfg.port} (${store.kind} store, ${cfg.prod ? "production" : "development"})`));
// Scheduled automations (reminders, follow-ups, summaries). One run at a time; failures are logged, never fatal.
let running = false;
const tick = async () => { if (running) return; running = true; try { await app.locals.automation.run(); } catch (e) { console.error("Automation run failed", e); } finally { running = false; } };
const timer = cfg.automationEveryMin > 0 ? setInterval(tick, cfg.automationEveryMin * 60_000) : null;
if (timer) setTimeout(tick, 15_000);
const stop = async () => { if (timer) clearInterval(timer); server.close(); await store.close(); process.exit(0); };
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
