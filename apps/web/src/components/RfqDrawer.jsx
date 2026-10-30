import { createContext, useContext, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { useSite } from "../data.jsx";
import { rfqItems, rfqMessage } from "../rfq.js";
import { SECTORS } from "../sectors.js";
import { getSource, trackLead } from "../track.js";

const Ctx = createContext(() => {});
/** open({ mode: "sample" | "rfq", product, sector }) slides the drawer in. */
export const useRfq = () => useContext(Ctx);

export function RfqProvider({ children }) {
  const [req, setReq] = useState(null);
  return <Ctx.Provider value={setReq}>{children}{req && <Drawer req={req} onClose={() => setReq(null)} />}</Ctx.Provider>;
}

const blank = { name: "", company: "", phone: "", email: "", city: "", volume: "", note: "", website: "" };

function Drawer({ req, onClose }) {
  const { catalog, basket } = useSite();
  const ref = useRef(null);
  const [mode, setMode] = useState(req.mode || "rfq");
  const [sector, setSector] = useState(req.sector || "");
  const [f, setF] = useState(blank);
  const [state, setState] = useState({ busy: false, error: null, field: null });
  const [done, setDone] = useState(null);
  const [lines, setLines] = useState(() => {
    const known = (id) => catalog.products.find((p) => p.id === id);
    const fromBasket = basket.filter((b) => known(b.productId)).map((b) => ({ ...b, name: known(b.productId).name }));
    const p = req.product;
    if (!p || fromBasket.some((b) => b.productId === p.id)) return fromBasket;
    return [{ productId: known(p.id) ? p.id : null, qty: 1, name: p.name }, ...fromBasket]; // a showcase product with no catalogue record goes in the message by name
  });
  useEffect(() => { ref.current.showModal(); }, []);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    if (state.busy) return;
    if (!f.name.trim() || !f.phone.trim()) return setState({ busy: false, error: "Enter your name and phone number.", field: !f.name.trim() ? "name" : "phone" });
    setState({ busy: true, error: null, field: null });
    const { name, company, phone, email, website } = f;
    try {
      const r = await api("/api/public/enquiries", { method: "POST", body: { name, company, phone, email, website, items: rfqItems(mode, lines),
        message: rfqMessage({ mode, sector, ...f, names: lines.filter((l) => !l.productId).map((l) => l.name) }), source: getSource() } });
      trackLead();
      setDone({ ref: r.ref, phone });
      setState({ busy: false, error: null, field: null });
    } catch (err) { setState({ busy: false, error: err.message, field: err.field || null }); }
  }

  const fld = (k, label, props = {}) => (
    <label className={"field" + (state.field === k ? " bad" : "")}>
      <span>{label}</span>
      <input value={f[k]} onChange={set(k)} aria-invalid={state.field === k} {...props} />
    </label>
  );
  return (
    <dialog ref={ref} className="rfq" aria-labelledby="rfq-title" onClose={onClose} onClick={(e) => { if (e.target === ref.current) ref.current.close(); }}>
      <div className="rfq-body">
        <div className="rfq-head">
          <h2 id="rfq-title">{mode === "sample" ? "Request samples" : "Request a quote"}</h2>
          <button type="button" className="rfq-x" aria-label="Close" onClick={() => ref.current.close()}>✕</button>
        </div>
        {done ? (
          <div className="rfq-done" role="status">
            <p>Request received. Your reference is <strong>{done.ref}</strong>.</p>
            <p>Our team will call you on {done.phone}.</p>
            <button type="button" className="btn" onClick={() => ref.current.close()}>Close</button>
          </div>
        ) : (
          <form className="form" onSubmit={submit} noValidate>
            <div className="rfq-mode" role="group" aria-label="Request type">
              <button type="button" aria-pressed={mode === "sample"} onClick={() => setMode("sample")}>Samples</button>
              <button type="button" aria-pressed={mode === "rfq"} onClick={() => setMode("rfq")}>Quote</button>
            </div>
            {lines.length > 0 && (
              <ul className="rfq-lines" aria-label="Products in this request">
                {lines.map((l) => <li key={l.productId || l.name}><span>{l.name}</span><button type="button" className="link" aria-label={`Remove ${l.name}`} onClick={() => setLines(lines.filter((x) => x !== l))}>Remove</button></li>)}
              </ul>
            )}
            <label className="field"><span>Your institution</span>
              <select value={sector} onChange={(e) => setSector(e.target.value)}>
                <option value="">Choose one</option>
                {SECTORS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </label>
            <div className="grid2">
              {fld("name", "Your name *", { autoComplete: "name", required: true, maxLength: 100 })}
              {fld("company", "Property / company", { autoComplete: "organization", maxLength: 120 })}
              {fld("phone", "Phone *", { type: "tel", autoComplete: "tel", inputMode: "tel", required: true, maxLength: 20 })}
              {fld("email", "Email", { type: "email", autoComplete: "email", maxLength: 160 })}
              {fld("city", "Delivery city", { autoComplete: "address-level2", maxLength: 80 })}
              {mode === "rfq" && fld("volume", "Expected volume", { maxLength: 80, placeholder: "e.g. 2,000 kits a month" })}
            </div>
            <label className="field"><span>What do you need?</span><textarea rows="3" value={f.note} onChange={set("note")} maxLength={1500} placeholder={mode === "sample" ? "Products or fragrances to try, branding needs" : "Products, sizes, branding, delivery date"} /></label>
            <div className="hp" aria-hidden="true"><label>Website<input tabIndex="-1" autoComplete="off" value={f.website} onChange={set("website")} /></label></div>
            {state.error && <p className="alert" role="alert">{state.error}</p>}
            <button className="btn" disabled={state.busy}>{state.busy ? "Sending…" : mode === "sample" ? "Send sample request" : "Send quote request"}</button>
          </form>
        )}
      </div>
    </dialog>
  );
}
