import { Link, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { Loader, useLoad } from "./hooks.jsx";
import { PayLinkActions } from "./PayLink.jsx";
import { fmtDate, Msg, Pill, rs, useAction, useMeta } from "./ui.jsx";
import { EmptyState, HubTabs, Stat } from "./visual.jsx";

const digits = (p) => String(p || "").replace(/\D/g, "");

/** Razorpay collections only: counter cash and bank entries stay in Payments. Settlement dates live in the Razorpay Dashboard, so this shows what was captured. */
export default function PaymentsHub() {
  const s = useLoad("/api/admin/hubs/payments");
  const connected = useMeta().channels.payments === "razorpay";
  const nav = useNavigate();
  const [st, run] = useAction();
  const d = s.data;
  /** Makes the link if it is missing, then opens the customer's WhatsApp thread with the message drafted. Nothing is sent until staff press Send. */
  const draft = (i) => run(async () => {
    const doc = i.payLink?.url && i.payLink.amount === i.balance ? i : await api(`/api/admin/invoices/${i.id}/paylink`, { method: "POST" });
    nav("/admin/whatsapp?" + new URLSearchParams({ phone: digits(i.phone).slice(-10), doc: i.id, draft: `Dear ${i.customer}, please pay ${rs(i.balance)} for invoice ${i.number} using this secure link:\n${doc.payLink.url}` }));
  });
  return (
    <>
      <h1>Automations & Channels</h1>
      <HubTabs />
      {!connected && <p className="notice">Razorpay is not connected on this site, so payment links and counter QR codes are off.</p>}
      <Msg st={st} />
      <Loader s={s}>{d && <>
        <div className="stats">
          <Stat n={rs(d.today)} label="Collected today" tone="good" sub="via Razorpay" />
          <Stat n={rs(d.month)} label="Collected this month" sub="via Razorpay" />
          <Stat n={d.qr.count} label="UPI QR collections" sub={`${rs(d.qr.amount)} this month`} />
          <Stat n={d.links.count} label="Payment Link collections" sub={`${rs(d.links.amount)} this month`} />
        </div>
        <section className="panel">
          <h2>Quick Payment Link Generator</h2>
          {d.open.length === 0 && <p className="muted">Nothing is waiting to be paid.</p>}
          {d.open.map((i) => (
            <div key={i.id} className="txn">
              <span className="txn-open"><strong>{i.customer}</strong><small><Link to={`/admin/invoices/${i.id}`}>{i.number}</Link>{i.phone ? ` · ${i.phone}` : " · no phone number"}</small></span>
              <span className="amt">{rs(i.balance)}</span>
              {connected && <span className="txn-full btn-row">
                {digits(i.phone).length >= 10 && <button className="btn small" disabled={st.busy} onClick={() => draft(i)}>Link + WhatsApp draft</button>}
                <PayLinkActions compact base={`/api/admin/invoices/${i.id}`} doc={i} due={i.balance} onChange={() => s.reload()} />
              </span>}
            </div>
          ))}
        </section>
        <h2>Razorpay transactions</h2>
        {d.transactions.length === 0 ? <EmptyState title="No Razorpay payments yet" body="Payments made by link or counter UPI QR appear here as soon as Razorpay confirms them." /> : (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Transaction ID</th><th>Customer</th><th>Invoice</th><th>Mode</th><th className="num">Amount</th><th>Status</th></tr></thead>
            <tbody>{d.transactions.map((p) => (
              <tr key={p.id}>
                <td><code>{p.paymentId}</code><small>{fmtDate(p.date)}</small></td>
                <td>{p.customerName}<small>{p.customerPhone}</small></td>
                <td><Link to={`/admin/invoices/${p.invoiceId}`}>{p.invoiceNumber}</Link></td>
                <td>{p.via}</td>
                <td className="num">{rs(p.amount)}</td>
                <td><Pill s="paid">{p.status}</Pill></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        {connected && <p className="muted small-print">For payout dates, see Settlements in the Razorpay Dashboard. Payments taken before this page was added show their mode as Razorpay.</p>}
      </>}</Loader>
    </>
  );
}
