import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { Loader, useLoad } from "./hooks.jsx";
import TemplatePreview from "./TemplatePreview.jsx";
import { fmtTime, Msg, useAction } from "./ui.jsx";
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

/** Customer messages from the WhatsApp Business number, one thread per number; replies are allowed within 24 hours of their last message. */
export default function WhatsApp() {
  const s = useLoad("/api/admin/whatsapp/inbox");
  const [sel, setSel] = useState("");
  const [text, setText] = useState("");
  const [st, run] = useAction();
  const threads = useMemo(() => {
    const by = {};
    for (const m of s.data || []) (by[m.from] ||= { from: m.from, name: m.name || m.customerName, customerId: m.customerId, msgs: [] }).msgs.push(m);
    return Object.values(by).map((t) => ({ ...t, last: t.msgs[0], unread: t.msgs.filter((m) => !m.readAt).length }));
  }, [s.data]);
  const cur = threads.find((t) => t.from === sel);
  const open = async (t) => {
    setSel(t.from);
    for (const m of t.msgs.filter((x) => !x.readAt)) await api(`/api/admin/whatsapp/inbox/${m.id}/read`, { method: "POST" }).catch(() => {});
    if (t.unread) s.reload();
  };
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const win = cur && serviceWindow(cur.last.at, now);
  return (
    <>
      <h1>WhatsApp inbox</h1>
      <p className="muted">Messages to the business number. New numbers become customer leads automatically, and the bot answers greetings with the quote / hotel / clinic menu. Delivery ticks for messages we send are in <Link to="/admin/automation">Automation & messages</Link>.</p>
      <Loader s={s}>
        {threads.length === 0 ? <p className="muted">No WhatsApp messages yet. Connect the webhook (see docs/INTEGRATIONS.md) and they appear here.</p> : (
          <div className="chat">
            <ul className="chat-list">{threads.map((t) => <li key={t.from}><button className={(t.from === sel ? "on " : "") + (t.unread ? "unread" : "")} onClick={() => open(t)}>
              <i className={"wa-dot " + (serviceWindow(t.last.at, now).open ? "open" : "closed")} title={serviceWindow(t.last.at, now).open ? "Reply window open" : "Template only"} />{t.name || "+" + t.from}{t.unread > 0 && ` (${t.unread})`}<small className="bucket">{fmtTime(t.last.at)} · {t.last.text.slice(0, 50)}</small></button></li>)}</ul>
            <div className="panel">
              {!cur ? <p className="muted">Choose a conversation.</p> : <>
                <div className="row-between"><h2>{cur.name || "+" + cur.from}</h2><WindowBadge win={win} />{cur.customerId && <Link to={`/admin/customers/${cur.customerId}`}>Customer →</Link>}</div>
                {[...cur.msgs].reverse().map((m) => <div key={m.id} className="bubble">{m.text || `[${m.type}]`}{m.items?.length > 0 && <ul>{m.items.map((i, k) => <li key={k}>{i.qty} × {i.sku}</li>)}</ul>}<small>{fmtTime(m.at)}{m.enquiryId && " · enquiry created"}</small></div>)}
                <Msg st={st} />
                {win.open ? (
                  <form className="btn-row" onSubmit={(e) => { e.preventDefault(); run(async () => { await api("/api/admin/whatsapp/reply", { method: "POST", body: { to: cur.from, body: text } }); setText(""); }, "Sent ✓"); }}>
                    <input className="grow" maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a reply…" aria-label="Reply" />
                    <button className="btn" disabled={st.busy || !text.trim()}>Send</button>
                  </form>
                ) : <p className="muted small-print">More than 24 hours since their last message: WhatsApp only allows approved template messages now. <a href={`https://wa.me/${cur.from}`} target="_blank" rel="noopener noreferrer">Open in WhatsApp ↗</a></p>}
                <TemplatePreview customer={cur.name} />
              </>}
            </div>
          </div>
        )}
      </Loader>
    </>
  );
}
