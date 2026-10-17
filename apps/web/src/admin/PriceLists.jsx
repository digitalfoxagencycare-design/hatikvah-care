import { useState } from "react";
import { api } from "../api.js";
import { Loader, useLoad } from "./hooks.jsx";
import { Modal, Msg, rs, toPaise, useAction, useAsync } from "./ui.jsx";

export default function PriceLists() {
  const s = useLoad("/api/admin/price-lists");
  const products = useAsync("/api/admin/rates");
  const [edit, setEdit] = useState(null);
  return (
    <>
      <div className="row-between"><h1>Price lists</h1><button className="btn" onClick={() => setEdit({ name: "", discountPct: 0, prices: {} })}>+ New price list</button></div>
      <p className="muted">Give some customers special rates: a discount off the catalogue price, and/or a fixed price for particular products. Choose the price list on the customer; quotes then use those rates.</p>
      <Loader s={s}>
        <table className="tbl"><thead><tr><th>Name</th><th>Discount</th><th>Fixed prices</th><th></th></tr></thead><tbody>
          {s.data?.map((l) => <tr key={l.id}><td><strong>{l.name}</strong></td><td>{l.discountPct}%</td><td>{Object.keys(l.prices).length}</td><td><button className="link" onClick={() => setEdit(l)}>Edit</button></td></tr>)}
          {s.data?.length === 0 && <tr><td colSpan="4" className="muted">No price lists yet.</td></tr>}
        </tbody></table>
      </Loader>
      {edit && <Modal title={edit.id ? `Edit ${edit.name}` : "New price list"} wide onClose={() => setEdit(null)}><Editor list={edit} products={products.data || []} onDone={() => { setEdit(null); s.reload(); }} /></Modal>}
    </>
  );
}

function Editor({ list, products, onDone }) {
  const [f, setF] = useState({ name: list.name, discountPct: list.discountPct, prices: { ...list.prices } });
  const [q, setQ] = useState("");
  const [st, run] = useAction();
  const save = (e) => { e.preventDefault(); run(async () => { await api(list.id ? `/api/admin/price-lists/${list.id}` : "/api/admin/price-lists", { method: list.id ? "PATCH" : "POST", body: { ...f, discountPct: Number(f.discountPct) || 0 } }); onDone(); }); };
  const del = () => window.confirm("Delete this price list?") && run(async () => { await api(`/api/admin/price-lists/${list.id}`, { method: "DELETE" }); onDone(); });
  const shown = products.filter((p) => f.prices[p.productId] != null || (q && `${p.name} ${p.sku}`.toLowerCase().includes(q.toLowerCase()))).slice(0, 60);
  return (
    <form className="form" onSubmit={save}>
      <div className="grid2">
        <label className="field"><span>Name</span><input required minLength={2} maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Hotel chains 8%" /></label>
        <label className="field"><span>Discount on catalogue prices (%)</span><input type="number" min="0" max="90" step="any" value={f.discountPct} onChange={(e) => setF({ ...f, discountPct: e.target.value })} /></label>
      </div>
      <label className="field"><span>Fixed price for a product (overrides the discount)</span><input type="search" placeholder="Search a product…" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Product</th><th>Catalogue</th><th>Special ₹</th></tr></thead><tbody>
        {shown.map((p) => <tr key={p.productId}><td>{p.name}<small>{p.sku}</small></td><td>{rs(p.rate || null)}</td>
          <td><input className="w-sm" inputMode="decimal" defaultValue={f.prices[p.productId] != null ? f.prices[p.productId] / 100 : ""} onBlur={(e) => { const v = toPaise(e.target.value); const prices = { ...f.prices }; if (v == null || Number.isNaN(v)) delete prices[p.productId]; else prices[p.productId] = v; setF({ ...f, prices }); }} aria-label={`Special price for ${p.name}`} /></td></tr>)}
        {shown.length === 0 && <tr><td colSpan="3" className="muted">Search above to set a fixed price.</td></tr>}
      </tbody></table></div>
      <Msg st={st} />
      <div className="btn-row"><button className="btn" disabled={st.busy}>Save</button>{list.id && <button type="button" className="link danger" onClick={del}>Delete</button>}</div>
    </form>
  );
}
