import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { DocList } from "./DocParts.jsx";
import { Loader, useLoad } from "./hooks.jsx";
import { fmtDate, rs } from "./ui.jsx";

export default function Invoices() {
  const [sp, setSp] = useSearchParams();
  const status = sp.get("status") || "";
  const [tab, setTab] = useState("invoices");
  const s = useLoad("/api/admin/invoices" + (status ? `?status=${status}` : ""));
  const pays = useLoad(tab === "payments" ? "/api/admin/payments" : "/api/admin/me");
  return (
    <>
      <div className="row-between"><h1>Invoices & payments</h1><div className="btn-row"><a className="btn ghost" href="/api/admin/reports/sales-register.csv">GST sales register (CSV)</a><Link className="btn" to="/admin/invoices/new">+ New invoice</Link></div></div>
      <div className="tabs"><button className={tab === "invoices" ? "on" : ""} onClick={() => setTab("invoices")}>Invoices</button><button className={tab === "payments" ? "on" : ""} onClick={() => setTab("payments")}>Payments received</button></div>
      {tab === "invoices" ? (
        <>
          <div className="toolbar"><select value={status} onChange={(e) => setSp(e.target.value ? { status: e.target.value } : {})} aria-label="Status"><option value="">All</option>{["unpaid", "partial", "overdue", "paid", "void"].map((x) => <option key={x}>{x}</option>)}</select></div>
          <Loader s={s}>
            {s.data && <p className="muted" role="status">{s.data.length} invoices · balance due {rs(s.data.reduce((n, i) => n + (i.balance || 0), 0))}</p>}
            <DocList rows={s.data || []} base="/admin/invoices" cols={[["Due", (i) => fmtDate(i.dueDate)], ["Balance", (i) => rs(i.balance)]]} />
          </Loader>
        </>
      ) : (
        <Loader s={pays}>
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Date</th><th>Invoice</th><th>Customer</th><th>Mode</th><th>Reference</th><th className="num">Amount</th></tr></thead><tbody>
            {Array.isArray(pays.data) && pays.data.map((p) => <tr key={p.id}><td>{fmtDate(p.date)}</td><td><Link to={`/admin/invoices/${p.invoiceId}`}>{p.invoiceNumber}</Link></td><td>{p.customerName}</td><td>{p.mode}</td><td>{p.reference}</td><td className="num">{rs(p.amount)}</td></tr>)}
          </tbody></table></div>
          <p><a href="/api/admin/reports/payments.csv">Download payments (CSV)</a></p>
        </Loader>
      )}
    </>
  );
}
