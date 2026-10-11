import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "../../..");

/** Reads settings from the environment. Production refuses to start with weak or missing secrets. */
export function loadConfig(env = process.env) {
  const prod = env.NODE_ENV === "production";
  const cfg = {
    prod,
    port: Number(env.PORT || 8080),
    jwtSecret: env.JWT_SECRET || "",
    mongoUri: env.MONGODB_URI || "",
    dbName: env.MONGODB_DB || "hatikvah_care",
    dataDir: env.DATA_DIR || (prod && process.platform !== "win32" ? "/tmp/data" : path.join(REPO_ROOT, ".data")),
    seedFile: env.SEED_FILE || path.join(REPO_ROOT, "data", "catalog.json"),
    webDist: env.WEB_DIST || path.join(REPO_ROOT, "apps", "web", "dist"),
    publicUrl: (env.PUBLIC_URL || "").replace(/\/$/, ""),
    cookieSecure: prod,
    trustProxy: env.TRUST_PROXY ? Number(env.TRUST_PROXY) : prod ? 1 : 0,
    sessionHours: Number(env.SESSION_HOURS || 12),
  };
  if (!cfg.jwtSecret && !prod) cfg.jwtSecret = "dev-only-secret-change-me-dev-only-secret-change-me";
  const problems = [];
  if (cfg.jwtSecret.length < 32) problems.push("JWT_SECRET must be at least 32 characters");
  if (prod && /dev-only|change-me|replace/i.test(cfg.jwtSecret)) problems.push("JWT_SECRET looks like a placeholder");
  if (problems.length) throw new Error("Unsafe configuration: " + problems.join("; "));
  return cfg;
}
