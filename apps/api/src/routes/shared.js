/** Small helpers shared by the admin routers. */
export const bad = (res, issue, status = 400) => res.status(status).json({ error: "INVALID", message: typeof issue === "string" ? issue : `${issue.path.join(".") || "request"}: ${issue.message}`, field: issue.path?.join(".") });
export const notFound = (res, what) => res.status(404).json({ error: "NOT_FOUND", message: `${what} not found` });
export const parse = (schema, body, res) => { const p = schema.safeParse(body); if (!p.success) { bad(res, p.error.issues[0]); return null; } return p.data; };
export const csvHeaders = (res, name) => res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"` });
export const rupees = (p) => (p == null ? "" : (p / 100).toFixed(2));
