import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { Loader, useLoad } from "./hooks.jsx";
import { fmtDate, Modal, Msg, Pill, rs, StateSelect, useAction } from "./ui.jsx";
import { ask } from "./toast.jsx";

const EMPTY = { name: "", contactName: "", phone: "", email: "", gstin: "", stateCode: "", address: "", notes: "" };
const ACTIVE = ["draft", "sent", "partial"];

export default function Suppliers() {
  const s = useLoad("/api/admin/suppliers");
  const pos = useLoad("/api/admin/purchases");
  const [edit, setEdit] = useState(null);
  const [search, setSearch] = useState("");
  const [st, run] = useAction();

  const bySupplier = useMemo(() => {
    const out = {};
    for (const p of pos.data || []) (out[p.supplierId] ||= []).push(p);
    return out;
  }, [pos.data]);

  const suppliersList = useMemo(() => {
    const list = s.data || [];
    if (!search.trim()) return list;
    const q = search.trim().toLowerCase();
    return list.filter((x) =>
      (x.name || "").toLowerCase().includes(q) ||
      (x.contactName || "").toLowerCase().includes(q) ||
      (x.phone || "").includes(q) ||
      (x.gstin || "").toLowerCase().includes(q)
    );
  }, [s.data, search]);

  const totalSupplied = useMemo(() => {
    return (pos.data || [])
      .filter((p) => ["received", "partial", "paid"].includes(p.status))
      .reduce((n, p) => n + (p.total || 0), 0);
  }, [pos.data]);

  const save = (e) => {
    e.preventDefault();
    const body = Object.fromEntries(Object.keys(EMPTY).map((k) => [k, edit[k] ?? ""]));
    run(async () => {
      await api(edit.id ? `/api/admin/suppliers/${edit.id}` : "/api/admin/suppliers", { method: edit.id ? "PATCH" : "POST", body });
      setEdit(null);
      s.reload();
    });
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* 1:1 Swipe Page Header */}
      <div className="row-between" style={{ alignItems: "center" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "1.35rem", fontWeight: 700, color: "#0F172A" }}>Vendors & Suppliers</h1>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: "0.85rem" }}>
            Manage supplier catalogs, GST purchase orders, and vendor credit terms.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn" onClick={() => setEdit({ ...EMPTY })}>+ Add Vendor</button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="panel" style={{ padding: "12px 16px", background: "#FFFFFF", borderRadius: 8, border: "1px solid #E2E8F0" }}>
        <input
          type="search"
          placeholder="Search vendor name, contact, phone, GSTIN…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #CBD5E1", fontSize: "0.88rem" }}
        />
      </div>

      <Msg st={st} />

      <Loader s={s}>
        <div className="panel" style={{ padding: 0, background: "#FFFFFF", borderRadius: 8, border: "1px solid #E2E8F0", overflow: "hidden" }}>
          <div className="tbl-wrap" style={{ overflowX: "auto" }}>
            <table className="tbl swipe-table" style={{ width: "100%", margin: 0 }}>
              <thead>
                <tr>
                  <th>Vendor / GSTIN</th>
                  <th>Contact Person / Phone</th>
                  <th>Location</th>
                  <th>Active POs</th>
                  <th className="num">Supplied Value</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {suppliersList.map((x) => {
                  const orders = bySupplier[x.id] || [];
                  const active = orders.filter((p) => ACTIVE.includes(p.status));
                  const supplied = orders.filter((p) => ["received", "partial", "paid"].includes(p.status)).reduce((n, p) => n + (p.total || 0), 0);

                  return (
                    <tr key={x.id}>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <strong style={{ color: "#0F172A" }}>{x.name}</strong>
                          {x.gstin ? (
                            <span style={{ fontSize: "0.72rem", background: "#DCFCE7", color: "#166534", padding: "1px 6px", borderRadius: 4, fontWeight: 700 }}>
                              {x.gstin}
                            </span>
                          ) : (
                            <span style={{ fontSize: "0.72rem", background: "#F1F5F9", color: "#64748B", padding: "1px 6px", borderRadius: 4 }}>
                              URP
                            </span>
                          )}
                        </div>
                        <small style={{ color: "#64748B", display: "block" }}>{x.email || "No email"}</small>
                      </td>
                      <td>
                        <strong>{x.contactName || "—"}</strong>
                        <small style={{ display: "block", color: "#64748B" }}>{x.phone || "No phone"}</small>
                      </td>
                      <td>
                        <span>{x.address ? x.address.slice(0, 30) + "…" : "—"}</span>
                        <small style={{ display: "block", color: "#64748B" }}>State Code {x.stateCode || "36"}</small>
                      </td>
                      <td>
                        {active.length > 0 ? (
                          <Pill s="sent">{active.length} Active POs</Pill>
                        ) : (
                          <Pill s="draft">0 Active</Pill>
                        )}
                      </td>
                      <td className="num">
                        <strong style={{ color: "#0F172A" }}>{rs(supplied)}</strong>
                        <small style={{ display: "block", color: "#64748B" }}>{orders.length} orders total</small>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <div style={{ display: "inline-flex", gap: 6 }}>
                          {x.phone && <a className="btn ghost small" href={`tel:${x.phone}`}>Call</a>}
                          <button className="btn ghost small" onClick={() => setEdit(x)}>Edit</button>
                          <button
                            className="link danger small"
                            onClick={async () => {
                              if (await ask(`Delete ${x.name}?`, { danger: true, confirmLabel: "Delete" })) {
                                run(async () => {
                                  await api(`/api/admin/suppliers/${x.id}`, { method: "DELETE" });
                                  s.reload();
                                });
                              }
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {suppliersList.length === 0 && (
                  <tr>
                    <td colSpan="6" className="muted" style={{ padding: 40, textAlign: "center" }}>
                      No vendors found. Click + Add Vendor to register a supplier.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

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
              <span style={{ color: "#64748B" }}>Total Vendors: </span>
              <strong style={{ color: "#0F172A" }}>{suppliersList.length}</strong>
            </span>
            <span>
              <span style={{ color: "#64748B" }}>Total Supplied Goods: </span>
              <strong style={{ color: "#16A34A" }}>{rs(totalSupplied)}</strong>
            </span>
          </div>
        </div>
      </Loader>

      {edit && (
        <Modal title={edit.id ? `Edit ${edit.name}` : "Add supplier"} onClose={() => setEdit(null)}>
          <form className="form" onSubmit={save}>
            <div className="grid2">
              {[["name", "Name *"], ["contactName", "Contact person"], ["phone", "Phone"], ["email", "Email"], ["gstin", "GSTIN"]].map(([k, l]) => (
                <label key={k} className="field">
                  <span>{l}</span>
                  <input
                    required={k === "name"}
                    value={edit[k] || ""}
                    onChange={(e) => setEdit({ ...edit, [k]: k === "gstin" ? e.target.value.toUpperCase() : e.target.value })}
                  />
                </label>
              ))}
              <StateSelect value={edit.stateCode || ""} onChange={(v) => setEdit({ ...edit, stateCode: v })} />
            </div>
            <label className="field"><span>Address</span><textarea rows="2" value={edit.address || ""} onChange={(e) => setEdit({ ...edit, address: e.target.value })} /></label>
            <label className="field"><span>Notes</span><input value={edit.notes || ""} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></label>
            <Msg st={st} />
            <button className="btn" disabled={st.busy}>Save</button>
          </form>
        </Modal>
      )}
    </div>
  );
}
