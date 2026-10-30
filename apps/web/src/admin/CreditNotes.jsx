import { Link, useSearchParams } from "react-router-dom";
import { Loader, useLoad } from "./hooks.jsx";
import { fmtDate, rs } from "./ui.jsx";

/** All GST credit notes, newest first. Issue one from the invoice it reduces (Invoice → Issue credit note). */
export default function CreditNotes() {
  const [sp] = useSearchParams();
  const inv = sp.get("invoiceId") || "";
  const s = useLoad(`/api/admin/credit-notes${inv ? `?invoiceId=${inv}` : ""}`);
  const total = (s.data || []).reduce((n, c) => n + c.totals.total, 0);
  return (
    <>
      <div className="row-between"><h1>Credit notes</h1><a className="btn ghost" href="/api/admin/reports/credit-notes.csv">Export CSV (GSTR-1)</a></div>
      <p className="muted">Sales returns and price adjustments. To issue one, open the invoice and choose <strong>Issue credit note</strong>. {inv && <Link to="/admin/credit-notes">Show all</Link>}</p>
      <Loader s={s}>
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>Credit note</th><th>Customer</th><th>Invoice</th><th>Reason</th><th className="num">Taxable</th><th className="num">GST</th><th className="num">Total</th><th></th></tr></thead>
          <tbody>
            {s.data?.map((c) => (
              <tr key={c.id}>
                <td><strong>{c.number}</strong><small>{fmtDate(c.date)}</small></td>
                <td>{c.customerName}</td>
                <td><Link to={`/admin/invoices/${c.invoiceId}`}>{c.invoiceNumber}</Link></td>
                <td>{c.reason.replace(/_/g, " ")}{c.restock && <small>goods back in stock</small>}</td>
                <td className="num">{rs(c.totals.taxable)}</td>
                <td className="num">{rs(c.totals.tax)}<small>{c.totals.igst ? "IGST" : "CGST + SGST"}</small></td>
                <td className="num">{rs(c.totals.total)}</td>
                <td><a href={`/doc/creditnote/${c.token}`} target="_blank" rel="noopener noreferrer">View / print</a></td>
              </tr>
            ))}
            {s.data?.length === 0 && <tr><td colSpan="8" className="muted">No credit notes yet.</td></tr>}
          </tbody>
          {s.data?.length > 0 && <tfoot><tr><td colSpan="6">Total credited</td><td className="num"><strong>{rs(total)}</strong></td><td></td></tr></tfoot>}
        </table></div>
      </Loader>
    </>
  );
}
