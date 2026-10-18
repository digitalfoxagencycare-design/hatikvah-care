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
    // Automations run every N minutes inside the server (0 = off; on Cloud Run also point Cloud Scheduler at POST /api/internal/cron).
    automationEveryMin: Number(env.AUTOMATION_INTERVAL_MIN ?? (env.NODE_ENV === "test" ? 0 : 5)),
    cronSecret: env.CRON_SECRET || "",
    // Integrations: all optional, all secrets from the environment. Unset = that channel is off and messages are kept for manual sending.
    resendKey: env.RESEND_API_KEY || "", mailFrom: env.MAIL_FROM || "", mailReplyTo: env.MAIL_REPLY_TO || "",
    waToken: env.WHATSAPP_TOKEN || "", waPhoneId: env.WHATSAPP_PHONE_ID || "", waTemplate: env.WHATSAPP_TEMPLATE || "", waTemplateLang: env.WHATSAPP_TEMPLATE_LANG || "en",
    waOtpTemplate: env.WHATSAPP_OTP_TEMPLATE || "", // an approved "Authentication" template; the login code is its only variable
    razorpayKeyId: env.RAZORPAY_KEY_ID || "", razorpaySecret: env.RAZORPAY_KEY_SECRET || "", razorpayWebhookSecret: env.RAZORPAY_WEBHOOK_SECRET || "",
  };
  if (!cfg.jwtSecret && !prod) cfg.jwtSecret = "dev-only-secret-change-me-dev-only-secret-change-me";
  const problems = [];
  if (prod && !cfg.mongoUri) problems.push("MONGODB_URI is required in production (the file store is for development only)");
  if (cfg.jwtSecret.length < 32) problems.push("JWT_SECRET must be at least 32 characters");
  if (prod && /dev-only|change-me|replace/i.test(cfg.jwtSecret)) problems.push("JWT_SECRET looks like a placeholder");
  if (cfg.cronSecret && cfg.cronSecret.length < 24) problems.push("CRON_SECRET must be at least 24 characters");
  if (problems.length) throw new Error("Unsafe configuration: " + problems.join("; "));
  return cfg;
}
