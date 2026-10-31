import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { Loader, useLoad } from "./hooks.jsx";
import { PayLinkActions } from "./PayLink.jsx";
import { Msg, rs, useAction } from "./ui.jsx";
import { daysLabel, DocSummary, EmptyState, Icon, useThumbs } from "./visual.jsx";

const FILTERS = [["", "All"], ["paid", "Paid"], ["unpaid", "Pending"], ["partial", "Part paid"], ["overdue", "Overdue"], ["void", "Void"]];
const statusOf = (i) => (i.overdue ? { key: "overdue", label: "Overdue" } : i.status === "paid" ? { key: "paid", label: "Paid" } : i.status === "void" ? { key: "void", label: "Void" } : { key: "pending", label: i.status === "partial" ? "Part paid" : "Pending" });
const dueWords = { soon: (n) => `Due in ${n} day${n === 1 ? "" : "s"}`, today: "Due today", past: (n) => `${n} day${n === 1 ? "" : "s"} overdue` };

export default function Invoices() {
  const [sp, setSp] = useSearchParams();
  const status = sp.get("status") || "";
  const s = useLoad("/api/admin/invoices" + (status ? `?status=${status}` : ""));
  const map = useThumbs();
  const [st, run] = useAction();
  const whatsapp = (i) => run(async () => { await api(`/api/admin/invoices/${i.id}/send`, { method: "POST" }); }, `${i.number} sent to ${i.customer.name}`);
  const label = FILTERS.find(([key]) => key === status)?.[1].toLowerCase();
  return (
    <>
      <div className="row-between"><h1>Invoices</h1><div className="btn-row"><a className="btn ghost" href="/api/admin/reports/sales-register.csv">GST sales register</a><Link className="btn" to="/admin/invoices/new">+ New invoice</Link></div></div>
      <div className="status-chips" role="group" aria-label="Status">
        {FILTERS.map(([key, name]) => <button key={key} type="button" aria-pressed={status === key} onClick={() => setSp(key ? { status: key } : {})}>{name}</button>)}
      </div>
      <Msg st={st} />
      <Loader s={s}>
        {s.data?.length === 0 ? <EmptyState title={status ? `No ${label} invoices` : "No invoices yet"} body={status ? "Try another filter." : "Invoices you create or convert from a quotation appear here."} /> : <>
          <p className="muted" role="status">{s.data?.length} invoices · balance due {rs((s.data || []).reduce((n, i) => n + (i.balance || 0), 0))}</p>
          <ul className="q-list">
            {s.data?.map((i) => {
              const v = statusOf(i), label = i.balance > 0 ? daysLabel(i.dueDate, dueWords) : null;
              return (
                <DocSummary key={i.id} to={`/admin/invoices/${i.id}`} doc={i} map={map} note={label && `${label.text} · ${rs(i.balance)} due`} noteTone={label?.tone} status={v.key} statusLabel={v.label}>
                  {i.status !== "void" && <button className="btn btn-whatsapp" disabled={st.busy} onClick={() => whatsapp(i)}><Icon name="chat" size={16} />WhatsApp</button>}
                  <a className="btn ghost" href={`/doc/invoice/${i.token}`} target="_blank" rel="noopener noreferrer"><Icon name="quote" size={16} />PDF</a>
                  {i.balance > 0 && <PayLinkActions compact base={`/api/admin/invoices/${i.id}`} doc={i} due={i.balance} onChange={() => s.reload()} />}
                </DocSummary>
              );
            })}
          </ul>
        </>}
      </Loader>
    </>
  );
}
