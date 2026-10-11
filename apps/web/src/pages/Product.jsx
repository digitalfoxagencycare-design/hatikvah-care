import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Price } from "../components/ProductCard.jsx";
import ProductCard from "../components/ProductCard.jsx";
import Seo from "../components/Seo.jsx";
import { useSite } from "../data.jsx";
import NotFound from "./NotFound.jsx";

export default function Product() {
  const { slug } = useParams();
  const { catalog, settings, add, basket } = useSite();
  const p = catalog.products.find((x) => x.slug === slug);
  const [img, setImg] = useState(0);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  useEffect(() => { setImg(0); setQty(1); setAdded(false); }, [slug]);
  if (!p) return <NotFound what="product" />;
  const cat = catalog.categories.find((c) => c.slug === p.category);
  const related = catalog.products.filter((x) => x.category === p.category && x.collection === p.collection && x.id !== p.id).slice(0, 4);
  const wa = settings.whatsapp ? `https://wa.me/${settings.whatsapp}?text=${encodeURIComponent(`Hello HaTikvah Care, I am interested in: ${p.name} (${p.sku}).`)}` : null;
  const ld = { "@context": "https://schema.org", "@type": "Product", name: p.name, sku: p.sku, image: p.images, description: p.description || `${p.name}. ${p.pack}`, brand: { "@type": "Brand", name: "HaTikvah Care" },
    ...(p.pricePaise != null ? { offers: { "@type": "Offer", priceCurrency: "INR", price: (p.pricePaise / 100).toFixed(2), availability: "https://schema.org/InStock" } } : {}) };
  const inBasket = basket.some((i) => i.productId === p.id);
  return (
    <div className="wrap product">
      <Seo title={p.name} description={`${p.name}${p.pack ? ` (${p.pack})` : ""}. ${p.description || cat?.description || ""} Request a quote from HaTikvah Care.`} jsonLd={ld} />
      <nav className="crumbs" aria-label="Breadcrumb"><Link to="/catalog">Catalogue</Link> / <Link to={`/catalog?category=${p.category}`}>{cat?.name}</Link> / <span>{p.name}</span></nav>
      <div className="p-grid">
        <div className="gallery">
          <img className="main-img" src={p.images[img]} alt={p.name} width="640" height="480" />
          {p.images.length > 1 && <div className="thumbs">{p.images.map((s, i) => <button key={s} className={i === img ? "on" : ""} onClick={() => setImg(i)} aria-label={`Photo ${i + 1}`}><img src={s} alt="" width="72" height="72" /></button>)}</div>}
        </div>
        <div>
          <p className="eyebrow">{p.collection}</p>
          <h1>{p.name}</h1>
          <p className="muted">SKU {p.sku}</p>
          <Price p={p} big />
          {p.minOrder && <p className="muted">Minimum order: {p.minOrder}</p>}
          <dl className="facts">
            {p.pack && <><dt>Pack / spec</dt><dd>{p.pack}</dd></>}
            <dt>Category</dt><dd>{cat?.name}</dd>
          </dl>
          {p.variants.length > 0 && <div><h3>Available in</h3><ul className="chips">{p.variants.map((v) => <li key={v}>{v}</li>)}</ul></div>}
          {p.description && <p>{p.description}</p>}
          <div className="buy">
            <label>Quantity<input type="number" min="1" max="1000000" value={qty} onChange={(e) => setQty(Math.max(1, Math.min(1_000_000, Number(e.target.value) || 1)))} /></label>
            <button className="btn" onClick={() => { add(p.id, qty); setAdded(true); }}>{inBasket && !added ? "Add more to quote" : "Add to quote"}</button>
          </div>
          {added && <p className="notice" role="status">Added to your quote list. <Link to="/quote">Review & send →</Link></p>}
          {wa && <p><a className="btn ghost" href={wa} target="_blank" rel="noopener noreferrer">Ask on WhatsApp</a></p>}
          <p className="muted small-print">Branding and customisation available on request. Quantities and delivery are confirmed in your quote.</p>
        </div>
      </div>
      {related.length > 0 && <section className="section"><h2>More from {p.collection}</h2><div className="grid">{related.map((r) => <ProductCard key={r.id} p={r} />)}</div></section>}
    </div>
  );
}
