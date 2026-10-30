import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { seedIfEmpty } from "./seed.js";
import { seedDemoData } from "./seedDemo.js";
import { createStore } from "./store/index.js";
import { drainServer } from "./lib/lifecycle.js";
import { assertAccountingReady } from "./lib/accounting-readiness.js";

const cfg = loadConfig();
const store = await createStore(cfg);
await store.atomic(() => seedIfEmpty(store, cfg.seedFile));
if (cfg.prod) { try { await assertAccountingReady(store); } catch(e) { await store.close(); throw e; } }
if (!cfg.prod && process.env.SEED_DEMO_DATA === "true") {
  try { await seedDemoData(store, console, cfg); } catch (e) { console.warn("Failed to seed demo data", e); }
}
const app = createApp({ cfg, store });
const server = app.listen(cfg.port, () => console.log(`HaTikvah Care API on :${cfg.port} (${store.kind} store, ${cfg.prod ? "production" : "development"})`));
// Scheduled automations (reminders, follow-ups, summaries). One run at a time; failures are logged, never fatal.
let running = false, stopping = false, activeJob = Promise.resolve();
const tick = () => { if (running || stopping) return; running = true; activeJob = app.locals.automation.run().catch(e => console.error("Automation run failed",e)).finally(()=>{running=false;}); return activeJob; };
const timer = cfg.automationEveryMin > 0 ? setInterval(tick, cfg.automationEveryMin * 60_000) : null;
const startupTimer = timer ? setTimeout(tick, 15_000) : null;
const stop = async () => { if(stopping)return;stopping=true;clearInterval(timer);clearTimeout(startupTimer);try{await drainServer(server,store,[activeJob]);process.exit(0);}catch(e){console.error(e.message);process.exit(1);} };
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
