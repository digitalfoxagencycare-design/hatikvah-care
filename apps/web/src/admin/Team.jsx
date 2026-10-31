import { useState } from "react";
import { api } from "../api.js";
import { Loader, useLoad } from "./hooks.jsx";
import { askText } from "./toast.jsx";
import { Msg } from "./ui.jsx";

export default function Team() {
  const s = useLoad("/api/admin/users");
  const [n, setN] = useState({ name: "", email: "", role: "sales", password: "", phone: "", receivesLeads: false });
  const roles = ["owner", "admin", "manager", "billing_executive", "warehouse_manager", "sales_representative", "sales", "accounts", "warehouse", "staff"];
  const [msg, setMsg] = useState(null);
  const act = async (fn) => { setMsg(null); try { await fn(); s.reload(); } catch (e) { setMsg(e.message); } };
  return (
    <>
      <h1>Team</h1>
      <p className="muted">Owner: everything. Manager: everything except company settings, team and the activity log. Sales: enquiries, customers, quotes, orders. Accounts: customers, invoices, payments, reports. Warehouse: products, orders (dispatch) and stock. Staff: catalogue, enquiries, customers, quotes. Tick “Gets leads” for people who should receive new website enquiries in turn.</p>
      <Msg st={{ error: msg }} />
      <Loader s={s}>
        <table className="tbl"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Gets leads</th><th>Status</th><th></th></tr></thead><tbody>
          {s.data?.map((u) => (
            <tr key={u.id}><td>{u.name}<small>{u.phone}{u.twoFactor ? " · 2-step on" : ""}</small></td><td>{u.email}</td>
              <td><select value={u.role} onChange={(e) => act(() => api(`/api/admin/users/${u.id}`, { method: "PATCH", body: { role: e.target.value } }))} aria-label={`Role of ${u.name}`}>{roles.map((r) => <option key={r}>{r}</option>)}</select></td>
              <td><input type="checkbox" checked={u.receivesLeads} onChange={(e) => act(() => api(`/api/admin/users/${u.id}`, { method: "PATCH", body: { receivesLeads: e.target.checked } }))} aria-label={`${u.name} gets leads`} /></td><td><span className={"pill " + (u.active ? "won" : "closed")}>{u.active ? "active" : "disabled"}</span></td>
              <td className="btn-row">
                <button className="link" onClick={() => act(() => api(`/api/admin/users/${u.id}`, { method: "PATCH", body: { active: !u.active } }))}>{u.active ? "Disable" : "Enable"}</button>
                <button className="link" onClick={async () => { const ph = await askText(`WhatsApp / phone for ${u.name}`, { body: "Used for alerts.", value: u.phone, confirmLabel: "Save" }); if (ph !== null) act(() => api(`/api/admin/users/${u.id}`, { method: "PATCH", body: { phone: ph } })); }}>Phone</button>
                <button className="link" onClick={async () => { const p = await askText(`New password for ${u.email}`, { body: "At least 10 characters, with letters and numbers.", type: "password", confirmLabel: "Reset password" }); if (p) act(() => api(`/api/admin/users/${u.id}`, { method: "PATCH", body: { password: p } })); }}>Reset password</button>
              </td></tr>
          ))}
        </tbody></table>
        <form className="panel form" onSubmit={(e) => { e.preventDefault(); act(async () => { await api("/api/admin/users", { method: "POST", body: n }); setN({ name: "", email: "", role: "sales", password: "", phone: "", receivesLeads: false }); }); }}>
          <h2>Add a team member</h2>
          <div className="grid2">
            <label className="field"><span>Name</span><input required minLength={2} value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} /></label>
            <label className="field"><span>Email</span><input type="email" required value={n.email} onChange={(e) => setN({ ...n, email: e.target.value })} /></label>
            <label className="field"><span>Role</span><select value={n.role} onChange={(e) => setN({ ...n, role: e.target.value })}>{roles.map((r) => <option key={r}>{r}</option>)}</select></label>
            <label className="field"><span>WhatsApp / phone (for alerts)</span><input type="tel" value={n.phone} onChange={(e) => setN({ ...n, phone: e.target.value })} /></label>
            <label className="field"><span>Temporary password (min 10, letters + numbers)</span><input type="password" autoComplete="new-password" required minLength={10} value={n.password} onChange={(e) => setN({ ...n, password: e.target.value })} /></label>
          </div>
          <label className="check-row"><input type="checkbox" checked={n.receivesLeads} onChange={(e) => setN({ ...n, receivesLeads: e.target.checked })} /><span>Gets new website enquiries (in turn)</span></label>
          <button className="btn">Add member</button>
        </form>
      </Loader>
    </>
  );
}
