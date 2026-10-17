import { useState } from "react";
import { api } from "../api.js";
import { getSource, trackLead } from "../track.js";

/** Used on the home page (general enquiry) and on the quote page (with the basket items). */
export default function EnquiryForm({ items = [], onDone, cta = "Send enquiry" }) {
  const [f, setF] = useState({ name: "", company: "", phone: "", email: "", message: "", website: "" });
  const [state, setState] = useState({ busy: false, error: null, field: null });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    if (state.busy) return;
    if (!f.name.trim() || !f.phone.trim()) return setState({ busy: false, error: "Please enter your name and phone number.", field: !f.name.trim() ? "name" : "phone" });
    setState({ busy: true, error: null, field: null });
    try {
      const r = await api("/api/public/enquiries", { method: "POST", body: { ...f, items: items.map(({ productId, qty }) => ({ productId, qty })), source: getSource() } });
      trackLead();
      onDone?.(r.ref, f);
      setF({ name: "", company: "", phone: "", email: "", message: "", website: "" });
      setState({ busy: false, error: null, field: null });
    } catch (err) { setState({ busy: false, error: err.message, field: err.field || null }); }
  }

  const fld = (k, label, props = {}) => (
    <label className={"field" + (state.field === k ? " bad" : "")}>
      <span>{label}</span>
      <input value={f[k]} onChange={set(k)} {...props} aria-invalid={state.field === k} />
    </label>
  );
  return (
    <form className="form" onSubmit={submit} noValidate>
      <div className="grid2">
        {fld("name", "Your name *", { autoComplete: "name", required: true, maxLength: 100 })}
        {fld("company", "Hotel / company", { autoComplete: "organization", maxLength: 120 })}
        {fld("phone", "Phone *", { type: "tel", autoComplete: "tel", inputMode: "tel", required: true, maxLength: 20 })}
        {fld("email", "Email", { type: "email", autoComplete: "email", maxLength: 160 })}
      </div>
      <label className="field"><span>Message</span><textarea rows="4" value={f.message} onChange={set("message")} maxLength={2000} placeholder="Quantities, branding needs, delivery city…" /></label>
      <div className="hp" aria-hidden="true"><label>Website<input tabIndex="-1" autoComplete="off" value={f.website} onChange={set("website")} /></label></div>
      {state.error && <p className="alert" role="alert">{state.error}</p>}
      <button className="btn" disabled={state.busy}>{state.busy ? "Sending…" : cta}</button>
    </form>
  );
}
