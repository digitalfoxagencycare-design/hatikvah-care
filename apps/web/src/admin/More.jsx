import { Link } from "react-router-dom";
import { can, MORE, useMe } from "./AdminApp.jsx";

/** Everything kept off the main sidebar: still working, one tap away. */
export default function More() {
  const me = useMe();
  return (
    <>
      <h1>More tools</h1>
      <p className="muted">Everyday work lives in the sidebar. These stay here for the times you need them.</p>
      <div className="more-grid">
        {MORE.filter(([, , perm]) => can(me, perm)).map(([path, label, , , hint]) => <Link key={path} className="more-tile" to={`/admin/${path}`}><strong>{label}</strong><small>{hint}</small></Link>)}
      </div>
    </>
  );
}
