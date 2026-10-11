import { useEffect } from "react";

/** Sets the page title, description and (optional) structured data for search engines and link previews. */
export default function Seo({ title, description, jsonLd }) {
  useEffect(() => {
    const full = title ? `${title} | HaTikvah Care` : "HaTikvah Care | Hospitality Supplies, Amenities & Hotel Linen in Hyderabad";
    document.title = full;
    let m = document.querySelector('meta[name="description"]');
    if (!m) { m = document.createElement("meta"); m.name = "description"; document.head.appendChild(m); }
    if (description) m.content = description.slice(0, 300);
    let s = document.getElementById("ld-json");
    if (jsonLd) {
      if (!s) { s = document.createElement("script"); s.type = "application/ld+json"; s.id = "ld-json"; document.head.appendChild(s); }
      s.textContent = JSON.stringify(jsonLd);
    } else if (s) s.remove();
    return () => document.getElementById("ld-json")?.remove();
  }, [title, description, jsonLd]);
  return null;
}
