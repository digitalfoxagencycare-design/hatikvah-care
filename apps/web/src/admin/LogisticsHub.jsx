import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { Loader, useLoad } from "./hooks.jsx";
import { PickupModal } from "./Logistics.jsx";
import { fmtTime, Modal, Msg, Pill, rs, toPaise, useAction } from "./ui.jsx";
import { HubTabs, Photo, Stat } from "./visual.jsx";

const COURIERS = [["shadowfax", "Shadowfax"], ["porter", "Porter"]];

/** The couriers report no balance through their APIs, so this is the figure staff last read from each courier's portal, labelled as such. */
function Wallet({ id, name, on, w, onEdit }) {
  const low = !!w && w.balance <= w.lowAt;
  return (
    <div className="wallet">
      <Stat n={w ? rs(w.balance) : "—"} label={`${name} balance`} tone={low ? "warn" : ""} sub={!on ? "Not connected" : w ? `Typed in by ${w.updatedBy}, ${fmtTime(w.updatedAt)}` : "Not entered yet"} />
      {low && <p className="pos-change short" role="alert">Low balance: top up on the {name} portal.</p>}
      <button className="btn ghost small" onClick={() => onEdit({ provider: id, name, balance: w ? String(w.balance / 100) : "", lowAt: w ? String(w.lowAt / 100) : "" })}>Update</button>
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

function ShipCard({ o, couriers, onBook }) {
  const s = o.shipment, stopped = ["cancelled", "returned"].includes(s?.status);
  return (
    <div className="ship-card">
      <span className="stack">{o.items.map((i, n) => <Photo key={n} src={i.image} alt={i.name} />)}{o.more > 0 && <span className="ph more">+{o.more}</span>}</span>
      <div>
        <div className="row-between"><strong><Link to={`/admin/orders/${o.id}`}>{o.number}</Link> {o.customer}</strong><Pill s={s && !stopped ? s.status : o.status}>{(s && !stopped ? s.status : o.status).replace(/_/g, " ")}</Pill></div>
        <address>{o.address || "No delivery address saved"}</address>
        <small className="muted">{o.items.reduce((n, i) => n + i.qty, 0).toLocaleString("en-IN")} pieces{o.weightKg ? ` · ${o.weightKg} kg` : ""}{s?.awb ? ` · AWB ${s.awb}` : ""}{s?.riderName ? ` · Rider ${s.riderName}` : ""}</small>
      </div>
      <div className="btn-row">
        {o.status === "dispatched" && (!s || stopped) && couriers.length > 0 && <button className="btn small" onClick={() => onBook(o)}>Book Rider / Pickup</button>}
        {["confirmed", "packed"].includes(o.status) && <Link className="btn ghost small" to={`/admin/orders/${o.id}`}>Pack and dispatch</Link>}
        {o.challanNumber && <a className="btn ghost small" href={`/doc/label/${o.token}`} target="_blank" rel="noopener noreferrer">4×6 label</a>}
        {s?.trackingUrl && <a className="btn ghost small" href={s.trackingUrl} target="_blank" rel="noopener noreferrer">Track rider ↗</a>}
      </div>
    </div>
  );
}

export default function LogisticsHub() {
  const s = useLoad("/api/admin/hubs/logistics");
  const [wallet, setWallet] = useState(null);
  const [book, setBook] = useState(null);
  const d = s.data;
  return (
    <>
      <h1>Automations & Channels</h1>
      <HubTabs />
      <Loader s={s}>{d && <>
        <div className="wallets">{COURIERS.map(([id, name]) => <Wallet key={id} id={id} name={name} on={d.couriers.includes(id)} w={d.wallets[id]} onEdit={setWallet} />)}</div>
        <div className="grid2 top">
          <section>
            <h2>Dispatch queue</h2>
            {d.queue.length === 0 && <p className="muted">Nothing waiting to go out.</p>}
            {d.queue.map((o) => <ShipCard key={o.id} o={o} couriers={d.couriers} onBook={setBook} />)}
          </section>
          <section>
            <h2>On the road</h2>
            {d.moving.length === 0 && <p className="muted">No live pickups.</p>}
            {d.moving.map((o) => <ShipCard key={o.id} o={o} couriers={d.couriers} onBook={setBook} />)}
          </section>
        </div>
      </>}</Loader>
      {wallet && <WalletEdit w={wallet} onClose={() => setWallet(null)} onSaved={() => { setWallet(null); s.reload(); }} />}
      {book && <PickupModal o={book} onClose={() => setBook(null)} onBooked={() => { setBook(null); s.reload(); }} />}
    </>
  );
}
