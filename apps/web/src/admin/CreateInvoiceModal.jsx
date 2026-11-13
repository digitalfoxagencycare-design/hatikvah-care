import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { CustomerPicker } from "./CustomerPicker.jsx";
import { InvoiceLinePicker } from "./InvoiceLinePicker.jsx";
import { calcTotals, Modal, Msg, rs, StateSelect, toPaise, useAction, useAsync, useMeta } from "./ui.jsx";
import { Icon } from "./visual.jsx";

export function CreateInvoiceModal({ draft, onClose, onCreated }) {
  const meta = useMeta();
  const company = useAsync("/api/admin/settings");
  const nav = useNavigate();
  const [st, run] = useAction();

  const [f, setF] = useState(() => ({
    draftId: draft?.id || "",
    customerId: draft?.customerId || "",
    placeOfSupply: draft?.placeOfSupply || "",
    date: draft?.date || new Date().toISOString().slice(0, 10),
    dueDate: draft?.dueDate || "",
    poNumber: draft?.poNumber || "",
    notes: draft?.notes || "",
    items: (draft?.items || []).map((it) => ({
      productId: it.productId || "",
      sku: it.sku || "",
      name: it.name,
      image: it.image || "",
      hsn: it.hsn || "",
      unit: it.unit || "pcs",
      qty: it.qty || 1,
      rate: it.rate || 0,
      discountPct: it.discountPct || 0,
      gstRate: it.gstRate ?? 18,
      uom: it.uom || "piece",
      perUnit: it.perUnit || 1,
    })),
  }));

  const [customerObj, setCustomerObj] = useState(draft?.customer || null);
  const rates = useAsync(`/api/admin/rates${f.customerId ? `?customerId=${f.customerId}` : ""}`);

  const pos = f.placeOfSupply || customerObj?.stateCode || company.data?.stateCode || "";
  const interState = Boolean(company.data?.stateCode && pos && pos !== company.data.stateCode);

  const t = useMemo(() => calcTotals(f.items, interState), [f.items, interState]);

  const addLine = (newLine) => {
    setF((prev) => ({
      ...prev,
      items: [...prev.items, newLine],
    }));
  };

  const updateLine = (idx, field, value) => {
    setF((prev) => ({
      ...prev,
      items: prev.items.map((it, i) => (i === idx ? { ...it, [field]: value } : it)),
    }));
  };

  const removeLine = (idx) => {
    setF((prev) => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== idx),
    }));
  };

  const cleanItems = (items) =>
    items.map((it) => ({
      productId: it.productId || "",
      sku: it.sku || "",
      name: it.name,
      hsn: String(it.hsn || "").replace(/\D/g, ""),
      unit: it.unit || "pcs",
      qty: Math.max(0.001, Number(it.qty) || 1),
      rate: Math.round(Number(it.rate) || 0),
      discountPct: Math.max(0, Math.min(100, Number(it.discountPct) || 0)),
      gstRate: Number(it.gstRate) || 18,
      uom: it.uom || "piece",
      perUnit: Math.max(1, Number(it.perUnit) || 1),
    }));

  const handleSaveDraft = () => {
    if (!f.customerId) return alert("Please select a customer first.");
    if (f.items.length === 0) return alert("Please add at least one product item.");

    run(async () => {
      const endpoint = f.draftId ? `/api/admin/invoices/draft/${f.draftId}` : "/api/admin/invoices/draft";
      const method = f.draftId ? "PUT" : "POST";
      const payload = {
        draftId: f.draftId || undefined,
        customerId: f.customerId,
        placeOfSupply: pos,
        date: f.date,
        dueDate: f.dueDate || undefined,
        poNumber: f.poNumber,
        notes: f.notes,
        items: cleanItems(f.items),
      };
      const res = await api(endpoint, { method, body: payload });
      if (onCreated) onCreated(res, "draft");
      else nav(`/admin/invoices/${res.id}`);
    }, "Draft invoice saved ✓");
  };

  const handleIssue = (actionType = "view") => {
    if (!f.customerId) return alert("Please select a customer first.");
    if (f.items.length === 0) return alert("Please add at least one product item.");

    run(async () => {
      let issued;
      if (f.draftId) {
        // Issue existing draft
        issued = await api(`/api/admin/invoices/${f.draftId}/issue`, {
          method: "POST",
          body: { date: f.date, dueDate: f.dueDate || undefined },
        });
      } else {
        // Create directly
        const payload = {
          customerId: f.customerId,
          placeOfSupply: pos,
          date: f.date,
          dueDate: f.dueDate || undefined,
          poNumber: f.poNumber,
          notes: f.notes,
          items: cleanItems(f.items),
        };
        issued = await api("/api/admin/invoices", { method: "POST", body: payload });
      }

      if (actionType === "print") {
        window.open(`/doc/invoice/${issued.token}`, "_blank");
      } else if (actionType === "whatsapp") {
        const phone = issued.customer?.phone?.replace(/\D/g, "");
        const waPhone = phone?.length === 10 ? `91${phone}` : phone;
        const total = (issued.totals.total / 100).toFixed(2);
        const link = `${window.location.origin}/doc/invoice/${issued.token}`;
        const msg = `Hello ${issued.customer?.name || "Customer"},\nPlease find your GST Invoice ${issued.number} for ₹${total} from HaTikvah Care.\nView & download here: ${link}`;
        if (waPhone) window.open(`https://wa.me/${waPhone}?text=${encodeURIComponent(msg)}`, "_blank");
      }

      if (onCreated) onCreated(issued, "issued");
      else nav(`/admin/invoices/${issued.id}`);
    }, "Invoice issued successfully ✓");
  };

  return (
    <div
      style={{
        background: "var(--bg-surface, #fff)",
        borderRadius: 10,
        border: "1px solid var(--border-subtle, #e2e8f0)",
        padding: 24,
        maxWidth: 1200,
        margin: "0 auto",
      }}
    >
      {/* Header bar matching Swipe */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: "1px solid var(--border-subtle, #e2e8f0)",
          paddingBottom: 16,
          marginBottom: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {onClose && (
            <button
              type="button"
              className="btn ghost"
              onClick={onClose}
              style={{ padding: "6px 12px", fontSize: "0.85rem" }}
            >
              ← Back
            </button>
          )}
          <div>
            <h2 style={{ margin: 0, fontSize: "1.3rem", fontWeight: 700 }}>
              {draft ? `Edit Draft (${draft.number})` : "Create Invoice"}
            </h2>
            <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
              {company.data?.name || "M/s. EXL MARKETING / HaTikvah Care"}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              padding: "4px 12px",
              background: "#f1f5f9",
              borderRadius: 6,
              fontSize: "0.85rem",
              fontWeight: 600,
            }}
          >
            Series: <span style={{ color: "#b45309" }}>{draft ? draft.number : "INV2627 / [Auto on Issue]"}</span>
          </div>
          <span className="pill" style={{ background: "#dcfce7", color: "#166534" }}>
            Type: Regular
          </span>
        </div>
      </div>

      <Msg st={st} />

      {/* Top Details Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 16,
          background: "#f8fafc",
          padding: 16,
          borderRadius: 8,
          marginBottom: 24,
          border: "1px solid #f1f5f9",
        }}
      >
        <div>
          <CustomerPicker
            value={f.customerId}
            onChange={(id, cust) => {
              setF((prev) => ({
                ...prev,
                customerId: id,
                placeOfSupply: cust?.stateCode || prev.placeOfSupply,
              }));
              setCustomerObj(cust);
            }}
          />
        </div>

        <div>
          <label className="field">
            <span>Invoice Date</span>
            <input
              type="date"
              value={f.date}
              onChange={(e) => setF({ ...f, date: e.target.value })}
              style={{ width: "100%", padding: "7px 10px" }}
            />
          </label>
        </div>

        <div>
          <label className="field">
            <span>Due Date</span>
            <input
              type="date"
              value={f.dueDate}
              placeholder="Blank = Customer terms"
              onChange={(e) => setF({ ...f, dueDate: e.target.value })}
              style={{ width: "100%", padding: "7px 10px" }}
            />
          </label>
        </div>

        <div>
          <label className="field">
            <span>Reference / PO Number</span>
            <input
              type="text"
              placeholder="e.g. PO-8921, Hotel Order #12"
              value={f.poNumber}
              onChange={(e) => setF({ ...f, poNumber: e.target.value })}
              style={{ width: "100%", padding: "7px 10px" }}
            />
          </label>
        </div>

        <div>
          <label className="field">
            <span>Place of Supply</span>
            <StateSelect value={pos} onChange={(v) => setF({ ...f, placeOfSupply: v })} />
          </label>
        </div>
      </div>

      {/* Products & Services Section */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700 }}>Products & Services</h3>
          <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
            {interState ? "⚡ Inter-State Supply (IGST Applicable)" : "Intra-State Supply (CGST + SGST Applicable)"}
          </span>
        </div>

        {/* Barcode & Product Search Bar */}
        <InvoiceLinePicker rates={rates.data || []} onAddLine={addLine} />

        {/* Lines Table */}
        <div className="tbl-wrap" style={{ borderRadius: 6, border: "1px solid #e2e8f0" }}>
          <table className="tbl" style={{ width: "100%", fontSize: "0.88rem" }}>
            <thead>
              <tr style={{ background: "#f8fafc", color: "#64748b" }}>
                <th style={{ width: 40, textAlign: "center" }}>#</th>
                <th>Item Description</th>
                <th style={{ width: 90 }}>HSN</th>
                <th style={{ width: 85 }}>Unit</th>
                <th style={{ width: 80, textAlign: "center" }}>Qty</th>
                <th style={{ width: 110, textAlign: "right" }}>Rate (₹)</th>
                <th style={{ width: 80, textAlign: "center" }}>Disc %</th>
                <th style={{ width: 110, textAlign: "right" }}>Taxable</th>
                <th style={{ width: 80, textAlign: "center" }}>GST %</th>
                <th style={{ width: 120, textAlign: "right" }}>Total</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {f.items.length === 0 ? (
                <tr>
                  <td colSpan={11} style={{ textAlign: "center", padding: "30px 10px", color: "var(--text-muted)" }}>
                    No items in invoice yet. Use the search bar above or scan barcodes to add items.
                  </td>
                </tr>
              ) : (
                f.items.map((line, idx) => {
                  const g = Math.round((Number(line.rate) || 0) * (Number(line.qty) || 0));
                  const d = Math.round((g * (Number(line.discountPct) || 0)) / 100);
                  const taxVal = g - d;
                  const tax = Math.round((taxVal * (Number(line.gstRate) || 0)) / 100);
                  const rowTot = taxVal + tax;

                  return (
                    <tr key={idx} style={{ height: 44 }}>
                      <td style={{ textAlign: "center", color: "var(--text-muted)", fontSize: "0.8rem" }}>{idx + 1}</td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          {line.image ? (
                            <img
                              src={line.image}
                              alt={line.name}
                              style={{
                                width: 34,
                                height: 34,
                                objectFit: "contain",
                                borderRadius: 4,
                                border: "1px solid #e2e8f0",
                                background: "#ffffff",
                                flexShrink: 0,
                              }}
                            />
                          ) : (
                            <div
                              style={{
                                width: 34,
                                height: 34,
                                borderRadius: 4,
                                background: "#f8fafc",
                                border: "1px solid #e2e8f0",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: "14px",
                                color: "#94a3b8",
                                flexShrink: 0,
                              }}
                            >
                              📦
                            </div>
                          )}
                          <div style={{ minWidth: 0 }}>
                            <strong style={{ display: "block", fontSize: "0.9rem" }}>{line.name}</strong>
                            {line.sku && <small style={{ color: "var(--text-muted)" }}>SKU: {line.sku}</small>}
                          </div>
                        </div>
                      </td>
                      <td>
                        <input
                          type="text"
                          value={line.hsn}
                          onChange={(e) => updateLine(idx, "hsn", e.target.value)}
                          style={{ width: "100%", padding: "4px 6px", fontSize: "0.85rem" }}
                        />
                      </td>
                      <td>
                        <span style={{ fontSize: "0.82rem", color: "var(--text-secondary)" }}>{line.unit || "pcs"}</span>
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <input
                          type="number"
                          min={1}
                          value={line.qty}
                          onChange={(e) => updateLine(idx, "qty", Math.max(1, parseFloat(e.target.value) || 1))}
                          style={{ width: 65, textAlign: "center", padding: "4px 6px", fontWeight: 600 }}
                        />
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <input
                          type="number"
                          step="0.01"
                          value={(line.rate / 100).toFixed(2)}
                          onChange={(e) => updateLine(idx, "rate", toPaise(e.target.value))}
                          style={{ width: 85, textAlign: "right", padding: "4px 6px" }}
                        />
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={line.discountPct}
                          onChange={(e) => updateLine(idx, "discountPct", Math.max(0, parseFloat(e.target.value) || 0))}
                          style={{ width: 55, textAlign: "center", padding: "4px 6px" }}
                        />
                      </td>
                      <td style={{ textAlign: "right", fontWeight: 500 }}>{rs(taxVal)}</td>
                      <td style={{ textAlign: "center" }}>
                        <select
                          value={line.gstRate}
                          onChange={(e) => updateLine(idx, "gstRate", Number(e.target.value))}
                          style={{ padding: "4px 6px", fontSize: "0.82rem" }}
                        >
                          <option value={0}>0%</option>
                          <option value={5}>5%</option>
                          <option value={12}>12%</option>
                          <option value={18}>18%</option>
                          <option value={28}>28%</option>
                        </select>
                      </td>
                      <td style={{ textAlign: "right", fontWeight: 700, color: "var(--text-primary)" }}>
                        {rs(rowTot)}
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <button
                          type="button"
                          className="link"
                          onClick={() => removeLine(idx)}
                          title="Remove item"
                          style={{ color: "#b91c1c", fontSize: "1.1rem", border: "none", background: "none", cursor: "pointer" }}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bottom Summary & Notes Layout */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 340px",
          gap: 24,
          borderTop: "1px solid #f1f5f9",
          paddingTop: 16,
          alignItems: "start",
        }}
      >
        <div>
          <label className="field">
            <span>Customer Notes / Terms</span>
            <textarea
              rows={3}
              placeholder="e.g. Thanks for your business. Payment due within terms."
              value={f.notes}
              onChange={(e) => setF({ ...f, notes: e.target.value })}
              style={{ width: "100%" }}
            />
          </label>
        </div>

        {/* Live Tax Summary Card */}
        <div
          style={{
            background: "#f8fafc",
            borderRadius: 8,
            padding: 16,
            border: "1px solid #e2e8f0",
          }}
        >
          <div style={{ display: "grid", gap: 8, fontSize: "0.9rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "#64748b" }}>Taxable Amount:</span>
              <strong>{rs(t.taxable)}</strong>
            </div>

            {t.discount > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", color: "#b45309" }}>
                <span>Discount:</span>
                <span>−{rs(t.discount)}</span>
              </div>
            )}

            {interState ? (
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#64748b" }}>IGST:</span>
                <strong>{rs(t.igst)}</strong>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "#64748b" }}>CGST:</span>
                  <span>{rs(t.cgst)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "#64748b" }}>SGST:</span>
                  <span>{rs(t.sgst)}</span>
                </div>
              </>
            )}

            {t.roundOff !== 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem", color: "#64748b" }}>
                <span>Round Off:</span>
                <span>{rs(t.roundOff)}</span>
              </div>
            )}

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                borderTop: "1px solid #cbd5e1",
                paddingTop: 10,
                marginTop: 4,
                fontSize: "1.15rem",
              }}
            >
              <strong>Grand Total:</strong>
              <strong style={{ color: "var(--accent-green, #047857)" }}>{rs(t.total)}</strong>
            </div>
          </div>
        </div>
      </div>

      {/* Footer Action Buttons matching Swipe Screenshot */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderTop: "1px solid var(--border-subtle, #e2e8f0)",
          paddingTop: 20,
          marginTop: 24,
        }}
      >
        <div style={{ display: "flex", gap: 10 }}>
          <button
            type="button"
            className="btn ghost"
            disabled={st.busy}
            onClick={handleSaveDraft}
            style={{ fontWeight: 600 }}
          >
            Save as Draft
          </button>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button
            type="button"
            className="btn ghost"
            disabled={st.busy}
            onClick={() => handleIssue("print")}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            🖨️ Save and Print
          </button>
          <button
            type="button"
            className="btn btn-whatsapp"
            disabled={st.busy}
            onClick={() => handleIssue("whatsapp")}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            📱 Save & WhatsApp
          </button>
          <button
            type="button"
            className="btn"
            disabled={st.busy}
            onClick={() => handleIssue("view")}
            style={{
              fontWeight: 700,
              padding: "8px 24px",
              background: "#2563eb",
              borderColor: "#2563eb",
              color: "#ffffff",
              boxShadow: "0 1px 3px rgba(37, 99, 235, 0.3)",
            }}
          >
            Issue Invoice →
          </button>
        </div>
      </div>
    </div>
  );
}
