import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, money } from "../api.js";
import OtpLogin from "../components/OtpLogin.jsx";
import Seo from "../components/Seo.jsx";
import { useSite } from "../data.jsx";
import { useCartLines } from "./Cart.jsx";

export default function Checkout() {
  const { settings, clear } = useSite();
  const shop = settings.shop || {};
  const lines = useCartLines();
  const [me, setMe] = useState(undefined);
  const [f, setF] = useState({ name: "", company: "", phone: "", email: "", gstin: "", address: "", city: "", pincode: "", stateCode: settings.stateCode || "36", notes: "", payment: shop.online ? "online" : "later" });
  const [st, setSt] = useState({ busy: false, error: null, field: null });
  const [done, setDone] = useState(null);
  const placing = useRef(false), attempt = useRef(null);

  useEffect(() => { api("/api/shop/me").then(setMe).catch(() => setMe(null)); }, []);
  useEffect(() => { if (me) setF((x) => ({ ...x, name: x.name || me.name, company: x.company || me.company, email: x.email || me.email, gstin: x.gstin || me.gstin, city: x.city || me.city, stateCode: me.stateCode || x.stateCode })); }, [me]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  if (done) return (
    <div className="wrap narrow checkout"><Seo title="Order placed" />
      <div className="panel success" role="status"><h1>Thank you!</h1><p>Your order <strong>{done.number}</strong> for {money(done.total)} has been placed.</p>
        {done.payError ? <p className="alert">{done.payError}</p> : <p>We will send you the invoice and bank / UPI details on WhatsApp. Pay once you receive it.</p>}
        <div className="btn-row" style={{ justifyContent: "center" }}><Link className="btn" to="/account">My orders</Link><Link className="btn ghost" to="/shop">Continue shopping</Link></div></div>
    </div>
  );
  if (!shop.cart) return <div className="wrap narrow checkout"><Seo title="Checkout" /><div className="empty"><p>Online ordering is not available right now. Please send your list as a quote request.</p><Link className="btn" to="/quote">Request a quote</Link></div></div>;
  if (lines.length === 0) return <div className="wrap narrow checkout"><Seo title="Checkout" /><div className="empty"><p>Your cart is empty.</p><Link className="btn" to="/shop">Shop now</Link></div></div>;
  if (lines.some((l) => l.rate == null)) return <div className="wrap narrow checkout"><Seo title="Checkout" /><div className="empty"><p>Some items in your cart have no online price.</p><Link className="btn" to="/quote">Request a quote</Link></div></div>;
  if (me === undefined) return <div className="center-note">Loading…</div>;
  if (!me && shop.otp) return <div className="wrap narrow checkout"><Seo title="Checkout" /><OtpLogin title="Verify your mobile number to place the order" onDone={setMe} /></div>;

  const sub = lines.reduce((n, l) => n + l.amount, 0), gst = lines.reduce((n, l) => n + l.tax, 0);
  async function place(e) {
    e.preventDefault();
    if (placing.current) return; placing.current = true;
    setSt({ busy: true, error: null, field: null });
    try {
      const body = { ...f, items: lines.map(({ productId, qty, variant }) => ({ productId, qty, variant: variant || "" })) };
      const bytes = new TextEncoder().encode(JSON.stringify(body));
      const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');
      let saved=attempt.current; try { saved=JSON.parse(sessionStorage.getItem('hc_checkout_attempt')) || saved; } catch { /* private browsing */ }
      attempt.current=saved?.fingerprint===fingerprint?saved:{fingerprint,key:crypto.randomUUID()};
      try { sessionStorage.setItem('hc_checkout_attempt',JSON.stringify(attempt.current)); } catch { /* keep in memory */ }
      const r = await api("/api/shop/checkout", { method: "POST", body, idempotencyKey: attempt.current.key });
      try { sessionStorage.removeItem('hc_checkout_attempt'); } catch { /* private browsing */ }
      clear();
      if (r.payUrl) { window.location.assign(r.payUrl); return; }
      setDone({ ...r.order, payError: r.payError });
    } catch (err) { setSt({ busy: false, error: err.message, field: err.field || null }); } finally { placing.current=false; }
  }
  const fld = (k, label, props = {}) => <label className={"field" + (st.field === k ? " bad" : "")}><span>{label}</span><input value={f[k]} onChange={set(k)} aria-invalid={st.field === k} {...props} /></label>;

  return (
    <div className="wrap checkout">
      <Seo title="Checkout" />
      <h1>Checkout</h1>
      <form className="cart-grid" onSubmit={place} noValidate>
        <div className="panel form">
          <h2>Delivery & billing details</h2>
          {me && <p className="muted">Signed in as {me.phone}</p>}
          <div className="grid2">
            {fld("name", "Your name *", { autoComplete: "name", maxLength: 100, required: true })}
            {fld("company", "Hotel / company", { autoComplete: "organization", maxLength: 120 })}
            {!me && fld("phone", "Mobile (WhatsApp) *", { type: "tel", autoComplete: "tel", inputMode: "tel", maxLength: 14, required: true })}
            {fld("email", "Email", { type: "email", autoComplete: "email", maxLength: 160 })}
            {fld("gstin", "GSTIN (for GST input credit)", { maxLength: 15, placeholder: "36ABCDE1234F1Z5", onChange: (e) => setF({ ...f, gstin: e.target.value.toUpperCase() }) })}
          </div>
          <label className={"field" + (st.field === "address" ? " bad" : "")}><span>Delivery address *</span><textarea rows="2" maxLength={400} value={f.address} onChange={set("address")} autoComplete="street-address" /></label>
          <div className="grid3">
            {fld("city", "City *", { autoComplete: "address-level2", maxLength: 80 })}
            {fld("pincode", "PIN code *", { inputMode: "numeric", autoComplete: "postal-code", maxLength: 6 })}
            <label className={"field" + (st.field === "stateCode" ? " bad" : "")}><span>State *</span><select value={f.stateCode} onChange={set("stateCode")}>{(settings.states || []).map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}</select></label>
          </div>
          <label className="field"><span>Order notes</span><textarea rows="2" maxLength={500} value={f.notes} onChange={set("notes")} placeholder="Delivery timings, branding requests…" /></label>
          <h2>Payment</h2>
          <div className="pay-opts">
            {shop.online && <label className={"pay-opt" + (f.payment === "online" ? " on" : "")}><input type="radio" name="payment" checked={f.payment === "online"} onChange={() => setF({ ...f, payment: "online" })} /><span><strong>Pay online</strong><small>UPI, cards, net banking (Razorpay)</small></span></label>}
            {shop.payLater && <label className={"pay-opt" + (f.payment === "later" ? " on" : "")}><input type="radio" name="payment" checked={f.payment === "later"} onChange={() => setF({ ...f, payment: "later" })} /><span><strong>Pay later</strong><small>We confirm the order and send a GST invoice with bank / UPI details</small></span></label>}
          </div>
        </div>
        <aside className="panel summary">
          <h2>Your order</h2>
          <ul className="sum-lines">{lines.map((l) => <li key={l.productId + l.variant}><span>{l.qty.toLocaleString("en-IN")} × {l.p.name}{l.variant ? ` (${l.variant})` : ""}</span><strong>{money(l.amount)}</strong></li>)}</ul>
          <dl><dt>Subtotal</dt><dd>{money(sub)}</dd><dt>GST</dt><dd>{money(gst)}</dd><dt className="tot">Total</dt><dd className="tot">{money(sub + gst)}</dd></dl>
          {st.error && <p className="alert" role="alert">{st.error}</p>}
          <button className="btn block" disabled={st.busy}>{st.busy ? "Placing order…" : f.payment === "online" ? "Place order & pay" : "Place order"}</button>
          <p className="muted small-print">Totals are confirmed on the GST invoice (rounded to the rupee).</p>
        </aside>
      </form>
    </div>
  );
}
