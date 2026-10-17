import { useState } from "react";
import { Link } from "react-router-dom";
import EnquiryForm from "../components/EnquiryForm.jsx";
import ProductCard from "../components/ProductCard.jsx";
import Seo from "../components/Seo.jsx";
import { useSite } from "../data.jsx";

export default function Home() {
  const { catalog, settings } = useSite();
  const [sent, setSent] = useState(null);
  const h = settings.home;
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
            {h.hero.eyebrow && <p className="eyebrow">{h.hero.eyebrow}</p>}
            <h1>{h.hero.title}</h1>
            {h.hero.lead && <p className="lead">{h.hero.lead}</p>}
            <div className="cta-row">
              <Link className="btn" to="/catalog">{h.hero.cta || "Browse the catalogue"}</Link>
              <Link className="btn ghost" to="/quote">{h.hero.cta2 || "Request a quote"}</Link>
              {settings.brochureUrl && <a className="btn ghost" href={settings.brochureUrl} target="_blank" rel="noopener noreferrer">Download brochure</a>}
            </div>
          </div>
          {h.hero.image && <img className="hero-img" src={h.hero.image} alt="" width="700" height="302" fetchPriority="high" />}
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
            <ul className="chips">{h.serve.map((s) => <li key={s}>{s}</li>)}</ul>
          </div>
          <div>
            <h3>Why choose HaTikvah Care?</h3>
            <ul className="why">{h.why.map((w) => <li key={w.title}><strong>{w.title}</strong><span>{w.text}</span></li>)}</ul>
          </div>
        </div>
      </section>

      {h.clients.length > 0 && (
        <section className="section tint">
          <div className="wrap"><h2>Trusted by</h2>
            <ul className="clients">{h.clients.map((c) => <li key={c.name}>{c.logo ? <img src={c.logo} alt={c.name} loading="lazy" width="140" height="70" /> : <span>{c.name}</span>}</li>)}</ul>
          </div>
        </section>
      )}

      {h.testimonials.length > 0 && (
        <section className="section">
          <div className="wrap"><h2>What our clients say</h2>
            <div className="testimonials">{h.testimonials.map((t, i) => <figure key={i} className="panel"><blockquote>“{t.quote}”</blockquote><figcaption><strong>{t.name}</strong>{t.role && <span> · {t.role}</span>}</figcaption></figure>)}</div>
          </div>
        </section>
      )}

      {h.faq.length > 0 && (
        <section className="section tint" id="faq">
          <div className="wrap narrow"><h2>Frequently asked questions</h2>
            {h.faq.map((f, i) => <details key={i} className="faq"><summary>{f.q}</summary><p>{f.a}</p></details>)}
          </div>
        </section>
      )}

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
