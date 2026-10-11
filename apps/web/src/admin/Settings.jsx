import { useEffect, useState } from "react";
import { api } from "../api.js";
import { Loader, useLoad } from "./hooks.jsx";

export default function Settings() {
  const s = useLoad("/api/admin/settings");
  const [f, setF] = useState(null);
  const [st, setSt] = useState({ busy: false, error: null, saved: false });
  useEffect(() => { if (s.data) setF(s.data); }, [s.data]);
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setSt({ busy: false, error: null, saved: false }); };
  async function save(e) {
    e.preventDefault(); setSt({ busy: true, error: null, saved: false });
    try { await api("/api/admin/settings", { method: "PUT", body: f }); setSt({ busy: false, error: null, saved: true }); } catch (err) { setSt({ busy: false, error: err.message, saved: false }); }
  }
  return (
    <>
      <h1>Company details & prices</h1>
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
          {st.error && <p className="alert" role="alert">{st.error}</p>}{st.saved && <p className="notice" role="status">Saved ✓ (visitors see changes within a minute)</p>}
          <button className="btn" disabled={st.busy}>{st.busy ? "Saving…" : "Save"}</button>
        </form>
      )}</Loader>
    </>
  );
}
