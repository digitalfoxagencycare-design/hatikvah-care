import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { can, useMe } from "./AdminApp.jsx";
import { DocView } from "./DocParts.jsx";
import { Loader, useLoad } from "./hooks.jsx";
import { ask } from "./toast.jsx";
import { DocEditor, fmtDate, fmtTime, Msg, Timeline, useAction } from "./ui.jsx";
import { openWhatsAppQuote, whatsAppQuote } from "./whatsappQuote.js";

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
  const wa = whatsAppQuote(q);
  const openWhatsApp = () => openWhatsAppQuote(q);
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
              <button type="button" className="btn btn-whatsapp" onClick={openWhatsApp}>📱 Send via WhatsApp</button>
              {["draft", "sent"].includes(q.status) && <button className="btn ghost" onClick={() => setEditing(true)}>Edit</button>}
              {["draft", "sent"].includes(q.status) && <button className="btn" disabled={st.busy} onClick={() => act("send", undefined, "Sent ✓ The customer gets a link by email/WhatsApp (see Automation & messages).")}>{q.status === "sent" ? "Send again" : "Send to customer"}</button>}
            </div></div>
          <Msg st={st} />

          {/* Settle / Conversion Banner */}
          {q.invoiceId && (
            <div className="panel" style={{ background: "#ECFDF5", border: "1px solid #10B981", borderRadius: "8px", padding: "12px 16px", marginBottom: "16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <strong style={{ color: "#065F46" }}>✓ Quotation Accepted & Settled</strong>
                <p style={{ margin: "2px 0 0", fontSize: "0.88rem", color: "#047857" }}>Tax Invoice <strong>{q.invoiceNumber || q.invoiceId}</strong> has been generated and stock has left the warehouse.</p>
              </div>
              <Link className="btn small" to={`/admin/invoices/${q.invoiceId}`}>Open Tax Invoice ↗</Link>
            </div>
          )}

          {/* Razorpay Online Payment & Dynamic QR Card */}
          {!q.invoiceId && ["draft", "sent", "accepted"].includes(q.status) && (
            <div className="panel" style={{ background: "#F8FAFC", border: "1px solid #CBD5E1", borderRadius: "10px", padding: "14px 18px", marginBottom: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
                <div>
                  <span style={{ fontSize: "0.75rem", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.05em", color: "#64748B" }}>Razorpay Online Payments</span>
                  <p style={{ margin: "4px 0 0", fontWeight: 600, color: "#0F172A" }}>
                    {q.payLink?.url ? "Active Payment Link Attached" : "Ready for Online Collection"}
                  </p>
                </div>
                <div className="btn-row">
                  {q.payLink?.url ? (
                    <>
                      <button type="button" className="btn ghost small" onClick={() => { navigator.clipboard.writeText(q.payLink.url); alert("Payment link copied to clipboard!"); }}>Copy Link</button>
                      <a className="btn ghost small" href={q.payLink.url} target="_blank" rel="noopener noreferrer">Open Link ↗</a>
                      <button type="button" className="btn small" onClick={() => act("paylink", undefined, "New link ready ✓")}>Refresh Link</button>
                    </>
                  ) : (
                    <button type="button" className="btn small" disabled={st.busy} onClick={() => act("paylink", undefined, "Payment link ready ✓ Paying it confirms the order and raises the invoice.")}>
                      ⚡ Generate Razorpay Link
                    </button>
                  )}
                </div>
              </div>
              {q.payLink?.url && (
                <div style={{ marginTop: "10px", padding: "8px 12px", background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "0.85rem" }}>
                  <code style={{ color: "#0284C7" }}>{q.payLink.url}</code>
                  <span style={{ color: "#059669", fontWeight: 600 }}>Amount: ₹{((q.payLink.amount || q.totals?.total || 0) / 100).toFixed(2)}</span>
                </div>
              )}
            </div>
          )}

          <DocView d={q} extraInfo={<p className="muted small-print">Valid until {fmtDate(q.validUntil)}{q.sentAt && <><br />Sent {fmtTime(q.sentAt)}</>}{q.customerResponse && <><br />Customer: {q.customerResponse.name} {q.customerResponse.note}</>}</p>}>
            {q.terms && <><h3>Terms</h3><p className="pre small-print">{q.terms}</p></>}
          </DocView>
          <div className="btn-row">
            {["draft", "sent", "expired"].includes(q.status) && <button className="btn ghost" onClick={() => act("status", { status: "accepted" }, "Marked accepted")}>Mark accepted</button>}
            {["draft", "sent", "expired"].includes(q.status) && <button className="btn ghost" onClick={() => act("status", { status: "rejected" }, "Marked rejected")}>Mark rejected</button>}
            {can(me, "invoices") && !q.invoiceId && ["draft", "sent", "accepted"].includes(q.status) && <button className="btn" onClick={() => run(async () => { const inv = await api(`/api/admin/quotes/${id}/invoice`, { method: "POST" }); nav(`/admin/invoices/${inv.id}`); })}>Create Tax Invoice</button>}
            {q.invoiceId && <Link className="btn" to={`/admin/invoices/${q.invoiceId}`}>Open Tax Invoice</Link>}
            {can(me, "orders") && !q.orderId && !q.invoiceId && ["draft", "sent", "accepted"].includes(q.status) && <button className="btn ghost" onClick={() => run(async () => { const o = await api(`/api/admin/quotes/${id}/order`, { method: "POST" }); nav(`/admin/orders/${o.id}`); })}>Sales order</button>}
            {q.orderId && <Link className="btn ghost" to={`/admin/orders/${q.orderId}`}>Open sales order</Link>}
            <button className="btn ghost" onClick={() => run(async () => { const n = await api(`/api/admin/quotes/${id}/duplicate`, { method: "POST" }); nav(`/admin/quotes/${n.id}`); })}>Duplicate</button>
            <Link className="btn ghost" to={`/admin/customers/${q.customerId}`}>Customer</Link>
            {q.status === "draft" && <button className="link danger" onClick={async () => { if (await ask("Delete this draft?", { danger: true, confirmLabel: "Delete" })) run(async () => { await api(`/api/admin/quotes/${id}`, { method: "DELETE" }); nav("/admin/quotes"); }); }}>Delete draft</button>}
          </div>
          <div className="panel"><h2>History</h2><Timeline entity="quote" entityId={q.id} items={q.activities} onAdded={s.reload} /></div>
        </>
      )}</Loader>
    </>
  );
}
