import { useState } from "react";
import { api } from "../api.js";
import { Loader, useLoad } from "./hooks.jsx";

export default function Team() {
  const s = useLoad("/api/admin/users");
  const [n, setN] = useState({ name: "", email: "", role: "staff", password: "" });
  const [msg, setMsg] = useState(null);
  const act = async (fn) => { setMsg(null); try { await fn(); s.reload(); } catch (e) { setMsg(e.message); } };
  return (
    <>
      <h1>Team</h1>
      <p className="muted">Owners can do everything. Staff can manage products, categories and enquiries, but not the price switch, company details, team or the activity log.</p>
      {msg && <p className="alert" role="alert">{msg}</p>}
      <Loader s={s}>
        <table className="tbl"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead><tbody>
          {s.data?.map((u) => (
            <tr key={u.id}><td>{u.name}</td><td>{u.email}</td><td>{u.role}</td><td><span className={"pill " + (u.active ? "won" : "closed")}>{u.active ? "active" : "disabled"}</span></td>
              <td className="btn-row">
                <button className="link" onClick={() => act(() => api(`/api/admin/users/${u.id}`, { method: "PATCH", body: { active: !u.active } }))}>{u.active ? "Disable" : "Enable"}</button>
                <button className="link" onClick={() => { const p = window.prompt(`New password for ${u.email} (min 10 characters, letters and numbers):`); if (p) act(() => api(`/api/admin/users/${u.id}`, { method: "PATCH", body: { password: p } })); }}>Reset password</button>
              </td></tr>
          ))}
        </tbody></table>
        <form className="panel form" onSubmit={(e) => { e.preventDefault(); act(async () => { await api("/api/admin/users", { method: "POST", body: n }); setN({ name: "", email: "", role: "staff", password: "" }); }); }}>
          <h2>Add a team member</h2>
          <div className="grid2">
            <label className="field"><span>Name</span><input required minLength={2} value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} /></label>
            <label className="field"><span>Email</span><input type="email" required value={n.email} onChange={(e) => setN({ ...n, email: e.target.value })} /></label>
            <label className="field"><span>Role</span><select value={n.role} onChange={(e) => setN({ ...n, role: e.target.value })}><option value="staff">Staff</option><option value="owner">Owner</option></select></label>
            <label className="field"><span>Temporary password (min 10, letters + numbers)</span><input type="password" autoComplete="new-password" required minLength={10} value={n.password} onChange={(e) => setN({ ...n, password: e.target.value })} /></label>
          </div>
          <button className="btn">Add member</button>
        </form>
      </Loader>
    </>
  );
}
