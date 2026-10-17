import { Link } from "react-router-dom";
import { DocList } from "./DocParts.jsx";
import { Loader, useLoad } from "./hooks.jsx";
import { fmtDate } from "./ui.jsx";

export default function Purchases() {
  const s = useLoad("/api/admin/purchases");
  return (
    <>
      <div className="row-between"><h1>Purchase orders</h1><Link className="btn" to="/admin/purchases/new">+ New purchase order</Link></div>
      <p className="muted">Order stock from suppliers. When goods arrive, use “Receive” and the stock goes up.</p>
      <Loader s={s}><DocList rows={s.data || []} base="/admin/purchases" cols={[["Items", (p) => p.items.length], ["Expected", (p) => (p.expectedDate ? fmtDate(p.expectedDate) : "—")]]} /></Loader>
    </>
  );
}
