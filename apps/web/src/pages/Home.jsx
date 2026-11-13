import { useMemo } from "react";
import { Link } from "react-router-dom";
import ProductCard from "../components/ProductCard.jsx";
import Seo from "../components/Seo.jsx";
import { useSite } from "../data.jsx";

const categoriesList = [
  { name: "Hotel Guest Amenities", slug: "guest-amenities", img: "/brand/cat-1.png" },
  { name: "Bath & Body Care", slug: "bath-body", img: "/brand/cat-3.png" },
  { name: "Hotel Linen & Towels", slug: "hotel-linen", img: "/brand/cat-4.png" },
  { name: "Tray Amenities & Tea/Coffee", slug: "tray-amenities", img: "/brand/cat-2.png" },
  { name: "Eco-Friendly Amenities", slug: "eco-friendly", img: "/brand/cat-1.png" },
  { name: "Biotique Amenities", slug: "biotique-dry-amenities", img: "/brand/cat-3.png" },
];

const keyBenefits = [
  {
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 22v-6.57" /><path d="M12 11h.01" /><path d="M12 7h.01" /><path d="M14 15.43V22" /><path d="M15 16a5 5 0 0 0-6 0" />
        <path d="M16 11h.01" /><path d="M16 7h.01" /><path d="M8 11h.01" /><path d="M8 7h.01" /><rect x="4" y="2" width="16" height="20" rx="2" />
      </svg>
    ),
    title: "Complete Hospitality Solutions",
    text: "A one-stop destination for hotel amenities, housekeeping supplies, hygiene products, pantry essentials, coffee and beverages and corporate gifting solutions.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526" />
        <circle cx="12" cy="8" r="6" />
      </svg>
    ),
    title: "Premium Quality Products",
    text: "Carefully sourced and quality-tested products designed to enhance guest experience and operational efficiency.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
        <path d="m15 5 4 4" />
      </svg>
    ),
    title: "Customization & Branding",
    text: "Personalized products and packaging solutions tailored to match your brand identity and business requirements.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m16 16 2 2 4-4" />
        <path d="M21 10V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l2-1.14" />
        <path d="m7.5 4.27 9 5.15" /><polyline points="3.29 7 12 12 20.71 7" /><line x1="12" y1="22" x2="12" y2="12" />
      </svg>
    ),
    title: "Reliable Supply & Timely Delivery",
    text: "Efficient procurement and dependable delivery support to ensure uninterrupted operations for our clients.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 19H4.815a1.83 1.83 0 0 1-1.57-.881 1.785 1.785 0 0 1-.004-1.784L7.196 9.5" />
        <path d="M11 19h8.203a1.83 1.83 0 0 0 1.556-.89 1.784 1.784 0 0 0 0-1.775l-1.226-2.12" /><path d="m14 16-3 3 3 3" />
        <path d="M8.293 13.596 7.196 9.5 3.1 10.598" />
        <path d="m9.344 5.811 1.093-1.892A1.83 1.83 0 0 1 11.985 3a1.784 1.784 0 0 1 1.546.888l3.943 6.843" />
        <path d="m13.378 9.633 4.096 1.098 1.097-4.096" />
      </svg>
    ),
    title: "Eco-Friendly & Sustainable Options",
    text: "A growing range of environmentally responsible products that support sustainable hospitality practices.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    ),
    title: "Trusted Industry Experience",
    text: "Backed by EXL Marketing's decades of experience serving hotels, resorts, hospitals, corporates, and institutions across India.",
  },
];

