import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useSite } from "../data.jsx";

const UserIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

const BagIcon = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
    <path d="M3 6h18" />
    <path d="M16 10a4 4 0 0 1-8 0" />
  </svg>
);

const SearchIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);

const PhoneIcon = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
  </svg>
);

export default function Layout() {
  const { settings, catalog, basket, loading, error, reload } = useSite();
  const [open, setOpen] = useState(false);
  const [cats, setCats] = useState(false);
  const [q, setQ] = useState("");
  const loc = useLocation(), nav = useNavigate();
  const catsRef = useRef(null);

  useEffect(() => { setOpen(false); setCats(false); window.scrollTo(0, 0); }, [loc.pathname, loc.search]);
  useEffect(() => {
    if (!cats) return;
    const close = (e) => { if (!catsRef.current?.contains(e.target)) setCats(false); };
    document.addEventListener("click", close); return () => document.removeEventListener("click", close);
  }, [cats]);

  const count = basket.length;
  const wa = settings?.whatsapp ? `https://wa.me/${settings.whatsapp}?text=${encodeURIComponent("Hello HaTikvah Care, I would like to know more about your products.")}` : "https://wa.me/917995444434";
  const categories = catalog?.categories.filter((c) => c.count > 0) || [];
  const search = (e) => { e.preventDefault(); nav(q.trim() ? `/shop?q=${encodeURIComponent(q.trim())}` : "/shop"); };

  return (
    <>
      <a className="skip" href="#main">Skip to content</a>

      {/* Top Banner Bar (matching live site) */}
      <div className="top-announcement-bar">
        <div className="top-bar-inner">
          <span className="top-item"><span className="pulse-dot"></span>Eco-Friendly Hotel Supplies</span>
          <span className="top-sep"></span>
          <span className="top-item"><PhoneIcon /> Bulk Enquiries: <a href="tel:+917995444434">+91 7995 444 434</a></span>
        </div>
      </div>

      <header className="site-head">
        <div className="wrap head-row">
          <Link to="/" className="brand" aria-label="HaTikvah Care home">
            <img src="/brand/logo1.png" alt="HaTikvah Care by EXL Marketing" width="160" height="42" />
          </Link>

          <nav id="nav" className={open ? "open" : ""} aria-label="Main">
            <NavLink to="/" end className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}>Home</NavLink>
            <div className="dd" ref={catsRef}>
              <button type="button" className="dd-btn" aria-expanded={cats} aria-haspopup="true" onClick={() => setCats(!cats)}>
                Categories <span className="chevron-icon">⌄</span>
              </button>
              {cats && (
                <div className="dd-menu">
                  {categories.map((c) => (
                    <Link key={c.id} to={`/shop?category=${c.slug}`}>{c.name}<span>{c.count}</span></Link>
                  ))}
                </div>
              )}
            </div>
            <NavLink to="/shop" className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}>Shop</NavLink>
            <NavLink to="/about" className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}>About Us</NavLink>
            <NavLink to="/contact" className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}>Contact Us</NavLink>
          </nav>

          <form className="head-search" role="search" onSubmit={search}>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search hotel supplies, products, and brands..." aria-label="Search products" />
            <button aria-label="Search"><SearchIcon /></button>
          </form>

          <div className="head-icons">
            <Link to="/account" aria-label="My account" className="head-icon-btn"><UserIcon /></Link>
            <Link to="/cart" aria-label={`Cart, ${count} item${count === 1 ? "" : "s"}`} className="cart-link head-icon-btn">
              <BagIcon />
              {count > 0 && <span className="badge">{count}</span>}
            </Link>
            <button className="menu-btn" aria-expanded={open} aria-controls="nav" onClick={() => setOpen(!open)}>
              {open ? "✕" : "☰"}
            </button>
          </div>
        </div>
      </header>

      <main id="main">
        {loading && <div className="center-note" role="status">Loading catalogue…</div>}
        {error && <div className="center-note error" role="alert">{error} <button className="btn small" onClick={reload}>Try again</button></div>}
        {!loading && !error && <Outlet />}
      </main>

      {/* Footer matching exact screenshot 3 */}
      <footer className="site-foot">
        <div className="wrap foot-grid">
          <div className="foot-brand-col">
            <div className="foot-logo-text">HaTikvah Care</div>
            <p className="foot-tagline">Your trusted partner for premium hospitality and industrial hygiene solutions.</p>
            <div className="foot-socials">
              <a href="https://facebook.com" target="_blank" rel="noopener noreferrer" aria-label="Facebook">ⓕ</a>
              <a href="https://instagram.com" target="_blank" rel="noopener noreferrer" aria-label="Instagram">ⓘ</a>
              <a href="https://whatsapp.com" target="_blank" rel="noopener noreferrer" aria-label="WhatsApp">✆</a>
            </div>
          </div>

          <div>
            <h4>QUICK LINKS</h4>
            <p><Link to="/">Home</Link></p>
            <p><Link to="/shop">Shop</Link></p>
            <p><Link to="/about">About Us</Link></p>
            <p><Link to="/contact">Contact Us</Link></p>
          </div>

          <div>
            <h4>CATEGORIES</h4>
            <p><Link to="/shop?category=bio-dry-amenities">Bio Dry Amenities</Link></p>
            <p><Link to="/shop?category=bio-wet-amenities">Bio Wet Amenities</Link></p>
            <p><Link to="/shop?category=non-bio-dry-wet-amenities">Non-Bio Dry &amp; Wet Amenities</Link></p>
            <p><Link to="/shop?category=kits-baskets">Kits &amp; Baskets</Link></p>
            <p><Link to="/shop?category=housekeeping">Housekeeping</Link></p>
            <p><Link to="/shop?category=coffee-beverages">Coffee &amp; Beverages</Link></p>
            <p><Link to="/shop?category=others">Others</Link></p>
          </div>

          <div>
            <h4>CONTACT INFO</h4>
            <p className="contact-line">
              <span className="contact-icon">📍</span>
              <span>Eshwar Nilayam, Plot no 4-1447, Kondapur, Golden Tulip Estate, JV Hills, Gachibowli, Hyderabad, Telangana 500084</span>
            </p>
            <p className="contact-line">
              <span className="contact-icon">📞</span>
              <a href="tel:+917995444434">+91 79954 44434</a>
            </p>
            <p className="contact-line">
              <span className="contact-icon">✉️</span>
              <a href="mailto:hatvikcare@gmail.com">hatvikcare@gmail.com</a>
            </p>
          </div>
        </div>

        <div className="wrap foot-bottom">
          <div className="legal">© {new Date().getFullYear()} HATIKVAH CARE. ALL RIGHTS RESERVED.</div>
          <div className="foot-policies">
            <Link to="/about">PRIVACY POLICY</Link>
            <Link to="/about">TERMS OF SERVICE</Link>
            <Link to="/about">REFUND POLICY</Link>
            <Link to="/about">SHIPPING POLICY</Link>
          </div>
        </div>

        {/* Floating WhatsApp chat widget */}
        <a className="wa-float" href={wa} target="_blank" rel="noopener noreferrer" aria-label="Chat with us on WhatsApp">
          <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true" fill="currentColor">
            <path d="M16 3a13 13 0 0 0-11.2 19.6L3 29l6.6-1.7A13 13 0 1 0 16 3Zm0 23.7c-2 0-4-.6-5.7-1.6l-.4-.2-3.9 1 1-3.8-.3-.4A10.7 10.7 0 1 1 16 26.7Zm5.9-8c-.3-.2-1.9-.9-2.2-1s-.5-.2-.7.2-.8 1-1 1.2-.4.2-.7.1a8.8 8.8 0 0 1-4.4-3.8c-.3-.6.3-.5 1-1.7.1-.2 0-.4 0-.5l-1-2.4c-.3-.6-.5-.5-.7-.5h-.6a1.2 1.2 0 0 0-.9.4 3.7 3.7 0 0 0-1.1 2.7 6.4 6.4 0 0 0 1.3 3.4 14.7 14.7 0 0 0 5.6 5c2.1.9 2.9 1 4 .8.6-.1 1.9-.8 2.2-1.5s.3-1.4.2-1.5-.3-.2-.6-.3Z"/>
          </svg>
        </a>
      </footer>
    </>
  );
}
