import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import CustomerForm from "./CustomerForm.jsx";
import { Loader, useLoad } from "./hooks.jsx";
import { fmtDate, Modal, personName, rs, useMeta } from "./ui.jsx";

export default function Customers() {
  const s = useLoad("/api/admin/customers");
  const meta = useMeta(), nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("");

  const rows = useMemo(() => (s.data || []).filter((c) => {
    const tagsStr = Array.isArray(c.tags) ? c.tags.join(" ") : (c.tags || "");
    const searchStr = `${c.name || ""} ${c.contactName || ""} ${c.phone || ""} ${c.gstin || ""} ${c.city || ""} ${tagsStr}`.toLowerCase();
    return (!q || searchStr.includes(q.toLowerCase())) &&
      (!filter || (filter === "due" && (c.outstanding || 0) > 0) || (filter === "follow" && c.followUpAt && c.followUpAt <= new Date().toISOString().slice(0, 10)));
  }), [s.data, q, filter]);

  const totalOutstanding = useMemo(() => rows.reduce((acc, c) => acc + (c.outstanding || 0), 0), [rows]);
  const totalBilled = useMemo(() => rows.reduce((acc, c) => acc + (c.billed || 0), 0), [rows]);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* 1:1 Swipe Page Header */}
      <div className="row-between" style={{ alignItems: "center" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "1.35rem", fontWeight: 700, color: "#0F172A" }}>Customers & Parties</h1>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: "0.85rem" }}>
            Manage client accounts, credit limits, GSTIN profiles, and closing balances.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <a className="btn ghost" href="/api/admin/customers/export.csv">📥 Export CSV</a>
          <button className="btn" onClick={() => setSp({ new: "1" })}>+ Add Customer</button>
        </div>
      </div>

      {/* Toolbar / Search */}
      <div className="panel" style={{ padding: "12px 16px", background: "#FFFFFF", borderRadius: 8, border: "1px solid #E2E8F0", display: "flex", gap: 12, alignItems: "center" }}>
        <input
          type="search"
          placeholder="Search name, phone, GSTIN, city, tag…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search"
          style={{ flex: 1, padding: "8px 12px", borderRadius: 6, border: "1px solid #CBD5E1", fontSize: "0.88rem" }}
        />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter"
          style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid #CBD5E1", fontSize: "0.88rem", fontWeight: 500 }}
        >
          <option value="">All Parties</option>
          <option value="due">Money Due</option>
          <option value="follow">Follow-up Due</option>
        </select>
      </div>

      <Loader s={s}>
        <div className="panel" style={{ padding: 0, background: "#FFFFFF", borderRadius: 8, border: "1px solid #E2E8F0", overflow: "hidden" }}>
          <div className="tbl-wrap" style={{ overflowX: "auto" }}>
            <table className="tbl swipe-table" style={{ width: "100%", margin: 0 }}>
              <thead>
                <tr>
                  <th>Customer / GSTIN</th>
                  <th>Contact Person / Phone</th>
                  <th>Location</th>
                  <th>Manager</th>
                  <th className="num">Orders</th>
                  <th className="num">Total Billed</th>
                  <th className="num">Closing Balance</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <Link to={`/admin/customers/${c.id}`} style={{ fontWeight: 600, color: "#0F172A", textDecoration: "none" }}>
                          {c.name || "Unnamed"}
                        </Link>
                        {c.gstin ? (
                          <span style={{ fontSize: "0.72rem", background: "#DCFCE7", color: "#166534", padding: "1px 6px", borderRadius: 4, fontWeight: 700 }}>
                            {c.gstin}
                          </span>
                        ) : (
                          <span style={{ fontSize: "0.72rem", background: "#F1F5F9", color: "#64748B", padding: "1px 6px", borderRadius: 4 }}>
                            URP
                          </span>
                        )}
                      </div>
                      <small style={{ color: "#64748B", display: "block" }}>
                        {Array.isArray(c.tags) && c.tags.length > 0 ? c.tags.join(", ") : "Regular Buyer"}
                      </small>
                    </td>
                    <td>
                      <strong>{c.contactName || "—"}</strong>
                      <small style={{ display: "block", color: "#64748B" }}>{c.phone || "No phone"}</small>
                    </td>
                    <td>
                      <span>{c.city || "—"}</span>
                      <small style={{ display: "block", color: "#64748B" }}>{c.state || "Telangana"}</small>
                    </td>
                    <td>{personName(meta, c.assignedTo) || "—"}</td>
                    <td className="num">
                      <strong>{c.orders || 0}</strong>
                      <small style={{ display: "block", color: "#64748B" }}>{c.lastOrderAt ? fmtDate(c.lastOrderAt) : "—"}</small>
                    </td>
                    <td className="num">{rs(c.billed || 0)}</td>
                    <td className={"num" + (c.outstanding ? " due" : "")}>
                      <strong style={{ color: c.outstanding ? "#DC2626" : "#16A34A" }}>
                        {rs(c.outstanding || 0)}
                      </strong>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: 6 }}>
                        <Link to={`/admin/customers/${c.id}`} className="btn ghost small" style={{ padding: "4px 8px", fontSize: "0.78rem" }}>
                          📒 Ledger
                        </Link>
                        <Link to={`/admin/customers/${c.id}`} className="btn ghost small" style={{ padding: "4px 8px", fontSize: "0.78rem" }}>
                          Edit
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan="8" className="muted" style={{ padding: 40, textAlign: "center" }}>
                      No customers match your filter. Create with + Add Customer.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Swipe Sticky Summary Footer */}
          <div
            style={{
              padding: "12px 18px",
              background: "#F8FAFC",
              borderTop: "1px solid #E2E8F0",
              display: "flex",
              justifyContent: "flex-end",
              gap: 24,
              fontSize: "0.88rem",
              fontWeight: 600,
            }}
          >
            <span>
              <span style={{ color: "#64748B" }}>Total Customers: </span>
              <strong style={{ color: "#0F172A" }}>{rows.length}</strong>
            </span>
            <span>
              <span style={{ color: "#64748B" }}>Total Billed: </span>
              <strong style={{ color: "#0F172A" }}>{rs(totalBilled)}</strong>
            </span>
            <span>
              <span style={{ color: "#64748B" }}>Closing Due: </span>
              <strong style={{ color: "#DC2626" }}>{rs(totalOutstanding)}</strong>
            </span>
          </div>
        </div>
      </Loader>

      {sp.get("new") && (
        <Modal title="Add customer" wide onClose={() => setSp({})}>
          <CustomerForm onSaved={(c) => nav(`/admin/customers/${c.id}`)} />
        </Modal>
      )}
    </div>
  );
}
