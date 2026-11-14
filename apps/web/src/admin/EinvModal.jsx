import { useState } from "react";
import { api, money } from "../api.js";
import { Modal, Msg, useAction } from "./ui.jsx";

export function EinvModal({ invoice, onClose, onUpdated }) {
  const [st, run] = useAction();
  const [cancelReason, setCancelReason] = useState("1");
  const [cancelRemarks, setCancelRemarks] = useState("Order Cancelled");
  const [showCancelBox, setShowCancelBox] = useState(false);
  const [manualIrn, setManualIrn] = useState("");
  const [manualAck, setManualAck] = useState("");

  const einv = invoice.einvoice;
  const isActive = einv?.status === "active" && einv?.irn;
  const isCancelled = einv?.status === "cancelled";
  const customerGstin = (invoice.customer?.gstin || "").trim().toUpperCase();
  const isB2B = customerGstin && customerGstin !== "URP" && customerGstin.length === 15;

  const handleGenerate = () => {
    run(async () => {
      const res = await api(`/api/admin/invoices/${invoice.id}/einvoice/generate`, {
        method: "POST",
      });
      if (res.irn || res.einvoice?.irn) {
        if (onUpdated) onUpdated();
      }
    }, "Government E-Invoice (IRN) generated successfully ✓");
  };

  const handleDownloadJson = () => {
    window.open(`/api/admin/invoices/${invoice.id}/einvoice/json`, "_blank");
  };

  const handleCancel = () => {
    if (!confirm("Are you sure you want to cancel this E-Invoice on the Government portal? This cannot be undone.")) return;
    run(async () => {
      await api(`/api/admin/invoices/${invoice.id}/einvoice/cancel`, {
        method: "POST",
        body: { reason: cancelReason, remarks: cancelRemarks },
      });
      if (onUpdated) onUpdated();
    }, "E-Invoice cancelled on Govt IRP ✓");
  };

  const handleSaveManual = () => {
    if (!manualIrn.trim() || manualIrn.trim().length < 32) {
      return alert("Please enter a valid 64-character IRN hash");
    }
    run(async () => {
      await api(`/api/admin/invoices/${invoice.id}/einvoice/save`, {
        method: "POST",
        body: { irn: manualIrn.trim(), ackNo: manualAck.trim() },
      });
      if (onUpdated) onUpdated();
    }, "E-Invoice IRN saved to invoice ✓");
  };

  return (
    <Modal title={`E-Invoice Hub (IRP) · ${invoice.number}`} onClose={onClose}>
      <div style={{ display: "grid", gap: 16, minWidth: 440 }}>
        <Msg st={st} />

        {/* Status Banner */}
        <div
          style={{
            padding: "12px 16px",
            borderRadius: 6,
            background: isActive ? "#f0fdf4" : isCancelled ? "#fef2f2" : "#f8fafc",
            border: `1px solid ${isActive ? "#bbf7d0" : isCancelled ? "#fecaca" : "#e2e8f0"}`,
            fontSize: "0.85rem",
          }}
        >
          {isActive ? (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <strong style={{ color: "#166534", fontSize: "0.95rem" }}>
                  ✅ Government E-Invoice Active (IRP Verified)
                </strong>
                <a
                  href={`/doc/invoice/${invoice.token}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn sm"
                  style={{ background: "#16a34a", color: "#fff", textDecoration: "none", fontWeight: 700, padding: "4px 10px" }}
                >
                  🖨️ View Invoice Slip ↗
                </a>
              </div>
              <div style={{ marginTop: 8, fontSize: "0.8rem", color: "#166534" }}>
                <div><strong>Ack No:</strong> {einv.ackNo || "N/A"} · <strong>Date:</strong> {String(einv.ackDate || "").slice(0, 10)}</div>
                <div style={{ marginTop: 4, fontFamily: "monospace", wordBreak: "break-all", background: "#dcfce7", padding: "4px 8px", borderRadius: 4 }}>
                  <strong>IRN:</strong> {einv.irn}
                </div>
              </div>
            </div>
          ) : isCancelled ? (
            <div>
              <strong style={{ color: "#991b1b" }}>❌ E-Invoice Cancelled</strong>
              <div style={{ color: "#b91c1c", marginTop: 4, fontSize: "0.8rem" }}>
                Cancelled on {String(einv.cancelledAt || "").slice(0, 10)}: {einv.cancelRemarks || "Order Cancelled"}
              </div>
            </div>
          ) : (
            <div>
              <strong>Invoice Value: {money(invoice.totals?.total || 0)}</strong>
              <div style={{ marginTop: 4, color: isB2B ? "#0369a1" : "#64748b" }}>
                {isB2B
                  ? `🏢 B2B Supply to ${invoice.customer?.name} (GSTIN: ${customerGstin}) · Ready for IRP generation`
                  : `ℹ️ B2C / Retail Supply (${customerGstin || "URP"}). Government E-Invoice is standard for B2B.`}
              </div>
            </div>
          )}
        </div>

        {/* Action Buttons when Not Active */}
        {!isActive && !isCancelled && (
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 10 }}>
            <button
              type="button"
              className="btn"
              onClick={handleGenerate}
              disabled={st.busy}
              style={{
                background: "#0284c7",
                borderColor: "#0284c7",
                color: "#fff",
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              ⚡ 1-Click Generate (IRP)
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={handleDownloadJson}
              disabled={st.busy}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              📄 Download Govt JSON
            </button>
          </div>
        )}

        {/* Cancellation Option when Active */}
        {isActive && (
          <div>
            {!showCancelBox ? (
              <button
                type="button"
                className="btn ghost sm"
                onClick={() => setShowCancelBox(true)}
                style={{ color: "#dc2626", borderColor: "#fca5a5" }}
              >
                Cancel E-Invoice (Within 24 Hours)
              </button>
            ) : (
              <div style={{ background: "#fff1f2", padding: 12, borderRadius: 6, border: "1px solid #fecdd3", display: "grid", gap: 8 }}>
                <span style={{ fontSize: "0.82rem", fontWeight: 700, color: "#9f1239" }}>
                  Confirm IRP E-Invoice Cancellation:
                </span>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <select
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    style={{ fontSize: "0.82rem", padding: "4px 8px" }}
                  >
                    <option value="1">1 - Duplicate Invoice</option>
                    <option value="2">2 - Data Entry Mistake</option>
                    <option value="3">3 - Order Cancelled</option>
                    <option value="4">4 - Others</option>
                  </select>
                  <input
                    type="text"
                    placeholder="Remarks"
                    value={cancelRemarks}
                    onChange={(e) => setCancelRemarks(e.target.value)}
                    style={{ fontSize: "0.82rem", padding: "4px 8px" }}
                  >
                  </input>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                  <button
                    type="button"
                    className="btn sm"
                    onClick={handleCancel}
                    disabled={st.busy}
                    style={{ background: "#e11d48", color: "#fff" }}
                  >
                    Confirm Cancel on Govt IRP
                  </button>
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={() => setShowCancelBox(false)}
                  >
                    Keep Active
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Manual IRN Entry */}
        {!isActive && !isCancelled && (
          <div
            style={{
              marginTop: 10,
              paddingTop: 12,
              borderTop: "1px dashed #cbd5e1",
              display: "grid",
              gap: 8,
            }}
          >
            <span style={{ fontSize: "0.8rem", color: "#64748b", fontWeight: 600 }}>
              Generated directly on einvoice1.gst.gov.in? Enter 64-char IRN:
            </span>
            <input
              type="text"
              placeholder="64-character IRN Hash"
              value={manualIrn}
              onChange={(e) => setManualIrn(e.target.value)}
              style={{ fontFamily: "monospace", fontSize: "0.8rem" }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                placeholder="Acknowledgement No (Optional)"
                value={manualAck}
                onChange={(e) => setManualAck(e.target.value)}
                style={{ flex: 1, fontSize: "0.82rem" }}
              />
              <button
                type="button"
                className="btn sm"
                onClick={handleSaveManual}
                disabled={st.busy || !manualIrn.trim()}
              >
                Save IRN
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
