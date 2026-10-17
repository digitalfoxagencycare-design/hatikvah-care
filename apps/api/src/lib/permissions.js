/** What each role may open. Owners can do everything; "staff" keeps its original rights (catalogue, enquiries) plus customers and quotes. */
export const PERMISSIONS = ["catalog", "content", "enquiries", "customers", "quotes", "orders", "invoices", "stock", "reports", "automation", "settings", "team", "audit"];
export const ROLES = {
  owner: PERMISSIONS,
  manager: ["catalog", "content", "enquiries", "customers", "quotes", "orders", "invoices", "stock", "reports", "automation"],
  sales: ["catalog", "enquiries", "customers", "quotes", "orders"],
  accounts: ["customers", "quotes", "orders", "invoices", "reports"],
  warehouse: ["catalog", "orders", "stock"],
  staff: ["catalog", "enquiries", "customers", "quotes"],
};
export const ROLE_NAMES = Object.keys(ROLES);
export const can = (admin, perm) => !!admin && (ROLES[admin.role] || []).includes(perm);

/** Route guard: passes when the signed-in person has any of the given permissions. */
export const requirePerm = (...perms) => (req, res, next) =>
  perms.some((p) => can(req.admin, p)) ? next() : res.status(403).json({ error: "FORBIDDEN", message: "Your role does not allow this" });
