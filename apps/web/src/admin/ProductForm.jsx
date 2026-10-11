import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { Loader, useLoad } from "./hooks.jsx";

const EMPTY = { name: "", sku: "", category: "", collection: "", pack: "", variants: [], description: "", images: [], price: null, priceUnit: "", minOrder: "", active: true, featured: false };

export default function ProductForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const cats = useLoad("/api/admin/categories");
  const all = useLoad("/api/admin/products");
  const [f, setF] = useState(null);
  const [price, setPrice] = useState("");
  const [variant, setVariant] = useState("");
  const [st, setSt] = useState({ busy: false, error: null, saved: false, field: null });

  useEffect(() => {
    if (!all.data || !cats.data) return;
    const cur = id ? all.data.find((p) => p.id === id) : { ...EMPTY, category: cats.data[0]?.slug || "" };
    if (cur) { setF(cur); setPrice(cur.price == null ? "" : String(cur.price / 100)); }
  }, [all.data, cats.data, id]);

  const loading = (all.loading && !all.data) || (cats.loading && !cats.data);
  const ls = { loading, error: all.error || cats.error, data: loading ? null : 1, reload: () => { all.reload(); cats.reload(); } };
  const set = (k, v) => { setF((x) => ({ ...x, [k]: v })); setSt((s) => ({ ...s, saved: false })); };
  const collections = [...new Set((all.data || []).filter((p) => p.category === f?.category).map((p) => p.collection).filter(Boolean))];

  async function upload(e) {
    const file = e.target.files[0]; e.target.value = "";
    if (!file) return;
    if (file.size > 2_000_000) return setSt({ ...st, error: "Image is too large (max 2 MB). Please resize it first." });
    try { const r = await api("/api/admin/media", { method: "POST", raw: { body: file, type: file.type || "application/octet-stream" } }); set("images", [...f.images, r.url]); setSt((s) => ({ ...s, error: null })); }
    catch (err) { setSt((s) => ({ ...s, error: err.message })); }
  }
  async function save(e) {
    e.preventDefault();
    const n = price.trim() === "" ? null : Number(price.replace(/,/g, ""));
    if (n !== null && (!Number.isFinite(n) || n < 0 || n > 1_000_000)) return setSt({ busy: false, error: "Price must be a number in rupees, like 125 or 12.50", saved: false, field: "price" });
    const body = { name: f.name, sku: f.sku || undefined, category: f.category, collection: f.collection, pack: f.pack, variants: f.variants, description: f.description,
      images: f.images, price: n === null ? null : Math.round(n * 100), priceUnit: f.priceUnit, minOrder: f.minOrder, active: f.active, featured: f.featured };
    setSt({ busy: true, error: null, saved: false, field: null });
    try {
      if (id) { await api(`/api/admin/products/${id}`, { method: "PATCH", body }); setSt({ busy: false, error: null, saved: true, field: null }); all.reload(); }
      else { const p = await api("/api/admin/products", { method: "POST", body }); nav(`/admin/products/${p.id}`, { replace: true }); }
    } catch (err) { setSt({ busy: false, error: err.message, saved: false, field: err.field }); }
  }
  async function remove() {
    if (!window.confirm(`Delete “${f.name}” permanently? To just hide it from the website, untick “Show on website” instead.`)) return;
    try { await api(`/api/admin/products/${id}`, { method: "DELETE" }); nav("/admin/products"); } catch (err) { setSt((s) => ({ ...s, error: err.message })); }
  }

  return (
    <>
      <p><Link to="/admin/products">← Products</Link></p>
      <Loader s={ls}>
        {id && all.data && !all.data.find((p) => p.id === id) ? <p className="alert">Product not found.</p> : f && (
          <form className="panel form" onSubmit={save}>
            <h1>{id ? "Edit product" : "Add product"}</h1>
            <div className="grid2">
              <label className="field"><span>Name *</span><input required minLength={2} maxLength={160} value={f.name} onChange={(e) => set("name", e.target.value)} /></label>
              <label className="field"><span>SKU {id ? "" : "(auto if blank)"}</span><input maxLength={30} value={f.sku} onChange={(e) => set("sku", e.target.value)} /></label>
              <label className="field"><span>Category *</span><select value={f.category} onChange={(e) => set("category", e.target.value)}>{cats.data.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}</select></label>
              <label className="field"><span>Collection / sub-group</span><input list="colls" maxLength={80} value={f.collection} onChange={(e) => set("collection", e.target.value)} /><datalist id="colls">{collections.map((c) => <option key={c} value={c} />)}</datalist></label>
              <label className="field"><span>Pack / specification</span><input maxLength={120} value={f.pack} onChange={(e) => set("pack", e.target.value)} placeholder="e.g. 1000 per pack, 20 ml" /></label>
              <label className="field"><span>Minimum order</span><input maxLength={60} value={f.minOrder} onChange={(e) => set("minOrder", e.target.value)} placeholder="e.g. 50 packs" /></label>
              <label className={"field" + (st.field === "price" ? " bad" : "")}><span>Price (₹) — leave blank for “Price on request”</span><input inputMode="decimal" value={price} onChange={(e) => { setPrice(e.target.value); setSt((s) => ({ ...s, saved: false })); }} placeholder="e.g. 125 or 12.50" /></label>
              <label className="field"><span>Price unit</span><input maxLength={40} value={f.priceUnit} onChange={(e) => set("priceUnit", e.target.value)} placeholder="per piece / per pack / per kg" /></label>
            </div>
            <label className="field"><span>Description</span><textarea rows="4" maxLength={2000} value={f.description} onChange={(e) => set("description", e.target.value)} /></label>
            <div className="field"><span>Options available (shampoo, conditioner…)</span>
              <div className="chips-edit">{f.variants.map((v) => <button type="button" key={v} className="chip on" onClick={() => set("variants", f.variants.filter((x) => x !== v))} aria-label={`Remove ${v}`}>{v} ✕</button>)}
                <input value={variant} maxLength={60} placeholder="Type and press Enter" onChange={(e) => setVariant(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); const v = variant.trim(); if (v && !f.variants.includes(v) && f.variants.length < 20) set("variants", [...f.variants, v]); setVariant(""); } }} /></div>
            </div>
            <div className="field"><span>Photos (first one is the main photo)</span>
              <div className="photos">{f.images.map((src, i) => (
                <figure key={src}><img src={src} alt="" width="96" height="96" />
                  <figcaption>{i > 0 && <button type="button" className="link" onClick={() => set("images", [src, ...f.images.filter((x) => x !== src)])}>Make main</button>}<button type="button" className="link danger" onClick={() => set("images", f.images.filter((x) => x !== src))}>Remove</button></figcaption></figure>
              ))}</div>
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={upload} /><small className="muted">JPG, PNG or WebP, up to 2 MB.</small>
            </div>
            <div className="checks">
              <label><input type="checkbox" checked={f.active} onChange={(e) => set("active", e.target.checked)} /> Show on website</label>
              <label><input type="checkbox" checked={f.featured} onChange={(e) => set("featured", e.target.checked)} /> Feature on home page</label>
            </div>
            {st.error && <p className="alert" role="alert">{st.error}</p>}
            {st.saved && <p className="notice" role="status">Saved ✓</p>}
            <div className="btn-row">
              <button className="btn" disabled={st.busy}>{st.busy ? "Saving…" : "Save product"}</button>
              {id && <button type="button" className="btn danger-btn" onClick={remove}>Delete</button>}
            </div>
          </form>
        )}
      </Loader>
    </>
  );
}
