import { Link } from "react-router-dom";
import Seo from "../components/Seo.jsx";

export default function NotFound({ what = "page" }) {
  return (
    <div className="wrap narrow center-note">
      <Seo title="Not found" />
      <h1>We couldn't find that {what}</h1>
      <p>It may have been moved or is no longer listed.</p>
      <Link className="btn" to="/catalog">Browse the catalogue</Link>
    </div>
  );
}
