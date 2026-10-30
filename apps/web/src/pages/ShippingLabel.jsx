import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";
import "./label.css";

const fmtDate = (s) => (s ? new Date(s.length === 10 ? s + "T00:00:00" : s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");

function Barcode({ value }) {
  const svg = useRef(null);
  // no background: JsBarcode paints it with a style attribute, which this site's Content-Security-Policy blocks
  useEffect(() => { JsBarcode(svg.current, value, { format: "CODE128", height: 70, width: 2, fontSize: 15, margin: 0, background: "" }); }, [value]);
  return <svg ref={svg} role="img" aria-label={`Barcode ${value}`} />;
}

/** One 4×6 inch label per package: a print view of the delivery challan. The barcode carries the courier AWB, else the challan number. */
export default function ShippingLabel({ d, c }) {
  const s = d.shipment, packages = s?.packages || 1, code = s?.awb || d.dispatch?.trackingNo || d.challanNumber;
  const to = d.customer;
  return (
    <div className="label-page">
      <div className="doc-actions no-print"><button className="btn" onClick={() => window.print()}>🖨️ Print / Save as PDF</button></div>
      {Array.from({ length: packages }, (_, i) => (
        <article className="ship-label" key={i}>
          <header><strong>{d.dispatch?.transporter || "Courier"}</strong><span>Package {i + 1} of {packages}</span></header>
          <section className="label-to">
            <small>SHIP TO</small>
            <p className="label-name">{to.name}{to.contactName && to.contactName !== to.name ? `, ${to.contactName}` : ""}</p>
            <p>{to.shippingAddress || to.billingAddress}</p>
            {to.phone && <p>Ph: {to.phone}</p>}
          </section>
          <section className="label-code"><Barcode value={code} /></section>
          <table><tbody>
            <tr><th>Challan</th><td>{d.challanNumber}</td><th>Order</th><td>{d.number}</td></tr>
            <tr><th>Date</th><td>{fmtDate(d.dispatch?.date)}</td><th>Weight</th><td>{s?.weightKg ? `${s.weightKg} kg` : "—"}</td></tr>
          </tbody></table>
          <section className="label-from">
            <small>FROM</small>
            <p><strong>{c.legalName || c.name}</strong></p>
            <p>{c.address}</p>
            {c.phone && <p>Ph: {c.phone}</p>}
          </section>
        </article>
      ))}
    </div>
  );
}
