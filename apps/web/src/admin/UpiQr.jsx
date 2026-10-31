import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { Modal, Msg, rs, useAction } from "./ui.jsx";
import { ask } from "./toast.jsx";

const POLL_MS = 3000, SYNC_EVERY = 5; // our own record every 3 s (the webhook updates it), Razorpay itself every 15 s

/** Dynamic Razorpay UPI QR for a counter invoice. The invoice already exists: paying settles it, with no typing at the counter. */
export function UpiQrModal({ invoice, onPaid, onCancelled }) {
  const [v, setV] = useState(null);
  const [imgFailed, setImgFailed] = useState(false);
  const [left, setLeft] = useState(null);
  const [st, run] = useAction();
  const path = `/api/admin/pos/invoices/${invoice.id}/upi-qr`;
  const finished = useRef(false);
  const paid = (view) => { if (!finished.current) { finished.current = true; onPaid(view); } };
  const show = () => run(async () => { setImgFailed(false); const r = await api(path, { method: "POST" }); setV(r); if (r.status === "paid") paid(r); });

  useEffect(() => { show(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const waiting = v?.status === "pending";
  useEffect(() => {
    if (!waiting) return undefined;
    let tick = 0;
    const t = setInterval(async () => {
      tick += 1;
      try { const r = await api(`${path}${tick % SYNC_EVERY === 0 ? "?sync=1" : ""}`); setV(r); if (r.status === "paid") paid(r); } catch { /* the next poll tries again */ }
    }, POLL_MS);
    return () => clearInterval(t);
  }, [waiting, path]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const end = v?.qr?.closeBy ? Date.parse(v.qr.closeBy) : 0;
    if (!waiting || !end) return undefined;
    const count = () => setLeft(Math.max(0, Math.round((end - Date.now()) / 1000)));
    count(); const t = setInterval(count, 1000); return () => clearInterval(t);
  }, [waiting, v?.qr?.closeBy]);

  const close = (payment) => run(async () => {
    const r = await api(`${path}/close`, { method: "POST", body: { payment } });
    if (r.status === "paid") paid(r); else onCancelled();
  });
  const clock = left === null ? "" : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  return (
    <Modal title={`UPI payment for ${invoice.number}`} onClose={() => close(null)}>
      <div className="upi-box" role="status" aria-live="polite">
        <strong className="upi-amount">{rs(v?.balance ?? invoice.totals.total)}</strong>
        {waiting && (imgFailed
          ? <p><a className="btn" href={v?.payUrl || v.qr.imageUrl} target="_blank" rel="noopener noreferrer">Open Razorpay Payment Page</a></p>
          : <img className="upi-qr" src={v.qr.imageUrl} alt={`UPI QR code for ${rs(v.qr.amount)}`} onError={() => setImgFailed(true)} />)}
        {waiting && <p className="muted">Scan with Google Pay, PhonePe, Paytm or any UPI app. Screen auto-updates upon payment{clock && ` · ${clock} left`}</p>}
        {waiting && v?.payUrl && (
          <p style={{ margin: "6px 0 10px" }}><a className="btn ghost small" href={v.payUrl} target="_blank" rel="noopener noreferrer">Open Payment Page / Send to Buyer ↗</a></p>
        )}
        {v?.status === "expired" && <><p>This QR code has expired.</p><button className="btn" disabled={st.busy} onClick={show}>Show a new QR code</button></>}
        {!v && st.busy && <p className="muted">Getting the QR code from Razorpay…</p>}
        {!v && !st.busy && st.error && <button className="btn" onClick={show}>Try again</button>}
      </div>
      <Msg st={st} />
      <div className="btn-row">
        <button className="btn ghost" disabled={st.busy} onClick={async () => { if (await ask("Close this QR code and record a cash payment?", { confirmLabel: "Record cash" })) close({ mode: "cash", reference: "" }); }}>Paid by cash instead</button>
        <button className="link danger" disabled={st.busy} onClick={() => close(null)}>Cancel QR, leave invoice unpaid</button>
      </div>
    </Modal>
  );
}
