import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { Loader, useLoad } from "./hooks.jsx";
import TemplatePreview from "./TemplatePreview.jsx";
import { fmtTime, Msg, Pill, useAction } from "./ui.jsx";
import { HubTabs, Stat } from "./visual.jsx";
import { serviceWindow } from "./waWindow.js";

/** Green with the time left while free-form replies are allowed, amber once only templates may be sent. */
function WindowBadge({ win }) {
  return (
    <span className={"wa-window " + (win.open ? "open" : "closed")} role="timer">
      <i aria-hidden="true" />
      {win.open ? <>Reply window <b>{win.label}</b></> : <b>{win.label}</b>}
    </span>
  );
}

const EVENTS = { invoiceSend: "Invoice", quoteSend: "Quotation", quoteAccepted: "Quote accepted", quoteReminder: "Quote reminder", orderBooked: "Order booked", orderDispatched: "Dispatch", shipmentUpdate: "Delivery update", paymentLink: "Payment link", paymentReceipt: "Receipt", invoiceOverdue: "Overdue reminder", enquiryAck: "Enquiry reply", waReply: "Reply" };
const TEMPLATES = [["quote", "hc_quote", "Quotation"], ["dispatch", "hc_dispatch", "Dispatch tracking"], ["invoice", "hc_invoice", "Invoice"]];
const ticks = { sent: "Sent", delivered: "Delivered", read: "Read", failed: "Failed", queued: "Sending", logged: "Not sent" };

function Bubble({ m }) {
  if (m.dir === "in") return (
    <div className="bubble">
      {m.text}
      {m.items.length > 0 && <ul>{m.items.map((i, k) => <li key={k}>{i.qty} × {i.sku}</li>)}</ul>}
      <small>{fmtTime(m.at)}{m.enquiryId && " · enquiry created"}</small>
    </div>
  );
  return (
    <div className="bubble out">
      {m.event && EVENTS[m.event] && <span className="bubble-tag">{EVENTS[m.event]}</span>}
      {m.text}
      {m.doc && <div className="bubble-doc"><span>{m.button || m.doc.kind} · {m.doc.number}</span><Pill s={m.doc.status}>{m.doc.status.replace(/_/g, " ")}</Pill>{m.doc.url && <a href={m.doc.url} target="_blank" rel="noopener noreferrer">Open ↗</a>}</div>}
      <small>{fmtTime(m.at)} · {ticks[m.status] || m.status}</small>
      {["logged", "failed"].includes(m.status) && <small className="bubble-err">{m.error || "This message did not go out."} {m.manualLink && <a href={m.manualLink} target="_blank" rel="noopener noreferrer">Send by hand ↗</a>}</small>}
    </div>
  );
}

/** One click per template: each row sends that template for the document chosen beside it. */
function TemplateSend({ t, chosen, onSent }) {
  const [picked, setPicked] = useState({ quote: t.docs.quote[0]?.id, dispatch: t.docs.dispatch[0]?.id, invoice: chosen || t.docs.invoice[0]?.id });
  const [st, run] = useAction();
  const send = (kind) => run(async () => {
    try {
      const m = await api(`/api/admin/whatsapp/threads/${t.key}/template`, { method: "POST", body: { kind, docId: picked[kind] } });
      if (["failed", "logged"].includes(m.status)) throw new Error(m.error || "WhatsApp did not take this message");
    } finally { onSent(); }
  }, "Template sent ✓");
  return (
    <div className="tpl-send">
      {TEMPLATES.map(([kind, name, label]) => (
        <div key={kind} className="tpl-row">
          <span><code>{name}</code><small>{label}</small></span>
          {t.docs[kind].length ? <>
            <select aria-label={`${label} to send`} value={picked[kind]} onChange={(e) => setPicked({ ...picked, [kind]: e.target.value })}>{t.docs[kind].map((d) => <option key={d.id} value={d.id}>{d.number} ({d.status.replace(/_/g, " ")})</option>)}</select>
            <button className="btn btn-whatsapp small" disabled={st.busy} onClick={() => send(kind)}>Send</button>
          </> : <small className="muted">Nothing to send for this customer</small>}
        </div>
      ))}
      <Msg st={st} />
    </div>
  );
}

