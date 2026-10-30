import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { calcTotals, Msg, rs, StateSelect, toPaise, Totals, useAction, useAsync } from "./ui.jsx";

const RATES = [0, 5, 12, 18];
const EMPTY_BUYER = { name: "", phone: "", gstin: "", stateCode: "" };

/**
 * Counter billing for walk-in buyers. Keyboard: F2 or / search · Enter adds the best match · ↑ ↓ move between lines ·
 * F4 piece → box → carton · Del removes the line · Ctrl+Enter makes the invoice.
 */
export default function POS() {
  const customers = useAsync("/api/admin/customers");
  const company = useAsync("/api/admin/settings");
  const [customerId, setCustomerId] = useState("");
  const rates = useAsync(`/api/admin/rates${customerId ? `?customerId=${customerId}` : ""}`);
  const [buyer, setBuyer] = useState(EMPTY_BUYER);
  const [lines, setLines] = useState([]);
  const [q, setQ] = useState("");
  const [pay, setPay] = useState({ mode: "cash", reference: "", collect: true });
  const [pos, setPos] = useState("");
  const [done, setDone] = useState(null);
  const [st, run] = useAction();
  const search = useRef(null), qtyRefs = useRef([]);

  const cust = customers.data?.find((c) => c.id === customerId);
  const place = pos || cust?.stateCode || buyer.stateCode || company.data?.stateCode || "";
  const inter = !!company.data && place !== company.data.stateCode;
  const t = useMemo(() => calcTotals(lines, inter), [lines, inter]);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase(); if (!s) return [];
    return (rates.data || []).filter((r) => r.active !== false && `${r.sku} ${r.name}`.toLowerCase().includes(s)).sort((a, b) => (a.sku?.toLowerCase() === s ? -1 : b.sku?.toLowerCase() === s ? 1 : 0)).slice(0, 8);
  }, [q, rates.data]);

  useEffect(() => {
    const key = (e) => {
      if (e.key === "F2" || (e.key === "/" && !["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName))) { e.preventDefault(); search.current?.focus(); }
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); document.getElementById("pos-bill")?.click(); }
    };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  }, []);

  const add = (r) => {
    if (!r) return;
    const same = lines.findIndex((l) => l.productId === r.productId && (l.uom || "piece") === "piece");
    setLines((ls) => {
      const i = ls.findIndex((l) => l.productId === r.productId && (l.uom || "piece") === "piece");
      if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, qty: Number(l.qty) + 1 } : l));
      return [...ls, { productId: r.productId, sku: r.sku, name: r.name, hsn: r.hsn, unit: r.unit, qty: 1, rate: r.rate, discountPct: 0, gstRate: RATES.includes(r.gstRate) ? r.gstRate : 18, uom: "piece", perUnit: 1, uoms: r.uoms || [] }];
    });
    setQ(""); setTimeout(() => qtyRefs.current[same >= 0 ? same : lines.length]?.focus(), 0);
  };
  const setLine = (i, patch) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const cycleUom = (i) => {
    const l = lines[i], list = l.uoms || []; if (list.length < 2) return;
    const o = list[(list.findIndex((u) => u.uom === l.uom) + 1) % list.length];
    setLine(i, { uom: o.uom, perUnit: o.perUnit, unit: o.uom === "piece" ? rates.data.find((r) => r.productId === l.productId)?.unit || "pcs" : o.label, rate: o.rate ?? l.rate });
  };
  const lineKeys = (i) => (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); (qtyRefs.current[i + 1] || search.current)?.focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); qtyRefs.current[i - 1]?.focus(); }
    if (e.key === "F4") { e.preventDefault(); cycleUom(i); }
    if (e.key === "Delete") { e.preventDefault(); setLines((ls) => ls.filter((_, j) => j !== i)); search.current?.focus(); }
  };

  const bill = () => run(async () => {
    const body = {
      ...(customerId ? { customerId } : { walkIn: { name: buyer.name.trim() || "Walk-in customer", phone: buyer.phone, gstin: buyer.gstin, stateCode: buyer.stateCode } }),
      items: lines.map(({ uoms, amount, tax, total, ...l }) => ({ ...l, qty: Number(l.qty), discountPct: Number(l.discountPct) || 0 })),
      placeOfSupply: pos, payment: pay.collect ? { mode: pay.mode, reference: pay.reference } : null,
    };
    const r = await api("/api/admin/pos/invoice", { method: "POST", body });
    setDone(r); setLines([]); setBuyer(EMPTY_BUYER); setCustomerId(""); setPay({ ...pay, reference: "" });
    setTimeout(() => search.current?.focus(), 0);
    return r;
  }, "Invoice created ✓");

  return (
    <>
      <div className="row-between"><h1>Counter billing</h1><small className="muted">F2 search · Enter add · ↑↓ lines · F4 piece/box/carton · Del remove · Ctrl+Enter bill</small></div>
      {done && <p className="notice">Invoice <strong>{done.invoice.number}</strong> for {rs(done.invoice.totals.total)} {done.payment ? `paid by ${done.payment.mode}` : "on credit"}. <a href={`/doc/invoice/${done.invoice.token}`} target="_blank" rel="noopener noreferrer">Print</a> · <Link to={`/admin/invoices/${done.invoice.id}`}>Open</Link></p>}
      <div className="panel form">
        <div className="grid3">
          <label className="field"><span>Customer (blank = walk-in)</span><select value={customerId} onChange={(e) => setCustomerId(e.target.value)}><option value="">Walk-in buyer</option>{customers.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          {!customerId && <>
            <label className="field"><span>Buyer / hotel name</span><input maxLength={160} value={buyer.name} onChange={(e) => setBuyer({ ...buyer, name: e.target.value })} placeholder="Walk-in customer" /></label>
            <label className="field"><span>Mobile (saves the customer)</span><input inputMode="tel" maxLength={20} value={buyer.phone} onChange={(e) => setBuyer({ ...buyer, phone: e.target.value })} /></label>
            <label className="field"><span>GSTIN (B2B)</span><input maxLength={15} value={buyer.gstin} onChange={(e) => setBuyer({ ...buyer, gstin: e.target.value.toUpperCase() })} /></label>
          </>}
          <StateSelect label={`Place of supply (${inter ? "IGST" : "CGST + SGST"})`} value={pos} onChange={setPos} />
        </div>
        <div className="pos-search">
          <input ref={search} autoFocus className="grow" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Scan or type SKU / product name, Enter to add" aria-label="Search product"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(matches[0]); } if (e.key === "ArrowDown") { e.preventDefault(); qtyRefs.current[0]?.focus(); } }} />
          {matches.length > 0 && <ul className="pos-matches">{matches.map((r) => <li key={r.productId}><button type="button" onClick={() => add(r)}><strong>{r.sku}</strong> {r.name} <small>{r.pack}{r.rate ? ` · ${rs(r.rate)}` : ""}</small></button></li>)}</ul>}
        </div>
        <div className="tbl-wrap"><table className="tbl lines-tbl">
          <thead><tr><th>Item</th><th>Qty</th><th>Sell by</th><th>Rate ₹</th><th>GST</th><th className="num">Amount</th><th></th></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td><strong>{l.name}</strong><small>{l.sku}</small></td>
                <td><input ref={(el) => (qtyRefs.current[i] = el)} className="w-sm" type="number" min="0.001" step="any" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} onKeyDown={lineKeys(i)} aria-label={`Quantity of ${l.name}`} /></td>
                <td>{l.uoms.length > 1 ? <select value={l.uom} onChange={(e) => { const o = l.uoms.find((u) => u.uom === e.target.value); setLine(i, { uom: o.uom, perUnit: o.perUnit, unit: o.uom === "piece" ? l.unit : o.label, rate: o.rate ?? l.rate }); }} aria-label="Sell by">{l.uoms.map((u) => <option key={u.uom} value={u.uom}>{u.label}</option>)}</select> : l.unit}
                  {l.perUnit > 1 && <small>= {((Number(l.qty) || 0) * l.perUnit).toLocaleString("en-IN")} pcs</small>}</td>
                <td><input className="w-sm" inputMode="decimal" defaultValue={l.rate / 100} key={`${l.uom}-${l.rate}`} onBlur={(e) => { const p = toPaise(e.target.value); if (!Number.isNaN(p)) setLine(i, { rate: p ?? 0 }); }} aria-label="Rate in rupees" /></td>
                <td><span className="seg" role="group" aria-label="GST rate">{RATES.map((g) => <button type="button" key={g} className={l.gstRate === g ? "on" : ""} onClick={() => setLine(i, { gstRate: g })}>{g}%</button>)}</span></td>
                <td className="num">{rs(Math.round((Number(l.qty) || 0) * l.rate))}</td>
                <td><button type="button" className="link danger" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Remove line">✕</button></td>
              </tr>
            ))}
            {lines.length === 0 && <tr><td colSpan="7" className="muted">Scan a barcode or type a product to start the bill.</td></tr>}
          </tbody>
        </table></div>
        <div className="doc-foot">
          <div className="grow">
            <div className="grid3">
              <label className="checks"><input type="checkbox" checked={pay.collect} onChange={(e) => setPay({ ...pay, collect: e.target.checked })} /> Payment received now</label>
              {pay.collect && <label className="field"><span>Mode</span><select value={pay.mode} onChange={(e) => setPay({ ...pay, mode: e.target.value })}>{["cash", "upi", "card", "bank", "cheque"].map((m) => <option key={m}>{m}</option>)}</select></label>}
              {pay.collect && pay.mode !== "cash" && <label className="field"><span>UTR / reference</span><input maxLength={100} value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></label>}
            </div>
            <Msg st={st} />
            <button id="pos-bill" className="btn" disabled={st.busy || !lines.length} onClick={bill}>{st.busy ? "Saving…" : `Make tax invoice ${lines.length ? rs(t.total) : ""}`}</button>
          </div>
          <Totals t={t} interState={inter} />
        </div>
      </div>
    </>
  );
}
