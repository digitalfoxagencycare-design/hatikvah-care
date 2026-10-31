import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { can, useMe } from "./AdminApp.jsx";
import { Loader, useLoad } from "./hooks.jsx";
import { Msg, useAction } from "./ui.jsx";
import { daysLabel, DocSummary, EmptyState, Icon, useThumbs } from "./visual.jsx";
import { openWhatsAppQuote } from "./whatsappQuote.js";

const STATUSES = ["draft", "sent", "accepted", "converted", "rejected", "expired"];
const open = (q) => !q.invoiceId && ["draft", "sent", "accepted"].includes(q.status);
const expiryWords = { soon: (n) => `Expires in ${n} day${n === 1 ? "" : "s"}`, today: "Expires today", past: (n) => `Expired ${n} day${n === 1 ? "" : "s"} ago` };

export default function Quotes() {
  const me = useMe();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const status = sp.get("status") || "";
  const s = useLoad("/api/admin/quotes" + (status ? `?status=${status}` : ""));
  const map = useThumbs();
  const [st, run] = useAction();
  const convert = (q) => run(async () => { const inv = await api(`/api/admin/quotes/${q.id}/invoice`, { method: "POST" }); nav(`/admin/invoices/${inv.id}`); });
  return (
    <>
      <div className="row-between"><h1>Quotations</h1><Link className="btn" to="/admin/quotes/new">+ New quotation</Link></div>
      <div className="status-chips" role="group" aria-label="Status">
        {["", ...STATUSES].map((x) => <button key={x} type="button" aria-pressed={status === x} onClick={() => setSp(x ? { status: x } : {})}>{x ? x[0].toUpperCase() + x.slice(1) : "All"}</button>)}
      </div>
      <Msg st={st} />
      <Loader s={s}>
        {s.data?.length === 0 ? (
          <EmptyState title={status ? `No ${status} quotations` : "No quotations yet"} body={status ? "Try another filter, or start a new quotation for a customer." : "Create a quotation with product photos, send it on WhatsApp, and turn it into a tax invoice in one tap."}>
            <Link className="btn" to="/admin/quotes/new">+ New quotation</Link>
          </EmptyState>
        ) : (
          <ul className="q-list">
            {s.data?.map((q) => {
              const expiry = open(q) && q.validUntil ? daysLabel(q.validUntil, expiryWords) : null;
              return (
                <DocSummary key={q.id} to={`/admin/quotes/${q.id}`} doc={q} map={map} note={expiry?.text} noteTone={expiry?.tone} status={q.status}>
                  {can(me, "invoices") && open(q) && <button className="btn" disabled={st.busy} onClick={() => convert(q)}><Icon name="bolt" size={16} />Convert to Invoice</button>}
                  {q.invoiceId && <Link className="btn ghost" to={`/admin/invoices/${q.invoiceId}`}><Icon name="invoice" size={16} />Open invoice {q.invoiceNumber}</Link>}
                  <button className="btn btn-whatsapp" onClick={() => openWhatsAppQuote(q)}><Icon name="chat" size={16} />WhatsApp</button>
                  <a className="btn ghost" href={`/doc/quote/${q.token}`} target="_blank" rel="noopener noreferrer"><Icon name="quote" size={16} />PDF</a>
                </DocSummary>
              );
            })}
          </ul>
        )}
      </Loader>
    </>
  );
}
