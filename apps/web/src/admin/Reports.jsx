import { useState } from "react";
import { Link } from "react-router-dom";
import { Loader, useLoad } from "./hooks.jsx";
import { Bars, rs, today } from "./ui.jsx";

const fyStart = () => { const t = today(), y = Number(t.slice(0, 4)); return `${Number(t.slice(5, 7)) >= 4 ? y : y - 1}-04-01`; };
export default function Reports() {
  const [rg, setRg] = useState({ from: fyStart(), to: today() });
  const q = `from=${rg.from}&to=${rg.to}`;
  const s = useLoad(`/api/admin/reports?${q}`);
  const d = s.data;
  const pct = (a, b) => (b ? Math.round((100 * a) / b) + "%" : "—");
  return (
    <>
      <h1>Reports</h1>
      <div className="toolbar">
        <label className="check-inline">From <input type="date" value={rg.from} onChange={(e) => setRg({ ...rg, from: e.target.value })} /></label>
        <label className="check-inline">To <input type="date" value={rg.to} onChange={(e) => setRg({ ...rg, to: e.target.value })} /></label>
        <button className="btn ghost small" onClick={() => setRg({ from: today().slice(0, 8) + "01", to: today() })}>This month</button>
        <button className="btn ghost small" onClick={() => setRg({ from: fyStart(), to: today() })}>This financial year</button>
      </div>
      <Loader s={s}>{d && (
        <>
          <div className="tiles">
            <div className="tile"><strong>{rs(d.totals.invoiced)}</strong><span>Invoiced (incl. GST)</span><small>{d.totals.invoices} invoices · avg {rs(d.totals.avgInvoice)}</small></div>
            <div className="tile"><strong>{rs(d.totals.taxable)}</strong><span>Sales before tax</span><small>GST {rs(d.totals.tax)}</small></div>
            <div className="tile"><strong>{rs(d.totals.received)}</strong><span>Received</span></div>
            <div className="tile warn"><strong>{rs(d.totals.outstanding)}</strong><span>Outstanding today</span><small><Link to="/admin/invoices?status=overdue">overdue invoices →</Link></small></div>
          </div>
          <div className="grid2 top">
            <div className="panel"><h2>Sales by month</h2>{d.months.length ? <Bars rows={d.months} value={(m) => m.invoiced} label={(m) => m.month} /> : <p className="muted">No invoices in this period.</p>}
              {d.months.length > 0 && <table className="tbl"><thead><tr><th>Month</th><th className="num">Invoiced</th><th className="num">Received</th></tr></thead><tbody>{d.months.map((m) => <tr key={m.month}><td>{m.month}</td><td className="num">{rs(m.invoiced)}</td><td className="num">{rs(m.received)}</td></tr>)}</tbody></table>}</div>
            <div className="panel"><h2>Sales funnel</h2>
              <table className="tbl"><tbody>
                <tr><td>Enquiries</td><td className="num">{d.funnel.enquiries}</td><td></td></tr>
                <tr><td>Quotations made</td><td className="num">{d.funnel.quotes}</td><td className="muted">{pct(d.funnel.quotes, d.funnel.enquiries)} of enquiries</td></tr>
                <tr><td>Quotations accepted</td><td className="num">{d.funnel.accepted}</td><td className="muted">{pct(d.funnel.accepted, d.funnel.quotesSent)} of sent</td></tr>
                <tr><td>Orders</td><td className="num">{d.funnel.orders}</td><td></td></tr>
                <tr><td>Invoices</td><td className="num">{d.funnel.invoices}</td><td></td></tr>
              </tbody></table>
              <h3>Where enquiries come from</h3>{d.sources.length ? <Bars rows={d.sources} value={(x) => x.count} label={(x) => x.source} fmt={(n) => n} /> : <p className="muted">No enquiries in this period.</p>}
            </div>
            <div className="panel"><h2>Top customers</h2>{d.topCustomers.length ? <Bars rows={d.topCustomers} value={(c) => c.total} label={(c) => <Link to={`/admin/customers/${c.customerId}`}>{c.name}</Link>} /> : <p className="muted">—</p>}</div>
            <div className="panel"><h2>Sales by category</h2>{d.categories.length ? <Bars rows={d.categories} value={(c) => c.taxable} label={(c) => c.name} /> : <p className="muted">—</p>}</div>
            <div className="panel"><h2>Top products</h2><table className="tbl"><thead><tr><th>Product</th><th className="num">Qty</th><th className="num">Sales</th></tr></thead><tbody>{d.topProducts.map((p) => <tr key={p.sku + p.name}><td>{p.name}<small>{p.sku}</small></td><td className="num">{p.qty.toLocaleString("en-IN")}</td><td className="num">{rs(p.taxable)}</td></tr>)}</tbody></table></div>
            <div className="panel"><h2>Money owed by age</h2>
              <table className="tbl"><tbody>{[["Not yet due", "current"], ["1–30 days late", "d30"], ["31–60 days late", "d60"], ["61–90 days late", "d90"], ["Over 90 days", "d90plus"]].map(([l, k]) => <tr key={k}><td>{l}</td><td className={"num" + (k !== "current" && d.aging[k] ? " due" : "")}>{rs(d.aging[k])}</td></tr>)}</tbody></table>
              <h3>Team</h3><table className="tbl"><thead><tr><th>Person</th><th>Leads</th><th>Won</th><th>Quotes</th><th className="num">Converted</th></tr></thead><tbody>{d.staff.map((x) => <tr key={x.name}><td>{x.name}</td><td>{x.enquiries}</td><td>{x.won}</td><td>{x.quotes}</td><td className="num">{rs(x.converted)}</td></tr>)}</tbody></table>
            </div>
          </div>
          <div className="panel">
            <h2>Downloads for your accountant</h2>
            <p className="muted">CSV files open in Excel and can be imported into Tally / Zoho Books (via their import templates) or used for GSTR-1.</p>
            <div className="btn-row">
              <a className="btn ghost" href={`/api/admin/reports/sales-register.csv?${q}`}>GST sales register</a>
              <a className="btn ghost" href={`/api/admin/reports/hsn-summary.csv?${q}`}>HSN summary</a>
              <a className="btn ghost" href={`/api/admin/reports/payments.csv?${q}`}>Payments received</a>
              <a className="btn ghost" href="/api/admin/reports/receivables.csv">Receivables (today)</a>
              <a className="btn ghost" href="/api/admin/reports/stock.csv">Stock & value</a>
            </div>
          </div>
        </>
      )}</Loader>
    </>
  );
}
