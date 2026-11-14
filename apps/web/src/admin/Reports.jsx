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
      { key: "gstr2b", label: "GSTR-2B (Input Credit)" },
      { key: "tax_summary", label: "Rate-wise Tax Summary" },
      { key: "hsn_summary", label: "HSN Summary" },
    ],
  },
  {
    key: "transactions",
    label: "Transactions",
    icon: "📜",
    views: [
      { key: "sales_summary", label: "Sales Register" },
      { key: "purchase_summary", label: "Purchase Register" },
      { key: "credit_notes", label: "Credit Notes Register" },
      { key: "expenses", label: "Operating Expenses" },
      { key: "indirect_income", label: "Indirect Income" },
    ],
  },
  {
    key: "bill_items",
    label: "Bill-wise Items",
    icon: "📦",
    views: [
      { key: "bill_profit_loss", label: "Bill Profit & Loss" },
      { key: "sales_by_item", label: "Sales by Product" },
      { key: "velocity_report", label: "Fast & Slow Moving" },
      { key: "expiry_report", label: "Batches & Expiry" },
    ],
  },
  {
    key: "items",
    label: "Stock & Valuation",
    icon: "🏷️",
    views: [
      { key: "stock_summary", label: "Stock Summary" },
      { key: "low_stock", label: "Low Stock Alert" },
    ],
  },
  {
    key: "party",
    label: "Party & Ageing",
    icon: "👥",
    views: [
      { key: "receivables_ageing", label: "Receivables Ageing (0-90+d)" },
      { key: "customer_summary", label: "Customer-wise Sales" },
    ],
  },
  {
    key: "pl",
    label: "Profit & Loss",
    icon: "📊",
    views: [
      { key: "gross_profit", label: "Gross Profit & Margins" },
    ],
  },
  {
    key: "payments",
    label: "Payments Hub",
    icon: "💳",
    views: [
      { key: "payments_in", label: "Payments In (Collections)" },
      { key: "payments_out", label: "Payments Out (Disbursements)" },
    ],
  },
  {
    key: "summary",
    label: "Financial Overview",
    icon: "📑",
    views: [
      { key: "overview", label: "Sales & Funnel Analytics" },
      { key: "daily_sales", label: "Daily Sales Register" },
      { key: "trial_balance", label: "Trial Balance" },
    ],
  },
  {
    key: "eway",
    label: "E-Way Bills",
    icon: "🚚",
    views: [
      { key: "eway_bills", label: "E-Way Bills Issued" },
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

  const q = `from=${rg.from}&to=${rg.to}`;
  const s = useLoad(`/api/admin/reports?${q}`);
  const gstr = useLoad(`/api/admin/reports/gstr-1/preview?fy=${encodeURIComponent(selectedFy)}`);

  // Query engine for active dynamic report view
  const queryUrl = `/api/admin/reports/query?division=${activeDivision}&view=${activeView}&from=${rg.from}&to=${rg.to}`;
  const dyn = useLoad(queryUrl);

  const d = s.data;
  const gd = gstr.data;
  const pct = (a, b) => (b ? Math.round((100 * a) / b) + "%" : "—");

  const currentDivObj = REPORT_DIVISIONS.find((div) => div.key === activeDivision) || REPORT_DIVISIONS[0];

  const handleDivisionChange = (divKey) => {
    setActiveDivision(divKey);
    const div = REPORT_DIVISIONS.find((d) => d.key === divKey);
    if (div && div.views.length > 0) {
      setActiveView(div.views[0].key);
    }
  };

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
              Swipe 1:1 Engine
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
      <Loader load={s}>
        {() => (
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

      {/* 10 Division Primary Nav Tabs (Swipe 1:1 Bar) */}
      <div
        style={{
          display: "flex",
          gap: 6,
          overflowX: "auto",
          paddingBottom: 6,
          marginBottom: 14,
          borderBottom: "1px solid #e2e8f0",
        }}
      >
        {REPORT_DIVISIONS.map((div) => {
          const isActive = activeDivision === div.key;
          return (
            <button
              key={div.key}
              type="button"
              onClick={() => handleDivisionChange(div.key)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 14px",
                borderRadius: "6px 6px 0 0",
                fontSize: "0.88rem",
                fontWeight: isActive ? 700 : 500,
                border: "none",
                cursor: "pointer",
                background: isActive ? "#0284c7" : "#f1f5f9",
                color: isActive ? "#ffffff" : "#475569",
                whiteSpace: "nowrap",
                transition: "all 0.15s ease",
              }}
            >
              <span>{div.icon}</span>
              <span>{div.label}</span>
              <span
                style={{
                  fontSize: "0.72rem",
                  padding: "1px 6px",
                  borderRadius: 10,
                  background: isActive ? "rgba(255,255,255,0.25)" : "#e2e8f0",
                  color: isActive ? "#fff" : "#64748b",
                }}
              >
                {div.views.length}
              </span>
            </button>
          );
        })}
      </div>

      {/* Sub-Views Horizontal Pills for Active Division */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 10,
          marginBottom: 16,
        }}
      >
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {currentDivObj.views.map((v) => {
            const isSelected = activeView === v.key;
            return (
              <button
                key={v.key}
                type="button"
                onClick={() => setActiveView(v.key)}
                style={{
                  padding: "5px 12px",
                  borderRadius: 20,
                  fontSize: "0.82rem",
                  fontWeight: isSelected ? 700 : 500,
                  border: isSelected ? "1px solid #0284c7" : "1px solid #cbd5e1",
                  background: isSelected ? "#eff6ff" : "#fff",
                  color: isSelected ? "#0284c7" : "#475569",
                  cursor: "pointer",
                }}
              >
                {v.label}
              </button>
            );
          })}
        </div>

        {/* Local Search Input for the table */}
        <input
          type="search"
          placeholder="Search in table..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: "5px 10px",
            fontSize: "0.85rem",
            borderRadius: 6,
            border: "1px solid #cbd5e1",
            minWidth: 200,
          }}
        />
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
            <Loader load={gstr}>
              {() => {
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
              }}
            </Loader>
          </div>
        </div>
      ) : activeDivision === "summary" && activeView === "overview" ? (
        /* Original Analytics & Funnel Overview */
        <Loader load={s}>
          {() => (
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
                {currentDivObj.views.find((v) => v.key === activeView)?.label || "Report View"}
              </h2>
              <span className="muted" style={{ fontSize: "0.82rem" }}>
                Date Range: {rg.from || "Start"} to {rg.to || "Today"} · {filteredRows.length} records found
              </span>
            </div>
          </div>

          <Loader load={dyn}>
            {() => {
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
            }}
          </Loader>
        </div>
      )}
    </>
  );
}
