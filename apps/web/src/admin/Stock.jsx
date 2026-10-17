import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { Loader, useLoad } from "./hooks.jsx";
import { fmtTime, Modal, Msg, rs, toPaise, useAction, useAsync } from "./ui.jsx";

export default function Stock() {
  const s = useLoad("/api/admin/stock");
  const suppliers = useAsync("/api/admin/suppliers");
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState("");
  const [adj, setAdj] = useState(null);
  const [hist, setHist] = useState(null);
  const [st, run] = useAction();
  const nav = useNavigate();
  const filter = sp.get("filter") || "tracked";
  const rows = useMemo(() => (s.data || []).filter((p) => (filter === "all" || (filter === "tracked" && p.stockTracked) || (filter === "low" && p.low)) && (!q || `${p.name} ${p.sku}`.toLowerCase().includes(q.toLowerCase()))), [s.data, q, filter]);
  const patch = (p, body) => run(async () => { await api(`/api/admin/stock/${p.id}`, { method: "PATCH", body }); s.reload(); });
  const value = (s.data || []).filter((p) => p.stockTracked && p.costPrice != null).reduce((n, p) => n + Math.round(p.qty * p.costPrice), 0);
  return (
    <>
      <div className="row-between"><h1>Stock</h1>
        <div className="btn-row"><a className="btn ghost" href="/api/admin/reports/stock.csv">Export CSV</a>
          <button className="btn" onClick={() => run(async () => { const r = await api("/api/admin/purchases/from-low-stock", { method: "POST" }); if (r.created.length === 1) nav(`/admin/purchases/${r.created[0].id}`); else nav("/admin/purchases"); return r; })}>Draft POs for low stock</button></div></div>
      <p className="muted">Stock goes up when purchase orders are received and down when orders are dispatched. Tick “Track” for products you hold in your warehouse. Stock value at cost: <strong>{rs(value)}</strong></p>
      <div className="toolbar">
        <input type="search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        <select value={filter} onChange={(e) => setSp({ filter: e.target.value })} aria-label="Filter"><option value="tracked">Tracked items</option><option value="low">Low stock</option><option value="all">All products</option></select>
      </div>
      <Msg st={st} />
      <Loader s={s}>
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>Product</th><th>Track</th><th className="num">In stock</th><th>On order</th><th>Reorder at</th><th>Reorder qty</th><th>Cost ₹</th><th>Supplier</th><th></th></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className={p.low ? "low" : ""}>
                <td><strong>{p.name}</strong><small>{p.sku} · {p.pack}</small></td>
                <td><input type="checkbox" checked={p.stockTracked} onChange={(e) => patch(p, { stockTracked: e.target.checked })} aria-label={`Track stock of ${p.name}`} /></td>
                <td className="num"><strong>{p.qty.toLocaleString("en-IN")}</strong> {p.unit}{p.low && <small className="due">low</small>}</td>
                <td>{p.onOrder || ""}</td>
                <td><input className="w-sm" type="number" min="0" defaultValue={p.reorderLevel} onBlur={(e) => Number(e.target.value) !== p.reorderLevel && patch(p, { reorderLevel: Number(e.target.value) || 0 })} aria-label="Reorder level" /></td>
                <td><input className="w-sm" type="number" min="0" defaultValue={p.reorderQty} onBlur={(e) => Number(e.target.value) !== p.reorderQty && patch(p, { reorderQty: Number(e.target.value) || 0 })} aria-label="Reorder quantity" /></td>
                <td><input className="w-sm" inputMode="decimal" defaultValue={p.costPrice != null ? p.costPrice / 100 : ""} onBlur={(e) => { const v = toPaise(e.target.value); if (!Number.isNaN(v) && v !== p.costPrice) patch(p, { costPrice: v }); }} aria-label="Cost price" /></td>
                <td><select value={p.supplierId} onChange={(e) => patch(p, { supplierId: e.target.value })} aria-label="Supplier"><option value="">—</option>{suppliers.data?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></td>
                <td className="btn-row"><button className="link" onClick={() => setAdj({ p, kind: "in", qty: "", note: "" })}>Adjust</button><button className="link" onClick={() => setHist(p)}>History</button></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan="9" className="muted">{filter === "tracked" ? "No tracked products yet. Choose “All products” and tick Track, or receive a purchase order." : "Nothing here."}</td></tr>}
          </tbody>
        </table></div>
      </Loader>
      {adj && (
        <Modal title={`Adjust stock: ${adj.p.name}`} onClose={() => setAdj(null)}>
          <form className="form" onSubmit={(e) => { e.preventDefault(); run(async () => { await api("/api/admin/stock/adjust", { method: "POST", body: { productId: adj.p.id, kind: adj.kind, qty: Number(adj.qty), note: adj.note } }); setAdj(null); s.reload(); }, "Stock updated ✓"); }}>
            <p className="muted">Now in stock: {adj.p.qty} {adj.p.unit}</p>
            <div className="grid2">
              <label className="field"><span>Type</span><select value={adj.kind} onChange={(e) => setAdj({ ...adj, kind: e.target.value })}><option value="in">Stock in (+)</option><option value="out">Stock out (−) e.g. damaged, samples</option><option value="adjust">Correction (+ or −)</option></select></label>
              <label className="field"><span>Quantity</span><input type="number" step="any" required value={adj.qty} onChange={(e) => setAdj({ ...adj, qty: e.target.value })} /></label>
            </div>
            <label className="field"><span>Note</span><input maxLength={300} value={adj.note} onChange={(e) => setAdj({ ...adj, note: e.target.value })} placeholder="Opening stock, stock count, damaged…" /></label>
            <button className="btn">Save</button>
          </form>
        </Modal>
      )}
      {hist && <Modal title={`Stock history: ${hist.name}`} wide onClose={() => setHist(null)}><History id={hist.id} /></Modal>}
    </>
  );
}
function History({ id }) {
  const s = useLoad(`/api/admin/stock/moves?productId=${id}`);
  return <Loader s={s}><table className="tbl"><thead><tr><th>When</th><th>Type</th><th className="num">Qty</th><th>Ref</th><th>Note</th><th>By</th></tr></thead><tbody>
    {s.data?.map((m) => <tr key={m.id}><td>{fmtTime(m.at)}</td><td>{m.kind}</td><td className="num">{m.qty > 0 ? "+" : ""}{m.qty}</td><td>{m.ref}</td><td>{m.note}</td><td>{m.by}</td></tr>)}
    {s.data?.length === 0 && <tr><td colSpan="6" className="muted">No movements yet.</td></tr>}
  </tbody></table></Loader>;
}