function Thread({ phone, draft, doc, onChange }) {
  const s = useLoad(`/api/admin/whatsapp/threads/${phone}`);
  const [text, setText] = useState(draft || "");
  const [st, run] = useAction();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { const t = setInterval(() => { if (!document.hidden) s.reload(); }, 20000); return () => clearInterval(t); }, [s.reload]);
  const unread = s.data?.unread || 0;
  useEffect(() => { if (unread) api(`/api/admin/whatsapp/threads/${phone}/read`, { method: "POST" }).then(onChange).catch(() => {}); }, [unread, phone, onChange]);
  const t = s.data, win = serviceWindow(t?.lastInboundAt, now);
  const sent = () => { s.reload(); onChange(); };
  const reply = (e) => { e.preventDefault(); run(async () => { await api("/api/admin/whatsapp/reply", { method: "POST", body: { to: t.phone, body: text } }); setText(""); sent(); }, "Sent ✓"); };
  return (
    <Loader s={s}>{t && <>
      <header className="crm-head">
        <span><strong>{t.name || "+" + t.phone}</strong><small>+{t.phone}{t.customerId && <> · <Link to={`/admin/customers/${t.customerId}`}>Customer</Link></>}</small></span>
        <WindowBadge win={win} />
      </header>
      <div className="crm-msgs">
        {t.messages.length === 0 && <p className="muted">No messages with this number yet.</p>}
        {t.messages.map((m) => <Bubble key={m.dir + m.id} m={m} />)}
      </div>
      <div className="crm-send">
        {win.open && (
          <form className="btn-row" onSubmit={reply}>
            <textarea className="grow" rows={draft ? 3 : 1} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a reply…" aria-label="Reply" />
            <button className="btn" disabled={st.busy || !text.trim()}>Send</button>
          </form>
        )}
        <Msg st={st} />
        {!win.open && <p className="muted small-print">{t.lastInboundAt ? "More than 24 hours since their last message:" : "They have not written to us yet:"} WhatsApp allows approved templates only.{draft && " Send hc_invoice below: its button opens the invoice, where they can pay."}</p>}
        {win.open ? <details><summary>Send a template</summary><TemplateSend t={t} chosen={doc} onSent={sent} /></details> : <TemplateSend t={t} chosen={doc} onSent={sent} />}
      </div>
    </>}</Loader>
  );
}

/** Every customer conversation: what they wrote, and what we sent them, on one thread per number. */
export default function WhatsApp() {
  const [sp, setSp] = useSearchParams();
  const threads = useLoad("/api/admin/whatsapp/threads");
  const hub = useLoad("/api/admin/hubs/whatsapp");
  const [find, setFind] = useState("");
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => { setNow(Date.now()); if (!document.hidden) threads.reload(); }, 30000); return () => clearInterval(t); }, [threads.reload]);
  const phone = sp.get("phone") || "";
  const shown = useMemo(() => {
    const q = find.trim().toLowerCase();
    return (threads.data || []).filter((t) => !q || t.name.toLowerCase().includes(q) || t.phone.includes(q));
  }, [threads.data, find]);
  return (
    <>
      <h1>Automations & Channels</h1>
      <HubTabs />
      <Loader s={hub}>{hub.data && (
        <div className="stats">
          <Stat n={hub.data.stats.sent} label="Sent" />
          <Stat n={hub.data.stats.delivered} label="Delivered" />
          <Stat n={hub.data.stats.read} label="Read" tone="good" />
          <Stat n={hub.data.stats.failed} label="Failed" tone={hub.data.stats.failed ? "bad" : ""} />
        </div>
      )}</Loader>
      <div className="crm">
        <aside className="crm-list">
          <input type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search name or number" aria-label="Search conversations" />
          <Loader s={threads}>
            {shown.length === 0 && <p className="muted">{find ? "No match." : "No conversations yet. Connect the webhook (see docs/INTEGRATIONS.md) and they appear here."}</p>}
            <ul>{shown.map((t) => (
              <li key={t.key}><button className={t.key === phone ? "on" : ""} onClick={() => setSp({ phone: t.key })}>
                <span className="crm-who"><i className={"wa-dot " + (serviceWindow(t.lastInboundAt, now).open ? "open" : "closed")} title={serviceWindow(t.lastInboundAt, now).open ? "Reply window open" : "Template only"} /><strong>{t.name || "+" + t.phone}</strong>{t.unread > 0 && <b className="crm-unread" aria-label={`${t.unread} unread`}>{t.unread}</b>}</span>
                <small>+{t.phone} · {fmtTime(t.lastAt)}</small>
                <small className="crm-preview">{t.preview}</small>
              </button></li>
            ))}</ul>
          </Loader>
        </aside>
        <section className="crm-thread">
          {phone ? <Thread key={phone} phone={phone} draft={sp.get("draft") || ""} doc={sp.get("doc") || ""} onChange={threads.reload} /> : <p className="muted crm-pick">Choose a conversation.</p>}
        </section>
      </div>
      <details className="panel"><summary>Template previews</summary><TemplatePreview customer={(threads.data || []).find((t) => t.key === phone)?.name} /></details>
    </>
  );
}
