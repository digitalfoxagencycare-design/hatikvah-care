import { Link } from "react-router-dom";
import { Loader, useLoad } from "./hooks.jsx";
import { fmtDate } from "./ui.jsx";
import { useThumbs, VisualDocList } from "./visual.jsx";

export default function Purchases() {
  const s = useLoad("/api/admin/purchases");
  const map = useThumbs();
  return (
    <>
      <div className="row-between"><h1>Purchase orders</h1><Link className="btn" to="/admin/purchase-orders/new">+ New purchase order</Link></div>
      <p className="muted">Order stock from suppliers. When goods arrive, use “Receive” and the stock goes up.</p>
      <Loader s={s}>
        <VisualDocList rows={s.data || []} base="/admin/purchase-orders" map={map} who={(p) => p.supplierName} sub={(p) => (p.expectedDate ? `expected ${fmtDate(p.expectedDate)}` : `${p.items.length} item${p.items.length === 1 ? "" : "s"}`)} empty="No purchase orders yet." />
      </Loader>
    </>
  );
}
