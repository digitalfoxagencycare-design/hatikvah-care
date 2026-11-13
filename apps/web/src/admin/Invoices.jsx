import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { CreateInvoiceModal } from "./CreateInvoiceModal.jsx";
import { Loader, useLoad } from "./hooks.jsx";
import { PayLinkActions } from "./PayLink.jsx";
import { Msg, rs, useAction } from "./ui.jsx";
import { EmptyState, Icon } from "./visual.jsx";

const TABS = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "paid", label: "Paid" },
  { key: "cancelled", label: "Cancelled" },
  { key: "draft", label: "Drafts" },
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

function formatRelativeTime(isoStr) {
  if (!isoStr) return "";
  try {
    const d = new Date(isoStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const timeStr = d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });

    if (diffDays === 0) return `Today, ${timeStr}`;
    if (diffDays === 1) return `Yesterday, ${timeStr}`;
    if (diffDays < 7) return `${diffDays} days ago`;
    return timeStr;
  } catch {
    return "";
  }
}

function getMode(inv) {
  if (inv.status === "draft") return "-";
  if (inv.source === "counter" || inv.source === "pos") return "Cash/UPI";
  if (inv.payments && inv.payments.length > 0) {
    const m = inv.payments[0]?.method;
    if (m === "cash") return "Cash";
    if (m === "bank" || m === "neft" || m === "rtgs") return "Bank";
    if (m === "razorpay" || m === "upi") return "UPI";
  }
  if (inv.status === "paid") return "UPI / Bank";
  return "-";
}

