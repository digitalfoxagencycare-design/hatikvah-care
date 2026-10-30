import { useEffect, useState } from "react";
import QRCode from "qrcode";

const fmtDate = (s) => (s ? new Date(s.length === 10 ? s + "T00:00:00" : s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");

/**
 * Print views of a delivery challan: the packing slip (goes in the carton: items, pieces, cartons) and the gate pass
 * (security keeps it: vehicle, packages). The QR code opens the challan, so the gate or the customer can check it.
 */
export default function DispatchSlip({ kind, token, d, c }) {
  const [qr, setQr] = useState("");
  const link = `${window.location.origin}/doc/challan/${token}`;
  useEffect(() => { QRCode.toString(link, { type: "svg", margin: 1, width: 120, errorCorrectionLevel: "M" }).then(setQr).catch(() => setQr("")); }, [link]);
  const gate = kind === "gatepass";
  const pcs = (it) => (Number(it.qty) || 0) * (it.perUnit || 1);
  const totalPcs = (d.items || []).reduce((n, it) => n + pcs(it), 0);
  const packages = d.shipment ? null : d.dispatch?.packages;
  return (
    <div className="doc-page-container">
      <div className="doc-actions no-print"><button className="btn" onClick={() => window.print()}>Print</button></div>
      <article className="official-bill-sheet slip">
        <header className="slip-head">
          <div><h2>{c.legalName || c.name}</h2><p className="small-print">{c.address}{c.gstin && <><br />GSTIN {c.gstin}</>}</p></div>
          <div className="slip-qr" aria-label="QR code: opens the delivery challan" dangerouslySetInnerHTML={{ __html: qr }} />
        </header>
        <h1>{gate ? "GATE PASS" : "PACKING SLIP"}</h1>
        <table className="slip-meta"><tbody>
          <tr><th>Challan</th><td><strong>{d.challanNumber}</strong></td><th>Order</th><td>{d.number}</td></tr>
          <tr><th>Date</th><td>{fmtDate(d.dispatch?.date)}</td><th>{gate ? "Vehicle" : "PO"}</th><td>{gate ? d.dispatch?.vehicleNo || "—" : d.poNumber || "—"}</td></tr>
          <tr><th>Transporter</th><td>{d.dispatch?.transporter || "—"}</td><th>LR / AWB</th><td>{d.shipment?.awb || d.dispatch?.trackingNo || "—"}</td></tr>
          <tr><th>Ship to</th><td colSpan="3">{d.customer.name}{d.customer.contactName && `, ${d.customer.contactName}`} {d.customer.phone}<br />{d.customer.shippingAddress || d.customer.billingAddress}</td></tr>
        </tbody></table>
        <table className="slip-items">
          <thead><tr><th>#</th><th>Item</th><th>SKU</th><th className="num">Qty</th><th>Unit</th>{!gate && <th className="num">Pieces</th>}{!gate && <th>Packed ✓</th>}</tr></thead>
          <tbody>{(d.items || []).map((it, i) => <tr key={i}><td>{i + 1}</td><td>{it.name}</td><td>{it.sku}</td><td className="num">{it.qty}</td><td>{it.unit}</td>{!gate && <td className="num">{pcs(it).toLocaleString("en-IN")}</td>}{!gate && <td>☐</td>}</tr>)}</tbody>
          <tfoot><tr><td colSpan="3">Total</td><td className="num">{(d.items || []).reduce((n, it) => n + (Number(it.qty) || 0), 0)}</td><td></td>{!gate && <td className="num">{totalPcs.toLocaleString("en-IN")}</td>}{!gate && <td></td>}</tr></tfoot>
        </table>
        {packages && <p>Packages: {packages}</p>}
        <div className="slip-sign">
          {gate ? <><span>Issued by</span><span>Security</span><span>Driver</span></> : <><span>Packed by</span><span>Checked by</span><span>Received by (customer)</span></>}
        </div>
      </article>
    </div>
  );
}
