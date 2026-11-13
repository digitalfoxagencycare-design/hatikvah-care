import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { can, useMe } from "./AdminApp.jsx";
import { Loader, useLoad } from "./hooks.jsx";
import { Msg, useAction } from "./ui.jsx";
import { EmptyState } from "./visual.jsx";
import { openWhatsAppQuote } from "./whatsappQuote.js";

const TABS = [
  { key: "all", label: "All" },
  { key: "sent", label: "Sent" },
  { key: "accepted", label: "Accepted" },
  { key: "converted", label: "Converted" },
  { key: "draft", label: "Drafts" },
  { key: "expired", label: "Expired" },
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

function getExpiryNote(q) {
  if (q.status === "converted" || q.invoiceId) return "converted to invoice";
  if (!q.validUntil) return null;
  try {
    const due = new Date(q.validUntil);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    due.setHours(0, 0, 0, 0);
    const diff = Math.round((due - today) / (1000 * 60 * 60 * 24));
    if (diff < 0) return `expired ${Math.abs(diff)}d ago`;
    if (diff === 0) return "expires today";
    return `expires in ${diff}d`;
  } catch {
    return null;
  }
}

export default function Quotes() {
  const me = useMe();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const currentTab = sp.get("tab") || "all";

  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState("createdAt");
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const s = useLoad("/api/admin/quotes");
  const [st, run] = useAction();

  const allQuotes = s.data || [];

  // Tab counts
  const counts = useMemo(() => {
    let all = 0, sent = 0, accepted = 0, converted = 0, draft = 0, expired = 0;
    for (const q of allQuotes) {
      all++;
      if (q.status === "draft") draft++;
      else if (q.invoiceId || q.status === "converted") converted++;
      else if (q.status === "accepted") accepted++;
      else if (q.status === "expired") expired++;
      else if (q.status === "sent") sent++;
    }
    return { all, sent, accepted, converted, draft, expired };
  }, [allQuotes]);

  // Filtered
  const filtered = useMemo(() => {
    let list = [...allQuotes];

    if (currentTab === "draft") list = list.filter((q) => q.status === "draft");
    else if (currentTab === "sent") list = list.filter((q) => q.status === "sent");
    else if (currentTab === "accepted") list = list.filter((q) => q.status === "accepted");
    else if (currentTab === "converted") list = list.filter((q) => q.invoiceId || q.status === "converted");
    else if (currentTab === "expired") list = list.filter((q) => q.status === "expired");

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((x) => {
        const num = (x.number || "").toLowerCase();
        const cust = (x.customer?.name || "").toLowerCase();
        const ph = (x.customer?.phone || "").toLowerCase();
        return num.includes(q) || cust.includes(q) || ph.includes(q);
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
  }, [allQuotes, currentTab, search, sortField, sortAsc]);

  // Grand totals
  const totals = useMemo(() => {
    let totalVal = 0;
    let acceptedVal = 0;
    let pendingVal = 0;

    for (const q of filtered) {
      const amt = q.totals?.total ?? q.total ?? 0;
      totalVal += amt;
      if (q.status === "accepted" || q.invoiceId) acceptedVal += amt;
      else if (q.status !== "rejected" && q.status !== "expired") pendingVal += amt;
    }

    return { totalVal, acceptedVal, pendingVal };
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

  const convertToInvoice = (q) => {
    run(async () => {
      const inv = await api(`/api/admin/quotes/${q.id}/invoice`, { method: "POST" });
      nav(`/admin/invoices/${inv.id}`);
    }, `Quotation converted to Tax Invoice ${q.number}`);
  };

  return (
    <>
      <div className="swipe-page-header">
        <h1 className="swipe-title">
          <span>Quotations</span>
          <span className="swipe-play-badge" title="Quotations / Estimates">▶</span>
        </h1>
        <div className="swipe-header-actions">
          <Link className="swipe-btn-primary" to="/admin/quotes/new">
            + New Quotation
          </Link>
        </div>
      </div>

      {/* Tabs matching Swipe */}
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
              setSp(tab.key === "all" ? {} : { tab: tab.key });
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
            placeholder="Search by quote #, customer, phone etc.."
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
            title={search ? "No matching quotations" : `No ${currentTab} quotations`}
            body="Create a quotation with product photos and convert it to a tax invoice in one tap."
          >
            <Link className="swipe-btn-primary" to="/admin/quotes/new">
              + New Quotation
            </Link>
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
                    <th style={{ width: 110 }}>Status ▾</th>
                    <th className="sortable" onClick={() => toggleSort("number")} style={{ width: 160 }}>
                      Quote # {sortField === "number" ? (sortAsc ? "▲" : "▼") : "↕"}
                    </th>
                    <th>Customer</th>
                    <th className="sortable" onClick={() => toggleSort("createdAt")} style={{ width: 170 }}>
                      Date / Validity {sortField === "createdAt" ? (sortAsc ? "▲" : "▼") : "↕"}
                    </th>
                    <th style={{ width: 220, textAlign: "right" }}></th>
                  </tr>
                </thead>
                <tbody>
                  {pagedList.map((q) => {
                    const totalPaise = q.totals?.total ?? q.total ?? 0;
                    const creator = q.createdBy?.name || q.createdBy || "Admin";
                    const expiry = getExpiryNote(q);

                    let statusClass = "pending";
                    let statusLabel = q.status || "draft";

                    if (q.status === "draft") statusClass = "draft";
                    else if (q.status === "sent") statusClass = "sent";
                    else if (q.status === "accepted") statusClass = "accepted";
                    else if (q.invoiceId || q.status === "converted") {
                      statusClass = "paid";
                      statusLabel = "converted";
                    } else if (q.status === "expired") statusClass = "expired";

                    const canConvert = can(me, "invoices") && !q.invoiceId && ["draft", "sent", "accepted"].includes(q.status);

                    return (
                      <tr key={q.id}>
                        {/* Amount */}
                        <td>
                          <div className="swipe-amount-cell">
                            ₹ {formatRupees(totalPaise)}
                          </div>
                        </td>

                        {/* Status */}
                        <td>
                          <span className={`swipe-pill ${statusClass}`}>
                            {statusLabel}
                          </span>
                        </td>

                        {/* Quote # */}
                        <td>
                          <div className="swipe-cell-stacked">
                            <Link
                              to={`/admin/quotes/${q.id}`}
                              className="swipe-cell-title"
                              style={{ textDecoration: "none", color: "#0f172a" }}
                            >
                              {q.number || "Draft"}
                            </Link>
                            <span className="swipe-cell-sub">by {creator}</span>
                          </div>
                        </td>

                        {/* Customer */}
                        <td>
                          <div className="swipe-cell-stacked">
                            <span className="swipe-cell-title" title={q.customer?.name}>
                              {q.customer?.name || "Customer"}
                            </span>
                            <span className="swipe-cell-sub">
                              {q.customer?.phone ? `+91 ${q.customer.phone.replace(/\D/g, "").slice(-10)}` : "-"}
                            </span>
                          </div>
                        </td>

                        {/* Date / Validity */}
                        <td>
                          <div className="swipe-cell-stacked">
                            <span className="swipe-cell-title" style={{ fontWeight: 500 }}>
                              {formatDate(q.date || q.createdAt)}
                            </span>
                            {expiry && (
                              <span className={`swipe-cell-sub ${expiry.includes("expired") ? "alert" : ""}`}>
                                {expiry}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Actions */}
                        <td>
                          <div className="swipe-row-actions">
                            <Link className="swipe-btn-ghost" to={`/admin/quotes/${q.id}`}>
                              👁️ View
                            </Link>

                            <button
                              type="button"
                              className="swipe-btn-ghost"
                              onClick={() => openWhatsAppQuote(q)}
                              title="Send on WhatsApp"
                            >
                              ✈️ Send
                            </button>

                            {canConvert && (
                              <button
                                type="button"
                                className="swipe-btn-ghost"
                                style={{ color: "#2563eb", borderColor: "#bfdbfe" }}
                                disabled={st.busy}
                                onClick={() => convertToInvoice(q)}
                                title="Convert to Tax Invoice"
                              >
                                ⚡ Invoice
                              </button>
                            )}

                            {q.token && (
                              <a
                                className="swipe-btn-icon"
                                href={`/doc/quote/${q.token}`}
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

            {/* Bottom Summary Bar */}
            <div className="swipe-summary-bar">
              <div className="swipe-summary-chips">
                <div className="swipe-sum-chip total">
                  <span>Total Quotations</span>
                  <strong>₹ {formatRupees(totals.totalVal)}</strong>
                </div>
                <div className="swipe-sum-chip paid">
                  <span>Accepted</span>
                  <strong>₹ {formatRupees(totals.acceptedVal)}</strong>
                </div>
                <div className="swipe-sum-chip pending">
                  <span>Pending / Open</span>
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
