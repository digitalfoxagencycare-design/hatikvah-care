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
    // Website shoppers and buyer-portal customers (WhatsApp code sign-in): sliding session, renewed once a day while in use.
    buyerSessionDays: Number(env.BUYER_SESSION_DAYS || 30),
    // Automations run every N minutes inside the server (0 = off; on Cloud Run also point Cloud Scheduler at POST /api/internal/cron).
    automationEveryMin: Number(env.AUTOMATION_INTERVAL_MIN ?? (env.NODE_ENV === "test" ? 0 : 5)),
    cronSecret: env.CRON_SECRET || "",
    // Integrations: all optional, all secrets from the environment. Unset = that channel is off and messages are kept for manual sending.
    resendKey: env.RESEND_API_KEY || "", mailFrom: env.MAIL_FROM || "", mailReplyTo: env.MAIL_REPLY_TO || "",
    waToken: env.WHATSAPP_TOKEN || "", waPhoneId: env.WHATSAPP_PHONE_ID || "", waTemplate: env.WHATSAPP_TEMPLATE || "", waTemplateLang: env.WHATSAPP_TEMPLATE_LANG || "en",
    waOtpTemplate: env.WHATSAPP_OTP_TEMPLATE || "", // an approved "Authentication" template; the login code is its only variable
    // Inbound webhook (Meta app > WhatsApp > Configuration): GET verification token, and the app secret that signs every POST (X-Hub-Signature-256).
    waVerifyToken: env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || "", waAppSecret: env.WHATSAPP_APP_SECRET || "", waBusinessId: env.WHATSAPP_BUSINESS_ACCOUNT_ID || "",
    waApiVersion: env.WHATSAPP_API_VERSION || "v21.0",
    // Shadowfax (logistics): API token from the Shadowfax client dashboard; webhook calls must carry X-Shadowfax-Token = SHADOWFAX_WEBHOOK_TOKEN.
    sfxToken: env.SHADOWFAX_API_TOKEN || "", sfxBaseUrl: (env.SHADOWFAX_BASE_URL || "https://dale.shadowfax.in").replace(/\/$/, ""), sfxWebhookToken: env.SHADOWFAX_WEBHOOK_TOKEN || "",
    sfxPickupPincode: env.SHADOWFAX_PICKUP_PINCODE || "", sfxTrackingUrl: env.SHADOWFAX_TRACKING_URL || "", // e.g. https://tracker.shadowfax.in/#/track/{awb}
    // Nova (central engine): login codes go out on Nova's WhatsApp number through its client API. Key issued in the Nova console.
    novaUrl: (env.NOVA_URL || "").replace(/\/$/, ""), novaKey: env.NOVA_CLIENT_KEY || "", novaSlug: env.NOVA_TENANT_SLUG || "",
    razorpayKeyId: env.RAZORPAY_KEY_ID || "", razorpaySecret: env.RAZORPAY_KEY_SECRET || "", razorpayWebhookSecret: env.RAZORPAY_WEBHOOK_SECRET || "",
  };
  if (!cfg.jwtSecret && !prod) cfg.jwtSecret = "dev-only-secret-change-me-dev-only-secret-change-me";
  const problems = [];
  if (prod && !cfg.mongoUri) problems.push("MONGODB_URI is required in production (the file store is for development only)");
  if (cfg.jwtSecret.length < 32) problems.push("JWT_SECRET must be at least 32 characters");
  if (prod && /dev-only|change-me|replace/i.test(cfg.jwtSecret)) problems.push("JWT_SECRET looks like a placeholder");
  if (cfg.novaUrl && !/^https:\/\//.test(cfg.novaUrl) && prod) problems.push("NOVA_URL must start with https://");
  if (!!cfg.novaUrl !== !!cfg.novaKey) problems.push("Set both NOVA_URL and NOVA_CLIENT_KEY, or neither");
  if (prod && cfg.waVerifyToken && !cfg.waAppSecret) problems.push("WHATSAPP_APP_SECRET is required with WHATSAPP_WEBHOOK_VERIFY_TOKEN (it proves webhook calls come from Meta)");
  if (cfg.waVerifyToken && cfg.waVerifyToken.length < 16) problems.push("WHATSAPP_WEBHOOK_VERIFY_TOKEN must be at least 16 characters");
  if (cfg.sfxWebhookToken && cfg.sfxWebhookToken.length < 24) problems.push("SHADOWFAX_WEBHOOK_TOKEN must be at least 24 characters");
  if (!(Number.isInteger(cfg.buyerSessionDays) && cfg.buyerSessionDays >= 1 && cfg.buyerSessionDays <= 90)) problems.push("BUYER_SESSION_DAYS must be a whole number from 1 to 90");
  if (cfg.cronSecret && cfg.cronSecret.length < 24) problems.push("CRON_SECRET must be at least 24 characters");
  if (problems.length) throw new Error("Unsafe configuration: " + problems.join("; "));
  return cfg;
}
