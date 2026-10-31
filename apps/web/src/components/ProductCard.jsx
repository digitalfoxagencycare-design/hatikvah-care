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
        <img src={p.images?.[0] || "/brand/farm-fresh-tea-tree-bottles.png"} alt={p.name} loading="lazy" />
        {p.stock === "out" && <span className="card-flag">Out of stock</span>}
      </Link>

      <div className="live-card-body">
        <span className="live-card-cat">{p.collection || (p.category === "bio-wet-amenities" ? "Bio Wet Amenities" : p.category)}</span>
        <h3 className="live-card-title">
          <Link to={`/product/${p.slug}`}>{p.name}</Link>
        </h3>
        <p className="live-card-desc">{p.shortDescription || p.description}</p>

        <div className="live-card-price">
          {priced ? money(price) : "Price on request"}
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
