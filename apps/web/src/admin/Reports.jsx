import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Loader, useLoad } from "./hooks.jsx";
import { Bars, rs, today } from "./ui.jsx";

const fyStart = () => {
  const t = today(), y = Number(t.slice(0, 4));
  return `${Number(t.slice(5, 7)) >= 4 ? y : y - 1}-04-01`;
};

const FY_OPTIONS = ["FY 23-24", "FY 24-25", "FY 25-26", "FY 26-27"];

export const REPORT_DIVISIONS = [
  {
    key: "taxes",
    label: "Taxes & GST",
    icon: "🏛️",
    views: [
      { key: "gstr1", label: "GSTR-1 Tax Hub" },
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
      { key: "overview", label: "Sales & Funnel Analytics" },
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

export default function Reports() {
  const [activeDivision, setActiveDivision] = useState("taxes");
  const [activeView, setActiveView] = useState("gstr1");
  const [rg, setRg] = useState({ from: fyStart(), to: today() });
  const [selectedFy, setSelectedFy] = useState("FY 26-27");
  const [search, setSearch] = useState("");
  const [gstrTab, setGstrTab] = useState("B2B");
  const [showTotals, setShowTotals] = useState(true);
  const [collapsedDivs, setCollapsedDivs] = useState({});

  const toggleDiv = (k) => {
    setCollapsedDivs((prev) => ({ ...prev, [k]: !prev[k] }));
  };

  const matrixLoad = useLoad(`/api/admin/reports/matrix?division=${activeDivision}&view=${activeView}&from=${rg.from}&to=${rg.to}`);
  const mTotals = matrixLoad.data?.totals || {
    qty: 0,
    cgst: 0,
    sgst: 0,
    igst: 0,
    roundOff: 0,
    netAmount: 0,
    totalAmount: 0,
    amountPaid: 0,
    amountPending: 0,
  };

  const q = `from=${rg.from}&to=${rg.to}`;
  const s = useLoad(`/api/admin/reports?${q}`);
  const gstr = useLoad(`/api/admin/reports/gstr-1/preview?fy=${encodeURIComponent(selectedFy)}`);
  const divLoad = useLoad("/api/admin/reports/divisions");

  const divisions = useMemo(() => {
    if (divLoad.data && Array.isArray(divLoad.data) && divLoad.data.length > 0) {
      return divLoad.data;
    }
    return REPORT_DIVISIONS;
  }, [divLoad.data]);

  // Query engine for active dynamic report view
  const queryUrl = `/api/admin/reports/query?division=${activeDivision}&view=${activeView}&from=${rg.from}&to=${rg.to}`;
  const dyn = useLoad(queryUrl);

  const d = s.data;
  const gd = gstr.data;
  const pct = (a, b) => (b ? Math.round((100 * a) / b) + "%" : "—");

  const currentDivObj = divisions.find((div) => div.key === activeDivision) || divisions[0] || { label: "Reports", views: [] };

  const handleDivisionChange = (divKey) => {
    setActiveDivision(divKey);
    const div = divisions.find((d) => d.key === divKey);
    if (div && Array.isArray(div.views) && div.views.length > 0) {
      setActiveView(div.views[0].key);
    }
  };

  const totalReportsCount = useMemo(() => {
    return divisions.reduce((acc, div) => acc + (div.views?.length || 0), 0) + 6;
  }, [divisions]);

  // Filtered rows for dynamic table
  const filteredRows = useMemo(() => {
    if (!dyn.data?.rows) return [];
    if (!search.trim()) return dyn.data.rows;
    const qStr = search.trim().toLowerCase();
    return dyn.data.rows.filter((r) =>
      Object.values(r).some((v) => String(v).toLowerCase().includes(qStr))
    );
  }, [dyn.data, search]);

  return (
    <>
      {/* Top Header */}
      <div className="row-between" style={{ alignItems: "center", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, display: "flex", alignItems: "center", gap: 10 }}>
            <span>Reports & Business Intelligence</span>
            <span style={{ fontSize: "0.75rem", background: "#f1f5f9", padding: "3px 8px", borderRadius: 12, color: "#64748b" }}>
              10 Divisions · {totalReportsCount}+ Reports (Swipe 1:1 Engine)
            </span>
          </h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            Real-time tax compliance, P&L costing, sales registries, and multi-hub analytics across 10 report divisions.
          </p>
        </div>

        {/* Global FY & Date Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <select
            value={selectedFy}
            onChange={(e) => setSelectedFy(e.target.value)}
            style={{ fontWeight: 600, padding: "6px 12px", borderRadius: 6, border: "1px solid #cbd5e1" }}
          >
            {FY_OPTIONS.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
          <input
            type="date"
            value={rg.from}
            onChange={(e) => setRg((prev) => ({ ...prev, from: e.target.value }))}
            style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: "0.85rem" }}
          />
          <span style={{ color: "#94a3b8" }}>→</span>
          <input
            type="date"
            value={rg.to}
            onChange={(e) => setRg((prev) => ({ ...prev, to: e.target.value }))}
            style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: "0.85rem" }}
          />
          <a
            className="btn ghost"
            href={`/api/admin/reports/query/export.csv?division=${activeDivision}&view=${activeView}&from=${rg.from}&to=${rg.to}`}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", background: "#fff" }}
          >
            📥 Export CSV
          </a>
        </div>
      </div>

      {/* Top 8 Sticky KPI Metrics Cards */}
      <Loader s={s}>
        {d?.totals && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
              gap: 12,
              marginBottom: 20,
            }}
          >
            <div className="panel" style={{ padding: "12px 14px", borderTop: "3px solid #0284c7" }}>
              <span style={{ fontSize: "0.75rem", color: "#64748b", textTransform: "uppercase", fontWeight: 600 }}>Total Invoiced</span>
              <strong style={{ fontSize: "1.15rem", display: "block", marginTop: 4, color: "#0f172a" }}>
                {rs(d.totals.invoiced)}
              </strong>
              <small style={{ color: "#64748b" }}>{d.totals.invoices} bills</small>
            </div>
            <div className="panel" style={{ padding: "12px 14px", borderTop: "3px solid #16a34a" }}>
              <span style={{ fontSize: "0.75rem", color: "#64748b", textTransform: "uppercase", fontWeight: 600 }}>Total Collected</span>
              <strong style={{ fontSize: "1.15rem", display: "block", marginTop: 4, color: "#16a34a" }}>
                {rs(d.totals.received)}
              </strong>
              <small style={{ color: "#16a34a" }}>{pct(d.totals.received, d.totals.invoiced)} collected</small>
            </div>
            <div className="panel" style={{ padding: "12px 14px", borderTop: "3px solid #f59e0b" }}>
              <span style={{ fontSize: "0.75rem", color: "#64748b", textTransform: "uppercase", fontWeight: 600 }}>Receivables Due</span>
              <strong style={{ fontSize: "1.15rem", display: "block", marginTop: 4, color: "#b45309" }}>
                {rs(d.totals.outstanding)}
              </strong>
              <small style={{ color: "#b45309" }}>Overdue bills</small>
            </div>
            <div className="panel" style={{ padding: "12px 14px", borderTop: "3px solid #6366f1" }}>
              <span style={{ fontSize: "0.75rem", color: "#64748b", textTransform: "uppercase", fontWeight: 600 }}>Total Tax (GST)</span>
              <strong style={{ fontSize: "1.15rem", display: "block", marginTop: 4, color: "#4f46e5" }}>
                {rs(d.totals.tax)}
              </strong>
              <small style={{ color: "#64748b" }}>CGST + SGST + IGST</small>
            </div>
            <div className="panel" style={{ padding: "12px 14px", borderTop: "3px solid #ec4899" }}>
              <span style={{ fontSize: "0.75rem", color: "#64748b", textTransform: "uppercase", fontWeight: 600 }}>Credit Notes</span>
              <strong style={{ fontSize: "1.15rem", display: "block", marginTop: 4, color: "#be185d" }}>
                {rs(d.totals.credited || 0)}
              </strong>
              <small style={{ color: "#be185d" }}>Sales Returns</small>
            </div>
            <div className="panel" style={{ padding: "12px 14px", borderTop: "3px solid #0d9488" }}>
              <span style={{ fontSize: "0.75rem", color: "#64748b", textTransform: "uppercase", fontWeight: 600 }}>Active Customers</span>
              <strong style={{ fontSize: "1.15rem", display: "block", marginTop: 4, color: "#0f766e" }}>
                {d.totals.customers || 0}
              </strong>
              <small style={{ color: "#64748b" }}>Buying clients</small>
            </div>
          </div>
        )}
      </Loader>

      {/* 1:1 Swipe 2-Pane Reports Workspace */}
      <div style={{ display: "grid", gridTemplateColumns: "250px minmax(0, 1fr)", gap: 20, alignItems: "start" }}>
        {/* Left Sub-Sidebar (10 Divisions & 68 Report Views) */}
        <div
          className="panel"
          style={{
            padding: "12px 8px",
            background: "#F8FAFC",
            border: "1px solid #E2E8F0",
            borderRadius: 10,
            display: "grid",
            gap: 6,
          }}
        >
          <div style={{ padding: "6px 10px", fontSize: "0.78rem", fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Report Divisions
          </div>
          {divisions.map((div) => {
            const isActiveDiv = activeDivision === div.key;
            const isCollapsed = collapsedDivs[div.key];
            return (
              <div key={div.key} style={{ borderRadius: 8, overflow: "hidden" }}>
                <div
                  onClick={() => {
                    handleDivisionChange(div.key);
                    if (isCollapsed) toggleDiv(div.key);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "8px 12px",
                    cursor: "pointer",
                    fontSize: "0.85rem",
                    fontWeight: isActiveDiv ? 700 : 500,
                    color: isActiveDiv ? "#0F172A" : "#334155",
                    background: isActiveDiv ? "#FFFFFF" : "transparent",
                    border: isActiveDiv ? "1px solid #E2E8F0" : "1px solid transparent",
                    borderRadius: 6,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span>{div.icon}</span>
                    <span>{div.label}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span
                      style={{
                        fontSize: "0.7rem",
                        padding: "1px 6px",
                        borderRadius: 10,
                        background: isActiveDiv ? "#EFF6FF" : "#E2E8F0",
                        color: isActiveDiv ? "#2563EB" : "#64748B",
                        fontWeight: 600,
                      }}
                    >
                      {div.views?.length || 0}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleDiv(div.key);
                      }}
                      style={{ border: "none", background: "none", cursor: "pointer", fontSize: "0.75rem", color: "#94A3B8" }}
                    >
                      {isCollapsed ? "▼" : "▲"}
                    </button>
                  </div>
                </div>

                {!isCollapsed && (
                  <div style={{ padding: "4px 0 6px 24px", display: "grid", gap: 2 }}>
                    {(div.views || []).map((v) => {
                      const isSelected = activeDivision === div.key && activeView === v.key;
                      return (
                        <button
                          key={v.key}
                          type="button"
                          onClick={() => {
                            setActiveDivision(div.key);
                            setActiveView(v.key);
                          }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            textAlign: "left",
                            padding: "6px 10px",
                            borderRadius: 6,
                            fontSize: "0.82rem",
                            border: "none",
                            cursor: "pointer",
                            background: isSelected ? "#EFF6FF" : "transparent",
                            color: isSelected ? "#2563EB" : "#475569",
                            fontWeight: isSelected ? 600 : 400,
                            borderLeft: isSelected ? "3px solid #2563EB" : "3px solid transparent",
                          }}
                        >
                          <span>{v.label}</span>
                          {["gstr3b", "hub_stock", "net_profit"].includes(v.key) && (
                            <span style={{ fontSize: "0.65rem", background: "#DCFCE7", color: "#166534", padding: "1px 4px", borderRadius: 4, fontWeight: 700 }}>
                              New
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Right Pane (Active View Content & Controls) */}
        <div style={{ display: "grid", gap: 16 }}>
          {/* Top Filter & Toolbar */}
          <div
            className="panel"
            style={{
              padding: "10px 14px",
              background: "#FFFFFF",
              borderRadius: 8,
              border: "1px solid #E2E8F0",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <strong style={{ fontSize: "1.05rem", color: "#0F172A" }}>
                {currentDivObj?.views?.find((v) => v.key === activeView)?.label || "Report View"}
              </strong>
              <span style={{ fontSize: "0.75rem", background: "#EFF6FF", color: "#2563EB", padding: "2px 8px", borderRadius: 10, fontWeight: 600 }}>
                {currentDivObj?.label || "Division"}
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="search"
                placeholder="Search rows…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  padding: "5px 10px",
                  fontSize: "0.85rem",
                  borderRadius: 6,
                  border: "1px solid #CBD5E1",
                  minWidth: 180,
                }}
              />
              <a
                className="btn ghost small"
                href={`/api/admin/reports/query/export.csv?division=${activeDivision}&view=${activeView}&from=${rg.from}&to=${rg.to}`}
                style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px" }}
              >
                📥 Export CSV
              </a>
            </div>
          </div>

      {/* View Branching: GSTR-1 Hub vs Analytics Overview vs Dynamic Table */}
      {activeDivision === "taxes" && activeView === "gstr1" ? (
        <div style={{ display: "grid", gap: 16 }}>
          {/* Top Info Banner matching Swipe */}
          <div
            style={{
              background: "#eff6ff",
              border: "1px solid #bfdbfe",
              borderRadius: 8,
              padding: "16px 20px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 12,
            }}
          >
            <div>
              <strong style={{ fontSize: "1.05rem", color: "#1e3a8a" }}>
                File your GSTR-1 Directly or Download Official JSON for your CA
              </strong>
              <div style={{ fontSize: "0.85rem", color: "#3b82f6", marginTop: 2 }}>
                Upload the JSON file directly to the GST Portal (gst.gov.in) offline utility. No manual entry needed.
              </div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <a
                className="btn ghost"
                href={`/api/admin/reports/gstr-1/b2b.csv?fy=${encodeURIComponent(selectedFy)}`}
                style={{ background: "#fff", display: "flex", alignItems: "center", gap: 6 }}
              >
                📄 Download CSV
              </a>
              <a
                className="btn"
                href={`/api/admin/reports/gstr-1.json?fy=${encodeURIComponent(selectedFy)}`}
                download
                style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700 }}
              >
                ⬇️ Download Official JSON
              </a>
            </div>
          </div>

          {/* GSTR-1 Header & Controls */}
          <div className="panel" style={{ padding: "16px 20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: "1.1rem" }}>GSTR-1 Breakdown</h3>
                  <span className="muted" style={{ fontSize: "0.85rem" }}>
                    Filing Period: {selectedFy}
                  </span>
                </div>
              </div>
            </div>

            {/* Swipe GSTR-1 Section Navigation */}
            <div
              style={{
                display: "flex",
                gap: 8,
                marginTop: 16,
                borderBottom: "1px solid #e2e8f0",
                paddingBottom: 8,
                overflowX: "auto",
              }}
            >
              {[
                { id: "B2B", label: "4A, 4B, 6B, 6C - B2B Invoices", count: gd?.b2b?.length || 0 },
                { id: "B2CS", label: "7 - B2C (Small) Details", count: gd?.b2cs?.length || 0 },
                { id: "CDNR", label: "9B - Credit / Debit Notes (Registered)", count: gd?.cdnr?.length || 0 },
                { id: "CDNUR", label: "9B - Credit / Debit Notes (Unregistered)", count: gd?.cdnur?.length || 0 },
                { id: "HSN", label: "12 - HSN-wise summary of outward supplies", count: gd?.hsn?.length || 0 },
                { id: "DOC", label: "13 - Documents Issued", count: gd?.doc_issue?.doc_det?.length || 0 },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setGstrTab(tab.id)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 4,
                    border: "none",
                    background: gstrTab === tab.id ? "#0284c7" : "#f8fafc",
                    color: gstrTab === tab.id ? "#fff" : "#475569",
                    fontWeight: gstrTab === tab.id ? 700 : 500,
                    cursor: "pointer",
                    fontSize: "0.85rem",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    whiteSpace: "nowrap",
                  }}
                >
                  <span>{tab.label}</span>
                  <span
                    style={{
                      fontSize: "0.75rem",
                      background: gstrTab === tab.id ? "rgba(255,255,255,0.2)" : "#e2e8f0",
                      padding: "1px 6px",
                      borderRadius: 10,
                    }}
                  >
                    {tab.count}
                  </span>
                </button>
              ))}
            </div>

            {/* GSTR-1 Section Table Content */}
            <Loader s={gstr}>
              {gd && (() => {
                if (gstrTab === "B2B") {
                  const list = gd?.b2b || [];
                  if (!list.length) {
                    return (
                      <div className="muted" style={{ padding: 40, textAlign: "center" }}>
                        No B2B invoices found for {selectedFy}. All invoices with registered GSTINs will appear here.
                      </div>
                    );
                  }
                  return (
                    <div style={{ overflowX: "auto", marginTop: 12 }}>
                      <table className="tbl">
                        <thead>
                          <tr>
                            <th>GSTIN / UIN</th>
                            <th>Receiver Name</th>
                            <th>Invoice No</th>
                            <th>Invoice Date</th>
                            <th className="num">Invoice Value</th>
                            <th>Place of Supply</th>
                            <th className="num">Items</th>
                          </tr>
                        </thead>
                        <tbody>
                          {list.map((r, i) => (
                            <tr key={i}>
                              <td style={{ fontFamily: "monospace", fontWeight: 600 }}>{r.gstin}</td>
                              <td>{r.customerName}</td>
                              <td>{r.invoiceNumber}</td>
                              <td>{r.date}</td>
                              <td className="num">{rs(r.value)}</td>
                              <td>{r.placeOfSupply}</td>
                              <td className="num">{r.itemsCount}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                }

                if (gstrTab === "HSN") {
                  const list = gd?.hsn || [];
                  if (!list.length) {
                    return (
                      <div className="muted" style={{ padding: 40, textAlign: "center" }}>
                        No HSN summary data available for {selectedFy}.
                      </div>
                    );
                  }
                  return (
                    <div style={{ overflowX: "auto", marginTop: 12 }}>
                      <table className="tbl">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>HSN Code</th>
                            <th>Description</th>
                            <th>UQC</th>
                            <th className="num">Total Qty</th>
                            <th className="num">Total Value</th>
                            <th className="num">Taxable Value</th>
                            <th className="num">Central Tax</th>
                            <th className="num">State Tax</th>
                            <th className="num">Integrated Tax</th>
                          </tr>
                        </thead>
                        <tbody>
                          {list.map((r, i) => (
                            <tr key={i}>
                              <td>{r.num}</td>
                              <td style={{ fontFamily: "monospace", fontWeight: 600 }}>{r.hsn_sc}</td>
                              <td>{r.desc}</td>
                              <td>{r.uqc}</td>
                              <td className="num">{r.qty.toLocaleString("en-IN")}</td>
                              <td className="num">{rs(r.val)}</td>
                              <td className="num">{rs(r.txval)}</td>
                              <td className="num">{rs(r.camt)}</td>
                              <td className="num">{rs(r.samt)}</td>
                              <td className="num">{rs(r.iamt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                }

                return (
                  <div className="muted" style={{ padding: 40, textAlign: "center" }}>
                    No records found in this GSTR-1 table for {selectedFy}.
                  </div>
                );
              })()}
            </Loader>
          </div>
        </div>
      ) : activeDivision === "summary" && activeView === "overview" ? (
        /* Original Analytics & Funnel Overview */
        <Loader s={s}>
          {d && (
            <div style={{ display: "grid", gap: 16 }}>
              <div className="two-cols">
                <div className="panel">
                  <h2>Sales Pipeline & Funnel</h2>
                  <div className="bars-list">
                    <Bars label="Enquiries / leads" value={d.funnel.enquiries} max={d.funnel.enquiries} />
                    <Bars label="Quotes sent" value={d.funnel.quotesSent} max={d.funnel.enquiries} />
                    <Bars label="Quotes accepted" value={d.funnel.accepted} max={d.funnel.enquiries} />
                    <Bars label="Orders booked" value={d.funnel.orders} max={d.funnel.enquiries} />
                    <Bars label="Invoices issued" value={d.funnel.invoices} max={d.funnel.enquiries} />
                  </div>
                </div>

                <div className="panel">
                  <h2>Revenue by Month</h2>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Month</th>
                        <th className="num">Taxable</th>
                        <th className="num">Tax</th>
                        <th className="num">Invoiced</th>
                        <th className="num">Collected</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.months.map((m) => (
                        <tr key={m.month}>
                          <td>{m.month}</td>
                          <td className="num">{rs(m.taxable)}</td>
                          <td className="num">{rs(m.tax)}</td>
                          <td className="num"><strong>{rs(m.invoiced)}</strong></td>
                          <td className="num" style={{ color: "#16a34a" }}>{rs(m.received)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="two-cols">
                <div className="panel">
                  <h2>Top 15 Products by Revenue</h2>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th className="num">Qty</th>
                        <th className="num">Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.topProducts.map((p) => (
                        <tr key={p.sku || p.name}>
                          <td>
                            <strong>{p.name}</strong>
                            <small style={{ display: "block", color: "#64748b" }}>{p.sku}</small>
                          </td>
                          <td className="num">{p.qty.toLocaleString("en-IN")}</td>
                          <td className="num">{rs(p.taxable)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="panel">
                  <h2>Money Owed by Age</h2>
                  <table className="tbl">
                    <tbody>
                      {[
                        ["Not yet due", "current"],
                        ["1–30 days late", "d30"],
                        ["31–60 days late", "d60"],
                        ["61–90 days late", "d90"],
                        ["Over 90 days", "d90plus"],
                      ].map(([l, k]) => (
                        <tr key={k}>
                          <td>{l}</td>
                          <td className={"num" + (k !== "current" && d.aging[k] ? " due" : "")}>{rs(d.aging[k])}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </Loader>
      ) : (
        /* Dynamic Swipe 1:1 Tabular Engine */
        <div className="panel" style={{ padding: "16px 20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: "1.1rem" }}>
                {currentDivObj?.views?.find((v) => v.key === activeView)?.label || "Report View"}
              </h2>
              <span className="muted" style={{ fontSize: "0.82rem" }}>
                Date Range: {rg.from || "Start"} to {rg.to || "Today"} · {filteredRows.length} records found
              </span>
            </div>
          </div>

          <Loader s={dyn}>
            {dyn.data && (() => {
              const cols = dyn.data?.columns || [];
              if (!cols.length || !filteredRows.length) {
                return (
                  <div className="muted" style={{ padding: 40, textAlign: "center" }}>
                    No records found for the selected period.
                  </div>
                );
              }
              return (
                <div style={{ overflowX: "auto" }}>
                  <table className="tbl" style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        {cols.map((c) => (
                          <th key={c.key} className={c.align === "right" ? "num" : ""}>
                            {c.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRows.map((row, idx) => (
                        <tr key={idx}>
                          {cols.map((c) => {
                            const val = row[c.key] ?? "-";
                            const isNum = c.align === "right";
                            const isStatus = c.key === "status";

                            if (isStatus) {
                              const sLower = String(val).toLowerCase();
                              const isGreen = sLower.includes("profit") || sLower.includes("✓") || sLower.includes("paid") || sLower.includes("available");
                              const isRed = sLower.includes("loss") || sLower.includes("expired") || sLower.includes("out");
                              return (
                                <td key={c.key}>
                                  <span
                                    style={{
                                      fontSize: "0.78rem",
                                      padding: "2px 8px",
                                      borderRadius: 12,
                                      fontWeight: 600,
                                      background: isGreen ? "#dcfce7" : isRed ? "#fee2e2" : "#f1f5f9",
                                      color: isGreen ? "#166534" : isRed ? "#991b1b" : "#475569",
                                    }}
                                  >
                                    {val}
                                  </span>
                                </td>
                              );
                            }

                            return (
                              <td key={c.key} className={isNum ? "num" : ""}>
                                {val}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {/* Bottom Sticky Summary Footer */}
                  {dyn.data?.totals && (
                    <div
                      style={{
                        marginTop: 16,
                        padding: "10px 14px",
                        background: "#f8fafc",
                        border: "1px solid #e2e8f0",
                        borderRadius: 6,
                        display: "flex",
                        justifyContent: "flex-end",
                        gap: 20,
                        fontSize: "0.85rem",
                        fontWeight: 600,
                      }}
                    >
                      {Object.entries(dyn.data.totals).map(([k, v]) => (
                        <span key={k}>
                          <span style={{ color: "#64748b", textTransform: "capitalize" }}>{k}: </span>
                          <strong style={{ color: "#0f172a" }}>{v}</strong>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
          </Loader>
        </div>
      )}
        </div>
      </div>

      {/* 9-Metric Floating Totals Card (Swipe 1:1 Widget) */}
      <div style={{ position: "fixed", bottom: 20, right: 24, zIndex: 100 }}>
        <button
          type="button"
          onClick={() => setShowTotals((v) => !v)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "#0F172A",
            color: "#FFFFFF",
            padding: "8px 16px",
            borderRadius: 24,
            fontWeight: 600,
            fontSize: "0.85rem",
            border: "none",
            cursor: "pointer",
            boxShadow: "0 4px 14px rgba(0,0,0,0.2)",
          }}
        >
          <span>Totals (9 Metrics) ⓘ</span>
          <span>{showTotals ? "▼" : "▲"}</span>
        </button>
        {showTotals && (
          <div
            style={{
              position: "absolute",
              bottom: 44,
              right: 0,
              width: 380,
              background: "#FFFFFF",
              border: "1px solid #E2E8F0",
              borderRadius: 12,
              boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
              padding: 16,
              display: "grid",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #F1F5F9", paddingBottom: 8 }}>
              <strong style={{ fontSize: "0.92rem", color: "#0F172A" }}>9-Metric Floating Totals</strong>
              <small style={{ color: "#64748B" }}>Period Summary</small>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, fontSize: "0.82rem" }}>
              <div><span style={{ color: "#64748B", display: "block" }}>Quantity</span><strong>{mTotals.qty}</strong></div>
              <div><span style={{ color: "#64748B", display: "block" }}>CGST</span><strong style={{ color: "#2563EB" }}>₹{mTotals.cgst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</strong></div>
              <div><span style={{ color: "#64748B", display: "block" }}>SGST</span><strong style={{ color: "#2563EB" }}>₹{mTotals.sgst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</strong></div>
              <div><span style={{ color: "#64748B", display: "block" }}>IGST</span><strong style={{ color: "#2563EB" }}>₹{mTotals.igst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</strong></div>
              <div><span style={{ color: "#64748B", display: "block" }}>Round Off</span><strong>₹{mTotals.roundOff.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</strong></div>
              <div><span style={{ color: "#64748B", display: "block" }}>Net Amount</span><strong style={{ color: "#0F172A" }}>₹{mTotals.netAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</strong></div>
              <div><span style={{ color: "#64748B", display: "block" }}>Total Amount</span><strong style={{ color: "#0F172A" }}>₹{mTotals.totalAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</strong></div>
              <div><span style={{ color: "#64748B", display: "block" }}>Amount Paid</span><strong style={{ color: "#16A34A" }}>₹{mTotals.amountPaid.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</strong></div>
              <div><span style={{ color: "#64748B", display: "block" }}>Pending</span><strong style={{ color: "#DC2626" }}>₹{mTotals.amountPending.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</strong></div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
