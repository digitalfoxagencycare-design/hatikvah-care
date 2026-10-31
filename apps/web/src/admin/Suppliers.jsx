import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { Loader, useLoad } from "./hooks.jsx";
import { fmtDate, Modal, Msg, Pill, rs, StateSelect, useAction } from "./ui.jsx";
import { ThumbStack, useThumbs } from "./visual.jsx";
import { ask } from "./toast.jsx";

const EMPTY = { name: "", contactName: "", phone: "", email: "", gstin: "", stateCode: "", address: "", notes: "" };
const ACTIVE = ["draft", "sent", "partial"];

export default function Suppliers() {
  const s = useLoad("/api/admin/suppliers");
  const pos = useLoad("/api/admin/purchases");
  const map = useThumbs();
  const [edit, setEdit] = useState(null);
  const [st, run] = useAction();
  const bySupplier = useMemo(() => { const out = {}; for (const p of pos.data || []) (out[p.supplierId] ||= []).push(p); return out; }, [pos.data]);
  const save = (e) => { e.preventDefault(); const body = Object.fromEntries(Object.keys(EMPTY).map((k) => [k, edit[k] ?? ""])); run(async () => { await api(edit.id ? `/api/admin/suppliers/${edit.id}` : "/api/admin/suppliers", { method: edit.id ? "PATCH" : "POST", body }); setEdit(null); s.reload(); }); };
  return (
    <>
      <div className="row-between"><h1>Suppliers</h1><button className="btn" onClick={() => setEdit({ ...EMPTY })}>+ Add supplier</button></div>
      <Msg st={st} />
      <Loader s={s}>
        {s.data?.length === 0 && <p className="muted">No suppliers yet.</p>}
        <ul className="doc-cards">
          {s.data?.map((x) => {
            const orders = bySupplier[x.id] || [], active = orders.filter((p) => ACTIVE.includes(p.status));
            const lastDone = orders.find((p) => p.status === "received");
            const supplied = orders.filter((p) => ["received", "partial"].includes(p.status)).reduce((n, p) => n + (p.total || 0), 0);
            return (
              <li key={x.id} className="doc-card">
                <div className="doc-main">
                  <ThumbStack items={orders.flatMap((p) => p.items).filter((l, i, all) => all.findIndex((y) => y.productId === l.productId) === i)} map={map} />
                  <span className="doc-who"><strong>{x.name}</strong><small>{[x.contactName, x.phone, x.email].filter(Boolean).join(" · ") || "No contact details"}</small>
                    <small>{orders.length ? `${orders.length} order${orders.length === 1 ? "" : "s"}, ${rs(supplied)} received${lastDone ? `, last on ${fmtDate(lastDone.updatedAt || lastDone.createdAt)}` : ""}` : "No orders yet"}</small></span>
                  <span className="doc-money">{active.length > 0 ? <Pill s="sent">{active.length} active PO{active.length === 1 ? "" : "s"}</Pill> : <Pill s="draft">No active POs</Pill>}</span>
                </div>
                <div className="doc-acts">
                  {x.phone && <a className="btn ghost small" href={`tel:${x.phone}`}>Call</a>}
                  {active.slice(0, 2).map((p) => <Link key={p.id} className="btn ghost small" to={`/admin/purchase-orders/${p.id}`}>{p.number}</Link>)}
                  <button className="btn ghost small" onClick={() => setEdit(x)}>Edit</button>
                  <button className="link danger" onClick={async () => { if (await ask(`Delete ${x.name}?`, { danger: true, confirmLabel: "Delete" })) run(async () => { await api(`/api/admin/suppliers/${x.id}`, { method: "DELETE" }); s.reload(); }); }}>Delete</button>
                </div>
              </li>
            );
          })}
        </ul>
      </Loader>
      {edit && (
        <Modal title={edit.id ? `Edit ${edit.name}` : "Add supplier"} onClose={() => setEdit(null)}>
          <form className="form" onSubmit={save}>
            <div className="grid2">
              {[["name", "Name *"], ["contactName", "Contact person"], ["phone", "Phone"], ["email", "Email"], ["gstin", "GSTIN"]].map(([k, l]) => <label key={k} className="field"><span>{l}</span><input required={k === "name"} value={edit[k] || ""} onChange={(e) => setEdit({ ...edit, [k]: k === "gstin" ? e.target.value.toUpperCase() : e.target.value })} /></label>)}
              <StateSelect value={edit.stateCode || ""} onChange={(v) => setEdit({ ...edit, stateCode: v })} />
            </div>
            <label className="field"><span>Address</span><textarea rows="2" value={edit.address || ""} onChange={(e) => setEdit({ ...edit, address: e.target.value })} /></label>
            <label className="field"><span>Notes</span><input value={edit.notes || ""} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></label>
            <Msg st={st} /><button className="btn" disabled={st.busy}>Save</button>
          </form>
        </Modal>
      )}
    </>
  );
}
