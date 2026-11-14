import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { CreateInvoiceModal } from "./CreateInvoiceModal.jsx";
import { DocView } from "./DocParts.jsx";
import { Loader, useLoad } from "./hooks.jsx";
import { ask, askText } from "./toast.jsx";
import { InvoiceDispatch } from "./Logistics.jsx";
import { PayLinkActions } from "./PayLink.jsx";
import { EwbModal } from "./EwbModal.jsx";
import { EinvModal } from "./EinvModal.jsx";
import { DocEditor, fmtDate, Modal, Msg, rs, Timeline, today, toPaise, useAction } from "./ui.jsx";

function getWhatsAppInvoice(inv) {
  if (!inv) return null;
  const rawPhone = inv.customer?.phone || "";
  const clean = rawPhone.replace(/\D/g, "");
  const waPhone = clean.length === 10 ? `91${clean}` : clean;
  const invUrl = `${window.location.origin}/doc/invoice/${inv.token}`;
  const total = ((inv.totals?.total ?? inv.total ?? 0) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const bal = ((inv.balance ?? 0) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const text = `Hello ${inv.customer?.name || "Customer"},\n\nPlease find your Tax Invoice ${inv.number} from HaTikvah Care.\nTotal Amount: ₹${total}\nBalance Due: ₹${bal}\n\nYou can view and download your invoice here:\n${invUrl}\n\nThank you,\nHaTikvah Care`;
  return { waPhone, text, url: waPhone ? `https://wa.me/${waPhone}?text=${encodeURIComponent(text)}` : null };
}

export default function InvoiceDetail() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const isNew = id === "new";
  const s = useLoad(isNew ? "/api/admin/me" : `/api/admin/invoices/${id}`);
  const [pay, setPay] = useState(null);
  const [credit, setCredit] = useState(null);
  const [editingDraft, setEditingDraft] = useState(false);
  const [showEwb, setShowEwb] = useState(false);
  const [showEinv, setShowEinv] = useState(false);
  const [st, run] = useAction();
  const inv = isNew ? null : s.data;
  const wa = getWhatsAppInvoice(inv);
  const openWhatsApp = async () => {
    if (wa?.url) {
      window.open(wa.url, "_blank", "noopener,noreferrer");
    } else {
      const num = await askText("Customer's WhatsApp number", { value: inv?.customer?.phone || "", placeholder: "10 digits", confirmLabel: "Open WhatsApp" });
      if (!num) return;
      const clean = num.replace(/\D/g, "");
      const p = clean.length === 10 ? `91${clean}` : clean;
      window.open(`https://wa.me/${p}?text=${encodeURIComponent(wa.text)}`, "_blank", "noopener,noreferrer");
    }
  };

  if (isNew) {
    return (
      <>
        <p><Link to="/admin/invoices">← Invoices</Link></p>
        <CreateInvoiceModal
          onClose={() => nav("/admin/invoices")}
          onCreated={(created) => nav(`/admin/invoices/${created.id}`, { replace: true })}
        />
      </>
    );
  }

  if (inv && inv.status === "draft" && editingDraft) {
    return (
      <>
        <p><button type="button" className="link" onClick={() => setEditingDraft(false)}>← Back to Draft view</button></p>
        <CreateInvoiceModal
          draft={inv}
          onClose={() => setEditingDraft(false)}
          onCreated={() => {
            setEditingDraft(false);
            s.reload();
          }}
        />
      </>
    );
  }

  return (
    <>
      <p><Link to="/admin/invoices">← Invoices</Link></p>
      <Loader s={s}>{inv && (
        <>
          {inv.status === "draft" && (
            <div className="notice" style={{ background: "#fffbeb", borderColor: "#fde68a", marginBottom: 16 }}>
              <strong>Draft Invoice</strong> — This document has not been issued yet. It has no legal GST invoice number, stock has not been deducted, and no accounts receivable ledger entry has been posted.
            </div>
          )}
          <div className="row-between">
            <h1>{inv.status === "draft" ? `Draft ${inv.number}` : `Invoice ${inv.number}`}</h1>
            <div className="btn-row">
              {inv.status === "draft" ? (
                <>
                  <button type="button" className="btn ghost" onClick={() => setEditingDraft(true)}>Edit Draft</button>
                  <button
                    type="button"
                    className="btn"
                    onClick={async () => {
                      if (await ask("Issue this tax invoice now?", { body: "An official GST invoice number will be assigned, stock will be deducted, and accounts receivable posted.", confirmLabel: "Issue Invoice" })) {
                        run(async () => {
                          await api(`/api/admin/invoices/${inv.id}/issue`, { method: "POST", body: {} });
                          s.reload();
                        }, "Invoice issued successfully ✓");
                      }
                    }}
                  >
                    Issue Tax Invoice
                  </button>
                  <button
                    type="button"
                    className="btn ghost danger"
                    onClick={async () => {
                      if (await ask("Discard this draft invoice?", { danger: true, confirmLabel: "Discard Draft" })) {
                        run(async () => {
                          await api(`/api/admin/invoices/${inv.id}`, { method: "DELETE" });
                          nav("/admin/invoices", { replace: true });
                        }, "Draft discarded");
                      }
                    }}
                  >
                    Discard Draft
                  </button>
                </>
              ) : (
                <>
                  <a className="btn ghost" href={`/doc/invoice/${inv.token}`} target="_blank" rel="noopener noreferrer">View / print PDF</a>
                  {inv.status !== "void" && (
                    <button type="button" className="btn ghost" onClick={() => setShowEwb(true)} style={{ borderColor: inv.ewaybill?.ewbNo ? "#16a34a" : undefined }}>
                      🚚 E-Way Bill {inv.ewaybill?.ewbNo ? "✓" : ""}
                    </button>
                  )}
                  {inv.status !== "void" && (
                    <button type="button" className="btn ghost" onClick={() => setShowEinv(true)} style={{ borderColor: inv.einvoice?.irn ? "#0284c7" : undefined }}>
                      🏛️ E-Invoice {inv.einvoice?.irn ? "✓" : ""}
                    </button>
                  )}
                  {inv.ewaybill?.ewbNo && (
                    <a
                      className="btn ghost"
                      href={`/doc/ewaybill/${inv.token}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "#16a34a", borderColor: "#16a34a", textDecoration: "none", fontWeight: 600 }}
                    >
                      🖨️ Print E-Way Bill
                    </a>
                  )}
                  {inv.status !== "void" && <InvoiceDispatch inv={inv} onClose={() => s.reload()} />}
                  {inv.status !== "void" && <button type="button" className="btn btn-whatsapp" onClick={openWhatsApp}>📱 Send via WhatsApp</button>}
                  {inv.status !== "void" && <button className="btn ghost" onClick={() => run(async () => { await api(`/api/admin/invoices/${id}/send`, { method: "POST" }); s.reload(); }, "Sent to the customer again ✓")}>Send to customer</button>}
                  {inv.status !== "void" && <button className="btn ghost" onClick={() => setCredit({ reason: "return", restock: true, notes: "", lines: inv.items.map(() => ({ qty: "", rate: "", batch: "" })) })}>Issue credit note</button>}
                  {inv.balance > 0 && <button className="btn" onClick={() => setPay({ amount: String(inv.balance / 100), date: today(), mode: "bank", reference: "", notes: "" })}>Record payment</button>}
                </>
              )}
            </div>
          </div>
          <Msg st={st} />
          <div className="tiles">
            <div className="tile"><strong>{rs(inv.totals.total)}</strong><span>Invoice total</span><small>{fmtDate(inv.date)}</small></div>
            <div className="tile"><strong>{rs(inv.amountPaid)}</strong><span>Received</span></div>
            <div className={"tile" + (inv.overdue ? " warn" : "")}><strong>{rs(inv.balance)}</strong><span>Balance</span><small>{inv.overdue ? "Overdue since " : "Due "}{fmtDate(inv.dueDate)}</small></div>
            {inv.creditedAmount > 0 && <div className={"tile" + (inv.refundDue ? " warn" : "")}><strong>{rs(inv.creditedAmount)}</strong><span>Credited</span><small>{inv.refundDue ? `Refund due ${rs(inv.refundDue)}` : `${inv.creditNotesList.length} credit note(s)`}</small></div>}
            {inv.ewaybill?.ewbNo && (
              <div className="tile" style={{ borderLeft: "4px solid #16a34a", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                <div>
                  <strong style={{ color: "#16a34a" }}>#{inv.ewaybill.ewbNo}</strong>
                  <span>E-Way Bill Active</span>
                  <small>Vehicle: {inv.ewaybill.vehicleNo || "N/A"}</small>
                </div>
                <a
                  href={`/doc/ewaybill/${inv.token}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn ghost sm"
                  style={{ marginTop: 8, textAlign: "center", textDecoration: "none", color: "#16a34a", borderColor: "#16a34a", padding: "4px 8px", fontSize: "0.8rem", fontWeight: 600 }}
                >
                  🖨️ Print / Download Slip ↗
                </a>
              </div>
            )}
            {inv.einvoice?.irn && (
              <div className="tile" style={{ borderLeft: "4px solid #0284c7", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                <div>
                  <strong style={{ color: "#0284c7" }}>IRN Active ✓</strong>
                  <span>Govt E-Invoice</span>
                  <small style={{ fontFamily: "monospace", wordBreak: "break-all" }}>
                    Ack #{inv.einvoice.ackNo || inv.einvoice.irn.slice(0, 10)}
                  </small>
                </div>
                <button
                  type="button"
                  onClick={() => setShowEinv(true)}
                  className="btn ghost sm"
                  style={{ marginTop: 8, textAlign: "center", color: "#0284c7", borderColor: "#0284c7", padding: "4px 8px", fontSize: "0.8rem", fontWeight: 600 }}
                >
                  Manage / View QR ↗
                </button>
              </div>
            )}
          </div>
          <DocView d={inv} extraInfo={<p className="muted small-print">{inv.orderNumber && <>Order <Link to={`/admin/orders/${inv.orderId}`}>{inv.orderNumber}</Link><br /></>}{inv.poNumber && <>Customer PO {inv.poNumber}<br /></>}{inv.voidReason && <>Void: {inv.voidReason}</>}</p>}>
            {inv.balance > 0 && <PayLinkActions base={`/api/admin/invoices/${id}`} doc={inv} due={inv.balance} onChange={() => s.reload()} />}
          </DocView>
          {inv.creditNotesList?.length > 0 && (
            <div className="panel">
              <div className="row-between"><h2>Credit notes</h2><Link to={`/admin/credit-notes?invoiceId=${inv.id}`}>All →</Link></div>
              <table className="tbl"><tbody>{inv.creditNotesList.map((c) => <tr key={c.id}><td><strong>{c.number}</strong><small>{fmtDate(c.date)}</small></td><td>{c.reason.replace(/_/g, " ")}{c.restock && <small>goods back in stock</small>}</td><td className="num">{rs(c.total)}</td>
                <td><a href={`/doc/creditnote/${c.token}`} target="_blank" rel="noopener noreferrer">View / print</a></td></tr>)}</tbody></table>
            </div>
          )}
          <div className="panel">
            <h2>Payments</h2>
            <table className="tbl"><tbody>
              {inv.payments.map((p) => <tr key={p.id}><td>{fmtDate(p.date)}</td><td>{p.mode}</td><td>{p.reference}</td><td className="num">{rs(p.amount)}</td><td><button className="link danger" onClick={async () => { if (await ask("Remove this payment?", { danger: true, confirmLabel: "Remove" })) run(async () => { await api(`/api/admin/payments/${p.id}`, { method: "DELETE" }); s.reload(); }); }}>Remove</button></td></tr>)}
              {inv.payments.length === 0 && <tr><td className="muted">No payments yet.</td></tr>}
            </tbody></table>
          </div>
          {inv.status !== "void" && inv.amountPaid === 0 && inv.status !== "draft" && <button className="link danger" onClick={async () => { const reason = await askText("Reason for voiding this invoice?", { confirmLabel: "Void invoice", danger: true }); if (reason !== null) run(async () => { await api(`/api/admin/invoices/${id}/void`, { method: "POST", body: { reason } }); s.reload(); }); }}>Void invoice</button>}
          <div className="panel"><h2>History</h2><Timeline entity="invoice" entityId={inv.id} items={inv.activities} onAdded={s.reload} /></div>
          {credit && <CreditNoteModal inv={inv} c={credit} setC={setCredit} st={st} onSave={(body) => run(async () => { const r = await api("/api/admin/credit-notes", { method: "POST", body }); setCredit(null); s.reload(); return r; }, "Credit note issued ✓")} />}
          {showEwb && <EwbModal invoice={inv} onClose={() => setShowEwb(false)} onUpdated={() => { setShowEwb(false); s.reload(); }} />}
          {showEinv && <EinvModal invoice={inv} onClose={() => setShowEinv(false)} onUpdated={() => { setShowEinv(false); s.reload(); }} />}
          {pay && (
            <Modal title={`Payment for ${inv.number}`} onClose={() => setPay(null)}>
              <form className="form" onSubmit={(e) => { e.preventDefault(); const amount = toPaise(pay.amount); if (!amount || Number.isNaN(amount)) return; run(async () => { await api(`/api/admin/invoices/${id}/payments`, { method: "POST", body: { ...pay, amount } }); setPay(null); s.reload(); }, "Payment recorded ✓ Receipt sent to the customer."); }}>
                <div className="grid2">
                  <label className="field"><span>Amount (₹)</span><input required inputMode="decimal" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></label>
                  <label className="field"><span>Date</span><input type="date" value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} /></label>
                  <label className="field"><span>Mode</span><select value={pay.mode} onChange={(e) => setPay({ ...pay, mode: e.target.value })}>{["bank", "upi", "cash", "cheque", "card", "razorpay", "other"].map((m) => <option key={m}>{m}</option>)}</select></label>
                  <label className="field"><span>Reference (UTR / cheque no.)</span><input maxLength={100} value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></label>
                </div>
                <button className="btn" disabled={st.busy}>Save payment</button><Msg st={st} />
              </form>
            </Modal>
          )}
        </>
      )}</Loader>
    </>
  );
}

const REASONS = [["return", "Goods returned"], ["incorrect_item", "Wrong item supplied"], ["damaged", "Damaged / defective"], ["pricing_adjustment", "Price adjustment (no goods back)"], ["other", "Other"]];

/** Credit note against this invoice: quantity (and for a price adjustment, the credit rate) per invoice line. Totals and GST are worked out by the server. */
function CreditNoteModal({ inv, c, setC, st, onSave }) {
  const credited = {}; // quantity already returned per invoice line
  for (const n of inv.creditNotesList || []) if (n.reason !== "pricing_adjustment") for (const l of n.items) credited[l.line] = (credited[l.line] || 0) + l.qty;
  const adj = c.reason === "pricing_adjustment";
  const setLine = (i, k, v) => setC({ ...c, lines: c.lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)) });
  const items = c.lines.map((l, i) => ({ line: i, qty: Number(l.qty), ...(adj && l.rate !== "" ? { rate: toPaise(l.rate) } : {}), ...(l.batch.trim() ? { batch: { batchNumber: l.batch.trim() } } : {}) })).filter((x) => x.qty > 0);
  const est = items.reduce((n, x) => { const L = inv.items[x.line]; const t = Math.round(x.qty * (x.rate ?? L.rate) * (1 - (L.discountPct || 0) / 100)); return n + t + Math.round((t * (L.gstRate || 0)) / 100); }, 0);
  return (
    <Modal title={`Credit note on ${inv.number}`} wide onClose={() => setC(null)}>
      <form className="form" onSubmit={async (e) => { e.preventDefault(); if (items.length && await ask(`Issue a credit note of about ${rs(est)}?`, { body: "It gets the next CN number and cannot be edited.", confirmLabel: "Issue credit note" })) onSave({ invoiceId: inv.id, reason: c.reason, restock: c.restock, notes: c.notes, items }); }}>
        <div className="grid2">
          <label className="field"><span>Reason</span><select value={c.reason} onChange={(e) => setC({ ...c, reason: e.target.value, restock: ["return", "incorrect_item"].includes(e.target.value) })}>{REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label className="checks"><input type="checkbox" checked={c.restock} disabled={adj} onChange={(e) => setC({ ...c, restock: e.target.checked })} /> Put the goods back into stock</label>
        </div>
        <div className="tbl-wrap"><table className="tbl lines-tbl">
          <thead><tr><th>Item</th><th className="num">Invoiced</th><th>Credit qty</th>{adj && <th>Credit rate ₹</th>}{c.restock && !adj && <th>Batch (if tracked)</th>}</tr></thead>
          <tbody>{inv.items.map((L, i) => {
            const left = L.qty - (credited[i] || 0);
            return (
              <tr key={i}>
                <td>{L.name}<small>{L.hsn && `HSN ${L.hsn} · `}GST {L.gstRate}% · {rs(L.rate)} / {L.unit}</small></td>
                <td className="num">{L.qty} {L.unit}{credited[i] ? <small>{credited[i]} returned</small> : null}</td>
                <td><input className="w-sm" type="number" min="0" max={adj ? L.qty : left} step="any" value={c.lines[i].qty} disabled={!adj && left <= 0} onChange={(e) => setLine(i, "qty", e.target.value)} aria-label={`Credit quantity for ${L.name}`} /></td>
                {adj && <td><input className="w-sm" inputMode="decimal" placeholder={String(L.rate / 100)} value={c.lines[i].rate} onChange={(e) => setLine(i, "rate", e.target.value)} aria-label="Credit rate per unit" /></td>}
                {c.restock && !adj && <td><input className="w-sm" maxLength={40} value={c.lines[i].batch} onChange={(e) => setLine(i, "batch", e.target.value)} aria-label="Batch number" /></td>}
              </tr>
            );
          })}</tbody>
        </table></div>
        <label className="field"><span>Notes (shown on the credit note)</span><input maxLength={1000} value={c.notes} onChange={(e) => setC({ ...c, notes: e.target.value })} /></label>
        <p className="muted small-print">About {rs(est)} incl. GST ({inv.interState ? "IGST" : "CGST + SGST"}). The server works out the exact figures from the invoice lines. {inv.amountPaid > 0 && "This invoice has payments: any excess shows as a refund due."}</p>
        <Msg st={st} />
        <button className="btn" disabled={st.busy || !items.length}>Issue credit note</button>
      </form>
    </Modal>
  );
}
