import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import ProductCard from "../components/ProductCard.jsx";
import Seo from "../components/Seo.jsx";
import { useSite } from "../data.jsx";

const PAGE = 24;
export default function Catalog() {
  const { catalog } = useSite();
  const [sp, setSp] = useSearchParams();
  const [shown, setShown] = useState(PAGE);
  const category = sp.get("category") || "";
  const collection = sp.get("collection") || "";
  const q = sp.get("q") || "";
  const sort = sp.get("sort") || "catalogue";
  const set = (k, v) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); if (k === "category") n.delete("collection"); setSp(n, { replace: true }); setShown(PAGE); };

  const cat = catalog.categories.find((c) => c.slug === category);
  const inCat = useMemo(() => catalog.products.filter((p) => !category || p.category === category), [catalog, category]);
  const collections = useMemo(() => [...new Set(inCat.map((p) => p.collection).filter(Boolean))], [inCat]);
  const list = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    let r = inCat.filter((p) => (!collection || p.collection === collection) && words.every((w) => `${p.name} ${p.brand} ${p.collection} ${p.pack} ${p.variants.join(" ")} ${p.sku}`.toLowerCase().includes(w)));
    if (sort === "name") r = [...r].sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "price") r = [...r].sort((a, b) => (a.pricePaise ?? Infinity) - (b.pricePaise ?? Infinity));
    return r;
  }, [inCat, collection, q, sort]);

  return (
    <div className="wrap catalog">
      <Seo title={cat ? cat.name : "Shop"} description={cat ? `${cat.name}: ${cat.description}` : "Browse hospitality supplies: guest amenities, bath & body, tray amenities, hotel linen and hospital linen."} />
      <aside className="side" aria-label="Categories">
        <h2>Categories</h2>
        <ul>
          <li><button className={!category ? "on" : ""} onClick={() => set("category", "")}>All products <span>{catalog.products.length}</span></button></li>
          {catalog.categories.filter((c) => c.count > 0).map((c) => <li key={c.id}><button className={category === c.slug ? "on" : ""} onClick={() => set("category", c.slug)}>{c.name} <span>{c.count}</span></button></li>)}
        </ul>
      </aside>
      <section>
        <h1>{cat ? cat.name : q ? `Results for “${q}”` : "Shop"}</h1>
        {cat && <p className="muted">{cat.description}</p>}
        <div className="toolbar">
          <input type="search" value={q} onChange={(e) => set("q", e.target.value)} placeholder="Search products, e.g. towel, shampoo, sachet" aria-label="Search products" />
          <select value={sort} onChange={(e) => set("sort", e.target.value === "catalogue" ? "" : e.target.value)} aria-label="Sort">
            <option value="catalogue">Catalogue order</option><option value="name">Name A–Z</option><option value="price">Price: low to high</option>
          </select>
        </div>
        {collections.length > 1 && (
          <div className="chips-row" role="group" aria-label="Collections">
            <button className={!collection ? "chip on" : "chip"} onClick={() => set("collection", "")}>All</button>
            {collections.map((c) => <button key={c} className={collection === c ? "chip on" : "chip"} onClick={() => set("collection", c)}>{c}</button>)}
          </div>
        )}
        <p className="muted" role="status">{list.length} {list.length === 1 ? "product" : "products"}</p>
        {list.length === 0 ? (
          <div className="empty"><p>No products match your search.</p><button className="btn ghost" onClick={() => setSp({}, { replace: true })}>Clear filters</button></div>
        ) : (
          <>
            <div className="grid">{list.slice(0, shown).map((p) => <ProductCard key={p.id} p={p} />)}</div>
            {shown < list.length && <div className="more"><button className="btn ghost" onClick={() => setShown(shown + PAGE)}>Show more ({list.length - shown} left)</button></div>}
          </>
        )}
      </section>
    </div>
  );
}
