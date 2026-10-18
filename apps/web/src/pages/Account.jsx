import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, money } from "../api.js";
import OtpLogin from "../components/OtpLogin.jsx";
import Seo from "../components/Seo.jsx";
import { useSite } from "../data.jsx";

const fmt = (iso) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const payText = (o) => (o.paymentStatus === "paid" || o.invoice?.status === "paid" ? "Paid" : o.paymentStatus === "pending" ? "Awaiting payment" : o.invoice ? `Due ${money(o.invoice.balance)}` : "Invoice to follow");

export default function Account() {
  const { settings } = useSite();
  const [sp] = useSearchParams();
  const [me, setMe] = useState(undefined);
  const [orders, setOrders] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { api("/api/shop/me").then(setMe).catch(() => setMe(null)); }, []);
  useEffect(() => { if (me) api("/api/shop/orders").then(setOrders).catch((e) => setErr(e.message)); }, [me]);

  async function pay(o) {
    try { const r = await api(`/api/shop/orders/${o.id}/pay`, { method: "POST" }); window.location.assign(r.payUrl); } catch (e) { setErr(e.message); }
  }
  async function logout() { await api("/api/shop/logout", { method: "POST" }).catch(() => {}); setMe(null); setOrders(null); }

  if (me === undefined) return <div className="center-note">Loading…</div>;
  if (!me) return (
    <div className="wrap narrow account"><Seo title="My account" />
      {settings.shop?.otp ? <OtpLogin title="Sign in to see your orders" onDone={setMe} />
        : <div className="empty"><p>Sign-in is not available right now. For your order status, message us on WhatsApp{settings.phone ? ` or call ${settings.phone}` : ""}.</p></div>}
    </div>
  );
  return (
    <div className="wrap account">
      <Seo title="My orders" />
      <div className="row-between"><h1>My orders</h1><button className="btn ghost small" onClick={logout}>Sign out</button></div>
      <p className="muted">{me.company || me.name} · {me.phone}</p>
      {sp.get("order") && <p className="notice" role="status">Thank you! Payment for {sp.get("order")} is being confirmed. It shows as paid here within a minute.</p>}
      {err && <p className="alert" role="alert">{err}</p>}
      {!orders ? <p className="muted">Loading orders…</p> : orders.length === 0 ? (
        <div className="empty"><p>No orders yet.</p><Link className="btn" to="/shop">Start shopping</Link></div>
      ) : (
        <div className="orders">{orders.map((o) => (
          <article key={o.id} className="panel order-card">
            <div className="row-between"><div><strong>{o.number}</strong> <span className="muted">· {fmt(o.createdAt)}</span></div><span className={"pill-s " + o.status}>{o.status}</span></div>
            <ul className="sum-lines">{o.items.map((it, i) => <li key={i}><span>{it.qty.toLocaleString("en-IN")} × {it.name}</span><strong>{money(it.rate * it.qty)}</strong></li>)}</ul>
            <div className="row-between"><span>Total <strong>{money(o.total)}</strong> · {payText(o)}</span>
              <div className="btn-row">
                {o.invoice && <a className="btn ghost small" href={o.invoice.link} target="_blank" rel="noopener noreferrer">Invoice {o.invoice.number}</a>}
                {o.challan && <a className="btn ghost small" href={o.challan} target="_blank" rel="noopener noreferrer">Delivery challan</a>}
                {o.invoice?.payUrl && o.invoice.balance > 0 && <a className="btn small" href={o.invoice.payUrl}>Pay now</a>}
                {!o.invoice && o.payment === "online" && o.paymentStatus === "pending" && settings.shop?.online && <button className="btn small" onClick={() => pay(o)}>Pay now</button>}
              </div></div>
          </article>
        ))}</div>
      )}
    </div>
  );
}
