import { useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { Loader, useLoad } from "./hooks.jsx";
import { Photo, StockMeter } from "./visual.jsx";
import { Msg } from "./ui.jsx";

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

const PROD_TABS = [
  { key: "items", label: "Items" },
  { key: "categories", label: "Categories" },
  { key: "groups", label: "Groups" },
  { key: "pricelists", label: "Price Lists" },
  { key: "deleted", label: "Deleted" },
];

export default function Products() {
  const s = useLoad("/api/admin/products");
  const cats = useLoad("/api/admin/categories");
  const [sp, setSp] = useSearchParams();
  const [msg, setMsg] = useState(null);
  const [imp, setImp] = useState(false);
  const [viewMode, setViewMode] = useState("table"); // "table" or "grid"
  const currentTab = sp.get("tab") || "items";

  const q = sp.get("q") || "", cat = sp.get("category") || "", filter = sp.get("filter") || "";
  const set = (k, v) => { const n = new URLSearchParams(sp); v ? n.set(k, v) : n.delete(k); setSp(n, { replace: true }); };

  const allItems = s.data || [];
  const rows = useMemo(() => allItems.filter((p) =>
    (!cat || p.category === cat) && (!q || `${p.name} ${p.sku} ${p.collection}`.toLowerCase().includes(q.toLowerCase())) &&
    (!filter || (filter === "noprice" && p.price == null) || (filter === "hidden" && !p.active) || (filter === "nophoto" && !p.images.length))), [allItems, q, cat, filter]);

  const replace = (np) => s.setData((d) => d.map((x) => (x.id === np.id ? np : x)));
  const patch = async (p, body) => { try { replace(await api(`/api/admin/products/${p.id}`, { method: "PATCH", body })); setMsg(null); } catch (e) { setMsg(e.message); } };
  const catName = (slug) => cats.data?.find((c) => c.slug === slug)?.name || slug;

  const shareWhatsAppProduct = (p) => {
    const priceText = p.price != null ? `₹${(p.price / 100).toFixed(2)}` : "Price on Request";
    const text = `Check out *${p.name}* from HaTikvah Care!\nPrice: ${priceText} (${p.unit || "pcs"})\nSKU: ${p.sku || "N/A"}\nOrder online: ${window.location.origin}/products/${p.slug || p.id}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  };

  return (
    <>
      <div className="swipe-page-header">
        <h1 className="swipe-title">
          <span>Products & Services</span>
          <span className="swipe-play-badge" title="Products & Catalog">▶</span>
        </h1>
        <div className="swipe-header-actions">
          <Link className="swipe-btn-ghost" to="/admin/price-lists">Offers & Discounts</Link>
          <a className="swipe-btn-ghost" href="/api/admin/products/export.csv">Export CSV</a>
          <button type="button" className="swipe-btn-ghost" onClick={() => setImp(true)}>Import CSV</button>
          <Link className="swipe-btn-primary" to="/admin/products/new">+ Add Product</Link>
        </div>
      </div>

      {/* Top Horizontal Tabs */}
      <div className="swipe-tabs-bar" role="tablist">
        {PROD_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={currentTab === tab.key}
            className={`swipe-tab-item ${currentTab === tab.key ? "active" : ""}`}
            onClick={() => {
              const n = new URLSearchParams(sp);
              if (tab.key === "items") n.delete("tab");
              else n.set("tab", tab.key);
              setSp(n);
            }}
          >
            <span>{tab.label}</span>
            {tab.key === "items" && <span className="swipe-tab-count">{allItems.length}</span>}
          </button>
        ))}
      </div>

      <div className="swipe-filter-bar">
        <div className="swipe-search-wrapper">
          <span className="swipe-search-icon">🔍</span>
          <input
            type="text"
            className="swipe-search-input"
            placeholder="Search name, SKU, HSN…"
            value={q}
            onChange={(e) => set("q", e.target.value)}
            aria-label="Search"
          />
        </div>

        <select className="swipe-select" value={cat} onChange={(e) => set("category", e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {cats.data?.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
        </select>

        <select className="swipe-select" value={filter} onChange={(e) => set("filter", e.target.value)} aria-label="Filter">
          <option value="">All Products</option>
          <option value="noprice">No price yet</option>
          <option value="hidden">Hidden from website</option>
          <option value="nophoto">No photo</option>
        </select>

        <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
          <button
            type="button"
            className={`swipe-btn-ghost ${viewMode === "table" ? "active" : ""}`}
            style={{ fontWeight: viewMode === "table" ? 700 : 400, background: viewMode === "table" ? "#e2e8f0" : undefined }}
            onClick={() => setViewMode("table")}
            title="Table View"
          >
            📋 Table
          </button>
          <button
            type="button"
            className={`swipe-btn-ghost ${viewMode === "grid" ? "active" : ""}`}
            style={{ fontWeight: viewMode === "grid" ? 700 : 400, background: viewMode === "grid" ? "#e2e8f0" : undefined }}
            onClick={() => setViewMode("grid")}
            title="Grid View"
          >
            🖼️ Cards
          </button>
        </div>
      </div>

      <Msg st={{ error: msg }} />

      <Loader s={s}>
        <p className="muted" role="status" style={{ marginBottom: 12, fontSize: "0.85rem" }}>
          Showing {rows.length} of {allItems.length} products. Type a price in the selling price box and press Enter to save.
        </p>

        {viewMode === "table" ? (
          <div className="swipe-table-card">
            <div className="swipe-table-wrap">
              <table className="swipe-table">
                <thead>
                  <tr>
                    <th style={{ width: 60 }}>Item</th>
                    <th>Product Name & Details</th>
                    <th style={{ width: 120 }}>Qty</th>
                    <th style={{ width: 180 }}>Selling Price</th>
                    <th style={{ width: 140 }}>Purchase Price</th>
                    <th style={{ width: 100 }}>Status</th>
                    <th style={{ width: 140, textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => {
                    const initials = (p.name || "PR").slice(0, 2).toUpperCase();
                    const available = p.available ?? p.qty ?? 0;
                    const isLow = available <= (p.reorderLevel || 0);

                    return (
                      <tr key={p.id}>
                        {/* Thumbnail */}
                        <td style={{ verticalAlign: "middle" }}>
                          <Link to={`/admin/products/${p.id}`} style={{ textDecoration: "none" }}>
                            {p.images?.[0] ? (
                              <div style={{ width: 40, height: 40, borderRadius: 6, overflow: "hidden", border: "1px solid #e2e8f0", background: "#f8fafc", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                <img src={p.images[0]} alt={p.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                              </div>
                            ) : (
                              <div style={{ width: 40, height: 40, borderRadius: 6, background: "#dbeafe", color: "#1e40af", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "0.85rem" }}>
                                {initials}
                              </div>
                            )}
                          </Link>
                        </td>

                        {/* Name & HSN */}
                        <td>
                          <div className="swipe-cell-stacked">
                            <Link to={`/admin/products/${p.id}`} className="swipe-cell-title" style={{ textDecoration: "none", color: "#0f172a", fontWeight: 600 }}>
                              {p.name}
                            </Link>
                            <span className="swipe-cell-sub">
                              Product: {p.hsn ? `HSN ${p.hsn}` : (p.sku || "N/A")} · {catName(p.category)}
                            </span>
                          </div>
                        </td>

                        {/* Qty */}
                        <td>
                          <strong style={{ color: isLow ? "#dc2626" : "#0f172a" }}>
                            {available} {p.unit || "pcs"}
                          </strong>
                          {isLow && <span style={{ display: "block", fontSize: "0.72rem", color: "#dc2626", fontWeight: 600 }}>Low stock</span>}
                        </td>

                        {/* Selling Price */}
                        <td>
                          <PriceCell key={p.id + ":" + p.price} p={p} onSaved={replace} onError={setMsg} />
                          <span className="swipe-cell-sub" style={{ marginTop: 2, display: "block" }}>
                            {p.gstRate || 18}% GST incl.
                          </span>
                        </td>

                        {/* Purchase Price */}
                        <td>
                          <span style={{ fontWeight: 600, color: "#334155" }}>
                            ₹ {p.costPrice != null ? (p.costPrice / 100).toFixed(2) : "0.00"}
                          </span>
                          <span className="swipe-cell-sub" style={{ display: "block" }}>
                            {p.gstRate || 18}% excl.
                          </span>
                        </td>

                        {/* Live Status */}
                        <td>
                          <label className="toggle" style={{ fontSize: "0.8rem" }}>
                            <input type="checkbox" checked={p.active} onChange={(e) => patch(p, { active: e.target.checked })} aria-label={`${p.name} live status`} />
                            {p.active ? "Live" : "Hidden"}
                          </label>
                        </td>

                        {/* Actions */}
                        <td>
                          <div className="swipe-row-actions" style={{ justifyContent: "flex-end" }}>
                            <Link className="swipe-btn-ghost" to={`/admin/products/${p.id}`} title="Edit Product">
                              ✏ Edit
                            </Link>
                            <button
                              type="button"
                              className="swipe-btn-ghost"
                              style={{ color: "#16a34a", borderColor: "#bbf7d0" }}
                              onClick={() => shareWhatsAppProduct(p)}
                              title="Share on WhatsApp"
                            >
                              💬
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="prod-grid">
            {rows.map((p) => (
              <article key={p.id} className={"prod" + (p.active ? "" : " off")}>
                <Link className="prod-img" to={`/admin/products/${p.id}`} aria-label={`Edit ${p.name}`}><Photo src={p.images[0]} />{p.featured && <span className="prod-flag">Featured</span>}</Link>
                <div className="prod-body">
                  <Link to={`/admin/products/${p.id}`}>{p.name}</Link>
                  <small>{p.sku}{p.pack && ` · ${p.pack}`} · {catName(p.category)}</small>
                  {p.stockTracked ? <StockMeter available={p.available} reorderLevel={p.reorderLevel || 0} /> : <small>Stock not tracked</small>}
                  <div className="prod-foot">
                    <PriceCell key={p.id + ":" + p.price} p={p} onSaved={replace} onError={setMsg} />
                    <label className="toggle"><input type="checkbox" checked={p.active} onChange={(e) => patch(p, { active: e.target.checked })} aria-label={`${p.name} is live on the website`} />Live</label>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}

        {rows.length === 0 && <p className="muted" style={{ marginTop: 20 }}>No products match your search or filter.</p>}
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
