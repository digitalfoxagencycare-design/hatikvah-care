import { daysBetween, finYear, stateName, todayIST } from "./gst.js";
import { balance, stockLevels } from "./sales.js";

export const REPORT_DIVISIONS = [
  {
    key: "taxes",
    label: "Taxes & GST",
    icon: "🏛️",
    views: [
      { key: "gstr1", label: "GSTR-1 Outward Supplies" },
      { key: "gstr2b", label: "GSTR-2B Input Tax Credit" },
      { key: "gstr3b", label: "GSTR-3B Monthly Return" },
      { key: "tax_summary", label: "Rate-wise Tax Summary" },
      { key: "hsn_summary", label: "HSN Summary" },
      { key: "hsn_sales", label: "HSN Sales Breakdown" },
      { key: "hsn_purchase", label: "HSN Purchase Breakdown" },
      { key: "tcs_tds", label: "TCS / TDS Ledger" },
    ],
  },
  {
    key: "transactions",
    label: "Transaction Reports",
    icon: "📜",
    views: [
      { key: "sales_summary", label: "Sales Register" },
      { key: "purchase_summary", label: "Purchase Register" },
      { key: "credit_notes", label: "Credit Notes Register" },
      { key: "debit_notes", label: "Debit Notes Register" },
      { key: "quotations", label: "Quotations Summary" },
      { key: "challans", label: "Delivery Challans" },
      { key: "expenses", label: "Operating Expenses" },
      { key: "indirect_income", label: "Indirect Income" },
      { key: "day_book", label: "Day Book (Chronological)" },
    ],
  },
  {
    key: "bill_items",
    label: "Bill-wise Item Reports",
    icon: "📦",
    views: [
      { key: "bill_profit_loss", label: "Bill-wise Profit & Margin" },
      { key: "sales_by_item", label: "Sales by Product / Item" },
      { key: "purchase_by_item", label: "Purchases by Product / Item" },
      { key: "item_discount", label: "Item Discounts Given" },
      { key: "expiry_report", label: "Batches & Expiry Analysis" },
      { key: "velocity_report", label: "Fast & Slow Moving Items" },
    ],
  },
  {
    key: "items",
    label: "Item & Stock Reports",
    icon: "🏷️",
    views: [
      { key: "stock_summary", label: "Current Stock Summary" },
      { key: "low_stock", label: "Low Stock & Reorder Alert" },
      { key: "stock_valuation", label: "Stock Valuation (Sale vs Cost)" },
      { key: "negative_stock", label: "Negative Stock Check" },
    ],
  },
  {
    key: "party",
    label: "Party & Customer Reports",
    icon: "👥",
    views: [
      { key: "receivables_ageing", label: "Receivables Ageing (0-90+d)" },
      { key: "payables_ageing", label: "Payables Ageing (Vendors)" },
      { key: "customer_summary", label: "Customer-wise Sales" },
      { key: "supplier_summary", label: "Supplier-wise Purchases" },
    ],
  },
  {
    key: "warehouse",
    label: "Warehouse / Multi-Hub",
    icon: "🏭",
    views: [
      { key: "hub_stock", label: "Hub-wise Stock Distribution" },
      { key: "hub_moves", label: "Stock Movements Register" },
    ],
  },
  {
    key: "pl",
    label: "Profit & Loss (P&L)",
    icon: "📊",
    views: [
      { key: "gross_profit", label: "Gross Profit Summary" },
      { key: "net_profit", label: "Net Profit (After Expenses)" },
      { key: "category_profit", label: "Category-wise Margins" },
      { key: "customer_profit", label: "Customer-wise Profitability" },
    ],
  },
  {
    key: "payments",
    label: "Payments Hub Reports",
    icon: "💳",
    views: [
      { key: "payments_in", label: "Payments In (Collections)" },
      { key: "payments_out", label: "Payments Out (Disbursements)" },
    ],
  },
  {
    key: "summary",
    label: "Summary & Financials",
    icon: "📑",
    views: [
      { key: "daily_sales", label: "Daily Sales Register" },
      { key: "monthly_overview", label: "Monthly Revenue Overview" },
      { key: "trial_balance", label: "Trial Balance (Ledger)" },
      { key: "audit_trail", label: "Audit Trail Register" },
    ],
  },
  {
    key: "eway",
    label: "E-Way & E-Invoice",
    icon: "🚚",
    views: [
      { key: "eway_bills", label: "Government E-Way Bills Issued" },
      { key: "shipments", label: "Courier Shipments & Tracking" },
    ],
  },
];

export const isIssuedInvoice = (i) => i && i.status !== "draft" && i.status !== "void";

const toRs = (p) => Number(((p || 0) / 100).toFixed(2));
const fmtRs = (p) => (Number(((p || 0) / 100).toFixed(2))).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inRange = (d, from, to) => (!from || d >= from) && (!to || d <= to);

/**
 * Computes tabular data for any Swipe 1:1 Report View
 */
