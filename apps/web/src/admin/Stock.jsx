import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { Loader, useLoad } from "./hooks.jsx";
import { fmtDate, fmtTime, Modal, Msg, rs, toPaise, useAction, useAsync } from "./ui.jsx";

function formatRupees(paise) {
  const n = (paise || 0) / 100;
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function Stock() {
  const s = useLoad("/api/admin/stock");
  const suppliers = useAsync("/api/admin/suppliers");
  const hubs = useLoad("/api/admin/hubs");
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState("");
  const [adj, setAdj] = useState(null);
  const [hist, setHist] = useState(null);
  const [bulkModal, setBulkModal] = useState(null); // "in" or "out"
  const [st, run] = useAction();
  const nav = useNavigate();

  const filter = sp.get("filter") || "all";
  const selectedHub = sp.get("hub") || "all";

  const rawRows = s.data || [];

  // Filtered rows
  const rows = useMemo(() => {
    return rawRows.filter((p) => {
      const matchHub = selectedHub === "all" || p.hubId === selectedHub || !p.hubId;
      const matchFilter =
        filter === "all" ||
        (filter === "tracked" && p.stockTracked) ||
        (filter === "low" && (p.low || (p.available ?? 0) <= (p.reorderLevel || 0))) ||
        (filter === "positive" && (p.available ?? 0) > 0);
      const matchSearch = !q || `${p.name} ${p.sku} ${p.hsn || ""}`.toLowerCase().includes(q.toLowerCase());
      return matchHub && matchFilter && matchSearch;
    });
  }, [rawRows, filter, selectedHub, q]);

  // 4 KPI Calculations (Matching Swipe 1:1)
  const kpis = useMemo(() => {
    let lowCount = 0;
    let lowQty = 0;
    let posCount = 0;
    let posQty = 0;
    let valSalesPaise = 0;
    let valCostPaise = 0;

    for (const p of rawRows) {
      const avail = Math.max(0, p.available ?? p.qty ?? 0);
      const isLow = (p.available ?? p.qty ?? 0) <= (p.reorderLevel || 0) || (p.available ?? p.qty ?? 0) <= 0;

      if (isLow) {
        lowCount++;
        lowQty += Math.max(0, p.available ?? p.qty ?? 0);
      } else {
        posCount++;
        posQty += avail;
      }

      if (p.price != null && avail > 0) {
        valSalesPaise += Math.round(avail * p.price);
      }
      if (p.costPrice != null && avail > 0) {
        valCostPaise += Math.round(avail * p.costPrice);
      }
    }

    return { lowCount, lowQty, posCount, posQty, valSalesPaise, valCostPaise };
  }, [rawRows]);

  const patch = (p, body) => run(async () => {
    await api(`/api/admin/stock/${p.id}`, { method: "PATCH", body });
    s.reload();
  });

  if (filter === "expiring") {
    return (
      <>
        <div className="swipe-page-header">
          <h1 className="swipe-title">
            <span>Inventory: Batches & Expiry</span>
            <span className="swipe-play-badge">▶</span>
          </h1>
          <button type="button" className="swipe-btn-ghost" onClick={() => setSp({})}>
            ← Back to Inventory
          </button>
        </div>
        <Batches />
      </>
    );
  }

  const allHubs = hubs.data || [];

  return (
    <>
      <div className="swipe-page-header">
        <h1 className="swipe-title">
          <span>Inventory (Stock)</span>
          <span className="swipe-play-badge" title="Inventory & Warehouses">▶</span>
        </h1>
        <div className="swipe-header-actions">
          <button
            type="button"
            className="swipe-btn-ghost"
            style={{ color: "#16a34a", borderColor: "#bbf7d0", fontWeight: 700 }}
            onClick={() => setBulkModal("in")}
          >
            ↙ Bulk Stock In
          </button>
          <button
            type="button"
            className="swipe-btn-ghost"
            style={{ color: "#dc2626", borderColor: "#fecaca", fontWeight: 700 }}
            onClick={() => setBulkModal("out")}
          >
            ↗ Bulk Stock Out
          </button>
          <Link className="swipe-btn-ghost" to="/admin/logistics-hub">
            🏢 Manage Warehouses
          </Link>
          <a className="swipe-btn-ghost" href="/api/admin/reports/stock.csv">
            Export CSV
          </a>
        </div>
      </div>

      {/* Multi-Hub Switcher Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, overflowX: "auto", paddingBottom: 4 }}>
        <button
          type="button"
          className="swipe-btn-ghost"
          style={{
            background: selectedHub === "all" ? "#0B57D0" : "#F8FAFC",
            color: selectedHub === "all" ? "#FFFFFF" : "#334155",
            borderColor: selectedHub === "all" ? "#0B57D0" : "#E2E8F0",
            fontWeight: selectedHub === "all" ? 700 : 500,
            fontSize: "0.85rem",
            padding: "6px 14px",
            borderRadius: "20px",
          }}
          onClick={() => {
            const n = new URLSearchParams(sp);
            n.set("hub", "all");
            setSp(n, { replace: true });
          }}
        >
          All Warehouses ({rawRows.length})
        </button>
        {allHubs.map((h) => (
          <button
            key={h.id}
            type="button"
            className="swipe-btn-ghost"
            style={{
              background: selectedHub === h.id ? "#0B57D0" : "#F8FAFC",
              color: selectedHub === h.id ? "#FFFFFF" : "#334155",
              borderColor: selectedHub === h.id ? "#0B57D0" : "#E2E8F0",
              fontWeight: selectedHub === h.id ? 700 : 500,
              fontSize: "0.85rem",
              padding: "6px 14px",
              borderRadius: "20px",
            }}
            onClick={() => {
              const n = new URLSearchParams(sp);
              n.set("hub", h.id);
              setSp(n, { replace: true });
            }}
          >
            🏢 {h.name || h.city || "Hub"}
          </button>
        ))}
      </div>

      {/* Swipe 1:1 4 KPI Summary Cards Row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
          gap: 16,
          marginBottom: 20,
        }}
      >
        {/* KPI 1: Low Stock */}
        <div
          style={{
            background: "#FEF2F2",
            border: "1px solid #FCA5A5",
            borderRadius: 8,
            padding: "16px 20px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <span style={{ fontSize: "0.82rem", color: "#991B1B", fontWeight: 600, textTransform: "uppercase" }}>
            Low Stock
          </span>
          <strong style={{ fontSize: "1.45rem", color: "#B91C1C", marginTop: 4, letterSpacing: "-0.02em" }}>
            {kpis.lowCount} Items
          </strong>
          <span style={{ fontSize: "0.8rem", color: "#DC2626", marginTop: 2 }}>
            ({kpis.lowQty} Qty below reorder level)
          </span>
        </div>

        {/* KPI 2: Positive Stock */}
        <div
          style={{
            background: "#F0FDF4",
            border: "1px solid #86EFAC",
            borderRadius: 8,
            padding: "16px 20px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <span style={{ fontSize: "0.82rem", color: "#166534", fontWeight: 600, textTransform: "uppercase" }}>
            Positive Stock
          </span>
          <strong style={{ fontSize: "1.45rem", color: "#15803d", marginTop: 4, letterSpacing: "-0.02em" }}>
            {kpis.posCount} Items
          </strong>
          <span style={{ fontSize: "0.8rem", color: "#16a34a", marginTop: 2 }}>
            ({kpis.posQty} Qty ready to dispatch)
          </span>
        </div>

        {/* KPI 3: Stock Value Sales Price */}
        <div
          style={{
            background: "#EFF6FF",
            border: "1px solid #93C5FD",
            borderRadius: 8,
            padding: "16px 20px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <span style={{ fontSize: "0.82rem", color: "#1E40AF", fontWeight: 600, textTransform: "uppercase" }}>
            Stock Value (Sales Price)
          </span>
          <strong style={{ fontSize: "1.45rem", color: "#1D4ED8", marginTop: 4, letterSpacing: "-0.02em" }}>
            ₹ {formatRupees(kpis.valSalesPaise)}
          </strong>
          <span style={{ fontSize: "0.8rem", color: "#3B82F6", marginTop: 2 }}>
            At current retail / selling rates
          </span>
        </div>

        {/* KPI 4: Stock Value Purchase Price */}
        <div
          style={{
            background: "#F8FAFC",
            border: "1px solid #CBD5E1",
            borderRadius: 8,
            padding: "16px 20px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <span style={{ fontSize: "0.82rem", color: "#475569", fontWeight: 600, textTransform: "uppercase" }}>
            Stock Value (Purchase Price)
          </span>
          <strong style={{ fontSize: "1.45rem", color: "#0F172A", marginTop: 4, letterSpacing: "-0.02em" }}>
            ₹ {formatRupees(kpis.valCostPaise)}
          </strong>
          <span style={{ fontSize: "0.8rem", color: "#64748B", marginTop: 2 }}>
            Book cost value (excl. GST)
          </span>
        </div>
      </div>

      {/* Filter toolbar */}
      <div className="swipe-filter-bar">
        <div className="swipe-search-wrapper">
          <span className="swipe-search-icon">🔍</span>
          <input
            type="text"
            className="swipe-search-input"
            placeholder="Search product, SKU, HSN…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search"
          />
        </div>

        <select
          className="swipe-select"
          value={filter}
          onChange={(e) => setSp({ filter: e.target.value })}
          aria-label="Filter"
        >
          <option value="all">All Products</option>
          <option value="low">Low Stock Only</option>
          <option value="positive">In Stock (Positive)</option>
          <option value="tracked">Tracked Items</option>
          <option value="expiring">Batches & Expiry</option>
        </select>
      </div>

      <Msg st={st} />

      <Loader s={s}>
        <div className="swipe-table-card">
          <div className="swipe-table-wrap">
            <table className="swipe-table">
              <thead>
                <tr>
                  <th style={{ width: 60 }}>Item</th>
                  <th>Product & SKU</th>
                  <th style={{ width: 110 }}>Status ▾</th>
                  <th className="num" style={{ width: 130 }}>Available</th>
                  <th className="num" style={{ width: 110 }}>Reserved</th>
                  <th style={{ width: 110 }}>Reorder At</th>
                  <th style={{ width: 130 }}>Cost Price ₹</th>
                  <th style={{ width: 130 }}>Selling Price ₹</th>
                  <th style={{ width: 220, textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const avail = p.available ?? p.qty ?? 0;
                  const isLow = avail <= (p.reorderLevel || 0) || avail <= 0;
                  const initials = (p.name || "PR").slice(0, 2).toUpperCase();

                  return (
                    <tr key={p.id} className={isLow ? "row-warning" : ""}>
                      {/* Image Thumbnail */}
                      <td style={{ verticalAlign: "middle" }}>
                        {p.images?.[0] ? (
                          <div style={{ width: 40, height: 40, borderRadius: 6, overflow: "hidden", border: "1px solid #e2e8f0", background: "#f8fafc" }}>
                            <img src={p.images[0]} alt={p.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          </div>
                        ) : (
                          <div style={{ width: 40, height: 40, borderRadius: 6, background: "#dbeafe", color: "#1e40af", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "0.85rem" }}>
                            {initials}
                          </div>
                        )}
                      </td>

                      {/* Name & SKU */}
                      <td>
                        <div className="swipe-cell-stacked">
                          <strong style={{ color: "#0f172a" }}>{p.name}</strong>
                          <span className="swipe-cell-sub">
                            {p.sku} {p.hsn ? `· HSN ${p.hsn}` : ""} · {p.pack || "Standard"}
                          </span>
                        </div>
                      </td>

                      {/* Status */}
                      <td>
                        <span className={`swipe-pill ${isLow ? "cancelled" : "paid"}`}>
                          {isLow ? "● Low Stock" : "● In Stock"}
                        </span>
                      </td>

                      {/* Available Qty */}
                      <td className="num">
                        <strong style={{ color: isLow ? "#dc2626" : "#0f172a", fontSize: "0.95rem" }}>
                          {avail.toLocaleString("en-IN")} {p.unit || "pcs"}
                        </strong>
                      </td>

                      {/* Reserved */}
                      <td className="num">
                        {p.reserved ? `${p.reserved.toLocaleString("en-IN")} ${p.unit || "pcs"}` : "—"}
                      </td>

                      {/* Reorder Level */}
                      <td>
                        <input
                          className="w-sm"
                          type="number"
                          min="0"
                          defaultValue={p.reorderLevel}
                          onBlur={(e) => Number(e.target.value) !== p.reorderLevel && patch(p, { reorderLevel: Number(e.target.value) || 0 })}
                          aria-label="Reorder level"
                          style={{ width: 75, padding: "3px 6px" }}
                        />
                      </td>

                      {/* Cost Price */}
                      <td>
                        <input
                          className="w-sm"
                          inputMode="decimal"
                          defaultValue={p.costPrice != null ? p.costPrice / 100 : ""}
                          onBlur={(e) => {
                            const v = toPaise(e.target.value);
                            if (!Number.isNaN(v) && v !== p.costPrice) patch(p, { costPrice: v });
                          }}
                          aria-label="Cost price"
                          style={{ width: 85, padding: "3px 6px" }}
                        />
                      </td>

                      {/* Selling Price */}
                      <td>
                        <strong style={{ color: "#0f172a" }}>
                          {p.price != null ? `₹ ${(p.price / 100).toFixed(2)}` : "—"}
                        </strong>
                      </td>

                      {/* Actions */}
                      <td>
                        <div className="swipe-row-actions" style={{ justifyContent: "flex-end" }}>
                          <button
                            type="button"
                            className="swipe-btn-ghost"
                            style={{ color: "#16a34a", borderColor: "#bbf7d0", padding: "3px 8px" }}
                            onClick={() => setAdj({ p, kind: "in", qty: "", note: "", batchNumber: "", mfgDate: "", expDate: "" })}
                            title="Stock In (+)"
                          >
                            ↙ In
                          </button>
                          <button
                            type="button"
                            className="swipe-btn-ghost"
                            style={{ color: "#dc2626", borderColor: "#fecaca", padding: "3px 8px" }}
                            onClick={() => setAdj({ p, kind: "out", qty: "", note: "", batchNumber: "", mfgDate: "", expDate: "" })}
                            title="Stock Out (−)"
                          >
                            ↗ Out
                          </button>
                          <button
                            type="button"
                            className="swipe-btn-ghost"
                            style={{ padding: "3px 8px" }}
                            onClick={() => setHist(p)}
                            title="Movement History"
                          >
                            🕒
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </Loader>

      {/* Adjust Modal */}
      {adj && (
        <Modal title={`Adjust stock: ${adj.p.name}`} onClose={() => setAdj(null)}>
          <form className="form" onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const batch = adj.batchNumber.trim() ? { batchNumber: adj.batchNumber.trim(), mfgDate: adj.mfgDate, expDate: adj.expDate } : undefined;
              await api("/api/admin/stock/adjust", {
                method: "POST",
                body: { productId: adj.p.id, kind: adj.kind, qty: Number(adj.qty), note: adj.note, ...(batch ? { batch } : {}) }
              });
              setAdj(null);
              s.reload();
            }, "Stock updated ✓");
          }}>
            <p className="muted">Currently in stock: {adj.p.qty ?? adj.p.available ?? 0} {adj.p.unit || "pcs"}</p>
            <div className="grid2">
              <label className="field">
                <span>Action</span>
                <select value={adj.kind} onChange={(e) => setAdj({ ...adj, kind: e.target.value })}>
                  <option value="in">Stock in (+)</option>
                  <option value="out">Stock out (−) e.g. damaged, samples</option>
                  <option value="adjust">Correction (+ or −)</option>
                </select>
              </label>
              <label className="field">
                <span>Quantity</span>
                <input type="number" step="any" required min="0.01" value={adj.qty} onChange={(e) => setAdj({ ...adj, qty: e.target.value })} />
              </label>
            </div>
            <label className="field">
              <span>Note / Reason</span>
              <input maxLength={300} value={adj.note} onChange={(e) => setAdj({ ...adj, note: e.target.value })} placeholder="Opening stock, damaged, audit count…" />
            </label>
            <button className="btn" disabled={st.busy}>Save Adjustment</button>
          </form>
        </Modal>
      )}

      {/* Bulk Stock In/Out Modal */}
      {bulkModal && (
        <Modal title={`Bulk Items Stock ${bulkModal === "in" ? "In (+)" : "Out (−)"}`} onClose={() => setBulkModal(null)}>
          <div style={{ padding: "10px 0" }}>
            <p className="muted" style={{ marginBottom: 12 }}>
              Quickly record bulk inventory {bulkModal === "in" ? "receipts" : "deductions"} across multiple products.
            </p>
            <p className="notice" style={{ background: "#F8FAFC", border: "1px solid #CBD5E1", padding: 12, borderRadius: 6 }}>
              Choose a product from the list below and use the inline <strong>{bulkModal === "in" ? "↙ In" : "↗ Out"}</strong> button for instant batch/quantity adjustment, or import a stock reconciliation CSV.
            </p>
            <div className="btn-row" style={{ marginTop: 16 }}>
              <a className="btn ghost" href="/api/admin/reports/stock.csv">Download Current Stock CSV</a>
              <button type="button" className="btn" onClick={() => setBulkModal(null)}>Got It</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Movement History Modal */}
      {hist && (
        <Modal title={`Stock history: ${hist.name}`} wide onClose={() => setHist(null)}>
          <History id={hist.id} />
        </Modal>
      )}
    </>
  );
}

function History({ id }) {
  const s = useLoad(`/api/admin/stock/moves?productId=${id}`);
  return (
    <Loader s={s}>
      <table className="tbl">
        <thead>
          <tr>
            <th>When</th>
            <th>Type</th>
            <th className="num">Qty</th>
            <th>Ref</th>
            <th>Note</th>
            <th>By</th>
          </tr>
        </thead>
        <tbody>
          {s.data?.map((m) => (
            <tr key={m.id}>
              <td>{fmtTime(m.at)}</td>
              <td>{m.kind}</td>
              <td className="num">{m.qty > 0 ? "+" : ""}{m.qty}</td>
              <td>{m.ref}</td>
              <td>{m.note}</td>
              <td>{m.by}</td>
            </tr>
          ))}
          {s.data?.length === 0 && (
            <tr>
              <td colSpan="6" className="muted">No movements yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </Loader>
  );
}

function Batches() {
  const s = useLoad("/api/admin/stock/batches");
  return (
    <Loader s={s}>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Product</th>
              <th>Batch</th>
              <th>Mfg</th>
              <th>Expiry</th>
              <th className="num">Qty</th>
            </tr>
          </thead>
          <tbody>
            {s.data?.map((b) => (
              <tr key={b.productId + b.batchNumber} className={b.daysToExpiry != null && b.daysToExpiry <= 60 ? "low" : ""}>
                <td>
                  <strong>{b.name}</strong>
                  <small>{b.sku}</small>
                </td>
                <td>{b.batchNumber}</td>
                <td>{fmtDate(b.mfgDate)}</td>
                <td>
                  {fmtDate(b.expDate)}
                  {b.daysToExpiry != null && (
                    <small className={b.daysToExpiry <= 60 ? "due" : ""}>
                      {b.daysToExpiry < 0 ? "expired" : `${b.daysToExpiry} days`}
                    </small>
                  )}
                </td>
                <td className="num">{b.qty}</td>
              </tr>
            ))}
            {s.data?.length === 0 && (
              <tr>
                <td colSpan="5" className="muted">No batch stock yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Loader>
  );
}
