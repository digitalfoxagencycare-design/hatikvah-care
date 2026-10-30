import { Fragment, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, money } from "../api.js";
import OtpLogin from "../components/OtpLogin.jsx";
import Seo from "../components/Seo.jsx";
import { useSite } from "../data.jsx";
import "./buyer.css";

const fmt = (s) => (s ? new Date(s.length === 10 ? s + "T00:00:00" : s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—");
const TABS = [["quotes", "Quotations"], ["orders", "Orders & delivery"], ["invoices", "Invoices"]];
const TRACK = { created: "Pickup booked", assigned: "Rider assigned", picked: "Picked up", in_transit: "In transit", out_for_delivery: "Out for delivery", delivered: "Delivered", cancelled: "Cancelled", returned: "Returned" };
const QUOTE = { sent: "Awaiting your approval", accepted: "Approved", converted: "Approved · order placed", expired: "Expired", rejected: "Declined" };

/** Buyer portal (/account): a hotel or clinic signs in with a WhatsApp code and sees its quotations, orders, deliveries and invoices. */
export default function BuyerPortal() {
  const { settings } = useSite();
  const [sp, setSp] = useSearchParams();
  const [me, setMe] = useState(undefined);
  const tab = TABS.some(([k]) => k === sp.get("tab")) ? sp.get("tab") : "quotes";
  useEffect(() => { api("/api/shop/me").then(setMe).catch(() => setMe(null)); }, []);
  async function logout() { await api("/api/shop/logout", { method: "POST" }).catch(() => {}); setMe(null); }

  if (me === undefined) return <div className="center-note">Loading…</div>;
  if (!me) return (
    <div className="wrap narrow account"><Seo title="Buyer sign-in" />
      {settings.shop?.otp ? <OtpLogin title="Sign in to your buyer account" onDone={setMe} />
        : <div className="empty"><p>Sign-in is not available right now. For quotes, orders and invoices, message us on WhatsApp{settings.phone ? ` or call ${settings.phone}` : ""}.</p></div>}
    </div>
  );
  return (
    <div className="wrap account buyer">
      <Seo title="My account" />
      <div className="row-between"><div><h1>{me.company || me.name || "My account"}</h1><p className="muted">{me.phone}</p></div><button className="btn ghost small" onClick={logout}>Sign out</button></div>
      {sp.get("order") && <p className="notice" role="status">Thank you! Payment for {sp.get("order")} is being confirmed. It shows as paid here within a minute.</p>}
      {sp.get("paid") && <p className="notice" role="status">Thank you! Payment for quotation {sp.get("paid")} is being confirmed. Your GST invoice appears under Invoices once it is received.</p>}
      <div className="buyer-tabs" role="tablist">{TABS.map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setSp({ tab: k })}>{label}</button>)}</div>
      {tab === "quotes" && <Quotes />}
      {tab === "orders" && <Orders />}
      {tab === "invoices" && <Invoices />}
    </div>
  );
}

function useList(path) {
  const [s, setS] = useState({ data: null, error: null });
  const load = () => api(path).then((data) => setS({ data, error: null })).catch((e) => setS({ data: null, error: e.message }));
  useEffect(() => { load(); }, [path]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...s, reload: load };
}
const Lines = ({ items }) => (
  <table className="buyer-lines"><thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">GST</th><th className="num">Amount</th></tr></thead>
    <tbody>{items.map((it, i) => <tr key={i}><td>{it.name}{it.perUnit > 1 && <small>{it.pieces.toLocaleString("en-IN")} pcs</small>}</td><td className="num">{it.qty.toLocaleString("en-IN")} {it.unit}</td><td className="num">{money(it.rate)}</td><td className="num">{it.gstRate}%</td><td className="num">{money(it.total)}</td></tr>)}</tbody>
  </table>
);
const Sum = ({ t, interState }) => <p className="buyer-sum">Taxable {money(t.taxable)} · {interState ? `IGST ${money(t.igst)}` : `CGST ${money(t.cgst)} + SGST ${money(t.sgst)}`} · <strong>Total {money(t.total)}</strong></p>;
const State = ({ s }) => (!s.data && !s.error ? <p className="muted">Loading…</p> : s.error ? <p className="alert" role="alert">{s.error} <button className="link" onClick={s.reload}>Try again</button></p> : null);

