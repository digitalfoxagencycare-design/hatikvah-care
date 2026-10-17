import { Link } from "react-router-dom";
import { fmtDate, Pill, rs, Totals } from "./ui.jsx";

/** Read-only view of a saved quote / order / invoice. */
export function DocView({ d, children, extraInfo }) {
  return (
    <div className="panel">
      <div className="row-between">
        <div><h2>{d.customer.name}</h2><p className="muted small-print">{d.customer.contactName} {d.customer.phone} {d.customer.gstin && `· GSTIN ${d.customer.gstin}`}<br />{d.customer.billingAddress}</p></div>
        <div className="right"><Pill s={d.status} /><p className="muted small-print">Place of supply: {d.placeOfSupplyName || d.placeOfSupply} ({d.interState ? "IGST" : "CGST + SGST"})</p>{extraInfo}</div>
      </div>
      <div className="tbl-wrap"><table className="tbl">
        <thead><tr><th>#</th><th>Item</th><th>HSN</th><th>Qty</th><th>Rate</th><th>Disc</th><th>GST</th><th className="num">Amount</th></tr></thead>
        <tbody>{d.items.map((l, i) => <tr key={i}><td>{i + 1}</td><td>{l.name}<small>{l.sku}</small></td><td>{l.hsn || "—"}</td><td>{l.qty.toLocaleString("en-IN")} {l.unit}</td><td>{rs(l.rate)}</td><td>{l.discountPct ? l.discountPct + "%" : ""}</td><td>{l.gstRate}%</td><td className="num">{rs(l.amount)}</td></tr>)}</tbody>
      </table></div>
      <div className="doc-foot"><div className="grow">{d.notes && <p className="quote-msg">{d.notes}</p>}{children}</div><Totals t={d.totals} interState={d.interState} /></div>
    </div>
  );
}

export function DocList({ rows, base, cols = [] }) {
  return (
    <div className="tbl-wrap"><table className="tbl">
      <thead><tr><th>Number</th><th>Customer</th>{cols.map(([h]) => <th key={h}>{h}</th>)}<th className="num">Total</th><th>Status</th></tr></thead>
      <tbody>
        {rows.map((d) => <tr key={d.id}><td><Link to={`${base}/${d.id}`}><strong>{d.number}</strong></Link><small>{fmtDate(d.date || d.createdAt)}</small></td><td>{d.customer?.name || d.supplierName}</td>
          {cols.map(([h, f]) => <td key={h}>{f(d)}</td>)}<td className="num">{rs(d.totals?.total ?? d.total)}</td><td><Pill s={d.overdue ? "overdue" : d.status}>{d.overdue ? "overdue" : d.status}</Pill></td></tr>)}
        {rows.length === 0 && <tr><td colSpan={4 + cols.length} className="muted">Nothing here yet.</td></tr>}
      </tbody>
    </table></div>
  );
}
