import fs from "node:fs";
import path from "node:path";
import cookieParser from "cookie-parser";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { adminRoutes } from "./routes/admin.js";
import { mediaRoute, publicRoutes } from "./routes/public.js";
import { seoRoutes } from "./routes/seo.js";
import { docRoutes } from "./routes/docs.js";
import { shopRoutes } from "./routes/shop.js";
import { buyerRoutes } from "./routes/buyer.js";
import { whatsappWebhook } from "./routes/whatsapp.js";
import { logisticsWebhook } from "./routes/logistics.js";
import { createAutomation } from "./lib/automation.js";
import { createNotifier } from "./lib/notify.js";

export function createApp({ cfg, store, log = console, fetchImpl }) {
  const app = express();
  const notifier = createNotifier({ cfg, store, log, ...(fetchImpl ? { fetchImpl } : {}) });
  const automation = createAutomation({ cfg, store, notifier, log, ...(fetchImpl ? { fetchImpl } : {}) });
  app.locals.automation = automation;
  app.disable("x-powered-by");
  app.set("trust proxy", cfg.trustProxy);
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        "default-src": ["'self'"], "script-src": ["'self'", "https://www.googletagmanager.com", "https://connect.facebook.net"], "style-src": ["'self'", "https://fonts.googleapis.com"],
        "font-src": ["https://fonts.gstatic.com"], "img-src": ["'self'", "data:", "https://rzp.io", "https://*.razorpay.com", "https://www.googletagmanager.com", "https://www.google-analytics.com", "https://www.facebook.com"],
        "connect-src": ["'self'", "https://www.google-analytics.com", "https://*.google-analytics.com", "https://www.googletagmanager.com", "https://www.facebook.com", "https://connect.facebook.net"],
        "frame-ancestors": ["'none'"], "base-uri": ["'none'"], "form-action": ["'self'"], "object-src": ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false, referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  }));
  app.use(cookieParser());
  app.use("/api", rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: true, legacyHeaders: false }));
  app.use(docRoutes({ cfg, store, automation })); // before the JSON parser: the payment webhook needs the raw body to check its signature
  app.use(whatsappWebhook({ cfg, store, automation, notifier, log })); // same: Meta signs the raw body
  app.use(logisticsWebhook({ cfg, store, automation, log }));
  app.use("/api/admin/products/import", express.json({ limit: "2mb" }));
  app.use(express.json({ limit: "100kb" }));
  app.use(["/api/admin", "/api/shop", "/api/buyer"], (_req,res,next)=>{res.set("Cache-Control","no-store");next();});

  app.get("/api/health", async (_req, res) => {
    try { await store.settings.count(); res.json({ ok: true, store: store.kind }); } catch { res.status(503).json({ ok: false }); }
  });
  app.use("/api/public", publicRoutes({ cfg, store, automation }));
  app.use("/api/shop", shopRoutes({ cfg, store, automation, notifier, ...(fetchImpl ? { fetchImpl } : {}) }));
  app.use("/api/buyer", buyerRoutes({ cfg, store, automation, ...(fetchImpl ? { fetchImpl } : {}) }));
  app.use("/api/admin", adminRoutes({ cfg, store, automation, notifier, ...(fetchImpl ? { fetchImpl } : {}) }));
  app.use("/media", mediaRoute({ store }));
  app.use(seoRoutes({ cfg, store }));
  app.use("/api", (_req, res) => res.status(404).json({ error: "NOT_FOUND", message: "Unknown endpoint" }));

  if (fs.existsSync(path.join(cfg.webDist, "index.html"))) {
    app.use("/assets", express.static(path.join(cfg.webDist, "assets"), { immutable: true, maxAge: "1y" }));
    app.use("/assets", (_req, res) => res.status(404).type("text/plain").send("Asset not found"));
    app.use(express.static(cfg.webDist, { maxAge: "1h", index: false }));
    app.get(/^\/(?!api\/|media\/|assets\/).*/, (req, res) => {
      res.set("Cache-Control", "no-cache");
      if (req.path.startsWith("/admin") || req.path.startsWith("/doc/")) res.set("X-Robots-Tag", "noindex");
      res.sendFile(path.join(cfg.webDist, "index.html"));
    });
  }

  app.use((err, _req, res, _next) => {
    if (err?.type === "entity.too.large") return res.status(413).json({ error: "TOO_LARGE", message: "That upload is too large" });
    if (err?.userError) return res.status(err.status || 400).json({ error: "INVALID", message: err.message });
    if (err instanceof SyntaxError && "body" in err) return res.status(400).json({ error: "BAD_JSON", message: "Request was not valid JSON" });
    log.error?.("Unhandled error", err);
    res.status(500).json({ error: "SERVER_ERROR", message: "Something went wrong on our side. Please try again." });
  });
  return app;
}
