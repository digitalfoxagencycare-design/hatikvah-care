import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { Loader, useLoad } from "./hooks.jsx";
import { fmtDate, Modal, Msg, useAction } from "./ui.jsx";
import { EmptyState } from "./visual.jsx";

const SUB_TYPES = [
  { key: "expenses", label: "Expenses" },
  { key: "income", label: "Indirect Income" },
];

const TABS = [
  { key: "all", label: "All Transactions" },
  { key: "pending", label: "Pending" },
  { key: "paid", label: "Paid" },
  { key: "cancelled", label: "Cancelled" },
];

const CATEGORIES = [
  "Rent",
  "Transport & Logistics",
  "Packaging Materials",
  "Electricity & Utilities",
  "Salaries & Wages",
  "Marketing & Advertising",
  "Legal & Accounting",
  "Office Supplies",
  "Repairs & Maintenance",
  "Other Expenses",
];

function formatRupees(paise) {
  const n = (paise || 0) / 100;
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function Expenses() {
  const [sp, setSp] = useSearchParams();
  const currentSub = sp.get("type") || "expenses";
  const currentTab = sp.get("tab") || "all";

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [showAddModal, setShowAddModal] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const s = useLoad("/api/admin/ledger");
  const [st, run] = useAction();

  // Filter ledger rows to expenses or indirect income
  const rawEntries = useMemo(() => {
    const list = s.data?.entries || s.data || [];
    return Array.isArray(list) ? list : [];
  }, [s.data]);

  const allExpenses = useMemo(() => {
    return rawEntries.filter((e) => {
      if (currentSub === "income") return e.kind === "income" || e.kind === "indirect_income";
      return e.kind === "expense" || e.account === "operating_expense" || e.kind === "operating_expense" || (!e.invoiceId && e.amount > 0 && e.kind !== "payment");
    });
  }, [rawEntries, currentSub]);

  // Tab counts
  const counts = useMemo(() => {
    let all = 0, pending = 0, paid = 0, cancelled = 0;
    for (const e of allExpenses) {
      all++;
      if (e.status === "cancelled" || e.status === "void") cancelled++;
      else if (e.status === "pending") pending++;
      else paid++;
    }
    return { all, pending, paid, cancelled };
  }, [allExpenses]);

  // Filtered
  const filtered = useMemo(() => {
    let list = [...allExpenses];

    if (currentTab === "cancelled") list = list.filter((e) => e.status === "cancelled" || e.status === "void");
    else if (currentTab === "pending") list = list.filter((e) => e.status === "pending");
    else if (currentTab === "paid") list = list.filter((e) => e.status !== "pending" && e.status !== "cancelled" && e.status !== "void");

    if (categoryFilter !== "all") {
      list = list.filter((e) => (e.category || e.notes || "").toLowerCase().includes(categoryFilter.toLowerCase()));
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((e) => {
        const cat = (e.category || "").toLowerCase();
        const ref = (e.ref || e.reference || "").toLowerCase();
        const note = (e.note || e.notes || "").toLowerCase();
        const payee = (e.payee || e.party || "").toLowerCase();
        return cat.includes(q) || ref.includes(q) || note.includes(q) || payee.includes(q);
      });
    }

    return list;
  }, [allExpenses, currentTab, categoryFilter, search]);

  // Grand totals
  const totals = useMemo(() => {
    let totalVal = 0, paidVal = 0, pendingVal = 0;
    for (const e of filtered) {
      if (e.status === "cancelled" || e.status === "void") continue;
      const amt = e.amount || 0;
      totalVal += amt;
      if (e.status === "pending") pendingVal += amt;
      else paidVal += amt;
    }
    return { totalVal, paidVal, pendingVal };
  }, [filtered]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pagedList = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  return (
    <>
      <div className="swipe-page-header">
        <h1 className="swipe-title">
          <span>{currentSub === "income" ? "Indirect Income" : "Expenses+"}</span>
          <span className="swipe-play-badge" title="Expenses & Indirect Income">▶</span>
        </h1>
        <div className="swipe-header-actions">
          <button type="button" className="swipe-btn-primary" onClick={() => setShowAddModal(true)}>
            + Add {currentSub === "income" ? "Income" : "Expense"}
          </button>
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

      {/* Status Tabs */}
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

      {/* Filter row */}
      <div className="swipe-filter-bar">
        <div className="swipe-search-wrapper">
          <span className="swipe-search-icon">🔍</span>
          <input
            type="text"
            className="swipe-search-input"
            placeholder="Search expense category, payee, reference..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>

        <select
          className="swipe-select"
          value={categoryFilter}
          onChange={(e) => {
            setCategoryFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="all">All Categories</option>
          {CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>
      </div>

      <Msg st={st} />

      <Loader s={s}>
        {filtered.length === 0 ? (
          <EmptyState
            title={`No ${currentTab} ${currentSub}`}
            body="Record operating expenses, rent, logistics, and supplies with GST input tax credit."
          >
            <button type="button" className="swipe-btn-primary" onClick={() => setShowAddModal(true)}>
              + Record {currentSub === "income" ? "Income" : "Expense"}
            </button>
          </EmptyState>
        ) : (
          <div className="swipe-table-card">
            <div className="swipe-table-wrap">
              <table className="swipe-table">
                <thead>
                  <tr>
                    <th style={{ width: 140 }}>Amount</th>
                    <th style={{ width: 120 }}>Status ▾</th>
                    <th style={{ width: 160 }}>Category</th>
                    <th>Payee / Vendor</th>
                    <th style={{ width: 160 }}>Date / Mode</th>
                    <th style={{ width: 100, textAlign: "right" }}></th>
                  </tr>
                </thead>
                <tbody>
                  {pagedList.map((e, idx) => {
                    const amt = e.amount || 0;
                    const cat = e.category || e.kind || "Expense";
                    const payee = e.payee || e.party || "Direct Payment";
                    const mode = e.mode || e.paymentMode || "Bank / Cash";
                    const date = e.date || e.at || e.createdAt;

                    return (
                      <tr key={e.id || idx}>
                        <td>
                          <div className="swipe-amount-cell">
                            ₹ {formatRupees(amt)}
                          </div>
                        </td>
                        <td>
                          <span className={`swipe-pill ${e.status === "pending" ? "pending" : "paid"}`}>
                            {e.status === "pending" ? "pending ●" : "paid ●"}
                          </span>
                        </td>
                        <td>
                          <strong style={{ color: "#0f172a" }}>{cat}</strong>
                        </td>
                        <td>
                          <div className="swipe-cell-stacked">
                            <span className="swipe-cell-title">{payee}</span>
                            {e.notes && <span className="swipe-cell-sub">{e.notes}</span>}
                          </div>
                        </td>
                        <td>
                          <div className="swipe-cell-stacked">
                            <span className="swipe-cell-title">{fmtDate(date)}</span>
                            <span className="swipe-cell-sub">{mode}</span>
                          </div>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <span className="swipe-btn-icon" title="View details">👁️</span>
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
                  <span>Total</span>
                  <strong>₹ {formatRupees(totals.totalVal)}</strong>
                </div>
                <div className="swipe-sum-chip paid">
                  <span>Paid / Settled</span>
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

      {showAddModal && (
        <AddExpenseModal
          subType={currentSub}
          onClose={() => setShowAddModal(false)}
          onSaved={() => {
            setShowAddModal(false);
            s.reload();
          }}
        />
      )}
    </>
  );
}

function AddExpenseModal({ subType, onClose, onSaved }) {
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [amount, setAmount] = useState("");
  const [payee, setPayee] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [mode, setMode] = useState("bank");
  const [hasGst, setHasGst] = useState(false);
  const [gstRate, setGstRate] = useState(18);
  const [notes, setNotes] = useState("");
  const [st, run] = useAction();

  const handleSave = (e) => {
    e.preventDefault();
    const paise = Math.round(Number(amount) * 100);
    if (!paise || paise <= 0) return alert("Please enter a valid amount");

    run(async () => {
      await api("/api/admin/ledger/entries", {
        method: "POST",
        body: {
          kind: subType === "income" ? "income" : "expense",
          account: subType === "income" ? "indirect_income" : "operating_expense",
          amount: paise,
          category,
          payee,
          date,
          mode,
          hasGst,
          gstRate: hasGst ? Number(gstRate) : 0,
          notes,
        },
      });
      onSaved();
    }, `${subType === "income" ? "Income" : "Expense"} recorded successfully ✓`);
  };

  return (
    <Modal title={`Record ${subType === "income" ? "Indirect Income" : "Operating Expense"}`} onClose={onClose}>
      <form className="form" onSubmit={handleSave}>
        <div className="grid2">
          <label className="field">
            <span>Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Amount (₹)</span>
            <input
              type="number"
              step="any"
              min="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 5000"
            />
          </label>
        </div>

        <div className="grid2">
          <label className="field">
            <span>Payee / Vendor</span>
            <input
              type="text"
              value={payee}
              onChange={(e) => setPayee(e.target.value)}
              placeholder="e.g. Landlord, Electricity Board, Transporter"
            />
          </label>
          <label className="field">
            <span>Date</span>
            <input
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
        </div>

        <div className="grid2">
          <label className="field">
            <span>Payment Mode</span>
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="bank">Bank Transfer / NEFT / RTGS</option>
              <option value="upi">UPI / QR</option>
              <option value="cash">Cash</option>
              <option value="cheque">Cheque</option>
              <option value="card">Credit / Debit Card</option>
            </select>
          </label>
          <label className="checks" style={{ alignSelf: "center", paddingTop: 18 }}>
            <input
              type="checkbox"
              checked={hasGst}
              onChange={(e) => setHasGst(e.target.checked)}
            />
            <span>Eligible for GST Input Tax Credit (ITC)</span>
          </label>
        </div>

        {hasGst && (
          <label className="field">
            <span>GST Rate (%)</span>
            <select value={gstRate} onChange={(e) => setGstRate(e.target.value)}>
              <option value="5">5%</option>
              <option value="12">12%</option>
              <option value="18">18%</option>
              <option value="28">28%</option>
            </select>
          </label>
        )}

        <label className="field">
          <span>Notes / Reference No.</span>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Bill # 492 / Oct Rent"
          />
        </label>

        <Msg st={st} />
        <button className="btn" disabled={st.busy}>Save Entry</button>
      </form>
    </Modal>
  );
}
