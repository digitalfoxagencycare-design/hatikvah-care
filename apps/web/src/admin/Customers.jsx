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
  return (
    <>
      <div className="row-between"><h1>Customers</h1><div className="btn-row"><a className="btn ghost" href="/api/admin/customers/export.csv">Export CSV</a><button className="btn" onClick={() => setSp({ new: "1" })}>+ Add customer</button></div></div>
      <div className="toolbar">
        <input type="search" placeholder="Search name, phone, GSTIN, city, tag…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter"><option value="">All</option><option value="due">Money due</option><option value="follow">Follow-up due</option></select>
      </div>
      <Loader s={s}>
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>Customer</th><th>Contact</th><th>State</th><th>Manager</th><th>Orders</th><th>Billed</th><th>Due</th></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td><Link to={`/admin/customers/${c.id}`}><strong>{c.name || "Unnamed"}</strong></Link><small>{c.gstin || "No GSTIN"}{Array.isArray(c.tags) && c.tags.length > 0 && ` · ${c.tags.join(", ")}`}</small></td>
                <td>{c.contactName || "—"}<small>{c.phone || ""}</small></td><td>{c.state || "—"}<small>{c.city || ""}</small></td><td>{personName(meta, c.assignedTo) || "—"}</td>
                <td>{c.orders || 0}<small>{c.lastOrderAt ? "last " + fmtDate(c.lastOrderAt) : ""}</small></td><td className="num">{rs(c.billed || 0)}</td><td className={"num" + (c.outstanding ? " due" : "")}>{rs(c.outstanding || 0)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan="7" className="muted">No customers yet. They are created from enquiries (Create customer) or with + Add customer.</td></tr>}
          </tbody>
        </table></div>
      </Loader>
      {sp.get("new") && <Modal title="Add customer" wide onClose={() => setSp({})}><CustomerForm onSaved={(c) => nav(`/admin/customers/${c.id}`)} /></Modal>}
    </>
  );
}
