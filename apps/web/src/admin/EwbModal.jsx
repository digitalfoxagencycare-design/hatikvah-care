import { useState } from "react";
import { api, money } from "../api.js";
import { Modal, Msg, useAction } from "./ui.jsx";

export function EwbModal({ invoice, onClose, onUpdated }) {
  const [st, run] = useAction();
  const [vehicleNo, setVehicleNo] = useState(invoice.ewaybill?.vehicleNo || "");
  const [distance, setDistance] = useState(invoice.ewaybill?.distance || "");
  const [transporter, setTransporter] = useState("");
  const [manualEwb, setManualEwb] = useState(invoice.ewaybill?.ewbNo || "");

  const totalRs = (invoice.totals?.total || 0) / 100;
  const isThreshold = totalRs >= 50000;

  const cleanVeh = vehicleNo.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const isVehValid = !cleanVeh || /^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$/.test(cleanVeh);

  const handleDownloadJson = () => {
    const url = `/api/admin/invoices/${invoice.id}/ewaybill/json?vehicleNo=${encodeURIComponent(vehicleNo)}&distance=${encodeURIComponent(distance || "0")}&transporter=${encodeURIComponent(transporter)}`;
    window.open(url, "_blank");
  };

  const handleGenerate = () => {
    if (!isVehValid) {
      return alert("Invalid Vehicle Number format! Standard Indian vehicle numbers end in 4 digits (e.g. AP39SG9657). Please remove extra numbers.");
    }
    run(async () => {
      const res = await api(`/api/admin/invoices/${invoice.id}/ewaybill/generate`, {
        method: "POST",
        body: {
          vehicleNo: cleanVeh,
          transDistance: distance || "0",
          transporterName: transporter,
        },
      });

      if (res.ewbNo || res.ewaybill?.ewbNo) {
        if (onUpdated) onUpdated();
      } else if (res.govtJson) {
        handleDownloadJson();
      }
    }, "E-Way Bill generated from Govt Portal ✓");
  };

  const handleSaveManual = () => {
    if (!manualEwb.trim()) return alert("Please enter the 12-digit E-Way Bill number");
    run(async () => {
      await api(`/api/admin/invoices/${invoice.id}/ewaybill/save`, {
        method: "POST",
        body: {
          ewbNo: manualEwb.trim(),
          vehicleNo: vehicleNo.trim().toUpperCase(),
        },
      });
      if (onUpdated) onUpdated();
    }, "E-Way Bill number saved to invoice ✓");
  };

  return (
    <Modal title={`E-Way Bill Hub · ${invoice.number}`} onClose={onClose}>
      <div style={{ display: "grid", gap: 16, minWidth: 420 }}>
        <Msg st={st} />

        {/* Status banner */}
        <div
          style={{
            padding: 12,
            borderRadius: 6,
            background: invoice.ewaybill?.ewbNo ? "#f0fdf4" : isThreshold ? "#fffbeb" : "#f8fafc",
            border: `1px solid ${invoice.ewaybill?.ewbNo ? "#bbf7d0" : isThreshold ? "#fde68a" : "#e2e8f0"}`,
            fontSize: "0.85rem",
          }}
        >
          {invoice.ewaybill?.ewbNo ? (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <div>
                <strong style={{ color: "#166534", display: "block", marginBottom: 2 }}>
                  ✅ E-Way Bill Active: #{invoice.ewaybill.ewbNo}
                </strong>
                <span style={{ color: "#15803d" }}>
                  Vehicle: {invoice.ewaybill.vehicleNo || "N/A"} · Printed on invoice PDF
                </span>
              </div>
              <a
                href={`/doc/ewaybill/${invoice.token}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn sm"
                style={{ background: "#16a34a", color: "#fff", textDecoration: "none", fontWeight: 700, padding: "6px 12px", whiteSpace: "nowrap" }}
              >
                🖨️ View / Print Slip ↗
              </a>
            </div>
          ) : (
            <div>
              <strong>Invoice Value: {money(invoice.totals?.total || 0)}</strong>
              <span style={{ display: "block", marginTop: 2, color: isThreshold ? "#b45309" : "#64748b" }}>
                {isThreshold
                  ? "⚠️ Value exceeds ₹50,000 threshold. Government E-Way Bill is mandatory for dispatch."
                  : "ℹ️ Value is below ₹50,000. E-Way Bill is optional but supported."}
              </span>
            </div>
          )}
        </div>

        {/* Transport Details Form */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label className="field">
            <span>Vehicle Number *</span>
            <input
              type="text"
              placeholder="e.g. AP39SG9657"
              value={vehicleNo}
              onChange={(e) => setVehicleNo(e.target.value.toUpperCase())}
            />
          </label>
          <label className="field">
            <span>Distance (KM) · <small style={{ color: "#16a34a", fontWeight: "normal" }}>Auto PIN-to-PIN</small></span>
            <input
              type="text"
              placeholder="Auto (0 KM - Govt Database)"
              value={distance}
              onChange={(e) => setDistance(e.target.value)}
            />
          </label>
          {!isVehValid && cleanVeh.length > 0 && (
            <div style={{ gridColumn: "1 / -1", color: "#dc2626", fontSize: "0.8rem", background: "#fef2f2", padding: "6px 10px", borderRadius: 4 }}>
              ⚠️ Invalid format: Indian vehicle numbers end in 4 digits (e.g. <strong>AP39SG9657</strong>, not {cleanVeh})
            </div>
          )}
        </div>

        <label className="field">
          <span>Transporter Name / ID (Optional)</span>
          <input
            type="text"
            placeholder="e.g. Shadowfax, Porter, or Transporter GSTIN"
            value={transporter}
            onChange={(e) => setTransporter(e.target.value)}
          />
        </label>

        {/* Primary Action Buttons */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 4 }}>
          <button
            type="button"
            className="btn"
            onClick={handleGenerate}
            disabled={st.busy || !vehicleNo}
            style={{
              background: "#0284c7",
              borderColor: "#0284c7",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
          >
            ⚡ 1-Click Generate (API)
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

        {/* Manual Number Entry Option */}
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
            Generated directly on ewaybillgst.gov.in? Enter 12-digit number:
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="text"
              maxLength={12}
              placeholder="12-digit E-Way Bill No"
              value={manualEwb}
              onChange={(e) => setManualEwb(e.target.value.replace(/\D/g, ""))}
              style={{ flex: 1, fontFamily: "monospace" }}
            />
            <button
              type="button"
              className="btn"
              onClick={handleSaveManual}
              disabled={st.busy || !manualEwb.trim()}
            >
              Save to Invoice
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

