import { useState } from "react";
import { api } from "../api.js";

export default function Login({ onLogin }) {
  const [f, setF] = useState({ email: "", password: "", code: "" });
  const [needCode, setNeedCode] = useState(false);
  const [st, setSt] = useState({ busy: false, error: null });
  async function go(e) {
    e.preventDefault();
    setSt({ busy: true, error: null });
    try { onLogin(await api("/api/admin/login", { method: "POST", body: needCode ? f : { email: f.email, password: f.password } })); }
    catch (err) {
      if (err.message.includes("6-digit code")) { setNeedCode(true); setSt({ busy: false, error: null }); }
      else setSt({ busy: false, error: err.message });
    }
  }
  return (
    <div className="login">
      <form className="panel" onSubmit={go}>
        <img src="/brand/hatikvah-logo.png" alt="HaTikvah Care" width="180" height="101" />
        <h1>Admin sign in</h1>
        <label className="field"><span>Email</span><input type="email" autoComplete="username" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
        <label className="field"><span>Password</span><input type="password" autoComplete="current-password" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label>
        {needCode && <label className="field"><span>6-digit code from your authenticator app</span><input autoFocus inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.replace(/\D/g, "") })} /></label>}
        {st.error && <p className="alert" role="alert">{st.error}</p>}
        <button className="btn" disabled={st.busy}>{st.busy ? "Signing in…" : needCode ? "Verify" : "Sign in"}</button>
      </form>
    </div>
  );
}
