import { Link, useSearchParams } from "react-router-dom";
import { DocList } from "./DocParts.jsx";
import { Loader, useLoad } from "./hooks.jsx";
import { fmtDate } from "./ui.jsx";

export default function Quotes() {
  const [sp, setSp] = useSearchParams();
  const status = sp.get("status") || "";
  const s = useLoad("/api/admin/quotes" + (status ? `?status=${status}` : ""));
  return (
    <>
      <div className="row-between"><h1>Quotations</h1><Link className="btn" to="/admin/quotes/new">+ New quotation</Link></div>
      <div className="toolbar"><select value={status} onChange={(e) => setSp(e.target.value ? { status: e.target.value } : {})} aria-label="Status"><option value="">All</option>{["draft", "sent", "accepted", "converted", "rejected", "expired"].map((x) => <option key={x}>{x}</option>)}</select></div>
      <Loader s={s}><DocList rows={s.data || []} base="/admin/quotes" cols={[["Valid until", (q) => fmtDate(q.validUntil)], ["Version", (q) => "v" + (q.version || 1)]]} /></Loader>
    </>
  );
}
