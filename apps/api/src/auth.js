import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

export const COOKIE = "hc_session";
export const hashPassword = (pw) => bcrypt.hash(pw, 12);
export const checkPassword = (pw, hash) => bcrypt.compare(pw, hash);

const COMMON = new Set(["password", "password1", "12345678", "123456789", "qwertyuiop", "iloveyou1", "admin1234", "welcome123"]);
/** Returns an error message, or null when the password is acceptable. */
export function passwordProblem(pw, email = "") {
  if (typeof pw !== "string" || pw.length < 10) return "Password must be at least 10 characters";
  if (pw.length > 128) return "Password is too long";
  if (COMMON.has(pw.toLowerCase())) return "That password is too common";
  if (email && pw.toLowerCase().includes(email.split("@")[0].toLowerCase()) && email.split("@")[0].length > 3) return "Password must not contain your email name";
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return "Password needs letters and numbers";
  return null;
}

export function signSession(cfg, admin) {
  return jwt.sign({ sub: admin.id, role: admin.role, v: admin.tokenVersion || 0 }, cfg.jwtSecret, { algorithm: "HS256", expiresIn: `${cfg.sessionHours}h` });
}

export function setSessionCookie(cfg, res, token) {
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: "strict", secure: cfg.cookieSecure, maxAge: cfg.sessionHours * 3600_000, path: "/" });
}

/** Loads the admin from the session cookie. Mutating requests must also carry X-Requested-With (a header a cross-site form cannot set). */
export function authenticate(cfg, store) {
  return async (req, res, next) => {
    try {
      const token = req.cookies?.[COOKIE];
      if (!token) return res.status(401).json({ error: "LOGIN_REQUIRED", message: "Please sign in" });
      if (!["GET", "HEAD"].includes(req.method) && req.get("x-requested-with") !== "hc-admin") {
        return res.status(403).json({ error: "CSRF", message: "Missing request header" });
      }
      let claims;
      try { claims = jwt.verify(token, cfg.jwtSecret, { algorithms: ["HS256"] }); } catch { return res.status(401).json({ error: "LOGIN_REQUIRED", message: "Session expired. Please sign in again." }); }
      const admin = await store.admins.get(claims.sub);
      if (!admin || !admin.active || (admin.tokenVersion || 0) !== claims.v) return res.status(401).json({ error: "LOGIN_REQUIRED", message: "Session ended. Please sign in again." });
      req.admin = admin;
      next();
    } catch (e) { next(e); }
  };
}

export const requireOwner = (req, res, next) =>
  req.admin?.role === "owner" ? next() : res.status(403).json({ error: "FORBIDDEN", message: "Only the owner can do this" });
