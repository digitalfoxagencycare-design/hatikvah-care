import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { can, useMe } from "./AdminApp.jsx";
import { DocView } from "./DocParts.jsx";
import { Loader, useLoad } from "./hooks.jsx";
import { DocEditor, fmtDate, fmtTime, Msg, Timeline, useAction } from "./ui.jsx";

const strip = (items) => items.map(({ amount, tax, total, ...l }) => l);

export default function QuoteDetail() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const me = useMe(), nav = useNavigate();
  const isNew = id === "new";
  const s = useLoad(isNew ? "/api/admin/me" : `/api/admin/quotes/${id}`);
  const [editing, setEditing] = useState(false);
  const [st, run] = useAction();
  const q = isNew ? null : s.data;
  const save = (body) => run(async () => {
    const out = await api(isNew ? "/api/admin/quotes" : `/api/admin/quotes/${id}`, { method: isNew ? "POST" : "PUT", body });
    if (isNew) nav(`/admin/quotes/${out.id}`, { replace: true }); else { setEditing(false); s.reload(); }
  });
  const act = (path, body, ok) => run(async () => { const r = await api(`/api/admin/quotes/${id}/${path}`, { method: "POST", body }); s.reload(); return r; }, ok);
  const extra = (f, set) => <label className="field"><span>Valid until (blank = standard)</span><input type="date" value={f.validUntil || ""} onChange={(e) => set("validUntil", e.target.value)} /></label>;

  if (isNew || editing) return (
    <>
      <p><Link to="/admin/quotes">← Quotations</Link></p>
      <h1>{isNew ? "New quotation" : `Edit ${q.number}`}</h1>
      {!isNew && q.status === "sent" && <p className="notice">This quote was already sent. Saving creates version {(q.version || 1) + 1}; send it again so the customer sees the change.</p>}
      <DocEditor kind="quote" busy={st.busy} error={st.error} onSave={save} extra={extra}
        initial={isNew ? { customerId: sp.get("customer") || "", items: [], notes: "", terms: "", validUntil: "", placeOfSupply: "" } : { customerId: q.customerId, enquiryId: q.enquiryId || "", items: strip(q.items), notes: q.notes, terms: q.terms, validUntil: q.validUntil, placeOfSupply: q.placeOfSupply }} />
    </>
  );
  return (
    <>
      <p><Link to="/admin/quotes">← Quotations</Link></p>
      <Loader s={s}>{q && (
        <>
          <div className="row-between"><h1>Quotation {q.number} <small className="muted">v{q.version || 1}</small></h1>
            <div className="btn-row">
              <a className="btn ghost" href={`/doc/quote/${q.token}`} target="_blank" rel="noopener noreferrer">View / print PDF</a>
              {["draft", "sent"].includes(q.status) && <button className="btn ghost" onClick={() => setEditing(true)}>Edit</button>}
              {["draft", "sent"].includes(q.status) && <button className="btn" disabled={st.busy} onClick={() => act("send", undefined, "Sent ✓ The customer gets a link by email/WhatsApp (see Automation & messages).")}>{q.status === "sent" ? "Send again" : "Send to customer"}</button>}
            </div></div>
          <Msg st={st} />
          <DocView d={q} extraInfo={<p className="muted small-print">Valid until {fmtDate(q.validUntil)}{q.sentAt && <><br />Sent {fmtTime(q.sentAt)}</>}{q.customerResponse && <><br />Customer: {q.customerResponse.name} {q.customerResponse.note}</>}</p>}>
            {q.terms && <><h3>Terms</h3><p className="pre small-print">{q.terms}</p></>}
          </DocView>
          <div className="btn-row">
            {["draft", "sent", "expired"].includes(q.status) && <button className="btn ghost" onClick={() => act("status", { status: "accepted" }, "Marked accepted")}>Mark accepted</button>}
            {["draft", "sent", "expired"].includes(q.status) && <button className="btn ghost" onClick={() => act("status", { status: "rejected" }, "Marked rejected")}>Mark rejected</button>}
            {can(me, "orders") && !q.orderId && ["draft", "sent", "accepted"].includes(q.status) && <button className="btn" onClick={() => run(async () => { const o = await api(`/api/admin/quotes/${id}/order`, { method: "POST" }); nav(`/admin/orders/${o.id}`); })}>Create sales order</button>}
            {q.orderId && <Link className="btn" to={`/admin/orders/${q.orderId}`}>Open sales order</Link>}
            <button className="btn ghost" onClick={() => run(async () => { const n = await api(`/api/admin/quotes/${id}/duplicate`, { method: "POST" }); nav(`/admin/quotes/${n.id}`); })}>Duplicate</button>
            <Link className="btn ghost" to={`/admin/customers/${q.customerId}`}>Customer</Link>
            {q.status === "draft" && <button className="link danger" onClick={() => window.confirm("Delete this draft?") && run(async () => { await api(`/api/admin/quotes/${id}`, { method: "DELETE" }); nav("/admin/quotes"); })}>Delete draft</button>}
          </div>
          <div className="panel"><h2>History</h2><Timeline entity="quote" entityId={q.id} items={q.activities} onAdded={s.reload} /></div>
        </>
      )}</Loader>
    </>
  );
}
