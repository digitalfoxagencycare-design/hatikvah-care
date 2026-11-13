import { useState } from "react";
import { api } from "../api.js";

/**
 * Reusable GSTIN Input with Instant Government Taxpayer Auto-Fetch.
 * Automatically fetches legal name, trade name, address, state, city & PIN from Sandbox/GST portal.
 */
export function GstinInput({ value = "", onChange, onFetched, label = "GSTIN", placeholder = "36ABCDE1234F1Z5" }) {
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState(null); // { type: 'success' | 'error', text: '' }

  const handleFetch = async (targetGstin) => {
    const clean = String(targetGstin || value || "").trim().toUpperCase();
    if (clean.length !== 15) {
      setFeedback({ type: "error", text: "Please enter a complete 15-character GSTIN" });
      return;
    }

    setLoading(true);
    setFeedback(null);
    try {
      const data = await api(`/api/admin/gstin/${clean}`);
      setFeedback({
        type: "success",
        text: `✓ Verified: ${data.legalName || data.name} (${data.status})`,
      });
      if (onFetched) {
        onFetched(data);
      }
    } catch (err) {
      setFeedback({
        type: "error",
        text: err.message || "Failed to fetch GST details",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    const val = e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 15);
    onChange(val);
    setFeedback(null);

    // Auto-trigger fetch when exactly 15 valid characters are entered
    if (val.length === 15) {
      handleFetch(val);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label className="field" style={{ margin: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>{label}</span>
          <button
            type="button"
            onClick={() => handleFetch(value)}
            disabled={loading || value.length < 15}
            style={{
              background: "none",
              border: "none",
              color: value.length === 15 ? "#0284c7" : "#94a3b8",
              cursor: value.length === 15 ? "pointer" : "default",
              fontSize: "0.78rem",
              fontWeight: 600,
              padding: "0 2px",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            {loading ? "⏳ Fetching..." : "⚡ Auto-Fill"}
          </button>
        </div>
        <div style={{ position: "relative" }}>
          <input
            type="text"
            maxLength={15}
            value={value}
            onChange={handleChange}
            placeholder={placeholder}
            style={{
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              fontFamily: "monospace",
              width: "100%",
            }}
          />
        </div>
      </label>

      {feedback && (
        <div
          style={{
            fontSize: "0.75rem",
            padding: "2px 6px",
            borderRadius: 4,
            background: feedback.type === "success" ? "#f0fdf4" : "#fef2f2",
            color: feedback.type === "success" ? "#166534" : "#991b1b",
            border: `1px solid ${feedback.type === "success" ? "#bbf7d0" : "#fecaca"}`,
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          {feedback.text}
        </div>
      )}
    </div>
  );
}

