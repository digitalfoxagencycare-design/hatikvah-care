import { useEffect, useState } from "react";
import { api } from "../api.js";
import { Loader, useLoad } from "./hooks.jsx";
import { Msg, useAction } from "./ui.jsx";

async function upload(file) {
  if (file.size > 2_000_000) throw new Error("Image is too large (max 2 MB)");
  return (await api("/api/admin/media", { method: "POST", raw: { body: file, type: file.type || "application/octet-stream" } })).url;
}
function ImagePick({ value, onChange, onError }) {
  return <div className="img-pick">{value && <img src={value} alt="" width="120" height="80" />}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={async (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) try { onChange(await upload(f)); } catch (x) { onError(x.message); } }} />{value && <button type="button" className="link danger" onClick={() => onChange("")}>Remove</button>}</div>;
}
/** Edits a list of small objects: fields = [[key, label, type]]. */
function ListEdit({ rows, fields, onChange, add, max, onError }) {
  const set = (i, k, v) => onChange(rows.map((r, j) => (j === i ? (typeof r === "string" ? v : { ...r, [k]: v }) : r)));
  const move = (i, d) => { const n = [...rows]; [n[i], n[i + d]] = [n[i + d], n[i]]; onChange(n); };
  return (
    <div className="list-edit">
      {rows.map((r, i) => (
        <div key={i} className="list-row">
          {fields.map(([k, label, type]) => type === "image" ? <ImagePick key={k} value={r[k]} onChange={(v) => set(i, k, v)} onError={onError} />
            : type === "area" ? <textarea key={k} rows="2" placeholder={label} value={r[k]} onChange={(e) => set(i, k, e.target.value)} aria-label={label} />
            : <input key={k} placeholder={label} value={typeof r === "string" ? r : r[k]} onChange={(e) => set(i, k, e.target.value)} aria-label={label} />)}
          <span className="btn-row">{i > 0 && <button type="button" className="link" onClick={() => move(i, -1)} aria-label="Move up">↑</button>}<button type="button" className="link danger" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label="Remove">✕</button></span>
        </div>
      ))}
      {rows.length < max && <button type="button" className="btn ghost small" onClick={() => onChange([...rows, add])}>+ Add</button>}
    </div>
  );
}

export default function Content() {
  const s = useLoad("/api/admin/content/home");
  const [f, setF] = useState(null);
  const [st, run, setSt] = useAction();
  useEffect(() => { if (s.data) setF(s.data); }, [s.data]);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const setIn = (k, kk, v) => setF((x) => ({ ...x, [k]: { ...x[k], [kk]: v } }));
  const err = (m) => setSt({ busy: false, error: m, ok: null });
  return (
    <>
      <div className="row-between"><h1>Website content</h1><a className="btn ghost" href="/" target="_blank" rel="noopener noreferrer">View website ↗</a></div>
      <p className="muted">Edit the home page without a developer. Changes appear on the website within a minute. Company details, phone and address are in “Company & GST”.</p>
      <Loader s={s}>{f && (
        <form className="form" onSubmit={(e) => { e.preventDefault(); run(() => api("/api/admin/content/home", { method: "PUT", body: f }), "Saved ✓ (visible on the website within a minute)"); }}>
          <div className="panel form"><h2>Top banner (announcement)</h2>
            <label className="check-row"><input type="checkbox" checked={f.banner.active} onChange={(e) => setIn("banner", "active", e.target.checked)} /><span>Show a banner at the top of every page</span></label>
            <div className="grid2"><label className="field"><span>Text</span><input maxLength={200} value={f.banner.text} onChange={(e) => setIn("banner", "text", e.target.value)} placeholder="Diwali gift hampers now available — ask for a quote" /></label>
              <label className="field"><span>Link (optional)</span><input maxLength={200} value={f.banner.link} onChange={(e) => setIn("banner", "link", e.target.value)} placeholder="/catalog?category=… or https://…" /></label></div>
          </div>
          <div className="panel form"><h2>Hero (first screen)</h2>
            <div className="grid2">
              <label className="field"><span>Small heading</span><input maxLength={100} value={f.hero.eyebrow} onChange={(e) => setIn("hero", "eyebrow", e.target.value)} /></label>
              <label className="field"><span>Main heading *</span><input required minLength={3} maxLength={140} value={f.hero.title} onChange={(e) => setIn("hero", "title", e.target.value)} /></label>
              <label className="field"><span>Button 1 text</span><input maxLength={40} value={f.hero.cta} onChange={(e) => setIn("hero", "cta", e.target.value)} /></label>
              <label className="field"><span>Button 2 text</span><input maxLength={40} value={f.hero.cta2} onChange={(e) => setIn("hero", "cta2", e.target.value)} /></label>
            </div>
            <label className="field"><span>Intro text</span><textarea rows="3" maxLength={500} value={f.hero.lead} onChange={(e) => setIn("hero", "lead", e.target.value)} /></label>
            <div className="field"><span>Hero image (wide photo, under 2 MB)</span><ImagePick value={f.hero.image} onChange={(v) => setIn("hero", "image", v)} onError={err} /></div>
          </div>
          <div className="panel form"><h2>Numbers strip</h2><ListEdit rows={f.stats} max={6} add={{ value: "", label: "" }} onChange={(v) => set("stats", v)} fields={[["value", "Big text e.g. 500+"], ["label", "Small text e.g. Hotels served"]]} /></div>
          <div className="panel form"><h2>Why choose us</h2><ListEdit rows={f.why} max={12} add={{ title: "", text: "" }} onChange={(v) => set("why", v)} fields={[["title", "Point"], ["text", "Explanation"]]} /></div>
          <div className="panel form"><h2>We serve</h2><ListEdit rows={f.serve} max={20} add="" onChange={(v) => set("serve", v)} fields={[["v", "e.g. Hotels"]]} /></div>
          <div className="panel form"><h2>Client logos</h2><ListEdit rows={f.clients} max={30} add={{ name: "", logo: "" }} onChange={(v) => set("clients", v)} onError={err} fields={[["name", "Client name"], ["logo", "Logo", "image"]]} /></div>
          <div className="panel form"><h2>Testimonials</h2><ListEdit rows={f.testimonials} max={12} add={{ quote: "", name: "", role: "" }} onChange={(v) => set("testimonials", v)} fields={[["quote", "What they said", "area"], ["name", "Name"], ["role", "Role, hotel"]]} /></div>
          <div className="panel form"><h2>Frequently asked questions</h2><ListEdit rows={f.faq} max={30} add={{ q: "", a: "" }} onChange={(v) => set("faq", v)} fields={[["q", "Question"], ["a", "Answer", "area"]]} /></div>
          <div className="sticky-save"><Msg st={st} /><button className="btn" disabled={st.busy}>{st.busy ? "Saving…" : "Save website content"}</button></div>
        </form>
      )}</Loader>
    </>
  );
}
