import { useEffect, useState } from "react";
import { api } from "../api.js";
import { can, useMe } from "./AdminApp.jsx";
import { Loader, useLoad } from "./hooks.jsx";
import { fmtDate, Modal, Msg, Pill, today, useAction, useMeta } from "./ui.jsx";

const COURIERS = { shadowfax: "Shadowfax", shiprocket: "Shiprocket", porter: "Porter" };
const WINDOWS = ["09:00-12:00", "12:00-15:00", "15:00-18:00", "18:00-21:00"];
const STEPS = ["Pickup scheduled", "Rider assigned", "In transit", "Delivered"];
const STEP_OF = { created: 0, assigned: 1, picked: 2, in_transit: 2, out_for_delivery: 2, delivered: 3 };
export const shipmentOpen = (s) => !!s && !["delivered", "cancelled", "returned"].includes(s.status);
export const DISPATCH_LABEL = "📦 Book Courier (Shadowfax / Shiprocket)";
const shipmentStopped = (s) => !s || ["cancelled", "returned"].includes(s.status);
/** Confirmed or packed, or dispatched by hand with no live courier booking and none in doubt. */
export const dispatchable = (o) => ["confirmed", "packed"].includes(o.status) || (o.status === "dispatched" && shipmentStopped(o.shipment) && !["pending", "reconcile"].includes(o.shipmentBooking?.status));
const pinOf = (a = "") => (String(a).match(/\b\d{6}\b/g) || []).pop() || "";

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
export function ShipmentPanel({ o, onBook, onRefresh }) {
  const couriers = useMeta().channels.couriers || [];
  const [cancelling, setCancelling] = useState(false);
  const s = o.shipment, stopped = ["cancelled", "returned"].includes(s?.status), booking = o.shipmentBooking?.status;
  const waiting = ["pending", "reconcile"].includes(booking);
  const canBook = o.status === "dispatched" && (!s || stopped) && !waiting;
  const doc = (kind, label) => <a className="btn ghost small" href={`/doc/${kind}/${o.token}`} target="_blank" rel="noopener noreferrer">{label}</a>;
  if (!o.challanNumber && !s) return null;

  async function cancelCourier() {
    if (!window.confirm("Cancel this courier pickup? The courier will be notified and the delivery fee will be refunded to your shipping wallet.")) return;
    setCancelling(true);
    try {
      await api(`/api/admin/orders/${o.id}/shipment/cancel`, { method: "POST" });
      onRefresh ? onRefresh() : window.location.reload();
    } catch (err) {
      alert("Failed to cancel courier pickup: " + err.message);
    } finally {
      setCancelling(false);
    }
  }

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
        {s && !stopped && s.status !== "delivered" && (
          <button type="button" className="btn ghost danger small" disabled={cancelling} onClick={cancelCourier} style={{ color: "#DC2626", borderColor: "#FCA5A5" }}>
            {cancelling ? "Cancelling…" : "✕ Cancel Courier Pickup"}
          </button>
        )}
      </div>}
      {canBook && (couriers.length
        ? <div className="btn-row"><button className="btn" onClick={onBook}>Book Courier Pickup</button></div>
        : <p className="muted small-print">Courier pickups appear here once Shadowfax or Porter is connected.</p>)}
    </div>
  );
}