function Quotes() {
  const s = useList("/api/buyer/quotes");
  const [approve, setApprove] = useState(null);
  const [st, setSt] = useState({ busy: false, error: null, ok: null });
  async function accept(e) {
    e.preventDefault();
    setSt({ busy: true, error: null, ok: null });
    try {
      const r = await api(`/api/buyer/quotes/${approve.q.id}/accept`, { method: "POST", body: { name: approve.name, note: approve.note, pay: approve.pay } });
      if (r.payUrl) return window.location.assign(r.payUrl);
      setApprove(null); setSt({ busy: false, error: null, ok: r.payError || `Approved ✓${r.orderNumber ? ` Order ${r.orderNumber} is confirmed.` : ""} We will send the GST invoice.` }); s.reload();
    } catch (err) { setSt({ busy: false, error: err.message, ok: null }); }
  }
  return (
    <>
      <State s={s} />
      {st.ok && <p className="notice" role="status">{st.ok}</p>}
      {s.data?.length === 0 && <div className="empty"><p>No quotations yet. Add products to your quote list and send it, or message us on WhatsApp.</p><Link className="btn" to="/shop">Browse products</Link></div>}
      <div className="orders">{s.data?.map((q) => (
        <article key={q.id} className="panel order-card">
          <div className="row-between"><div><strong>{q.number}</strong>{q.version > 1 && <span className="muted"> v{q.version}</span>} <span className="muted">· {fmt(q.sentAt || q.createdAt)}{q.validUntil && ` · valid until ${fmt(q.validUntil)}`}</span></div><span className={"pill-s " + q.status}>{QUOTE[q.status] || q.status}</span></div>
          <Lines items={q.items} /><Sum t={q.totals} interState={q.interState} />
          <div className="btn-row">
            <a className="btn ghost small" href={q.link} target="_blank" rel="noopener noreferrer">View / print</a>
            {q.canAccept && <button className="btn small" onClick={() => { setSt({ busy: false, error: null, ok: null }); setApprove({ q, name: "", note: "", pay: true }); }}>Approve &amp; pay</button>}
            {q.payUrl && <a className="btn small" href={q.payUrl}>Pay now</a>}
            {q.orderNumber && <span className="muted">Order {q.orderNumber}</span>}
          </div>
        </article>
      ))}</div>
      {approve && (
        <div className="modal-back" role="dialog" aria-modal="true" aria-label={`Approve ${approve.q.number}`} onClick={(e) => e.target === e.currentTarget && setApprove(null)}>
          <form className="panel form buyer-modal" onSubmit={accept}>
            <h2>Approve {approve.q.number}</h2>
            <p>Total <strong>{money(approve.q.totals.total)}</strong> incl. GST. Approving confirms the order on these prices and terms.</p>
            <label className="field"><span>Your name</span><input required minLength={2} maxLength={100} autoFocus value={approve.name} onChange={(e) => setApprove({ ...approve, name: e.target.value })} /></label>
            <label className="field"><span>Note for us (optional)</span><input maxLength={500} value={approve.note} onChange={(e) => setApprove({ ...approve, note: e.target.value })} placeholder="Delivery date, PO number…" /></label>
            <label className="checks"><input type="checkbox" checked={approve.pay} onChange={(e) => setApprove({ ...approve, pay: e.target.checked })} /> Pay online now (if available); otherwise we send the invoice</label>
            {st.error && <p className="alert" role="alert">{st.error}</p>}
            <div className="btn-row"><button className="btn" disabled={st.busy}>{st.busy ? "Saving…" : "Approve"}</button><button type="button" className="link" onClick={() => setApprove(null)}>Cancel</button></div>
          </form>
        </div>
      )}
    </>
  );
}

