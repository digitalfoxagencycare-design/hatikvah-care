import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { Loader, useLoad } from "./hooks.jsx";
import { DISPATCH_LABEL, DispatchModal, PickupModal } from "./Logistics.jsx";
import { askText, toast } from "./toast.jsx";
import { fmtDate, fmtTime, Modal, Msg, Pill, rs, toPaise, useAction } from "./ui.jsx";
import { HubTabs, Photo, Stat } from "./visual.jsx";

const COURIERS = [["shadowfax", "Shadowfax"], ["shiprocket", "Shiprocket"], ["porter", "Porter"]];

/** Centralized shipping wallet: auto-deducted per booking and centrally managed via Nova console. */
function Wallet({ id, name, on, w }) {
  const low = !!w && w.balance <= w.lowAt;
  return (
    <div className="wallet" style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: "8px", padding: "16px" }}>
      <Stat n={w ? rs(w.balance) : "—"} label={`${name} Shipping Wallet`} tone={low ? "warn" : "good"} sub={!on ? "Not connected" : "Auto-deducted on dispatch · Centrally managed via Nova Console"} />
      {low && <p className="pos-change short" role="alert" style={{ color: "#DC2626", marginTop: "8px" }}>Low wallet balance (&lt; ₹200.00). Balance auto-reconciled via Nova Console.</p>}
    </div>
  );
}

function WalletEdit({ w, onClose, onSaved }) {
  const [f, setF] = useState(w);
  const [st, run] = useAction();
  const save = (e) => { e.preventDefault(); run(async () => { await api("/api/admin/hubs/logistics/wallet", { method: "PUT", body: { provider: f.provider, balance: toPaise(f.balance) ?? 0, lowAt: toPaise(f.lowAt) ?? 0 } }); onSaved(); }); };
  return (
    <Modal title={`${f.name} balance`} onClose={onClose}>
      <form className="form" onSubmit={save}>
        <p className="muted">Enter the balance shown on the {f.name} portal.</p>
        <div className="grid2">
          <label className="field"><span>Balance ₹</span><input required autoFocus inputMode="decimal" value={f.balance} onChange={(e) => setF({ ...f, balance: e.target.value })} /></label>
          <label className="field"><span>Warn me below ₹</span><input required inputMode="decimal" value={f.lowAt} onChange={(e) => setF({ ...f, lowAt: e.target.value })} /></label>
        </div>
        <Msg st={st} /><button className="btn" disabled={st.busy}>Save</button>
      </form>
    </Modal>
  );
}

function ShipCard({ o, couriers, onBook, onDispatch }) {
  const s = o.shipment, stopped = ["cancelled", "returned"].includes(s?.status), open = !s || stopped;
  return (
    <div className="ship-card">
      <span className="stack">{o.items.map((i, n) => <Photo key={n} src={i.image} alt={i.name} />)}{o.more > 0 && <span className="ph more">+{o.more}</span>}</span>
      <div>
        <div className="row-between"><strong><Link to={`/admin/orders/${o.id}`}>{o.number}</Link> {o.customer}</strong><Pill s={s && !stopped ? s.status : o.status}>{(s && !stopped ? s.status : o.status).replace(/_/g, " ")}</Pill></div>
        <address>{o.address || "No delivery address saved"}</address>
        <small className="muted">{o.items.reduce((n, i) => n + i.qty, 0).toLocaleString("en-IN")} pieces{o.weightKg ? ` · ${o.weightKg} kg` : ""}{s?.awb ? ` · AWB ${s.awb}` : ""}{s?.riderName ? ` · Rider ${s.riderName}` : ""}</small>
      </div>
      <div className="btn-row">
        {open && ["confirmed", "packed", "dispatched"].includes(o.status) && <button className="btn small" onClick={() => onDispatch(o)}>{DISPATCH_LABEL}</button>}
        {o.status === "dispatched" && open && couriers.includes("porter") && <button className="btn ghost small" onClick={() => onBook(o)}>Book Porter</button>}
        {o.challanNumber && <a className="btn ghost small" href={`/doc/label/${o.token}`} target="_blank" rel="noopener noreferrer">Print 4×6 label</a>}
        {s?.trackingUrl && <a className="btn ghost small" href={s.trackingUrl} target="_blank" rel="noopener noreferrer">Track rider ↗</a>}
      </div>
    </div>
  );
}

