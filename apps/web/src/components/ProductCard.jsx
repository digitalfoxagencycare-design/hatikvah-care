import { Link } from "react-router-dom";
import { money } from "../api.js";
import { useSite } from "../data.jsx";

export function Price({ p, big }) {
  if (p.pricePaise == null) return <span className="price ask">Price on request</span>;
  return <span className={"price" + (big ? " big" : "")}>{money(p.pricePaise)}{p.priceUnit && <small> / {p.priceUnit.replace(/^per\s+/i, "")}</small>}</span>;
}

export default function ProductCard({ p }) {
  const { add, basket } = useSite();
  const inBasket = basket.some((i) => i.productId === p.id);
  return (
    <article className="card">
      <Link to={`/product/${p.slug}`} className="card-img" aria-label={p.name}>
        <img src={p.images[0]} alt={p.name} loading="lazy" width="320" height="240" />
      </Link>
      <div className="card-body">
        <div className="card-coll">{p.collection}</div>
        <h3><Link to={`/product/${p.slug}`}>{p.name}</Link></h3>
        {p.pack && <div className="card-pack">{p.pack}</div>}
        {p.description && <p className="card-desc" style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "4px 0 6px", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{p.description}</p>}
        <div className="card-foot">
          <Price p={p} />
          <button className={"btn small" + (inBasket ? " ghost" : "")} onClick={() => add(p.id)}>{inBasket ? "Added ✓" : "Add to quote"}</button>
        </div>
      </div>
    </article>
  );
}
