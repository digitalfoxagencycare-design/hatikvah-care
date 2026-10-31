import { parseRupees } from "../../../api/src/lib/money.js";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { Loader, useLoad } from "./hooks.jsx";
import { ask } from "./toast.jsx";
import { Modal, Msg } from "./ui.jsx";

const EMPTY = {
  name: "", sku: "", category: "", collection: "", pack: "", variants: [], description: "", images: [], price: null, priceUnit: "per piece", minOrder: "", active: true, featured: false, hsn: "", gstRate: 18, unit: "pcs",
  brand: "", manufacturer: "", shortDescription: "", variantLabel: "", priceTiers: [], packSize: 1, minQty: 0, dispatchInfo: "", returnable: true, specs: [],
  measure: null, packaging: null, packPrices: { box: null, carton: null }, batchTracked: false,
};

export const COMMON_UNITS = [
  { val: "pcs", label: "Pieces (pcs — Standard)" },
  { val: "btl", label: "Bottles (btl)" },
  { val: "box", label: "Boxes (box)" },
  { val: "ctn", label: "Cartons (ctn)" },
  { val: "pac", label: "Packs (pac)" },
  { val: "bar", label: "Bars / Soaps (bar)" },
  { val: "kgs", label: "Kilograms (kgs)" },
  { val: "ltr", label: "Litres (ltr)" },
  { val: "set", label: "Sets (set)" },
  { val: "prs", label: "Pairs (prs)" },
  { val: "rol", label: "Rolls (rol)" },
];

export const PRICE_UNITS = [
  "per piece", "per pack", "per box", "per carton", "per bottle", "per sachet", "per bar", "per tube", "per kit", "per pair", "per set", "per roll", "per kg", "per litre",
];

const rupeesIn = parseRupees;

