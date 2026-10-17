import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { DocView } from "./DocParts.jsx";
import { Loader, useLoad } from "./hooks.jsx";
import { DocEditor, fmtDate, Modal, Msg, rs, Timeline, today, toPaise, useAction, useMeta } from "./ui.jsx";

export default function InvoiceDetail() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate(), meta = useMeta();
  const isNew = id === "new";
  const s = useLoad(isNew ? "/api/admin/me" : `/api/admin/invoices/${id}`);
  const [pay, setPay] = useState(null);
  const [st, run] = useAction();
  const inv = isNew ? null : s.data;
  const extra = (f, set) => <>
    <label className="field"><span>Invoice date</span><input type="date" value={f.date || ""} onChange={(e) => set("date", e.target.value)} /></label>
    <label className="field"><span>Due date (blank = customer terms)</span><input type="date" value={f.dueDate || ""} onChange={(e) => set("dueDate", e.target.value)} /></label>
    <label className="field"><span>Customer PO number</span><input maxLength={60} value={f.poNumber || ""} onChange={(e) => set("poNumber", e.target.value)} /></label>
  </>;
  if (isNew) return (
    <>
      <p><Link to="/admin/invoices">← Invoices</Link></p>
      <h1>New GST invoice</h1>
      <p className="notice">Most invoices are created from a sales order (Order → Create GST invoice). Use this for direct sales. Invoices cannot be edited after saving (GST rule); void and re-issue instead.</p>
      <DocEditor kind="invoice" busy={st.busy} error={st.error} extra={extra} initial={{ customerId: sp.get("customer") || "", items: [], notes: "", date: today(), dueDate: "", poNumber: "", placeOfSupply: "" }}
        onSave={(body) => window.confirm("Issue this invoice? It gets the next invoice number and cannot be edited afterwards.") && run(async () => { const out = await api("/api/admin/invoices", { method: "POST", body }); nav(`/admin/invoices/${out.id}`, { replace: true }); })} />
    </>
  );
  const payLink = meta.channels.payments !== "off";
  return (
    <>
      <p><Link to="/admin/invoices">← Invoices</Link></p>
      <Loader s={s}>{inv && (
        <>
          <div className="row-between"><h1>Invoice {inv.number}</h1>
            <div className="btn-row">
              <a className="btn ghost" href={`/doc/invoice/${inv.token}`} target="_blank" rel="noopener noreferrer">View / print PDF</a>
              {inv.status !== "void" && <button className="btn ghost" onClick={() => run(async () => { await api(`/api/admin/invoices/${id}/send`, { method: "POST" }); s.reload(); }, "Sent to the customer again ✓")}>Send to customer</button>}
              {inv.balance > 0 && <button className="btn" onClick={() => setPay({ amount: String(inv.balance / 100), date: today(), mode: "bank", reference: "", notes: "" })}>Record payment</button>}
            </div></div>
          <Msg st={st} />
          <div className="tiles">
            <div className="tile"><strong>{rs(inv.totals.total)}</strong><span>Invoice total</span><small>{fmtDate(inv.date)}</small></div>
            <div className="tile"><strong>{rs(inv.amountPaid)}</strong><span>Received</span></div>
            <div className={"tile" + (inv.overdue ? " warn" : "")}><strong>{rs(inv.balance)}</strong><span>Balance</span><small>{inv.overdue ? "Overdue since " : "Due "}{fmtDate(inv.dueDate)}</small></div>
          </div>
          <DocView d={inv} extraInfo={<p className="muted small-print">{inv.orderNumber && <>Order <Link to={`/admin/orders/${inv.orderId}`}>{inv.orderNumber}</Link><br /></>}{inv.poNumber && <>Customer PO {inv.poNumber}<br /></>}{inv.voidReason && <>Void: {inv.voidReason}</>}</p>}>
            {inv.payLink?.url ? <p>Online payment link: <a href={inv.payLink.url} target="_blank" rel="noopener noreferrer">{inv.payLink.url}</a></p>
              : inv.balance > 0 && <p className="muted small-print">{payLink ? <button className="link" onClick={() => run(async () => { await api(`/api/admin/invoices/${id}/paylink`, { method: "POST" }); s.reload(); })}>Create Razorpay payment link</button> : "Online payment links appear here once Razorpay is connected."}</p>}
          </DocView>
          <div className="panel">
            <h2>Payments</h2>
            <table className="tbl"><tbody>
              {inv.payments.map((p) => <tr key={p.id}><td>{fmtDate(p.date)}</td><td>{p.mode}</td><td>{p.reference}</td><td className="num">{rs(p.amount)}</td><td><button className="link danger" onClick={() => window.confirm("Remove this payment?") && run(async () => { await api(`/api/admin/payments/${p.id}`, { method: "DELETE" }); s.reload(); })}>Remove</button></td></tr>)}
              {inv.payments.length === 0 && <tr><td className="muted">No payments yet.</td></tr>}
            </tbody></table>
          </div>
          {inv.status !== "void" && inv.amountPaid === 0 && <button className="link danger" onClick={() => { const reason = window.prompt("Reason for voiding this invoice?"); if (reason !== null) run(async () => { await api(`/api/admin/invoices/${id}/void`, { method: "POST", body: { reason } }); s.reload(); }); }}>Void invoice</button>}
          <div className="panel"><h2>History</h2><Timeline entity="invoice" entityId={inv.id} items={inv.activities} onAdded={s.reload} /></div>
          {pay && (
            <Modal title={`Payment for ${inv.number}`} onClose={() => setPay(null)}>
              <form className="form" onSubmit={(e) => { e.preventDefault(); const amount = toPaise(pay.amount); if (!amount || Number.isNaN(amount)) return; run(async () => { await api(`/api/admin/invoices/${id}/payments`, { method: "POST", body: { ...pay, amount } }); setPay(null); s.reload(); }, "Payment recorded ✓ Receipt sent to the customer."); }}>
                <div className="grid2">
                  <label className="field"><span>Amount (₹)</span><input required inputMode="decimal" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></label>
                  <label className="field"><span>Date</span><input type="date" value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} /></label>
                  <label className="field"><span>Mode</span><select value={pay.mode} onChange={(e) => setPay({ ...pay, mode: e.target.value })}>{["bank", "upi", "cash", "cheque", "card", "razorpay", "other"].map((m) => <option key={m}>{m}</option>)}</select></label>
                  <label className="field"><span>Reference (UTR / cheque no.)</span><input maxLength={100} value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></label>
                </div>
                <button className="btn" disabled={st.busy}>Save payment</button><Msg st={st} />
              </form>
            </Modal>
          )}
        </>
      )}</Loader>
    </>
  );
}
