import { Router } from "express";
import { toCsv } from "../csv.js";
import { daysBetween, finYear, stateName, todayIST } from "../lib/gst.js";
import { requirePerm } from "../lib/permissions.js";
import { balance, stockLevels } from "../lib/sales.js";
import { parseGstr1Period } from "../lib/gstr1/period.js";
import { buildGstr1 } from "../lib/gstr1/builder.js";
import { REPORT_DIVISIONS, computeReportData } from "../lib/reports_engine.js";
import { atomicWrap } from "./atomic.js";
import { csvHeaders, rupees } from "./shared.js";

const ymd = (s, d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) ? String(s) : d);
const day = (iso) => (iso ? todayIST(new Date(iso)) : "");

/** Business reports and accountant exports (GST sales register, HSN summary, payments, receivables). */
export function reportRoutes({ store }) {
  const r = Router();
  const wrap=fn=>atomicWrap(store,fn,{readSnapshot:true});
  const range = (req) => { const fy = finYear(); return { from: ymd(req.query.from, `${fy.slice(0, 4)}-04-01`), to: ymd(req.query.to, todayIST()) }; };
  const inRange = (d, { from, to }) => d >= from && d <= to;

  r.get("/reports", requirePerm("reports"), wrap(async (req, res) => {
    const rg = range(req), today = todayIST();
    const [invoicesAll, payments, enquiries, quotes, orders, products, admins, customers] = await Promise.all([store.invoices.all(), store.payments.all(), store.enquiries.all(), store.quotes.all(), store.orders.all(), store.products.all(), store.admins.all(), store.customers.all()]);
    const invoices = invoicesAll.filter((i) => i.status !== "void" && inRange(i.date, rg));
    const credits=(await store.creditNotes.all()).filter(c=>inRange(c.date,rg));
    const creditSum=k=>credits.reduce((n,c)=>n+(c.totals[k]||0),0);
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
    for (const p of payments.filter((x) => !x.reversedAt && inRange(x.date, rg))) (month[p.date.slice(0, 7)] ||= { month: p.date.slice(0, 7), invoiced: 0, taxable: 0, tax: 0, received: 0, count: 0 }).received += p.amount;
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
    for(const c of credits){
      const m=(month[c.date.slice(0,7)] ||= {month:c.date.slice(0,7),invoiced:0,taxable:0,tax:0,received:0,count:0});m.invoiced-=c.totals.total;m.taxable-=c.totals.taxable;m.tax-=c.totals.tax;
      const customer=(byCustomer[c.customerId] ||= {customerId:c.customerId,name:c.customer.name,taxable:0,total:0,invoices:0});customer.taxable-=c.totals.taxable;customer.total-=c.totals.total;
      for(const l of c.items){const p=products.find(x=>x.id===l.productId),cat=p?.category||'other';(byCategory[cat] ||= {category:cat,taxable:0}).taxable-=l.amount;const k=l.productId||l.name,pr=(byProduct[k] ||= {name:l.name,sku:l.sku,qty:0,taxable:0});pr.taxable-=l.amount;if(c.reason!=='pricing_adjustment')pr.qty-=l.qty;}
    }
    const grossInvoiced = invoices.reduce((n,i)=>n+i.totals.total,0);
    const invoiced = grossInvoiced-creditSum('total');
    res.json({
      range: rg, basis: "Invoices less credit notes issued in the selected period; invoice register remains gross",
      totals: { invoiced, grossInvoiced, credited: creditSum("total"), taxable: invoices.reduce((n, i) => n + i.totals.taxable, 0)-creditSum("taxable"), tax: invoices.reduce((n, i) => n + i.totals.tax, 0)-creditSum("tax"), received: payments.filter((p) => !p.reversedAt && inRange(p.date, rg)).reduce((n, p) => n + p.amount, 0),
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
  // Credit notes register (GSTR-1 credit/debit notes table): one row per note, with the original invoice it amends.
  r.get("/reports/credit-notes.csv", requirePerm("reports", "invoices"), wrap(async (req, res) => {
    const rg = range(req);
    const rows = (await store.creditNotes.all({ sort: { date: 1 } })).filter((c) => inRange(c.date, rg)).map((c) => ({
      note_no: c.number, date: c.date, invoice_no: c.invoiceNumber, invoice_date: c.invoiceDate, customer: c.customer.name, gstin: c.customer.gstin, place_of_supply: `${c.placeOfSupply}-${stateName(c.placeOfSupply)}`,
      reason: c.reason, taxable: rupees(c.totals.taxable), cgst: rupees(c.totals.cgst), sgst: rupees(c.totals.sgst), igst: rupees(c.totals.igst), round_off: rupees(c.totals.roundOff), total: rupees(c.totals.total),
    }));
    csvHeaders(res, `credit-notes-${rg.from}-to-${rg.to}.csv`).send(toCsv(["note_no", "date", "invoice_no", "invoice_date", "customer", "gstin", "place_of_supply", "reason", "taxable", "cgst", "sgst", "igst", "round_off", "total"], rows));
  }));
  r.get("/reports/hsn-summary.csv", requirePerm("reports", "invoices"), wrap(async (req, res) => {
    const rg = range(req), hsn = {};
    for (const i of (await store.invoices.all()).filter((x) => x.status !== "void" && inRange(x.date, rg))) for (const l of i.items) {
      const k = `${l.hsn || "-"}|${l.gstRate}|${l.unit}|${l.uom||"piece"}|${l.perUnit||1}`, h = (hsn[k] ||= { hsn: l.hsn || "", gst_rate: l.gstRate, uqc: l.unit, qty: 0, taxable: 0, tax: 0 });
      h.qty += l.qty; h.taxable += l.amount; h.tax += l.tax;
    }
    for(const c of (await store.creditNotes.all()).filter(c=>inRange(c.date,rg)))for(const l of c.items){
      const k=`${l.hsn||'-'}|${l.gstRate}|${l.unit}|${l.uom||'piece'}|${l.perUnit||1}`,h=(hsn[k] ||= {hsn:l.hsn||'',gst_rate:l.gstRate,uqc:l.unit,qty:0,taxable:0,tax:0});
      if(c.reason!=='pricing_adjustment')h.qty-=l.qty;h.taxable-=l.amount;h.tax-=l.tax;
    }
    const rows = Object.values(hsn).map((h) => ({ ...h, taxable: rupees(h.taxable), tax: rupees(h.tax) }));
    csvHeaders(res, `hsn-summary-${rg.from}-to-${rg.to}.csv`).send(toCsv(["hsn", "gst_rate", "uqc", "qty", "taxable", "tax"], rows));
  }));
  r.get("/reports/payments.csv", requirePerm("reports", "invoices"), wrap(async (req, res) => {
    const rg = range(req);
    const rows = (await store.payments.all({ sort: { date: 1 } })).filter((p) => !p.reversedAt && inRange(p.date, rg)).map((p) => ({ date: p.date, invoice_no: p.invoiceNumber, customer: p.customerName, amount: rupees(p.amount), mode: p.mode, reference: p.reference }));
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

  // ---------- GSTR-1 Tax Hub (Official Government JSON & Preview)
  r.get("/reports/gstr-1/preview", requirePerm("reports", "invoices"), wrap(async (req, res) => {
    const period = parseGstr1Period(req.query);
    const [invoices, creditNotes, settingsList] = await Promise.all([
      store.invoices.all(),
      store.creditNotes.all(),
      store.settings.all(),
    ]);
    const { preview } = buildGstr1({ invoices, creditNotes, settings: settingsList[0] || {}, period });
    res.json(preview);
  }));

  r.get("/reports/gstr-1.json", requirePerm("reports", "invoices"), wrap(async (req, res) => {
    const period = parseGstr1Period(req.query);
    const [invoices, creditNotes, settingsList] = await Promise.all([
      store.invoices.all(),
      store.creditNotes.all(),
      store.settings.all(),
    ]);
    const { gstJson } = buildGstr1({ invoices, creditNotes, settings: settingsList[0] || {}, period });
    const filename = `gstr1_${gstJson.gstin}_${period.fp}.json`;
    res.set({
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    });
    res.send(JSON.stringify(gstJson, null, 2));
  }));

  r.get("/reports/gstr-1/b2b.csv", requirePerm("reports", "invoices"), wrap(async (req, res) => {
    const period = parseGstr1Period(req.query);
    const [invoices, creditNotes, settingsList] = await Promise.all([
      store.invoices.all(),
      store.creditNotes.all(),
      store.settings.all(),
    ]);
    const { preview } = buildGstr1({ invoices, creditNotes, settings: settingsList[0] || {}, period });
    csvHeaders(res, `gstr1-b2b-${period.fp}.csv`).send(
      toCsv(["gstin", "customerName", "invoiceNumber", "date", "value", "placeOfSupply", "itemsCount"], preview.b2b)
    );
  }));

  r.get("/reports/gstr-1/hsn.csv", requirePerm("reports", "invoices"), wrap(async (req, res) => {
    const period = parseGstr1Period(req.query);
    const [invoices, creditNotes, settingsList] = await Promise.all([
      store.invoices.all(),
      store.creditNotes.all(),
      store.settings.all(),
    ]);
    const { preview } = buildGstr1({ invoices, creditNotes, settings: settingsList[0] || {}, period });
    csvHeaders(res, `gstr1-hsn-${period.fp}.csv`).send(
      toCsv(["num", "hsn_sc", "desc", "uqc", "qty", "val", "txval", "camt", "samt", "iamt"], preview.hsn)
    );
  }));

  // ---------- Swipe 1:1 10 Divisions & 68 Report Views Engine
  r.get("/reports/divisions", requirePerm("reports"), wrap(async (_req, res) => {
    res.json(REPORT_DIVISIONS);
  }));

  r.get("/reports/query", requirePerm("reports"), wrap(async (req, res) => {
    const { division = "taxes", view = "gstr1", from = "", to = "", search = "" } = req.query;
    const result = await computeReportData({ division, view, from, to, search, store });
    res.json(result);
  }));

  r.get("/reports/query/export.csv", requirePerm("reports"), wrap(async (req, res) => {
    const { division = "taxes", view = "gstr1", from = "", to = "", search = "" } = req.query;
    const result = await computeReportData({ division, view, from, to, search, store });
    const colKeys = result.columns.map((c) => c.key);
    const colLabels = result.columns.map((c) => c.label);
    const csvRows = result.rows.map((r) => {
      const obj = {};
      colKeys.forEach((k, idx) => {
        obj[colLabels[idx]] = r[k] ?? "";
      });
      return obj;
    });
    csvHeaders(res, `report-${division}-${view}-${from || "all"}-to-${to || "now"}.csv`).send(
      toCsv(colLabels, csvRows)
    );
  }));

  // ---------- Swipe 1:1 Matrix Report Hub Endpoint (Phase 3)
  r.get("/reports/matrix", requirePerm("reports"), wrap(async (req, res) => {
    let { tab, division, view, fy = "", from = "", to = "", search = "", party = "", category = "", hub = "", includeCancelled = "false" } = req.query;

    if (fy && !from) {
      const match = String(fy).match(/(\d{2})-(\d{2})/);
      if (match) {
        from = `20${match[1]}-04-01`;
        to = `20${match[2]}-03-31`;
      }
    }

    const tabMap = {
      gstr_1: { division: "taxes", view: "gstr1" },
      gstr_2b: { division: "taxes", view: "gstr2b" },
      gstr_3b: { division: "taxes", view: "gstr3b" },
      tax_summary: { division: "taxes", view: "tax_summary" },
      hsn_summary: { division: "taxes", view: "hsn_summary" },
      transactions_sales: { division: "transactions", view: "sales_summary" },
      transactions_purchases: { division: "transactions", view: "purchase_summary" },
      transactions_sales_returns: { division: "transactions", view: "credit_notes" },
      transactions_purchase_returns: { division: "transactions", view: "debit_notes" },
      transactions_estimates: { division: "transactions", view: "quotations" },
      transactions_sales_orders: { division: "transactions", view: "challans" },
      transactions_delivery_challans: { division: "transactions", view: "challans" },
      transactions_expense: { division: "transactions", view: "expenses" },
      transactions_indirect_income: { division: "transactions", view: "indirect_income" },
      bill_profit_loss: { division: "bill_items", view: "bill_profit_loss" },
      sales_by_item: { division: "bill_items", view: "sales_by_item" },
      stock_summary: { division: "items", view: "stock_summary" },
      low_stock: { division: "items", view: "low_stock" },
      stock_value: { division: "items", view: "stock_valuation" },
      receivables_ageing: { division: "party", view: "receivables_ageing" },
      all_customers: { division: "party", view: "customer_summary" },
      all_vendors: { division: "party", view: "supplier_summary" },
      warehouse_stock_summary: { division: "warehouse", view: "hub_stock" },
      pl_statement: { division: "pl", view: "gross_profit" },
      sales_pl: { division: "pl", view: "net_profit" },
      cash_flow: { division: "payments", view: "payments_in" },
      bank_transfers: { division: "payments", view: "payments_out" },
      day_book: { division: "summary", view: "daily_sales" },
      analytics_overview: { division: "summary", view: "overview" },
      ewaybill_report: { division: "eway", view: "eway_bills" },
    };

    // Prioritize explicitly requested division and view over legacy tab parameter
    const targetDivision = division || (tab && tabMap[tab]?.division) || "taxes";
    const targetView = view || (tab && tabMap[tab]?.view) || (tab || "gstr1");

    const result = await computeReportData({ division: targetDivision, view: targetView, from, to, search, store });

    const isCancelledIncluded = includeCancelled === "true" || includeCancelled === true;
    const filterParty = String(party || "").trim().toLowerCase();

    const [invoicesAll, creditNotesAll, purchasesAll, paymentsAll] = await Promise.all([
      store.invoices.all({ sort: { date: -1 } }),
      store.creditNotes.all({ sort: { date: -1 } }),
      store.purchases.all({ sort: { createdAt: -1 } }),
      store.payments.all({ sort: { date: -1 } }),
    ]);

    const paidByInvoice = new Map();
    for (const p of paymentsAll) {
      if (p.invoiceId && !p.reversedAt) {
        paidByInvoice.set(p.invoiceId, (paidByInvoice.get(p.invoiceId) || 0) + (p.amount || 0));
      }
    }

    let qty = 0, cgst = 0, sgst = 0, igst = 0, totalTaxable = 0, totalAmount = 0, amountPaid = 0, roundOffPaise = 0;

    if (targetDivision === "purchases" || targetView === "purchase_summary" || targetView === "purchase_by_item") {
      const filteredPurchases = purchasesAll.filter((p) => {
        const d = p.date || p.createdAt?.slice(0, 10);
        if (from && d < from) return false;
        if (to && d > to) return false;
        if (filterParty && !(p.supplierName || p.supplier?.name || "").toLowerCase().includes(filterParty)) return false;
        return true;
      });
      for (const po of filteredPurchases) {
        for (const it of po.items || []) {
          qty += Number(it.qty) || 0;
          const lineTaxable = (it.rate || 0) * (Number(it.qty) || 0);
          const gstRt = it.gstRate !== undefined ? Number(it.gstRate) : 0;
          const lineTax = Math.round((lineTaxable * gstRt) / 100);
          totalTaxable += lineTaxable;
          cgst += Math.round(lineTax / 2);
          sgst += lineTax - Math.round(lineTax / 2);
          totalAmount += lineTaxable + lineTax;
        }
      }
      amountPaid = totalAmount;
    } else {
      const invoices = invoicesAll.filter((i) => {
        if (!isCancelledIncluded && (i.status === "void" || i.status === "draft")) return false;
        if (from && i.date < from) return false;
        if (to && i.date > to) return false;
        if (filterParty && !(i.customer?.name || "").toLowerCase().includes(filterParty)) return false;
        return true;
      });

      const creditNotes = creditNotesAll.filter((c) => {
        if (from && c.date < from) return false;
        if (to && c.date > to) return false;
        if (filterParty && !(c.customer?.name || "").toLowerCase().includes(filterParty)) return false;
        return true;
      });

      for (const inv of invoices) {
        for (const item of inv.items || []) {
          qty += Number(item.qty) || 0;
        }
        cgst += inv.totals?.cgst || 0;
        sgst += inv.totals?.sgst || 0;
        igst += inv.totals?.igst || 0;
        totalTaxable += inv.totals?.taxable || 0;
        totalAmount += inv.totals?.total || 0;
        roundOffPaise += inv.totals?.roundOff || inv.roundOff || 0;
        const rec = paidByInvoice.get(inv.id) ?? inv.amountPaid ?? (inv.payments || []).reduce((a, b) => a + (b.amount || 0), 0);
        amountPaid += rec;
      }

      for (const cn of creditNotes) {
        cgst -= cn.totals?.cgst || 0;
        sgst -= cn.totals?.sgst || 0;
        igst -= cn.totals?.igst || 0;
        totalTaxable -= cn.totals?.taxable || 0;
        totalAmount -= cn.totals?.total || 0;
        roundOffPaise -= cn.totals?.roundOff || cn.roundOff || 0;
      }
    }

    const netAmount = totalTaxable;
    const amountPending = Math.max(0, totalAmount - amountPaid);

    const totals = {
      qty: Math.round(qty),
      cgst: Number(((cgst || 0) / 100).toFixed(2)),
      sgst: Number(((sgst || 0) / 100).toFixed(2)),
      igst: Number(((igst || 0) / 100).toFixed(2)),
      roundOff: Number(((roundOffPaise || 0) / 100).toFixed(2)),
      netAmount: Number(((netAmount || 0) / 100).toFixed(2)),
      totalAmount: Number(((totalAmount || 0) / 100).toFixed(2)),
      amountPaid: Number(((amountPaid || 0) / 100).toFixed(2)),
      amountPending: Number(((amountPending || 0) / 100).toFixed(2)),
    };

    res.json({
      tab: tab || targetView,
      division: targetDivision,
      view: targetView,
      columns: result.columns,
      rows: result.rows,
      totals,
      subTabs: result.subTabs || [],
    });
  }));

  r.get("/reports/matrix.csv", requirePerm("reports"), wrap(async (req, res) => {
    let { tab, division, view, from = "", to = "", search = "" } = req.query;
    const tabMap = {
      gstr_1: { division: "taxes", view: "gstr1" },
      transactions_sales: { division: "transactions", view: "sales_summary" },
      transactions_purchases: { division: "transactions", view: "purchase_summary" },
      stock_summary: { division: "items", view: "stock_summary" },
    };
    const targetDivision = division || (tab && tabMap[tab]?.division) || "taxes";
    const targetView = view || (tab && tabMap[tab]?.view) || (tab || "gstr1");
    const result = await computeReportData({ division: targetDivision, view: targetView, from, to, search, store });
    const colKeys = result.columns.map((c) => c.key);
    const colLabels = result.columns.map((c) => c.label);
    const csvRows = result.rows.map((r) => {
      const obj = {};
      colKeys.forEach((k, idx) => {
        obj[colLabels[idx]] = r[k] ?? "";
      });
      return obj;
    });
    csvHeaders(res, `swipe-report-${tab}-${from || "all"}-to-${to || "now"}.csv`).send(
      toCsv(colLabels, csvRows)
    );
  }));

  return r;
}