export async function computeReportData({ division = "taxes", view = "gstr1", from = "", to = "", search = "", store }) {
  const [invoicesAll, creditNotesAll, purchasesAll, productsAll, customersAll, suppliersAll, paymentsAll, ledgerAll, stockMovesAll, auditAll, settingsDoc] =
    await Promise.all([
      store.invoices.all({ sort: { date: -1 } }),
      store.creditNotes.all({ sort: { date: -1 } }),
      store.purchases.all({ sort: { createdAt: -1 } }),
      store.products.all({ sort: { name: 1 } }),
      store.customers.all({ sort: { name: 1 } }),
      store.suppliers.all({ sort: { name: 1 } }),
      store.payments.all({ sort: { date: -1 } }),
      store.ledger.all({ sort: { date: -1 } }),
      store.stockMoves.all({ sort: { createdAt: -1 } }),
      store.audit.all({ sort: { at: -1 } }),
      store.settings?.findBy?.("key", "company"),
    ]);

  const settings = settingsDoc || {};
  const sellerGstin = String(settings.gstin || "36ADDPC0083H1Z0").trim().toUpperCase();
  const sellerState = String(settings.stateCode || (sellerGstin.length >= 2 ? sellerGstin.slice(0, 2) : "36"));

  // Strictly filter out draft and void invoices across all revenue, sales, and tax reports
  const invoices = invoicesAll.filter((i) => isIssuedInvoice(i) && inRange(i.date, from, to));
  const creditNotes = creditNotesAll.filter((c) => inRange(c.date, from, to));
  const purchases = purchasesAll.filter((p) => p.status !== "void" && p.status !== "cancelled" && inRange((p.date || p.createdAt || "").slice(0, 10), from, to));
  const payments = paymentsAll.filter((p) => !p.reversedAt && inRange(p.date, from, to));
  const ledger = ledgerAll.filter((l) => inRange(l.date, from, to));

  const pMap = new Map(productsAll.map((p) => [p.id, p]));
  const cMap = new Map(customersAll.map((c) => [c.id, c]));
  const sMap = new Map(suppliersAll.map((s) => [s.id, s]));

  // 1. TAXES DIVISION
  if (division === "taxes") {
    if (view === "tax_summary") {
      const rates = {};
      for (const i of invoices) {
        const isInter = i.placeOfSupply && String(i.placeOfSupply) !== sellerState;
        for (const it of i.items || []) {
          const r = Number(it.gstRate ?? 18);
          const k = `${r}%`;
          const entry = (rates[k] ||= { rate: k, taxable: 0, cgst: 0, sgst: 0, igst: 0, totalTax: 0 });
          const amt = it.amount || 0;
          const tax = it.tax ?? Math.round((amt * r) / 100);
          entry.taxable += amt;
          entry.totalTax += tax;
          if (isInter) {
            entry.igst += tax;
          } else {
            // Guarantee cgst + sgst === tax exactly even for odd paise
            const cg = Math.floor(tax / 2);
            entry.cgst += cg;
            entry.sgst += tax - cg;
          }
        }
      }
      const rows = Object.values(rates).map((r) => ({
        col1: r.rate,
        col2: `GST Rate ${r.rate}`,
        col3: fmtRs(r.taxable),
        col4: fmtRs(r.cgst),
        col5: fmtRs(r.sgst),
        col6: fmtRs(r.igst),
        col7: fmtRs(r.totalTax),
      }));
      return {
        columns: [
          { key: "col1", label: "GST Rate Tier" },
          { key: "col2", label: "Description" },
          { key: "col3", label: "Taxable Value (₹)", align: "right" },
          { key: "col4", label: "CGST (₹)", align: "right" },
          { key: "col5", label: "SGST (₹)", align: "right" },
          { key: "col6", label: "IGST (₹)", align: "right" },
          { key: "col7", label: "Total Tax (₹)", align: "right" },
        ],
        rows,
        totals: {
          taxable: fmtRs(Object.values(rates).reduce((a, b) => a + b.taxable, 0)),
          tax: fmtRs(Object.values(rates).reduce((a, b) => a + b.totalTax, 0)),
        },
      };
    }

    if (view === "gstr1") {
      let b2bCount = 0, b2bTaxable = 0, b2bTax = 0;
      let b2clCount = 0, b2clTaxable = 0, b2clTax = 0;
      let b2csCount = 0, b2csTaxable = 0, b2csTax = 0;

      for (const inv of invoices) {
        const custGstin = (inv.customer?.gstin || "").trim().toUpperCase();
        const isB2B = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(custGstin);
        const pos = String(inv.placeOfSupply || inv.customer?.stateCode || sellerState);
        const isInter = pos !== sellerState;
        const taxable = inv.totals?.taxable || 0;
        const tax = inv.totals?.tax || 0;

        if (isB2B) {
          b2bCount++;
          b2bTaxable += taxable;
          b2bTax += tax;
        } else if (isInter && (inv.totals?.total || 0) > 10000000) {
          // B2CL: Inter-state unregistered > ₹1.0 Lakh (GST Notification 04/2024)
          b2clCount++;
          b2clTaxable += taxable;
          b2clTax += tax;
        } else {
          b2csCount++;
          b2csTaxable += taxable;
          b2csTax += tax;
        }
      }

      const rows = [
        { col1: "Table 4A, 4B, 6B", col2: "B2B Invoices (Registered Recipients)", col3: b2bCount, col4: fmtRs(b2bTaxable), col5: fmtRs(b2bTax), col6: fmtRs(b2bTaxable + b2bTax) },
        { col1: "Table 5A, 5B", col2: "B2CL (Large Interstate Unregistered > ₹1L)", col3: b2clCount, col4: fmtRs(b2clTaxable), col5: fmtRs(b2clTax), col6: fmtRs(b2clTaxable + b2clTax) },
        { col1: "Table 7", col2: "B2CS (Other Retail / Unregistered Supplies)", col3: b2csCount, col4: fmtRs(b2csTaxable), col5: fmtRs(b2csTax), col6: fmtRs(b2csTaxable + b2csTax) },
        { col1: "Table 9B", col2: "Credit / Debit Notes Registered & Unregistered", col3: creditNotes.length, col4: fmtRs(creditNotes.reduce((a, b) => a + (b.amount || 0), 0)), col5: "0.00", col6: fmtRs(creditNotes.reduce((a, b) => a + (b.amount || 0), 0)) },
      ];

      return {
        columns: [
          { key: "col1", label: "GSTR-1 Section" },
          { key: "col2", label: "Description of Outward Supplies" },
          { key: "col3", label: "Invoice Count", align: "right" },
          { key: "col4", label: "Taxable Value (₹)", align: "right" },
          { key: "col5", label: "Tax Amount (₹)", align: "right" },
          { key: "col6", label: "Total Invoice Value (₹)", align: "right" },
        ],
        rows,
        totals: {
          count: invoices.length,
          taxable: fmtRs(b2bTaxable + b2clTaxable + b2csTaxable),
          tax: fmtRs(b2bTax + b2clTax + b2csTax),
        },
      };
    }

    if (view === "gstr3b") {
      const outwardTaxable = invoices.reduce((a, b) => a + (b.totals?.taxable || 0), 0);
      const outwardTax = invoices.reduce((a, b) => a + (b.totals?.tax || 0), 0);
      const outwardIgst = invoices.reduce((a, b) => a + (b.totals?.igst || 0), 0);
      const outwardCgst = invoices.reduce((a, b) => a + (b.totals?.cgst || 0), 0);
      const outwardSgst = invoices.reduce((a, b) => a + (b.totals?.sgst || 0), 0);

      const inwardTaxable = purchases.reduce((a, b) => a + (b.totals?.taxable || b.total || 0), 0);
      const inwardItc = purchases.reduce((a, b) => a + (b.totals?.tax || Math.round((b.total || 0) * 0.18)), 0);

      const rows = [
        { col1: "3.1 (a)", col2: "Outward taxable supplies (other than zero-rated, nil and exempted)", col3: fmtRs(outwardTaxable), col4: fmtRs(outwardIgst), col5: fmtRs(outwardCgst), col6: fmtRs(outwardSgst) },
        { col1: "3.1 (b)", col2: "Outward taxable supplies (zero-rated)", col3: "0.00", col4: "0.00", col5: "0.00", col6: "0.00" },
        { col1: "3.1 (c)", col2: "Other outward supplies (Nil rated, exempted)", col3: "0.00", col4: "0.00", col5: "0.00", col6: "0.00" },
        { col1: "4(A)(5)", col2: "Eligible Input Tax Credit (ITC on Purchases)", col3: fmtRs(inwardTaxable), col4: fmtRs(inwardItc), col5: "0.00", col6: "0.00" },
      ];

      return {
        columns: [
          { key: "col1", label: "GSTR-3B Table" },
          { key: "col2", label: "Nature of Supplies" },
          { key: "col3", label: "Total Taxable (₹)", align: "right" },
          { key: "col4", label: "Integrated Tax (₹)", align: "right" },
          { key: "col5", label: "Central Tax (₹)", align: "right" },
          { key: "col6", label: "State Tax (₹)", align: "right" },
        ],
        rows,
        totals: {
          taxable: fmtRs(outwardTaxable),
          tax: fmtRs(outwardTax),
        },
      };
    }

    if (view === "gstr2b" || view === "hsn_purchase") {
      const rows = purchases.map((p) => {
        const sup = sMap.get(p.supplierId) || p.supplier || {};
        const taxable = p.totals?.taxable || p.total || 0;
        const tax = p.totals?.tax || Math.round(taxable * 0.18);
        return {
          col1: p.number,
          col2: (p.date || p.createdAt || "").slice(0, 10),
          col3: sup.name || p.supplierName || "Supplier",
          col4: sup.gstin || "URP",
          col5: fmtRs(taxable),
          col6: fmtRs(tax),
          col7: fmtRs(taxable + tax),
          status: p.status || "active",
        };
      });
      return {
        columns: [
          { key: "col1", label: "Bill / PO Number" },
          { key: "col2", label: "Date" },
          { key: "col3", label: "Supplier Name" },
          { key: "col4", label: "Supplier GSTIN" },
          { key: "col5", label: "Taxable Value (₹)", align: "right" },
          { key: "col6", label: "Reconciled ITC (₹)", align: "right" },
          { key: "col7", label: "Total Bill (₹)", align: "right" },
        ],
        rows,
        totals: {
          count: rows.length,
          taxable: fmtRs(purchases.reduce((a, b) => a + (b.totals?.taxable || b.total || 0), 0)),
          itc: fmtRs(purchases.reduce((a, b) => a + (b.totals?.tax || Math.round((b.total || 0) * 0.18)), 0)),
        },
      };
    }

    // Default HSN Summary
    const hsnMap = {};
    for (const i of invoices) {
      for (const it of i.items || []) {
        const h = String(it.hsn || "96032100");
        const entry = (hsnMap[h] ||= { hsn: h, name: it.name, uom: it.unit || "NOS", qty: 0, taxable: 0, tax: 0 });
        entry.qty += it.qty || 1;
        entry.taxable += it.amount || 0;
        entry.tax += it.tax || Math.round(((it.amount || 0) * (it.gstRate || 18)) / 100);
      }
    }
    const rows = Object.values(hsnMap).map((h) => ({
      col1: h.hsn,
      col2: h.name,
      col3: `${h.qty.toLocaleString("en-IN")} ${h.uom}`,
      col4: fmtRs(h.taxable),
      col5: fmtRs(h.tax),
      col6: fmtRs(h.taxable + h.tax),
    }));
    return {
      columns: [
        { key: "col1", label: "HSN / SAC Code" },
        { key: "col2", label: "Product Description" },
        { key: "col3", label: "Quantity Sold", align: "right" },
        { key: "col4", label: "Taxable Value (₹)", align: "right" },
        { key: "col5", label: "Total Tax (₹)", align: "right" },
        { key: "col6", label: "Total Value (₹)", align: "right" },
      ],
      rows,
      totals: {
        count: rows.length,
        taxable: fmtRs(Object.values(hsnMap).reduce((a, b) => a + b.taxable, 0)),
        tax: fmtRs(Object.values(hsnMap).reduce((a, b) => a + b.tax, 0)),
      },
    };
  }

  // 2. TRANSACTION REPORTS
  if (division === "transactions") {
    if (view === "purchase_summary") {
      const rows = purchases.map((p) => {
        const sName = p.supplierName || sMap.get(p.supplierId)?.name || "Vendor";
        const tot = p.totals?.total || p.total || 0;
        return {
          col1: p.number,
          col2: (p.date || p.createdAt || "").slice(0, 10),
          col3: sName,
          col4: p.supplierInvoiceNumber || "-",
          col5: fmtRs(tot),
          col6: p.status === "received" ? "Stock In ✓" : p.status,
          status: p.status,
        };
      });
      return {
        columns: [
          { key: "col1", label: "PO / Bill Number" },
          { key: "col2", label: "Date" },
          { key: "col3", label: "Supplier / Vendor" },
          { key: "col4", label: "Supplier Invoice Ref" },
          { key: "col5", label: "Total Amount (₹)", align: "right" },
          { key: "col6", label: "Status" },
        ],
        rows,
        totals: { count: rows.length, total: fmtRs(purchases.reduce((a, b) => a + (b.totals?.total || b.total || 0), 0)) },
      };
    }

    if (view === "credit_notes") {
      const rows = creditNotes.map((c) => ({
        col1: c.number,
        col2: c.date,
        col3: c.customer?.name || "Customer",
        col4: c.invoiceNumber || "-",
        col5: c.reason || "Return",
        col6: fmtRs(c.totals?.total || 0),
        status: "issued",
      }));
      return {
        columns: [
          { key: "col1", label: "Credit Note No" },
          { key: "col2", label: "Date" },
          { key: "col3", label: "Customer" },
          { key: "col4", label: "Against Invoice" },
          { key: "col5", label: "Reason" },
          { key: "col6", label: "Credited Value (₹)", align: "right" },
        ],
        rows,
        totals: { count: rows.length, total: fmtRs(creditNotes.reduce((a, b) => a + (b.totals?.total || 0), 0)) },
      };
    }

    if (view === "expenses" || view === "indirect_income") {
      const isIncome = view === "indirect_income";
      const targetAcc = isIncome ? "indirect_income" : "operating_expense";
      const rows = ledger
        .filter((l) => l.account === targetAcc || l.contraAccount === targetAcc || (isIncome ? l.kind === "receipt" : l.kind === "payment"))
        .map((l) => ({
          col1: l.ref || (isIncome ? "INC" : "EXP"),
          col2: l.date,
          col3: l.category || "General",
          col4: l.party || "-",
          col5: (l.account === targetAcc ? l.contraAccount : l.account) || "Bank",
          col6: fmtRs(l.amount),
          col7: l.narration || "-",
        }));
      return {
        columns: [
          { key: "col1", label: "Ref / Voucher" },
          { key: "col2", label: "Date" },
          { key: "col3", label: "Category" },
          { key: "col4", label: isIncome ? "Payer" : "Payee" },
          { key: "col5", label: "Account / Mode" },
          { key: "col6", label: "Amount (₹)", align: "right" },
          { key: "col7", label: "Narration" },
        ],
        rows,
        totals: { count: rows.length, total: fmtRs(rows.reduce((a, b) => a + (Number(b.col6.replace(/,/g, "")) * 100), 0)) },
      };
    }

    // Default: Sales Register
    const rows = invoices.map((i) => {
      const bal = balance(i);
      return {
        col1: i.number,
        col2: i.date,
        col3: i.customer?.name || "Walk-in Buyer",
        col4: `${i.placeOfSupply || "36"}-${stateName(i.placeOfSupply || "36")}`,
        col5: fmtRs(i.totals?.taxable || 0),
        col6: fmtRs(i.totals?.tax || 0),
        col7: fmtRs(i.totals?.total || 0),
        col8: fmtRs(bal),
        status: i.status,
      };
    });
    return {
      columns: [
        { key: "col1", label: "Invoice Number" },
        { key: "col2", label: "Date" },
        { key: "col3", label: "Customer Name" },
        { key: "col4", label: "Place of Supply" },
        { key: "col5", label: "Taxable (₹)", align: "right" },
        { key: "col6", label: "Tax (₹)", align: "right" },
        { key: "col7", label: "Invoice Total (₹)", align: "right" },
        { key: "col8", label: "Pending Due (₹)", align: "right" },
      ],
      rows,
      totals: {
        count: rows.length,
        total: fmtRs(invoices.reduce((a, b) => a + (b.totals?.total || 0), 0)),
        pending: fmtRs(invoices.reduce((a, b) => a + balance(b), 0)),
      },
    };
  }

  // 3. BILL-WISE ITEM REPORTS
  if (division === "bill_items") {
    if (view === "bill_profit_loss") {
      const rows = invoices.map((i) => {
        let rev = i.totals?.taxable || 0;
        let cogs = 0;
        let hasEstimatedCost = false;
        for (const it of i.items || []) {
          const p = pMap.get(it.productId);
          const cost = p?.costPrice ?? p?.purchasePrice;
          if (cost == null) hasEstimatedCost = true;
          cogs += (cost ?? 0) * (it.qty || 1);
        }
        const profit = rev - cogs;
        const marginPct = rev > 0 ? ((profit / rev) * 100).toFixed(1) + "%" : "0.0%";
        return {
          col1: i.number,
          col2: i.date,
          col3: i.customer?.name || "Customer",
          col4: fmtRs(rev),
          col5: fmtRs(cogs) + (hasEstimatedCost ? " *" : ""),
          col6: fmtRs(profit),
          col7: marginPct,
          status: profit >= 0 ? "profit" : "loss",
        };
      });
      const totRev = invoices.reduce((a, b) => a + (b.totals?.taxable || 0), 0);
      let totCogs = 0;
      for (const i of invoices) {
        for (const it of i.items || []) {
          const p = pMap.get(it.productId);
          totCogs += (p?.costPrice ?? p?.purchasePrice ?? 0) * (it.qty || 1);
        }
      }
      const totProfit = totRev - totCogs;
      const avgMargin = totRev > 0 ? ((totProfit / totRev) * 100).toFixed(1) + "%" : "0%";
      return {
        columns: [
          { key: "col1", label: "Invoice No" },
          { key: "col2", label: "Date" },
          { key: "col3", label: "Customer Name" },
          { key: "col4", label: "Revenue (₹)", align: "right" },
          { key: "col5", label: "COGS (₹)", align: "right" },
          { key: "col6", label: "Gross Profit (₹)", align: "right" },
          { key: "col7", label: "Margin %", align: "right" },
        ],
        rows,
        totals: {
          revenue: fmtRs(totRev),
          cogs: fmtRs(totCogs),
          profit: fmtRs(totProfit),
          margin: avgMargin,
        },
      };
    }

    if (view === "sales_by_item" || view === "velocity_report") {
      const itemAgg = {};
      for (const i of invoices) {
        for (const it of i.items || []) {
          const k = it.productId || it.name;
          const entry = (itemAgg[k] ||= { name: it.name, sku: it.sku || "-", qty: 0, revenue: 0, orders: 0 });
          entry.qty += it.qty || 1;
          entry.revenue += it.amount || 0;
          entry.orders++;
        }
      }
      const sorted = Object.values(itemAgg).sort((a, b) => b.revenue - a.revenue);
      const rows = sorted.map((it, idx) => ({
        col1: it.name,
        col2: it.sku,
        col3: it.qty.toLocaleString("en-IN"),
        col4: it.orders,
        col5: fmtRs(it.revenue),
        col6: fmtRs(it.qty > 0 ? Math.round(it.revenue / it.qty) : 0),
        status: idx < 5 ? "Fast Moving ⚡" : "Normal",
      }));
      return {
        columns: [
          { key: "col1", label: "Product Name" },
          { key: "col2", label: "SKU" },
          { key: "col3", label: "Units Sold", align: "right" },
          { key: "col4", label: "Bills Count", align: "right" },
          { key: "col5", label: "Total Revenue (₹)", align: "right" },
          { key: "col6", label: "Avg Selling Rate (₹)", align: "right" },
        ],
        rows,
        totals: { count: rows.length, total: fmtRs(sorted.reduce((a, b) => a + b.revenue, 0)) },
      };
    }

    // Expiry Report
    const batchRows = stockMovesAll
      .filter((m) => m.batch && m.batch.batchNumber)
      .map((m) => {
        const p = pMap.get(m.productId);
        const exp = m.batch.expDate || "2027-12-31";
        const daysLeft = daysBetween(todayIST(), exp);
        return {
          col1: p?.name || "Product",
          col2: m.batch.batchNumber,
          col3: m.batch.mfgDate || "-",
          col4: exp,
          col5: daysLeft <= 0 ? "Expired" : `${daysLeft} days`,
          col6: `${m.qty} pcs`,
          status: daysLeft <= 0 ? "expired" : daysLeft < 60 ? "near_expiry" : "good",
        };
      });
    return {
      columns: [
        { key: "col1", label: "Product Name" },
        { key: "col2", label: "Batch Number" },
        { key: "col3", label: "Mfg Date" },
        { key: "col4", label: "Expiry Date" },
        { key: "col5", label: "Shelf Life Remaining" },
        { key: "col6", label: "Quantity", align: "right" },
      ],
      rows: batchRows,
      totals: { count: batchRows.length },
    };
  }

  // 4. ITEM & STOCK REPORTS
  if (division === "items") {
    const lv = await stockLevels(store);
    let filtered = productsAll.filter((p) => p.stockTracked);
    if (view === "low_stock") {
      filtered = filtered.filter((p) => (lv[p.id] || 0) <= (p.reorderLevel || 10));
    }
    const rows = filtered.map((p) => {
      const q = lv[p.id] || 0;
      const cost = p.costPrice ?? p.purchasePrice ?? 0;
      const price = p.price ?? 0;
      return {
        col1: p.name,
        col2: p.sku || "-",
        col3: p.category || "General",
        col4: q.toLocaleString("en-IN"),
        col5: (p.reorderLevel || 10).toLocaleString("en-IN"),
        col6: fmtRs(cost),
        col7: fmtRs(price),
        col8: fmtRs(q * cost),
        status: q <= 0 ? "out_of_stock" : q <= (p.reorderLevel || 10) ? "low" : "available",
      };
    });
    return {
      columns: [
        { key: "col1", label: "Product Name" },
        { key: "col2", label: "SKU" },
        { key: "col3", label: "Category" },
        { key: "col4", label: "Available Qty", align: "right" },
        { key: "col5", label: "Reorder Alert", align: "right" },
        { key: "col6", label: "Cost Price (₹)", align: "right" },
        { key: "col7", label: "Sale Price (₹)", align: "right" },
        { key: "col8", label: "Stock Value @ Cost (₹)", align: "right" },
      ],
      rows,
      totals: {
        count: rows.length,
        stockValue: fmtRs(filtered.reduce((a, p) => a + (lv[p.id] || 0) * (p.costPrice || 0), 0)),
      },
    };
  }

  // 5. PARTY & AGEING REPORTS
  if (division === "party") {
    if (view === "receivables_ageing") {
      const today = todayIST();
      const customerAging = {};
      for (const i of invoicesAll.filter((x) => ["unpaid", "partial"].includes(x.status))) {
        const cId = i.customerId;
        const cName = i.customer?.name || "Customer";
        const late = daysBetween(i.dueDate || i.date, today);
        const bal = balance(i);
        const entry = (customerAging[cId] ||= { name: cName, phone: i.customer?.phone || "-", current: 0, d30: 0, d60: 0, d90: 0, dOver90: 0, total: 0 });
        entry.total += bal;
        if (late <= 0) entry.current += bal;
        else if (late <= 30) entry.d30 += bal;
        else if (late <= 60) entry.d60 += bal;
        else if (late <= 90) entry.d90 += bal;
        else entry.dOver90 += bal;
      }
      const rows = Object.values(customerAging).map((c) => ({
        col1: c.name,
        col2: c.phone,
        col3: fmtRs(c.current),
        col4: fmtRs(c.d30),
        col5: fmtRs(c.d60),
        col6: fmtRs(c.d90),
        col7: fmtRs(c.dOver90),
        col8: fmtRs(c.total),
      }));
      return {
        columns: [
          { key: "col1", label: "Customer Name" },
          { key: "col2", label: "Phone" },
          { key: "col3", label: "Not Overdue (₹)", align: "right" },
          { key: "col4", label: "1-30 Days (₹)", align: "right" },
          { key: "col5", label: "31-60 Days (₹)", align: "right" },
          { key: "col6", label: "61-90 Days (₹)", align: "right" },
          { key: "col7", label: "90+ Days (₹)", align: "right" },
          { key: "col8", label: "Total Outstanding (₹)", align: "right" },
        ],
        rows,
        totals: {
          count: rows.length,
          total: fmtRs(Object.values(customerAging).reduce((a, b) => a + b.total, 0)),
        },
      };
    }

    // Customer-wise sales summary
    const cSales = {};
    for (const i of invoices) {
      const cId = i.customerId;
      const cName = i.customer?.name || "Customer";
      const entry = (cSales[cId] ||= { name: cName, gstin: i.customer?.gstin || "URP", invoices: 0, total: 0, paid: 0 });
      entry.invoices++;
      entry.total += i.totals?.total || 0;
      entry.paid += i.amountPaid || 0;
    }
    const rows = Object.values(cSales).map((c) => ({
      col1: c.name,
      col2: c.gstin,
      col3: c.invoices,
      col4: fmtRs(c.total),
      col5: fmtRs(c.paid),
      col6: fmtRs(c.total - c.paid),
    }));
    return {
      columns: [
        { key: "col1", label: "Customer Name" },
        { key: "col2", label: "GSTIN" },
        { key: "col3", label: "Invoices Count", align: "right" },
        { key: "col4", label: "Total Invoiced (₹)", align: "right" },
        { key: "col5", label: "Total Collected (₹)", align: "right" },
        { key: "col6", label: "Balance Due (₹)", align: "right" },
      ],
      rows,
      totals: { count: rows.length, total: fmtRs(Object.values(cSales).reduce((a, b) => a + b.total, 0)) },
    };
  }

  // 7. PROFIT & LOSS (P&L)
  if (division === "pl") {
    const totRev = invoices.reduce((a, b) => a + (b.totals?.taxable || 0), 0);
    let totCogs = 0;
    for (const i of invoices) {
      for (const it of i.items || []) {
        const p = pMap.get(it.productId);
        totCogs += (p?.costPrice ?? p?.purchasePrice ?? 0) * (it.qty || 1);
      }
    }
    const grossProfit = totRev - totCogs;

    // Calculate actual operating expenses from ledger
    const opExpenses = ledger
      .filter((l) => l.account === "operating_expenses" || (l.kind === "payment" && l.account !== "accounts_payable"))
      .reduce((a, b) => a + (b.amount || 0), 0);

    const indirectIncome = ledger
      .filter((l) => l.account === "indirect_income")
      .reduce((a, b) => a + (b.amount || 0), 0);

    const netProfit = grossProfit - opExpenses + indirectIncome;

    if (view === "net_profit") {
      const rows = [
        { col1: "1. Revenue from Operations", col2: "Invoiced Taxable Sales (Drafts Excluded)", col3: fmtRs(totRev), status: "income" },
        { col1: "2. Cost of Goods Sold (COGS)", col2: "Product Purchase / Cost Basis", col3: fmtRs(totCogs), status: "expense" },
        { col1: "3. Gross Operating Profit", col2: "Revenue − Cost of Goods Sold", col3: fmtRs(grossProfit), status: grossProfit >= 0 ? "profit" : "loss" },
        { col1: "4. Operating & Administrative Expenses", col2: "Rent, Electricity, Logistics, Packaging", col3: fmtRs(opExpenses), status: "expense" },
        { col1: "5. Other / Indirect Income", col2: "Interest, Discounts Received, Scrap Sales", col3: fmtRs(indirectIncome), status: "income" },
        { col1: "6. Net Profit / (Loss) for Period", col2: "Gross Profit − Operating Expenses + Indirect Income", col3: fmtRs(netProfit), status: netProfit >= 0 ? "profit" : "loss" },
      ];
      return {
        columns: [
          { key: "col1", label: "P&L Line Item" },
          { key: "col2", label: "Particulars / Basis" },
          { key: "col3", label: "Amount (₹)", align: "right" },
        ],
        rows,
        totals: {
          revenue: fmtRs(totRev),
          cogs: fmtRs(totCogs),
          profit: fmtRs(netProfit),
          margin: totRev > 0 ? ((netProfit / totRev) * 100).toFixed(1) + "%" : "0.0%",
        },
      };
    }

    if (view === "category_profit") {
      const catMap = {};
      for (const i of invoices) {
        for (const it of i.items || []) {
          const p = pMap.get(it.productId);
          const cat = p?.category || "General";
          const e = (catMap[cat] ||= { category: cat, revenue: 0, cogs: 0, qty: 0 });
          const rev = it.amount || 0;
          const cost = (p?.costPrice ?? p?.purchasePrice ?? 0) * (it.qty || 1);
          e.revenue += rev;
          e.cogs += cost;
          e.qty += it.qty || 1;
        }
      }
      const rows = Object.values(catMap).map((c) => {
        const profit = c.revenue - c.cogs;
        const marginPct = c.revenue > 0 ? ((profit / c.revenue) * 100).toFixed(1) + "%" : "0.0%";
        return {
          col1: c.category,
          col2: c.qty.toLocaleString("en-IN"),
          col3: fmtRs(c.revenue),
          col4: fmtRs(c.cogs),
          col5: fmtRs(profit),
          col6: marginPct,
          status: profit >= 0 ? "profit" : "loss",
        };
      });
      return {
        columns: [
          { key: "col1", label: "Product Category" },
          { key: "col2", label: "Units Sold", align: "right" },
          { key: "col3", label: "Revenue (₹)", align: "right" },
          { key: "col4", label: "COGS (₹)", align: "right" },
          { key: "col5", label: "Gross Margin (₹)", align: "right" },
          { key: "col6", label: "Margin %", align: "right" },
        ],
        rows,
        totals: {
          revenue: fmtRs(totRev),
          cogs: fmtRs(totCogs),
          profit: fmtRs(grossProfit),
          margin: totRev > 0 ? ((grossProfit / totRev) * 100).toFixed(1) + "%" : "0.0%",
        },
      };
    }

    // Default / gross_profit
    const rows = invoices.map((i) => {
      let rev = i.totals?.taxable || 0;
      let cogs = 0;
      for (const it of i.items || []) {
        const p = pMap.get(it.productId);
        cogs += (p?.costPrice ?? p?.purchasePrice ?? 0) * (it.qty || 1);
      }
      const profit = rev - cogs;
      const marginPct = rev > 0 ? ((profit / rev) * 100).toFixed(1) + "%" : "0.0%";
      return {
        col1: i.number,
        col2: i.date,
        col3: i.customer?.name || "Customer",
        col4: fmtRs(rev),
        col5: fmtRs(cogs),
        col6: fmtRs(profit),
        col7: marginPct,
        status: profit >= 0 ? "profit" : "loss",
      };
    });
    return {
      columns: [
        { key: "col1", label: "Invoice No" },
        { key: "col2", label: "Date" },
        { key: "col3", label: "Customer Name" },
        { key: "col4", label: "Revenue (₹)", align: "right" },
        { key: "col5", label: "COGS (₹)", align: "right" },
        { key: "col6", label: "Gross Profit (₹)", align: "right" },
        { key: "col7", label: "Margin %", align: "right" },
      ],
      rows,
      totals: {
        revenue: fmtRs(totRev),
        cogs: fmtRs(totCogs),
        profit: fmtRs(grossProfit),
        margin: totRev > 0 ? ((grossProfit / totRev) * 100).toFixed(1) + "%" : "0.0%",
      },
    };
  }

  // 8. PAYMENTS HUB
  if (division === "payments") {
    const isOut = view === "payments_out";
    if (isOut) {
      const rows = ledger
        .filter((l) => l.kind === "payment")
        .map((l) => ({
          col1: l.ref || "PAY",
          col2: l.date,
          col3: l.party || "Vendor",
          col4: l.account || "Bank",
          col5: fmtRs(l.amount),
          col6: l.narration || "-",
        }));
      return {
        columns: [
          { key: "col1", label: "Payment Ref" },
          { key: "col2", label: "Date" },
          { key: "col3", label: "Paid To (Payee)" },
          { key: "col4", label: "Mode / Account" },
          { key: "col5", label: "Disbursed Amount (₹)", align: "right" },
          { key: "col6", label: "Notes" },
        ],
        rows,
        totals: { count: rows.length, total: fmtRs(rows.reduce((a, b) => a + (Number(b.col5.replace(/,/g, "")) * 100), 0)) },
      };
    }
    const rows = payments.map((p) => ({
      col1: p.reference || p.external || "REC",
      col2: p.date,
      col3: p.customerName || "Customer",
      col4: p.invoiceNumber || "-",
      col5: (p.mode || "bank").toUpperCase(),
      col6: fmtRs(p.amount),
      status: "received",
    }));
    return {
      columns: [
        { key: "col1", label: "Transaction Ref" },
        { key: "col2", label: "Receipt Date" },
        { key: "col3", label: "Received From" },
        { key: "col4", label: "Against Invoice" },
        { key: "col5", label: "Payment Mode" },
        { key: "col6", label: "Collected Amount (₹)", align: "right" },
      ],
      rows,
      totals: { count: rows.length, total: fmtRs(payments.reduce((a, b) => a + b.amount, 0)) },
    };
  }

  // 9. SUMMARY & FINANCIALS
  if (division === "summary") {
    if (view === "trial_balance") {
      const accTotals = {};
      const ledgerFiltered = ledgerAll.filter((l) => inRange(l.date, from, to));
      for (const l of ledgerFiltered) {
        if (l.lines) {
          for (const line of l.lines) {
            const acc = line.account || "general";
            const e = (accTotals[acc] ||= { account: acc, debit: 0, credit: 0 });
            e.debit += line.debit || 0;
            e.credit += line.credit || 0;
          }
        } else {
          const acc = l.account || "bank";
          const e = (accTotals[acc] ||= { account: acc, debit: 0, credit: 0 });
          if (l.kind === "receipt") e.debit += l.amount;
          else e.credit += l.amount;
        }
      }
      const rows = Object.values(accTotals).map((a) => ({
        col1: a.account.replace(/_/g, " ").toUpperCase(),
        col2: fmtRs(a.debit),
        col3: fmtRs(a.credit),
        col4: fmtRs(Math.abs(a.debit - a.credit)),
      }));
      return {
        columns: [
          { key: "col1", label: "Account Name" },
          { key: "col2", label: "Total Debit (₹)", align: "right" },
          { key: "col3", label: "Total Credit (₹)", align: "right" },
          { key: "col4", label: "Net Balance (₹)", align: "right" },
        ],
        rows,
        totals: {
          count: rows.length,
          debit: fmtRs(Object.values(accTotals).reduce((a, b) => a + b.debit, 0)),
          credit: fmtRs(Object.values(accTotals).reduce((a, b) => a + b.credit, 0)),
        },
      };
    }

    // Daily Sales
    const days = {};
    for (const i of invoices) {
      const d = i.date;
      const entry = (days[d] ||= { date: d, count: 0, taxable: 0, tax: 0, total: 0 });
      entry.count++;
      entry.taxable += i.totals?.taxable || 0;
      entry.tax += i.totals?.tax || 0;
      entry.total += i.totals?.total || 0;
    }
    const rows = Object.values(days).sort((a, b) => (a.date < b.date ? 1 : -1)).map((d) => ({
      col1: d.date,
      col2: d.count,
      col3: fmtRs(d.taxable),
      col4: fmtRs(d.tax),
      col5: fmtRs(d.total),
    }));
    return {
      columns: [
        { key: "col1", label: "Date" },
        { key: "col2", label: "Invoices Count", align: "right" },
        { key: "col3", label: "Taxable (₹)", align: "right" },
        { key: "col4", label: "Tax (₹)", align: "right" },
        { key: "col5", label: "Day's Total Sales (₹)", align: "right" },
      ],
      rows,
      totals: { count: rows.length, total: fmtRs(Object.values(days).reduce((a, b) => a + b.total, 0)) },
    };
  }

  // 10. E-WAY & E-INVOICE
  const ewbInvoices = invoicesAll.filter((i) => i.ewaybill?.ewbNo);
  const rows = ewbInvoices.map((i) => ({
    col1: i.ewaybill?.ewbNo,
    col2: i.number,
    col3: i.date,
    col4: i.customer?.name || "Customer",
    col5: i.ewaybill?.vehicleNo || "-",
    col6: i.ewaybill?.distance ? `${i.ewaybill.distance} KM` : "-",
    col7: fmtRs(i.totals?.total || 0),
    status: "Active ✓",
  }));
  return {
    columns: [
      { key: "col1", label: "E-Way Bill Number" },
      { key: "col2", label: "Invoice Number" },
      { key: "col3", label: "Date" },
      { key: "col4", label: "Customer Name" },
      { key: "col5", label: "Vehicle Number" },
      { key: "col6", label: "Distance (KM)" },
      { key: "col7", label: "Invoice Value (₹)", align: "right" },
      { key: "status", label: "Status" },
    ],
    rows,
    totals: { count: rows.length, total: fmtRs(ewbInvoices.reduce((a, b) => a + (b.totals?.total || 0), 0)) },
  };
}

