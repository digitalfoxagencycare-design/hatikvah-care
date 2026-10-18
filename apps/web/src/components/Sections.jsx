import { useState } from "react";
import EnquiryForm from "./EnquiryForm.jsx";
import { useSite } from "../data.jsx";

/** Content-managed blocks shared by the home page and the About / Contact pages (edited in Admin › Website content). */
export function AboutBlock() {
  const { settings } = useSite();
  const h = settings.home;
  return (
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
  );
}

export function ClientsBlock() {
  const h = useSite().settings.home;
  return (
    <>
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
    </>
  );
}

export function FaqBlock() {
  const h = useSite().settings.home;
  if (!h.faq.length) return null;
  return (
    <section className="section tint" id="faq">
      <div className="wrap narrow"><h2>Frequently asked questions</h2>
        {h.faq.map((f, i) => <details key={i} className="faq"><summary>{f.q}</summary><p>{f.a}</p></details>)}
      </div>
    </section>
  );
}

export function ContactBlock() {
  const { settings } = useSite();
  const [sent, setSent] = useState(null);
  return (
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
  );
}
