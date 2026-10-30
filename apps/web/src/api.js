export class ApiError extends Error {
  constructor(message, status, field) { super(message); this.status = status; this.field = field; }
}

/** One place for every server call: JSON in/out, clear error messages, anti-CSRF header on writes. */
export async function api(path, { method = "GET", body, raw, signal, idempotencyKey } = {}) {
  const headers = {};
  if (method !== "GET") headers["X-Requested-With"] = "hc-admin";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  let payload;
  if (raw !== undefined) { payload = raw.body; headers["Content-Type"] = raw.type; }
  else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  let res;
  try { res = await fetch(path, { method, headers, body: payload, credentials: "same-origin", signal }); }
  catch (error) { if (error.name === "AbortError") throw error; throw new ApiError("Could not reach the server. Check your internet connection and try again.", 0); }
  if (res.status === 204) return null;
  const ct = res.headers.get("content-type") || "";
  const data = ct.includes("json") ? await res.json().catch(() => null) : await res.text();
  if (!res.ok) throw new ApiError(data?.message || "Something went wrong. Please try again.", res.status, data?.field);
  return data;
}

export const money = (paise) => "₹" + (paise / 100).toLocaleString("en-IN", { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 });
export const storeGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
export const storeSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
