import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { Loader, useLoad } from "./hooks.jsx";
import { fmtDate, Msg, Pill, rs, Timeline, toPaise, useAction, useAsync } from "./ui.jsx";

export default function PurchaseDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const isNew = id === "new";
  const s = useLoad(isNew ? "/api/admin/me" : `/api/admin/purchases/${id}`);
  const [editing, setEditing] = useState(isNew);
  const [st, run] = useAction();
  const po = isNew ? null : s.data;
  const [recv, setRecv] = useState({});
  if (editing) return <><p><Link to="/admin/purchases">← Purchase orders</Link></p><h1>{isNew ? "New purchase order" : `Edit ${po.number}`}</h1><Editor po={po} st={st} onSave={(body) => run(async () => { const out = await api(isNew ? "/api/admin/purchases" : `/api/admin/purchases/${id}`, { method: isNew ? "POST" : "PUT", body }); if (isNew) nav(`/admin/purchases/${out.id}`, { replace: true }); else { setEditing(false); s.reload(); } })} /></>;
  const status = (v) => run(async () => { await api(`/api/admin/purchases/${id}/status`, { method: "POST", body: { status: v } }); s.reload(); });
  const receive = () => { const lines = Object.entries(recv).filter(([, q]) => Number(q) > 0).map(([productId, q]) => ({ productId, qty: Number(q) })); if (lines.length) run(async () => { await api(`/api/admin/purchases/${id}/receive`, { method: "POST", body: { lines } }); setRecv({}); s.reload(); }, "Received ✓ Stock updated."); };
  return (
    <>
      <p><Link to="/admin/purchases">← Purchase orders</Link></p>
      <Loader s={s}>{po && (
        <>
          <div className="row-between"><h1>{po.number} <Pill s={po.status} /></h1>
            <div className="btn-row">
              {["draft", "sent", "partial"].includes(po.status) && (
                <button className="btn" disabled={st.busy} onClick={() => {
                  const billNumber = window.prompt("Supplier Invoice / Bill number (optional):", po.billNumber || "") || "";
                  run(async () => { await api(`/api/admin/purchases/${id}/receive-all`, { method: "POST", body: { billNumber } }); s.reload(); }, "All goods received & stock auto-increased! (Auto +)");
                }}>Receive All to Stock (Auto +)</button>
              )}
              {po.status === "draft" && <><button className="btn ghost" onClick={() => setEditing(true)}>Edit</button><button className="btn ghost" onClick={() => status("sent")}>Mark sent to supplier</button></>}
              {["draft", "sent"].includes(po.status) && <button className="link danger" onClick={() => window.confirm("Cancel this purchase order?") && status("cancelled")}>Cancel</button>}
              {po.status === "partial" && <button className="btn ghost" onClick={() => status("received")}>Close (rest not coming)</button>}</div></div>
          <p className="muted">{po.supplierName} · {po.billNumber ? `Supplier Bill #${po.billNumber} · ` : ""}{po.expectedDate ? `expected ${fmtDate(po.expectedDate)}` : "no date"} {po.notes && `· ${po.notes}`}</p>
          <Msg st={st} />
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Product</th><th className="num">Ordered</th><th className="num">Received</th><th>Rate</th><th className="num">Amount</th>{["sent", "partial", "draft"].includes(po.status) && <th>Receive now</th>}</tr></thead><tbody>
            {po.items.map((i) => <tr key={i.productId}><td>{i.name}<small>{i.sku}</small></td><td className="num">{i.qty}</td><td className="num">{i.received || 0}</td><td>{rs(i.rate)}</td><td className="num">{rs(Math.round(i.qty * i.rate))}</td>
              {["sent", "partial", "draft"].includes(po.status) && <td><input className="w-sm" type="number" min="0" step="any" placeholder={String(Math.max(0, i.qty - (i.received || 0)))} value={recv[i.productId] || ""} onChange={(e) => setRecv({ ...recv, [i.productId]: e.target.value })} aria-label={`Receive ${i.name}`} /></td>}</tr>)}
            <tr className="grand"><td colSpan="4">Total (before GST)</td><td className="num">{rs(po.total)}</td>{["sent", "partial", "draft"].includes(po.status) && <td><button className="btn small" onClick={receive}>Receive</button> <button className="link" onClick={() => setRecv(Object.fromEntries(po.items.map((i) => [i.productId, String(Math.max(0, i.qty - (i.received || 0)))])))}>all</button></td>}</tr>
          </tbody></table></div>
          <div className="panel"><h2>History</h2><Timeline entity="purchase" entityId={po.id} items={po.activities} onAdded={s.reload} /></div>
        </>
      )}</Loader>
    </>
  );
}

