import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { can, useMe } from "./AdminApp.jsx";
import BookingModal from "./BookingModal.jsx";
import { Loader, useLoad } from "./hooks.jsx";
import { fmtTime, personName, PersonSelect, Pill, Timeline, useMeta, Msg } from "./ui.jsx";
import { ask } from "./toast.jsx";

const STATUSES = ["new", "contacted", "quoted", "won", "closed"];
export default function Enquiries() {
  const me = useMe(), meta = useMeta(), nav = useNavigate();
  const [status, setStatus] = useState("");
  const [mine, setMine] = useState(false);
  const s = useLoad("/api/admin/enquiries" + (status ? `?status=${status}` : ""));
  const [open, setOpen] = useState(null);
  const [msg, setMsg] = useState(null);
  const [booking, setBooking] = useState(null);
  const canBook = can(me, "enquiries") && can(me, "orders");
  const acts =useLoad(open ? `/api/admin/activities?entityId=${open}` : "/api/admin/activities?entityId=none");
  const replace = (n) => s.setData((d) => d.map((x) => (x.id === n.id ? n : x)));
  const update = async (e, body) => { setMsg(null); try { replace(await api(`/api/admin/enquiries/${e.id}`, { method: "PATCH", body })); } catch (err) { setMsg(err.message); } };
  const del = async (e) => { if (!await ask(`Delete enquiry ${e.ref}?`, { danger: true, confirmLabel: "Delete" })) return; try { await api(`/api/admin/enquiries/${e.id}`, { method: "DELETE" }); s.reload(); } catch (err) { setMsg(err.message); } };
  const convert = async (e) => { setMsg(null); try { const r = await api(`/api/admin/enquiries/${e.id}/convert`, { method: "POST" }); replace(r.enquiry); return r; } catch (err) { setMsg(err.message); } };
  const quote = async (e) => {
    setMsg(null);
    try { if (!e.customerId) await convert(e); const q = await api(`/api/admin/quotes/from-enquiry/${e.id}`, { method: "POST" }); nav(`/admin/quotes/${q.id}`); }
    catch (err) { setMsg(err.message); }
  };
  const rows = (s.data || []).filter((e) => !mine || e.assignedTo === me.id);
  return (
    <>
      <div className="row-between"><h1>Enquiries</h1><a className="btn ghost" href="/api/admin/enquiries/export.csv">Export CSV</a></div>
      <div className="toolbar">
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All statuses</option>{STATUSES.map((x) => <option key={x}>{x}</option>)}</select>
        <label className="check-inline"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Only mine</label>
      </div>
      <Msg st={{ error: msg }} />
      <Loader s={s}>
        {rows.length === 0 ? <p className="muted">No enquiries {status ? `with status “${status}”` : "yet"}.</p> : (
          <ul className="enq">
            {rows.map((e) => (
              <li key={e.id} className="panel">
                <button className="enq-head" onClick={() => setOpen(open === e.id ? null : e.id)} aria-expanded={open === e.id}>
                  <strong>{e.ref}</strong> <span>{e.name}{e.company && ` · ${e.company}`}</span>
                  {e.assignedTo && <span className="tag">👤 {personName(meta, e.assignedTo)}</span>}
                  {e.followUpAt && <span className="tag">⏰ {e.followUpAt}</span>}
                  {e.source?.utm_source && <span className="tag">{e.source.utm_source}</span>}
                  <small>{fmtTime(e.createdAt)}</small> <Pill s={e.status} />
                </button>
                {open === e.id && (
                  <div className="enq-body">
                    <p><a href={`tel:${e.phone}`}>{e.phone}</a>{e.email && <> · <a href={`mailto:${e.email}`}>{e.email}</a></>} · <a href={`https://wa.me/${e.phone.replace(/\D/g, "").replace(/^(\d{10})$/, "91$1")}`} target="_blank" rel="noopener noreferrer">WhatsApp</a></p>
                    {e.message && <p className="quote-msg">{e.message}</p>}
                    {e.items.length > 0 && <table className="tbl"><thead><tr><th>Product</th><th>SKU</th><th>Qty</th></tr></thead><tbody>{e.items.map((i) => <tr key={i.productId}><td>{i.name}</td><td>{i.sku}</td><td>{i.qty.toLocaleString("en-IN")}</td></tr>)}</tbody></table>}
                    <div className="grid3">
                      <label className="field"><span>Status</span><select value={e.status} onChange={(ev) => update(e, { status: ev.target.value })}>{STATUSES.map((x) => <option key={x}>{x}</option>)}</select></label>
                      <PersonSelect value={e.assignedTo} onChange={(v) => update(e, { assignedTo: v })} />
                      <label className="field"><span>Next follow-up</span><input type="date" value={e.followUpAt || ""} onChange={(ev) => update(e, { followUpAt: ev.target.value })} /></label>
                    </div>
                    <label className="field"><span>Internal notes</span><textarea rows="2" maxLength={2000} defaultValue={e.notes} onBlur={(ev) => ev.target.value !== e.notes && update(e, { notes: ev.target.value })} /></label>
                    <div className="btn-row">
                      {e.customerId ? <Link className="btn ghost small" to={`/admin/customers/${e.customerId}`}>Open customer</Link> : can(me, "customers") && <button className="btn ghost small" onClick={() => convert(e)}>Create customer</button>}
                      {e.orderId ? can(me, "orders") && <Link className="btn small" to={`/admin/orders/${e.orderId}`}>Order {e.orderNumber}</Link> : canBook && !e.quoteId && e.status !== "closed" && <button className="btn small" onClick={() => setBooking(e)}>Book Order</button>}
                      {can(me, "quotes") && (e.quoteId ? <Link className="btn small" to={`/admin/quotes/${e.quoteId}`}>Open quote</Link> : !e.orderId && <button className="btn ghost small" onClick={() => quote(e)}>Make quotation</button>)}
                      {me.role === "owner" && <button className="link danger" onClick={() => del(e)}>Delete enquiry</button>}
                    </div>
                    <h3>Activity</h3>
                    <Timeline entity="enquiry" entityId={e.id} items={acts.data || []} followUp onAdded={() => { acts.reload(); s.reload(); }} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Loader>
      {booking && <BookingModal enquiry={booking} onClose={() => setBooking(null)} onBooked={(r) => nav(`/admin/orders/${r.order.id}`)} />}
    </>
  );
}
