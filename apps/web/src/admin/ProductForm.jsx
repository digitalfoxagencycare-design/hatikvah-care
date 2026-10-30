import { parseRupees } from "../../../api/src/lib/money.js";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { Loader, useLoad } from "./hooks.jsx";

const EMPTY = { name: "", sku: "", category: "", collection: "", pack: "", variants: [], description: "", images: [], price: null, priceUnit: "per piece", minOrder: "", active: true, featured: false, hsn: "", gstRate: 18, unit: "pcs",
  brand: "", manufacturer: "", shortDescription: "", variantLabel: "", priceTiers: [], packSize: 1, minQty: 0, dispatchInfo: "", returnable: true, specs: [],
  measure: null, packaging: null, packPrices: { box: null, carton: null }, batchTracked: false };
const UNITS = { volume: ["ml", "l"], weight: ["g", "kg"], dimensions: ["inch", "cm"], count: ["pcs", "rolls", "pairs"] };
const DOMAINS = [["", "Not set"], ["volume", "Volume (liquids, gels)"], ["weight", "Weight (soaps, detergents, sachets)"], ["dimensions", "Size (linen, towels)"], ["count", "Count (pieces, rolls, pairs)"]];

export const PRICE_UNITS = [
  "per piece",
  "per pack",
  "per box",
  "per carton",
  "per bottle",
  "per sachet",
  "per bar",
  "per tube",
  "per kit",
  "per pair",
  "per set",
  "per roll",
  "per kg",
  "per litre",
  "per metre",
];

export const DOC_UNITS = [
  { val: "pcs", label: "pcs — Pieces (Standard)" },
  { val: "box", label: "box — Boxes" },
  { val: "ctn", label: "ctn — Cartons" },
  { val: "nos", label: "nos — Numbers" },
  { val: "pac", label: "pac — Packs" },
  { val: "btl", label: "btl — Bottles" },
  { val: "bar", label: "bar — Bars (Soap)" },
  { val: "set", label: "set — Sets" },
  { val: "prs", label: "prs — Pairs" },
  { val: "rol", label: "rol — Rolls" },
  { val: "kgs", label: "kgs — Kilograms" },
  { val: "ltr", label: "ltr — Litres" },
  { val: "sqm", label: "sqm — Square metres" },
  { val: "mtr", label: "mtr — Metres" },
];

export const BASE_UNITS = [
  "piece",
  "bottle",
  "sachet",
  "bar",
  "tube",
  "kit",
  "pair",
  "roll",
  "pouch",
  "can",
  "pack",
  "set",
];

export const INNER_PACK_NAMES = [
  "box",
  "pack",
  "tray",
  "bundle",
  "pouch",
  "bag",
  "dispenser",
];

