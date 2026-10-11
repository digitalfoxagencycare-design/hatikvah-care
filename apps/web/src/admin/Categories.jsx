import { useState } from "react";
import { api } from "../api.js";
import { Loader, useLoad } from "./hooks.jsx";

export default function Categories() {
  const s = useLoad("/api/admin/categories");
  const [msg, setMsg] = useState(null);
  const [n, setN] = useState({ name: "", description: "", order: 0 });
  const act = async (fn) => { setMsg(null); try { await fn(); s.reload(); } catch (e) { setMsg(e.message); } };
  const save = (c, k, v) => act(() => api(`/api/admin/categories/${c.id}`, { method: "PATCH", body: { [k]: k === "order" ? Number(v) || 0 : v } }));
  return (
    <>
      <h1>Categories</h1>
      <p className="muted">Categories group products on the website. Lower “order” numbers appear first.</p>
      {msg && <p className="alert" role="alert">{msg}</p>}
      <Loader s={s}>
        <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Order</th><th>Name</th><th>Description</th><th>Products</th><th></th></tr></thead><tbody>
          {s.data?.map((c) => (
            <tr key={c.id}>
              <td><input className="unit-in" type="number" min="0" defaultValue={c.order} onBlur={(e) => Number(e.target.value) !== c.order && save(c, "order", e.target.value)} aria-label={`Order of ${c.name}`} /></td>
              <td><input defaultValue={c.name} minLength={2} maxLength={80} onBlur={(e) => e.target.value.trim() && e.target.value !== c.name && save(c, "name", e.target.value)} aria-label="Name" /></td>
              <td><input className="wide" defaultValue={c.description} maxLength={400} onBlur={(e) => e.target.value !== c.description && save(c, "description", e.target.value)} aria-label="Description" /></td>
              <td>{c.products}</td>
              <td><button className="link danger" disabled={c.products > 0} title={c.products ? "Move its products first" : ""} onClick={() => window.confirm(`Delete category “${c.name}”?`) && act(() => api(`/api/admin/categories/${c.id}`, { method: "DELETE" }))}>Delete</button></td>
            </tr>
          ))}
        </tbody></table></div>
        <form className="panel form" onSubmit={(e) => { e.preventDefault(); act(async () => { await api("/api/admin/categories", { method: "POST", body: { ...n, order: Number(n.order) || 0 } }); setN({ name: "", description: "", order: 0 }); }); }}>
          <h2>Add a category</h2>
          <div className="grid2"><label className="field"><span>Name *</span><input required minLength={2} maxLength={80} value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} /></label>
            <label className="field"><span>Order</span><input type="number" min="0" value={n.order} onChange={(e) => setN({ ...n, order: e.target.value })} /></label></div>
          <label className="field"><span>Description</span><input maxLength={400} value={n.description} onChange={(e) => setN({ ...n, description: e.target.value })} /></label>
          <button className="btn">Add category</button>
        </form>
      </Loader>
    </>
  );
}
