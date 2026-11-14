import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { DocList } from "./DocParts.jsx";
import { Loader, useLoad } from "./hooks.jsx";
import { DISPATCH_LABEL, dispatchable, DispatchModal } from "./Logistics.jsx";
import { PayLinkActions } from "./PayLink.jsx";
import { fmtDate, rs } from "./ui.jsx";

const TABS = [
  { key: "all", label: "All Orders" },
  { key: "confirmed", label: "Confirmed" },
  { key: "packed", label: "Packed" },
  { key: "dispatched", label: "Dispatched" },
  { key: "delivered", label: "Delivered" },
  { key: "cancelled", label: "Cancelled" },
];

export default function Orders() {
  const [sp, setSp] = useSearchParams();
  const [dispatchId, setDispatchId] = useState(null);
  const currentTab = sp.get("status") || "all";
  const s = useLoad("/api/admin/orders");

  const allOrders = s.data || [];

  const filtered = useMemo(() => {
    if (currentTab === "all") return allOrders;
    return allOrders.filter((o) => o.status === currentTab);
  }, [allOrders, currentTab]);

  const totalValue = useMemo(() => {
    return filtered.reduce((acc, o) => acc + (o.totals?.total || 0), 0);
  }, [filtered]);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* 1:1 Swipe Page Header */}
      <div className="row-between" style={{ alignItems: "center" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "1.35rem", fontWeight: 700, color: "#0F172A" }}>Sales Orders & Fulfillment</h1>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: "0.85rem" }}>
            Manage warehouse packing, delivery challans, and courier dispatch.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Link className="btn" to="/admin/orders/new">+ New Order</Link>
        </div>
      </div>

      {/* Swipe Status Tabs */}
      <div style={{ display: "flex", gap: 8, overflowX: "auto", borderBottom: "1px solid #E2E8F0", paddingBottom: 6 }}>
        {TABS.map((t) => {
          const isSelected = currentTab === t.key;
          const count = t.key === "all" ? allOrders.length : allOrders.filter((o) => o.status === t.key).length;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setSp(t.key === "all" ? {} : { status: t.key })}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 14px",
                borderRadius: "6px 6px 0 0",
                fontSize: "0.85rem",
                fontWeight: isSelected ? 700 : 500,
                border: "none",
                background: isSelected ? "#2563EB" : "#F1F5F9",
                color: isSelected ? "#FFFFFF" : "#475569",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              <span>{t.label}</span>
              <span style={{ fontSize: "0.72rem", padding: "1px 6px", borderRadius: 10, background: isSelected ? "rgba(255,255,255,0.25)" : "#E2E8F0", color: isSelected ? "#FFF" : "#64748B" }}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <Loader s={s}>
        <div className="panel" style={{ padding: 0, background: "#FFFFFF", borderRadius: 8, border: "1px solid #E2E8F0", overflow: "hidden" }}>
          <DocList
            rows={filtered}
            base="/admin/orders"
            cols={[
              ["Source", (o) => (o.source === "website" ? `Website · ${o.paymentStatus === "paid" ? "paid" : o.paymentStatus === "pending" ? "awaiting payment" : "pay later"}` : "Manual")],
              ["Expected", (o) => (o.expectedDate ? fmtDate(o.expectedDate) : "—")],
              ["Invoice", (o) => o.invoiceNumber || "—"],
              ["Dispatch", (o) => (dispatchable(o) ? <button type="button" className="btn small" onClick={(e) => { e.stopPropagation(); setDispatchId(o.id); }}>{DISPATCH_LABEL}</button> : o.shipment?.awb ? <span style={{ fontSize: "0.78rem", color: "#2563EB", fontWeight: 600 }}>AWB {o.shipment.awb}</span> : "—")],
              ["Pay link", (o) => (!o.invoiceId && o.status !== "cancelled" && o.paymentStatus !== "paid" ? <PayLinkActions compact base={`/api/admin/orders/${o.id}`} doc={o} due={o.totals?.total} onChange={() => s.reload()} /> : "—")],
            ]}
          />

          {/* Swipe Sticky Summary Footer */}
          <div
            style={{
              padding: "12px 18px",
              background: "#F8FAFC",
              borderTop: "1px solid #E2E8F0",
              display: "flex",
              justifyContent: "flex-end",
              gap: 24,
              fontSize: "0.88rem",
              fontWeight: 600,
            }}
          >
            <span>
              <span style={{ color: "#64748B" }}>Total Orders: </span>
              <strong style={{ color: "#0F172A" }}>{filtered.length}</strong>
            </span>
            <span>
              <span style={{ color: "#64748B" }}>Total Value: </span>
              <strong style={{ color: "#16A34A" }}>{rs(totalValue)}</strong>
            </span>
          </div>
        </div>
      </Loader>

      {dispatchId && <DispatchModal id={dispatchId} onClose={() => { setDispatchId(null); s.reload(); }} />}
    </div>
  );
}
