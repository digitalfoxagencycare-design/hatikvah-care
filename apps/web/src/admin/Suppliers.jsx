import { useState } from "react";
import { api } from "../api.js";
import { Loader, useLoad } from "./hooks.jsx";
import { Modal, Msg, StateSelect, useAction } from "./ui.jsx";

const EMPTY = { name: "", contactName: "", phone: "", email: "", gstin: "", stateCode: "", address: "", notes: "" };
export default function Suppliers() {
  const s = useLoad("/api/admin/suppliers");
  const [edit, setEdit] = useState(null);
  const [st, run] = useAction();
  const save = (e) => { e.preventDefault(); const body = Object.fromEntries(Object.keys(EMPTY).map((k) => [k, edit[k] ?? ""])); run(async () => { await api(edit.id ? `/api/admin/suppliers/${edit.id}` : "/api/admin/suppliers", { method: edit.id ? "PATCH" : "POST", body }); setEdit(null); s.reload(); }); };
  return (
    <>
      <div className="row-between"><h1>Suppliers</h1><button className="btn" onClick={() => setEdit({ ...EMPTY })}>+ Add supplier</button></div>
      <Msg st={st} />
      <Loader s={s}>
        <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Supplier</th><th>Contact</th><th>GSTIN</th><th></th></tr></thead><tbody>
          {s.data?.map((x) => <tr key={x.id}><td><strong>{x.name}</strong><small>{x.address}</small></td><td>{x.contactName}<small>{x.phone} {x.email}</small></td><td>{x.gstin || "—"}</td>
            <td className="btn-row"><button className="link" onClick={() => setEdit(x)}>Edit</button><button className="link danger" onClick={() => window.confirm(`Delete ${x.name}?`) && run(async () => { await api(`/api/admin/suppliers/${x.id}`, { method: "DELETE" }); s.reload(); })}>Delete</button></td></tr>)}
          {s.data?.length === 0 && <tr><td colSpan="4" className="muted">No suppliers yet.</td></tr>}
        </tbody></table></div>
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
