import { useState } from "react";
import { api } from "../api.js";
import { useMe } from "./AdminApp.jsx";
import { Loader, useLoad } from "./hooks.jsx";

const STATUSES = ["new", "contacted", "quoted", "won", "closed"];
export default function Enquiries() {
  const me = useMe();
  const [status, setStatus] = useState("");
  const s = useLoad("/api/admin/enquiries" + (status ? `?status=${status}` : ""));
  const [open, setOpen] = useState(null);
  const [msg, setMsg] = useState(null);
  const update = async (e, body) => { setMsg(null); try { const n = await api(`/api/admin/enquiries/${e.id}`, { method: "PATCH", body }); s.setData((d) => d.map((x) => (x.id === n.id ? n : x))); } catch (err) { setMsg(err.message); } };
  const del = async (e) => { if (!window.confirm(`Delete enquiry ${e.ref}?`)) return; try { await api(`/api/admin/enquiries/${e.id}`, { method: "DELETE" }); s.reload(); } catch (err) { setMsg(err.message); } };
  return (
    <>
      <div className="row-between"><h1>Enquiries</h1><a className="btn ghost" href="/api/admin/enquiries/export.csv">Export CSV</a></div>
      <div className="toolbar"><select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All statuses</option>{STATUSES.map((x) => <option key={x}>{x}</option>)}</select></div>
      {msg && <p className="alert" role="alert">{msg}</p>}
      <Loader s={s}>
        {s.data?.length === 0 ? <p className="muted">No enquiries {status ? `with status “${status}”` : "yet"}.</p> : (
          <ul className="enq">
            {s.data?.map((e) => (
              <li key={e.id} className="panel">
                <button className="enq-head" onClick={() => setOpen(open === e.id ? null : e.id)} aria-expanded={open === e.id}>
                  <strong>{e.ref}</strong> <span>{e.name}{e.company && ` · ${e.company}`}</span> <small>{new Date(e.createdAt).toLocaleString("en-IN")}</small> <span className={"pill " + e.status}>{e.status}</span>
                </button>
                {open === e.id && (
                  <div className="enq-body">
                    <p><a href={`tel:${e.phone}`}>{e.phone}</a>{e.email && <> · <a href={`mailto:${e.email}`}>{e.email}</a></>}</p>
                    {e.message && <p className="quote-msg">{e.message}</p>}
                    {e.items.length > 0 && <table className="tbl"><thead><tr><th>Product</th><th>SKU</th><th>Qty</th></tr></thead><tbody>{e.items.map((i) => <tr key={i.productId}><td>{i.name}</td><td>{i.sku}</td><td>{i.qty.toLocaleString("en-IN")}</td></tr>)}</tbody></table>}
                    <div className="grid2">
                      <label className="field"><span>Status</span><select value={e.status} onChange={(ev) => update(e, { status: ev.target.value })}>{STATUSES.map((x) => <option key={x}>{x}</option>)}</select></label>
                      <label className="field"><span>Internal notes</span><textarea rows="2" maxLength={2000} defaultValue={e.notes} onBlur={(ev) => ev.target.value !== e.notes && update(e, { notes: ev.target.value })} /></label>
                    </div>
                    {me.role === "owner" && <button className="link danger" onClick={() => del(e)}>Delete enquiry</button>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Loader>
    </>
  );
}
