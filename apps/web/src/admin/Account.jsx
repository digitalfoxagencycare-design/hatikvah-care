import { useState } from "react";
import { api } from "../api.js";
import { useMe } from "./AdminApp.jsx";
import { Msg, useAction } from "./ui.jsx";

export default function Account() {
  const me = useMe();
  const [pw, setPw] = useState({ current: "", next: "" });
  const [twoOn, setTwoOn] = useState(me.twoFactor);
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState("");
  const [p1, run1] = useAction(), [p2, run2] = useAction();
  return (
    <>
      <h1>My account</h1>
      <p className="muted">{me.name} · {me.email} · {me.role}</p>
      <form className="panel form" onSubmit={(e) => { e.preventDefault(); run1(async () => { await api("/api/admin/me/password", { method: "POST", body: pw }); setPw({ current: "", next: "" }); }, "Password changed ✓ Other devices have been signed out."); }}>
        <h2>Change password</h2>
        <div className="grid2">
          <label className="field"><span>Current password</span><input type="password" autoComplete="current-password" required value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></label>
          <label className="field"><span>New password (min 10, letters + numbers)</span><input type="password" autoComplete="new-password" required minLength={10} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></label>
        </div>
        <Msg st={p1} /><button className="btn" disabled={p1.busy}>Change password</button>
      </form>
      <div className="panel form">
        <h2>Two-step sign-in</h2>
        <p className="muted">Ask for a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator…) when signing in. Strongly recommended for owners.</p>
        {twoOn ? (
          <form className="btn-row" onSubmit={(e) => { e.preventDefault(); const password = e.target.elements.pw.value; run2(async () => { await api("/api/admin/me/2fa/disable", { method: "POST", body: { password } }); setTwoOn(false); }, "Two-step sign-in is off."); }}>
            <strong>On ✓</strong><input name="pw" type="password" required placeholder="Your password" aria-label="Password" /><button className="btn ghost">Turn off</button>
          </form>
        ) : setup ? (
          <form className="form" onSubmit={(e) => { e.preventDefault(); run2(async () => { await api("/api/admin/me/2fa/enable", { method: "POST", body: { code } }); setTwoOn(true); setSetup(null); }, "Two-step sign-in is on ✓"); }}>
            <ol><li>In your authenticator app choose <strong>Add account → Enter a setup key</strong>.</li><li>Account: <code>{me.email}</code>, key: <code className="key">{setup.secret}</code> (time based).</li><li>Type the 6-digit code it shows:</li></ol>
            <div className="btn-row"><input inputMode="numeric" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} aria-label="Code" /><button className="btn">Turn on</button></div>
            <small className="muted">On a phone you can also open <a href={setup.otpauth}>this setup link</a>.</small>
          </form>
        ) : <button className="btn" onClick={() => run2(async () => setSetup(await api("/api/admin/me/2fa/setup", { method: "POST" })))}>Set up two-step sign-in</button>}
        <Msg st={p2} />
      </div>
    </>
  );
}
