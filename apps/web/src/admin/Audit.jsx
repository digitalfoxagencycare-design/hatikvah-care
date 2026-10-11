import { Loader, useLoad } from "./hooks.jsx";

export default function Audit() {
  const s = useLoad("/api/admin/audit");
  return (
    <>
      <h1>Activity log</h1>
      <p className="muted">The latest 300 changes: who changed what, and when. Price changes show the old and new value.</p>
      <Loader s={s}><div className="tbl-wrap"><table className="tbl"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Item</th><th>Details</th></tr></thead><tbody>
        {s.data?.map((a) => <tr key={a.id}><td>{new Date(a.at).toLocaleString("en-IN")}</td><td>{a.by}</td><td>{a.action}</td><td>{a.target}</td><td><code className="small-print">{a.detail ? JSON.stringify(a.detail) : ""}</code></td></tr>)}
      </tbody></table></div></Loader>
    </>
  );
}
