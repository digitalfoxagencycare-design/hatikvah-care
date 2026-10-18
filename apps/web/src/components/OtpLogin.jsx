import { useState } from "react";
import { api } from "../api.js";

/** Sign in with a 6-digit code sent on WhatsApp. Calls onDone(customer) when the code is right. */
export default function OtpLogin({ onDone, title = "Sign in with your mobile number" }) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState("phone");
  const [st, setSt] = useState({ busy: false, error: null, dev: "" });

  async function send(e) {
    e?.preventDefault();
    setSt({ busy: true, error: null, dev: "" });
    try { const r = await api("/api/shop/otp/request", { method: "POST", body: { phone } }); setStep("code"); setSt({ busy: false, error: null, dev: r.devCode || "" }); }
    catch (err) { setSt({ busy: false, error: err.message, dev: "" }); }
  }
  async function verify(e) {
    e.preventDefault();
    setSt((s) => ({ ...s, busy: true, error: null }));
    try { const r = await api("/api/shop/otp/verify", { method: "POST", body: { phone, code } }); onDone(r.customer); }
    catch (err) { setSt((s) => ({ ...s, busy: false, error: err.message })); }
  }
  return (
    <div className="panel otp">
      <h2>{title}</h2>
      {step === "phone" ? (
        <form className="form" onSubmit={send}>
          <label className="field"><span>Mobile number (WhatsApp)</span><input type="tel" inputMode="numeric" autoComplete="tel" maxLength={14} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98765 43210" required /></label>
          {st.error && <p className="alert" role="alert">{st.error}</p>}
          <button className="btn" disabled={st.busy}>{st.busy ? "Sending…" : "Send code on WhatsApp"}</button>
        </form>
      ) : (
        <form className="form" onSubmit={verify}>
          <p>We sent a 6-digit code on WhatsApp to <strong>{phone}</strong>. <button type="button" className="link" onClick={() => { setStep("phone"); setCode(""); }}>Change</button></p>
          {st.dev && <p className="notice">Test mode (WhatsApp not connected): your code is <strong>{st.dev}</strong></p>}
          <label className="field"><span>Code</span><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} required /></label>
          {st.error && <p className="alert" role="alert">{st.error}</p>}
          <div className="btn-row"><button className="btn" disabled={st.busy || code.length !== 6}>{st.busy ? "Checking…" : "Verify & continue"}</button><button type="button" className="link" onClick={send} disabled={st.busy}>Send again</button></div>
        </form>
      )}
    </div>
  );
}
