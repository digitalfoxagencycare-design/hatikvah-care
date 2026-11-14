import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { Loader, useLoad } from "./hooks.jsx";
import { Msg, useAction } from "./ui.jsx";
import { EmptyState } from "./visual.jsx";

const SUB_TYPES = [
  { key: "purchases", label: "Purchases" },
  { key: "orders", label: "Purchase Orders" },
  { key: "debit_notes", label: "Debit Notes (Purchase Returns)" },
];

const TABS = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "received", label: "Received / Stock In" },
  { key: "paid", label: "Paid" },
  { key: "cancelled", label: "Cancelled" },
];

function formatRupees(paise) {
  const n = (paise || 0) / 100;
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(isoStr) {
  if (!isoStr) return "-";
  try {
    const d = new Date(isoStr);
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return isoStr;
  }
}

export default function Purchases() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const currentSub = sp.get("type") || "orders";
  const currentTab = sp.get("tab") || "all";

  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState("createdAt");
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const s = useLoad("/api/admin/purchases");
  const [st, run] = useAction();

  const allPurchases = s.data || [];

  // Tab counts
  const counts = useMemo(() => {
    let all = 0, pending = 0, received = 0, paid = 0, cancelled = 0;
    for (const p of allPurchases) {
      all++;
      if (p.status === "cancelled" || p.status === "void") cancelled++;
      else if (p.status === "paid") paid++;
      else if (p.received || p.status === "received") received++;
      else pending++;
    }
    return { all, pending, received, paid, cancelled };
  }, [allPurchases]);

  // Filtered
  const filtered = useMemo(() => {
    let list = [...allPurchases];

    if (currentTab === "cancelled") list = list.filter((p) => p.status === "cancelled" || p.status === "void");
    else if (currentTab === "paid") list = list.filter((p) => p.status === "paid");
    else if (currentTab === "received") list = list.filter((p) => p.received || p.status === "received");
    else if (currentTab === "pending") list = list.filter((p) => p.status !== "paid" && p.status !== "cancelled" && p.status !== "void");

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((x) => {
        const num = (x.number || "").toLowerCase();
        const sup = (x.supplierName || x.supplier?.name || "").toLowerCase();
        const inv = (x.supplierInvoiceNumber || "").toLowerCase();
        return num.includes(q) || sup.includes(q) || inv.includes(q);
      });
    }

    list.sort((a, b) => {
      let va, vb;
      if (sortField === "amount") {
        va = a.totals?.total ?? a.total ?? 0;
        vb = b.totals?.total ?? b.total ?? 0;
      } else if (sortField === "number") {
        va = a.number || "";
        vb = b.number || "";
      } else {
        va = a.createdAt || a.date || "";
        vb = b.createdAt || b.date || "";
      }
      if (va < vb) return sortAsc ? -1 : 1;
      if (va > vb) return sortAsc ? 1 : -1;
      return 0;
    });

    return list;
  }, [allPurchases, currentTab, search, sortField, sortAsc]);

  // Grand totals
  const totals = useMemo(() => {
    let totalVal = 0;
    let paidVal = 0;
    let pendingVal = 0;

    for (const p of filtered) {
      if (p.status === "cancelled" || p.status === "void") continue;
      const amt = p.totals?.total ?? p.total ?? 0;
      totalVal += amt;
      if (p.status === "paid") paidVal += amt;
      else pendingVal += amt;
    }

    return { totalVal, paidVal, pendingVal };
  }, [filtered]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pagedList = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  const toggleSort = (field) => {
    if (sortField === field) setSortAsc(!sortAsc);
    else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  const receiveStock = (p) => {
    run(async () => {
      await api(`/api/admin/purchases/${p.id}/receive`, { method: "POST", body: {} });
      s.reload();
    }, `Stock received for ${p.number} ✓`);
  };

  return (
    <>
      <div className="swipe-page-header">
        <h1 className="swipe-title">
          <span>Purchases</span>
          <span className="swipe-play-badge" title="Purchases / POs / Debit Notes">▶</span>
        </h1>
        <div className="swipe-header-actions">
          <Link className="swipe-btn-primary" to="/admin/purchase-orders/new">
            + New Purchase Order
          </Link>
        </div>
      </div>

      {/* Sub-type Pills */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, overflowX: "auto", paddingBottom: 4 }}>
        {SUB_TYPES.map((sub) => (
          <button
            key={sub.key}
            type="button"
            className="swipe-btn-ghost"
            style={{
              background: currentSub === sub.key ? "#0B57D0" : "#F8FAFC",
              color: currentSub === sub.key ? "#FFFFFF" : "#334155",
              borderColor: currentSub === sub.key ? "#0B57D0" : "#E2E8F0",
              fontWeight: currentSub === sub.key ? 700 : 500,
              fontSize: "0.85rem",
              padding: "6px 14px",
              borderRadius: "20px",
            }}
            onClick={() => {
              const n = new URLSearchParams(sp);
              n.set("type", sub.key);
              setSp(n, { replace: true });
            }}
          >
            {sub.label}
          </button>
        ))}
      </div>

      {/* Tabs */}
      <div className="swipe-tabs-bar" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={currentTab === tab.key}
            className={`swipe-tab-item ${currentTab === tab.key ? "active" : ""}`}
            onClick={() => {
              setPage(1);
              const n = new URLSearchParams(sp);
              if (tab.key === "all") n.delete("tab");
              else n.set("tab", tab.key);
              setSp(n);
            }}
          >
            <span>{tab.label}</span>
            <span className="swipe-tab-count">{counts[tab.key] ?? 0}</span>
          </button>
        ))}
      </div>

      {/* Search Bar */}
      <div className="swipe-filter-bar">
        <div className="swipe-search-wrapper">
          <span className="swipe-search-icon">🔍</span>
          <input
            type="text"
            className="swipe-search-input"
            placeholder="Search by PO #, supplier name, invoice # etc.."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
      </div>

      <Msg st={st} />

      <Loader s={s}>
        {filtered.length === 0 ? (
          <EmptyState
            title={search ? "No matching purchase orders" : `No ${currentTab} purchase orders`}
            body="Order stock from suppliers. When goods arrive, click Receive Stock to update inventory."
          >
            <Link className="swipe-btn-primary" to="/admin/purchase-orders/new">
              + New Purchase Order
            </Link>
          </EmptyState>
        ) : (
          <div className="swipe-table-card">
            <div className="swipe-table-wrap">
              <table className="swipe-table">
                <thead>
                  <tr>
                    <th className="sortable" onClick={() => toggleSort("amount")} style={{ width: 140 }}>
                      Amount {sortField === "amount" ? (sortAsc ? "▲" : "▼") : "↕"}
                    </th>
                    <th style={{ width: 130 }}>Status ▾</th>
                    <th className="sortable" onClick={() => toggleSort("number")} style={{ width: 160 }}>
                      PO / Bill # {sortField === "number" ? (sortAsc ? "▲" : "▼") : "↕"}
                    </th>
                    <th>Supplier / Vendor</th>
                    <th className="sortable" onClick={() => toggleSort("createdAt")} style={{ width: 160 }}>
                      Date / Expected {sortField === "createdAt" ? (sortAsc ? "▲" : "▼") : "↕"}
                    </th>
                    <th style={{ width: 180, textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedList.map((p) => {
                    const totalPaise = p.totals?.total ?? p.total ?? 0;
                    const supplier = p.supplierName || p.supplier?.name || "Supplier";
                    const gstin = p.supplierGstin || p.supplier?.gstin || "";

                    let statusClass = "pending";
                    let statusLabel = p.status || "pending";
                    if (p.received || p.status === "received") {
                      statusClass = "paid";
                      statusLabel = "received ●";
                    } else if (p.status === "paid") {
                      statusClass = "paid";
                      statusLabel = "paid ●";
                    } else if (p.status === "cancelled" || p.status === "void") {
                      statusClass = "cancelled";
                      statusLabel = "cancelled ●";
                    } else {
                      statusClass = "pending";
                      statusLabel = "pending ●";
                    }

                    return (
                      <tr key={p.id}>
                        {/* Amount */}
                        <td>
                          <div className="swipe-amount-cell">
                            ₹ {formatRupees(totalPaise)}
                          </div>
                          <span style={{ fontSize: "0.75rem", color: "#64748b" }}>
                            {p.items?.length || 0} item{(p.items?.length || 0) === 1 ? "" : "s"}
                          </span>
                        </td>

                        {/* Status */}
                        <td>
                          <span className={`swipe-pill ${statusClass}`}>
                            {statusLabel}
                          </span>
                        </td>

                        {/* Bill # */}
                        <td>
                          <div className="swipe-cell-stacked">
                            <Link
                              to={`/admin/purchase-orders/${p.id}`}
                              className="swipe-cell-title"
                              style={{ textDecoration: "none", color: "#0f172a", fontWeight: 700 }}
                            >
                              {p.number || "PO"}
                            </Link>
                            {p.supplierInvoiceNumber && (
                              <span className="swipe-cell-sub">
                                Inv: {p.supplierInvoiceNumber}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Supplier */}
                        <td>
                          <div className="swipe-cell-stacked">
                            <span className="swipe-cell-title" style={{ fontWeight: 600 }}>
                              {supplier}
                            </span>
                            <span className="swipe-cell-sub">
                              {gstin ? `GSTIN: ${gstin}` : (p.supplierPhone || "-")}
                            </span>
                          </div>
                        </td>

                        {/* Date */}
                        <td>
                          <div className="swipe-cell-stacked">
                            <span className="swipe-cell-title" style={{ fontWeight: 500 }}>
                              {formatDate(p.date || p.createdAt)}
                            </span>
                            {p.expectedDate && (
                              <span className="swipe-cell-sub">
                                Exp: {formatDate(p.expectedDate)}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Actions */}
                        <td>
                          <div className="swipe-row-actions" style={{ justifyContent: "flex-end" }}>
                            <Link
                              className="swipe-btn-ghost"
                              to={`/admin/purchase-orders/${p.id}`}
                              title="View Purchase Order"
                            >
                              👁️
                            </Link>

                            {!p.received && p.status !== "cancelled" && p.status !== "void" && (
                              <button
                                type="button"
                                className="swipe-btn-ghost"
                                style={{ color: "#16a34a", borderColor: "#bbf7d0", fontWeight: 700 }}
                                disabled={st.busy}
                                onClick={() => receiveStock(p)}
                                title="Receive stock into inventory"
                              >
                                📦 Receive
                              </button>
                            )}

                            <Link
                              className="swipe-btn-ghost"
                              to={`/admin/purchase-orders/${p.id}`}
                              title="Details / Print"
                            >
                              ⋯
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Bottom Summary Bar */}
            <div className="swipe-summary-bar">
              <div className="swipe-summary-chips">
                <div className="swipe-sum-chip total">
                  <span>Total Purchases</span>
                  <strong>₹ {formatRupees(totals.totalVal)}</strong>
                </div>
                <div className="swipe-sum-chip paid">
                  <span>Settled / Paid</span>
                  <strong>₹ {formatRupees(totals.paidVal)}</strong>
                </div>
                <div className="swipe-sum-chip pending">
                  <span>Pending</span>
                  <strong>₹ {formatRupees(totals.pendingVal)}</strong>
                </div>
              </div>

              <div className="swipe-pagination">
                <span>
                  {(page - 1) * pageSize + 1} - {Math.min(page * pageSize, filtered.length)} of {filtered.length}
                </span>
                <button
                  type="button"
                  className="swipe-page-btn"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  ‹
                </button>
                <button
                  type="button"
                  className="swipe-page-btn"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  ›
                </button>
              </div>
            </div>
          </div>
        )}
      </Loader>
    </>
  );
}
