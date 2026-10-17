import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, money } from "../api.js";
import "./doc.css";

const TITLES = { quote: "Quotation", invoice: "Tax Invoice", challan: "Delivery Challan" };
const d8 = (s) => (s ? new Date(s.length === 10 ? s + "T00:00:00" : s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "");
const rs = (p) => money(p);

/** Customer-facing quotation / invoice / delivery challan, opened from the link we send. Print → "Save as PDF" makes the PDF. */
export default function DocPage() {
  const { kind, token } = useParams();
  const [s, setS] = useState({ loading: true });
  const [resp, setResp] = useState({ name: "", note: "", busy: false, error: null, done: null });
  const load = () => api(`/api/public/doc/${kind}/${token}`).then((data) => setS({ data })).catch((e) => setS({ error: e.message }));
  useEffect(() => { load(); }, [kind, token]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (s.data) document.title = `${TITLES[kind]} ${kind === "challan" ? s.data.doc.challanNumber : s.data.doc.number} | ${s.data.company.name}`; }, [s.data, kind]);
  if (s.loading) return <p className="doc-note">Loading…</p>;
  if (s.error) return <p className="doc-note">{s.error}</p>;
  const { doc: d, company: c } = s.data;
  const respond = async (action) => {
    setResp({ ...resp, busy: true, error: null });
    try { await api(`/api/public/doc/quote/${token}/${action}`, { method: "POST", body: { name: resp.name, note: resp.note } }); setResp({ ...resp, busy: false, done: action }); load(); }
    catch (e) { setResp({ ...resp, busy: false, error: e.message }); }
  };
  const taxRows = Object.values(d.items.reduce((m, l) => { const k = l.gstRate; (m[k] ||= { rate: k, taxable: 0, tax: 0 }).taxable += l.amount; m[k].tax += l.tax; return m; }, {}));
  const challan = kind === "challan";
  return (
    <div className="doc-wrap">
      <div className="doc-actions no-print"><button className="btn" onClick={() => window.print()}>Print / Save as PDF</button>{c.whatsapp && <a className="btn ghost" href={`https://wa.me/${c.whatsapp}`} target="_blank" rel="noopener noreferrer">Questions? WhatsApp us</a>}</div>
      <article className="doc">
        <header className="doc-head">
          <div><img src="/brand/hatikvah-logo.png" alt={c.name} width="120" height="67" /><p><strong>{c.name}</strong>{c.legalName && ` (${c.legalName})`}<br />{c.address}<br />{c.phone} · {c.email}{c.gstin && <><br />GSTIN: <strong>{c.gstin}</strong> · State: {c.state} ({c.stateCode})</>}</p></div>
          <div className="doc-title"><h1>{TITLES[kind]}</h1>
            <table><tbody>
              <tr><td>{challan ? "Challan no." : kind === "quote" ? "Quote no." : "Invoice no."}</td><td><strong>{challan ? d.challanNumber : d.number}</strong>{kind === "quote" && d.version > 1 && ` (rev. ${d.version})`}</td></tr>
              <tr><td>Date</td><td>{d8(challan ? d.dispatch?.date : d.date || d.createdAt)}</td></tr>
              {kind === "quote" && <tr><td>Valid until</td><td>{d8(d.validUntil)}</td></tr>}
              {kind === "invoice" && <tr><td>Due date</td><td>{d8(d.dueDate)}</td></tr>}
              {(kind === "invoice" || challan) && d.orderNumber !== undefined && (d.orderNumber || d.number) && <tr><td>Order</td><td>{challan ? d.number : d.orderNumber}</td></tr>}
              {d.poNumber && <tr><td>Your PO</td><td>{d.poNumber}</td></tr>}
            </tbody></table>
            {kind !== "challan" && <span className={"doc-status " + d.status}>{d.status}</span>}
          </div>
        </header>
        <section className="doc-parties">
          <div><h3>{challan ? "Deliver to" : "Bill to"}</h3><p><strong>{d.customer.name}</strong>{d.customer.contactName && <><br />Attn: {d.customer.contactName}</>}<br />{challan ? d.customer.shippingAddress : d.customer.billingAddress}{d.customer.gstin && <><br />GSTIN: {d.customer.gstin}</>}<br />{d.customer.phone}</p></div>
          {!challan && <div><h3>Ship to</h3><p>{d.customer.shippingAddress || d.customer.billingAddress}</p><p>Place of supply: {d.placeOfSupply}-{d.placeOfSupplyName}</p></div>}
          {challan && d.dispatch && <div><h3>Dispatch</h3><p>{d.dispatch.transporter && <>Transporter: {d.dispatch.transporter}<br /></>}{d.dispatch.trackingNo && <>LR / tracking: {d.dispatch.trackingNo}<br /></>}{d.dispatch.vehicleNo && <>Vehicle: {d.dispatch.vehicleNo}<br /></>}{d.dispatch.notes}</p></div>}
        </section>
        <table className="doc-lines">
          <thead><tr><th>#</th><th>Description</th><th>HSN</th><th className="n">Qty</th>{!challan && <><th className="n">Rate</th><th className="n">Disc</th><th className="n">Taxable</th><th className="n">GST</th><th className="n">Amount</th></>}</tr></thead>
          <tbody>{d.items.map((l, i) => <tr key={i}><td>{i + 1}</td><td>{l.name}{l.sku && <small> ({l.sku})</small>}</td><td>{l.hsn}</td><td className="n">{l.qty.toLocaleString("en-IN")} {l.unit}</td>
            {!challan && <><td className="n">{rs(l.rate)}</td><td className="n">{l.discountPct ? l.discountPct + "%" : ""}</td><td className="n">{rs(l.amount)}</td><td className="n">{l.gstRate}%</td><td className="n">{rs(l.total)}</td></>}</tr>)}</tbody>
        </table>
        {!challan && (
          <section className="doc-sum">
            <div>
              <table className="doc-tax"><thead><tr><th>GST rate</th><th className="n">Taxable</th>{d.interState ? <th className="n">IGST</th> : <><th className="n">CGST</th><th className="n">SGST</th></>}</tr></thead>
                <tbody>{taxRows.map((t) => <tr key={t.rate}><td>{t.rate}%</td><td className="n">{rs(t.taxable)}</td>{d.interState ? <td className="n">{rs(t.tax)}</td> : <><td className="n">{rs(Math.round(t.tax / 2))}</td><td className="n">{rs(t.tax - Math.round(t.tax / 2))}</td></>}</tr>)}</tbody></table>
              <p className="words"><strong>Amount in words:</strong> {d.amountInWords}</p>
            </div>
            <table className="doc-totals"><tbody>
              <tr><td>Taxable value</td><td>{rs(d.totals.taxable)}</td></tr>
              {d.interState ? <tr><td>IGST</td><td>{rs(d.totals.igst)}</td></tr> : <><tr><td>CGST</td><td>{rs(d.totals.cgst)}</td></tr><tr><td>SGST</td><td>{rs(d.totals.sgst)}</td></tr></>}
              {d.totals.roundOff !== 0 && <tr><td>Round off</td><td>{rs(d.totals.roundOff)}</td></tr>}
              <tr className="grand"><td>Total</td><td>{rs(d.totals.total)}</td></tr>
              {kind === "invoice" && d.amountPaid > 0 && <><tr><td>Paid</td><td>{rs(d.amountPaid)}</td></tr><tr className="grand"><td>Balance due</td><td>{rs(d.balance)}</td></tr></>}
            </tbody></table>
          </section>
        )}
        {d.notes && <p className="doc-notes">{d.notes}</p>}
        {kind === "quote" && d.terms && <section><h3>Terms & conditions</h3><p className="pre">{d.terms}</p></section>}
        {kind === "invoice" && (
          <section className="doc-pay">
            {(c.bankDetails || c.upiId) && <div><h3>Payment details</h3><p className="pre">{c.bankDetails}{c.upiId && `\nUPI: ${c.upiId}`}</p></div>}
            {d.payLink?.url && d.balance > 0 && <p className="no-print"><a className="btn" href={d.payLink.url} target="_blank" rel="noopener noreferrer">Pay {rs(d.balance)} online</a></p>}
            {c.invoiceTerms && <p className="small">{c.invoiceTerms}</p>}
          </section>
        )}
        <footer className="doc-sign">
          {challan ? <><div>Received in good condition<br /><br />Receiver's signature & stamp</div><div>For {c.name}<br /><br />Authorised signatory</div></> : <div className="right">For {c.name}<br /><br /><br />Authorised signatory</div>}
        </footer>
        {kind === "invoice" && <p className="small center">This is a computer-generated invoice.</p>}
      </article>
      {kind === "quote" && d.status === "sent" && !resp.done && (
        <section className="doc respond no-print">
          <h2>Accept this quotation?</h2>
          <p>Type your name to confirm. We will prepare your order and get in touch.</p>
          <div className="row"><input placeholder="Your name" maxLength={100} value={resp.name} onChange={(e) => setResp({ ...resp, name: e.target.value })} aria-label="Your name" />
            <input placeholder="Note (optional): delivery date, changes…" maxLength={500} value={resp.note} onChange={(e) => setResp({ ...resp, note: e.target.value })} aria-label="Note" /></div>
          {resp.error && <p className="alert" role="alert">{resp.error}</p>}
          <div className="row"><button className="btn" disabled={resp.busy} onClick={() => respond("accept")}>Accept quotation</button><button className="btn ghost" disabled={resp.busy} onClick={() => window.confirm("Decline this quotation?") && respond("reject")}>Decline</button></div>
        </section>
      )}
      {resp.done && <p className="doc-note no-print">{resp.done === "accept" ? "Thank you! Your acceptance has been recorded. Our team will confirm your order shortly." : "Thank you for letting us know."}</p>}
    </div>
  );
}