/** One booking from any confirmed order, whatever channel it came from: the challan is raised with it, and the label is ready the moment Shadowfax answers. */
export function DispatchModal({ id, onClose }) {
  const order = useLoad(`/api/admin/orders/${id}`), account = useLoad("/api/admin/logistics/shadowfax/status"), estimate = useLoad(`/api/admin/logistics/estimate/${id}`);
  const [f, setF] = useState(null);
  const [booked, setBooked] = useState(null);
  const [reach, setReach] = useState(null);
  const [st, run] = useAction();
  const o = booked || order.data, a = account.data, e = estimate.data;
  useEffect(() => {
    if (f || !order.data || !a || !e) return;
    const c = order.data.customer, address = c.shippingAddress || c.billingAddress || "";
    setF({ dropName: c.contactName || c.name, dropPhone: c.phone || "", dropAddress: address, dropPincode: c.deliveryPincode || pinOf(address), pickupPincode: e?.pickupPincode || a.pickup || "500084", weightKg: e.weightKg, packages: 1, lengthCm: "", breadthCm: "", heightCm: "", courier: "shadowfax" });
  }, [f, order.data, a, e]);
  const pin = f?.dropPincode || "", pickup = f?.pickupPincode || "", live = !!a?.verified;
  useEffect(() => { // a hint only: Shadowfax still decides at booking
    setReach(null);
    if (!live || !/^\d{6}$/.test(pin) || !/^\d{6}$/.test(pickup)) return undefined;
    let current = true;
    api(`/api/admin/logistics/serviceability?pincode=${pin}&pickup=${pickup}`).then((r) => { if (current) setReach(r); }).catch(() => {});
    return () => { current = false; };
  }, [live, pin, pickup]);
  const set = (k) => (ev) => setF({ ...f, [k]: ev.target.value });
  const digits = (k) => (ev) => setF({ ...f, [k]: ev.target.value.replace(/\D/g, "") });
  const submit = (ev) => {
    ev.preventDefault();
    const { lengthCm, breadthCm, heightCm, ...rest } = f;
    const size = lengthCm && breadthCm && heightCm ? { lengthCm: Number(lengthCm), breadthCm: Number(breadthCm), heightCm: Number(heightCm) } : {};
    run(async () => {
      try { setBooked(await api(`/api/admin/orders/${id}/shipment`, { method: "POST", body: { courier: f.courier || "shadowfax", ...rest, weightKg: Number(f.weightKg), packages: Number(f.packages), ...size } })); }
      catch (err) { order.reload(); throw err; }
    });
  };
  const s = o?.shipment;
  return (
    <Modal title={DISPATCH_LABEL} onClose={onClose} wide>
      <Loader s={order}>{o && (!shipmentStopped(s) ? (
        <div className="ship-done">
          <p className="notice">{booked ? `Courier booked with ${COURIERS[s.provider] || "Courier"}.` : "This order already has a courier booking."}</p>
          <dl className="dl">
            <dt>AWB</dt><dd><code>{s.awb || "—"}</code></dd>
            <dt>Courier</dt><dd>{COURIERS[s.provider] || s.provider || "Shadowfax"}</dd>
            <dt>Status</dt><dd><Pill s={s.status}>{s.status.replace(/_/g, " ")}</Pill></dd>
            <dt>Challan</dt><dd>{o.challanNumber}</dd>
            {s.trackingUrl && <><dt>Tracking</dt><dd><a href={s.trackingUrl} target="_blank" rel="noopener noreferrer">{s.trackingUrl}</a></dd></>}
          </dl>
          <div className="btn-row">
            <a className="btn" href={`/doc/label/${o.token}`} target="_blank" rel="noopener noreferrer">Print 4x6 Barcode Shipping Label</a>
            <button className="btn ghost" onClick={onClose}>Done</button>
          </div>
        </div>
      ) : !dispatchable(o) ? (
        <p className="alert" role="alert">{["pending", "reconcile"].includes(o.shipmentBooking?.status) ? "The last booking got no clear answer from courier. Check their dashboard before booking again." : `This order is ${o.status}, so it cannot be dispatched.`}</p>
      ) : !f ? <p className="muted">Loading the booking details…</p> : (
        <form className="form" onSubmit={submit}>
          <div className="seg" role="group" aria-label="Courier Selection" style={{ marginBottom: "14px" }}>
            <button type="button" className={f.courier === "shadowfax" ? "on" : ""} onClick={() => setF({ ...f, courier: "shadowfax" })}>⚡ Shadowfax (Hyperlocal 2W Express)</button>
            <button type="button" className={f.courier === "shiprocket" ? "on" : ""} onClick={() => setF({ ...f, courier: "shiprocket" })}>🚀 Shiprocket (Surface / Cargo)</button>
          </div>
          <p className="muted"><strong>{o.number}</strong> · {e.pieces.toLocaleString("en-IN")} pieces · from pickup PIN {pickup}</p>
          {f.courier === "shadowfax" && !a.connected && <p className="alert" role="alert">{a.message}. Nothing can be booked until the token is on the server.</p>}
          {f.courier === "shadowfax" && a.connected && !a.verified && <p className="alert" role="alert">{a.message}</p>}
          {o.paymentStatus === "pending" && <p className="alert" role="alert">This website order has not been paid yet.</p>}
          {o.status !== "dispatched" && <p className="muted small-print">{o.invoiceId ? "Booking raises the delivery challan. The stock already left with the invoice." : "Booking raises the delivery challan and takes the goods out of stock."}</p>}
          <div className="grid2">
            <label className="field"><span>Customer name</span><input required maxLength={100} value={f.dropName} onChange={set("dropName")} /></label>
            <label className="field"><span>Destination phone</span><input required inputMode="tel" maxLength={18} value={f.dropPhone} onChange={set("dropPhone")} /></label>
          </div>
          <label className="field"><span>Delivery address</span><textarea required rows={2} maxLength={250} value={f.dropAddress} onChange={set("dropAddress")} /></label>
          <div className="grid3">
            <label className="field"><span>Delivery PIN</span><input required inputMode="numeric" pattern="\d{6}" maxLength={6} value={f.dropPincode} onChange={digits("dropPincode")} /></label>
            <label className="field"><span>Pickup PIN</span><input required inputMode="numeric" pattern="\d{6}" maxLength={6} value={f.pickupPincode} onChange={digits("pickupPincode")} /></label>
            <label className="field"><span>Estimated weight (kg)</span><input required type="number" min="0.1" max="1000" step="any" value={f.weightKg} onChange={set("weightKg")} /></label>
            <label className="field"><span>Packages</span><input required type="number" min="1" max="500" step="1" value={f.packages} onChange={set("packages")} /></label>
          </div>
          {reach && <p className={reach.serviceable ? "notice" : "alert"}>{reach.serviceable ? `Shadowfax serves PIN ${pin}.` : `Shadowfax says PIN ${pin} is not serviceable.`}</p>}
          
          {/* Pre-Booking Wallet & Rate Estimate Box */}
          <div className="panel" style={{ background: "#F1F5F9", padding: "14px 16px", borderRadius: "8px", margin: "12px 0", border: "1px solid #CBD5E1" }}>
            <div style={{ fontWeight: 600, color: "#0F172A", marginBottom: "8px", fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: "0.03em", display: "flex", justifyContent: "space-between" }}>
              <span>Pre-Dispatch Freight & Route Breakdown</span>
              <span style={{ color: "#0284C7", textTransform: "none", fontWeight: 500 }}>
                📍 {e?.pickupLocation?.plusCode ? "F9C3+CC JV Hills" : "JV Hills"} ({e?.pickupPincode || "500084"})
              </span>
            </div>
            {e?.breakdown?.distanceKm != null && (
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px", fontSize: "0.84rem", background: "#E2E8F0", padding: "4px 8px", borderRadius: "4px" }}>
                <span>Route Distance: <strong>{e.breakdown.distanceKm} km</strong> ({e.breakdown.deliveryType || "hyperlocal"})</span>
                <span>Destination: <strong>PIN {f?.dropPincode}</strong></span>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px", fontSize: "0.88rem" }}>
              <span className="muted">Courier Freight Charge ({e?.weightKg || 1} kg):</span>
              <span>₹{(((e?.breakdown?.freightChargePaise ?? ((e?.estimatedChargePaise ?? 6500) - 500))) / 100).toFixed(2)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px", fontSize: "0.88rem" }}>
              <span className="muted">Nova Platform Commission:</span>
              <span style={{ color: "#0284C7", fontWeight: 600 }}>+₹{(((e?.breakdown?.platformFeePaise ?? 500)) / 100).toFixed(2)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #CBD5E1", paddingTop: "6px", marginBottom: "6px" }}>
              <strong>Total Estimated Delivery Fee:</strong>
              <strong style={{ color: "#0F172A" }}>₹{(((e?.estimatedChargePaise ?? 6500)) / 100).toFixed(2)}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px", fontSize: "0.88rem" }}>
              <span className="muted">Current Shipping Wallet:</span>
              <strong style={{ color: (e?.walletBalancePaise ?? 0) < (e?.estimatedChargePaise ?? 6500) ? "#DC2626" : "#047857" }}>
                ₹{(((e?.walletBalancePaise ?? 0)) / 100).toFixed(2)}
              </strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px dashed #CBD5E1", paddingTop: "6px" }}>
              <span className="muted">Projected Balance After Dispatch:</span>
              <strong style={{ color: (e?.walletBalancePaise ?? 0) < (e?.estimatedChargePaise ?? 6500) ? "#DC2626" : "#0F172A" }}>
                ₹{Math.max(0, ((e?.walletBalancePaise ?? 0) - (e?.estimatedChargePaise ?? 6500)) / 100).toFixed(2)}
              </strong>
            </div>
          </div>

          <details style={{ margin: "8px 0 14px", fontSize: "0.85rem", color: "#64748B" }}>
            <summary style={{ cursor: "pointer", fontWeight: 500, color: "#0284C7" }}>+ Bulky parcel dimensions in cm (optional, leave blank for standard bike parcel)</summary>
            <div className="grid3" style={{ marginTop: "8px" }}>
              <label className="field"><span>Length (cm)</span><input type="number" min="1" max="300" step="any" value={f.lengthCm} onChange={set("lengthCm")} placeholder="Optional" /></label>
              <label className="field"><span>Breadth (cm)</span><input type="number" min="1" max="300" step="any" value={f.breadthCm} onChange={set("breadthCm")} placeholder="Optional" /></label>
              <label className="field"><span>Height (cm)</span><input type="number" min="1" max="300" step="any" value={f.heightCm} onChange={set("heightCm")} placeholder="Optional" /></label>
            </div>
          </details>
          {st.error && <p className="alert" role="alert">{st.error}</p>}
          <button className="btn" disabled={st.busy || (f.courier === "shadowfax" && !a.connected)}>{st.busy ? "Booking…" : `Confirm & Book ${COURIERS[f.courier || "shadowfax"]}`}</button>
        </form>
      ))}</Loader>
    </Modal>
  );
}

/** Counter and direct invoices get their delivery order here, the first time someone dispatches them. */
export function InvoiceDispatch({ inv, className = "btn", onClose }) {
  const me = useMe();
  const [id, setId] = useState("");
  const [st, run] = useAction();
  if (!can(me, "orders")) return null;
  const open = () => run(async () => setId((await api(`/api/admin/invoices/${inv.id}/delivery-order`, { method: "POST" })).id));
  return <>
    <button className={className} disabled={st.busy} onClick={open}>{DISPATCH_LABEL}</button>
    <Msg st={st} />
    {id && <DispatchModal id={id} onClose={() => { setId(""); onClose?.(); }} />}
  </>;
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
