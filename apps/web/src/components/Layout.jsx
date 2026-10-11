import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useSite } from "../data.jsx";

export default function Layout() {
  const { settings, basket, loading, error, reload } = useSite();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => { setOpen(false); window.scrollTo(0, 0); }, [loc.pathname, loc.search]);
  const count = basket.reduce((n, i) => n + 1, 0);
  const wa = settings?.whatsapp ? `https://wa.me/${settings.whatsapp}?text=${encodeURIComponent("Hello HaTikvah Care, I would like to know more about your products.")}` : null;

  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <header className="site-head">
        <div className="wrap head-row">
          <Link to="/" className="brand" aria-label="HaTikvah Care home"><img src="/brand/hatikvah-logo.png" alt="HaTikvah Care" width="100" height="56" /></Link>
          <button className="menu-btn" aria-expanded={open} aria-controls="nav" onClick={() => setOpen(!open)}>{open ? "Close" : "Menu"}</button>
          <nav id="nav" className={open ? "open" : ""}>
            <NavLink to="/" end>Home</NavLink>
            <NavLink to="/catalog">Catalogue</NavLink>
            <a href="/#about">About</a>
            <a href="/#contact">Contact</a>
            <Link to="/quote" className="btn small quote-btn">Quote list{count > 0 && <span className="badge">{count}</span>}</Link>
          </nav>
        </div>
      </header>
      <main id="main">
        {loading && <div className="center-note" role="status">Loading catalogue…</div>}
        {error && <div className="center-note error" role="alert">{error} <button className="btn small" onClick={reload}>Try again</button></div>}
        {!loading && !error && <Outlet />}
      </main>
      <footer className="site-foot">
        <div className="wrap foot-grid">
          <div>
            <img src="/brand/hatikvah-logo.png" alt="" width="140" height="79" className="foot-logo" />
            <p>{settings?.tagline}</p>
            <p className="muted">A brand by EXL Marketing · Serving the hospitality & tourism industry across India since 2002</p>
          </div>
          <div>
            <h4>Contact</h4>
            <p>{settings?.address}</p>
            {settings?.phone && <p><a href={`tel:${settings.phone.replace(/\s/g, "")}`}>{settings.phone}</a></p>}
            {settings?.email && <p><a href={`mailto:${settings.email}`}>{settings.email}</a></p>}
            {wa && <p><a href={wa} target="_blank" rel="noopener noreferrer">Chat on WhatsApp</a></p>}
          </div>
          <div>
            <h4>Explore</h4>
            <p><Link to="/catalog">Full catalogue</Link></p>
            <p><Link to="/quote">Request a quote</Link></p>
            <p><a href="/#about">About us</a></p>
          </div>
        </div>
        <div className="wrap legal">© {new Date().getFullYear()} HaTikvah Care by EXL Marketing. All brand names shown on products belong to their owners.</div>
      </footer>
    </>
  );
}
