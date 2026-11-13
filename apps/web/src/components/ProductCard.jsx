import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { money } from "../api.js";
import { useSite } from "../data.jsx";

export const minQty = (p) => Math.max(p.minQty || 0, p.packSize || 1);
export function unitPrice(p, qty) {
  let rate = p.pricePaise;
  for (const t of p.priceTiers || []) if (qty >= t.minQty) rate = t.price;
  return rate;
}
export const withGst = (paise, rate) => Math.round(paise * (1 + (rate || 0) / 100));
export const unitLabel = (p) => (p.priceUnit ? p.priceUnit.replace(/^per\s+/i, "") : p.unit || "Nos");

export function Price({ p, big }) {
  if (p.pricePaise == null) return <span className="price ask">Price on request</span>;
  return (
    <span className={"price" + (big ? " big" : "")}>
      {money(p.pricePaise)}
      <small> /{unitLabel(p)}</small>
    </span>
  );
}

export default function ProductCard({ p }) {
  const { add, basket, settings } = useSite();
  const [variant, setVariant] = useState(p.variants?.[0] || "");
  const inBasket = basket.some((i) => i.productId === p.id);
  const buy = settings.shop?.cart !== false;
  const nav = useNavigate();
  const price = p.pricePaise ?? p.price;
  const priced = price != null;

  return (
    <article className="live-card">
      <Link to={`/product/${p.slug}`} className="live-card-img-wrap" aria-label={p.name}>
        {p.variants?.[0] && <div className="card-top-tag">{p.variants[0]}</div>}
        {p.images?.[0] ? (
          <img src={p.images[0]} alt={p.name} loading="lazy" />
        ) : (
          <div className="card-placeholder-box" style={{ width: "100%", height: "100%", minHeight: "180px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#f8fafc", color: "#94a3b8", padding: "16px", textAlign: "center" }}>
            <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: "6px", opacity: 0.7 }}>
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
              <line x1="12" y1="22.08" x2="12" y2="12" />
            </svg>
            <span style={{ fontSize: "11px", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.5px" }}>HaTikvah Care</span>
          </div>
        )}
        {p.stock === "out" && <span className="card-flag">Out of stock</span>}
      </Link>

      <div className="live-card-body">
        <span className="live-card-cat">{p.collection || (p.category === "bio-wet-amenities" ? "Bio Wet Amenities" : p.category)}</span>
        <h3 className="live-card-title">
          <Link to={`/product/${p.slug}`}>{p.name}</Link>
        </h3>
        <p className="live-card-desc">{p.shortDescription || p.description}</p>

        <div className="live-card-price">
          {priced ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              <div style={{ fontSize: "18px", fontWeight: "700", color: "#0f172a" }}>
                {money(price)}
                <span style={{ fontSize: "12px", fontWeight: "500", color: "#64748b" }}> /{unitLabel(p)}</span>
              </div>
              <div style={{ fontSize: "11px", fontWeight: "600", color: "#b45309", background: "#fef3c7", padding: "2px 6px", borderRadius: "4px", width: "fit-content" }}>
                + {p.gstRate || 18}% GST extra
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              <span style={{ fontSize: "15px", fontWeight: "600", color: "#0f172a" }}>Price on request</span>
              <span style={{ fontSize: "11px", color: "#64748b" }}>Institutional B2B Quote</span>
            </div>
          )}
        </div>

        <div className="live-card-actions">
          {p.variants && p.variants.length > 0 && (
            <div className="variant-dropdown-box">
              <select value={variant} onChange={(e) => setVariant(e.target.value)} className="variant-select">
                {p.variants.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>
          )}

          {priced ? (
            <button
              className={"live-card-btn" + (inBasket ? " in-cart" : "")}
              disabled={p.stock === "out"}
              onClick={() => add(p.id, minQty(p), variant)}
            >
              {inBasket ? "Added ✓" : "Add To Cart"}
            </button>
          ) : (
            <button className="live-card-btn" onClick={() => nav(`/product/${p.slug}`)}>Enquire</button>
          )}
        </div>
      </div>
    </article>
  );
}
