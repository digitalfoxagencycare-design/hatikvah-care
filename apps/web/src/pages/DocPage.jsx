import { lazy, Suspense, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import QRCode from "qrcode";
import { api, money } from "../api.js";
const DispatchSlip = lazy(() => import("./DispatchSlip.jsx")); // the QR library loads only for slips
const ShippingLabel = lazy(() => import("./ShippingLabel.jsx")); // same for the barcode library
import "./doc.css";

const TITLES = { quote: "QUOTATION", invoice: "TAX INVOICE", challan: "DELIVERY CHALLAN", packing: "PACKING SLIP", gatepass: "GATE PASS", label: "SHIPPING LABEL", creditnote: "CREDIT NOTE" };

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
  const [qrData, setQrData] = useState("");

  const load = () => api(`/api/public/doc/${kind}/${token}`).then((data) => setS({ data })).catch((e) => setS({ error: e.message }));
  useEffect(() => { load(); }, [kind, token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (s.data) {
      document.title = `${TITLES[kind] || "Document"} ${["challan", "packing", "gatepass", "label"].includes(kind) ? s.data.doc.challanNumber : s.data.doc.number} | ${s.data.company.legalName || s.data.company.name}`;
    }
  }, [s.data, kind]);

  useEffect(() => {
    if (!s.data) return;
    const { doc: d, company: c } = s.data;
    const totalPaise = d.totals?.total ?? d.total ?? 0;
    const payUrl = d.payLink?.url;
    let qrTarget;
    if (payUrl) {
      qrTarget = payUrl;
    } else {
      const payeeName = (c.legalName || c.name || "EXL Marketing").replace(/[^a-zA-Z0-9 ]/g, "").trim();
      const upiId = (c.upiId && c.upiId !== "exlmarketing@icici") ? c.upiId : "42157988420@sbi";
      qrTarget = `upi://pay?pa=${upiId}&pn=${encodeURIComponent(payeeName)}&am=${(totalPaise / 100).toFixed(2)}&cu=INR`;
    }
    QRCode.toDataURL(qrTarget, { margin: 1, width: 140, errorCorrectionLevel: "M" })
      .then(setQrData)
      .catch(() => setQrData(""));
  }, [s.data]);

  if (s.loading) return <p className="doc-note">Loading document…</p>;
  if (s.error) return <p className="doc-note">{s.error}</p>;

  const { doc: d, company: c } = s.data;
  if (kind === "packing" || kind === "gatepass") return <Suspense fallback={<p className="doc-note">Loading…</p>}><DispatchSlip kind={kind} token={token} d={d} c={c} /></Suspense>;
  if (kind === "label") return <Suspense fallback={<p className="doc-note">Loading…</p>}><ShippingLabel d={d} c={c} /></Suspense>;
  const challan = kind === "challan";
  const quote = kind === "quote";
  const invoice = kind === "invoice";
  const credit = kind === "creditnote"; // GST credit note: same layout as the invoice, linked to the invoice it reduces

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

  const payeeName = (c.legalName || c.name || "EXL Marketing").replace(/[^a-zA-Z0-9 ]/g, "").trim();
  const upiId = (c.upiId && c.upiId !== "42157988420@sbi") ? c.upiId : "exlmarketing@icici";

  return (
    <div className="doc-page-container">
      {/* Action buttons (Print / Download PDF / WhatsApp) */}
      <div className="doc-actions no-print">
        {d.payLink?.url && (d.balance > 0 || (d.amountPaid || 0) < totalPaise) && (
          <a
            className="btn btn-pay-online"
            href={d.payLink.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ background: "#16a34a", color: "#fff", fontWeight: 700, boxShadow: "0 2px 8px rgba(22,163,74,0.3)" }}
          >
            💳 Pay ₹{fmtMoney(d.balance ?? totalPaise)} Online via Razorpay
          </a>
        )}
        <a className="btn" href={`/api/public/doc/${kind}/${token}/pdf`} target="_blank" rel="noopener noreferrer">
          📥 Download PDF
        </a>
        <button className="btn ghost" onClick={() => window.print()}>
          🖨️ Print
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
              {challan ? "Challan #:" : quote ? "Quotation #:" : credit ? "Credit Note #:" : "Invoice #:"}
            </span>
            <strong>{challan ? d.challanNumber : d.number}</strong>
            {quote && d.version > 1 && <span className="text-muted"> (v{d.version})</span>}
          </div>
          <div className="bill-meta-cell">
            <span className="meta-label">
              {challan ? "Dispatch Date:" : quote ? "Quotation Date:" : credit ? "Credit Note Date:" : "Invoice Date:"}
            </span>
            <strong>{fmtDate(challan ? d.dispatch?.date : d.date || d.createdAt)}</strong>
          </div>
          <div className="bill-meta-cell">
            <span className="meta-label">{quote ? "Validity:" : credit ? "Against Invoice:" : "Due Date:"}</span>
            <strong>{credit ? `${d.invoiceNumber} dt. ${fmtDate(d.invoiceDate)}` : fmtDate(quote ? d.validUntil : d.dueDate)}</strong>
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
          {quote && <span>Payment Terms: <strong>{d.paymentTerms === "credit" ? `Credit (${d.creditDays || 30} Days)` : "Prepaid / Advance"}</strong></span>}
          {quote && <span>Delivery: <strong>{d.shippingType === "shadowfax" ? `Shadowfax Courier${d.shippingCharge ? ` (+₹${(d.shippingCharge/100).toFixed(2)})` : ""}` : d.shippingType === "custom" ? `Custom Courier${d.shippingCharge ? ` (+₹${(d.shippingCharge/100).toFixed(2)})` : ""}` : "Free Delivery"}</strong></span>}
          {d.poNumber && <span>Customer PO #: <strong>{d.poNumber}</strong></span>}
          {d.orderNumber && <span>Order #: <strong>{d.orderNumber}</strong></span>}
          {credit && <span>Reason: <strong>{String(d.reason || "").replace(/_/g, " ")}</strong>{d.restock ? " (goods returned)" : ""}</span>}
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
              <span>{credit ? "Credit Amount:" : "Amount Payable:"}</span> <strong>₹{fmtMoney(totalPaise)}</strong>
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
          {!credit && <div className="bill-upi-col">
            <p className="bottom-label"><strong>{d.payLink?.url ? "Scan to Pay Online:" : "Pay using UPI:"}</strong></p>
            <div className="qr-container">
              {qrData ? (
                d.payLink?.url ? (
                  <a href={d.payLink.url} target="_blank" rel="noopener noreferrer" title="Click to pay online via Razorpay">
                    <img
                      src={qrData}
                      alt="Payment QR Code"
                      width="100"
                      height="100"
                      className="upi-qr-img"
                    />
                  </a>
                ) : (
                  <img
                    src={qrData}
                    alt="UPI QR Code"
                    width="100"
                    height="100"
                    className="upi-qr-img"
                  />
                )
              ) : (
                <div style={{ width: 100, height: 100, display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc", border: "1px solid #e2e8f0", fontSize: "0.72rem", color: "#64748b" }}>Loading QR…</div>
              )}
            </div>
            {d.payLink?.url ? (
              <p style={{ fontSize: "0.72rem", color: "#0284c7", margin: "4px 0 0 0", textAlign: "center", fontWeight: 600 }}>
                <a href={d.payLink.url} target="_blank" rel="noopener noreferrer" style={{ color: "#0284c7", textDecoration: "underline" }}>
                  Razorpay Secure (Tap / Scan) ↗
                </a>
              </p>
            ) : (
              <p style={{ fontSize: "0.72rem", color: "#475569", margin: "4px 0 0 0", textAlign: "center" }}>{(c.upiId && c.upiId !== "exlmarketing@icici") ? c.upiId : "42157988420@sbi"}</p>
            )}
          </div>}

          {!credit && <div className="bill-bank-col">
            <p className="bottom-label"><strong>Bank Details:</strong></p>
            <p>Bank: <strong>State Bank of India</strong></p>
            <p>Account #: <strong>42157988420</strong></p>
            <p>IFSC Code: <strong>SBIN0020308</strong></p>
            <p>Branch: <strong>SANJEEVA REDDY NGR</strong></p>
          </div>}

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
            {credit ? `${d.notes ? d.notes + "\n" : ""}This credit note reduces the value of invoice ${d.invoiceNumber} and the GST charged on it.` : d.terms || d.notes || c.invoiceTerms || "We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct. Subject to Hyderabad jurisdiction."}
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
        <div className="doc-note no-print success-msg" style={{ padding: "16px 20px", background: "#F0FDF4", border: "1px solid #16A34A", borderRadius: "10px", marginTop: "16px" }}>
          {resp.done === "accept" ? (
            <div>
              <h3 style={{ color: "#15803D", margin: "0 0 6px 0", fontSize: "1.1rem" }}>✓ Quotation Accepted!</h3>
              <p style={{ margin: "0 0 10px 0", color: "#166534" }}>
                {d.paymentTerms === "credit"
                  ? `Your order has been confirmed on ${d.creditDays || 30} days credit terms. Our warehouse team is preparing your goods for packing and dispatch. We will share your live tracking link as soon as your shipment is dispatched.`
                  : "Your order is confirmed! As per advance payment terms, you can complete payment using the UPI QR below or tap the secure online payment link. We've also sent the confirmation and payment link to your WhatsApp."}
              </p>
              {d.paymentTerms !== "credit" && d.payLink?.url && (
                <a href={d.payLink.url} target="_blank" rel="noopener noreferrer" className="btn" style={{ display: "inline-block", background: "#16A34A", color: "#fff", fontWeight: 700, textDecoration: "none" }}>
                  💳 Pay Online Now via Razorpay (UPI, Cards, NetBanking) ↗
                </a>
              )}
            </div>
          ) : (
            <p style={{ margin: 0, color: "#475569" }}>Thank you for letting us know.</p>
          )}
        </div>
      )}
    </div>
  );
}
