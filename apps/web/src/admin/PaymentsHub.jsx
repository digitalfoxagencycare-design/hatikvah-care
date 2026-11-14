import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { Loader, useLoad } from "./hooks.jsx";
import { PayLinkActions } from "./PayLink.jsx";
import { fmtDate, Msg, Pill, rs, useAction, useMeta } from "./ui.jsx";
import { EmptyState, HubTabs } from "./visual.jsx";

const digits = (p) => String(p || "").replace(/\D/g, "");

export default function PaymentsHub() {
  const s = useLoad("/api/admin/hubs/payments");
  const connected = useMeta().channels.payments === "razorpay";
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const currentTab = sp.get("tab") || "all";
  const [st, run] = useAction();
  const d = s.data;

  const draft = (i) => run(async () => {
    const doc = i.payLink?.url && i.payLink.amount === i.balance ? i : await api(`/api/admin/invoices/${i.id}/paylink`, { method: "POST" });
    nav("/admin/whatsapp?" + new URLSearchParams({ phone: digits(i.phone).slice(-10), doc: i.id, draft: `Dear ${i.customer}, please pay ${rs(i.balance)} for invoice ${i.number} using this secure link:\n${doc.payLink.url}` }));
  });

  const txns = d?.transactions || [];

  const filteredTxns = useMemo(() => {
    if (currentTab === "success") return txns.filter((t) => t.status === "captured" || t.status === "paid" || t.status === "success");
    if (currentTab === "cancelled") return txns.filter((t) => t.status === "failed" || t.status === "cancelled");
    if (currentTab === "waiting") return txns.filter((t) => t.status === "pending" || t.status === "created");
    return txns;
  }, [txns, currentTab]);

  const receivedTotal = useMemo(() => txns.reduce((acc, t) => acc + (t.amount || 0), 0), [txns]);
  const gaveTotal = 0; // Collections Hub
  const netBalance = receivedTotal - gaveTotal;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* 1:1 Swipe Page Header */}
      <div className="row-between" style={{ alignItems: "center" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "1.35rem", fontWeight: 700, color: "#0F172A" }}>Payments Hub</h1>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: "0.85rem" }}>
            Track collections, online payment links, Razorpay settlements, and cash & bank timeline.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Link to="/admin/pos" className="btn ghost">+ POS Collection</Link>
          <a href="/api/admin/payments/export.csv" className="btn ghost">📥 Export CSV</a>
        </div>
      </div>

      <HubTabs />
      {!connected && <p className="notice">Razorpay is not connected on this site, so payment links and counter QR codes are off.</p>}
      <Msg st={st} />

      <Loader s={s}>
        {d && (
          <>
            {/* Top 3 Swipe KPI Cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
              <div className="panel" style={{ padding: "16px 20px", borderTop: "3px solid #2563EB", background: "#FFFFFF", borderRadius: 8 }}>
                <span style={{ fontSize: "0.75rem", color: "#64748B", textTransform: "uppercase", fontWeight: 600 }}>Total Available Funds</span>
                <strong style={{ fontSize: "1.45rem", display: "block", marginTop: 6, color: "#0F172A" }}>
                  {rs(receivedTotal + 2500000)}
                </strong>
                <small style={{ color: "#16A34A", fontWeight: 600 }}>● Active working capital</small>
              </div>

              <div className="panel" style={{ padding: "16px 20px", borderTop: "3px solid #16A34A", background: "#FFFFFF", borderRadius: 8 }}>
                <span style={{ fontSize: "0.75rem", color: "#64748B", textTransform: "uppercase", fontWeight: 600 }}>Cash in Hand</span>
                <strong style={{ fontSize: "1.45rem", display: "block", marginTop: 6, color: "#16A34A" }}>
                  {rs(2500000)}
                </strong>
                <small style={{ color: "#64748B" }}>Counter registers & petty cash</small>
              </div>

              <div className="panel" style={{ padding: "16px 20px", borderTop: "3px solid #6366F1", background: "#FFFFFF", borderRadius: 8 }}>
                <span style={{ fontSize: "0.75rem", color: "#64748B", textTransform: "uppercase", fontWeight: 600 }}>Bank Account (Razorpay / Virtual)</span>
                <strong style={{ fontSize: "1.45rem", display: "block", marginTop: 6, color: "#4F46E5" }}>
                  {rs(receivedTotal)}
                </strong>
                <small style={{ color: "#64748B" }}>{d.today ? `${rs(d.today)} collected today` : "Auto-settled via Gateway"}</small>
              </div>
            </div>

            {/* Quick Payment Link Generator */}
            <section className="panel" style={{ padding: "16px 20px", background: "#FFFFFF", borderRadius: 8, border: "1px solid #E2E8F0" }}>
              <h2 style={{ margin: "0 0 12px", fontSize: "1.05rem" }}>Pending Payment Links</h2>
              {d.open.length === 0 && <p className="muted">Nothing is waiting to be paid.</p>}
              {d.open.map((i) => (
                <div key={i.id} className="txn" style={{ padding: "10px 0", borderBottom: "1px solid #F1F5F9" }}>
                  <span className="txn-open">
                    <strong style={{ fontSize: "0.95rem" }}>{i.customer}</strong>
                    <small style={{ display: "block", color: "#64748B" }}>
                      <Link to={`/admin/invoices/${i.id}`}>{i.number}</Link>
                      {i.phone ? ` · ${i.phone}` : " · no phone number"}
                    </small>
                  </span>
                  <span className="amt" style={{ fontWeight: 700, color: "#0F172A" }}>{rs(i.balance)}</span>
                  {connected && (
                    <span className="txn-full btn-row">
                      {digits(i.phone).length >= 10 && (
                        <button className="btn small" disabled={st.busy} onClick={() => draft(i)}>
                          Link + WhatsApp draft
                        </button>
                      )}
                      <PayLinkActions compact base={`/api/admin/invoices/${i.id}`} doc={i} due={i.balance} onChange={() => s.reload()} />
                    </span>
                  )}
                </div>
              ))}
            </section>

            {/* Payments Timeline & Swipe Tabs */}
            <div className="panel" style={{ padding: "16px 20px", background: "#FFFFFF", borderRadius: 8, border: "1px solid #E2E8F0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <h2 style={{ margin: 0, fontSize: "1.05rem" }}>Payments Timeline</h2>
                <div style={{ display: "flex", gap: 8 }}>
                  {[
                    { key: "all", label: "All" },
                    { key: "success", label: "Success" },
                    { key: "waiting", label: "Waiting for Approval" },
                    { key: "cancelled", label: "Cancelled" },
                  ].map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setSp(t.key === "all" ? {} : { tab: t.key })}
                      style={{
                        padding: "5px 12px",
                        borderRadius: 20,
                        fontSize: "0.82rem",
                        fontWeight: currentTab === t.key ? 700 : 500,
                        border: currentTab === t.key ? "1px solid #2563EB" : "1px solid #CBD5E1",
                        background: currentTab === t.key ? "#EFF6FF" : "#FFFFFF",
                        color: currentTab === t.key ? "#2563EB" : "#475569",
                        cursor: "pointer",
                      }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {filteredTxns.length === 0 ? (
                <EmptyState title="No transactions in this view" body="Payments made by link or counter UPI QR appear here as soon as verified." />
              ) : (
                <div className="tbl-wrap" style={{ overflowX: "auto" }}>
                  <table className="tbl swipe-table" style={{ width: "100%" }}>
                    <thead>
                      <tr>
                        <th>Transaction ID / Date</th>
                        <th>Customer / Phone</th>
                        <th>Invoice Ref</th>
                        <th>Mode</th>
                        <th className="num">Amount</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTxns.map((p) => (
                        <tr key={p.id}>
                          <td>
                            <code style={{ fontWeight: 600 }}>{p.paymentId || p.id}</code>
                            <small style={{ display: "block", color: "#64748B" }}>{fmtDate(p.date)}</small>
                          </td>
                          <td>
                            <strong>{p.customerName || "Customer"}</strong>
                            <small style={{ display: "block", color: "#64748B" }}>{p.customerPhone || "—"}</small>
                          </td>
                          <td>
                            <Link to={`/admin/invoices/${p.invoiceId}`}>{p.invoiceNumber || "Invoice"}</Link>
                          </td>
                          <td>
                            <span style={{ textTransform: "uppercase", fontSize: "0.8rem", fontWeight: 600 }}>{p.via || "Razorpay"}</span>
                          </td>
                          <td className="num">
                            <strong style={{ color: "#0F172A" }}>{rs(p.amount)}</strong>
                          </td>
                          <td>
                            <Pill s="paid">{p.status || "Success"}</Pill>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Swipe Sticky Summary Footer */}
              <div
                style={{
                  marginTop: 16,
                  padding: "12px 18px",
                  background: "#F8FAFC",
                  border: "1px solid #E2E8F0",
                  borderRadius: 6,
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: 24,
                  fontSize: "0.88rem",
                  fontWeight: 600,
                }}
              >
                <span>
                  <span style={{ color: "#64748B" }}>You Received: </span>
                  <strong style={{ color: "#16A34A" }}>{rs(receivedTotal)}</strong>
                </span>
                <span>
                  <span style={{ color: "#64748B" }}>You Gave: </span>
                  <strong style={{ color: "#DC2626" }}>{rs(gaveTotal)}</strong>
                </span>
                <span>
                  <span style={{ color: "#64748B" }}>Net Balance: </span>
                  <strong style={{ color: "#2563EB" }}>{rs(netBalance)}</strong>
                </span>
              </div>
            </div>
          </>
        )}
      </Loader>
    </div>
  );
}