export const CARTON_NAMES = [
  "carton",
  "master carton",
  "case",
  "crate",
  "box",
  "bag",
];
/** Form strings → the API's measure / packaging objects (null when not filled in). */
function measureOut(m) {
  if (!m?.domain) return null;
  const n = (v) => Number(v) || 0;
  return m.domain === "dimensions" ? { domain: m.domain, unit: m.unit, length: n(m.length), width: n(m.width) } : { domain: m.domain, unit: m.unit, value: n(m.value) || 1 };
}
function packagingOut(k) {
  const inner = Number(k.inner) || 0, carton = Number(k.carton) || 0;
  if (!inner) return null;
  return { baseUnit: k.baseUnit || "piece", innerPack: { name: k.innerName || "box", qty: inner }, masterCarton: carton ? { name: k.cartonName || "carton", qty: carton } : null };
}
const rupeesIn = parseRupees;

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
    if (cur) {
      const k = cur.packaging || {}, pp = cur.packPrices || {};
      setF({ ...EMPTY, ...cur, priceTiers: (cur.priceTiers || []).map((t) => ({ minQty: String(t.minQty), price: String(t.price / 100) })),
        measure: cur.measure ? { length: "", width: "", value: "", ...cur.measure } : { domain: "", unit: "", value: "", length: "", width: "" },
        pk: { baseUnit: k.baseUnit || "piece", innerName: k.innerPack?.name || "box", inner: k.innerPack?.qty ? String(k.innerPack.qty) : "", cartonName: k.masterCarton?.name || "carton", carton: k.masterCarton?.qty ? String(k.masterCarton.qty) : "",
          boxPrice: pp.box == null ? "" : String(pp.box / 100), cartonPrice: pp.carton == null ? "" : String(pp.carton / 100) } });
      setPrice(cur.price == null ? "" : String(cur.price / 100));
    }
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
      images: f.images, price: n === null ? null : Math.round(n * 100), priceUnit: f.priceUnit, minOrder: f.minOrder, active: f.active, featured: f.featured,
      hsn: f.hsn || "", gstRate: Number(f.gstRate ?? 18), unit: f.unit || "pcs",
      brand: f.brand, manufacturer: f.manufacturer, shortDescription: f.shortDescription, variantLabel: f.variantLabel, packSize: Number(f.packSize) || 1, minQty: Number(f.minQty) || 0,
      dispatchInfo: f.dispatchInfo, returnable: f.returnable, specs: f.specs.filter((x) => x.label.trim() && x.value.trim()),
      priceTiers: f.priceTiers.filter((t) => String(t.minQty).trim()).map((t) => ({ minQty: Number(t.minQty), price: rupeesIn(t.price) })),
      measure: measureOut(f.measure), packaging: packagingOut(f.pk), batchTracked: !!f.batchTracked,
      packPrices: { box: f.pk.inner ? rupeesIn(f.pk.boxPrice) : null, carton: f.pk.inner && f.pk.carton ? rupeesIn(f.pk.cartonPrice) : null } };
    if (body.priceTiers.some((t) => !Number.isInteger(t.minQty) || t.price == null)) return setSt({ busy: false, error: "Each bulk price needs a whole quantity and a price in rupees", saved: false, field: "priceTiers" });
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
              <label className="field"><span>Category (optional)</span><select value={f.category} onChange={(e) => set("category", e.target.value)}>{cats.data.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}</select></label>
              <label className="field"><span>Collection / sub-group</span><input list="colls" maxLength={80} value={f.collection} onChange={(e) => set("collection", e.target.value)} /><datalist id="colls">{collections.map((c) => <option key={c} value={c} />)}</datalist></label>
              <label className="field"><span>Pack / specification</span><input maxLength={120} value={f.pack} onChange={(e) => set("pack", e.target.value)} placeholder="e.g. 1000 per pack, 20 ml" /></label>
              <label className="field"><span>Minimum order</span><input maxLength={60} value={f.minOrder} onChange={(e) => set("minOrder", e.target.value)} placeholder="e.g. 50 packs" /></label>
              <label className={"field" + (st.field === "price" ? " bad" : "")}><span>Price (₹) — leave blank for “Price on request”</span><input inputMode="decimal" value={price} onChange={(e) => { setPrice(e.target.value); setSt((s) => ({ ...s, saved: false })); }} placeholder="e.g. 125 or 12.50" /></label>
              <label className="field"><span>Price unit</span>
                <span className="btn-row" style={{ display: "flex", gap: "6px" }}>
                  <select value={PRICE_UNITS.includes(f.priceUnit) ? f.priceUnit : (f.priceUnit ? "__custom__" : "per piece")} onChange={(e) => {
                    if (e.target.value === "__custom__") { set("priceUnit", f.priceUnit && !PRICE_UNITS.includes(f.priceUnit) ? f.priceUnit : "per "); }
                    else { set("priceUnit", e.target.value); }
                  }}>
                    {PRICE_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                    <option value="__custom__">Custom / Other…</option>
                  </select>
                  {(!PRICE_UNITS.includes(f.priceUnit) && f.priceUnit !== "") && <input className="w-sm" maxLength={40} value={f.priceUnit} onChange={(e) => set("priceUnit", e.target.value)} placeholder="e.g. per dozen" />}
                </span>
              </label>
            </div>
            <div className="grid3">
              <label className="field"><span>HSN code (for GST invoices)</span><input inputMode="numeric" maxLength={8} value={f.hsn || ""} onChange={(e) => set("hsn", e.target.value.replace(/\D/g, ""))} placeholder="e.g. 3305" /></label>
              <label className="field"><span>GST rate</span><select value={f.gstRate ?? 18} onChange={(e) => set("gstRate", Number(e.target.value))}>{[0, 5, 12, 18, 28].map((g) => <option key={g} value={g}>{g}%</option>)}</select></label>
              <label className="field"><span>Unit (on documents — GST UQC)</span>
                <span className="btn-row" style={{ display: "flex", gap: "6px" }}>
                  <select value={DOC_UNITS.some((u) => u.val === (f.unit || "pcs")) ? (f.unit || "pcs") : "__custom__"} onChange={(e) => {
                    if (e.target.value === "__custom__") { set("unit", f.unit && !DOC_UNITS.some((u) => u.val === f.unit) ? f.unit : ""); }
                    else { set("unit", e.target.value); }
                  }}>
                    {DOC_UNITS.map((u) => <option key={u.val} value={u.val}>{u.label}</option>)}
                    <option value="__custom__">Custom UQC…</option>
                  </select>
                  {(!DOC_UNITS.some((u) => u.val === f.unit) && f.unit !== "") && <input className="w-sm" maxLength={20} value={f.unit} onChange={(e) => set("unit", e.target.value)} placeholder="Custom unit" />}
                </span>
              </label>
            </div>
            <h2>Measurement & packaging</h2>
            <p className="muted small-print">What one piece is, and how pieces are packed for B2B orders. Quotes, orders, invoices and the counter can then sell by the piece, box or carton; stock is always counted in pieces.</p>
            <div className="grid3">
              <label className="field"><span>Measured as</span><select value={f.measure.domain} onChange={(e) => set("measure", { ...f.measure, domain: e.target.value, unit: UNITS[e.target.value]?.[0] || "" })}>{DOMAINS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
              {f.measure.domain === "dimensions" ? <>
                <label className="field"><span>Length × width</span><span className="btn-row"><input className="w-sm" type="number" min="0" step="any" aria-label="Length" value={f.measure.length} onChange={(e) => set("measure", { ...f.measure, length: e.target.value })} /> × <input className="w-sm" type="number" min="0" step="any" aria-label="Width" value={f.measure.width} onChange={(e) => set("measure", { ...f.measure, width: e.target.value })} /></span></label>
              </> : f.measure.domain && <label className="field"><span>{f.measure.domain === "count" ? "Per piece (e.g. 1 pair)" : "Size of one piece"}</span><input type="number" min="0" step="any" value={f.measure.value} onChange={(e) => set("measure", { ...f.measure, value: e.target.value })} placeholder={f.measure.domain === "volume" ? "e.g. 30" : "e.g. 15"} /></label>}
              {f.measure.domain && <label className="field"><span>Unit</span><select value={f.measure.unit} onChange={(e) => set("measure", { ...f.measure, unit: e.target.value })}>{UNITS[f.measure.domain].map((u) => <option key={u}>{u}</option>)}</select></label>}
            </div>
            <div className="grid3">
              <label className="field"><span>Single unit is called</span>
                <span className="btn-row" style={{ display: "flex", gap: "6px" }}>
                  <select value={BASE_UNITS.includes(f.pk.baseUnit || "piece") ? (f.pk.baseUnit || "piece") : "__custom__"} onChange={(e) => {
                    const val = e.target.value;
                    if (val === "__custom__") { set("pk", { ...f.pk, baseUnit: f.pk.baseUnit && !BASE_UNITS.includes(f.pk.baseUnit) ? f.pk.baseUnit : "" }); }
                    else { set("pk", { ...f.pk, baseUnit: val }); }
                  }}>
                    {BASE_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                    <option value="__custom__">Custom…</option>
                  </select>
                  {(!BASE_UNITS.includes(f.pk.baseUnit) && f.pk.baseUnit !== "" && f.pk.baseUnit !== "piece") && <input className="w-sm" maxLength={20} value={f.pk.baseUnit} onChange={(e) => set("pk", { ...f.pk, baseUnit: e.target.value })} placeholder="Custom unit" />}
                </span>
              </label>
              <label className="field"><span>Inner pack: pieces per pack</span>
                <span className="btn-row" style={{ display: "flex", gap: "6px" }}>
                  <select style={{ minWidth: "90px" }} value={INNER_PACK_NAMES.includes(f.pk.innerName || "box") ? (f.pk.innerName || "box") : "__custom__"} onChange={(e) => {
                    const val = e.target.value;
                    if (val === "__custom__") { set("pk", { ...f.pk, innerName: f.pk.innerName && !INNER_PACK_NAMES.includes(f.pk.innerName) ? f.pk.innerName : "" }); }
                    else { set("pk", { ...f.pk, innerName: val }); }
                  }}>
                    {INNER_PACK_NAMES.map((u) => <option key={u} value={u}>{u}</option>)}
                    <option value="__custom__">Custom…</option>
                  </select>
                  {(!INNER_PACK_NAMES.includes(f.pk.innerName) && f.pk.innerName !== "" && f.pk.innerName !== "box") && <input className="w-sm" maxLength={20} value={f.pk.innerName} onChange={(e) => set("pk", { ...f.pk, innerName: e.target.value })} placeholder="Pack name" />}
                  <input className="w-sm" type="number" min="2" aria-label="Pieces per inner pack" value={f.pk.inner} onChange={(e) => set("pk", { ...f.pk, inner: e.target.value })} placeholder="e.g. 50" />
                </span>
              </label>
              <label className="field"><span>Master carton: packs per carton</span>
                <span className="btn-row" style={{ display: "flex", gap: "6px" }}>
                  <select style={{ minWidth: "90px" }} value={CARTON_NAMES.includes(f.pk.cartonName || "carton") ? (f.pk.cartonName || "carton") : "__custom__"} onChange={(e) => {
                    const val = e.target.value;
                    if (val === "__custom__") { set("pk", { ...f.pk, cartonName: f.pk.cartonName && !CARTON_NAMES.includes(f.pk.cartonName) ? f.pk.cartonName : "" }); }
                    else { set("pk", { ...f.pk, cartonName: val }); }
                  }}>
                    {CARTON_NAMES.map((u) => <option key={u} value={u}>{u}</option>)}
                    <option value="__custom__">Custom…</option>
                  </select>
                  {(!CARTON_NAMES.includes(f.pk.cartonName) && f.pk.cartonName !== "" && f.pk.cartonName !== "carton") && <input className="w-sm" maxLength={20} value={f.pk.cartonName} onChange={(e) => set("pk", { ...f.pk, cartonName: e.target.value })} placeholder="Carton name" />}
                  <input className="w-sm" type="number" min="1" disabled={!f.pk.inner} aria-label="Inner packs per carton" value={f.pk.carton} onChange={(e) => set("pk", { ...f.pk, carton: e.target.value })} placeholder="e.g. 10" />
                </span>
              </label>
            </div>
            {Number(f.pk.inner) > 0 && (
              <div className="grid3">
                <label className="field"><span>Price per {f.pk.innerName || "box"} of {f.pk.inner} (₹, blank = piece price × {f.pk.inner})</span><input inputMode="decimal" value={f.pk.boxPrice} onChange={(e) => set("pk", { ...f.pk, boxPrice: e.target.value })} /></label>
                {Number(f.pk.carton) > 0 && <label className="field"><span>Price per {f.pk.cartonName || "carton"} of {Number(f.pk.inner) * Number(f.pk.carton)} (₹)</span><input inputMode="decimal" value={f.pk.cartonPrice} onChange={(e) => set("pk", { ...f.pk, cartonPrice: e.target.value })} /></label>}
                <p className="muted small-print">1 {f.pk.cartonName || "carton"} = {Number(f.pk.carton) || "—"} {f.pk.innerName || "box"}es = {Number(f.pk.inner) * (Number(f.pk.carton) || 0) || "—"} {f.pk.baseUnit || "pieces"}</p>
              </div>
            )}
            <div className="checks"><label><input type="checkbox" checked={!!f.batchTracked} onChange={(e) => set("batchTracked", e.target.checked)} /> Track batch, manufacturing and expiry dates (chemicals, cosmetics, sanitisers)</label></div>
            <label className="field"><span>Product Description (shown on website & landing page)</span><textarea rows="4" maxLength={2000} placeholder="Describe product features, quality, materials, fragrances, dimensions, suitability for hotels/hospitals, etc." value={f.description} onChange={(e) => set("description", e.target.value)} /></label>
            <h2>Online shop</h2>
            <div className="grid2">
              <label className="field"><span>Brand (shown with a brand card)</span><input maxLength={80} value={f.brand} onChange={(e) => set("brand", e.target.value)} placeholder="e.g. Farm Fresh" /></label>
              <label className="field"><span>Manufacturer / company</span><input maxLength={120} value={f.manufacturer} onChange={(e) => set("manufacturer", e.target.value)} placeholder="e.g. Bio Veda Pharmacy Private Limited" /></label>
            </div>
            <label className="field"><span>Short description (under the product name)</span><textarea rows="2" maxLength={400} value={f.shortDescription} onChange={(e) => set("shortDescription", e.target.value)} /></label>
            <div className="grid3">
              <label className="field"><span>Sold in packs of (quantity steps)</span><input type="number" min="1" max="100000" value={f.packSize} onChange={(e) => set("packSize", e.target.value)} /></label>
              <label className="field"><span>Minimum quantity (0 = one pack)</span><input type="number" min="0" max="1000000" value={f.minQty} onChange={(e) => set("minQty", e.target.value)} /></label>
              <label className="field"><span>Dispatch note</span><input maxLength={80} value={f.dispatchInfo} onChange={(e) => set("dispatchInfo", e.target.value)} placeholder="Dispatched within 24-48 hours" /></label>
            </div>
            <div className={"field" + (st.field === "priceTiers" ? " bad" : "")}><span>Bulk prices (quantity and above → price per unit, ₹)</span>
              {f.priceTiers.map((t, i) => (
                <div className="btn-row" key={i}>
                  <input type="number" min="2" aria-label="From quantity" placeholder="Qty, e.g. 576" value={t.minQty} onChange={(e) => set("priceTiers", f.priceTiers.map((x, j) => (j === i ? { ...x, minQty: e.target.value } : x)))} />
                  <input inputMode="decimal" aria-label="Price per unit" placeholder="₹ per unit" value={t.price} onChange={(e) => set("priceTiers", f.priceTiers.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} />
                  <button type="button" className="link danger" onClick={() => set("priceTiers", f.priceTiers.filter((_, j) => j !== i))}>Remove</button>
                </div>
              ))}
              {f.priceTiers.length < 6 && <div><button type="button" className="btn ghost small" onClick={() => set("priceTiers", [...f.priceTiers, { minQty: "", price: "" }])}>+ Add bulk price</button></div>}
            </div>
            <div className="field"><span>Additional information (spec table)</span>
              {f.specs.map((x, i) => (
                <div className="btn-row" key={i}>
                  <input maxLength={60} aria-label="Label" placeholder="e.g. Volume" value={x.label} onChange={(e) => set("specs", f.specs.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)))} />
                  <input maxLength={200} aria-label="Value" placeholder="e.g. 20 ml" value={x.value} onChange={(e) => set("specs", f.specs.map((y, j) => (j === i ? { ...y, value: e.target.value } : y)))} />
                  <button type="button" className="link danger" onClick={() => set("specs", f.specs.filter((_, j) => j !== i))}>Remove</button>
                </div>
              ))}
              {f.specs.length < 20 && <div><button type="button" className="btn ghost small" onClick={() => set("specs", [...f.specs, { label: "", value: "" }])}>+ Add row</button></div>}
            </div>
            <label className="field"><span>Options heading (e.g. Size/Volume, Fragrance)</span><input maxLength={40} value={f.variantLabel} onChange={(e) => set("variantLabel", e.target.value)} /></label>
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
              <label><input type="checkbox" checked={!f.returnable} onChange={(e) => set("returnable", !e.target.checked)} /> Non returnable</label>
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
