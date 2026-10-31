import { useEffect, useState } from "react";
import { api } from "../api.js";
import { Loader, useLoad } from "./hooks.jsx";
import { StateSelect, Msg } from "./ui.jsx";

export default function Settings() {
  const s = useLoad("/api/admin/settings");
  const [f, setF] = useState(null);
  const [st, setSt] = useState({ busy: false, error: null, saved: false });
  useEffect(() => { if (s.data) setF(s.data); }, [s.data]);
  const set = (k) => (e) => { setF({ ...f, [k]: e?.target ? e.target.value : e }); setSt({ busy: false, error: null, saved: false }); };
  const num = (k) => (e) => set(k)(Number(e.target.value) || 0);
  async function brochure(e) {
    const file = e.target.files[0]; e.target.value = "";
    if (!file) return; if (file.size > 2_000_000) return setSt({ busy: false, error: "Brochure is too large (max 2 MB). Compress the PDF first.", saved: false });
    try { const r = await api("/api/admin/media", { method: "POST", raw: { body: file, type: "application/pdf" } }); set("brochureUrl")(r.url); } catch (err) { setSt({ busy: false, error: err.message, saved: false }); }
  }
  async function save(e) {
    e.preventDefault(); setSt({ busy: true, error: null, saved: false });
    try { await api("/api/admin/settings", { method: "PUT", body: f }); setSt({ busy: false, error: null, saved: true }); } catch (err) { setSt({ busy: false, error: err.message, saved: false }); }
  }
  return (
    <>
      <h1>Company, GST & website settings</h1>
      <Loader s={s}>{f && (
        <form className="panel form" onSubmit={save}>
          <label className="check-row"><input type="checkbox" checked={f.showPrices} onChange={(e) => { setF({ ...f, showPrices: e.target.checked }); setSt({ busy: false, error: null, saved: false }); }} /> <span><strong>Show prices on the website</strong><small>Turn off to show “Price on request” everywhere (prices stay saved).</small></span></label>
          <div className="grid2">
            <label className="field"><span>Company name</span><input required value={f.name} onChange={set("name")} /></label>
            <label className="field"><span>Parent company</span><input value={f.legalName} onChange={set("legalName")} /></label>
            <label className="field"><span>Phone</span><input value={f.phone} onChange={set("phone")} /></label>
            <label className="field"><span>WhatsApp (digits, with country code)</span><input value={f.whatsapp} onChange={set("whatsapp")} placeholder="917995444434" inputMode="numeric" /></label>
            <label className="field"><span>Email</span><input type="email" value={f.email} onChange={set("email")} /></label>
            <label className="field"><span>Website</span><input value={f.website} onChange={set("website")} /></label>
          </div>
          <label className="field"><span>Tagline</span><input value={f.tagline} onChange={set("tagline")} /></label>
          <label className="field"><span>Address</span><textarea rows="2" value={f.address} onChange={set("address")} /></label>
          <label className="field"><span>About us (home page)</span><textarea rows="5" value={f.about} onChange={set("about")} /></label>
          <h2>GST & documents</h2>
          <div className="grid2">
            <label className="field"><span>Company GSTIN (printed on quotes and invoices)</span><input maxLength={15} value={f.gstin} onChange={(e) => set("gstin")(e.target.value.toUpperCase())} placeholder="36ABCDE1234F1Z5" /></label>
            <StateSelect value={f.stateCode} onChange={set("stateCode")} allowEmpty={false} label="Company state (same state = CGST + SGST, other = IGST)" />
            <label className="field"><span>Quotes valid for (days)</span><input type="number" min="1" max="365" value={f.quoteValidityDays} onChange={num("quoteValidityDays")} /></label>
            <label className="field"><span>Default payment terms (days)</span><input type="number" min="0" max="365" value={f.paymentTermsDays} onChange={num("paymentTermsDays")} /></label>
            <label className="field"><span>UPI ID (shown on invoices)</span><input maxLength={80} value={f.upiId} onChange={set("upiId")} placeholder="exlmarketing@okicici" /></label>
          </div>
          <label className="field"><span>Bank details (printed on invoices)</span><textarea rows="3" maxLength={500} value={f.bankDetails} onChange={set("bankDetails")} placeholder={"Bank: …\nA/c no: …\nIFSC: …"} /></label>
          <label className="field"><span>Standard quotation terms</span><textarea rows="4" maxLength={3000} value={f.quoteTerms} onChange={set("quoteTerms")} /></label>
          <label className="field"><span>Invoice terms / declaration</span><textarea rows="2" maxLength={3000} value={f.invoiceTerms} onChange={set("invoiceTerms")} /></label>
          <h2>Logistics & Dispatch Warehouse</h2>
          <p className="muted">Default origin for courier pickups (Shadowfax, Porter) and distance/freight calculations.</p>
          <div className="grid2">
            <label className="field"><span>Dispatch Plus Code</span><input value={f.dispatchPlusCode || ""} onChange={set("dispatchPlusCode")} placeholder="F9C3+CC JV Hills, Hyderabad, Telangana" /></label>
            <label className="field"><span>Dispatch PIN Code</span><input inputMode="numeric" maxLength={6} value={f.dispatchPincode || ""} onChange={(e) => set("dispatchPincode")(e.target.value.replace(/\D/g, ""))} placeholder="500084" /></label>
          </div>
          <label className="field"><span>Warehouse Dispatch Address</span><textarea rows="2" value={f.dispatchAddress || ""} onChange={set("dispatchAddress")} placeholder="Eshwar Nilayam, Plot No. 4-1447, Kondapur Golden Tulip Estate, JV Hills, Gachibowli, Hyderabad, Telangana – 500084" /></label>
          <h2>Online shop</h2>
          <p className="muted">Cart and checkout show only for products with a price, while “Show prices” is on. Online payment needs the Razorpay keys and WhatsApp sign-in needs the WhatsApp keys on the server; until then those options stay hidden from buyers.</p>
          {[["shopEnabled", "Cart & checkout", "Buyers can order priced products from the website. Off = quote requests only."],
            ["onlinePayments", "Online payment (Razorpay)", "UPI, cards and net banking at checkout. The GST invoice is raised when the payment arrives."],
            ["payLater", "Pay later", "Order now; the team sends the invoice with bank / UPI details."],
            ["otpLogin", "Sign in with WhatsApp code", "Buyers verify their mobile number with a code on WhatsApp and can see their orders. Off = guest checkout with a phone number."]].map(([k, title, help]) => (
            <label key={k} className="check-row"><input type="checkbox" checked={f[k] !== false} onChange={(e) => { setF({ ...f, [k]: e.target.checked }); setSt({ busy: false, error: null, saved: false }); }} /> <span><strong>{title}</strong><small>{help}</small></span></label>
          ))}
          <h2>Website extras</h2>
          <div className="grid2">
            <label className="field"><span>Google Analytics 4 ID</span><input value={f.ga4Id} onChange={set("ga4Id")} placeholder="G-XXXXXXXXXX" /></label>
            <label className="field"><span>Meta (Facebook/Instagram) Pixel ID</span><input inputMode="numeric" value={f.metaPixelId} onChange={set("metaPixelId")} placeholder="digits only" /></label>
          </div>
          <div className="field"><span>Brochure PDF (download button on the website)</span>
            <div className="btn-row">{f.brochureUrl ? <><a href={f.brochureUrl} target="_blank" rel="noopener noreferrer">Current brochure</a><button type="button" className="link danger" onClick={() => set("brochureUrl")("")}>Remove</button></> : <span className="muted">None</span>}<input type="file" accept="application/pdf" onChange={brochure} /></div></div>
          <Msg st={{ error: st.error, ok: st.saved && "Saved. Visitors see changes within a minute." }} />
          <button className="btn" disabled={st.busy}>{st.busy ? "Saving…" : "Save"}</button>
        </form>
      )}</Loader>
    </>
  );
}
