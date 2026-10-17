import { Link } from "react-router-dom";
import { useMe } from "./AdminApp.jsx";
import { Loader, useLoad } from "./hooks.jsx";
import { fmtDate, Pill, rs } from "./ui.jsx";

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
            {"lowStock" in d && <Tile to="/admin/stock?filter=low" n={d.lowStock} label="Items low on stock" tone={d.lowStock ? "warn" : ""} />}
            {me.permissions.includes("catalog") && <Tile to="/admin/products?filter=noprice" n={d.withoutPrice} label="Products without a price" sub={`${d.active} live products`} tone={d.withoutPrice ? "warn" : ""} />}
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
