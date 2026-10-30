import { Link } from "react-router-dom";
import { useMe } from "./AdminApp.jsx";
import { Loader, useLoad } from "./hooks.jsx";
import { fmtDate, fmtTime, Pill, rs } from "./ui.jsx";

export default function Dashboard() {
  const me = useMe();
  const s = useLoad("/api/admin/dashboard");
  const d = s.data;
  const Tile = ({ to, n, label, sub, tone = "" }) => <Link to={to} className={"tile " + tone}><strong>{n}</strong><span>{label}</span>{sub && <small>{sub}</small>}</Link>;
  return (
    <>
      <h1>Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, {me.name.split(" ")[0]}</h1>
      <Loader s={s}>{d && (
        <>
          <div className="tiles">
            {"salesThisMonth" in d && <Tile to="/admin/reports" n={rs(d.salesThisMonth)} label="Invoiced this month" sub={`${rs(d.receivedThisMonth)} received`} />}
            {"outstanding" in d && <Tile to="/admin/invoices?status=overdue" n={rs(d.outstanding)} label="To collect" sub={`${rs(d.overdue)} overdue (${d.overdueCount} invoices)`} tone={d.overdue ? "warn" : ""} />}
            {me.permissions.includes("enquiries") && <Tile to="/admin/enquiries" n={d.newEnquiries} label="New enquiries" sub={`${d.totalEnquiries} in total`} tone={d.newEnquiries ? "hot" : ""} />}
            {"openQuotes" in d && <Tile to="/admin/quotes?status=sent" n={d.openQuotes} label="Quotes awaiting reply" sub={rs(d.openQuoteValue)} />}
            {"toDispatch" in d && <Tile to="/admin/orders" n={d.toDispatch} label="Orders to dispatch" tone={d.toDispatch ? "hot" : ""} />}
            {"lowStock" in d && <Tile to="/admin/stock?filter=low" n={d.lowStock} label="Items low on stock" sub="available ≤ reorder level" tone={d.lowStock ? "warn" : ""} />}
            {"expiringBatches" in d && d.expiringBatches > 0 && <Tile to="/admin/stock?filter=expiring" n={d.expiringBatches} label="Batches expiring" sub="within 60 days" tone="warn" />}
            {"inboxUnread" in d && <Tile to="/admin/whatsapp" n={d.inboxUnread} label="Unread WhatsApp" tone={d.inboxUnread ? "hot" : ""} />}
            {me.permissions.includes("catalog") && <Tile to="/admin/products?filter=noprice" n={d.withoutPrice} label="Products without a price" sub={`${d.active} live products`} tone={d.withoutPrice ? "warn" : ""} />}
          </div>
          <div className="grid2 top">
            {d.dispatchQueue && (
              <div className="panel">
                <div className="row-between"><h2>Dispatch queue</h2><Link to="/admin/orders">Orders →</Link></div>
                {d.dispatchQueue.length === 0 ? <p className="muted">Nothing waiting to go out.{d.inTransit ? ` ${d.inTransit} in transit.` : ""}</p> : (
                  <table className="tbl"><tbody>{d.dispatchQueue.map((o) => <tr key={o.id}><td><Link to={`/admin/orders/${o.id}`}><strong>{o.number}</strong></Link><small>{fmtDate(o.createdAt)}{o.expectedDate && ` · due ${fmtDate(o.expectedDate)}`}</small></td>
                    <td>{o.customer}{o.paymentStatus === "pending" && <small className="due">awaiting online payment</small>}</td><td className="num">{rs(o.total)}</td><td><Pill s={o.status} /></td></tr>)}</tbody></table>
                )}
              </div>
            )}
            {d.aging && (
              <div className="panel">
                <div className="row-between"><h2>Receivables by age</h2><Link to="/admin/invoices?status=overdue">Overdue →</Link></div>
                <div className="aging">{d.aging.map((b) => <div key={b.key} className={b.key !== "current" && b.amount ? "late" : ""}><small>{b.label}</small><strong>{rs(b.amount)}</strong><small>{b.count} invoice{b.count === 1 ? "" : "s"}</small></div>)}</div>
              </div>
            )}
            {d.lowStockItems?.length > 0 && (
              <div className="panel">
                <div className="row-between"><h2>Reorder now</h2><Link to="/admin/stock?filter=low">Stock →</Link></div>
                <table className="tbl"><thead><tr><th>Item</th><th className="num">Floor</th><th className="num">Held</th><th className="num">Avail.</th></tr></thead>
                  <tbody>{d.lowStockItems.map((p) => <tr key={p.id}><td className="grow-cell">{p.name}<small>{p.sku} · reorder at {p.reorderLevel}</small></td><td className="num">{p.physical}</td><td className="num">{p.reserved}</td><td className="num"><strong>{p.available}</strong></td></tr>)}</tbody></table>
              </div>
            )}
            {d.expiringItems?.length > 0 && (
              <div className="panel">
                <h2>Batches expiring soon</h2>
                <table className="tbl"><tbody>{d.expiringItems.map((b) => <tr key={b.productId + b.batchNumber}><td>{b.name}<small>Batch {b.batchNumber}</small></td><td>{fmtDate(b.expDate)}<small className={b.daysToExpiry < 0 ? "due" : ""}>{b.daysToExpiry < 0 ? `expired ${-b.daysToExpiry} days ago` : `${b.daysToExpiry} days left`}</small></td><td className="num">{b.qty}</td></tr>)}</tbody></table>
              </div>
            )}
            {d.outbox && (
              <div className="panel">
                <div className="row-between"><h2>Messages sent</h2><Link to="/admin/automation">Outbox →</Link></div>
                {d.outbox.length === 0 ? <p className="muted">No messages yet.</p> : (
                  <table className="tbl"><tbody>{d.outbox.map((m) => <tr key={m.id}><td>{m.channel === "whatsapp" ? "WhatsApp" : "Email"}<small>{fmtTime(m.createdAt)}</small></td><td>{m.event}<small>{m.ref}</small></td><td><Pill s={m.deliveryStatus || m.status} />{m.error && <small className="due">{m.error}</small>}</td></tr>)}</tbody></table>
                )}
              </div>
            )}
          </div>
          {me.permissions.includes("enquiries") && (
            <div className="grid2 top">
              <div className="panel">
                <div className="row-between"><h2>Follow-ups due</h2><Link to="/admin/enquiries">Enquiries →</Link></div>
                {d.followUps.length === 0 ? <p className="muted">Nothing due today. 🎉</p> : (
                  <table className="tbl"><tbody>{d.followUps.map((e) => <tr key={e.id}><td><strong>{e.ref}</strong><small>{fmtDate(e.followUpAt)}</small></td><td>{e.name}<small>{e.company}</small></td><td><a href={`tel:${e.phone}`}>{e.phone}</a></td></tr>)}</tbody></table>
                )}
              </div>
              <div className="panel">
                <div className="row-between"><h2>Recent enquiries</h2><Link to="/admin/enquiries">See all →</Link></div>
                {d.recentEnquiries.length === 0 ? <p className="muted">No enquiries yet. They appear here when visitors use the contact or quote forms.</p> : (
                  <table className="tbl"><tbody>
                    {d.recentEnquiries.map((e) => <tr key={e.id}><td>{e.ref}</td><td>{e.name}{e.company && <small>{e.company}</small>}</td><td>{e.items.length} item{e.items.length === 1 ? "" : "s"}</td><td><Pill s={e.status} /></td></tr>)}
                  </tbody></table>
                )}
              </div>
            </div>
          )}
          {me.permissions.includes("catalog") && d.withoutPrice > 0 && <p className="notice">Tip: open <Link to="/admin/products">Products</Link> to type prices into the table, or use <strong>Export / Import CSV</strong> to fill them from a spreadsheet.</p>}
        </>
      )}</Loader>
    </>
  );
}
