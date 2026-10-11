import { Link } from "react-router-dom";
import { Loader, useLoad } from "./hooks.jsx";

export default function Dashboard() {
  const s = useLoad("/api/admin/dashboard");
  const d = s.data;
  return (
    <>
      <h1>Dashboard</h1>
      <Loader s={s}>{d && (
        <>
          <div className="tiles">
            <Link to="/admin/products" className="tile"><strong>{d.active}</strong><span>Live products</span><small>{d.products - d.active} hidden</small></Link>
            <Link to="/admin/products?filter=noprice" className={"tile" + (d.withoutPrice ? " warn" : "")}><strong>{d.withoutPrice}</strong><span>Products without a price</span><small>Shown as “Price on request”</small></Link>
            <Link to="/admin/enquiries" className={"tile" + (d.newEnquiries ? " hot" : "")}><strong>{d.newEnquiries}</strong><span>New enquiries</span><small>{d.totalEnquiries} in total</small></Link>
            <Link to="/admin/categories" className="tile"><strong>{d.categories}</strong><span>Categories</span><small>{d.withoutImage} products without photo</small></Link>
          </div>
          <div className="panel">
            <div className="row-between"><h2>Recent enquiries</h2><Link to="/admin/enquiries">See all →</Link></div>
            {d.recentEnquiries.length === 0 ? <p className="muted">No enquiries yet. They will appear here when visitors use the contact or quote forms.</p> : (
              <table className="tbl"><thead><tr><th>Ref</th><th>From</th><th>Items</th><th>Status</th></tr></thead><tbody>
                {d.recentEnquiries.map((e) => <tr key={e.id}><td>{e.ref}</td><td>{e.name}{e.company && <small> · {e.company}</small>}</td><td>{e.items.length}</td><td><span className={"pill " + e.status}>{e.status}</span></td></tr>)}
              </tbody></table>
            )}
          </div>
          {d.withoutPrice > 0 && <p className="notice">Tip: open <Link to="/admin/products">Products</Link> to type prices straight into the table, or use <strong>Export / Import CSV</strong> to fill them from a spreadsheet.</p>}
        </>
      )}</Loader>
    </>
  );
}