function getOverdueText(inv) {
  if (inv.status === "draft" || inv.status === "paid" || inv.status === "void") return null;
  if (!inv.dueDate) return null;
  try {
    const due = new Date(inv.dueDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    due.setHours(0, 0, 0, 0);
    const diffDays = Math.round((today - due) / (1000 * 60 * 60 * 24));
    if (diffDays > 0) return `since ${diffDays} day${diffDays === 1 ? "" : "s"}`;
    if (diffDays === 0) return "due today";
  } catch {}
  return null;
}

export default function Invoices() {
  const [sp, setSp] = useSearchParams();
  const currentTab = sp.get("tab") || "all";
  const nav = useNavigate();

  const [search, setSearch] = useState("");
  const [dateRange, setDateRange] = useState("all");
  const [sortField, setSortField] = useState("createdAt");
  const [sortAsc, setSortAsc] = useState(false);
  const [quickCreate, setQuickCreate] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const s = useLoad("/api/admin/invoices");
  const [st, run] = useAction();

  const allInvoices = s.data || [];

  // Tab counts
  const counts = useMemo(() => {
    let all = 0, pending = 0, paid = 0, cancelled = 0, draft = 0;
    for (const inv of allInvoices) {
      all++;
      if (inv.status === "draft") draft++;
      else if (inv.status === "void") cancelled++;
      else if (inv.status === "paid") paid++;
      else pending++; // unpaid or partial
    }
    return { all, pending, paid, cancelled, draft };
  }, [allInvoices]);

  // Filtered list
  const filtered = useMemo(() => {
    let list = [...allInvoices];

    // Status Tab filter
    if (currentTab === "draft") list = list.filter((i) => i.status === "draft");
    else if (currentTab === "cancelled") list = list.filter((i) => i.status === "void");
    else if (currentTab === "paid") list = list.filter((i) => i.status === "paid");
    else if (currentTab === "pending") list = list.filter((i) => i.status !== "paid" && i.status !== "void" && i.status !== "draft");

    // Search query filter
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((i) => {
        const num = (i.number || "").toLowerCase();
        const custName = (i.customer?.name || "").toLowerCase();
        const phone = (i.customer?.phone || "").toLowerCase();
        const po = (i.poNumber || "").toLowerCase();
        const amt = (((i.totals?.total ?? i.total ?? 0) / 100).toString()).toLowerCase();
        return num.includes(q) || custName.includes(q) || phone.includes(q) || po.includes(q) || amt.includes(q);
      });
    }

    // Date range filter
    if (dateRange === "this-year") {
      const currYear = new Date().getFullYear();
      list = list.filter((i) => (i.date || i.createdAt || "").startsWith(String(currYear)));
    } else if (dateRange === "this-month") {
      const ym = new Date().toISOString().slice(0, 7);
      list = list.filter((i) => (i.date || i.createdAt || "").startsWith(ym));
    } else if (dateRange === "fy2627") {
      list = list.filter((i) => {
        const d = i.date || i.createdAt || "";
        return d >= "2026-04-01" && d <= "2027-03-31";
      });
    }

    // Sorting
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
  }, [allInvoices, currentTab, search, dateRange, sortField, sortAsc]);

  // Grand totals across current filtered list
  const totals = useMemo(() => {
    let totalPaise = 0;
    let paidPaise = 0;
    let pendingPaise = 0;

    for (const inv of filtered) {
      if (inv.status === "void") continue;
      const t = inv.totals?.total ?? inv.total ?? 0;
      totalPaise += t;
      const bal = inv.balance ?? (inv.status === "paid" ? 0 : t);
      const paid = t - bal;
      paidPaise += paid > 0 ? paid : 0;
      pendingPaise += bal > 0 ? bal : 0;
    }

    return { totalPaise, paidPaise, pendingPaise };
  }, [filtered]);

  // Pagination
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

  const handleTabChange = (key) => {
    setPage(1);
    setSp(key === "all" ? {} : { tab: key });
  };

  const sendWhatsApp = (i) => {
    run(async () => {
      await api(`/api/admin/invoices/${i.id}/send`, { method: "POST" });
    }, `Invoice ${i.number} sent to ${i.customer?.name || "customer"}`);
  };

  return (
    <>
      {/* Top Header matching Swipe */}
      <div className="swipe-page-header">
        <h1 className="swipe-title">
          <span>Sales</span>
          <span className="swipe-play-badge" title="Sales Invoices">▶</span>
        </h1>
        <div className="swipe-header-actions">
          <Link
            className="swipe-btn-settings"
            to="/admin/reports"
            title="Open GSTR-1 Tax Hub"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none" }}
          >
            <span>🏛️</span> GSTR-1 Hub
          </Link>
          <a
            className="swipe-btn-settings"
            href="/api/admin/reports/sales-register.csv"
            title="Download GST Sales Register (CSV)"
          >
            <span>📄</span> Sales Register
          </a>
          <button
            type="button"
            className="swipe-btn-primary"
            onClick={() => setQuickCreate(true)}
          >
            + Create Invoice
          </button>
        </div>
      </div>

      {quickCreate && (
        <div style={{ marginBottom: 20 }}>
          <CreateInvoiceModal
            onClose={() => setQuickCreate(false)}
            onCreated={(newInv) => {
              setQuickCreate(false);
              s.reload();
              nav(`/admin/invoices/${newInv.id}`);
            }}
          />
        </div>
      )}

      {/* Tabs matching Swipe */}
      <div className="swipe-tabs-bar" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={currentTab === tab.key}
            className={`swipe-tab-item ${currentTab === tab.key ? "active" : ""}`}
            onClick={() => handleTabChange(tab.key)}
          >
            <span>{tab.label}</span>
            <span className="swipe-tab-count">{counts[tab.key] ?? 0}</span>
          </button>
        ))}
      </div>

      {/* Search & Filter row */}
      <div className="swipe-filter-bar">
        <div className="swipe-search-wrapper">
          <span className="swipe-search-icon">🔍</span>
          <input
            type="text"
            className="swipe-search-input"
            placeholder="Search by transaction, customers, invoice etc.."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>

        <select
          className="swipe-select"
          value={dateRange}
          onChange={(e) => {
            setDateRange(e.target.value);
            setPage(1);
          }}
        >
          <option value="all">All Time</option>
          <option value="this-year">This Year</option>
          <option value="this-month">This Month</option>
          <option value="fy2627">FY 26-27</option>
        </select>

        <a
          className="swipe-btn-ghost"
          href="/api/admin/reports/gstr-1.json?period=2026-11"
          target="_blank"
          rel="noopener noreferrer"
          title="GSTR-1 Tax Hub"
        >
          🏛️ GSTR-1 Hub
        </a>
      </div>

      <Msg st={st} />

      {/* Data Table */}
      <Loader s={s}>
        {filtered.length === 0 ? (
          <EmptyState
            title={search ? "No matching invoices found" : `No ${currentTab} invoices`}
            body={search ? "Try searching with a different term." : "Create a new invoice to get started."}
          >
            <button
              type="button"
              className="swipe-btn-primary"
              onClick={() => setQuickCreate(true)}
            >
              + Create Invoice
            </button>
          </EmptyState>
        ) : (
          <div className="swipe-table-card">
            <div className="swipe-table-wrap">
              <table className="swipe-table">
                <thead>
                  <tr>
                    <th className="sortable" onClick={() => toggleSort("amount")} style={{ width: 130 }}>
                      Amount {sortField === "amount" ? (sortAsc ? "▲" : "▼") : "↕"}
                    </th>
                    <th style={{ width: 120 }}>Status ▾</th>
                    <th style={{ width: 100 }}>Mode ▾</th>
                    <th className="sortable" onClick={() => toggleSort("number")} style={{ width: 160 }}>
                      Bill # {sortField === "number" ? (sortAsc ? "▲" : "▼") : "↕"}
                    </th>
                    <th>Customer</th>
                    <th className="sortable" onClick={() => toggleSort("createdAt")} style={{ width: 160 }}>
                      Date Created {sortField === "createdAt" ? (sortAsc ? "▲" : "▼") : "↕"}
                    </th>
                    <th style={{ width: 130, textAlign: "right" }}></th>
                  </tr>
                </thead>
                <tbody>
                  {pagedList.map((i) => {
                    const totalPaise = i.totals?.total ?? i.total ?? 0;
                    const mode = getMode(i);
                    const overdueNote = getOverdueText(i);
                    const creator = i.createdBy?.name || i.createdBy || "Admin";

                    // Status pill tone
                    let statusClass = "pending";
                    let statusLabel = "pending";

                    if (i.status === "draft") {
                      statusClass = "draft";
                      statusLabel = "draft";
                    } else if (i.status === "void") {
                      statusClass = "cancelled";
                      statusLabel = "cancelled";
                    } else if (i.status === "paid") {
                      statusClass = "paid";
                      statusLabel = "paid";
                    } else if (i.balance > 0 && i.status === "partial") {
                      statusClass = "pending";
                      statusLabel = "part paid";
                    }

                    return (
                      <tr key={i.id}>
                        {/* Amount */}
                        <td>
                          <div className="swipe-amount-cell">
                            ₹ {formatRupees(totalPaise)}
                          </div>
                        </td>

                        {/* Status */}
                        <td>
                          <div className="swipe-cell-stacked">
                            <div>
                              <span className={`swipe-pill ${statusClass}`}>
                                {statusLabel}
                              </span>
                            </div>
                            {overdueNote && (
                              <span className="swipe-cell-sub alert">
                                🔔 {overdueNote}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Mode */}
                        <td>
                          <span className="swipe-mode-badge">{mode}</span>
                        </td>

                        {/* Bill # */}
                        <td>
                          <div className="swipe-cell-stacked">
                            <Link
                              to={`/admin/invoices/${i.id}`}
                              className="swipe-cell-title"
                              style={{ textDecoration: "none", color: "#0f172a" }}
                            >
                              {i.number || "Draft"}
                            </Link>
                            <span className="swipe-cell-sub">
                              by {creator}
                            </span>
                          </div>
                        </td>

                        {/* Customer */}
                        <td>
                          <div className="swipe-cell-stacked">
                            <span className="swipe-cell-title" title={i.customer?.name}>
                              {i.customer?.name || "Walk-in Customer"}
                            </span>
                            <span className="swipe-cell-sub">
                              {i.customer?.phone ? `+91 ${i.customer.phone.replace(/\D/g, "").slice(-10)}` : "-"}
                            </span>
                          </div>
                        </td>

                        {/* Date */}
                        <td>
                          <div className="swipe-cell-stacked">
                            <span className="swipe-cell-title" style={{ fontWeight: 500 }}>
                              {formatDate(i.date || i.createdAt)}
                            </span>
                            <span className="swipe-cell-sub">
                              {formatRelativeTime(i.createdAt || i.date)}
                            </span>
                          </div>
                        </td>

                        {/* Actions */}
                        <td>
                          <div className="swipe-row-actions">
                            <Link
                              className="swipe-btn-ghost"
                              to={`/admin/invoices/${i.id}`}
                              title="View Invoice"
                            >
                              👁️ View
                            </Link>

                            {i.status !== "draft" && i.status !== "void" && (
                              <button
                                type="button"
                                className="swipe-btn-ghost"
                                disabled={st.busy}
                                onClick={() => sendWhatsApp(i)}
                                title="Send via WhatsApp"
                              >
                                ✈️ Send
                              </button>
                            )}

                            {i.token && (
                              <a
                                className="swipe-btn-icon"
                                href={`/doc/invoice/${i.token}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Print / PDF"
                              >
                                📄
                              </a>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Bottom Floating/Docked Summary Bar */}
            <div className="swipe-summary-bar">
              <div className="swipe-summary-chips">
                <div className="swipe-sum-chip total">
                  <span>Total</span>
                  <strong>₹ {formatRupees(totals.totalPaise)}</strong>
                </div>
                <div className="swipe-sum-chip paid">
                  <span>Paid</span>
                  <strong>₹ {formatRupees(totals.paidPaise)}</strong>
                  <span title="Settled payments">ⓘ</span>
                </div>
                <div className="swipe-sum-chip pending">
                  <span>Pending</span>
                  <strong>₹ {formatRupees(totals.pendingPaise)}</strong>
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