function Editor({ po, st, onSave }) {
  const suppliers = useAsync("/api/admin/suppliers"), stock = useAsync("/api/admin/stock");
  const [f, setF] = useState({ supplierId: po?.supplierId || "", billNumber: po?.billNumber || "", receiveNow: !po?.id, expectedDate: po?.expectedDate || "", notes: po?.notes || "", items: po?.items.map((i) => ({ productId: i.productId, qty: i.qty, rate: i.rate })) || [] });
  const [pick, setPick] = useState("");
  const name = (pid) => stock.data?.find((p) => p.id === pid)?.name || pid;
  useEffect(() => { if (!f.supplierId && suppliers.data?.length === 1) setF((x) => ({ ...x, supplierId: suppliers.data[0].id })); }, [suppliers.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const add = (label) => { const p = stock.data?.find((x) => `${x.sku} · ${x.name}` === label); if (!p) return; setF({ ...f, items: [...f.items, { productId: p.id, qty: p.reorderQty || 1, rate: p.costPrice || 0 }] }); setPick(""); };
  return (
    <form className="panel form" onSubmit={(e) => { e.preventDefault(); onSave({ ...f, items: f.items.map((i) => ({ ...i, qty: Number(i.qty) })) }); }}>
      <div className="grid3">
        <label className="field"><span>Supplier *</span><select required value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}><option value="">Choose…</option>{suppliers.data?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select><small><Link to="/admin/suppliers">Manage suppliers</Link></small></label>
        <label className="field"><span>Supplier Bill / Invoice No (optional)</span><input maxLength={80} value={f.billNumber} onChange={(e) => setF({ ...f, billNumber: e.target.value })} placeholder="e.g. INV-8821" /></label>
        <label className="field"><span>Expected date</span><input type="date" value={f.expectedDate} onChange={(e) => setF({ ...f, expectedDate: e.target.value })} /></label>
      </div>
      <label className="field"><span>Notes</span><input maxLength={1000} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
      {!po && (
        <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", padding: "10px 14px", borderRadius: "8px" }}>
          <label className="check-inline" style={{ display: "flex", gap: "8px", alignItems: "center", cursor: "pointer", fontWeight: "600", color: "#166534" }}>
            <input type="checkbox" checked={f.receiveNow} onChange={(e) => setF({ ...f, receiveNow: e.target.checked })} />
            Auto-add to Stock immediately (Auto +) — goods already arrived / received
          </label>
        </div>
      )}
      <table className="tbl"><thead><tr><th>Product</th><th>Qty</th><th>Cost rate ₹</th><th></th></tr></thead><tbody>
        {f.items.map((i, n) => <tr key={n}><td>{name(i.productId)}</td><td><input className="w-sm" type="number" min="0.001" step="any" required value={i.qty} onChange={(e) => setF({ ...f, items: f.items.map((x, j) => (j === n ? { ...x, qty: e.target.value } : x)) })} aria-label="Quantity" /></td>
          <td><input className="w-sm" inputMode="decimal" defaultValue={i.rate ? i.rate / 100 : ""} onBlur={(e) => { const v = toPaise(e.target.value); setF({ ...f, items: f.items.map((x, j) => (j === n ? { ...x, rate: Number.isNaN(v) || v == null ? 0 : v } : x)) }); }} aria-label="Rate" /></td>
          <td><button type="button" className="link danger" onClick={() => setF({ ...f, items: f.items.filter((_, j) => j !== n) })}>✕</button></td></tr>)}
      </tbody></table>
      <div style={{ display: "flex", gap: "10px", margin: "10px 0", flexWrap: "wrap" }}>
        <input style={{ flex: "1 1 240px" }} list="po-products" value={pick} placeholder="Type SKU or name to add…" onChange={(e) => { setPick(e.target.value); add(e.target.value); }} aria-label="Add product" />
        <select style={{ flex: "1 1 280px", padding: "8px 12px" }} value="" onChange={(e) => { if (e.target.value) { add(e.target.value); } }}>
          <option value="">— Or click to pick product ({stock.data?.length || 0}) —</option>
          {stock.data?.map((p) => <option key={p.id} value={`${p.sku} · ${p.name}`}>{p.sku} · {p.name}</option>)}
        </select>
        <datalist id="po-products">{stock.data?.map((p) => <option key={p.id} value={`${p.sku} · ${p.name}`} />)}</datalist>
      </div>
      <Msg st={st} /><button className="btn" disabled={st.busy || !f.items.length}>{f.receiveNow ? "Save & Add to Stock (Auto +)" : "Save purchase order"}</button>
    </form>
  );
}
