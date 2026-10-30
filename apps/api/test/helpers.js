import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/auth.js";
import { loadConfig, REPO_ROOT } from "../src/config.js";
import { seedIfEmpty } from "../src/seed.js";
import { createStore } from "../src/store/index.js";
import { registerApp } from "./in-process-http.js";

export const PW = "Correct-Horse-91";

/** A real server on a random port with a throw-away file store seeded from the real catalogue. */
export async function boot({ seed = true, owner = true, env = {}, fetchImpl } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hc-test-"));
  const cfg = loadConfig({ NODE_ENV: "test", DATA_DIR: dir, JWT_SECRET: "t".repeat(48), WEB_DIST: path.join(dir, "no-web"), ...env });
  const store = await createStore(cfg);
  if (seed) await seedIfEmpty(store, path.join(REPO_ROOT, "data", "catalog.json"), { info() {}, warn() {} });
  if (owner) await store.admins.insert({ email: "owner@example.com", name: "Owner", role: "owner", passwordHash: await hashPassword(PW), active: true, tokenVersion: 0, createdAt: "x" });
  const app = createApp({ cfg, store, log: { error() {}, warn() {} }, ...(fetchImpl ? { fetchImpl } : {}) });
  if (process.env.HC_TEST_TRANSPORT === "in-process") {
    const transport = registerApp(app);
    return { base: transport.base, store, cfg, dir, close: async () => { transport.close(); await store.close(); await fs.rm(dir, { recursive: true, force: true }); } };
  }
  const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, store, cfg, dir, close: async () => { server.close(); await store.close(); await fs.rm(dir, { recursive: true, force: true }); } };
}

/** Tiny cookie-keeping client. */
export function client(base) {
  let cookie = "";
  const call = async (method, url, body, { headers = {}, raw = false } = {}) => {
    const h = { ...headers };
    if (cookie) h.cookie = cookie;
    if (method !== "GET") h["x-requested-with"] = h["x-requested-with"] ?? "hc-admin";
    let payload = body;
    if (body !== undefined && !raw) { h["content-type"] = "application/json"; payload = JSON.stringify(body); }
    const res = await fetch(base + url, { method, headers: h, body: payload, redirect: "manual" });
    const set = res.headers.getSetCookie?.() || [];
    for (const c of set) { const [kv] = c.split(";"); const [k, v] = kv.split("="); if (v === "" || /Expires=Thu, 01 Jan 1970/.test(c)) cookie = ""; else cookie = `${k}=${v}`; }
    const ct = res.headers.get("content-type") || "";
    const data = ct.includes("json") ? await res.json() : await res.text();
    return { status: res.status, data, headers: res.headers };
  };
  return { get: (u, o) => call("GET", u, undefined, o), post: (u, b, o) => call("POST", u, b, o), patch: (u, b, o) => call("PATCH", u, b, o), put: (u, b, o) => call("PUT", u, b, o), del: (u, o) => call("DELETE", u, undefined, o) };
}

export async function login(base, email = "owner@example.com", password = PW) {
  const c = client(base);
  const r = await c.post("/api/admin/login", { email, password });
  if (r.status !== 200) throw new Error("login failed " + JSON.stringify(r.data));
  return c;
}
