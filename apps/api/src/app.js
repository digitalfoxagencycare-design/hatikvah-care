import fs from "node:fs";
import path from "node:path";
import cookieParser from "cookie-parser";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { adminRoutes } from "./routes/admin.js";
import { mediaRoute, publicRoutes } from "./routes/public.js";
import { seoRoutes } from "./routes/seo.js";

export function createApp({ cfg, store, log = console }) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", cfg.trustProxy);
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        "default-src": ["'self'"], "script-src": ["'self'"], "style-src": ["'self'", "https://fonts.googleapis.com"],
        "font-src": ["https://fonts.gstatic.com"], "img-src": ["'self'", "data:"], "connect-src": ["'self'"],
        "frame-ancestors": ["'none'"], "base-uri": ["'none'"], "form-action": ["'self'"], "object-src": ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false, referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  }));
  app.use(cookieParser());
  app.use(express.json({ limit: "100kb" }));
  app.use("/api", rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: true, legacyHeaders: false }));

  app.get("/api/health", async (_req, res) => {
    try { await store.settings.count(); res.json({ ok: true, store: store.kind }); } catch { res.status(503).json({ ok: false }); }
  });
  app.use("/api/public", publicRoutes({ store }));
  app.use("/api/admin", adminRoutes({ cfg, store }));
  app.use("/media", mediaRoute({ store }));
  app.use(seoRoutes({ cfg, store }));
  app.use("/api", (_req, res) => res.status(404).json({ error: "NOT_FOUND", message: "Unknown endpoint" }));

  if (fs.existsSync(path.join(cfg.webDist, "index.html"))) {
    app.use("/assets", express.static(path.join(cfg.webDist, "assets"), { immutable: true, maxAge: "1y" }));
    app.use(express.static(cfg.webDist, { maxAge: "1h", index: false }));
    app.get(/^\/(?!api\/|media\/).*/, (req, res) => {
      res.set("Cache-Control", "no-cache");
      if (req.path.startsWith("/admin")) res.set("X-Robots-Tag", "noindex");
      res.sendFile(path.join(cfg.webDist, "index.html"));
    });
  }

  app.use((err, _req, res, _next) => {
    if (err?.type === "entity.too.large") return res.status(413).json({ error: "TOO_LARGE", message: "That upload is too large" });
    if (err instanceof SyntaxError && "body" in err) return res.status(400).json({ error: "BAD_JSON", message: "Request was not valid JSON" });
    log.error?.("Unhandled error", err);
    res.status(500).json({ error: "SERVER_ERROR", message: "Something went wrong on our side. Please try again." });
  });
  return app;
}
