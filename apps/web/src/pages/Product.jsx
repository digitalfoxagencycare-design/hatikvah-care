import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { money } from "../api.js";
import ProductCard, { minQty, unitLabel, unitPrice, withGst } from "../components/ProductCard.jsx";
import Seo from "../components/Seo.jsx";
import { useSite } from "../data.jsx";
import NotFound from "./NotFound.jsx";

export default function Product() {
  const { slug } = useParams();
  const { catalog, settings, add } = useSite();
  const p = catalog.products.find((x) => x.slug === slug);
  const [img, setImg] = useState(0);
  const [qty, setQty] = useState(1);
  const [variant, setVariant] = useState("");
  const [tab, setTab] = useState("desc");
  const [added, setAdded] = useState(false);
  useEffect(() => { setImg(0); setQty(p ? minQty(p) : 1); setVariant(p?.variants[0] || ""); setTab("desc"); setAdded(false); }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!p) return <NotFound what="product" />;

  const cat = catalog.categories.find((c) => c.slug === p.category);
  const related = catalog.products.filter((x) => x.category === p.category && x.id !== p.id).slice(0, 4);
  const priced = p.pricePaise != null, buy = priced && settings.shop?.cart;
  const unit = unitLabel(p), pack = p.packSize || 1, min = minQty(p);
  const rate = priced ? unitPrice(p, qty) : null;
  const options = pack > 1 ? Array.from({ length: 20 }, (_, i) => min + i * pack) : null;
  const wa = settings.whatsapp ? `https://wa.me/${settings.whatsapp}?text=${encodeURIComponent(`Hello HaTikvah Care, I would like a bulk / outside India quote for: ${p.name}${variant ? ` (${variant})` : ""} (${p.sku}).`)}` : null;
  const ld = { "@context": "https://schema.org", "@type": "Product", name: p.name, sku: p.sku, image: p.images, description: p.shortDescription || p.description || `${p.name}. ${p.pack}`, brand: { "@type": "Brand", name: p.brand || "HaTikvah Care" },
    ...(priced ? { offers: { "@type": "Offer", priceCurrency: "INR", price: (p.pricePaise / 100).toFixed(2), availability: `https://schema.org/${p.stock === "out" ? "OutOfStock" : "InStock"}` } } : {}) };
  const specs = [...(p.pack ? [{ label: "Pack / specification", value: p.pack }] : []), ...(p.brand ? [{ label: "Brand", value: p.brand }] : []), ...p.specs,
    { label: "SKU", value: p.sku }, ...(p.minOrder ? [{ label: "Minimum order", value: p.minOrder }] : []), { label: "GST", value: `${p.gstRate}%` }];

  function addToCart() { add(p.id, qty, variant); setAdded(true); }

  return (
    <div className="wrap product">
      <Seo title={p.name} description={`${p.name}${p.pack ? ` (${p.pack})` : ""}. ${p.shortDescription || p.description || cat?.description || ""}`} jsonLd={ld} />
      <div className="p-grid">
        <div className="p-media">
          <div className="main-img-box"><img className="main-img" src={p.images[img]} alt={p.name} width="640" height="640" /></div>
          {p.images.length > 0 && <div className="thumbs">{p.images.map((s, i) => <button key={s} className={i === img ? "on" : ""} onClick={() => setImg(i)} aria-label={`Photo ${i + 1}`}><img src={s} alt="" width="96" height="96" /></button>)}</div>}
          <div className="p-tabs" role="tablist">
            <button role="tab" aria-selected={tab === "desc"} className={tab === "desc" ? "on" : ""} onClick={() => setTab("desc")}>Description</button>
            <button role="tab" aria-selected={tab === "info"} className={tab === "info" ? "on" : ""} onClick={() => setTab("info")}>Additional Information</button>
          </div>
          <div className="p-tab-body" role="tabpanel">
            {tab === "desc" ? <p>{p.description || p.shortDescription || "Ask us for full product details, branding options and samples."}</p>
              : <table className="specs"><tbody>{specs.map((s) => <tr key={s.label}><th>{s.label}</th><td>{s.value}</td></tr>)}</tbody></table>}
          </div>
        </div>

        <div className="p-info">
          <p className="eyebrow">{p.collection || cat?.name}</p>
          <h1>{p.name}</h1>
          <div className="p-meta">
            {p.brand && <span>Brand: <strong>{p.brand}</strong></span>}
            {cat && <span>Categories: <Link to={`/shop?category=${cat.slug}`} className="red">{cat.name}</Link></span>}
          </div>
          {p.shortDescription && <p className="p-short">{p.shortDescription}</p>}
          {p.brand && (
            <div className="brand-card">
              <span className="brand-ico" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M5 19c0-8 6-14 14-14 0 8-6 14-14 14Z" /><path d="M5 19 13 11" /></svg></span>
              <div><strong>{p.brand}</strong>{p.manufacturer && <small>{p.manufacturer}</small>}</div>
            </div>
          )}

          <div className="p-price-row">
            {priced ? (
              <div><span className="p-price">{money(rate)}</span> <small className="muted">/{unit}</small>
                <div className="p-incl">{money(withGst(rate, p.gstRate))} Incl. GST</div></div>
            ) : <span className="price ask big">Price on request</span>}
            {p.stock && <span className={"stock " + p.stock}>{p.stock === "in" ? "In stock" : "Out of stock"}</span>}
          </div>

          {priced && p.priceTiers.length > 0 && (
            <div className="tiers">
              <div className="tiers-head"><strong>Quantity Discounts</strong><small>Save more when you buy in bulk</small></div>
              <table><thead><tr><th>Quantity</th><th>Savings</th><th className="num">Price per Unit</th></tr></thead>
                <tbody>{p.priceTiers.map((t) => <tr key={t.minQty} className={qty >= t.minQty && rate === t.price ? "on" : ""}><td>{t.minQty.toLocaleString("en-IN")} + {unit}</td>
                  <td className="red">Save {Math.max(0, Math.round((1 - t.price / p.pricePaise) * 100))}%</td><td className="num">{money(t.price)}</td></tr>)}</tbody></table>
            </div>
          )}

          {(p.dispatchInfo || !p.returnable) && (
            <div className="p-badges">
              {p.dispatchInfo && <span>🚚 {p.dispatchInfo}</span>}
              {!p.returnable && <span>↺ Non Returnable</span>}
            </div>
          )}
          {wa && <p><a className="bulk-link" href={wa} target="_blank" rel="noopener noreferrer">Bulk or outside India orders →</a></p>}

          {p.variants.length > 0 && (
            <div className="p-variants"><span className="lbl">{p.variantLabel || "Options"}</span>
              <div>{p.variants.map((v) => <button key={v} type="button" className={"opt" + (v === variant ? " on" : "")} aria-pressed={v === variant} onClick={() => { setVariant(v); setAdded(false); }}>{v}</button>)}</div>
            </div>
          )}

          <div className="buy">
            <label>Quantity ({unit})
              {options
                ? <select value={qty} onChange={(e) => { setQty(Number(e.target.value)); setAdded(false); }}>{options.map((n) => <option key={n} value={n}>{n.toLocaleString("en-IN")}</option>)}</select>
                : <input type="number" min={min} max="1000000" value={qty} onChange={(e) => { setQty(Math.max(min, Math.min(1_000_000, Number(e.target.value) || min))); setAdded(false); }} />}
            </label>
            <button className="btn buy-btn" disabled={p.stock === "out"} onClick={addToCart}>{buy ? "Add To Cart" : "Add to quote"}</button>
          </div>
          {priced && <p className="p-total">You pay only a total of <strong>{money(rate * qty)}</strong> for <strong>{qty.toLocaleString("en-IN")} x {unit}</strong> <span className="muted">(+ GST)</span></p>}
          {pack > 1 && <p className="muted small-print">Sold in packs of {pack.toLocaleString("en-IN")} {unit}.</p>}
          {added && <p className="notice" role="status">Added to your {buy ? "cart" : "quote list"}. <Link to={buy ? "/cart" : "/quote"}>{buy ? "View cart →" : "Review & send →"}</Link></p>}
        </div>
      </div>
      {related.length > 0 && <section className="section"><h2>Related products</h2><div className="grid">{related.map((r) => <ProductCard key={r.id} p={r} />)}</div></section>}
    </div>
  );
}
