import { useState } from "react";
import { Link } from "react-router-dom";
import EnquiryForm from "../components/EnquiryForm.jsx";
import Seo from "../components/Seo.jsx";
import { useSite } from "../data.jsx";

export default function Quote() {
  const { catalog, settings, basket, setQty, remove, clear } = useSite();
  const [done, setDone] = useState(null);
  const lines = basket.map((i) => ({ ...i, p: catalog.products.find((p) => p.id === i.productId) })).filter((l) => l.p);
  const label = (l) => `${l.p.name}${l.variant ? ` (${l.variant})` : ""}`;
  const wa = settings.whatsapp && lines.length ? `https://wa.me/${settings.whatsapp}?text=${encodeURIComponent("Hello HaTikvah Care, please quote for:\n" + lines.map((l) => `• ${l.qty} x ${label(l)} (${l.p.sku})`).join("\n"))}` : null;

  if (done) return (
    <div className="wrap narrow"><Seo title="Quote sent" />
      <div className="success" role="status"><h1>Thank you!</h1><p>Your quote request <strong>{done}</strong> has been received. Our team will contact you shortly with availability and pricing.</p><Link className="btn" to="/shop">Continue browsing</Link></div>
    </div>
  );
  return (
    <div className="wrap quote">
      <Seo title="Request a quote" description="Send your product list to HaTikvah Care and receive a quote." />
      <h1>Request a quote</h1>
      {lines.length === 0 ? (
        <div className="empty"><p>Your quote list is empty. Add products from the catalogue, or send us a message below.</p><Link className="btn" to="/shop">Browse catalogue</Link></div>
      ) : (
        <div className="panel">
          <ul className="lines">
            {lines.map(({ p, qty }) => (
              <li key={p.id}>
                <img src={p.images[0]} alt="" width="64" height="64" />
                <div className="grow"><Link to={`/product/${p.slug}`}>{p.name}</Link><span className="muted">{p.pack}</span></div>
                <input type="number" min="1" max="1000000" value={qty} aria-label={`Quantity for ${p.name}`} onChange={(e) => setQty(p.id, Number(e.target.value))} />
                <button className="link danger" onClick={() => remove(p.id)} aria-label={`Remove ${p.name}`}>Remove</button>
              </li>
            ))}
          </ul>
          <button className="link" onClick={clear}>Clear list</button>
        </div>
      )}
      <div className="panel">
        <h2>Your details</h2>
        <EnquiryForm items={lines} cta="Send quote request" onDone={(ref) => { setDone(ref); clear(); }} />
        {wa && <p className="or">Prefer WhatsApp? <a href={wa} target="_blank" rel="noopener noreferrer">Send this list on WhatsApp</a></p>}
      </div>
    </div>
  );
}
