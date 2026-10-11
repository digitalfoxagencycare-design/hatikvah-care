import { useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { Loader, useLoad } from "./hooks.jsx";

const toPaise = (s) => { if (s.trim() === "") return null; const n = Number(s.replace(/,/g, "")); return Number.isFinite(n) && n >= 0 && n <= 1_000_000 ? Math.round(n * 100) : NaN; };

function PriceCell({ p, onSaved, onError }) {
  const [v, setV] = useState(p.price == null ? "" : String(p.price / 100));
  const [busy, setBusy] = useState(false);
  const commit = async () => {
    const paise = toPaise(v);
    if (Number.isNaN(paise)) { onError("Enter a price in rupees, like 125 or 12.50"); setV(p.price == null ? "" : String(p.price / 100)); return; }
    if (paise === p.price) return;
    setBusy(true);
    try { onSaved(await api(`/api/admin/products/${p.id}`, { method: "PATCH", body: { price: paise } })); } catch (e) { onError(e.message); } finally { setBusy(false); }
  };
  return <label className="price-in"><span>₹</span><input inputMode="decimal" value={v} placeholder="—" disabled={busy} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} aria-label={`Price for ${p.name}`} /></label>;
}

export default function Products() {
  const s = useLoad("/api/admin/products");
  const cats = useLoad("/api/admin/categories");
  const [sp, setSp] = useSearchParams();
  const [msg, setMsg] = useState(null);
  const [imp, setImp] = useState(false);
  const q = sp.get("q") || "", cat = sp.get("category") || "", filter = sp.get("filter") || "";
  const set = (k, v) => { const n = new URLSearchParams(sp); v ? n.set(k, v) : n.delete(k); setSp(n, { replace: true }); };
  const rows = useMemo(() => (s.data || []).filter((p) =>
    (!cat || p.category === cat) && (!q || `${p.name} ${p.sku} ${p.collection}`.toLowerCase().includes(q.toLowerCase())) &&
    (!filter || (filter === "noprice" && p.price == null) || (filter === "hidden" && !p.active) || (filter === "nophoto" && !p.images.length))), [s.data, q, cat, filter]);
  const replace = (np) => s.setData((d) => d.map((x) => (x.id === np.id ? np : x)));
  const patch = async (p, body) => { try { replace(await api(`/api/admin/products/${p.id}`, { method: "PATCH", body })); setMsg(null); } catch (e) { setMsg(e.message); } };
  const catName = (slug) => cats.data?.find((c) => c.slug === slug)?.name || slug;

  return (
    <>
      <div className="row-between"><h1>Products</h1>
        <div className="btn-row">
          <a className="btn ghost" href="/api/admin/products/export.csv">Export CSV</a>
          <button className="btn ghost" onClick={() => setImp(true)}>Import CSV</button>
          <Link className="btn" to="/admin/products/new">+ Add product</Link>
        </div>
      </div>
      <div className="toolbar">
        <input type="search" placeholder="Search name, SKU…" value={q} onChange={(e) => set("q", e.target.value)} aria-label="Search" />
        <select value={cat} onChange={(e) => set("category", e.target.value)} aria-label="Category"><option value="">All categories</option>{cats.data?.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}</select>
        <select value={filter} onChange={(e) => set("filter", e.target.value)} aria-label="Filter"><option value="">All</option><option value="noprice">No price yet</option><option value="hidden">Hidden</option><option value="nophoto">No photo</option></select>
      </div>
      {msg && <p className="alert" role="alert">{msg}</p>}
      <Loader s={s}>
        <p className="muted" role="status">{rows.length} of {s.data?.length} products. Type a price and press Enter or click away to save.</p>
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th></th><th>Product</th><th>Category</th><th>Price (₹)</th><th>Unit</th><th>Live</th><th>★</th><th></th></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className={p.active ? "" : "off"}>
                <td><img className="thumb" src={p.images[0]} alt="" width="44" height="44" /></td>
                <td><Link to={`/admin/products/${p.id}`}><strong>{p.name}</strong></Link><small>{p.sku}{p.pack && ` · ${p.pack}`}</small></td>
                <td>{catName(p.category)}<small>{p.collection}</small></td>
                <td><PriceCell key={p.id + ":" + p.price} p={p} onSaved={replace} onError={setMsg} /></td>
                <td><input className="unit-in" defaultValue={p.priceUnit} placeholder="per piece" maxLength={40} aria-label={`Price unit for ${p.name}`} onBlur={(e) => e.target.value !== p.priceUnit && patch(p, { priceUnit: e.target.value })} /></td>
                <td><input type="checkbox" checked={p.active} onChange={(e) => patch(p, { active: e.target.checked })} aria-label={`${p.name} is live on the website`} /></td>
                <td><input type="checkbox" checked={p.featured} onChange={(e) => patch(p, { featured: e.target.checked })} aria-label={`${p.name} is featured on the home page`} /></td>
                <td><Link className="link" to={`/admin/products/${p.id}`}>Edit</Link></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan="8" className="muted">No products match.</td></tr>}
          </tbody>
        </table></div>
      </Loader>
      {imp && <ImportDialog onClose={(changed) => { setImp(false); if (changed) s.reload(); }} />}
    </>
  );
}

function ImportDialog({ onClose }) {
  const [csv, setCsv] = useState("");
  const [res, setRes] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const file = useRef();
  const run = async (dryRun) => {
    setBusy(true); setErr(null);
    try { setRes(await api("/api/admin/products/import", { method: "POST", body: { csv, dryRun } })); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const pick = async (e) => { const f = e.target.files[0]; if (f) { if (f.size > 2_000_000) return setErr("File is too large (max 2 MB)"); setCsv(await f.text()); setRes(null); } };
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Import prices from CSV">
      <div className="modal-box">
        <h2>Import prices from a spreadsheet</h2>
        <ol className="muted"><li>Click <strong>Export CSV</strong> and open it in Excel or Google Sheets.</li><li>Fill the <code>price_rupees</code> column (and <code>price_unit</code>, <code>min_order</code>).</li><li>Save as CSV, choose it below, check the preview, then apply.</li></ol>
        <input ref={file} type="file" accept=".csv,text/csv" onChange={pick} />
        <textarea rows="6" value={csv} onChange={(e) => { setCsv(e.target.value); setRes(null); }} placeholder="…or paste CSV here (first row = column names, must include sku)" />
        {err && <p className="alert" role="alert">{err}</p>}
        {res && (
          <div className="notice" role="status">
            <strong>{res.dryRun ? "Preview: " : "Done: "}{res.updated} product(s) {res.dryRun ? "would change" : "updated"}{res.errorCount ? `, ${res.errorCount} row(s) skipped` : ""}.</strong>
            {res.errors.slice(0, 5).map((e) => <div key={e.line} className="small-print">Line {e.line}: {e.error}</div>)}
            {res.preview.slice(0, 5).map((p) => <div key={p.sku} className="small-print">{p.sku} {p.name}: {Object.entries(p.diff).map(([k, v]) => `${k} → ${k === "price" ? (v == null ? "none" : "₹" + v / 100) : v}`).join(", ")}</div>)}
          </div>
        )}
        <div className="btn-row">
          <button className="btn ghost" disabled={busy || !csv.trim()} onClick={() => run(true)}>Preview</button>
          <button className="btn" disabled={busy || !csv.trim() || !res?.dryRun || res.updated === 0} onClick={() => run(false)}>Apply changes</button>
          <button className="btn ghost" onClick={() => onClose(res && !res.dryRun)}>Close</button>
        </div>
      </div>
    </div>
  );
}