/** Shadowfax has no account API, so the token is tested with a live serviceability call and the balance stays typed in. */
function AccountStatus() {
  const s = useLoad("/api/admin/logistics/shadowfax/status");
  const d = s.data;
  return (
    <section className="panel ship-status">
      <div className="row-between"><h2>Shadowfax account</h2>{d && <Pill s={d.verified ? "paid" : d.connected ? "pending" : "failed"}>{d.verified ? "Token connected" : d.connected ? "Check needed" : "Not connected"}</Pill>}</div>
      <Loader s={s}>{d && <p className="muted">{d.message}{d.pickup ? ` · Pickup PIN ${d.pickup}` : ""}</p>}</Loader>
    </section>
  );
}

function Queue({ title, rows, empty, ...card }) {
  return (
    <section>
      <h2>{title}</h2>
      {rows.length === 0 && <p className="muted">{empty}</p>}
      {rows.map((o) => <ShipCard key={o.id} o={o} {...card} />)}
    </section>
  );
}

/** Each Shadowfax booking and what it took from the master account. Shows only what Shadowfax reported or staff copied from the statement. */
function Deductions({ rows, total, onChange }) {
  const enter = async (r) => {
    const v = await askText(`Charge for AWB ${r.awb || r.number}`, { value: r.charge != null ? String(r.charge / 100) : "", placeholder: "Amount in ₹", confirmLabel: "Save" });
    if (v === null) return;
    const amount = toPaise(v);
    if (amount == null) return toast("Enter the amount in rupees", "error");
    try { await api(`/api/admin/orders/${r.id}/shipment/charge`, { method: "PUT", body: { amount } }); onChange(); } catch (e) { toast(e.message, "error"); }
  };
  return (
    <section>
      <div className="row-between"><h2>Shadowfax deduction log</h2><span>Total recorded <strong>{rs(total)}</strong></span></div>
      {rows.length === 0 ? <p className="muted">No Shadowfax bookings yet.</p> : (
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>AWB</th><th>Order</th><th>Booked</th><th className="num">Weight</th><th>Status</th><th className="num">Deducted</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td><code>{r.awb || "—"}</code></td>
              <td><Link to={`/admin/orders/${r.id}`}>{r.number}</Link><small>{r.customer}</small></td>
              <td>{r.date ? fmtDate(r.date) : "—"}</td>
              <td className="num">{r.weightKg ? `${r.weightKg} kg` : "—"}</td>
              <td><Pill s={r.status}>{r.status.replace(/_/g, " ")}</Pill></td>
              <td className="num">{r.charge != null ? rs(r.charge) : "Not reported"}<small><button className="link" onClick={() => enter(r)}>{r.charge != null ? "Edit" : "Enter"}</button>{r.enteredBy ? ` · ${r.enteredBy}` : ""}</small></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
}

export default function LogisticsHub() {
  const s = useLoad("/api/admin/hubs/logistics");
  const [wallet, setWallet] = useState(null);
  const [book, setBook] = useState(null);
  const [send, setSend] = useState(null);
  const d = s.data;
  const card = { couriers: d?.couriers || [], onBook: setBook, onDispatch: setSend };
  return (
    <>
      <h1>Automations & Channels</h1>
      <HubTabs />
      <AccountStatus />
      <Loader s={s}>{d && <>
        <div className="stats">
          <Stat n={d.queue.length} label="Ready to dispatch" tone={d.queue.length ? "warn" : ""} />
          <Stat n={d.pending.length} label="Pending pickups" />
          <Stat n={d.outForDelivery.length} label="Out for delivery" />
          <Stat n={d.delivered.length} label="Delivered" tone="good" sub="latest 20" />
        </div>
        <div className="wallets">{COURIERS.map(([id, name]) => <Wallet key={id} id={id} name={name} on={d.couriers.includes(id)} w={d.wallets[id]} />)}</div>
        <div className="grid2 top">
          <Queue title="Ready to dispatch" rows={d.queue} empty="Nothing waiting to go out." {...card} />
          <Queue title="Pending pickups" rows={d.pending} empty="No pickups waiting." {...card} />
          <Queue title="Out for delivery" rows={d.outForDelivery} empty="Nothing on the road." {...card} />
          <Queue title="Delivered" rows={d.delivered} empty="Nothing delivered yet." {...card} />
        </div>
        <Deductions rows={d.charges} total={d.chargedTotal} onChange={s.reload} />
      </>}</Loader>
      {book && <PickupModal o={book} onClose={() => setBook(null)} onBooked={() => { setBook(null); s.reload(); }} />}
      {send && <DispatchModal id={send.id} onClose={() => { setSend(null); s.reload(); }} />}
    </>
  );
}
