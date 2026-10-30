import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import ProductCard from "../components/ProductCard.jsx";
import { useRfq } from "../components/RfqDrawer.jsx";
import SectorTabs from "../components/SectorTabs.jsx";
import Seo from "../components/Seo.jsx";
import { useSite } from "../data.jsx";
import { inSector, SECTORS, sectorOf, spreadByCategory } from "../sectors.js";
import { tiltHandlers } from "../tilt.js";

const categoriesList = [
  { name: "Hotel Guest Amenities", slug: "bio-wet-amenities", img: "/brand/cat-1.png" },
  { name: "Coffee and Beverages", slug: "coffee-beverages", img: "/brand/cat-2.png" },
  { name: "Kits", slug: "kits-baskets", img: "/brand/cat-3.png" },
  { name: "House Keeping & Paper Products", slug: "housekeeping", img: "/brand/cat-4.png" },
  { name: "Eco-Friendly Range", slug: "eco-friendly-range", img: "/brand/cat-1.png" },
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

const sampleBestsellers = [
  {
    id: "sample-1",
    name: "Farm Fresh Bay Leaf & Lemongrass Shampoo 20ml (WB)",
    slug: "farm-fresh-day-leaf-lemongrass-shampoo-20ml-wb",
    category: "bio-wet-amenities",
    collection: "BIO WET AMENITIES",
    shortDescription: "A premium, Ayurvedic-inspired hair cleanser meticulously crafted for the hospitality and...",
    pricePaise: 600,
    unit: "Nos",
    variants: ["20ml"],
    images: ["/brand/farm-fresh-single-bottle.png", "/brand/farm-fresh-tea-tree-bottles.png"],
    stock: "in",
  },
  {
    id: "sample-2",
    name: "Farm Fresh Tea Tree Conditioner 20ml",
    slug: "farm-fresh-tea-tree-conditioner-20ml",
    category: "bio-wet-amenities",
    collection: "BIO WET AMENITIES",
    shortDescription: "Provide your guests with an ultra-refreshing hair care experience with our Farm Fresh Tea Tree...",
    pricePaise: 750,
    unit: "Nos",
    variants: ["20ml"],
    images: ["/brand/farm-fresh-tea-tree-bottles.png"],
    stock: "in",
  },
  {
    id: "sample-3",
    name: "Farm Fresh Ylang Ylang Shower Gel 20ml",
    slug: "farm-fresh-ylang-ylang-shower-gel-20ml",
    category: "bio-wet-amenities",
    collection: "BIO WET AMENITIES",
    shortDescription: "Transform the daily shower into a sensory natural ritual with our Farm Fresh Ylang Ylang shower...",
    pricePaise: 700,
    unit: "Nos",
    variants: ["20ml"],
    images: ["/brand/farm-fresh-tea-tree-bottles.png"],
    stock: "in",
  },
  {
    id: "sample-4",
    name: "Farm Fresh Peppermint Body Lotion 20ml",
    slug: "farm-fresh-peppermint-body-lotion-20ml",
    category: "bio-wet-amenities",
    collection: "BIO WET AMENITIES",
    shortDescription: "Pamper your guests with an instantly reviving skincare experience with our Farm Fresh...",
    pricePaise: 700,
    unit: "Nos",
    variants: ["20ml"],
    images: ["/brand/farm-fresh-tea-tree-bottles.png"],
    stock: "in",
  },
];

const DECK = [
  { title: "Guest amenities", note: "Farm Fresh and Biotique kits", img: "/brand/farm-fresh-tea-tree-bottles.png", to: "/shop?q=amenities" },
  { title: "Hotel linen", note: "Towels, sheets and robes", img: "/catalog/p31-3.jpg", to: "/shop?q=towels" },
  { title: "Dispensers", note: "Refillable pump bottles", img: "/catalog/p20-1.jpg", to: "/shop?q=dispensers" },
];

export default function Home() {
  const { catalog, settings } = useSite();
  const rfq = useRfq();
  const [sector, setSector] = useState(SECTORS[0].key);
  // Showcase the client's exact 4 Best Sellers from Screenshot 4 with guaranteed prices
  const featured = sampleBestsellers.map((s) => {
    const live = catalog.products.find((p) => p.slug === s.slug || p.name === s.name);
    return live ? { ...s, ...live, pricePaise: live.pricePaise ?? s.pricePaise } : s;
  });
  const forSector = useMemo(() => catalog.products.filter((p) => inSector(p, sector)), [catalog, sector]);
  const sec = sectorOf(sector);

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
    <div className="lux">
      <Seo
        title="HaTikvah Care | Elevating Excellence in Hospitality & Hygiene"
        description="As a trusted partner and authorized distributor, we provide premium guest amenities and industrial-grade cleaning solutions tailored for India's finest hotels, resorts, and corporate institutions."
        jsonLd={ld}
      />

      <section className="lux-hero">
        <div className="wrap lux-hero-wrap">
          <div className="lux-hero-copy">
            <h1>Elevating Excellence in Hospitality &amp; Hygiene.</h1>
            <p>
              As a trusted partner and authorized Boutique distributor, we provide premium guest amenities and industrial-grade cleaning solutions tailored for India&apos;s finest hotels, resorts, and corporate institutions.
            </p>
            <div className="lux-hero-actions">
              <Link className="lux-cta" to="/shop">Explore our catalog</Link>
              <button type="button" className="lux-cta quiet" onClick={() => rfq({ mode: "sample" })}>Request samples</button>
            </div>
            <p className="lux-hero-note"><strong>100K+</strong> happy customers</p>
          </div>
          <div className="deck" {...tiltHandlers(7)}>
            <div className="deck-float">
              <div className="deck-stage">
                {DECK.map((c, i) => (
                  <Link key={c.title} className={`deck-card deck-${i}`} to={c.to}>
                    <span className="deck-photo"><img src={c.img} alt="" /></span>
                    <span className="deck-label"><b>{c.title}</b><small>{c.note}</small></span>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="lux-band tint">
        <div className="wrap">
          <h2>Supplied to your kind of property</h2>
          <SectorTabs value={sector} onChange={setSector} />
          <div className="sector-intro">
            <p>{sec.blurb}</p>
            <Link to={`/shop?sector=${sector}`}>See all {forSector.length} products for {sec.label.toLowerCase()}</Link>
          </div>
          <div className="bestsellers-grid">
            {spreadByCategory(forSector, 4).map((p) => <ProductCard key={p.id} p={p} />)}
          </div>
        </div>
      </section>

      <section className="lux-band">
        <div className="wrap">
          <h2>Browse by category</h2>
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

      <section className="lux-band tint">
        <div className="wrap">
          <div className="bestsellers-head">
            <h2>Best Sellers</h2>
            <Link to="/shop">Show more</Link>
          </div>
          <div className="bestsellers-grid">
            {featured.map((p) => (
              <ProductCard key={p.id || p.slug} p={p} />
            ))}
          </div>
        </div>
      </section>

      <section className="lux-band">
        <div className="wrap">
          <h2>Our Key Benefits</h2>
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
    </div>
  );
}
