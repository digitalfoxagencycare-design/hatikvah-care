import { useEffect, useState } from "react";
import { api } from "../api.js";
import { calcTotals, Modal, Msg, rs, StateSelect, toPaise, Totals, useAction, useAsync } from "./ui.jsx";

const digits10 = (phone) => String(phone || "").replace(/\D/g, "").slice(-10);
const pinOf = (address) => (String(address).match(/\b\d{6}\b/g) || []).pop() || "";

/** Direct booking: enquiry → customer → confirmed sales order (which holds the stock) → WhatsApp receipt, in one request. */
export default function BookingModal({ enquiry: e, onBooked, onClose }) {
  const customers = useAsync("/api/admin/customers");
  const company = useAsync("/api/admin/settings");
  const [picked, setPicked] = useState(null); // null follows the phone match; "" is a new customer
  const matched = e.customerId || customers.data?.find((c) => c.phone && digits10(c.phone) === digits10(e.phone))?.id || "";
  const customerId = picked ?? matched;
  const cust = customers.data?.find((c) => c.id === customerId);
  const rates = useAsync(`/api/admin/rates${customerId ? `?customerId=${customerId}` : ""}`);
  const [buyer, setBuyer] = useState({ name: e.company || e.name, contactName: e.name, phone: e.phone, email: e.email || "", gstin: "", stateCode: "" });
  const [lines, setLines] = useState(() => e.items.map((i) => ({ productId: i.productId, sku: i.sku, name: i.name, qty: i.qty, rate: null, rateTyped: false })));
  const [typedAddress, setTypedAddress] = useState(null);
  const [typedPin, setTypedPin] = useState(null);
  const [pos, setPos] = useState("");
  const [extra, setExtra] = useState({ expectedDate: "", poNumber: "", notes: "", notifyWhatsApp: true });
  const [pinCheck, setPinCheck] = useState(null);
  const [st, run] = useAction();

  const address = typedAddress ?? (cust?.shippingAddress || cust?.billingAddress || "");
  const pin = typedPin ?? pinOf(address);
  const place = pos || cust?.stateCode || buyer.stateCode || buyer.gstin.slice(0, 2) || company.data?.stateCode || "";
  const inter = !!company.data && place !== company.data.stateCode;
  const t = calcTotals(lines, inter);
  const rateOf = (id) => rates.data?.find((r) => r.productId === id);
  const missing = lines.find((l) => l.rate == null);

  // Rates follow the chosen customer's price list. A blank rate means "price on request": staff must type one, so nothing is sold for free by accident.
  useEffect(() => {
    if (!rates.data) return;
    setLines((ls) => ls.map((l) => {
      const r = rates.data.find((x) => x.productId === l.productId);
      return r ? { ...l, hsn: r.hsn, unit: r.unit, gstRate: l.gstRate ?? r.gstRate, rate: l.rateTyped ? l.rate : r.rate || null } : l;
    }));
  }, [rates.data]);

  useEffect(() => {
    if (!/^\d{6}$/.test(pin)) { setPinCheck(null); return; }
    let on = true;
    setPinCheck({ checking: true });
    api(`/api/admin/logistics/serviceability?pincode=${pin}`).then((r) => on && setPinCheck(r)).catch((err) => on && setPinCheck({ error: err.message }));
    return () => { on = false; };
  }, [pin]);

  const setLine = (i, patch) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const add = (id) => {
    const r = rateOf(id); if (!r) return;
    setLines((ls) => [...ls, { productId: r.productId, sku: r.sku, name: r.name, hsn: r.hsn, unit: r.unit, gstRate: r.gstRate, qty: 1, rate: r.rate || null, rateTyped: false }]);
  };
  const book = () => run(async () => {
    const out = await api(`/api/admin/enquiries/${e.id}/book`, { method: "POST", body: {
      ...(customerId ? { customerId } : { customer: buyer }),
      items: lines.map((l) => ({ productId: l.productId, sku: l.sku || "", name: l.name, hsn: l.hsn || "", unit: l.unit || "pcs", qty: Number(l.qty), rate: l.rate, gstRate: l.gstRate ?? 18 })),
      deliveryAddress: address.trim(), pincode: pin, placeOfSupply: pos, ...extra,
    } });
    onBooked(out);
  });

  return (
    <Modal wide title={`Book order from ${e.ref}`} onClose={onClose}>
      <form className="form" onSubmit={(ev) => { ev.preventDefault(); book(); }}>
        <div className="grid2">
          <label className="field"><span>Customer{matched && picked === null ? " (matched by phone)" : ""}</span>
            <select value={customerId} onChange={(ev) => setPicked(ev.target.value)}><option value="">New customer</option>{customers.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <StateSelect label={`Place of supply (${inter ? "IGST" : "CGST + SGST"})`} value={pos} onChange={setPos} />
        </div>
        {!customerId && <div className="grid3">
          <label className="field"><span>Hotel / company name</span><input required minLength={2} maxLength={160} value={buyer.name} onChange={(ev) => setBuyer({ ...buyer, name: ev.target.value })} /></label>
          <label className="field"><span>Contact person</span><input maxLength={100} value={buyer.contactName} onChange={(ev) => setBuyer({ ...buyer, contactName: ev.target.value })} /></label>
          <label className="field"><span>Mobile</span><input inputMode="tel" maxLength={20} value={buyer.phone} onChange={(ev) => setBuyer({ ...buyer, phone: ev.target.value })} /></label>
          <label className="field"><span>Email</span><input type="email" maxLength={160} value={buyer.email} onChange={(ev) => setBuyer({ ...buyer, email: ev.target.value })} /></label>
          <label className="field"><span>GSTIN</span><input maxLength={15} value={buyer.gstin} onChange={(ev) => setBuyer({ ...buyer, gstin: ev.target.value.toUpperCase() })} /></label>
          <StateSelect value={buyer.stateCode} onChange={(v) => setBuyer({ ...buyer, stateCode: v })} />
        </div>}
        <div className="grid2">
          <label className="field"><span>Delivery address</span><textarea rows="2" required minLength={5} maxLength={380} value={address} onChange={(ev) => setTypedAddress(ev.target.value)} /></label>
          <label className="field"><span>Delivery PIN</span><input inputMode="numeric" maxLength={6} value={pin} onChange={(ev) => setTypedPin(ev.target.value.replace(/\D/g, ""))} />
            {pinCheck && <small className={pinCheck.serviceable === false ? "due" : "notice"} role="status" style={{ display: "block", marginTop: "4px" }}>{pinCheck.checking ? "Checking Shadowfax Dale 360…" : pinCheck.error ? `PIN check unavailable: ${pinCheck.error}` : pinCheck.serviceable ? `✓ Shadowfax Dale 360 delivers to PIN ${pin} · Est. Courier Freight: ~₹65.00 (Auto-deducted from Shipping Wallet upon dispatch)` : "Shadowfax does not serve this PIN. You can still book and use another transporter."}</small>}</label>
        </div>
        <div className="tbl-wrap"><table className="tbl lines-tbl">
          <thead><tr><th>Item</th><th>Qty (pcs)</th><th>Rate ₹</th><th>GST</th><th className="num">Amount</th><th></th></tr></thead>
          <tbody>
            {lines.map((l, i) => {
              const r = rateOf(l.productId), short = r?.stockTracked && Number(l.qty) > r.available;
              return (
                <tr key={l.productId + i}>
                  <td><strong>{l.name}</strong><small>{l.sku}</small>{r?.stockTracked && <small className={short ? "due" : ""}>{short ? `Only ${r.available.toLocaleString("en-IN")} available` : `${r.available.toLocaleString("en-IN")} available`}</small>}</td>
                  <td><input className="w-sm" type="number" min="1" step="any" required value={l.qty} onChange={(ev) => setLine(i, { qty: ev.target.value })} aria-label={`Quantity of ${l.name}`} /></td>
                  <td><input className="w-sm" inputMode="decimal" defaultValue={l.rate == null ? "" : l.rate / 100} key={`${l.rate}`} onBlur={(ev) => { const p = toPaise(ev.target.value); if (!Number.isNaN(p)) setLine(i, { rate: p, rateTyped: true }); }} aria-label={`Rate of ${l.name} in rupees`} /></td>
                  <td>{l.gstRate ?? "—"}%</td>
                  <td className="num">{rs(Math.round((Number(l.qty) || 0) * (l.rate || 0)))}</td>
                  <td><button type="button" className="link danger" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label={`Remove ${l.name}`}>✕</button></td>
                </tr>
              );
            })}
            {lines.length === 0 && <tr><td colSpan="6" className="muted">No products on this enquiry yet. Add them below.</td></tr>}
          </tbody>
        </table></div>
        <label className="field"><span>Add a product</span><select value="" onChange={(ev) => add(ev.target.value)}><option value="">Choose a product…</option>{rates.data?.filter((r) => r.active !== false && !lines.some((l) => l.productId === r.productId)).map((r) => <option key={r.productId} value={r.productId}>{r.sku} · {r.name}</option>)}</select></label>
        <div className="grid3">
          <label className="field"><span>Expected delivery</span><input type="date" value={extra.expectedDate} onChange={(ev) => setExtra({ ...extra, expectedDate: ev.target.value })} /></label>
          <label className="field"><span>Customer PO number</span><input maxLength={60} value={extra.poNumber} onChange={(ev) => setExtra({ ...extra, poNumber: ev.target.value })} /></label>
          <label className="field"><span>Notes</span><input maxLength={2000} value={extra.notes} onChange={(ev) => setExtra({ ...extra, notes: ev.target.value })} /></label>
        </div>
        <div className="doc-foot">
          <div className="grow">
            <div className="checks"><label><input type="checkbox" checked={extra.notifyWhatsApp} onChange={(ev) => setExtra({ ...extra, notifyWhatsApp: ev.target.checked })} /> Send the customer a WhatsApp booking receipt</label></div>
            <Msg st={st} />
            {missing && <p className="muted small-print">Enter a rate for {missing.name} to book.</p>}
            <button className="btn" disabled={st.busy || !lines.length || !!missing}>{st.busy ? "Booking…" : `Confirm booking ${lines.length && !missing ? rs(t.total) : ""}`}</button>
          </div>
          <Totals t={t} interState={inter} />
        </div>
      </form>
    </Modal>
  );
}
