import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { can, useMe } from "./AdminApp.jsx";
import { useLoad } from "./hooks.jsx";
import { posCategory, POS_CATEGORIES } from "./posCategories.js";
import { cashChange } from "./posMath.js";
import { calcTotals, Msg, rs, StateSelect, toPaise, useAction, useAsync, useMeta } from "./ui.jsx";
import { UpiQrModal } from "./UpiQr.jsx";
import { Icon, Photo } from "./visual.jsx";

const RATES = [0, 5, 12, 18, 28];
const NOTES = [50, 100, 200, 500];
const CHIP_ICONS = { all: "all", amenities: "amenity", linen: "linen", dispensers: "dispenser", kits: "kit" };
const EMPTY_BUYER = { name: "", gstin: "", stateCode: "" };
const NEW_PAY = { reference: "", tendered: "", approved: false };
const isPhone = (s) => /^[+\d][\d\s-]{5,}$/.test(s.trim());

function StockPill({ r }) {
  if (!r.stockTracked) return <span className="stock off">Not tracked</span>;
  if (r.available <= 0) return <span className="stock out">Out of stock</span>;
  return <span className={"stock" + (r.available <= r.reorderLevel ? " low" : "")}>In Stock: {r.available.toLocaleString("en-IN")}</span>;
}

/**
 * Touch counter for walk-in buyers and hotel accounts. Keyboard and barcode scanners still work:
 * F2 or / search · Enter adds the best match · ↑ ↓ move between lines · F4 piece → box → carton · Del removes the line · Ctrl+Enter bills.
 */
