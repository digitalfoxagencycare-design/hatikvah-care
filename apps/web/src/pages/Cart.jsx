import { Link } from "react-router-dom";
import { money } from "../api.js";
import { minQty, unitLabel, unitPrice } from "../components/ProductCard.jsx";
import Seo from "../components/Seo.jsx";
import { useSite } from "../data.jsx";

/** Cart lines with their tier price. Used by the cart and checkout pages. */
export function useCartLines() {
  const { catalog, basket } = useSite();
  return basket.map((i) => {
    const p = catalog.products.find((x) => x.id === i.productId);
    if (!p) return null;
    const rate = p.pricePaise == null ? null : unitPrice(p, i.qty);
    return { ...i, p, rate, amount: rate == null ? null : rate * i.qty, tax: rate == null ? 0 : Math.round((rate * i.qty * p.gstRate) / 100) };
  }).filter(Boolean);
}

export default function Cart() {
  const { settings, setQty, remove } = useSite();
  const lines = useCartLines();
  const priced = lines.length > 0 && lines.every((l) => l.rate != null);
  const sub = lines.reduce((n, l) => n + (l.amount || 0), 0), gst = lines.reduce((n, l) => n + l.tax, 0);
  const canBuy = priced && settings.shop?.cart;

  return (
    <div className="wrap cart-page">
      <Seo title="Your cart" />
      <h1>Your cart</h1>
      {lines.length === 0 ? (
        <div className="empty"><p>Your cart is empty.</p><Link className="btn" to="/shop">Continue shopping</Link></div>
      ) : (
        <div className="cart-grid">
          <div className="panel">
            <ul className="lines">
              {lines.map(({ p, qty, variant, rate, amount }) => {
                const step = p.packSize || 1, min = minQty(p);
                return (
                  <li key={p.id + variant}>
                    <img src={p.images[0]} alt="" width="64" height="64" />
                    <div className="grow"><Link to={`/product/${p.slug}`}>{p.name}</Link><span className="muted">{[variant, p.pack].filter(Boolean).join(" · ")}</span>
                      <span className="muted">{rate == null ? "Price on request" : `${money(rate)} / ${unitLabel(p)}`}</span></div>
                    <input type="number" min={min} step={step} max="1000000" value={qty} aria-label={`Quantity for ${p.name}`}
                      onChange={(e) => setQty(p.id, Number(e.target.value), variant)} onBlur={(e) => { const n = Math.max(min, Math.round((Number(e.target.value) || min) / step) * step); setQty(p.id, n, variant); }} />
                    <strong className="line-amt">{amount == null ? "—" : money(amount)}</strong>
                    <button className="link danger" onClick={() => remove(p.id, variant)} aria-label={`Remove ${p.name}`}>Remove</button>
                  </li>
                );
              })}
            </ul>
          </div>
          <aside className="panel summary">
            <h2>Summary</h2>
            {priced ? (
              <dl><dt>Subtotal</dt><dd>{money(sub)}</dd><dt>GST (estimate)</dt><dd>{money(gst)}</dd><dt className="tot">Total</dt><dd className="tot">{money(sub + gst)}</dd></dl>
            ) : <p className="muted">Some items have no online price. Send them as a quote request and we will reply with prices and GST.</p>}
            {canBuy && <Link className="btn block" to="/checkout">Proceed to checkout</Link>}
            <Link className={"btn block" + (canBuy ? " ghost" : "")} to="/quote">Request a quote instead</Link>
            <p className="muted small-print">Final GST (CGST + SGST or IGST) is worked out from your delivery state at checkout.</p>
          </aside>
        </div>
      )}
    </div>
  );
}
