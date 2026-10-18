import { Link } from "react-router-dom";
import ProductCard from "../components/ProductCard.jsx";
import Seo from "../components/Seo.jsx";
import { AboutBlock, ClientsBlock, ContactBlock, FaqBlock } from "../components/Sections.jsx";
import { useSite } from "../data.jsx";

export default function Home() {
  const { catalog, settings } = useSite();
  const h = settings.home;
  const featured = catalog.products.filter((p) => p.featured).slice(0, 8);
  const cats = catalog.categories.filter((c) => c.count > 0).map((c) => ({ ...c, img: catalog.products.find((p) => p.category === c.slug)?.images[0] }));
  const ld = { "@context": "https://schema.org", "@type": "Organization", name: "HaTikvah Care", legalName: "EXL Marketing", url: "https://www.hatikvahcare.com", logo: "/brand/hatikvah-logo.png",
    email: settings.email, telephone: settings.phone, address: { "@type": "PostalAddress", streetAddress: "Eshwar Nilayam, Plot No. 4-1447, Kondapur Golden Tulip Estate, JV Hills, Gachibowli", addressLocality: "Hyderabad", addressRegion: "Telangana", postalCode: "500084", addressCountry: "IN" } };
  return (
    <>
      <Seo description="Guest amenities, F&B disposables, housekeeping and hygiene products, hotel linen and hospital linen. HaTikvah Care by EXL Marketing, Hyderabad. Serving hotels, resorts, spas and hospitals across India since 2002." jsonLd={ld} />
      <section className="hero" style={h.hero.image ? { "--hero-img": `url(${h.hero.image})` } : undefined}>
        <div className="wrap hero-grid">
          <div>
            {h.hero.eyebrow && <p className="eyebrow">{h.hero.eyebrow}</p>}
            <h1>{h.hero.title}</h1>
            {h.hero.lead && <p className="lead">{h.hero.lead}</p>}
            <div className="cta-row">
              <Link className="btn" to="/shop">{h.hero.cta || "Browse the catalogue"}</Link>
              <Link className="btn ghost light" to="/quote">{h.hero.cta2 || "Request a quote"}</Link>
              {settings.brochureUrl && <a className="btn ghost light" href={settings.brochureUrl} target="_blank" rel="noopener noreferrer">Download brochure</a>}
            </div>
          </div>
        </div>
      </section>

      {h.stats.length > 0 && (
        <section className="stats">
          <div className="wrap stat-row">{h.stats.map((x, i) => <div key={i}><strong>{x.value}</strong><span>{x.label}</span></div>)}</div>
        </section>
      )}

      <section className="section">
        <div className="wrap">
          <h2>Shop by category</h2>
          <div className="cat-grid">
            {cats.map((c) => (
              <Link key={c.id} className="cat" to={`/shop?category=${c.slug}`}>
                <img src={c.img} alt="" loading="lazy" width="320" height="240" />
                <div><h3>{c.name}</h3><p>{c.description}</p><span>{c.count} products →</span></div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {featured.length > 0 && (
        <section className="section tint">
          <div className="wrap">
            <div className="row-between"><h2>Popular with our clients</h2><Link to="/shop">View all →</Link></div>
            <div className="grid">{featured.map((p) => <ProductCard key={p.id} p={p} />)}</div>
          </div>
        </section>
      )}

      <AboutBlock />
      <ClientsBlock />
      <FaqBlock />
      <ContactBlock />
    </>
  );
}