export default function POS() {
  const me = useMe();
  const customers = useAsync("/api/admin/customers");
  const company = useAsync("/api/admin/settings");
  const [customerId, setCustomerId] = useState("");
  const rates = useLoad(`/api/admin/rates${customerId ? `?customerId=${customerId}` : ""}`);
  const [who, setWho] = useState("");
  const [buyer, setBuyer] = useState(EMPTY_BUYER);
  const [lines, setLines] = useState([]);
  const [q, setQ] = useState("");
  const [chip, setChip] = useState("all");
  const [mode, setMode] = useState("upi");
  const [pay, setPay] = useState(NEW_PAY);
  const [disc, setDisc] = useState("");
  const [pos, setPos] = useState("");
  const [open, setOpen] = useState(null); // line being edited
  const [done, setDone] = useState(null);
  const [qrFor, setQrFor] = useState(null);
  const qrOn = useMeta().channels.payments === "razorpay";
  const [st, run] = useAction();
  const [sendSt, runSend] = useAction();
  const search = useRef(null), qtyRefs = useRef([]);

  const cust = customers.data?.find((c) => c.id === customerId);
  const place = pos || cust?.stateCode || buyer.stateCode || company.data?.stateCode || "";
  const inter = !!company.data && place !== company.data.stateCode;
  const discountPct = Math.min(100, Math.max(0, Number(disc) || 0));
  const billLines = useMemo(() => lines.map((l) => ({ ...l, discountPct })), [lines, discountPct]);
  const t = useMemo(() => calcTotals(billLines, inter), [billLines, inter]);
  const live = useMemo(() => (rates.data || []).filter((r) => r.active !== false), [rates.data]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    const hits = live.filter((r) => posCategory(r, chip) && (!s || `${r.sku} ${r.name}`.toLowerCase().includes(s)));
    return s ? hits.sort((a, b) => (a.sku?.toLowerCase() === s ? -1 : b.sku?.toLowerCase() === s ? 1 : 0)) : hits;
  }, [q, chip, live]);
  const found = useMemo(() => {
    const s = who.trim().toLowerCase(), digits = s.replace(/\D/g, "");
    if (customerId || s.length < 2) return [];
    return (customers.data || []).filter((c) => c.name.toLowerCase().includes(s) || (digits.length > 2 && (c.phone || "").replace(/\D/g, "").includes(digits))).slice(0, 5);
  }, [who, customers.data, customerId]);

  const termsDays = cust?.paymentTermsDays || 0;
  const useQr = mode === "upi" && qrOn && !pay.reference.trim(); // a typed UTR means the money already came another way
  const cash = cashChange(t.total, toPaise(pay.tendered || "0") || 0);
  const unpriced = lines.find((l) => !l.rate);
  const hold = !lines.length ? "" : unpriced ? `Set a price for ${unpriced.name}` : mode === "cash" && cash.short ? "short" : mode === "card" && !pay.approved ? "Confirm the card machine first" : mode === "credit" && !termsDays ? "Choose a customer with credit terms" : "";

  useEffect(() => {
    const key = (e) => {
      if (e.key === "F2" || (e.key === "/" && !["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName))) { e.preventDefault(); search.current?.focus(); }
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); document.getElementById("pos-bill")?.click(); }
    };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => { if (mode === "credit" && !termsDays) setMode("upi"); }, [mode, termsDays]);

  const add = (r) => {
    if (!r) return;
    setLines((ls) => {
      const i = ls.findIndex((l) => l.productId === r.productId && (l.uom || "piece") === "piece");
      if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, qty: Number(l.qty) + 1 } : l));
      return [...ls, { productId: r.productId, sku: r.sku, name: r.name, hsn: r.hsn, unit: r.unit, qty: 1, rate: r.rate || 0, gstRate: RATES.includes(r.gstRate) ? r.gstRate : 18, uom: "piece", perUnit: 1, uoms: r.uoms || [], image: r.image }];
    });
    setQ("");
  };
  const setLine = (i, patch) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const drop = (i) => { setLines((ls) => ls.filter((_, j) => j !== i)); setOpen(null); };
  const step = (i, by) => { const n = (Number(lines[i].qty) || 0) + by; if (n <= 0) drop(i); else setLine(i, { qty: n }); };
  const setUom = (i, uom) => { const l = lines[i], o = l.uoms.find((u) => u.uom === uom); if (o) setLine(i, { uom: o.uom, perUnit: o.perUnit, unit: o.uom === "piece" ? live.find((r) => r.productId === l.productId)?.unit || "pcs" : o.label, rate: o.rate ?? l.rate }); };
  const lineKeys = (i) => (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); (qtyRefs.current[i + 1] || search.current)?.focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); qtyRefs.current[i - 1]?.focus(); }
    if (e.key === "F4") { e.preventDefault(); const l = lines[i], list = l.uoms; if (list.length > 1) setUom(i, list[(list.findIndex((u) => u.uom === l.uom) + 1) % list.length].uom); }
    if (e.key === "Delete") { e.preventDefault(); drop(i); search.current?.focus(); }
  };
  const reset = () => { setLines([]); setBuyer(EMPTY_BUYER); setWho(""); setCustomerId(""); setPos(""); setDisc(""); setPay(NEW_PAY); setOpen(null); rates.reload(); };

  const bill = () => !hold && lines.length > 0 && run(async () => {
    const typed = who.trim(), phone = isPhone(typed) ? typed : "";
    const body = {
      ...(customerId ? { customerId } : { walkIn: { name: buyer.name.trim() || (phone ? "" : typed) || "Walk-in customer", phone, gstin: buyer.gstin, stateCode: buyer.stateCode } }),
      items: billLines.map(({ uoms, image, amount, tax, total, ...l }) => ({ ...l, qty: Number(l.qty) })),
      placeOfSupply: pos, credit: mode === "credit",
      payment: mode === "credit" || useQr ? null : { mode, reference: pay.reference },
    };
    const r = await api("/api/admin/pos/invoice", { method: "POST", body });
    const change = mode === "cash" ? cash.change : 0;
    if (useQr) setQrFor(r.invoice); else setDone({ ...r, change, credit: mode === "credit" });
    reset();
    return r;
  });
  const whatsapp = () => runSend(async () => { await api(`/api/admin/invoices/${done.invoice.id}/send`, { method: "POST" }); }, "Sent to the customer ✓");

  return (
    <>
      <div className="pos">
        <section className="pos-left" aria-label="Products">
          <div className="pos-find"><Icon name="search" />
            <input ref={search} type="search" autoFocus={window.matchMedia?.("(pointer: fine)").matches} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Scan a barcode, or search name or SKU" aria-label="Search product"
              onKeyDown={(e) => { if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) { e.preventDefault(); if (q.trim()) add(shown[0]); } if (e.key === "ArrowDown") { e.preventDefault(); qtyRefs.current[0]?.focus(); } }} />
          </div>
          <div className="pos-chips" role="group" aria-label="Category">
            {POS_CATEGORIES.map((c) => <button key={c.key} type="button" aria-pressed={chip === c.key} onClick={() => setChip(c.key)}><Icon name={CHIP_ICONS[c.key]} />{c.label}</button>)}
          </div>
          <div className="pos-grid">
            {shown.map((r) => (
              <button key={r.productId} type="button" className="pos-card" onClick={() => add(r)} aria-label={`Add ${r.name}`}>
                <Photo src={r.image} />
                <span className="pos-info">
                  <small>{r.sku}</small>
                  <span className="pos-name">{r.name}</span>
                  {r.rate ? <span className="pos-price">{rs(r.rate)}</span> : <span className="pos-price none">No price yet</span>}
                  <span className="pos-row"><StockPill r={r} /><span className="pos-add">+ Add</span></span>
                </span>
              </button>
            ))}
            {rates.data && shown.length === 0 && <p className="muted">No products match.</p>}
            {rates.loading && !rates.data && <p className="muted" role="status">Loading products…</p>}
            {rates.error && <p className="alert" role="alert">{rates.error}</p>}
          </div>
        </section>

        <section className="pos-right" aria-label="Bill">
          {done ? (
            <div className="pos-done" role="status">
              <h2>Bill complete</h2>
              <p>{done.invoice.number}</p>
              <span className="big">{rs(done.invoice.totals.total)}</span>
              <p>{done.credit ? `On credit, due ${done.invoice.dueDate}` : done.payment ? `Paid by ${done.payment.mode}` : "Not paid yet"}</p>
              {done.change > 0 && <p className="pos-change"><span>Change to give</span><span>{rs(done.change)}</span></p>}
              <a className="btn" href={`/doc/invoice/${done.invoice.token}`} target="_blank" rel="noopener noreferrer">Print bill</a>
              {can(me, "invoices") && <button className="btn btn-whatsapp" disabled={sendSt.busy} onClick={whatsapp}>Send on WhatsApp</button>}
              <Msg st={sendSt} />
              <Link className="btn ghost" to={`/admin/invoices/${done.invoice.id}`}>Open invoice</Link>
              <button className="btn green pos-go" onClick={() => { setDone(null); search.current?.focus(); }}>New bill</button>
            </div>
          ) : <>
            {cust ? (
              <div className="pos-chosen"><span><strong>{cust.name}</strong><small>{cust.phone}{termsDays ? ` · ${termsDays} days credit` : ""}</small></span><button className="link" onClick={() => { setCustomerId(""); setWho(""); }}>Change</button></div>
            ) : (
              <div className="pos-who">
                <input value={who} maxLength={160} onChange={(e) => setWho(e.target.value)} placeholder="Customer phone or hotel name (blank = walk-in)" inputMode="search" aria-label="Customer phone or name" />
                {found.length > 0 && <ul>{found.map((c) => <li key={c.id}><button type="button" onClick={() => { setCustomerId(c.id); setWho(""); }}>{c.name}<small>{c.phone}{c.paymentTermsDays ? ` · ${c.paymentTermsDays} days credit` : ""}</small></button></li>)}</ul>}
              </div>
            )}
            <details className="pos-more">
              <summary>GST details ({inter ? "IGST" : "CGST + SGST"})</summary>
              <div className="form">
                {!cust && <><label className="field"><span>Buyer / hotel name</span><input maxLength={160} value={buyer.name} onChange={(e) => setBuyer({ ...buyer, name: e.target.value })} /></label>
                  <label className="field"><span>GSTIN (B2B)</span><input maxLength={15} value={buyer.gstin} onChange={(e) => setBuyer({ ...buyer, gstin: e.target.value.toUpperCase() })} /></label></>}
                <StateSelect label="Place of supply" value={pos} onChange={setPos} />
              </div>
            </details>

            <ul className="pos-cart">
              {lines.length === 0 && <li className="pos-empty">Tap a product to start the bill.</li>}
              {lines.map((l, i) => (
                <li key={`${l.productId}-${l.uom}-${i}`} className="pos-line">
                  <Photo src={l.image} />
                  <span className="pos-line-name">{l.name}</span>
                  <span className="pos-line-amt">{rs(Math.round((Number(l.qty) || 0) * l.rate))}</span>
                  <span className="pos-step">
                    <button type="button" onClick={() => step(i, -1)} aria-label={`One less ${l.name}`}>−</button>
                    <input ref={(el) => (qtyRefs.current[i] = el)} type="number" min="0.001" step="any" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} onKeyDown={lineKeys(i)} aria-label={`Quantity of ${l.name}`} />
                    <button type="button" onClick={() => step(i, 1)} aria-label={`One more ${l.name}`}>+</button>
                  </span>
                  <small className="pos-unit">{rs(l.rate)} / {l.unit}{l.perUnit > 1 ? ` · ${((Number(l.qty) || 0) * l.perUnit).toLocaleString("en-IN")} pcs` : ""}</small>
                  <button type="button" className="link pos-edit-btn" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>{open === i ? "Done" : "Edit"}</button>
                  {open === i && (
                    <div className="pos-edit">
                      <div className="grid2">
                        <label className="field"><span>Rate ₹</span><input inputMode="decimal" defaultValue={l.rate ? l.rate / 100 : ""} key={`${l.uom}-${l.rate}`} onBlur={(e) => { const p = toPaise(e.target.value); if (!Number.isNaN(p)) setLine(i, { rate: p ?? 0 }); }} /></label>
                        {l.uoms.length > 1 && <label className="field"><span>Sell by</span><select value={l.uom} onChange={(e) => setUom(i, e.target.value)}>{l.uoms.map((u) => <option key={u.uom} value={u.uom}>{u.label}</option>)}</select></label>}
                      </div>
                      <span className="seg" role="group" aria-label="GST rate">{RATES.map((g) => <button type="button" key={g} className={l.gstRate === g ? "on" : ""} onClick={() => setLine(i, { gstRate: g })}>{g}%</button>)}</span>
                      <button type="button" className="link danger" onClick={() => drop(i)}>Remove item</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>

            <div className="pos-sum">
              <div><span>Subtotal</span><span>{rs(t.gross)}</span></div>
              <div><span>Discount <input inputMode="decimal" value={disc} onChange={(e) => setDisc(e.target.value)} placeholder="0" aria-label="Discount percent on the whole bill" /> %</span><span>{t.discount ? `−${rs(t.discount)}` : rs(0)}</span></div>
              <div><span>GST</span><span>{rs(t.tax)}</span></div>
              {t.roundOff !== 0 && <div><span>Round-off</span><span>{t.roundOff < 0 ? `−${rs(-t.roundOff)}` : rs(t.roundOff)}</span></div>}
              <div className="grand"><span>Total</span><span>{rs(t.total)}</span></div>
            </div>

            <div className="pos-modes" role="group" aria-label="Payment mode">
              {[["upi", "UPI QR", "pos"], ["cash", "Cash", "cash"], ["card", "Card", "card"], ["credit", "Pay Later", "invoice"]].map(([m, label, icon]) => <button key={m} type="button" aria-pressed={mode === m} disabled={m === "credit" && !termsDays} title={m === "credit" && !termsDays ? "Saved customers with credit terms only" : undefined} onClick={() => { setMode(m); setPay(NEW_PAY); }}><Icon name={icon} size={20} />{label}</button>)}
            </div>
            <div className="pos-pay">
              {mode === "upi" && (qrOn
                ? <details className="pos-more"><summary>A Razorpay QR appears after you bill. Already paid? Enter the UTR</summary><label className="field"><span>UTR</span><input maxLength={100} value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></label></details>
                : <label className="field"><span>UTR / reference (Razorpay QR is not connected)</span><input maxLength={100} value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></label>)}
              {mode === "cash" && <>
                <div className="pos-notes">
                  {NOTES.map((n) => <button key={n} type="button" onClick={() => setPay({ ...pay, tendered: String((Number(pay.tendered) || 0) + n) })}>₹{n}</button>)}
                  <button type="button" onClick={() => setPay({ ...pay, tendered: "" })}>Exact</button>
                </div>
                <label className="field"><span>Cash received ₹ (blank = exact)</span><input inputMode="decimal" value={pay.tendered} onChange={(e) => setPay({ ...pay, tendered: e.target.value })} /></label>
                {cash.change > 0 && <div className="pos-change"><span>Change to give</span><span>{rs(cash.change)}</span></div>}
                {cash.short > 0 && <div className="pos-change short"><span>Still to collect</span><span>{rs(cash.short)}</span></div>}
              </>}
              {mode === "card" && <>
                <label className="pos-check"><input type="checkbox" checked={pay.approved} onChange={(e) => setPay({ ...pay, approved: e.target.checked })} /> Card approved on the machine</label>
                <label className="field"><span>Approval code (optional)</span><input maxLength={100} value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></label>
              </>}
              {mode === "credit" && <p>Billed to {cust?.name} on {termsDays} days credit. Nothing is collected now.</p>}
            </div>

            <Msg st={st} />
            {hold && !cash.short && <p className="pos-change short" role="status">{hold}</p>}
            <button id="pos-bill" className="btn green pos-go" disabled={st.busy || !lines.length || !!hold} onClick={bill}>{st.busy ? "Saving…" : `Complete Bill & Print / WhatsApp${lines.length ? ` · ${rs(t.total)}` : ""}`}</button>
          </>}
        </section>
      </div>
      {qrFor && <UpiQrModal invoice={qrFor} onPaid={() => { setDone({ invoice: qrFor, payment: { mode: "UPI QR" } }); setQrFor(null); }} onCancelled={() => { setDone({ invoice: qrFor, payment: null }); setQrFor(null); }} />}
    </>
  );
}