export default function ProductForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const cats = useLoad("/api/admin/categories");
  const all = useLoad("/api/admin/products");
  const stock = useLoad("/api/admin/stock");

  const [f, setF] = useState(null);
  const [price, setPrice] = useState("");
  const [initialStock, setInitialStock] = useState("");
  const [reorderLevel, setReorderLevel] = useState("");
  const [showAddCat, setShowAddCat] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [catBusy, setCatBusy] = useState(false);
  const [catErr, setCatErr] = useState("");
  const [st, setSt] = useState({ busy: false, error: null, saved: false, field: null });

  useEffect(() => {
    if (!all.data || !cats.data) return;
    const cur = id ? all.data.find((p) => p.id === id) : { ...EMPTY, category: cats.data[0]?.slug || "" };
    if (cur) {
      const k = cur.packaging || {}, pp = cur.packPrices || {};
      const curStock = stock.data?.find((s) => s.id === cur.id);
      setF({
        ...EMPTY,
        ...cur,
        priceTiers: (cur.priceTiers || []).map((t) => ({ minQty: String(t.minQty), price: String(t.price / 100) })),
        measure: cur.measure ? { length: "", width: "", value: "", ...cur.measure } : { domain: "", unit: "", value: "", length: "", width: "" },
        pk: {
          baseUnit: k.baseUnit || "piece",
          innerName: k.innerPack?.name || "box",
          inner: k.innerPack?.qty ? String(k.innerPack.qty) : "",
          cartonName: k.masterCarton?.name || "carton",
          carton: k.masterCarton?.qty ? String(k.masterCarton.qty) : "",
          boxPrice: pp.box == null ? "" : String(pp.box / 100),
          cartonPrice: pp.carton == null ? "" : String(pp.carton / 100),
        },
      });
      setPrice(cur.price == null ? "" : String(cur.price / 100));
      if (curStock) {
        setInitialStock(String(curStock.physical ?? ""));
        setReorderLevel(String(curStock.reorderLevel || cur.reorderLevel || ""));
      } else if (cur.reorderLevel) {
        setReorderLevel(String(cur.reorderLevel));
      }
    }
  }, [all.data, cats.data, stock.data, id]);

  const loading = (all.loading && !all.data) || (cats.loading && !cats.data);
  const ls = { loading, error: all.error || cats.error, data: loading ? null : 1, reload: () => { all.reload(); cats.reload(); stock.reload(); } };
  const set = (k, v) => { setF((x) => ({ ...x, [k]: v })); setSt((s) => ({ ...s, saved: false })); };

  async function upload(e) {
    const file = e.target.files[0]; e.target.value = "";
    if (!file) return;
    if (file.size > 2_000_000) return setSt({ ...st, error: "Image is too large (max 2 MB). Please resize it first." });
    try {
      const r = await api("/api/admin/media", { method: "POST", raw: { body: file, type: file.type || "application/octet-stream" } });
      set("images", [...f.images, r.url]);
      setSt((s) => ({ ...s, error: null }));
    } catch (err) {
      setSt((s) => ({ ...s, error: err.message }));
    }
  }

  async function handleAddCategory(e) {
    e.preventDefault();
    if (!newCatName.trim()) return;
    setCatBusy(true); setCatErr("");
    try {
      const res = await api("/api/admin/categories", { method: "POST", body: { name: newCatName.trim() } });
      await cats.reload();
      set("category", res.slug);
      setShowAddCat(false);
      setNewCatName("");
    } catch (err) {
      setCatErr(err.message);
    } finally {
      setCatBusy(false);
    }
  }

  async function save(e) {
    e.preventDefault();
    const n = price.trim() === "" ? null : Number(price.replace(/,/g, ""));
    if (n !== null && (!Number.isFinite(n) || n < 0 || n > 1_000_000)) {
      return setSt({ busy: false, error: "Price must be a valid number in rupees (e.g. 150)", saved: false, field: "price" });
    }

    const hasStock = initialStock.trim() !== "" && Number(initialStock) >= 0;
    const hasReorder = reorderLevel.trim() !== "" && Number(reorderLevel) >= 0;
    const track = hasStock || hasReorder || f.stockTracked;

    const body = {
      name: f.name.trim(),
      sku: f.sku ? f.sku.trim() : undefined,
      category: f.category || (cats.data?.[0]?.slug || "general"),
      collection: f.collection || "",
      pack: f.pack || "",
      variants: f.variants || [],
      description: f.description || "",
      images: f.images || [],
      price: n === null ? null : Math.round(n * 100),
      priceUnit: f.priceUnit || `per ${f.unit || "piece"}`,
      minOrder: f.minOrder || "",
      active: f.active ?? true,
      featured: f.featured ?? false,
      hsn: f.hsn ? f.hsn.trim() : "",
      gstRate: Number(f.gstRate ?? 18),
      unit: f.unit || "pcs",
      stockTracked: track,
      reorderLevel: hasReorder ? Number(reorderLevel) : (f.reorderLevel || 0),
      brand: f.brand || "",
      manufacturer: f.manufacturer || "",
      shortDescription: f.shortDescription || "",
      variantLabel: f.variantLabel || "",
      packSize: Number(f.packSize) || 1,
      minQty: Number(f.minQty) || 0,
      dispatchInfo: f.dispatchInfo || "",
      returnable: f.returnable ?? true,
      specs: (f.specs || []).filter((x) => x.label.trim() && x.value.trim()),
      priceTiers: (f.priceTiers || []).filter((t) => String(t.minQty).trim()).map((t) => ({ minQty: Number(t.minQty), price: rupeesIn(t.price) })),
      measure: f.measure?.domain ? f.measure : null,
      packaging: f.pk?.inner ? { baseUnit: f.pk.baseUnit || "piece", innerPack: { name: f.pk.innerName || "box", qty: Number(f.pk.inner) }, masterCarton: f.pk.carton ? { name: f.pk.cartonName || "carton", qty: Number(f.pk.carton) } : null } : null,
      batchTracked: !!f.batchTracked,
      packPrices: { box: f.pk?.inner ? rupeesIn(f.pk.boxPrice) : null, carton: f.pk?.inner && f.pk?.carton ? rupeesIn(f.pk.cartonPrice) : null },
    };

    setSt({ busy: true, error: null, saved: false, field: null });
    try {
      let savedProduct;
      if (id) {
        savedProduct = await api(`/api/admin/products/${id}`, { method: "PATCH", body });
        setSt({ busy: false, error: null, saved: true, field: null });
      } else {
        savedProduct = await api("/api/admin/products", { method: "POST", body });
      }

      const prodId = id || savedProduct.id;

      // Automatically adjust opening stock if provided for new product
      if (!id && hasStock && Number(initialStock) > 0) {
        try {
          await api("/api/admin/stock/adjust", {
            method: "POST",
            body: { productId: prodId, kind: "in", qty: Number(initialStock), note: "Initial stock on product creation" },
          });
        } catch (_) {}
      }

      // Update reorder level on stock record
      if (hasReorder) {
        try {
          await api(`/api/admin/stock/${prodId}`, {
            method: "PATCH",
            body: { reorderLevel: Number(reorderLevel), stockTracked: true },
          });
        } catch (_) {}
      }

      if (id) {
        all.reload();
        stock.reload();
      } else {
        nav(`/admin/products/${savedProduct.id}`, { replace: true });
      }
    } catch (err) {
      setSt({ busy: false, error: err.message, saved: false, field: err.field });
    }
  }

  async function remove() {
    if (!await ask(`Delete “${f.name}” permanently?`, { body: "To just hide it from the website, untick “Show on website” instead.", danger: true, confirmLabel: "Delete" })) return;
    try { await api(`/api/admin/products/${id}`, { method: "DELETE" }); nav("/admin/products"); } catch (err) { setSt((s) => ({ ...s, error: err.message })); }
  }

  return (
    <>
      <p><Link to="/admin/products">← Products</Link></p>
      <Loader s={ls}>
        {id && all.data && !all.data.find((p) => p.id === id) ? (
          <p className="alert">Product not found.</p>
        ) : f && (
          <form className="panel form" onSubmit={save} style={{ maxWidth: "860px" }}>
            <div className="row-between">
              <h1>{id ? "Edit product" : "Add product"}</h1>
              <span className="muted" style={{ fontSize: "0.85rem" }}>Available across POS, Orders, Invoices & Website</span>
            </div>

            {/* Core Item Information (Clean Hyderabad Item Entry) */}
            <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: "10px", padding: "18px 20px", marginBottom: "20px" }}>
              <div className="grid2">
                <label className="field">
                  <span>Product Name *</span>
                  <input required minLength={2} maxLength={160} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Hotel Bath Soap 20g or Sanitizer 500ml" autoFocus />
                </label>

                <label className="field">
                  <span style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>Category</span>
                    <button type="button" className="link small" onClick={() => setShowAddCat(true)}>+ Add Category</button>
                  </span>
                  <select value={f.category} onChange={(e) => set("category", e.target.value)}>
                    {cats.data?.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
                  </select>
                </label>
              </div>

              <div className="grid3" style={{ marginTop: "12px" }}>
                <label className={"field" + (st.field === "price" ? " bad" : "")}>
                  <span>Selling Price (₹) *</span>
                  <input required inputMode="decimal" value={price} onChange={(e) => { setPrice(e.target.value); setSt((s) => ({ ...s, saved: false })); }} placeholder="e.g. 150 or 45.50" />
                </label>

                <label className="field">
                  <span>Unit (Measured in) *</span>
                  <select value={f.unit || "pcs"} onChange={(e) => set("unit", e.target.value)}>
                    {COMMON_UNITS.map((u) => <option key={u.val} value={u.val}>{u.label}</option>)}
                  </select>
                </label>

                <label className="field">
                  <span>GST Rate</span>
                  <select value={f.gstRate ?? 18} onChange={(e) => set("gstRate", Number(e.target.value))}>
                    {[0, 5, 12, 18, 28].map((g) => <option key={g} value={g}>{g}%</option>)}
                  </select>
                </label>
              </div>

              <div className="grid3" style={{ marginTop: "12px" }}>
                <label className="field">
                  <span>Present Stock (in hand)</span>
                  <input type="number" min="0" value={initialStock} onChange={(e) => setInitialStock(e.target.value)} placeholder="e.g. 100" />
                  <small className="muted">{id ? "Current physical count" : "Opening stock balance"}</small>
                </label>

                <label className="field">
                  <span>Low Stock Alert Limit</span>
                  <input type="number" min="0" value={reorderLevel} onChange={(e) => setReorderLevel(e.target.value)} placeholder="e.g. 10" />
                  <small className="muted">Alerts owner when count falls below this</small>
                </label>

                <label className="field">
                  <span>HSN Code (Optional)</span>
                  <input inputMode="numeric" maxLength={8} value={f.hsn || ""} onChange={(e) => set("hsn", e.target.value.replace(/\D/g, ""))} placeholder="e.g. 3305" />
                  <small className="muted">For GST Tax Invoices</small>
                </label>
              </div>

              <div style={{ marginTop: "14px" }}>
                <label className="field">
                  <span>Description / Product Notes (Optional)</span>
                  <textarea rows="2" maxLength={2000} placeholder="Product quality, specifications, fragrances, suitability for hotels/hospitals, etc." value={f.description} onChange={(e) => set("description", e.target.value)} />
                </label>
              </div>

              <div style={{ marginTop: "14px" }}>
                <label className="field">
                  <span>Product Photos (Optional)</span>
                  <div className="photos" style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "8px" }}>
                    {f.images.map((src, i) => (
                      <figure key={src} style={{ margin: 0, position: "relative" }}>
                        <img src={src} alt="" width="80" height="80" style={{ borderRadius: "6px", objectFit: "cover", border: "1px solid #CBD5E1" }} />
                        <figcaption style={{ fontSize: "0.75rem", marginTop: "2px" }}>
                          {i > 0 && <button type="button" className="link small" onClick={() => set("images", [src, ...f.images.filter((x) => x !== src)])}>Main</button>}
                          <button type="button" className="link danger small" style={{ marginLeft: "4px" }} onClick={() => set("images", f.images.filter((x) => x !== src))}>✕</button>
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                  <input type="file" accept="image/jpeg,image/png,image/webp" onChange={upload} />
                  <small className="muted">JPG, PNG or WebP, up to 2 MB.</small>
                </label>
              </div>
            </div>

            {/* Optional Collapsed Section for Advanced B2B Wholesaler Settings */}
            <details style={{ margin: "16px 0 20px", border: "1px dashed #CBD5E1", borderRadius: "8px", padding: "12px 16px", background: "#FFFFFF" }}>
              <summary style={{ cursor: "pointer", fontWeight: 600, color: "#0284C7", fontSize: "0.9rem" }}>
                + More options: Barcode SKU, B2B Packaging & Bulk Pricing Tiers (Optional)
              </summary>
              <div style={{ marginTop: "14px" }}>
                <div className="grid2">
                  <label className="field">
                    <span>Barcode / SKU (auto-generated if blank)</span>
                    <input maxLength={30} value={f.sku} onChange={(e) => set("sku", e.target.value)} placeholder="e.g. HC-042" />
                  </label>
                  <label className="field">
                    <span>Brand / Manufacturer</span>
                    <input maxLength={120} value={f.brand} onChange={(e) => set("brand", e.target.value)} placeholder="e.g. Hatikvah Care" />
                  </label>
                </div>
                <div className="grid2" style={{ marginTop: "8px" }}>
                  <label className="field">
                    <span>Pack specification text</span>
                    <input maxLength={120} value={f.pack} onChange={(e) => set("pack", e.target.value)} placeholder="e.g. 100 pcs per box" />
                  </label>
                  <label className="field">
                    <span>Minimum order quantity</span>
                    <input maxLength={60} value={f.minOrder} onChange={(e) => set("minOrder", e.target.value)} placeholder="e.g. 5 boxes" />
                  </label>
                </div>

                <div className="checks" style={{ marginTop: "12px" }}>
                  <label><input type="checkbox" checked={f.active} onChange={(e) => set("active", e.target.checked)} /> Show in online website catalog</label>
                  <label><input type="checkbox" checked={f.featured} onChange={(e) => set("featured", e.target.checked)} /> Feature on home page</label>
                  <label><input type="checkbox" checked={!!f.batchTracked} onChange={(e) => set("batchTracked", e.target.checked)} /> Track batch numbers & expiry dates</label>
                </div>
              </div>
            </details>

            <Msg st={{ error: st.error, ok: st.saved && "Saved successfully ✓" }} />
            <div className="btn-row" style={{ marginTop: "10px" }}>
              <button className="btn" disabled={st.busy || !f.name.trim()}>{st.busy ? "Saving…" : "Save product"}</button>
              {id && <button type="button" className="btn danger-btn" onClick={remove}>Delete</button>}
            </div>
          </form>
        )}
      </Loader>

      {/* Quick Add Category Modal */}
      {showAddCat && (
        <Modal title="Add New Category" onClose={() => setShowAddCat(false)}>
          <form className="form" onSubmit={handleAddCategory}>
            <label className="field">
              <span>Category Name *</span>
              <input required maxLength={80} value={newCatName} onChange={(e) => setNewCatName(e.target.value)} placeholder="e.g. Hotel Amenities, Bath & Spa, Linen" autoFocus />
            </label>
            {catErr && <p className="alert" role="alert">{catErr}</p>}
            <div className="btn-row">
              <button className="btn" disabled={catBusy || !newCatName.trim()}>{catBusy ? "Creating…" : "Create & Select Category"}</button>
              <button type="button" className="btn ghost" onClick={() => setShowAddCat(false)}>Cancel</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
