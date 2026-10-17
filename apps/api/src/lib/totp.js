import crypto from "node:crypto";

/** Time-based one-time passwords (RFC 6238, the codes Google Authenticator / Microsoft Authenticator show). */
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function newSecret() {
  const bytes = crypto.randomBytes(20); let bits = "", out = "";
  for (const b of bytes) bits += b.toString(2).padStart(8, "0");
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}
function decode(s) {
  let bits = "";
  for (const c of s.replace(/=+$/, "").toUpperCase()) { const v = B32.indexOf(c); if (v < 0) continue; bits += v.toString(2).padStart(5, "0"); }
  return Buffer.from(bits.match(/.{8}/g)?.map((b) => parseInt(b, 2)) || []);
}
export function codeAt(secret, t = Date.now()) {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(t / 30_000)));
  const h = crypto.createHmac("sha1", decode(secret)).update(counter).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
/** Accepts the current code and one step either side (clock drift). */
export const verifyCode = (secret, code, t = Date.now()) => /^\d{6}$/.test(String(code)) && [-1, 0, 1].some((w) => crypto.timingSafeEqual(Buffer.from(codeAt(secret, t + w * 30_000)), Buffer.from(String(code))));
export const otpauthUrl = (secret, email) => `otpauth://totp/${encodeURIComponent("HaTikvah Care:" + email)}?secret=${secret}&issuer=${encodeURIComponent("HaTikvah Care")}`;
