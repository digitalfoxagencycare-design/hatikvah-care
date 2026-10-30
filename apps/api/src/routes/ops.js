import { Router } from "express";
import { z } from "zod";
import { requireOwner } from "../auth.js";
import { RULES } from "../lib/automation.js";
import { GST_RATES, STATES } from "../lib/gst.js";
import { channels } from "../lib/notify.js";
import { PERMISSIONS, requirePerm, ROLES } from "../lib/permissions.js";
import { DEFAULT_HOME, homeInput } from "../schemas.js";
import { wrap } from "./public.js";
import { bad, notFound, parse } from "./shared.js";
import { atomicWrap } from "./atomic.js";

/** Website content, automation settings and message log, look-up lists, and the owner's full backup. */
export function opsRoutes({ cfg, store, audit, automation, notifier }) {
  const r = Router();
  const backupWrap=fn=>atomicWrap(store,fn,{readSnapshot:true});

  r.get("/meta", (_req, res) => res.json({ states: STATES, gstRates: GST_RATES, roles: ROLES, permissions: PERMISSIONS, channels: channels(cfg) }));

  // ---------- website content (home page sections)
  r.get("/content/home", requirePerm("content"), wrap(async (_req, res) => { const d = await store.settings.findBy("key", "home"); res.json(d ? { ...DEFAULT_HOME, ...d.value } : DEFAULT_HOME); }));
  r.put("/content/home", requirePerm("content"), wrap(async (req, res) => {
    const d = parse(homeInput, req.body, res); if (!d) return;
    const cur = await store.settings.findBy("key", "home");
    if (cur) await store.settings.update(cur.id, { value: d }); else await store.settings.insert({ key: "home", value: d });
    await audit(req, "content.update", "home"); res.json(d);
  }));

  // ---------- automation
  const autoPatch = z.object({
    enabled: z.record(z.enum(RULES.map((x) => x.id)), z.boolean()).optional(),
    alertEmail: z.union([z.literal(""), z.string().trim().email().max(160)]).optional(), alertWhatsapp: z.string().regex(/^[0-9]{0,15}$/, "WhatsApp: digits only, with country code").optional(),
    staleHours: z.number().int().min(1).max(720).optional(), dailyHour: z.number().int().min(0).max(23).optional(),
    quoteReminderDays: z.array(z.number().int().min(1).max(90)).max(5).optional(), overdueDays: z.array(z.number().int().min(1).max(365)).max(6).optional(),
  }).strict();
  r.get("/automation", requirePerm("automation"), wrap(async (_req, res) => res.json({ rules: RULES, config: await automation.config(), channels: channels(cfg), cron: { everyMinutes: cfg.automationEveryMin, externalTrigger: !!cfg.cronSecret } })));
  r.put("/automation", requireOwner, wrap(async (req, res) => {
    const d = parse(autoPatch, req.body, res); if (!d) return;
    const cur = await automation.config();
    const upd = await store.settings.update(cur.id, { ...d, ...(d.enabled ? { enabled: { ...cur.enabled, ...d.enabled } } : {}) });
    await audit(req, "automation.update", "settings", d); res.json(upd);
  }));
  r.post("/automation/run", requirePerm("automation"), wrap(async (req, res) => { const out = await automation.run(); await audit(req, "automation.run", "manual", out); res.json(out); }));

  r.get("/outbox", requirePerm("automation", "enquiries", "invoices"), wrap(async (req, res) => {
    let rows = await store.outbox.all({ sort: { createdAt: -1 }, limit: 500 });
    if (req.query.status) rows = rows.filter((m) => m.status === req.query.status);
    res.json(rows.slice(0, 300));
  }));
  r.post("/outbox/:id/done", requirePerm("automation", "enquiries", "invoices"), wrap(async (req, res) => {
    const m = await store.outbox.get(req.params.id); if (!m) return notFound(res, "Message");
    res.json(await store.outbox.update(m.id, { status: "sent", sentAt: new Date().toISOString(), error: "", sentBy: req.admin.email }));
  }));
  r.post("/outbox/:id/retry", requirePerm("automation"), wrap(async (req, res) => {
    const m = await store.outbox.get(req.params.id); if (!m) return notFound(res, "Message");
    if (channels(cfg)[m.channel] === "off") return bad(res, `${m.channel === "email" ? "Email" : "WhatsApp"} sending is not set up yet. Use the send-by-hand link.`, 409);
    await store.outbox.update(m.id, { status: "queued", attempts: 0 }); await notifier.flush(); res.json(await store.outbox.get(m.id));
  }));

  // ---------- backup (owner): everything except password hashes and photos
  r.get("/backup", requireOwner, backupWrap(async (req, res) => {
    const names = ["settings", "categories", "products", "customers", "priceLists", "enquiries", "activities", "quotes", "orders", "invoices", "payments", "stockMoves", "suppliers", "purchases", "outbox", "audit", "ledger", "creditNotes", "inbox"];
    const out = { formatVersion: 2, counters: await store.exportCounters(), mediaIncluded: false, exportedAt: new Date().toISOString(), app: "hatikvah-care" };
    for (const n of names) out[n] = await store[n].all();
    out.accountingReconciliation = { legacyJournalIds: out.ledger.filter(j => !j.lines).map(j => j.id) };
    out.admins = (await store.admins.all()).map(({ passwordHash, totpSecret, totpPending, ...a }) => a);
    await audit(req, "backup.download", "all");
    res.set({ "Content-Type": "application/json", "Content-Disposition": `attachment; filename="hatikvah-backup-${out.exportedAt.slice(0, 10)}.json"` }).send(JSON.stringify(out));
  }));
  return r;
}
