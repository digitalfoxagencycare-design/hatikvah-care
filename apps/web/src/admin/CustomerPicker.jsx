import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { GstinInput } from "./GstinInput.jsx";
import { Modal, Msg, StateSelect, useAction, useAsync } from "./ui.jsx";

export function CustomerPicker({ value, onChange }) {
  const customers = useAsync("/api/admin/customers");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const wrapRef = useRef(null);

  const selected = customers.data?.find((c) => c.id === value);

  useEffect(() => {
    const handleOutside = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  const filtered = (customers.data || []).filter((c) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      c.name?.toLowerCase().includes(q) ||
      c.contactName?.toLowerCase().includes(q) ||
      c.phone?.includes(q) ||
      c.gstin?.toLowerCase().includes(q)
    );
  }).slice(0, 8);

  const handleSelect = (c) => {
    setQuery("");
    setOpen(false);
    onChange(c.id, c);
  };

  return (
    <div className="customer-picker-wrap" ref={wrapRef} style={{ position: "relative" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-secondary)" }}>Select Customer</span>
        <button
          type="button"
          className="link"
          style={{ fontSize: "0.85rem", color: "var(--accent-gold, #b45309)", cursor: "pointer", background: "none", border: "none" }}
          onClick={() => setShowAdd(true)}
        >
          + Create Customer
        </button>
      </div>

      {selected && !open ? (
        <div
          onClick={() => setOpen(true)}
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "8px 12px",
            border: "1px solid var(--border-subtle, #cbd5e1)",
            borderRadius: 6,
            background: "var(--bg-surface, #fff)",
            cursor: "pointer",
          }}
        >
          <div>
            <strong style={{ fontSize: "0.95rem" }}>{selected.name}</strong>
            <span style={{ marginLeft: 8, fontSize: "0.85rem", color: "var(--text-muted, #64748b)" }}>
              {selected.phone} {selected.gstin ? `· GSTIN: ${selected.gstin}` : ""}
            </span>
          </div>
          <button
            type="button"
            className="link"
            style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}
            onClick={(e) => {
              e.stopPropagation();
              onChange("", null);
            }}
          >
            Change
          </button>
        </div>
      ) : (
        <div style={{ position: "relative" }}>
          <input
            type="text"
            placeholder="Search customers by name, company, GSTIN, phone..."
            value={query}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border-subtle, #cbd5e1)" }}
          />
          {open && (
            <div
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                right: 0,
                zIndex: 50,
                background: "#fff",
                border: "1px solid var(--border-strong, #cbd5e1)",
                borderRadius: 6,
                boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1)",
                maxHeight: 280,
                overflowY: "auto",
                marginTop: 4,
              }}
            >
              {filtered.length === 0 ? (
                <div style={{ padding: "12px", textAlign: "center", color: "var(--text-muted)" }}>
                  No customer matches "{query}".{" "}
                  <button type="button" className="link" onClick={() => setShowAdd(true)}>
                    + Create new customer
                  </button>
                </div>
              ) : (
                filtered.map((c) => (
                  <div
                    key={c.id}
                    onClick={() => handleSelect(c)}
                    style={{
                      padding: "8px 12px",
                      borderBottom: "1px solid #f1f5f9",
                      cursor: "pointer",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: "0.92rem" }}>{c.name}</div>
                      <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                        {c.phone} {c.gstin ? `· ${c.gstin}` : ""} {c.stateCode ? `· State: ${c.stateCode}` : ""}
                      </div>
                    </div>
                    {c.stateCode && (
                      <span className="pill" style={{ fontSize: "0.75rem" }}>
                        {c.stateCode}
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {showAdd && (
        <QuickCustomerModal
          onClose={() => setShowAdd(false)}
          onCreated={(newCust) => {
            customers.reload();
            handleSelect(newCust);
            setShowAdd(false);
          }}
        />
      )}
    </div>
  );
}

function QuickCustomerModal({ onClose, onCreated }) {
  const [f, setF] = useState({
    name: "",
    contactName: "",
    phone: "",
    email: "",
    gstin: "",
    stateCode: "",
    billingAddress: "",
    shippingAddress: "",
    deliveryPincode: "",
  });
  const [st, run] = useAction();

  const handleGstinChange = (v) => {
    const val = v.toUpperCase().trim();
    const stCode = val.length >= 2 && /^\d{2}$/.test(val.slice(0, 2)) ? val.slice(0, 2) : f.stateCode;
    setF((prev) => ({ ...prev, gstin: val, stateCode: stCode }));
  };

  const submit = (e) => {
    e.preventDefault();
    if (!f.name.trim()) return;
    run(async () => {
      const created = await api("/api/admin/customers", { method: "POST", body: f });
      onCreated(created);
    }, "Customer created ✓");
  };

  return (
    <Modal title="Create New Customer" onClose={onClose}>
      <form onSubmit={submit} style={{ display: "grid", gap: 12, minWidth: 380 }}>
        <Msg st={st} />
        <label className="field">
          <span>Company / Business Name *</span>
          <input
            required
            autoFocus
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
            placeholder="e.g. Athome Hospitality Pvt Ltd"
          />
        </label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <label className="field">
            <span>Contact Person</span>
            <input value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} placeholder="Manager name" />
          </label>
          <label className="field">
            <span>Phone number</span>
            <input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="10 digits" />
          </label>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <GstinInput
            value={f.gstin}
            onChange={handleGstinChange}
            onFetched={(data) => {
              setF((prev) => ({
                ...prev,
                name: prev.name && prev.name.length > 3 ? prev.name : (data.tradeName || data.legalName),
                stateCode: data.stateCode || prev.stateCode,
                billingAddress: prev.billingAddress || data.address,
                shippingAddress: prev.shippingAddress || data.address,
                deliveryPincode: prev.deliveryPincode || data.pincode,
              }));
            }}
          />
          <label className="field">
            <span>State</span>
            <StateSelect value={f.stateCode} onChange={(v) => setF({ ...f, stateCode: v })} />
          </label>
        </div>
        <label className="field">
          <span>Billing / Shipping Address</span>
          <textarea rows={2} value={f.billingAddress} onChange={(e) => setF({ ...f, billingAddress: e.target.value, shippingAddress: e.target.value })} />
        </label>
        <div className="btn-row" style={{ marginTop: 8 }}>
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn" disabled={st.busy || !f.name.trim()}>
            Save & Select Customer
          </button>
        </div>
      </form>
    </Modal>
  );
}
