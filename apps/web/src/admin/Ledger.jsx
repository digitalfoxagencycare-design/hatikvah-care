import { useState } from "react";
import { api } from "../api.js";
import { Loader, useLoad } from "./hooks.jsx";
import { fmtDate, Modal, Msg, rs, toPaise, today, useAction } from "./ui.jsx";

/** Cash and bank book: every payment received posts here automatically; bank charges, deposits and till expenses are added by hand. */
export default function Ledger() {
  const [account, setAccount] = useState("");
  const s = useLoad(`/api/admin/ledger${account ? `?account=${account}` : ""}`);
  const [add, setAdd] = useState(null);
  const [st, run] = useAction();
  return (
    <>
      <div className="row-between"><h1>Cash & bank book</h1>
        <div className="btn-row"><a className="btn ghost" href={`/api/admin/ledger?format=csv${account ? `&account=${account}` : ""}`}>Export CSV</a>
          <button className="btn" onClick={() => setAdd({ date: today(), account: "cash", kind: "payment", contraAccount: "", amount: "", party: "", narration: "", ref: "" })}>+ Entry</button></div></div>
      <div className="toolbar"><select value={account} onChange={(e) => setAccount(e.target.value)} aria-label="Account"><option value="">All accounts</option><option value="cash">Cash</option><option value="bank">Bank</option><option value="razorpay">Razorpay</option></select></div>
      <Msg st={st} />
      <Loader s={s}>{s.data && <>
        <div className="aging">{Object.entries(s.data.totals).map(([k, v]) => <div key={k}><small>{k}</small><strong>{rs(v)}</strong><small>net in this view</small></div>)}</div>
        <div className="tbl-wrap" style={{ marginTop: 12 }}><table className="tbl"><thead><tr><th>Date</th><th>Account</th><th>Ref</th><th>Party</th><th>Narration</th><th className="num">In</th><th className="num">Out</th></tr></thead><tbody>
          {s.data.rows.map((e) => <tr key={e.id}><td>{fmtDate(e.date)}</td><td>{e.account}</td><td>{e.ref}</td><td>{e.party}</td><td>{e.narration}{e.lines && <details><summary>Journal</summary>{e.lines.map((l,i)=><div key={i}>{l.account}: Dr {rs(l.debit)} / Cr {rs(l.credit)}</div>)}</details>}</td><td className="num">{e.kind === "receipt" ? rs(e.amount) : ""}</td><td className="num">{e.kind === "payment" ? rs(e.amount) : ""}</td></tr>)}
          {s.data.rows.length === 0 && <tr><td colSpan="7" className="muted">No entries yet. Payments recorded on invoices and at the counter appear here.</td></tr>}
        </tbody></table></div>
      </>}</Loader>
      {add && (
        <Modal title="Add entry" onClose={() => setAdd(null)}>
          <form className="form" onSubmit={(e) => { e.preventDefault(); run(async () => { await api("/api/admin/ledger", { method: "POST", body: { ...add, amount: toPaise(add.amount) } }); setAdd(null); s.reload(); }, "Saved ✓"); }}>
            <div className="grid2">
              <label className="field"><span>Date</span><input type="date" required value={add.date} onChange={(e) => setAdd({ ...add, date: e.target.value })} /></label>
              <label className="field"><span>Account</span><select value={add.account} onChange={(e) => setAdd({ ...add, account: e.target.value })}><option value="cash">Cash</option><option value="bank">Bank</option><option value="razorpay">Razorpay</option></select></label>
              <label className="field"><span>Type</span><select value={add.kind} onChange={(e) => setAdd({ ...add, kind: e.target.value })}><option value="payment">Money out</option><option value="receipt">Money in</option></select></label>
              <label className="field"><span>Counter-account</span><select required value={add.contraAccount} onChange={e => setAdd({ ...add, contraAccount: e.target.value })}><option value="">Choose account</option>{["cash","bank","razorpay","operating_expense","bank_charges","owner_equity","accounts_receivable","accounts_payable"].filter(k => k !== add.account).map(k => <option key={k} value={k}>{k.replaceAll("_", " ")}</option>)}</select></label>
              <label className="field"><span>Amount ₹</span><input required inputMode="decimal" value={add.amount} onChange={(e) => setAdd({ ...add, amount: e.target.value })} /></label>
              <label className="field"><span>Party</span><input maxLength={160} value={add.party} onChange={(e) => setAdd({ ...add, party: e.target.value })} /></label>
              <label className="field"><span>Reference</span><input maxLength={60} value={add.ref} onChange={(e) => setAdd({ ...add, ref: e.target.value })} /></label>
            </div>
            <label className="field"><span>Narration</span><input maxLength={300} value={add.narration} onChange={(e) => setAdd({ ...add, narration: e.target.value })} placeholder="Bank charges, cash deposited, courier paid…" /></label>
            <button className="btn" disabled={st.busy}>Save</button>
          </form>
        </Modal>
      )}
    </>
  );
}
