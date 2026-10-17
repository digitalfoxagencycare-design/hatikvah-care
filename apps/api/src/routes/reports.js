import { Router } from "express";
import { toCsv } from "../csv.js";
import { daysBetween, finYear, stateName, todayIST } from "../lib/gst.js";
import { requirePerm } from "../lib/permissions.js";
import { balance, stockLevels } from "../lib/sales.js";
import { wrap } from "./public.js";
import { csvHeaders, rupees } from "./shared.js";

const ymd = (s, d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) ? String(s) : d);
const day = (iso) => (iso ? todayIST(new Date(iso)) : "");

/** Business reports and accountant exports (GST sales register, HSN summary, payments, receivables). */
export function reportRoutes({ store }) {
  const r = Router();
  const range = (req) => { const fy = finYear(); return { from: ymd(req.query.from, `${fy.slice(0, 4)}-04-01`), to: ymd(req.query.to, todayIST()) }; };
  const inRange = (d, { from, to }) => d >= from && d <= to;

  r.get("/reports", requirePerm("reports"), wrap(async (req, res) => {
    const rg = range(req), today = todayIST();
    const [invoicesAll, payments, enquiries, quotes, orders, products, admins, customers] = await Promise.all([store.invoices.all(), store.payments.all(), store.enquiries.all(), store.quotes.all(), store.orders.all(), store.products.all(), store.admins.all(), store.customers.all()]);
    const invoices = invoicesAll.filter((i) => i.status !== "void" && inRange(i.date, rg));
    const month = {}, byCustomer = {}, byCategory = {}, byProduct = {};
    for (const i of invoices) {
      const m = (month[i.date.slice(0, 7)] ||= { month: i.date.slice(0, 7), invoiced: 0, taxable: 0, tax: 0, received: 0, count: 0 });
      m.invoiced += i.totals.total; m.taxable += i.totals.taxable; m.tax += i.totals.tax; m.count++;
      const c = (byCustomer[i.customerId] ||= { customerId: i.customerId, name: i.customer.name, taxable: 0, total: 0, invoices: 0 }); c.taxable += i.totals.taxable; c.total += i.totals.total; c.invoices++;
      for (const l of i.items) {
        const p = products.find((x) => x.id === l.productId), cat = p?.category || "other";
        (byCategory[cat] ||= { category: cat, taxable: 0 }).taxable += l.amount;
        const k = l.productId || l.name; const pr = (byProduct[k] ||= { name: l.name, sku: l.sku, qty: 0, taxable: 0 }); pr.qty += l.qty; pr.taxable += l.amount;
      }
    }
    for (const p of payments.filter((x) => inRange(x.date, rg))) (month[p.date.slice(0, 7)] ||= { month: p.date.slice(0, 7), invoiced: 0, taxable: 0, tax: 0, received: 0, count: 0 }).received += p.amount;
    const cats = await store.categories.all();
    const aging = { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 };
    for (const i of invoicesAll.filter((x) => ["unpaid", "partial"].includes(x.status))) {
      const late = daysBetween(i.dueDate, today), b = balance(i);
      aging[late <= 0 ? "current" : late <= 30 ? "d30" : late <= 60 ? "d60" : late <= 90 ? "d90" : "d90plus"] += b;
    }
    const enq = enquiries.filter((e) => inRange(day(e.createdAt), rg)), qs = quotes.filter((q) => inRange(day(q.createdAt), rg)), os = orders.filter((o) => inRange(day(o.createdAt), rg) && o.status !== "cancelled");
    const sources = {};
    for (const e of enq) { const s = e.source?.utm_source || (e.source?.referrer ? new URL(e.source.referrer, "https://x").hostname || "referral" : "direct / unknown"); sources[s] = (sources[s] || 0) + 1; }
    const staff = admins.map((a) => ({
      name: a.name, role: a.role,
      enquiries: enq.filter((e) => e.assignedTo === a.id).length, won: enq.filter((e) => e.assignedTo === a.id && e.status === "won").length,
      quotes: qs.filter((q) => q.createdBy === a.email).length, quoteValue: qs.filter((q) => q.createdBy === a.email).reduce((n, q) => n + q.totals.total, 0),
      converted: qs.filter((q) => q.createdBy === a.email && ["accepted", "converted"].includes(q.status)).reduce((n, q) => n + q.totals.total, 0),
    })).filter((s) => s.enquiries || s.quotes);
    const invoiced = invoices.reduce((n, i) => n + i.totals.total, 0);
    res.json({
      range: rg,
      totals: { invoiced, taxable: invoices.reduce((n, i) => n + i.totals.taxable, 0), tax: invoices.reduce((n, i) => n + i.totals.tax, 0), received: payments.filter((p) => inRange(p.date, rg)).reduce((n, p) => n + p.amount, 0),
        outstanding: Object.values(aging).reduce((a, b) => a + b, 0), invoices: invoices.length, avgInvoice: invoices.length ? Math.round(invoiced / invoices.length) : 0, customers: customers.length },
      months: Object.values(month).sort((a, b) => (a.month < b.month ? -1 : 1)),
      topCustomers: Object.values(byCustomer).sort((a, b) => b.total - a.total).slice(0, 15),
      categories: Object.values(byCategory).map((c) => ({ ...c, name: cats.find((x) => x.slug === c.category)?.name || "Other / custom items" })).sort((a, b) => b.taxable - a.taxable),
      topProducts: Object.values(byProduct).sort((a, b) => b.taxable - a.taxable).slice(0, 15),
      funnel: { enquiries: enq.length, quotes: qs.length, quotesSent: qs.filter((q) => q.status !== "draft").length, accepted: qs.filter((q) => ["accepted", "converted"].includes(q.status)).length, orders: os.length, invoices: invoices.length },
      aging, staff, sources: Object.entries(sources).map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count),
    });
  }));

  r.get("/reports/sales-register.csv", requirePerm("reports", "invoices"), wrap(async (req, res) => {
    const rg = range(req);
    const rows = (await store.invoices.all({ sort: { date: 1 } })).filter((i) => inRange(i.date, rg)).map((i) => ({
      invoice_no: i.number, date: i.date, status: i.status, customer: i.customer.name, gstin: i.customer.gstin, place_of_supply: `${i.placeOfSupply}-${stateName(i.placeOfSupply)}`,
      taxable: rupees(i.status === "void" ? 0 : i.totals.taxable), cgst: rupees(i.status === "void" ? 0 : i.totals.cgst), sgst: rupees(i.status === "void" ? 0 : i.totals.sgst), igst: rupees(i.status === "void" ? 0 : i.totals.igst),
      round_off: rupees(i.status === "void" ? 0 : i.totals.roundOff), total: rupees(i.status === "void" ? 0 : i.totals.total), paid: rupees(i.amountPaid || 0), order_no: i.orderNumber || "",
    }));
    csvHeaders(res, `sales-register-${rg.from}-to-${rg.to}.csv`).send(toCsv(["invoice_no", "date", "status", "customer", "gstin", "place_of_supply", "taxable", "cgst", "sgst", "igst", "round_off", "total", "paid", "order_no"], rows));
  }));
  r.get("/reports/hsn-summary.csv", requirePerm("reports", "invoices"), wrap(async (req, res) => {
    const rg = range(req), hsn = {};
    for (const i of (await store.invoices.all()).filter((x) => x.status !== "void" && inRange(x.date, rg))) for (const l of i.items) {
      const k = `${l.hsn || "-"}|${l.gstRate}`, h = (hsn[k] ||= { hsn: l.hsn || "", gst_rate: l.gstRate, uqc: l.unit, qty: 0, taxable: 0, tax: 0 });
      h.qty += l.qty; h.taxable += l.amount; h.tax += l.tax;
    }
    const rows = Object.values(hsn).map((h) => ({ ...h, taxable: rupees(h.taxable), tax: rupees(h.tax) }));
    csvHeaders(res, `hsn-summary-${rg.from}-to-${rg.to}.csv`).send(toCsv(["hsn", "gst_rate", "uqc", "qty", "taxable", "tax"], rows));
  }));
  r.get("/reports/payments.csv", requirePerm("reports", "invoices"), wrap(async (req, res) => {
    const rg = range(req);
    const rows = (await store.payments.all({ sort: { date: 1 } })).filter((p) => inRange(p.date, rg)).map((p) => ({ date: p.date, invoice_no: p.invoiceNumber, customer: p.customerName, amount: rupees(p.amount), mode: p.mode, reference: p.reference }));
    csvHeaders(res, `payments-${rg.from}-to-${rg.to}.csv`).send(toCsv(["date", "invoice_no", "customer", "amount", "mode", "reference"], rows));
  }));
  r.get("/reports/receivables.csv", requirePerm("reports", "invoices"), wrap(async (_req, res) => {
    const today = todayIST();
    const rows = (await store.invoices.all({ sort: { dueDate: 1 } })).filter((i) => ["unpaid", "partial"].includes(i.status)).map((i) => ({ invoice_no: i.number, date: i.date, due_date: i.dueDate, days_overdue: Math.max(0, daysBetween(i.dueDate, today)), customer: i.customer.name, phone: i.customer.phone, total: rupees(i.totals.total), balance: rupees(balance(i)) }));
    csvHeaders(res, "receivables.csv").send(toCsv(["invoice_no", "date", "due_date", "days_overdue", "customer", "phone", "total", "balance"], rows));
  }));
  r.get("/reports/stock.csv", requirePerm("reports", "stock"), wrap(async (_req, res) => {
    const lv = await stockLevels(store);
    const rows = (await store.products.all({ sort: { order: 1 } })).filter((p) => p.stockTracked).map((p) => ({ sku: p.sku, name: p.name, qty: lv[p.id] || 0, reorder_level: p.reorderLevel || 0, cost_price: rupees(p.costPrice ?? null), stock_value: rupees(p.costPrice != null ? Math.round((lv[p.id] || 0) * p.costPrice) : null) }));
    csvHeaders(res, "stock.csv").send(toCsv(["sku", "name", "qty", "reorder_level", "cost_price", "stock_value"], rows));
  }));
  return r;
}
