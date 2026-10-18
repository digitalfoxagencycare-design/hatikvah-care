import { Link } from "react-router-dom";
import { money } from "../api.js";
import { useSite } from "../data.jsx";

/** Shop maths for display. The server prices every order again (apps/api/src/lib/sales.js tierPrice); keep the two in step. */
export const minQty = (p) => Math.max(p.minQty || 0, p.packSize || 1);
export function unitPrice(p, qty) {
  let rate = p.pricePaise;
  for (const t of p.priceTiers || []) if (qty >= t.minQty) rate = t.price;
  return rate;
}
export const withGst = (paise, rate) => Math.round(paise * (1 + (rate || 0) / 100));
export const unitLabel = (p) => (p.priceUnit ? p.priceUnit.replace(/^per\s+/i, "") : p.unit || "pcs");

export function Price({ p, big }) {
  if (p.pricePaise == null) return <span className="price ask">Price on request</span>;
  return <span className={"price" + (big ? " big" : "")}>{money(p.pricePaise)}<small> /{unitLabel(p)}</small></span>;
}

export default function ProductCard({ p }) {
  const { add, basket, settings } = useSite();
  const variant = p.variants[0] || "";
  const inBasket = basket.some((i) => i.productId === p.id);
  const buy = settings.shop?.cart && p.pricePaise != null;
  return (
    <article className="card">
      <Link to={`/product/${p.slug}`} className="card-img" aria-label={p.name}>
        <img src={p.images[0]} alt={p.name} loading="lazy" width="320" height="240" />
        {p.stock === "out" && <span className="card-flag">Out of stock</span>}
      </Link>
      <div className="card-body">
        <div className="card-coll">{p.brand || p.collection}</div>
        <h3><Link to={`/product/${p.slug}`}>{p.name}</Link></h3>
        {p.pack && <div className="card-pack">{p.pack}</div>}
        {(p.shortDescription || p.description) && <p className="card-desc">{p.shortDescription || p.description}</p>}
        <div className="card-foot">
          <Price p={p} />
          <button className={"btn small" + (inBasket ? " ghost" : "")} disabled={p.stock === "out"} onClick={() => add(p.id, minQty(p), variant)}>{inBasket ? "Added ✓" : buy ? "Add to cart" : "Add to quote"}</button>
        </div>
      </div>
    </article>
  );
}
