import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { can, useMe } from "./AdminApp.jsx";
import { DocView } from "./DocParts.jsx";
import { Loader, useLoad } from "./hooks.jsx";
import { DISPATCH_LABEL, dispatchable, DispatchModal, PickupModal, shipmentOpen, ShipmentPanel } from "./Logistics.jsx";
import { PayLinkActions } from "./PayLink.jsx";
import { DocEditor, fmtDate, Modal, Msg, Timeline, today, useAction } from "./ui.jsx";
import { ask } from "./toast.jsx";

const strip = (items) => items.map(({ amount, tax, total, ...l }) => l);

export default function OrderDetail() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const me = useMe(), nav = useNavigate();
  const isNew = id === "new";
  const s = useLoad(isNew ? "/api/admin/me" : `/api/admin/orders/${id}`);
  const [editing, setEditing] = useState(false);
  const [dispatch, setDispatch] = useState(null);
  const [pickup, setPickup] = useState(false);
  const [shadowfax, setShadowfax] = useState(false);
  const [st, run] = useAction();
  const o = isNew ? null : s.data;
  const tracking = shipmentOpen(o?.shipment) && !pickup && !dispatch && !editing && !shadowfax;
  useEffect(() => { // webhooks update the shipment on the server; this keeps an open order page current
    if (!tracking) return undefined;
    const t = setInterval(() => { if (!document.hidden) s.reload(); }, 20000);
    return () => clearInterval(t);
  }, [tracking, s.reload]);
  const save = (body) => run(async () => {
    const out = await api(isNew ? "/api/admin/orders" : `/api/admin/orders/${id}`, { method: isNew ? "POST" : "PUT", body });
    if (isNew) nav(`/admin/orders/${out.id}`, { replace: true }); else { setEditing(false); s.reload(); }
  });
  const status = (v) => run(async () => { await api(`/api/admin/orders/${id}/status`, { method: "POST", body: { status: v } }); s.reload(); }, `Marked ${v}`);
  const extra = (f, set) => <>
    <label className="field"><span>Customer PO number</span><input maxLength={60} value={f.poNumber || ""} onChange={(e) => set("poNumber", e.target.value)} /></label>
    <label className="field"><span>Expected delivery</span><input type="date" value={f.expectedDate || ""} onChange={(e) => set("expectedDate", e.target.value)} /></label>
  </>;

  if (isNew || editing) return (
    <>
      <p><Link to="/admin/orders">← Sales orders</Link></p>
      <h1>{isNew ? "New sales order" : `Edit ${o.number}`}</h1>
      <DocEditor kind="order" busy={st.busy} error={st.error} onSave={save} extra={extra}
        initial={isNew ? { customerId: sp.get("customer") || "", items: [], notes: "", poNumber: "", expectedDate: "", placeOfSupply: "" } : { customerId: o.customerId, items: strip(o.items), notes: o.notes, poNumber: o.poNumber, expectedDate: o.expectedDate, placeOfSupply: o.placeOfSupply }} />
    </>
  );
  return (
    <>
      <p><Link to="/admin/orders">← Sales orders</Link></p>
      <Loader s={s}>{o && (
        <>
          {o.source === "website" && <p className="notice">Website order · {o.paymentStatus === "paid" ? "paid online (invoice raised automatically)" : o.paymentStatus === "pending" ? "customer chose online payment, not paid yet: wait before dispatching" : "pay later: raise the GST invoice to send bank / UPI details"}</p>}
          <div className="row-between"><h1>Order {o.number}</h1>
            <div className="btn-row">
              {["confirmed", "packed"].includes(o.status) && !o.invoiceId && <button className="btn ghost" onClick={() => setEditing(true)}>Edit</button>}
              {dispatchable(o) && <button className="btn" onClick={() => setShadowfax(true)}>{DISPATCH_LABEL}</button>}
              {["confirmed", "packed"].includes(o.status) && <button className="btn ghost" onClick={() => setDispatch({ transporter: "", trackingNo: "", vehicleNo: "", date: today(), notes: "", courier: "", dropPincode: "", weightKg: 1, packages: 1 })}>Own delivery</button>}
            </div></div>
          <Msg st={st} />
          <DocView d={o} extraInfo={<p className="muted small-print">{o.quoteNumber && <>From quote <Link to={`/admin/quotes/${o.quoteId}`}>{o.quoteNumber}</Link><br /></>}{o.enquiryRef && <>From enquiry {o.enquiryRef}<br /></>}{o.poNumber && <>Customer PO {o.poNumber}<br /></>}{o.expectedDate && <>Expected {fmtDate(o.expectedDate)}<br /></>}
            {o.dispatch && <>Dispatched {fmtDate(o.dispatch.date)} {o.dispatch.transporter} {o.dispatch.trackingNo}<br />Challan {o.challanNumber}</>}</p>} />
          <ShipmentPanel o={o} onBook={() => setPickup(true)} />
          {!o.invoiceId && o.status !== "cancelled" && o.paymentStatus !== "paid" && <div className="panel"><h2>Online payment</h2><PayLinkActions base={`/api/admin/orders/${id}`} doc={o} due={o.totals.total} onChange={() => s.reload()} /></div>}
          <div className="btn-row">
            {o.status === "confirmed" && <button className="btn ghost" onClick={() => status("packed")}>Mark packed</button>}
            {o.status === "packed" && <button className="btn ghost" onClick={() => status("confirmed")}>Back to confirmed</button>}
            {o.status === "dispatched" && <button className="btn ghost" onClick={() => status("delivered")}>Mark delivered</button>}
            {can(me, "invoices") && !o.invoiceId && o.status !== "cancelled" && <button className="btn" onClick={() => run(async () => { const inv = await api(`/api/admin/orders/${id}/invoice`, { method: "POST" }); nav(`/admin/invoices/${inv.id}`); })}>Create GST invoice</button>}
            {o.invoiceId && <Link className="btn" to={`/admin/invoices/${o.invoiceId}`}>Invoice {o.invoiceNumber}</Link>}
            {["confirmed", "packed"].includes(o.status) && <button className="link danger" onClick={async () => { if (await ask("Cancel this order?", { danger: true, confirmLabel: "Cancel order" })) status("cancelled"); }}>Cancel order</button>}
          </div>
          <div className="panel"><h2>History</h2><Timeline entity="order" entityId={o.id} items={o.activities} onAdded={s.reload} /></div>
          {shadowfax && <DispatchModal id={o.id} onClose={() => { setShadowfax(false); s.reload(); }} />}
          {pickup && <PickupModal o={o} onClose={() => setPickup(false)} onBooked={() => { setPickup(false); s.reload(); }} />}
          {dispatch && (
            <Modal title={`Dispatch ${o.number}`} onClose={() => setDispatch(null)}>
              <form className="form" onSubmit={(e) => { e.preventDefault(); run(async () => { await api(`/api/admin/orders/${id}/dispatch`, { method: "POST", body: dispatch }); setDispatch(null); s.reload(); }, "Dispatched ✓ Challan created, stock updated, customer informed."); }}>
                <div className="grid2">
                  {[["transporter", "Transporter / courier"], ["trackingNo", "LR / tracking number"], ["vehicleNo", "Vehicle number"]].map(([k, l]) => <label key={k} className="field"><span>{l}</span><input maxLength={100} value={dispatch[k]} onChange={(e) => setDispatch({ ...dispatch, [k]: e.target.value })} /></label>)}
                  <label className="field"><span>Date</span><input type="date" value={dispatch.date} onChange={(e) => setDispatch({ ...dispatch, date: e.target.value })} /></label>
                </div>
                <label className="field"><span>Notes</span><input maxLength={500} value={dispatch.notes} onChange={(e) => setDispatch({ ...dispatch, notes: e.target.value })} /></label>
                <div className="checks"><label><input type="checkbox" checked={dispatch.courier === "shadowfax"} onChange={(e) => setDispatch({ ...dispatch, courier: e.target.checked ? "shadowfax" : "", transporter: e.target.checked ? "Shadowfax" : dispatch.transporter })} /> Book Shadowfax pickup (customer gets the live tracking link on WhatsApp)</label></div>
                {dispatch.courier === "shadowfax" && <div className="grid3">
                  <label className="field"><span>Delivery PIN (blank = from address)</span><input inputMode="numeric" maxLength={6} value={dispatch.dropPincode} onChange={(e) => setDispatch({ ...dispatch, dropPincode: e.target.value.replace(/\D/g, "") })} /></label>
                  <label className="field"><span>Weight kg</span><input type="number" min="0.1" step="any" value={dispatch.weightKg} onChange={(e) => setDispatch({ ...dispatch, weightKg: Number(e.target.value) || 1 })} /></label>
                  <label className="field"><span>Packages</span><input type="number" min="1" value={dispatch.packages} onChange={(e) => setDispatch({ ...dispatch, packages: Number(e.target.value) || 1 })} /></label>
                </div>}
                <p className="muted small-print">Stock is reduced for products whose stock is tracked.</p>
                <button className="btn" disabled={st.busy}>Confirm dispatch</button>
              </form>
            </Modal>
          )}
        </>
      )}</Loader>
    </>
  );
}
