import { useState } from "react";
import { api } from "../api.js";
import { Loader, useLoad } from "./hooks.jsx";
import { Modal, Msg, rs, toPaise, useAction, useAsync } from "./ui.jsx";
import { ask } from "./toast.jsx";

export default function PriceLists() {
  const s = useLoad("/api/admin/price-lists");
  const products = useAsync("/api/admin/rates");
  const [edit, setEdit] = useState(null);
  return (
    <>
      <div className="row-between"><h1>Offers & Discounts</h1><button className="btn" onClick={() => setEdit({ name: "", discountPct: 0, prices: {} })}>+ New offer</button></div>
      <p className="muted">Create special offers and discounts for clients (e.g. 10% festive offer, corporate discount, fixed special pricing). Attach the offer to a customer; quotations will automatically calculate discounted rates.</p>
      <Loader s={s}>
        <table className="tbl"><thead><tr><th>Offer Name</th><th>Discount</th><th>Fixed item rates</th><th></th></tr></thead><tbody>
          {s.data?.map((l) => <tr key={l.id}><td><strong>{l.name}</strong></td><td>{l.discountPct}%</td><td>{Object.keys(l.prices).length} products</td><td><button className="link" onClick={() => setEdit(l)}>Edit</button></td></tr>)}
          {s.data?.length === 0 && <tr><td colSpan="4" className="muted">No offers created yet.</td></tr>}
        </tbody></table>
      </Loader>
      {edit && <Modal title={edit.id ? `Edit ${edit.name}` : "New offer"} wide onClose={() => setEdit(null)}><Editor list={edit} products={products.data || []} onDone={() => { setEdit(null); s.reload(); }} /></Modal>}
    </>
  );
}

function Editor({ list, products, onDone }) {
  const [f, setF] = useState({ name: list.name, discountPct: list.discountPct, prices: { ...list.prices } });
  const [q, setQ] = useState("");
  const [st, run] = useAction();
  const save = (e) => { e.preventDefault(); run(async () => { await api(list.id ? `/api/admin/price-lists/${list.id}` : "/api/admin/price-lists", { method: list.id ? "PATCH" : "POST", body: { ...f, discountPct: Number(f.discountPct) || 0 } }); onDone(); }); };
  const del = async () => { if (await ask("Delete this price list?", { danger: true, confirmLabel: "Delete" })) run(async () => { await api(`/api/admin/price-lists/${list.id}`, { method: "DELETE" }); onDone(); }); };
  const shown = products.filter((p) => f.prices[p.productId] != null || (q && `${p.name} ${p.sku}`.toLowerCase().includes(q.toLowerCase()))).slice(0, 60);
  return (
    <form className="form" onSubmit={save}>
      <div className="grid2">
        <label className="field"><span>Offer Name</span><input required minLength={2} maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Resort Festive Offer 10%" /></label>
        <label className="field"><span>Discount on catalogue prices (%)</span><input type="number" min="0" max="90" step="any" value={f.discountPct} onChange={(e) => setF({ ...f, discountPct: e.target.value })} /></label>
      </div>
      <label className="field"><span>Fixed price for specific products (overrides the percentage discount)</span><input type="search" placeholder="Search a product…" value={q} onChange={(e) => setQ(e.target.value)} /></label>
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
