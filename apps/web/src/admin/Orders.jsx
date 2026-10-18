import { Link, useSearchParams } from "react-router-dom";
import { DocList } from "./DocParts.jsx";
import { Loader, useLoad } from "./hooks.jsx";
import { fmtDate } from "./ui.jsx";

export default function Orders() {
  const [sp, setSp] = useSearchParams();
  const status = sp.get("status") || "";
  const s = useLoad("/api/admin/orders" + (status ? `?status=${status}` : ""));
  return (
    <>
      <div className="row-between"><h1>Sales orders</h1><Link className="btn" to="/admin/orders/new">+ New order</Link></div>
      <p className="muted">Orders are created from accepted quotations (automatically when the customer accepts online) or by hand. Dispatch prints a delivery challan and takes stock out; then raise the invoice.</p>
      <div className="toolbar"><select value={status} onChange={(e) => setSp(e.target.value ? { status: e.target.value } : {})} aria-label="Status"><option value="">All</option>{["confirmed", "packed", "dispatched", "delivered", "cancelled"].map((x) => <option key={x}>{x}</option>)}</select></div>
      <Loader s={s}><DocList rows={s.data || []} base="/admin/orders" cols={[["Source", (o) => (o.source === "website" ? `Website · ${o.paymentStatus === "paid" ? "paid" : o.paymentStatus === "pending" ? "awaiting payment" : "pay later"}` : "—")], ["Expected", (o) => (o.expectedDate ? fmtDate(o.expectedDate) : "—")], ["Invoice", (o) => o.invoiceNumber || "—"]]} /></Loader>
    </>
  );
}