function Orders() {
  const s = useList("/api/buyer/orders");
  const { add, settings } = useSite();
  const nav = useNavigate();
  const [msg, setMsg] = useState(null);
  async function reorder(o) {
    setMsg(null);
    try {
      const r = await api(`/api/buyer/orders/${o.id}/reorder`);
      for (const it of r.items) add(it.productId, it.qty, it.variant);
      if (!r.items.length) return setMsg({ error: `Nothing from ${o.number} can be ordered online right now${r.skipped.length ? ` (${r.skipped.map((x) => `${x.name}: ${x.reason}`).join("; ")})` : ""}. Please ask us for a quote.` });
      nav("/cart", { state: { reorder: r } });
    } catch (e) { setMsg({ error: e.message }); }
  }
  return (
    <>
      <State s={s} />
      {msg?.error && <p className="alert" role="alert">{msg.error}</p>}
      {s.data?.length === 0 && <div className="empty"><p>No orders yet.</p><Link className="btn" to="/shop">Start shopping</Link></div>}
      <div className="orders">{s.data?.map((o) => (
        <article key={o.id} className="panel order-card">
          <div className="row-between"><div><strong>{o.number}</strong> <span className="muted">· {fmt(o.createdAt)}{o.poNumber && ` · PO ${o.poNumber}`}</span></div><span className={"pill-s " + o.status}>{o.status}</span></div>
          <Lines items={o.items} /><Sum t={o.totals} interState={o.interState} />
          {o.tracking ? (
            <div className="track">
              <div className="row-between"><span><strong>{o.tracking.courier || "Courier"}</strong>{o.tracking.awb && <> · AWB {o.tracking.awb}</>}</span><span className={"track-badge " + o.tracking.status}>{TRACK[o.tracking.status] || o.tracking.status}</span></div>
              {o.tracking.history.length > 0 && <ol className="track-steps">{o.tracking.history.map((h, i) => <li key={i}>{TRACK[h.status] || h.status} <small>{fmt(h.at)}</small></li>)}</ol>}
              {o.tracking.url && o.tracking.status !== "delivered" && <a className="btn small" href={o.tracking.url} target="_blank" rel="noopener noreferrer">Track live ↗</a>}
            </div>
          ) : o.dispatch && <p className="muted">Dispatched {fmt(o.dispatch.date)}{o.dispatch.transporter && ` via ${o.dispatch.transporter}`}{o.dispatch.trackingNo && ` · ${o.dispatch.trackingNo}`}</p>}
          <div className="btn-row">
            {o.dispatch && <a className="btn ghost small" href={o.dispatch.link} target="_blank" rel="noopener noreferrer">Delivery challan</a>}
            {o.invoice && <a className="btn ghost small" href={o.invoice.link} target="_blank" rel="noopener noreferrer">Invoice {o.invoice.number}</a>}
            {o.invoice?.payUrl && <a className="btn small" href={o.invoice.payUrl}>Pay {money(o.invoice.balance)}</a>}
            {settings.shop?.cart && <button className="btn ghost small" onClick={() => reorder(o)}>Reorder</button>}
          </div>
        </article>
      ))}</div>
    </>
  );
}

function Invoices() {
  const s = useList("/api/buyer/invoices");
  const due = (s.data || []).reduce((n, i) => n + i.balance, 0);
  return (
    <>
      <State s={s} />
      {s.data?.length > 0 && <p className="buyer-sum">Outstanding <strong>{money(due)}</strong> across {s.data.filter((i) => i.balance > 0).length} invoice(s)</p>}
      {s.data?.length === 0 && <div className="empty"><p>No invoices yet.</p></div>}
      {s.data?.length > 0 && (
        <div className="tbl-scroll"><table className="buyer-lines inv">
          <thead><tr><th>Invoice</th><th>Date</th><th>Due</th><th className="num">Taxable</th><th className="num">GST</th><th className="num">Total</th><th className="num">Balance</th><th></th></tr></thead>
          <tbody>{s.data.map((i) => (<Fragment key={i.id}>
            <tr>
              <td><strong>{i.number}</strong>{i.orderNumber && <small>{i.orderNumber}</small>}</td><td>{fmt(i.date)}</td>
              <td>{fmt(i.dueDate)}{i.overdue && <small className="due">overdue</small>}</td>
              <td className="num">{money(i.totals.taxable)}</td>
              <td className="num">{money(i.totals.tax)}<small>{i.interState ? "IGST" : `CGST ${money(i.totals.cgst)} + SGST ${money(i.totals.sgst)}`}</small></td>
              <td className="num">{money(i.totals.total)}</td>
              <td className="num">{i.balance > 0 ? money(i.balance) : <span className="pill-s paid">{i.status === "credited" ? "credited" : "paid"}</span>}{i.refundDue > 0 && <small>refund due {money(i.refundDue)}</small>}</td>
              <td className="btn-row"><a className="btn ghost small" href={i.link} target="_blank" rel="noopener noreferrer">View / download</a>{i.payUrl && <a className="btn small" href={i.payUrl}>Pay</a>}</td>
            </tr>
            {i.creditNotes.map((c) => (
              <tr key={c.id} className="credit-row">
                <td><strong>{c.number}</strong><small>Credit note · {String(c.reason).replace(/_/g, " ")}</small></td><td>{fmt(c.date)}</td><td></td>
                <td className="num">−{money(c.totals.taxable)}</td><td className="num">−{money(c.totals.tax)}</td><td className="num">−{money(c.totals.total)}</td><td></td>
                <td><a className="btn ghost small" href={c.link} target="_blank" rel="noopener noreferrer">View / download</a></td>
              </tr>
            ))}
          </Fragment>))}</tbody>
        </table></div>
      )}
    </>
  );
}
