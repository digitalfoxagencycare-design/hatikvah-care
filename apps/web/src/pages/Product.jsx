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
  const defaultFarmFresh = {
    id: "ff-cnd-20",
    name: "Farm Fresh Tea Tree Conditioner 20ml",
    slug: "farm-fresh-tea-tree-conditioner-20ml",
    category: "bio-wet-amenities",
    collection: "BIO WET AMENITIES",
    brand: "Farm Fresh",
    manufacturer: "Bio Veda Pharmacy Private Limited",
    pricePaise: 750,
    gstRate: 18,
    unit: "Nos",
    packSize: 288,
    variants: ["20ml"],
    images: ["/brand/farm-fresh-tea-tree-bottles.png"],
    shortDescription: "An invigorating, purifying 20ml hair conditioner infused with natural tea tree oil to effortlessly detangle, soften, and clarify your guests' hair.",
    description: "Provide your guests with an ultra-refreshing hair care experience with our Farm Fresh Tea Tree Conditioner. Specially curated for elite hospitality spaces and luxury guest kits, this deep-conditioning formula actively targets hair smoothness while maintaining supreme scalp health. Infused with natural tea tree extracts, it delivers an invigorating, clarifying sensation that leaves the hair weightlessly soft, completely detangled, and naturally radiant. Its revitalizing aromatic profile re-energizes the senses, making it the perfect addition to premium resort and hotel guest bathrooms.",
    stock: "in",
    priceTiers: [{ minQty: 288, price: 750 }],
  };

  const found = catalog.products.find((x) => x.slug === slug || x.id === slug);
  const p = found || (slug?.includes("farm-fresh") || slug?.startsWith("cmq") ? defaultFarmFresh : null);

  const [img, setImg] = useState(0);
  const [qty, setQty] = useState(1);
  const [variant, setVariant] = useState("");
  const [tab, setTab] = useState("desc");
  const [added, setAdded] = useState(false);

  useEffect(() => {
    setImg(0);
    setQty(p ? (p.packSize || minQty(p)) : 1);
    setVariant(p?.variants?.[0] || "20ml");
    setTab("desc");
    setAdded(false);
  }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!p) return <NotFound what="product" />;

  const cat = catalog.categories.find((c) => c.slug === p.category);
  const related = catalog.products.filter((x) => x.category === p.category && x.id !== p.id).slice(0, 4);
  const priced = p.pricePaise != null;
  const buy = priced && settings.shop?.cart;
  const unit = unitLabel(p);
  const pack = p.packSize || 1;
  const min = minQty(p);
  const rate = priced ? unitPrice(p, qty) : null;
  const options = pack > 1 ? Array.from({ length: 20 }, (_, i) => min + i * pack) : [1, 2, 5, 10, 20, 50, 100];
  const wa = settings.whatsapp
    ? `https://wa.me/${settings.whatsapp}?text=${encodeURIComponent(`Hello HaTikvah Care, I would like a bulk / outside India quote for: ${p.name}${variant ? ` (${variant})` : ""} (${p.sku || ""}).`)}`
    : `https://wa.me/917995444434?text=${encodeURIComponent(`Hello HaTikvah Care, I would like a bulk / outside India quote for: ${p.name}.`)}`;

  const ld = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.name,
    sku: p.sku,
    image: p.images,
    description: p.shortDescription || p.description,
    brand: { "@type": "Brand", name: p.brand || "Farm Fresh" },
    ...(priced ? { offers: { "@type": "Offer", priceCurrency: "INR", price: (p.pricePaise / 100).toFixed(2), availability: "https://schema.org/InStock" } } : {}),
  };

  const specs = [
    ...(p.pack ? [{ label: "Pack / specification", value: p.pack }] : []),
    ...(p.brand ? [{ label: "Brand", value: p.brand }] : []),
    ...(p.specs || []),
    { label: "SKU", value: p.sku || "N/A" },
    ...(p.minOrder ? [{ label: "Minimum order", value: p.minOrder }] : []),
    { label: "GST", value: `${p.gstRate || 18}%` },
  ];

  function addToCart() {
    add(p.id, qty, variant);
    setAdded(true);
  }

  const images = p.images?.length ? p.images : ["/brand/farm-fresh-tea-tree-bottles.png"];

  return (
    <div className="wrap product-page-container">
      <Seo
        title={`${p.name} | HaTikvah Care`}
        description={p.shortDescription || p.description}
        jsonLd={ld}
      />

      <div className="p-grid">
        {/* Left Column: Gallery & Description Tabs */}
        <div className="p-media">
          <div className="main-img-box">
            <img className="main-img" src={images[img]} alt={p.name} width="600" height="500" />
          </div>

          {images.length > 0 && (
            <div className="thumbs">
              {images.map((s, i) => (
                <button key={s + i} className={i === img ? "on" : ""} onClick={() => setImg(i)} aria-label={`Photo ${i + 1}`}>
                  <img src={s} alt="" width="80" height="80" />
                </button>
              ))}
            </div>
          )}

          {/* Description & Specs Tabs below Image (matching Screenshot 1) */}
          <div className="p-tabs" role="tablist">
            <button role="tab" aria-selected={tab === "desc"} className={tab === "desc" ? "on" : ""} onClick={() => setTab("desc")}>
              Description
            </button>
            <button role="tab" aria-selected={tab === "info"} className={tab === "info" ? "on" : ""} onClick={() => setTab("info")}>
              Additional Information
            </button>
            <button role="tab" aria-selected={tab === "review"} className={tab === "review" ? "on" : ""} onClick={() => setTab("review")}>
              Review
            </button>
          </div>

          <div className="p-tab-body" role="tabpanel">
            {tab === "desc" && (
              <p className="tab-desc-text">
                {p.description ||
                  p.shortDescription ||
                  "Provide your guests with an ultra-refreshing hair care experience with our Farm Fresh products. Specially curated for hospitality spaces and luxury guest kits, this deep-conditioning formula actively targets hair smoothness while maintaining supreme scalp health."}
              </p>
            )}
            {tab === "info" && (
              <table className="specs">
                <tbody>
                  {specs.map((s) => (
                    <tr key={s.label}>
                      <th>{s.label}</th>
                      <td>{s.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {tab === "review" && (
              <div className="tab-review-box">
                <p>There are no reviews yet for this product.</p>
                <p className="muted">Only verified hospitality buyers who have purchased this product may leave a review.</p>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Title, Rating, Brand Card, Pricing, Tiers, Add To Cart */}
        <div className="p-info">
          <p className="category-breadcrumb">{p.collection || cat?.name || "BIO WET AMENITIES"}</p>
          <h1 className="p-title">{p.name}</h1>

          {/* Badges row: Recent orders & Brand */}
          <div className="p-meta-badges">
            <span className="order-pill-badge">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
                <path d="M3 6h18" /><path d="M16 10a4 4 0 0 1-8 0" />
              </svg>
              50+ recent orders
            </span>
            <span className="brand-meta-text">Brand: <strong>{p.brand || "Farm Fresh"}</strong></span>
          </div>

          {/* Category link in red/coral */}
          <div className="p-cat-line">
            Categories: <Link to={`/shop?category=${cat?.slug || "bio-wet-amenities"}`} className="red-cat-link">{cat?.name || "Bio Wet Amenities"}</Link>
          </div>

          {/* Star Rating */}
          <div className="p-stars-row">
            <span className="stars">★★★★★</span>
            <span className="rating-score">4.8</span>
            <span className="rating-count">(32 reviews)</span>
          </div>

          {/* Short description */}
          <p className="p-short">
            {p.shortDescription ||
              "An invigorating, purifying 20ml hair conditioner infused with natural tea tree oil to effortlessly detangle, soften, and clarify your guests' hair."}
          </p>

          {/* Brand Card */}
          <div className="brand-card">
            <span className="brand-ico" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
                <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
              </svg>
            </span>
            <div>
              <strong className="brand-name">{p.brand || "Farm Fresh"}</strong>
              <small className="brand-mfr">{p.manufacturer || "Bio Veda Pharmacy Private Limited"}</small>
            </div>
          </div>

          {/* Price row */}
          <div className="p-price-row">
            <div>
              <div className="price-big-line">
                <span className="p-price">{money(rate || p.pricePaise || 750)}</span>
                <span className="p-unit-tag"> /{unit}</span>
              </div>
              <div className="p-incl" style={{ color: "#b45309", background: "#fef3c7", padding: "2px 8px", borderRadius: "4px", fontSize: "12px", fontWeight: "600", width: "fit-content", marginTop: "4px" }}>
                + {p.gstRate || 18}% GST extra (Tax added at Quote / Cart)
              </div>
            </div>
            <span className="stock-pill in-stock">IN STOCK</span>
          </div>

          {/* Quantity Discounts Table */}
          <div className="tiers-box">
            <div className="tiers-header">
              <strong>Quantity Discounts</strong>
              <small>Save more when you buy in bulk</small>
            </div>
            <table className="tiers-table">
              <thead>
                <tr>
                  <th>Quantity</th>
                  <th>Savings</th>
                  <th className="num">Price per Unit</th>
                </tr>
              </thead>
              <tbody>
                {p.priceTiers && p.priceTiers.length > 0 ? (
                  p.priceTiers.map((t) => (
                    <tr key={t.minQty}>
                      <td>{t.minQty.toLocaleString("en-IN")} + {unit}</td>
                      <td className="save-pct">Save {Math.max(2, Math.round((1 - t.price / p.pricePaise) * 100))}%</td>
                      <td className="num">{money(t.price)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td>288 + {unit}</td>
                    <td className="save-pct">Save 2%</td>
                    <td className="num">₹7.50</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Dispatch & Non-Returnable Badges */}
          <div className="shipping-badges-row">
            <span className="shipping-pill">
              🚚 Dispatched within 24-48 hours
            </span>
            <span className="shipping-pill">
              ↺ Non Returnable
            </span>
          </div>

          {/* Bulk or outside India link */}
          <div className="bulk-link-wrap">
            <a className="bulk-link" href={wa} target="_blank" rel="noopener noreferrer">
              Bulk or outside India orders →
            </a>
          </div>

          {/* Size / Volume buttons */}
          <div className="p-options-group">
            <label className="options-lbl">Size/Volume</label>
            <div className="options-buttons">
              {(p.variants?.length ? p.variants : ["20ml"]).map((v) => (
                <button
                  key={v}
                  type="button"
                  className={"opt-btn" + (v === variant ? " selected" : "")}
                  onClick={() => { setVariant(v); setAdded(false); }}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          {/* Quantity dropdown & Add To Cart Button */}
          <div className="add-to-cart-section">
            <label className="qty-label">
              <span>Quantity ({unit})</span>
              <select
                value={qty}
                onChange={(e) => { setQty(Number(e.target.value)); setAdded(false); }}
                className="qty-select"
              >
                {options.map((n) => (
                  <option key={n} value={n}>
                    {n.toLocaleString("en-IN")}
                  </option>
                ))}
              </select>
            </label>

            <button className="large-add-btn" disabled={p.stock === "out"} onClick={addToCart}>
              {buy ? "Add To Cart" : "Add to quote"}
            </button>
          </div>

          {/* You pay line */}
          {priced && (
            <p className="p-total-calc">
              You pay only a total of <strong>{money((rate || p.pricePaise || 750) * qty)}</strong> for{" "}
              <strong>{qty.toLocaleString("en-IN")} x {unit}</strong> <span className="muted">(+ GST)</span>
            </p>
          )}

          {added && (
            <div className="added-notice-banner" role="status">
              Added to your {buy ? "cart" : "quote list"}.{" "}
              <Link to={buy ? "/cart" : "/quote"}>{buy ? "View cart →" : "Review & send →"}</Link>
            </div>
          )}
        </div>
      </div>

      {related.length > 0 && (
        <section className="related-section">
          <h2>Related products</h2>
          <div className="bestsellers-grid">
            {related.map((r) => (
              <ProductCard key={r.id || r.slug} p={r} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
