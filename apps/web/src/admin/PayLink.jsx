import { useState } from "react";
import { api } from "../api.js";
import { Msg, useAction, useMeta } from "./ui.jsx";

/**
 * Generate Razorpay Link, then Copy Link and Send via WhatsApp, for an invoice or an order.
 * `base` is the document's admin API path, `due` what is owed now: a link for another amount has to be generated again.
 */
export function PayLinkActions({ base, doc, due, onChange, compact }) {
  const meta = useMeta();
  const [st, run, setSt] = useAction();
  const [copied, setCopied] = useState(false);
  if (meta.channels.payments !== "razorpay") return compact ? "—" : <p className="muted small-print">Online payment links appear here once Razorpay is connected.</p>;
  const link = doc.payLink?.url && doc.payLink.amount === due ? doc.payLink.url : "";
  const generate = () => run(async () => { onChange(await api(`${base}/paylink`, { method: "POST" })); });
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { window.prompt("Copy this link:", link); }
  };
  const send = () => run(async () => {
    const r = await api(`${base}/paylink/send`, { method: "POST" });
    if (r.sent) return setSt({ busy: false, error: null, ok: "Sent on WhatsApp ✓" });
    if (r.manualLink) { window.open(r.manualLink, "_blank", "noopener,noreferrer"); return setSt({ busy: false, error: null, ok: "Opened WhatsApp with the message filled in" }); }
    throw new Error("This customer has no WhatsApp number");
  });
  const small = compact ? " small" : "";
  return (
    <div className={compact ? "paylink compact" : "paylink"}>
      {!compact && link && <p>Online payment link: <a href={link} target="_blank" rel="noopener noreferrer">{link}</a></p>}
      <div className="btn-row">
        {!link && <button type="button" className={`btn ghost${small}`} disabled={st.busy} onClick={generate}>{st.busy ? "Generating…" : doc.payLink?.url ? "Update Razorpay Link" : "Generate Razorpay Link"}</button>}
        {link && <button type="button" className={`btn ghost${small}`} onClick={copy}>{copied ? "Copied ✓" : "Copy Link"}</button>}
        {link && <button type="button" className={`btn btn-whatsapp${small}`} disabled={st.busy} onClick={send}>Send via WhatsApp</button>}
      </div>
      <Msg st={st} />
    </div>
  );
}
