import { useState } from "react";
import { api } from "../api.js";
import { fmtDate, Modal, Msg, today, useAction, useMeta } from "./ui.jsx";

const COURIERS = { shadowfax: "Shadowfax", porter: "Porter" };
const WINDOWS = ["09:00-12:00", "12:00-15:00", "15:00-18:00", "18:00-21:00"];
const STEPS = ["Pickup scheduled", "Rider assigned", "In transit", "Delivered"];
const STEP_OF = { created: 0, assigned: 1, picked: 2, in_transit: 2, out_for_delivery: 2, delivered: 3 };
export const shipmentOpen = (s) => !!s && !["delivered", "cancelled", "returned"].includes(s.status);

/** Pickup Scheduled → Rider Assigned → In Transit → Delivered, driven by the courier's webhooks. */
function ShipmentTimeline({ shipment: s }) {
  const stopped = ["cancelled", "returned"].includes(s.status);
  const at = STEPS.map((_, i) => (s.history || []).find((h) => STEP_OF[h.status] === i)?.at);
  const reached = (s.history || []).reduce((n, h) => Math.max(n, STEP_OF[h.status] ?? 0), 0);
  return (
    <ol className="ship-steps" aria-label="Delivery status">
      {STEPS.map((label, i) => (
        <li key={label} className={i < reached || s.status === "delivered" ? "done" : i === reached && !stopped ? "now" : ""} aria-current={i === reached && !stopped ? "step" : undefined}>
          <strong>{label}</strong>
          {i === 0 && s.pickupSlot && <small>{fmtDate(s.pickupSlot.date)} {s.pickupSlot.window}</small>}
          {i === 1 && s.riderName && <small>{s.riderName}</small>}
          {i === 1 && s.riderPhone && <small><a href={`tel:${s.riderPhone}`}>{s.riderPhone}</a></small>}
          {i === 2 && s.status === "out_for_delivery" && <small>Out for delivery</small>}
          {at[i] && <small>{fmtDate(at[i])}</small>}
        </li>
      ))}
    </ol>
  );
}

/** Courier status and the dispatch paperwork on a sales order. */
export function ShipmentPanel({ o, onBook }) {
  const couriers = useMeta().channels.couriers || [];
  const s = o.shipment, stopped = ["cancelled", "returned"].includes(s?.status), booking = o.shipmentBooking?.status;
  const waiting = ["pending", "reconcile"].includes(booking);
  const canBook = o.status === "dispatched" && (!s || stopped) && !waiting;
  const doc = (kind, label) => <a className="btn ghost small" href={`/doc/${kind}/${o.token}`} target="_blank" rel="noopener noreferrer">{label}</a>;
  if (!o.challanNumber && !s) return null;
  return (
    <div className="panel">
      <div className="row-between"><h2>Logistics{s && ` · ${COURIERS[s.provider] || s.provider}`}</h2>{s?.trackingUrl && <a href={s.trackingUrl} target="_blank" rel="noopener noreferrer">Live tracking ↗</a>}</div>
      {s && <>
        <p>AWB <strong>{s.awb || "—"}</strong>{s.packages ? ` · ${s.packages} package${s.packages > 1 ? "s" : ""}` : ""}{s.weightKg ? ` · ${s.weightKg} kg` : ""}</p>
        {stopped && <p className="alert" role="alert">This pickup was {s.status}. Book a new one when you are ready.</p>}
        <ShipmentTimeline shipment={s} />
      </>}
      {booking === "reconcile" && <p className="alert" role="alert">The last booking got no clear answer from the courier. Check their dashboard before booking again.</p>}
      {booking === "pending" && <p className="notice">Booking the pickup…</p>}
      {o.challanNumber && <div className="btn-row">
        {doc("label", "Download shipping label")}{doc("challan", "Delivery challan")}{doc("gatepass", "Gate pass")}{doc("packing", "Packing slip")}
      </div>}
      {canBook && (couriers.length
        ? <div className="btn-row"><button className="btn" onClick={onBook}>Book Courier Pickup</button></div>
        : <p className="muted small-print">Courier pickups appear here once Shadowfax or Porter is connected.</p>)}
    </div>
  );
}

/** Pickup request for a dispatched order. Blank PIN = taken from the delivery address. */
export function PickupModal({ o, onBooked, onClose }) {
  const couriers = useMeta().channels.couriers || [];
  const [f, setF] = useState({ provider: couriers[0] || "shadowfax", weightKg: 1, packages: 1, pickupDate: today(), pickupWindow: WINDOWS[0], dropPincode: "", dropLat: "", dropLng: "" });
  const [st, run] = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const porter = f.provider === "porter";
  const submit = (e) => {
    e.preventDefault();
    const { dropLat, dropLng, ...rest } = f;
    const body = { ...rest, weightKg: Number(f.weightKg), packages: Number(f.packages), ...(porter ? { dropLat: Number(dropLat), dropLng: Number(dropLng) } : {}) };
    run(async () => { await api(`/api/admin/orders/${o.id}/shipment`, { method: "POST", body }); onBooked(); });
  };
  return (
    <Modal title={`Book courier pickup for ${o.number}`} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <div className="seg" role="group" aria-label="Courier">
          {couriers.map((c) => <button type="button" key={c} className={f.provider === c ? "on" : ""} aria-pressed={f.provider === c} onClick={() => setF({ ...f, provider: c })}>{COURIERS[c]}</button>)}
        </div>
        <div className="grid3">
          <label className="field"><span>Weight (kg)</span><input required type="number" min="0.1" max="1000" step="any" value={f.weightKg} onChange={set("weightKg")} /></label>
          <label className="field"><span>Packages</span><input required type="number" min="1" max="500" step="1" value={f.packages} onChange={set("packages")} /></label>
          <label className="field"><span>Delivery PIN (blank = from address)</span><input inputMode="numeric" maxLength={6} value={f.dropPincode} onChange={(e) => setF({ ...f, dropPincode: e.target.value.replace(/\D/g, "") })} /></label>
        </div>
        <div className="grid2">
          <label className="field"><span>Pickup date</span><input required type="date" min={today()} value={f.pickupDate} onChange={set("pickupDate")} /></label>
          <label className="field"><span>Pickup time slot</span><select value={f.pickupWindow} onChange={set("pickupWindow")}>{WINDOWS.map((w) => <option key={w} value={w}>{w.replace("-", " to ")}</option>)}</select></label>
        </div>
        {porter && <>
          <div className="grid2">
            <label className="field"><span>Delivery latitude</span><input required type="number" min="-90" max="90" step="any" value={f.dropLat} onChange={set("dropLat")} placeholder="17.4401" /></label>
            <label className="field"><span>Delivery longitude</span><input required type="number" min="-180" max="180" step="any" value={f.dropLng} onChange={set("dropLng")} placeholder="78.3489" /></label>
          </div>
          <p className="muted small-print">Copy these from Google Maps. Porter's API books two-wheelers only, for one pickup and one drop in the same city.</p>
        </>}
        <Msg st={st} />
        <button className="btn" disabled={st.busy}>{st.busy ? "Booking…" : `Book ${COURIERS[f.provider]} pickup`}</button>
      </form>
    </Modal>
  );
}
