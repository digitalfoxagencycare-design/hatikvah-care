import { Link } from "react-router-dom";
import { Loader, useLoad } from "./hooks.jsx";
import { PayLinkActions } from "./PayLink.jsx";
import { fmtDate, Pill, rs, useMeta } from "./ui.jsx";
import { HubTabs, Stat } from "./visual.jsx";

const METHOD = { razorpay: "Razorpay", upi: "UPI", cash: "Cash", card: "Card", bank: "Bank", cheque: "Cheque" };

/** Money collected, payment links still open, and links for what is owed. Settlement dates live in the Razorpay Dashboard, so this shows what was received. */
export default function PaymentsHub() {
  const s = useLoad("/api/admin/hubs/payments");
  const connected = useMeta().channels.payments === "razorpay";
  const d = s.data;
  return (
    <>
      <h1>Automations & Channels</h1>
      <HubTabs />
      {!connected && <p className="notice">Razorpay is not connected on this site, so payment links are off. Amounts below include every payment entered in the app.</p>}
      <Loader s={s}>{d && <>
        <div className="stats">
          <Stat n={rs(d.today)} label="Collected today" tone="good" />
          <Stat n={rs(d.month)} label="Collected this month" />
          <Stat n={d.activeLinks} label="Active payment links" sub="for the full amount owed" />
        </div>
        <div className="grid2 top">
          <div className="panel">
            <div className="row-between"><h2>Transactions</h2><a href="/api/admin/reports/payments.csv">Download CSV</a></div>
            {d.transactions.length === 0 && <p className="muted">No payments yet.</p>}
            {d.transactions.map((p) => (
              <div key={p.id} className="txn">
                <span><strong>{p.customerName}</strong><small>{fmtDate(p.date)} · <Link to={`/admin/invoices/${p.invoiceId}`}>{p.invoiceNumber}</Link>{p.reference ? ` · ${p.reference}` : ""}</small></span>
                <Pill s={p.razorpay ? "sent" : "draft"}>{METHOD[p.mode] || p.mode}</Pill>
                <span className="amt">{rs(p.amount)}<small>Received</small></span>
              </div>
            ))}
            {connected && <p className="muted small-print">For payout dates, see Settlements in the Razorpay Dashboard. The app receives payments, not bank settlements.</p>}
          </div>
          <div className="panel">
            <h2>Generate a Dynamic Payment Link</h2>
            {d.open.length === 0 && <p className="muted">Nothing is waiting to be paid.</p>}
            {d.open.map((i) => (
              <div key={i.id} className="txn">
                <span className="txn-open"><strong>{i.customer}</strong><small><Link to={`/admin/invoices/${i.id}`}>{i.number}</Link></small></span>
                <span className="amt">{rs(i.balance)}</span>
                <span className="txn-full"><PayLinkActions compact base={`/api/admin/invoices/${i.id}`} doc={i} due={i.balance} onChange={() => s.reload()} /></span>
              </div>
            ))}
          </div>
        </div>
      </>}</Loader>
    </>
  );
}
