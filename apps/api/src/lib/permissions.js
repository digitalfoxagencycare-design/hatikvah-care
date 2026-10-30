/**
 * What each role may open. Owners (and "admin", the same full control) can do everything; "staff" keeps its original rights
 * (catalogue, enquiries) plus customers and quotes. The four operational roles match how the counter and warehouse work:
 * billing (quotes, orders, invoices, counter POS), warehouse (stock, receiving, dispatch), sales reps (leads, customers, draft quotes).
 */
export const PERMISSIONS = ["catalog", "content", "enquiries", "customers", "quotes", "orders", "invoices", "pos", "stock", "ledger", "reports", "automation", "settings", "team", "audit"];
export const ROLES = {
  owner: PERMISSIONS,
  admin: PERMISSIONS,
  manager: ["catalog", "content", "enquiries", "customers", "quotes", "orders", "invoices", "pos", "stock", "reports", "automation"],
  billing_executive: ["catalog", "customers", "quotes", "orders", "invoices", "pos"],
  warehouse_manager: ["catalog", "orders", "stock"],
  sales_representative: ["catalog", "enquiries", "customers", "quotes"],
  sales: ["catalog", "enquiries", "customers", "quotes", "orders"],
  accounts: ["customers", "quotes", "orders", "invoices", "pos", "ledger", "reports"],
  warehouse: ["catalog", "orders", "stock"],
  staff: ["catalog", "enquiries", "customers", "quotes"],
};
export const ROLE_NAMES = Object.keys(ROLES);
/** Roles with owner rights (team, settings, audit log, deleting enquiries). */
export const FULL_CONTROL = ["owner", "admin"];
export const isOwner = (admin) => !!admin && FULL_CONTROL.includes(admin.role);
export const can = (admin, perm) => !!admin && (ROLES[admin.role] || []).includes(perm);

/** Route guard: passes when the signed-in person has any of the given permissions. */
export const requirePerm = (...perms) => (req, res, next) =>
  perms.some((p) => can(req.admin, p)) ? next() : res.status(403).json({ error: "FORBIDDEN", message: "Your role does not allow this" });
