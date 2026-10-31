import { useState } from "react";
import { Link } from "react-router-dom";
import { can, useMe } from "./AdminApp.jsx";
import { Loader, useLoad } from "./hooks.jsx";
import { DISPATCH_LABEL, DispatchModal, PickupModal } from "./Logistics.jsx";
import { Pill, rs, useMeta } from "./ui.jsx";
import { Icon, Photo } from "./visual.jsx";

const COURIERS = { shadowfax: "Shadowfax", porter: "Porter" };

/** The last seven days as a small line; the end of the line is today. */
function Spark({ days }) {
  const max = Math.max(1, ...days.map((d) => d.total));
  const points = days.map((d, i) => `${(i * 100) / (days.length - 1)},${28 - (d.total / max) * 26}`).join(" ");
  return <svg className="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" /></svg>;
}

const Kpi = ({ to, label, n, tone = "", children }) => <Link to={to} className={"kpi " + tone}><span className="kpi-label">{label}</span><strong>{n}</strong>{children}</Link>;

const Courier = ({ name, off }) => <span className={"courier" + (off ? " off" : "")}>{name}</span>;

function LowCard({ p }) {
  const level = p.reorderLevel, pct = Math.min(100, Math.round((100 * p.physical) / Math.max(1, level)));
  return (
    <li className="low-card">
      <Link to={`/admin/products/${p.id}`} aria-label={p.name}><Photo src={p.image} /></Link>
      <div className="low-info">
        <Link to={`/admin/products/${p.id}`}>{p.name}</Link>
        <small>{p.sku}</small>
        <i className={"gauge" + (p.available <= 0 ? " out" : "")}><em style={{ width: `${pct}%` }} /></i>
        <small><b>{p.physical.toLocaleString("en-IN")}</b> {p.unit} in stock · threshold {level.toLocaleString("en-IN")}{p.reserved > 0 ? ` · ${p.reserved.toLocaleString("en-IN")} reserved` : ""}</small>
      </div>
      <Link className="btn small" to={`/admin/purchase-orders/new?product=${p.id}`}>+ Create PO</Link>
    </li>
  );
}

function DispatchCard({ o, couriers, onBook, onDispatch }) {
  const shipped = o.status === "dispatched", waiting = ["pending", "reconcile"].includes(o.booking);
  return (
    <li className="queue-card">
      <div className="queue-who">
        <strong>{o.customer}</strong>
        <small><Link to={`/admin/orders/${o.id}`}>{o.number}</Link> · {rs(o.total)}</small>
        <small className="queue-dest">{o.destination || "No delivery address"}</small>
      </div>
      <div className="queue-tags"><Pill s={o.status} />{o.courier ? <Courier name={COURIERS[o.courier] || o.courier} /> : <Courier name="No courier" off />}</div>
      <div className="queue-acts">
        {shipped && !waiting && couriers.length > 0 && <button className="btn small" onClick={() => onBook(o)}>Book Rider</button>}
        {!shipped && <button className="btn small" onClick={() => onDispatch(o)}>{DISPATCH_LABEL}</button>}
        {o.challanNumber && <a className="btn ghost small" href={`/doc/label/${o.token}`} target="_blank" rel="noopener noreferrer">Print 4x6 Label</a>}
      </div>
    </li>
  );
}

function Aging({ rows }) {
  const total = rows.reduce((n, a) => n + a.amount, 0);
  if (!total) return <p className="muted">Nothing outstanding.</p>;
  return (
    <>
      <div className="age-bar" role="img" aria-label={rows.map((a) => `${a.label}: ${rs(a.amount)}`).join(", ")}>
        {rows.filter((a) => a.amount > 0).map((a) => <i key={a.key} className={a.key} style={{ flexGrow: a.amount }} />)}
      </div>
      <ul className="age-keys">
        {rows.map((a) => <li key={a.key}><span><i className={a.key} aria-hidden="true" />{a.label}</span><strong>{rs(a.amount)}</strong><small>{Math.round((100 * a.amount) / total)}% · {a.count} invoice{a.count === 1 ? "" : "s"}</small></li>)}
      </ul>
    </>
  );
}

