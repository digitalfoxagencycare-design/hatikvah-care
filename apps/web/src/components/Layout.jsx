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
      {settings?.home?.banner?.active && settings.home.banner.text && (
        <div className="banner">{settings.home.banner.link ? (settings.home.banner.link.startsWith("/") ? <Link to={settings.home.banner.link}>{settings.home.banner.text} →</Link> : <a href={settings.home.banner.link} target="_blank" rel="noopener noreferrer">{settings.home.banner.text} →</a>) : settings.home.banner.text}</div>
      )}
      <header className="site-head">
        <div className="wrap head-row">
          <Link to="/" className="brand" aria-label="HaTikvah Care home"><img src="/brand/hatikvah-logo.png" alt="HaTikvah Care" width="100" height="56" /></Link>
          <button className="menu-btn" aria-expanded={open} aria-controls="nav" onClick={() => setOpen(!open)}>{open ? "Close" : "Menu"}</button>
          <nav id="nav" className={open ? "open" : ""}>
            <NavLink to="/" end>Home</NavLink>
            <NavLink to="/catalog">Catalogue</NavLink>
            <a href="/#about">About</a>
            {settings?.home?.faq?.length > 0 && <a href="/#faq">FAQ</a>}
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
            {settings?.brochureUrl && <p><a href={settings.brochureUrl} target="_blank" rel="noopener noreferrer">Download brochure (PDF)</a></p>}
          </div>
        </div>
        {wa && <a className="wa-float" href={wa} target="_blank" rel="noopener noreferrer" aria-label="Chat with us on WhatsApp"><svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><path fill="currentColor" d="M16 3a13 13 0 0 0-11.2 19.6L3 29l6.6-1.7A13 13 0 1 0 16 3Zm0 23.7c-2 0-4-.6-5.7-1.6l-.4-.2-3.9 1 1-3.8-.3-.4A10.7 10.7 0 1 1 16 26.7Zm5.9-8c-.3-.2-1.9-.9-2.2-1s-.5-.2-.7.2-.8 1-1 1.2-.4.2-.7.1a8.8 8.8 0 0 1-4.4-3.8c-.3-.6.3-.5 1-1.7.1-.2 0-.4 0-.5l-1-2.4c-.3-.6-.5-.5-.7-.5h-.6a1.2 1.2 0 0 0-.9.4 3.7 3.7 0 0 0-1.1 2.7 6.4 6.4 0 0 0 1.3 3.4 14.7 14.7 0 0 0 5.6 5c2.1.9 2.9 1 4 .8.6-.1 1.9-.8 2.2-1.5s.3-1.4.2-1.5-.3-.2-.6-.3Z"/></svg></a>}
        <div className="wrap legal">© {new Date().getFullYear()} HaTikvah Care by EXL Marketing. All brand names shown on products belong to their owners.</div>
      </footer>
    </>
  );
}
