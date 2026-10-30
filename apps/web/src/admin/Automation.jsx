import { useState } from "react";
import { api } from "../api.js";
import { useMe } from "./AdminApp.jsx";
import { Loader, useLoad } from "./hooks.jsx";
import { fmtTime, Msg, Pill, useAction } from "./ui.jsx";

const CH = { resend: "Email via Resend", "whatsapp-cloud-api": "WhatsApp Cloud API", razorpay: "Razorpay payment links", off: "Not connected" };
export default function Automation() {
  const me = useMe();
  const s = useLoad("/api/admin/automation");
  const [status, setStatus] = useState("");
  const out = useLoad("/api/admin/outbox" + (status ? `?status=${status}` : ""));
  const [st, run] = useAction();
  const owner = me.role === "owner";
  const put = (body) => run(async () => { await api("/api/admin/automation", { method: "PUT", body }); s.reload(); }, "Saved ✓");
  const d = s.data;
  const groups = d ? [...new Set(d.rules.map((r) => r.group))] : [];
  return (
    <>
      <div className="row-between"><h1>Automation & messages</h1><button className="btn" disabled={st.busy} onClick={() => run(async () => { const r = await api("/api/admin/automation/run", { method: "POST" }); out.reload(); s.reload(); return r; }, "Checked now ✓")}>Run checks now</button></div>
      <Msg st={st} />
      <Loader s={s}>{d && (
        <>
          <div className="tiles">
            {[["Email", d.channels.email], ["WhatsApp", d.channels.whatsapp], ["Online payments", d.channels.payments]].map(([l, v]) => <div key={l} className={"tile" + (v === "off" ? " warn" : "")}><strong className="small-strong">{v === "off" ? "Off" : "On"}</strong><span>{l}</span><small>{CH[v]}</small></div>)}
            {d.channels.whatsapp !== "off" && <div className={"tile" + (d.channels.whatsappTemplates === "off" ? " warn" : "")}><strong className="small-strong">{d.channels.whatsappTemplates === "off" ? "None" : "Set"}</strong><span>WhatsApp templates</span>
              <small>{d.channels.whatsappTemplates === "off" ? "Customers who have not written in 24 h get messages by hand only" : d.channels.whatsappTemplates}</small></div>}
            <div className="tile"><strong className="small-strong">{d.cron.everyMinutes ? `Every ${d.cron.everyMinutes} min` : "Manual"}</strong><span>Scheduled checks</span><small>Last run {fmtTime(d.config.lastRunAt)}</small></div>
          </div>
          {(d.channels.email === "off" || d.channels.whatsapp === "off") && <p className="notice">Until email/WhatsApp are connected, every message is still prepared and listed below with a <strong>Send by hand</strong> link: one click opens WhatsApp or your email with the text filled in. See docs/INTEGRATIONS.md to connect them.</p>}
          <div className="panel form">
            <h2>Rules</h2>
            {groups.map((g) => <div key={g}><h3>{g}</h3>{d.rules.filter((r) => r.group === g).map((r) => (
              <label key={r.id} className="check-row"><input type="checkbox" disabled={!owner} checked={d.config.enabled[r.id] !== false} onChange={(e) => put({ enabled: { [r.id]: e.target.checked } })} />
                <span>{r.label}<small>{r.when === "event" ? "Runs immediately" : r.when === "daily" ? `Runs daily after ${d.config.dailyHour}:00` : "Checked on schedule"}</small></span></label>
            ))}</div>)}
            {owner && (
              <form className="grid3" onSubmit={(e) => { e.preventDefault(); const f = e.target.elements; put({ alertEmail: f.ae.value, alertWhatsapp: f.aw.value, staleHours: Number(f.sh.value), dailyHour: Number(f.dh.value), quoteReminderDays: f.qr.value.split(",").map(Number).filter((n) => n > 0), overdueDays: f.od.value.split(",").map(Number).filter((n) => n > 0) }); }}>
                <label className="field"><span>Team alert email (blank = company email)</span><input name="ae" type="email" defaultValue={d.config.alertEmail} /></label>
                <label className="field"><span>Team alert WhatsApp (digits, blank = company)</span><input name="aw" inputMode="numeric" defaultValue={d.config.alertWhatsapp} /></label>
                <label className="field"><span>Remind about a new enquiry after (hours)</span><input name="sh" type="number" min="1" defaultValue={d.config.staleHours} /></label>
                <label className="field"><span>Morning messages at (hour, 0–23 IST)</span><input name="dh" type="number" min="0" max="23" defaultValue={d.config.dailyHour} /></label>
                <label className="field"><span>Quote reminders after (days, comma separated)</span><input name="qr" defaultValue={d.config.quoteReminderDays.join(", ")} /></label>
                <label className="field"><span>Overdue reminders after (days)</span><input name="od" defaultValue={d.config.overdueDays.join(", ")} /></label>
                <div><button className="btn">Save settings</button></div>
              </form>
            )}
          </div>
        </>
      )}</Loader>
      <div className="row-between"><h2>Messages</h2><select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All</option><option value="logged">To send by hand</option><option value="sent">Sent</option><option value="failed">Failed</option><option value="queued">Queued</option></select></div>
      <Loader s={out}>
        <ul className="outbox">{out.data?.map((m) => (
          <li key={m.id} className="panel">
            <div className="row-between"><span><strong>{m.channel === "whatsapp" ? "WhatsApp" : "Email"}</strong> to {m.to} · {m.event} {m.ref && `· ${m.ref}`}{m.via && <small className="muted"> · {m.via.startsWith("template:") ? `template ${m.via.slice(9)}` : m.via}</small>}</span><span><small className="muted">{fmtTime(m.createdAt)}</small> <Pill s={m.status === "logged" ? "new" : m.status === "sent" ? "won" : m.status === "failed" ? "overdue" : "contacted"}>{m.status === "logged" ? "send by hand" : m.status}</Pill></span></div>
            {m.subject && m.channel === "email" && <strong>{m.subject}</strong>}
            <p className="pre small-print">{m.body}</p>
            {m.error && <p className="alert">{m.error}</p>}
            {m.status !== "sent" && <div className="btn-row"><a className="btn small" href={m.manualLink} target="_blank" rel="noopener noreferrer" onClick={() => setTimeout(() => api(`/api/admin/outbox/${m.id}/done`, { method: "POST" }).then(out.reload), 500)}>Send by hand</a>
              {m.status === "failed" && <button className="btn ghost small" onClick={() => run(async () => { await api(`/api/admin/outbox/${m.id}/retry`, { method: "POST" }); out.reload(); })}>Retry</button>}</div>}
          </li>
        ))}{out.data?.length === 0 && <li className="muted">No messages yet.</li>}</ul>
      </Loader>
    </>
  );
}