export default function Home() {
  const { catalog, settings } = useSite();

  // Dynamically showcase top verified products across categories with 100% unique original photos
  const featured = useMemo(() => {
    const prods = catalog.products || [];
    // Prioritize products that have verified original photography
    const withPhotos = prods.filter((p) => p.images && p.images.length > 0 && p.images[0].startsWith("/catalog/"));
    if (withPhotos.length === 0) return prods.slice(0, 8);

    // Pick top items across diverse categories so each card has its own unique photo
    const chosen = [];
    const usedImages = new Set();
    const categories = ["guest-amenities", "bath-body", "hotel-linen", "tray-amenities", "eco-friendly", "biotique-dry-amenities"];

    // First, pick one prominent item per category
    for (const cat of categories) {
      const match = withPhotos.find((p) => p.category === cat && !usedImages.has(p.images[0]));
      if (match) {
        chosen.push(match);
        usedImages.add(match.images[0]);
      }
    }

    // Fill remaining slots up to 8 with other photo-verified products
    for (const p of withPhotos) {
      if (chosen.length >= 8) break;
      if (!usedImages.has(p.images[0])) {
        chosen.push(p);
        usedImages.add(p.images[0]);
      }
    }

    return chosen;
  }, [catalog.products]);

  const ld = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "HaTikvah Care",
    legalName: "EXL Marketing",
    url: "https://www.hatikvahcare.com",
    logo: "/brand/logo1.png",
    email: settings.email,
    telephone: settings.phone,
  };

  return (
    <>
      <Seo
        title="HaTikvah Care | Elevating Excellence in Hospitality & Hygiene"
        description="As a trusted partner and authorized distributor, we provide premium guest amenities and industrial-grade cleaning solutions tailored for India's finest hotels, resorts, and corporate institutions."
        jsonLd={ld}
      />

      {/* Hero Section matching Screenshot 2 */}
      <section className="live-hero">
        <div className="live-hero-bg">
          <img src="/brand/hero_page_image.png" alt="Hospitality Amenities" className="live-hero-img" />
          <div className="live-hero-overlay"></div>
        </div>
        <div className="wrap live-hero-wrap">
          <div className="live-hero-content">
            <span className="live-hero-badge">
              Premium B2B Supply Partner
            </span>
            <h1 className="live-hero-title">
              Elevating Excellence in <br />Hospitality &amp; Hygiene.
            </h1>
            <p className="live-hero-lead">
              As a trusted partner and authorized Boutique distributor, we provide premium guest amenities and industrial-grade cleaning solutions tailored for India&apos;s finest hotels, resorts, and corporate institutions.
            </p>
            <div className="live-hero-actions">
              <Link className="live-hero-btn" to="/shop">
                Explore Our Catalog <span>→</span>
              </Link>
              <div className="happy-customers">
                <div className="customers-badge-icon">
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                </div>
                <div>
                  <div className="happy-count">100K+</div>
                  <div className="happy-label">Happy customers</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Categories Section matching Screenshot 4 */}
      <section className="cat-section">
        <div className="wrap">
          <div className="sec-header-center">
            <p className="cat-sec-title">CATEGORIES</p>
          </div>
          <div className="circle-cats-grid">
            {categoriesList.map((c) => (
              <Link key={c.name} className="circle-cat-item" to={`/shop?category=${c.slug}`}>
                <div className="circle-cat-img-box">
                  <img src={c.img} alt={c.name} loading="lazy" />
                </div>
                <p className="circle-cat-label">{c.name}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Best Sellers Section matching Screenshot 4 */}
      <section className="bestsellers-section">
        <div className="wrap">
          <div className="bestsellers-head">
            <h2>Best Sellers</h2>
            <Link to="/shop" className="show-more-btn">Show more</Link>
          </div>
          <div className="bestsellers-grid">
            {featured.map((p) => (
              <ProductCard key={p.id || p.slug} p={p} />
            ))}
          </div>
        </div>
      </section>

      {/* Our Key Benefits Section matching Screenshot 3 */}
      <section className="benefits-section">
        <div className="wrap">
          <h2 className="benefits-title">Our Key Benefits</h2>
          <div className="benefits-grid">
            {keyBenefits.map((b) => (
              <div key={b.title} className="benefit-card">
                <div className="benefit-icon-box">{b.icon}</div>
                <h3 className="benefit-heading">{b.title}</h3>
                <p className="benefit-text">{b.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
