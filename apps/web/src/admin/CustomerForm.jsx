import { useState } from "react";
import { api } from "../api.js";
import { Msg, PersonSelect, StateSelect, useAction, useAsync } from "./ui.jsx";

const EMPTY = { name: "", contactName: "", phone: "", email: "", gstin: "", stateCode: "", city: "", billingAddress: "", shippingAddress: "", priceListId: "", paymentTermsDays: 30, reorderDays: 0, tags: [], notes: "", assignedTo: "", followUpAt: "", source: "" };

/** Add / edit a customer. onSaved(customer). */
export default function CustomerForm({ customer, onSaved }) {
  const [f, setF] = useState(() => ({ ...EMPTY, ...(customer || {}) }));
  const lists = useAsync("/api/admin/price-lists");
  const [st, run] = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e?.target ? e.target.value : e });
  const save = (e) => {
    e.preventDefault();
    const body = Object.fromEntries(Object.keys(EMPTY).map((k) => [k, f[k]]));
    body.paymentTermsDays = Number(body.paymentTermsDays) || 0; body.reorderDays = Number(body.reorderDays) || 0;
    body.tags = typeof f.tags === "string" ? f.tags.split(",").map((x) => x.trim()).filter(Boolean) : f.tags;
    run(async () => onSaved(await api(customer ? `/api/admin/customers/${customer.id}` : "/api/admin/customers", { method: customer ? "PATCH" : "POST", body })));
  };
  return (
    <form className="form" onSubmit={save}>
      <div className="grid2">
        <label className="field"><span>Company / hotel name *</span><input required minLength={2} maxLength={160} value={f.name} onChange={set("name")} /></label>
        <label className="field"><span>Contact person</span><input maxLength={100} value={f.contactName} onChange={set("contactName")} /></label>
        <label className="field"><span>Phone</span><input type="tel" maxLength={20} value={f.phone} onChange={set("phone")} /></label>
        <label className="field"><span>Email</span><input type="email" maxLength={160} value={f.email} onChange={set("email")} /></label>
        <label className="field"><span>GSTIN</span><input maxLength={15} value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase(), stateCode: f.stateCode || (/^\d{2}/.test(e.target.value) ? e.target.value.slice(0, 2) : "") })} placeholder="36ABCDE1234F1Z5" /></label>
        <StateSelect value={f.stateCode} onChange={set("stateCode")} label="State (decides CGST+SGST or IGST)" />
        <label className="field"><span>Applied Offer / Discount</span><select value={f.priceListId} onChange={set("priceListId")}><option value="">Standard prices (no offer)</option>{lists.data?.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.discountPct}% off)</option>)}</select></label>
      </div>
      <div className="grid2">
        <label className="field"><span>Billing address</span><textarea rows="2" maxLength={400} value={f.billingAddress} onChange={set("billingAddress")} /></label>
        <label className="field"><span>Shipping address (blank = same)</span><textarea rows="2" maxLength={400} value={f.shippingAddress} onChange={set("shippingAddress")} /></label>
      </div>
      <div className="grid3">
        <label className="field"><span>Payment terms (days)</span><input type="number" min="0" max="365" value={f.paymentTermsDays} onChange={set("paymentTermsDays")} /></label>
        <label className="field"><span>Re-orders every (days, 0 = off)</span><input type="number" min="0" max="365" value={f.reorderDays} onChange={set("reorderDays")} /></label>
        <PersonSelect value={f.assignedTo} onChange={set("assignedTo")} label="Account manager" />
        <label className="field"><span>Next follow-up</span><input type="date" value={f.followUpAt} onChange={set("followUpAt")} /></label>
        <label className="field"><span>Tags (comma separated)</span><input value={Array.isArray(f.tags) ? f.tags.join(", ") : f.tags} onChange={set("tags")} placeholder="5-star, chain, hospital" /></label>
        <label className="field"><span>Source</span><input maxLength={80} value={f.source} onChange={set("source")} placeholder="website, referral, exhibition…" /></label>
      </div>
      <label className="field"><span>Notes</span><textarea rows="2" maxLength={2000} value={f.notes} onChange={set("notes")} /></label>
      <Msg st={st} />
      <button className="btn" disabled={st.busy}>{st.busy ? "Saving…" : "Save customer"}</button>
    </form>
  );
}
