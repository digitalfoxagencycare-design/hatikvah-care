import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { can, useMe } from "./AdminApp.jsx";
import CustomerForm from "./CustomerForm.jsx";
import { Loader, useLoad } from "./hooks.jsx";
import { fmtDate, Modal, personName, Pill, rs, Timeline, useMeta } from "./ui.jsx";

export default function CustomerDetail() {
  const { id } = useParams();
  const me = useMe(), meta = useMeta(), nav = useNavigate();
  const s = useLoad(`/api/admin/customers/${id}`);
  const [edit, setEdit] = useState(false);
  const [tab, setTab] = useState("quotes");
  const d = s.data, c = d?.customer;
  const del = async () => { if (!window.confirm(`Delete ${c.name}?`)) return; try { await api(`/api/admin/customers/${id}`, { method: "DELETE" }); nav("/admin/customers"); } catch (e) { window.alert(e.message); } };
  return (
    <>
      <p><Link to="/admin/customers">← Customers</Link></p>
      <Loader s={s}>{c && (
        <>
          <div className="row-between"><div><h1>{c.name}</h1><p className="muted">{c.contactName} · <a href={`tel:${c.phone}`}>{c.phone}</a> {c.email && <>· <a href={`mailto:${c.email}`}>{c.email}</a></>}</p></div>
            <div className="btn-row">
              {can(me, "quotes") && <Link className="btn" to={`/admin/quotes/new?customer=${c.id}`}>New quotation</Link>}
              {can(me, "invoices") && <Link className="btn ghost" to={`/admin/invoices/new?customer=${c.id}`}>New invoice</Link>}
              {can(me, "customers") && <button className="btn ghost" onClick={() => setEdit(true)}>Edit</button>}
            </div></div>
          <div className="tiles">
            <div className="tile"><strong>{rs(d.invoices.filter((i) => i.status !== "void").reduce((n, i) => n + i.totals.total, 0))}</strong><span>Billed in total</span></div>
            <div className={"tile" + (d.outstanding ? " warn" : "")}><strong>{rs(d.outstanding)}</strong><span>Balance due</span></div>
            <div className="tile"><strong>{d.orders.length}</strong><span>Orders</span><small>{d.orders[0] ? "last " + fmtDate(d.orders[0].createdAt) : ""}</small></div>
            <div className="tile"><strong>{c.state || "—"}</strong><span>{c.gstin || "No GSTIN"}</span><small>Terms {c.paymentTermsDays} days{c.reorderDays ? ` · re-orders every ${c.reorderDays} d` : ""}</small></div>
          </div>
          <div className="grid2 top">
            <div className="panel">
              <div className="tabs">{["quotes", "orders", "invoices", "payments", "enquiries"].map((t) => <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t} ({d[t].length})</button>)}</div>
              <table className="tbl"><tbody>
                {tab === "quotes" && d.quotes.map((q) => <tr key={q.id}><td><Link to={`/admin/quotes/${q.id}`}>{q.number}</Link><small>{fmtDate(q.createdAt)}</small></td><td className="num">{rs(q.totals.total)}</td><td><Pill s={q.status} /></td></tr>)}
                {tab === "orders" && d.orders.map((o) => <tr key={o.id}><td><Link to={`/admin/orders/${o.id}`}>{o.number}</Link><small>{fmtDate(o.createdAt)}</small></td><td className="num">{rs(o.totals.total)}</td><td><Pill s={o.status} /></td></tr>)}
                {tab === "invoices" && d.invoices.map((i) => <tr key={i.id}><td><Link to={`/admin/invoices/${i.id}`}>{i.number}</Link><small>{fmtDate(i.date)} · due {fmtDate(i.dueDate)}</small></td><td className="num">{rs(i.totals.total)}</td><td><Pill s={i.status} /></td></tr>)}
                {tab === "payments" && d.payments.map((p) => <tr key={p.id}><td>{fmtDate(p.date)}<small>{p.invoiceNumber}</small></td><td className="num">{rs(p.amount)}</td><td>{p.mode} {p.reference}</td></tr>)}
                {tab === "enquiries" && d.enquiries.map((e) => <tr key={e.id}><td>{e.ref}<small>{fmtDate(e.createdAt)}</small></td><td>{e.items.length} item{e.items.length === 1 ? "" : "s"}</td><td><Pill s={e.status} /></td></tr>)}
                {d[tab].length === 0 && <tr><td className="muted">None yet.</td></tr>}
              </tbody></table>
            </div>
            <div className="panel">
              <h2>Details</h2>
              <dl className="dl">
                <dt>Billing</dt><dd>{c.billingAddress || "—"}</dd><dt>Shipping</dt><dd>{c.shippingAddress || "Same as billing"}</dd>
                <dt>Account manager</dt><dd>{personName(meta, c.assignedTo) || "—"}</dd><dt>Next follow-up</dt><dd>{c.followUpAt ? fmtDate(c.followUpAt) : "—"}</dd>
                <dt>Tags</dt><dd>{c.tags.join(", ") || "—"}</dd><dt>Notes</dt><dd>{c.notes || "—"}</dd>
              </dl>
              {can(me, "customers") && <button className="link danger" onClick={del}>Delete customer</button>}
            </div>
          </div>
          <div className="panel"><h2>Activity</h2><Timeline entity="customer" entityId={c.id} items={d.activities} followUp onAdded={s.reload} /></div>
          {edit && <Modal title={`Edit ${c.name}`} wide onClose={() => setEdit(false)}><CustomerForm customer={c} onSaved={() => { setEdit(false); s.reload(); }} /></Modal>}
        </>
      )}</Loader>
    </>
  );
}