export default function Dashboard() {
  const me = useMe();
  const s = useLoad("/api/admin/dashboard");
  const couriers = useMeta().channels.couriers || [];
  const [booking, setBooking] = useState(null);
  const [sending, setSending] = useState(null);
  const d = s.data;
  const hour = new Date().getHours();
  const days = d?.revenueDays, sold = days?.at(-1).total ?? 0, before = days?.at(-2).total ?? 0;
  return (
    <div className="dash">
      <div className="row-between">
        <h1>Good {hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening"}, {me.name.split(" ")[0]}</h1>
        <div className="btn-row">
          {can(me, "quotes") && <Link className="btn ghost" to="/admin/quotes/new">New quotation</Link>}
          {can(me, "pos") && <Link className="btn" to="/admin/pos">New bill</Link>}
        </div>
      </div>
      <Loader s={s}>{d && <>
        <div className="kpis">
          {days && <Kpi to="/admin/invoices" label="Today's sales" n={rs(sold)}><small>{before ? `Yesterday ${rs(before)}` : "No sales yesterday"}</small><Spark days={days} /></Kpi>}
          {"toDispatch" in d && <Kpi to="/admin/logistics-hub" label="Pending dispatches" n={d.toDispatch}><span className="kpi-tags">{couriers.length ? couriers.map((c) => <Courier key={c} name={COURIERS[c] || c} />) : <Courier name="No courier connected" off />}</span></Kpi>}
          {"lowStock" in d && <Kpi to="/admin/stock" label="Low stock alert" n={d.lowStock} tone={d.lowStock ? "warn" : ""}><span className="kpi-tags">{d.lowStock ? <Pill s="unpaid">Needs reorder</Pill> : <Pill s="paid">All stocked</Pill>}</span></Kpi>}
          {"outstanding" in d && <Kpi to="/admin/invoices?status=overdue" label="Unpaid invoices" n={rs(d.outstanding)} tone={d.overdue ? "bad" : ""}><small>{rs(d.overdue)} overdue · {d.overdueCount} invoice{d.overdueCount === 1 ? "" : "s"}</small></Kpi>}
        </div>

        {d.lowStockItems?.length > 0 && (
          <section className="panel">
            <div className="row-between"><h2>Low stock</h2><Link to="/admin/stock">All stock</Link></div>
            <ul className="low-grid">{d.lowStockItems.slice(0, 6).map((p) => <LowCard key={p.id} p={p} />)}</ul>
          </section>
        )}

        <div className="dash-two">
          {d.dispatchQueue && (
            <section className="panel">
              <div className="row-between"><h2>Dispatch queue</h2><Link to="/admin/logistics-hub">Logistics</Link></div>
              {d.dispatchQueue.length === 0 ? <p className="muted">Nothing waiting to go out.{d.inTransit ? ` ${d.inTransit} in transit.` : ""}</p> : <ul className="queue">{d.dispatchQueue.slice(0, 5).map((o) => <DispatchCard key={o.id} o={o} couriers={couriers} onBook={setBooking} onDispatch={setSending} />)}</ul>}
            </section>
          )}
          {d.aging && <section className="panel"><div className="row-between"><h2>Receivables aging</h2><span className="muted">{rs(d.outstanding)} due</span></div><Aging rows={d.aging} /></section>}
          {can(me, "enquiries") && (
            <section className="panel">
              <div className="row-between"><h2>New enquiries</h2><Link to="/admin/enquiries">{d.newEnquiries} new</Link></div>
              {d.recentEnquiries.length === 0 ? <p className="muted">They appear here when visitors use the contact or quote forms.</p> : (
                <ul className="feed">{d.recentEnquiries.slice(0, 4).map((e) => <li key={e.id}><strong>{e.name}{e.company && ` · ${e.company}`}</strong><p>{e.ref} · {e.items.length} item{e.items.length === 1 ? "" : "s"}</p><span className="feed-end"><Pill s={e.status} /></span></li>)}</ul>
              )}
            </section>
          )}
          {d.inboxUnread > 0 && <Link className="panel inbox-note" to="/admin/whatsapp"><Icon name="chat" size={20} />{d.inboxUnread} unread WhatsApp message{d.inboxUnread === 1 ? "" : "s"}</Link>}
        </div>
      </>}</Loader>
      {sending && <DispatchModal id={sending.id} onClose={() => { setSending(null); s.reload(); }} />}
      {booking && <PickupModal o={booking} onClose={() => setBooking(null)} onBooked={() => { setBooking(null); s.reload(); }} />}
    </div>
  );
}
