import { parseRupees } from "../../../api/src/lib/money.js";
import { calcTotals as exactTotals } from "../../../api/src/lib/gst.js";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, money } from "../api.js";
import { toast } from "./toast.jsx";
import { WhatsAppMessageParser } from "./WhatsAppParser.jsx";
import { InvoiceLinePicker } from "./InvoiceLinePicker.jsx";
import { GstinInput } from "./GstinInput.jsx";
import { Photo, useThumbs } from "./visual.jsx";

/** Shared admin building blocks: look-up data, formatting, pills, modal, timeline, document line editor. */
export const rs = (p) => (p == null ? "—" : money(p));
export const fmtDate = (s) => (s ? new Date(s.length === 10 ? s + "T00:00:00" : s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
export const fmtTime = (s) => (s ? new Date(s).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
export const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
export const toPaise = parseRupees;
export const Pill = ({ s, children }) => <span className={"pill " + s}>{children || s}</span>;

const MetaCtx = createContext(null);
/** States, GST rates, roles and the team list, loaded once for the whole admin. */
export function MetaProvider({ children }) {
  const [meta, setMeta] = useState({ states: [], gstRates: [0, 5, 12, 18, 28], roles: {}, channels: {}, team: [] });
  useEffect(() => { Promise.all([api("/api/admin/meta"), api("/api/admin/team")]).then(([m, team]) => setMeta({ ...m, team })).catch(() => {}); }, []);
  return <MetaCtx.Provider value={meta}>{children}</MetaCtx.Provider>;
}
export const useMeta = () => useContext(MetaCtx);
export const personName = (meta, id) => meta.team.find((t) => t.id === id)?.name || "";

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => { const k = (e) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={"modal-box" + (wide ? " wide" : "")}><div className="row-between"><h2>{title}</h2><button className="link" onClick={onClose} aria-label="Close">✕</button></div>{children}</div>
    </div>
  );
}

export function StateSelect({ value, onChange, label = "State", allowEmpty = true }) {
  const meta = useMeta();
  return <label className="field"><span>{label}</span><select value={value} onChange={(e) => onChange(e.target.value)}>{allowEmpty && <option value="">—</option>}{meta.states.map((s) => <option key={s.code} value={s.code}>{s.code} · {s.name}</option>)}</select></label>;
}
export function PersonSelect({ value, onChange, label = "Assigned to" }) {
  const meta = useMeta();
  return <label className="field"><span>{label}</span><select value={value || ""} onChange={(e) => onChange(e.target.value)}><option value="">Nobody</option>{meta.team.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>;
}

/** Activity timeline with a quick "log a call / note" form and an optional follow-up date. */
export function Timeline({ entity, entityId, items = [], onAdded, followUp = false }) {
  const [f, setF] = useState({ kind: "call", text: "", followUpAt: "" });
  const [err, setErr] = useState(null);
  const add = async (e) => {
    e.preventDefault(); setErr(null);
    try { await api("/api/admin/activities", { method: "POST", body: { entity, entityId, kind: f.kind, text: f.text, ...(followUp && f.followUpAt ? { followUpAt: f.followUpAt } : {}) } }); setF({ kind: "call", text: "", followUpAt: "" }); onAdded?.(); }
    catch (x) { setErr(x.message); }
  };
  return (
    <div className="timeline">
      <form className="tl-form" onSubmit={add}>
        <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} aria-label="Type">{["call", "note", "whatsapp", "email", "meeting", "visit"].map((k) => <option key={k}>{k}</option>)}</select>
        <input required maxLength={2000} placeholder="What happened? e.g. Spoke to purchase manager, wants samples" value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} aria-label="Activity" />
        {followUp && <input type="date" value={f.followUpAt} onChange={(e) => setF({ ...f, followUpAt: e.target.value })} aria-label="Next follow-up" title="Next follow-up date" />}
        <button className="btn small">Log</button>
      </form>
      {err && <p className="alert">{err}</p>}
      <ul>{items.map((a) => <li key={a.id}><span className={"tl-kind " + a.kind}>{a.kind}</span><div><p>{a.text}</p><small>{fmtTime(a.at)} · {a.by}</small></div></li>)}
        {items.length === 0 && <li className="muted">No activity yet.</li>}</ul>
    </div>
  );
}

/** Same GST arithmetic as the server (the server's figures are the ones saved). */
export function calcTotals(items, interState) {
  try { return exactTotals(items.map(it=>({...it,qty:Number(it.qty)||0,rate:it.rate||0,discountPct:Number(it.discountPct)||0,gstRate:Number(it.gstRate)||0})),interState).totals; }
  catch { return { taxable:0,discount:0,tax:0,cgst:0,sgst:0,igst:0,roundOff:0,total:0,invalid:true }; }
}

export function Totals({ t, interState }) {
  return (
    <table className="totals"><tbody>
      {t.discount > 0 && <tr><td>Discount</td><td>−{rs(t.discount)}</td></tr>}
      <tr><td>Taxable value</td><td>{rs(t.taxable)}</td></tr>
      {interState ? <tr><td>IGST</td><td>{rs(t.igst)}</td></tr> : <><tr><td>CGST</td><td>{rs(t.cgst)}</td></tr><tr><td>SGST</td><td>{rs(t.sgst)}</td></tr></>}
      {t.roundOff !== 0 && <tr><td>Round off</td><td>{rs(t.roundOff)}</td></tr>}
      <tr className="grand"><td>Total</td><td>{rs(t.total)}</td></tr>
    </tbody></table>
  );
}

/** Customer + items editor used for quotes, orders and invoices. Calls onSave(body). */
export function DocEditor({ initial, kind, onSave, busy, error, extra }) {
  const meta = useMeta();
  const customers = useAsync("/api/admin/customers");
  const company = useAsync("/api/admin/settings");
  const [f, setF] = useState(() => ({ customerId: "", placeOfSupply: "", notes: "", items: [], ...initial }));
  const [showParser, setShowParser] = useState(false);
  const [showAddCust, setShowAddCust] = useState(false);
  const [newCust, setNewCust] = useState({ name: "", contactName: "", phone: "", email: "", gstin: "", stateCode: "", shippingAddress: "", deliveryPincode: "" });
  const [custBusy, setCustBusy] = useState(false);
  const [custErr, setCustErr] = useState("");
  const rates = useAsync(`/api/admin/rates${f.customerId ? `?customerId=${f.customerId}` : ""}`);
  const thumbs = useThumbs();
  const cust = customers.data?.find((c) => c.id === f.customerId);
  const pos = f.placeOfSupply || cust?.stateCode || company.data?.stateCode || "";
  const inter = !!company.data && pos !== company.data.stateCode;
  const t = useMemo(() => calcTotals(f.items, inter), [f.items, inter]);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const setLine = (i, k, v) => setF((x) => ({ ...x, items: x.items.map((l, j) => (j === i ? { ...l, [k]: v } : l)) }));
  const addProduct = (r) => {
    setF((x) => ({ ...x, items: [...x.items, { productId: r.productId, sku: r.sku, name: r.name, hsn: r.hsn, unit: r.unit, qty: 1, rate: r.rate, discountPct: 0, gstRate: r.gstRate, uom: "piece", perUnit: 1 }] })); setPicking(false);
  };
  const uomsOf = (l) => (l.productId && rates.data?.find((x) => x.productId === l.productId)?.uoms) || [];
  /** Piece / box / carton: the line keeps the ordered unit; the server fixes pieces per unit from the product. */
  const setUom = (i, uom) => setF((x) => ({ ...x, items: x.items.map((l, j) => {
    if (j !== i) return l;
    const o = uomsOf(l).find((u) => u.uom === uom); if (!o) return l;
    const r = rates.data.find((y) => y.productId === l.productId);
    return { ...l, uom, perUnit: o.perUnit, unit: uom === "piece" ? r.unit : o.label, rate: o.rate ?? l.rate };
  }) }));
  const submit = (e) => {
    e.preventDefault();
    onSave({ ...f, items: f.items.map((l) => ({ productId: l.productId || "", sku: l.sku || "", name: l.name, hsn: l.hsn || "", unit: l.unit || "pcs", qty: Number(l.qty), rate: l.rate, discountPct: Number(l.discountPct) || 0, gstRate: Number(l.gstRate),
      uom: l.uom || "piece", perUnit: l.perUnit || 1 })) });
  };
  return (
    <form className="panel form" onSubmit={submit}>
      <div className="grid3">
        <label className="field"><span>Customer *</span><select required value={f.customerId} onChange={(e) => set("customerId", e.target.value)}><option value="">Choose…</option>{customers.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <small style={{ display: "flex", gap: "10px", marginTop: "4px" }}>
            <button type="button" className="link" onClick={() => setShowAddCust(true)}>+ Quick Add Customer</button>
            <Link to="/admin/customers?new=1" target="_blank" rel="noopener noreferrer">Full page ↗</Link>
          </small></label>
        <StateSelect label={`Place of supply (${inter ? "IGST" : "CGST + SGST"})`} value={f.placeOfSupply} onChange={(v) => set("placeOfSupply", v)} />
        {extra?.(f, set)}
      </div>
      {cust && <p className="muted small-print">{cust.contactName} {cust.phone} {cust.gstin && `· GSTIN ${cust.gstin}`} {cust.priceListId && "· special price list applies"}</p>}

      {/* Shared Compact Searchable Product Picker */}
      <div style={{ marginTop: 14, marginBottom: 8 }}>
        <InvoiceLinePicker
          rates={rates.data || []}
          onAddLine={addProduct}
          buttonLabel={kind === "quote" ? "+ Add to Quote" : "+ Add Item"}
          placeholder="🔍 Search products by name, SKU, or HSN (Click/focus for recent & catalog items)"
        />
      </div>

      <div className="tbl-wrap"><table className="tbl lines-tbl">
        <thead><tr><th>Item</th><th>HSN</th><th>Qty</th><th>Unit</th><th>Rate ₹</th><th>Disc %</th><th>GST %</th><th>Amount</th><th></th></tr></thead>
        <tbody>
          {f.items.map((l, i) => {
            const amt = Math.round((Number(l.qty) || 0) * l.rate * (1 - (Number(l.discountPct) || 0) / 100));
            return (
              <tr key={i}>
                <td><span className="line-ph"><Photo src={thumbs[l.productId]} /><span className="grow"><input className="wide" required value={l.name} maxLength={200} onChange={(e) => setLine(i, "name", e.target.value)} aria-label="Item name" />{l.sku && <small>{l.sku}</small>}</span></span></td>
                <td><input className="w-sm" value={l.hsn} maxLength={8} inputMode="numeric" onChange={(e) => setLine(i, "hsn", e.target.value.replace(/\D/g, ""))} aria-label="HSN" /></td>
                <td><input className="w-sm" type="number" min="0.001" step="any" required value={l.qty} onChange={(e) => setLine(i, "qty", e.target.value)} aria-label="Quantity" /></td>
                <td>{uomsOf(l).length > 1
                  ? <><select value={l.uom || "piece"} onChange={(e) => setUom(i, e.target.value)} aria-label="Sell by">{uomsOf(l).map((u) => <option key={u.uom} value={u.uom}>{u.label}</option>)}</select>{(l.perUnit || 1) > 1 && <small>= {((Number(l.qty) || 0) * l.perUnit).toLocaleString("en-IN")} pcs</small>}</>
                  : <input className="w-xs" value={l.unit} maxLength={20} onChange={(e) => setLine(i, "unit", e.target.value)} aria-label="Unit" />}</td>
                <td><RateInput value={l.rate} onChange={(v) => setLine(i, "rate", v)} /></td>
                <td><input className="w-xs" type="number" min="0" max="100" step="any" value={l.discountPct} onChange={(e) => setLine(i, "discountPct", e.target.value)} aria-label="Discount %" /></td>
                <td><select value={l.gstRate} onChange={(e) => setLine(i, "gstRate", Number(e.target.value))} aria-label="GST %">{meta.gstRates.map((g) => <option key={g} value={g}>{g}%</option>)}</select></td>
                <td className="num">{rs(amt)}</td>
                <td><button type="button" className="link danger" onClick={() => set("items", f.items.filter((_, j) => j !== i))} aria-label="Remove line">✕</button></td>
              </tr>
            );
          })}
          {f.items.length === 0 && <tr><td colSpan="9" className="muted">Add products using the search bar above, or click "Paste from WhatsApp" to auto-extract items.</td></tr>}
        </tbody>
      </table></div>
      <div className="btn-row">
        <button type="button" className="btn ghost" onClick={() => set("items", [...f.items, { productId: "", sku: "", name: "", hsn: "", unit: "pcs", qty: 1, rate: 0, discountPct: 0, gstRate: 18 }])}>+ Custom line</button>
        <button type="button" className="btn btn-whatsapp" onClick={() => setShowParser(true)}>📱 Paste from WhatsApp</button>
      </div>
      {showParser && (
        <WhatsAppMessageParser
          catalog={rates.data || []}
          customers={customers.data || []}
          onApply={({ customerId, items }) => {
            if (customerId && !f.customerId) set("customerId", customerId);
            set("items", [...f.items, ...items]);
            setShowParser(false);
          }}
          onClose={() => setShowParser(false)}
        />
      )}
      {showAddCust && (
        <Modal title="Quick add new customer" onClose={() => setShowAddCust(false)}>
          <div className="form" style={{ padding: 0 }}>
            <div className="grid2">
              <label className="field"><span>Company / hotel name *</span><input required minLength={2} maxLength={160} value={newCust.name} onChange={(e) => setNewCust({ ...newCust, name: e.target.value })} autoFocus /></label>
              <label className="field"><span>Contact person</span><input maxLength={100} value={newCust.contactName} onChange={(e) => setNewCust({ ...newCust, contactName: e.target.value })} /></label>
              <label className="field"><span>Phone (WhatsApp) *</span><input required type="tel" maxLength={20} value={newCust.phone} onChange={(e) => setNewCust({ ...newCust, phone: e.target.value })} /></label>
              <label className="field"><span>Email</span><input type="email" maxLength={160} value={newCust.email} onChange={(e) => setNewCust({ ...newCust, email: e.target.value })} /></label>
              <GstinInput
                value={newCust.gstin}
                onChange={(v) => setNewCust({ ...newCust, gstin: v, stateCode: newCust.stateCode || (/^\d{2}/.test(v) ? v.slice(0, 2) : "") })}
                onFetched={(data) => {
                  setNewCust((prev) => ({
                    ...prev,
                    name: prev.name && prev.name.length > 3 ? prev.name : (data.tradeName || data.legalName),
                    stateCode: data.stateCode || prev.stateCode,
                    shippingAddress: prev.shippingAddress || data.address,
                    deliveryPincode: prev.deliveryPincode || data.pincode,
                  }));
                }}
              />
              <StateSelect value={newCust.stateCode} onChange={(v) => setNewCust({ ...newCust, stateCode: v })} label="State" />
            </div>
            <div className="grid2">
              <label className="field"><span>Delivery address *</span><textarea rows={2} required maxLength={380} value={newCust.shippingAddress} onChange={(e) => setNewCust({ ...newCust, shippingAddress: e.target.value })} /></label>
              <label className="field"><span>Delivery PIN code *</span><input required inputMode="numeric" maxLength={6} value={newCust.deliveryPincode} onChange={(e) => setNewCust({ ...newCust, deliveryPincode: e.target.value.replace(/\D/g, "") })} placeholder="e.g. 500084" /></label>
            </div>
            {custErr && <p className="alert" role="alert">{custErr}</p>}
            <button type="button" className="btn" disabled={custBusy || !newCust.name || !newCust.phone} onClick={async () => {
              setCustBusy(true); setCustErr("");
              try {
                const created = await api("/api/admin/customers", { method: "POST", body: newCust });
                await customers.reload?.();
                set("customerId", created.id);
                setShowAddCust(false);
                setNewCust({ name: "", contactName: "", phone: "", email: "", gstin: "", stateCode: "", shippingAddress: "", deliveryPincode: "" });
              } catch (err) {
                setCustErr(err.message);
              } finally {
                setCustBusy(false);
              }
            }}>{custBusy ? "Saving…" : "Save & select customer"}</button>
          </div>
        </Modal>
      )}
      <div className="doc-foot">
        <div className="grow">
          <label className="field"><span>Notes (shown on the document)</span><textarea rows="3" maxLength={2000} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></label>
          {"terms" in f && <label className="field"><span>Terms</span><textarea rows="4" maxLength={3000} value={f.terms} onChange={(e) => set("terms", e.target.value)} placeholder="Leave blank to use the standard terms from Settings" /></label>}
        </div>
        <Totals t={t} interState={inter} />
      </div>
      {error && <p className="alert" role="alert">{error}</p>}
      <div className="btn-row"><button className="btn" disabled={busy || !f.items.length}>{busy ? "Saving…" : "Save"}</button></div>
    </form>
  );
}
function RateInput({ value, onChange }) {
  const [v, setV] = useState(value ? String(value / 100) : "");
  useEffect(() => { if (toPaise(v) !== value) setV(value ? String(value / 100) : ""); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return <input className="w-sm" inputMode="decimal" value={v} onChange={(e) => { setV(e.target.value); const p = toPaise(e.target.value); if (!Number.isNaN(p)) onChange(p ?? 0); }} aria-label="Rate in rupees" />;
}

/** Fetch helper for look-ups (no loading UI). */
export function useAsync(path) {
  const [s, setS] = useState({ data: null, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => { let on = true; api(path).then((data) => on && setS({ data, error: null })).catch((e) => on && setS({ data: null, error: e.message })); return () => { on = false; }; }, [path, tick]);
  return { ...s, reload: () => setTick((t) => t + 1) };
}

/** Simple horizontal bars (no chart library needed). */
export function Bars({ rows, value, label, fmt = rs }) {
  const max = Math.max(1, ...rows.map(value));
  return <ul className="bars">{rows.map((r, i) => <li key={i}><span className="bar-label">{label(r)}</span><span className="bar"><span style={{ width: `${(100 * value(r)) / max}%` }} /></span><span className="bar-val">{fmt(value(r))}</span></li>)}</ul>;
}

/** Runs an action with a busy flag and a message line. */
export function useAction() {
  const [st, setSt] = useState({ busy: false, error: null, ok: null });
  const inFlight=useRef(false);
  const run = async (fn, ok = null) => { if(inFlight.current)return;inFlight.current=true;setSt({ busy: true, error: null, ok: null }); try { const r = await fn(); setSt({ busy: false, error: null, ok }); return r; } catch (e) { setSt({ busy: false, error: e.message, ok: null }); return undefined; } finally {inFlight.current=false;} };
  return [st, run, setSt];
}
/** Result of an action, shown as a floating toast. */
export function Msg({ st }) {
  useEffect(() => { if (st.error) toast(st.error, "error"); }, [st.error]);
  useEffect(() => { if (st.ok) toast(st.ok); }, [st.ok]);
  return null;
}
