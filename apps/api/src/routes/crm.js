import { Router } from "express";
import { toCsv } from "../csv.js";
import { requirePerm } from "../lib/permissions.js";
import { stateName } from "../lib/gst.js";
import { balance, logActivity, now } from "../lib/sales.js";
import { activityInput, customerInput, priceListInput } from "../schemas.js";
import { wrap } from "./public.js";
import { bad, csvHeaders, notFound, parse, rupees } from "./shared.js";

/** Customers (companies you sell to), the activity timeline, price lists, and the lead side of enquiries. */
export function crmRoutes({ store, audit }) {
  const r = Router();
  const fill = (d) => ({ ...d, stateCode: d.stateCode || (d.gstin ? d.gstin.slice(0, 2) : "") });

  // ---------- customers
  r.get("/customers", requirePerm("customers", "quotes", "invoices"), wrap(async (_req, res) => {
    const [cs, invoices, orders] = await Promise.all([store.customers.all({ sort: { name: 1 } }), store.invoices.all(), store.orders.all()]);
    res.json(cs.map((c) => {
      const inv = invoices.filter((i) => i.customerId === c.id && i.status !== "void");
      return { ...c, state: stateName(c.stateCode), outstanding: inv.reduce((n, i) => n + balance(i), 0), billed: inv.reduce((n, i) => n + i.totals.total, 0),
        orders: orders.filter((o) => o.customerId === c.id).length, lastOrderAt: orders.filter((o) => o.customerId === c.id).map((o) => o.createdAt).sort().at(-1) || null };
    }));
  }));
  r.get("/customers/export.csv", requirePerm("customers"), wrap(async (_req, res) => {
    const rows = (await store.customers.all({ sort: { name: 1 } })).map((c) => ({ ...c, state: stateName(c.stateCode), tags: c.tags.join("; ") }));
    csvHeaders(res, "hatikvah-customers.csv").send(toCsv(["name", "contactName", "phone", "email", "gstin", "state", "city", "billingAddress", "shippingAddress", "paymentTermsDays", "tags", "notes"], rows));
  }));
  r.get("/customers/:id", requirePerm("customers", "quotes", "invoices"), wrap(async (req, res) => {
    const c = await store.customers.get(req.params.id); if (!c) return notFound(res, "Customer");
    const mine = (rows) => rows.filter((x) => x.customerId === c.id).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const [enquiries, quotes, orders, invoices, payments, activities] = await Promise.all([store.enquiries.all(), store.quotes.all(), store.orders.all(), store.invoices.all(), store.payments.all(), store.activities.all({ sort: { at: -1 } })]);
    const inv = mine(invoices);
    res.json({ customer: { ...c, state: stateName(c.stateCode) }, enquiries: mine(enquiries), quotes: mine(quotes), orders: mine(orders), invoices: inv, payments: mine(payments),
      activities: activities.filter((a) => a.entityId === c.id || inv.some((i) => i.id === a.entityId)).slice(0, 100),
      outstanding: inv.filter((i) => i.status !== "void").reduce((n, i) => n + balance(i), 0) });
  }));
  r.post("/customers", requirePerm("customers"), wrap(async (req, res) => {
    const d = parse(customerInput, req.body, res); if (!d) return;
    const c = await store.customers.insert({ ...fill(d), createdAt: now(), updatedAt: now() });
    await audit(req, "customer.create", c.name); res.status(201).json(c);
  }));
  r.patch("/customers/:id", requirePerm("customers"), wrap(async (req, res) => {
    const d = parse(customerInput.partial().strict(), req.body, res); if (!d) return;
    const cur = await store.customers.get(req.params.id); if (!cur) return notFound(res, "Customer");
    const c = await store.customers.update(cur.id, { ...fill({ ...cur, ...d }), updatedAt: now() });
    await audit(req, "customer.update", c.name, Object.keys(d)); res.json(c);
  }));
  r.delete("/customers/:id", requirePerm("customers"), wrap(async (req, res) => {
    const c = await store.customers.get(req.params.id); if (!c) return notFound(res, "Customer");
    const used = [...(await store.quotes.all()), ...(await store.orders.all()), ...(await store.invoices.all())].some((x) => x.customerId === c.id);
    if (used) return bad(res, "This customer has quotes, orders or invoices, so it cannot be deleted", 409);
    await store.customers.remove(c.id); await audit(req, "customer.delete", c.name); res.status(204).end();
  }));

  // ---------- activity timeline (calls, notes, meetings…) on any record
  r.get("/activities", wrap(async (req, res) => {
    const id = String(req.query.entityId || "");
    res.json((await store.activities.all({ sort: { at: -1 } })).filter((a) => !id || a.entityId === id).slice(0, 200));
  }));
  r.post("/activities", wrap(async (req, res) => {
    const d = parse(activityInput, req.body, res); if (!d) return;
    const a = await logActivity(store, { ...d, by: req.admin.email });
    if (d.followUpAt !== undefined) {
      const col = d.entity === "enquiry" ? store.enquiries : d.entity === "customer" ? store.customers : null;
      if (col) await col.update(d.entityId, { followUpAt: d.followUpAt, lastActivityAt: now() });
    } else if (d.entity === "enquiry") await store.enquiries.update(d.entityId, { lastActivityAt: now() });
    res.status(201).json(a);
  }));

  // ---------- price lists (special rates for some customers)
  r.get("/price-lists", requirePerm("customers", "quotes"), wrap(async (_req, res) => res.json(await store.priceLists.all({ sort: { name: 1 } }))));
  r.post("/price-lists", requirePerm("customers"), wrap(async (req, res) => {
    const d = parse(priceListInput, req.body, res); if (!d) return;
    const pl = await store.priceLists.insert({ ...d, createdAt: now() }); await audit(req, "pricelist.create", pl.name); res.status(201).json(pl);
  }));
  r.patch("/price-lists/:id", requirePerm("customers"), wrap(async (req, res) => {
    const d = parse(priceListInput.partial().strict(), req.body, res); if (!d) return;
    const pl = await store.priceLists.update(req.params.id, d); if (!pl) return notFound(res, "Price list");
    await audit(req, "pricelist.update", pl.name); res.json(pl);
  }));
  r.delete("/price-lists/:id", requirePerm("customers"), wrap(async (req, res) => {
    const pl = await store.priceLists.get(req.params.id); if (!pl) return notFound(res, "Price list");
    if ((await store.customers.all()).some((c) => c.priceListId === pl.id)) return bad(res, "Customers still use this price list", 409);
    await store.priceLists.remove(pl.id); await audit(req, "pricelist.delete", pl.name); res.status(204).end();
  }));

  // ---------- enquiry → customer
  r.post("/enquiries/:id/convert", requirePerm("enquiries"), wrap(async (req, res) => {
    const e = await store.enquiries.get(req.params.id); if (!e) return notFound(res, "Enquiry");
    let c = e.customerId ? await store.customers.get(e.customerId) : null;
    const digits = e.phone.replace(/\D/g, "").slice(-10);
    if (!c) c = (await store.customers.all()).find((x) => x.phone && x.phone.replace(/\D/g, "").slice(-10) === digits) || null;
    if (!c) {
      c = await store.customers.insert({ name: e.company || e.name, contactName: e.name, phone: e.phone, email: e.email, gstin: "", stateCode: "", city: "", billingAddress: "", shippingAddress: "",
        priceListId: "", paymentTermsDays: 30, reorderDays: 0, tags: [], notes: "", assignedTo: e.assignedTo || "", followUpAt: "", source: e.source?.utm_source || "website", createdAt: now(), updatedAt: now() });
      await audit(req, "customer.create", c.name, { from: e.ref });
    }
    const upd = await store.enquiries.update(e.id, { customerId: c.id });
    await logActivity(store, { entity: "enquiry", entityId: e.id, text: `Linked to customer ${c.name}`, by: req.admin.email });
    res.json({ enquiry: upd, customer: c });
  }));
  return r;
}
