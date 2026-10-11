import { useState } from "react";
import { Link } from "react-router-dom";
import EnquiryForm from "../components/EnquiryForm.jsx";
import ProductCard from "../components/ProductCard.jsx";
import Seo from "../components/Seo.jsx";
import { useSite } from "../data.jsx";

const WHY = [
  ["20+ years of industry experience", "Supplying the hospitality & tourism industry since 2002."],
  ["One-stop procurement", "Amenities, disposables, housekeeping and linen from a single supplier."],
  ["Made to reflect your brand", "Tailor-made and branded solutions for your property."],
  ["Cost-effective import substitution", "Quality alternatives without import lead times."],
  ["Reliable supply, timely deliveries", "Consistent quality and dependable delivery schedules."],
  ["Trusted across institutions", "Hotels, resorts, spas, hospitals and corporate institutions."],
];
const SERVE = ["Hotels", "Resorts", "Spas", "Serviced apartments", "Hospitals", "Corporate institutions", "Large-scale events"];

export default function Home() {
  const { catalog, settings } = useSite();
  const [sent, setSent] = useState(null);
  const featured = catalog.products.filter((p) => p.featured).slice(0, 8);
  const cats = catalog.categories.filter((c) => c.count > 0).map((c) => ({ ...c, img: catalog.products.find((p) => p.category === c.slug)?.images[0] }));
  const ld = { "@context": "https://schema.org", "@type": "Organization", name: "HaTikvah Care", legalName: "EXL Marketing", url: "https://www.hatikvahcare.com", logo: "/brand/hatikvah-logo.png",
    email: settings.email, telephone: settings.phone, address: { "@type": "PostalAddress", streetAddress: "Eshwar Nilayam, Plot No. 4-1447, Kondapur Golden Tulip Estate, JV Hills, Gachibowli", addressLocality: "Hyderabad", addressRegion: "Telangana", postalCode: "500084", addressCountry: "IN" } };
  return (
    <>
      <Seo description="Guest amenities, F&B disposables, housekeeping and hygiene products, hotel linen and hospital linen. HaTikvah Care by EXL Marketing, Hyderabad. Serving hotels, resorts, spas and hospitals across India since 2002." jsonLd={ld} />
      <section className="hero">
        <div className="wrap hero-grid">
          <div>
            <p className="eyebrow">Hospitality · Hygiene · Wellness Supplies</p>
            <h1>Everything your property needs, under one roof.</h1>
            <p className="lead">Guest amenities, F&B disposables, housekeeping and hygiene products, hotel linen and healthcare supplies for hotels, resorts, spas and hospitals across India since 2002.</p>
            <div className="cta-row">
              <Link className="btn" to="/catalog">Browse the catalogue</Link>
              <Link className="btn ghost" to="/quote">Request a quote</Link>
            </div>
          </div>
          <img className="hero-img" src="/brand/hero-travel-kit.jpg" alt="Biotique luxury travel kit amenities" width="700" height="302" fetchPriority="high" />
        </div>
      </section>

      <section className="stats">
        <div className="wrap stat-row">
          <div><strong>Since 2002</strong><span>Trusted hospitality supplier</span></div>
          <div><strong>{catalog.products.length}+</strong><span>Products in the catalogue</span></div>
          <div><strong>{cats.length}</strong><span>Product categories</span></div>
          <div><strong>Pan-India</strong><span>Supply and delivery</span></div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <h2>Shop by category</h2>
          <div className="cat-grid">
            {cats.map((c) => (
              <Link key={c.id} className="cat" to={`/catalog?category=${c.slug}`}>
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
            <div className="row-between"><h2>Popular with our clients</h2><Link to="/catalog">View all →</Link></div>
            <div className="grid">{featured.map((p) => <ProductCard key={p.id} p={p} />)}</div>
          </div>
        </section>
      )}

      <section className="section" id="about">
        <div className="wrap about-grid">
          <div>
            <h2>About HaTikvah Care</h2>
            <p>{settings.about}</p>
            <h3 className="mt">We serve</h3>
            <ul className="chips">{SERVE.map((s) => <li key={s}>{s}</li>)}</ul>
          </div>
          <div>
            <h3>Why choose HaTikvah Care?</h3>
            <ul className="why">{WHY.map(([t, d]) => <li key={t}><strong>{t}</strong><span>{d}</span></li>)}</ul>
          </div>
        </div>
      </section>

      <section className="section dark" id="contact">
        <div className="wrap contact-grid">
          <div>
            <h2>Talk to us</h2>
            <p>Tell us what you need. We will get back with availability, branding options and a quote.</p>
            <address>
              <p>{settings.address}</p>
              {settings.phone && <p>Phone: <a href={`tel:${settings.phone.replace(/\s/g, "")}`}>{settings.phone}</a></p>}
              {settings.email && <p>Email: <a href={`mailto:${settings.email}`}>{settings.email}</a></p>}
              {settings.whatsapp && <p><a href={`https://wa.me/${settings.whatsapp}`} target="_blank" rel="noopener noreferrer">Message us on WhatsApp</a></p>}
              <p><a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(settings.address)}`} target="_blank" rel="noopener noreferrer">View on Google Maps</a></p>
            </address>
          </div>
          <div className="panel">
            {sent ? (
              <div className="success" role="status"><h3>Thank you!</h3><p>We received your enquiry (ref <strong>{sent}</strong>). Our team will contact you shortly.</p><button className="btn ghost" onClick={() => setSent(null)}>Send another</button></div>
            ) : <EnquiryForm onDone={(ref) => setSent(ref)} />}
          </div>
        </div>
      </section>
    </>
  );
}
