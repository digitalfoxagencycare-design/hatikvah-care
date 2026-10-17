import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, money } from "../api.js";
import "./doc.css";

const TITLES = { quote: "QUOTATION", invoice: "TAX INVOICE", challan: "DELIVERY CHALLAN" };

function fmtDate(s) {
  if (!s) return "—";
  const d = new Date(s.length === 10 ? s + "T00:00:00" : s);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtMoney(p) {
  if (p == null) return "0.00";
  return (p / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function DocPage() {
  const { kind, token } = useParams();
  const [s, setS] = useState({ loading: true });
  const [resp, setResp] = useState({ name: "", note: "", busy: false, error: null, done: null });

  const load = () => api(`/api/public/doc/${kind}/${token}`).then((data) => setS({ data })).catch((e) => setS({ error: e.message }));
  useEffect(() => { load(); }, [kind, token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (s.data) {
      document.title = `${TITLES[kind] || "Document"} ${kind === "challan" ? s.data.doc.challanNumber : s.data.doc.number} | ${s.data.company.legalName || s.data.company.name}`;
    }
  }, [s.data, kind]);

  if (s.loading) return <p className="doc-note">Loading document…</p>;
  if (s.error) return <p className="doc-note">{s.error}</p>;

  const { doc: d, company: c } = s.data;
  const challan = kind === "challan";
  const quote = kind === "quote";
  const invoice = kind === "invoice";

  const respond = async (action) => {
    setResp({ ...resp, busy: true, error: null });
    try {
      await api(`/api/public/doc/quote/${token}/${action}`, { method: "POST", body: { name: resp.name, note: resp.note } });
      setResp({ ...resp, busy: false, done: action });
      load();
    } catch (e) {
      setResp({ ...resp, busy: false, error: e.message });
    }
  };

  const totalQty = (d.items || []).reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
  const totalPaise = d.totals?.total ?? d.total ?? 0;

  // Group items by HSN for the detailed HSN/SAC tax breakdown table
  const hsnGroups = Object.values(
    (d.items || []).reduce((acc, item) => {
      const key = item.hsn || "OTHER";
      if (!acc[key]) {
        acc[key] = {
          hsn: key,
          taxable: 0,
          gstRate: item.gstRate ?? 18,
          tax: 0,
        };
      }
      acc[key].taxable += item.amount || 0;
      acc[key].tax += item.tax || 0;
      return acc;
    }, {})
  );

  const cleanWords = (d.amountInWords || "")
    .replace(/^Rupees\s+/i, "")
    .replace(/\s+Only$/i, "");

  const upiUrl = `upi://pay?pa=${c.upiId || "42157988420@sbi"}&pn=${encodeURIComponent(c.legalName || c.name)}&am=${(totalPaise / 100).toFixed(2)}&cu=INR`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=110x110&margin=4&data=${encodeURIComponent(upiUrl)}`;

  return (
    <div className="doc-page-container">
      {/* Action buttons (Print / Save PDF / WhatsApp) */}
      <div className="doc-actions no-print">
        <button className="btn" onClick={() => window.print()}>
          🖨️ Print / Save as PDF
        </button>
        {c.whatsapp && (
          <a
            className="btn btn-whatsapp"
            href={`https://wa.me/${c.whatsapp}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            📱 WhatsApp Support
          </a>
        )}
      </div>

      <article className="official-bill-sheet">
        {/* Top Header Bar */}
        <div className="bill-top-bar">
          <h1 className="bill-doc-type">{TITLES[kind] || "TAX INVOICE"}</h1>
          <span className="bill-recipient-badge">ORIGINAL FOR RECIPIENT</span>
        </div>

        {/* Company Header */}
        <div className="bill-company-section">
          <div className="bill-company-info">
            <h2 className="bill-company-name">{c.legalName || "M/s. EXL MARKETING"}</h2>
            <p className="bill-company-gstin"><strong>GSTIN {c.gstin || "36ADDPC0083H1Z0"}</strong></p>
            <p className="bill-company-address">{c.billingAddress || c.address || "Door No.12-7-134/BITNO.2/C/103, Flat No 103, C Block, R V Advaita, Road No.6, Sri Raghavendra Nagar, Habeeb Nagar, Hyderabad, Medchal Malkajgiri, TELANGANA, 500072"}</p>
            <p className="bill-company-contact">
              Mobile {c.phone || "+91 79954 44434"} &nbsp; Email {c.email || "hatvikcare@gmail.com"}
            </p>
          </div>

          <div className="bill-brand-logos">
            <div className="bill-brand-badge">
              <img src="/brand/exl-logo.jpg" alt="EXL Marketing" className="bill-logo-exl" />
              <img src="/brand/hatikvah-logo.png" alt="HaTikvah Care" className="bill-logo-hatikvah" />
            </div>
          </div>
        </div>

        {/* Document Metadata Bar */}
        <div className="bill-meta-bar">
          <div className="bill-meta-cell">
            <span className="meta-label">
              {challan ? "Challan #:" : quote ? "Quotation #:" : "Invoice #:"}
            </span>
            <strong>{challan ? d.challanNumber : d.number}</strong>
            {quote && d.version > 1 && <span className="text-muted"> (v{d.version})</span>}
          </div>
          <div className="bill-meta-cell">
            <span className="meta-label">
              {challan ? "Dispatch Date:" : quote ? "Quotation Date:" : "Invoice Date:"}
            </span>
            <strong>{fmtDate(challan ? d.dispatch?.date : d.date || d.createdAt)}</strong>
          </div>
          <div className="bill-meta-cell">
            <span className="meta-label">{quote ? "Validity:" : "Due Date:"}</span>
            <strong>{fmtDate(quote ? d.validUntil : d.dueDate)}</strong>
          </div>
        </div>

        {/* Customer Details & Billing Address */}
        <div className="bill-parties-grid">
          <div className="bill-party-box">
            <h3 className="party-heading">Customer Details:</h3>
            <p className="party-name"><strong>{d.customer?.name}</strong></p>
            {d.customer?.gstin && <p>GSTIN: <strong>{d.customer.gstin}</strong></p>}
            {d.customer?.phone && <p>Ph: {d.customer.phone}</p>}
            {d.customer?.contactName && <p>Attn: {d.customer.contactName}</p>}
          </div>

          <div className="bill-party-box">
            <h3 className="party-heading">Billing Address:</h3>
            <p className="party-address pre-line">{d.customer?.billingAddress || d.customer?.shippingAddress || "—"}</p>
            <p className="party-state">{d.customer?.stateName || d.customer?.state || ""}</p>
          </div>
        </div>

        <div className="bill-pos-bar">
          <span>Place of Supply: <strong>{d.placeOfSupply || "36"}-{d.placeOfSupplyName || "TELANGANA"}</strong></span>
          {d.poNumber && <span>Customer PO #: <strong>{d.poNumber}</strong></span>}
          {d.orderNumber && <span>Order #: <strong>{d.orderNumber}</strong></span>}
        </div>

        {/* Line Items Table */}
        <table className="bill-items-table">
          <thead>
            <tr>
              <th className="th-num">#</th>
              <th className="th-item">Item</th>
              <th className="th-rate">Rate / Item</th>
              <th className="th-qty">Qty</th>
              {!challan && (
                <>
                  <th className="th-val">Taxable Value</th>
                  <th className="th-tax">Tax Amount</th>
                  <th className="th-amt">Amount</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {(d.items || []).map((l, i) => (
              <tr key={i}>
                <td className="td-num">{i + 1}</td>
                <td className="td-item">
                  <div className="item-name">{l.name}</div>
                  <div className="item-hsn">HSN: {l.hsn || "—"}</div>
                </td>
                <td className="td-rate">₹{fmtMoney(l.rate)}</td>
                <td className="td-qty">{l.qty} {l.unit?.toUpperCase() || "NOS"}</td>
                {!challan && (
                  <>
                    <td className="td-val">₹{fmtMoney(l.amount)}</td>
                    <td className="td-tax">₹{fmtMoney(l.tax)} ({l.gstRate}%)</td>
                    <td className="td-amt">₹{fmtMoney(l.total)}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>

        {/* Subtotals Box */}
        {!challan && (
          <div className="bill-subtotals-wrap">
            <div className="bill-subtotals-box">
              <div className="subtotal-row">
                <span>Taxable Amount</span>
                <span>₹{fmtMoney(d.totals?.taxable)}</span>
              </div>
              {d.interState ? (
                <div className="subtotal-row">
                  <span>IGST {(d.items[0]?.gstRate || 18).toFixed(1)}%</span>
                  <span>₹{fmtMoney(d.totals?.igst)}</span>
                </div>
              ) : (
                <>
                  <div className="subtotal-row">
                    <span>CGST {((d.items[0]?.gstRate || 18) / 2).toFixed(1)}%</span>
                    <span>₹{fmtMoney(d.totals?.cgst)}</span>
                  </div>
                  <div className="subtotal-row">
                    <span>SGST {((d.items[0]?.gstRate || 18) / 2).toFixed(1)}%</span>
                    <span>₹{fmtMoney(d.totals?.sgst)}</span>
                  </div>
                </>
              )}
              {d.totals?.roundOff !== 0 && (
                <div className="subtotal-row">
                  <span>Round Off</span>
                  <span>{fmtMoney(d.totals?.roundOff)}</span>
                </div>
              )}
              <div className="subtotal-row grand-total-row">
                <strong>Total</strong>
                <strong>₹{fmtMoney(totalPaise)}</strong>
              </div>
            </div>
          </div>
        )}

        {/* Total Items & Words Bar */}
        <div className="bill-totals-words-bar">
          <div className="qty-words-left">
            <p className="items-qty-line">
              Total Items / Qty : <strong>{d.items?.length || 0} / {totalQty}</strong>
            </p>
            <p className="words-line">
              Total amount (in words): <strong>INR {cleanWords || "Zero"} Only.</strong>
            </p>
          </div>
          <div className="payable-right">
            <div className="payable-box">
              <span>Amount Payable:</span> <strong>₹{fmtMoney(totalPaise)}</strong>
            </div>
          </div>
        </div>

        {/* Detailed HSN/SAC Tax Breakdown Table */}
        {!challan && hsnGroups.length > 0 && (
          <div className="bill-hsn-wrap">
            <table className="bill-hsn-table">
              <thead>
                <tr>
                  <th>HSN/SAC</th>
                  <th>Taxable Value</th>
                  {d.interState ? (
                    <>
                      <th>Integrated Tax</th>
                      <th>Amount</th>
                    </>
                  ) : (
                    <>
                      <th>Central Tax</th>
                      <th>Amount</th>
                      <th>State Tax</th>
                      <th>Amount</th>
                    </>
                  )}
                  <th>Total Tax</th>
                </tr>
              </thead>
              <tbody>
                {hsnGroups.map((h, idx) => {
                  const halfTax = Math.round(h.tax / 2);
                  const otherHalf = h.tax - halfTax;
                  const rateHalf = (h.gstRate / 2).toFixed(1).replace(/\.0$/, "");
                  return (
                    <tr key={idx}>
                      <td>{h.hsn}</td>
                      <td>₹{fmtMoney(h.taxable)}</td>
                      {d.interState ? (
                        <>
                          <td>{h.gstRate}%</td>
                          <td>₹{fmtMoney(h.tax)}</td>
                        </>
                      ) : (
                        <>
                          <td>{rateHalf}%</td>
                          <td>₹{fmtMoney(halfTax)}</td>
                          <td>{rateHalf}%</td>
                          <td>₹{fmtMoney(otherHalf)}</td>
                        </>
                      )}
                      <td>₹{fmtMoney(h.tax)}</td>
                    </tr>
                  );
                })}
                <tr className="hsn-total-row">
                  <td><strong>TOTAL</strong></td>
                  <td><strong>₹{fmtMoney(d.totals?.taxable)}</strong></td>
                  {d.interState ? (
                    <>
                      <td>—</td>
                      <td><strong>₹{fmtMoney(d.totals?.igst)}</strong></td>
                    </>
                  ) : (
                    <>
                      <td>—</td>
                      <td><strong>₹{fmtMoney(d.totals?.cgst)}</strong></td>
                      <td>—</td>
                      <td><strong>₹{fmtMoney(d.totals?.sgst)}</strong></td>
                    </>
                  )}
                  <td><strong>₹{fmtMoney(d.totals?.tax)}</strong></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Bottom Section: UPI QR + Bank Details + Authorized Signatory Stamp */}
        <div className="bill-bottom-grid">
          <div className="bill-upi-col">
            <p className="bottom-label"><strong>Pay using UPI:</strong></p>
            <div className="qr-container">
              <img
                src={qrUrl}
                alt="UPI QR Code"
                width="100"
                height="100"
                className="upi-qr-img"
              />
            </div>
          </div>

          <div className="bill-bank-col">
            <p className="bottom-label"><strong>Bank Details:</strong></p>
            <p>Bank: <strong>State Bank of India</strong></p>
            <p>Account #: <strong>42157988420</strong></p>
            <p>IFSC Code: <strong>SBIN0020308</strong></p>
            <p>Branch: <strong>SANJEEVA REDDY NGR</strong></p>
          </div>

          <div className="bill-sign-col">
            <p className="sign-company">For <strong>{c.legalName || "M/s. EXL MARKETING"}</strong></p>
            <div className="stamp-seal-wrap">
              <svg viewBox="0 0 100 100" className="stamp-seal-svg" width="84" height="84">
                <circle cx="50" cy="50" r="47" fill="none" stroke="#1e3a8a" strokeWidth="2.5" />
                <circle cx="50" cy="50" r="42" fill="none" stroke="#1e3a8a" strokeWidth="1" strokeDasharray="2,2" />
                <circle cx="50" cy="50" r="30" fill="none" stroke="#1e3a8a" strokeWidth="1" />
                <path id="stampTop" d="M 18,50 A 32,32 0 0,1 82,50" fill="none" />
                <path id="stampBottom" d="M 82,50 A 32,32 0 0,1 18,50" fill="none" />
                <text fill="#1e3a8a" fontSize="7" fontWeight="bold" letterSpacing="0.8">
                  <textPath href="#stampTop" startOffset="50%" textAnchor="middle">M/S. EXL MARKETING</textPath>
                </text>
                <text fill="#1e3a8a" fontSize="6.5" fontWeight="bold" letterSpacing="0.8">
                  <textPath href="#stampBottom" startOffset="50%" textAnchor="middle">★ HYDERABAD ★</textPath>
                </text>
                <text x="50" y="53" fill="#1e3a8a" fontSize="8" fontWeight="bold" textAnchor="middle">EXL</text>
              </svg>
            </div>
            <p className="sign-label">Authorized Signatory</p>
          </div>
        </div>

        {/* Terms & Conditions */}
        <div className="bill-terms-section">
          <p className="terms-heading"><strong>Terms and Conditions:</strong></p>
          <p className="terms-body pre-line">
            {d.terms || d.notes || c.invoiceTerms || "We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct. Subject to Hyderabad jurisdiction."}
          </p>
        </div>

        {/* Footer info */}
        <div className="bill-footer-bar">
          <span>Page 1 / 1</span>
          <span>•</span>
          <span>{d.number}</span>
          <span>•</span>
          <span>This is a digitally signed document.</span>
        </div>
      </article>

      {/* Online Quote Acceptance Box */}
      {quote && d.status === "sent" && !resp.done && (
        <section className="doc-respond-box no-print">
          <h2>Approve this Quotation Online?</h2>
          <p>Confirm your name below to approve this quotation. We will immediately process your order.</p>
          <div className="respond-inputs">
            <input
              placeholder="Your name / Approver name"
              maxLength={100}
              value={resp.name}
              onChange={(e) => setResp({ ...resp, name: e.target.value })}
              aria-label="Your name"
            />
            <input
              placeholder="Notes / instructions (optional)"
              maxLength={500}
              value={resp.note}
              onChange={(e) => setResp({ ...resp, note: e.target.value })}
              aria-label="Note"
            />
          </div>
          {resp.error && <p className="alert" role="alert">{resp.error}</p>}
          <div className="btn-row">
            <button className="btn" disabled={resp.busy} onClick={() => respond("accept")}>
              ✓ Accept Quotation
            </button>
            <button className="btn ghost" disabled={resp.busy} onClick={() => window.confirm("Decline this quotation?") && respond("reject")}>
              Decline
            </button>
          </div>
        </section>
      )}

      {resp.done && (
        <p className="doc-note no-print success-msg">
          {resp.done === "accept"
            ? "Thank you! Your quotation acceptance has been recorded. Our team will contact you shortly."
            : "Thank you for letting us know."}
        </p>
      )}
    </div>
  );
}
