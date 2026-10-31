import { useEffect, useMemo, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { api } from "../api.js";
import { useMe, can } from "./AdminApp.jsx";
import { stockMeter } from "./posMath.js";
import { fmtDate, Modal, Pill, rs, today } from "./ui.jsx";

const PATHS = {
  dashboard: "M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z",
  pos: "M4 4h16v12H4zM8 20h8M12 16v4M8 8h8M8 12h4",
  quote: "M6 2h9l5 5v15H6zM14 2v6h6M9 13h7M9 17h7",
  invoice: "M5 2h14v20l-3-2-2 2-2-2-2 2-2-2-3 2zM9 8h6M9 12h6",
  purchase: "M3 5h3l3 11h9l2-8H7M10 20h.01M17 20h.01",
  vendor: "M3 21V9l9-6 9 6v12M9 21v-7h6v7",
  product: "M12 2 3 7v10l9 5 9-5V7zM3 7l9 5 9-5M12 12v10",
  chat: "M21 12a8 8 0 0 1-12 7l-6 2 2-6a8 8 0 1 1 16-3z",
  card: "M2 6h20v13H2zM2 10h20M6 15h4",
  truck: "M2 6h12v10H2zM14 10h4l4 4v2h-8zM6 19h.01M18 19h.01",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4-4",
  amenity: "M7 3h10l-1 6H8zM8 9c-2 3-2 8 0 12h8c2-4 2-9 0-12",
  linen: "M3 7a4 4 0 0 1 8 0v13H7a4 4 0 0 1-4-4zM7 3h10a4 4 0 0 1 4 4v9a4 4 0 0 1-4 4h-6",
  dispenser: "M9 8h6v13H9zM11 8V4h6M11 4 8 6",
  kit: "M4 8h16v12H4zM9 8V5h6v3M4 13h16",
  all: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  bolt: "M13 2 4 14h7l-1 8 9-12h-7z",
  calendar: "M4 5h16v16H4zM4 10h16M8 3v4M16 3v4",
  cash: "M2 7h20v10H2zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 12h.01M18 12h.01",
};
export const Icon = ({ name, size = 18 }) => <svg className="ico" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={PATHS[name]} /></svg>;

let thumbs = null;
/** productId → first photo, fetched once for the whole admin. */
export function useThumbs() {
  const [map, setMap] = useState({});
  useEffect(() => {
    let on = true;
    thumbs ||= api("/api/admin/thumbs").catch(() => { thumbs = null; return {}; });
    thumbs.then((m) => on && setMap(m));
    return () => { on = false; };
  }, []);
  return map;
}

export const Photo = ({ src, alt = "", className = "ph" }) => (src ? <img className={className} src={src} alt={alt} loading="lazy" /> : <span className={className + " none"} aria-hidden="true"><Icon name="product" /></span>);

/** Overlapping photos of a document's lines. */
export function ThumbStack({ items = [], map, max = 4 }) {
  const shown = items.slice(0, max);
  return <span className="stack" aria-label={`${items.length} item${items.length === 1 ? "" : "s"}`}>{shown.map((l, i) => <Photo key={i} src={map[l.productId]} />)}{items.length > max && <span className="ph more">+{items.length - max}</span>}</span>;
}

/** Stock level as a bar: full at twice the reorder level, amber at or under it, red when out. */
export function StockMeter({ available, reorderLevel }) {
  const tone = available <= 0 ? "out" : available <= reorderLevel ? "low" : "ok";
  return <div className={"meter " + tone}><span><b>{available.toLocaleString("en-IN")}</b> in stock</span><i><em style={{ width: `${stockMeter(available, reorderLevel)}%` }} /></i></div>;
}

/** Cards in place of a table: photos of what's on the document, who, when, status and money, with room for actions. */
export function VisualDocList({ rows, base, map, who = (d) => d.customer?.name, status = (d) => ({ key: d.status, label: d.status }), sub, actions, empty = "Nothing here yet." }) {
  if (rows.length === 0) return <EmptyState title={empty} />;
  return (
    <ul className="doc-cards">
      {rows.map((d) => {
        const s = status(d), extra = sub?.(d);
        return (
          <li key={d.id} className="doc-card">
            <Link className="doc-main" to={`${base}/${d.id}`}>
              <ThumbStack items={d.items} map={map} />
              <span className="doc-who"><strong>{who(d)}</strong><small>{d.number} · {fmtDate(d.date || d.createdAt)}{extra ? ` · ${extra}` : ""}</small></span>
              <span className="doc-money"><strong>{rs(d.totals?.total ?? d.total)}</strong><Pill s={s.key}>{s.label}</Pill></span>
            </Link>
            {actions && <div className="doc-acts">{actions(d)}</div>}
          </li>
        );
      })}
    </ul>
  );
}

/** Days to a date, in words: { soon, today, past }. Amber inside three days, red once it has passed. */
export function daysLabel(date, words) {
  const n = Math.round((Date.parse(date) - Date.parse(today())) / 86_400_000);
  if (n < 0) return { text: words.past(-n), tone: "late" };
  return n === 0 ? { text: words.today, tone: "near" } : { text: words.soon(n), tone: n <= 3 ? "near" : "" };
}

const itemLine = (items) => `${items.length} item${items.length === 1 ? "" : "s"}: ${items.slice(0, 2).map((i) => i.name).join(", ")}${items.length > 2 ? "…" : ""}`;

/** A quotation or invoice as a summary card; children are the action buttons. */
export function DocSummary({ to, doc, map, note, noteTone = "", status, statusLabel, children }) {
  const c = doc.customer;
  return (
    <li className="q-card">
      <Link className="q-main" to={to}>
        <span className="q-head">
          <strong>{c?.name}</strong>
          <small>{doc.number} · {fmtDate(doc.date || doc.createdAt)}{c?.gstin ? ` · GSTIN ${c.gstin}` : ""}</small>
          {note && <span className={"q-exp " + noteTone}><Icon name="calendar" size={13} />{note}</span>}
        </span>
        <span className="q-items"><ThumbStack items={doc.items} map={map} /><span>{itemLine(doc.items)}</span></span>
        <span className="q-total"><strong>{rs(doc.totals?.total)}</strong><Pill s={status}>{statusLabel}</Pill></span>
      </Link>
      <div className="q-strip">{children}</div>
    </li>
  );
}

/** Photo grid for adding a product to a document. `rows` need name and sku, plus productId or id. */
export function ProductPicker({ rows, onPick, onClose }) {
  const [q, setQ] = useState("");
  const map = useThumbs();
  const shown = useMemo(() => { const s = q.trim().toLowerCase(); return (rows || []).filter((r) => r.active !== false && (!s || `${r.sku} ${r.name}`.toLowerCase().includes(s))).slice(0, 60); }, [rows, q]);
  return (
    <Modal title="Add a product" wide onClose={onClose}>
      <input type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or SKU…" aria-label="Search products" />
      <div className="pick-grid">
        {shown.map((r) => { const id = r.productId || r.id; return <button type="button" key={id} className="pick" onClick={() => onPick(r)}><Photo src={r.image || map[id]} /><span>{r.name}</span><small>{r.sku}{r.rate ? ` · ${rs(r.rate)}` : ""}</small></button>; })}
        {shown.length === 0 && <p className="muted">No products match.</p>}
      </div>
    </Modal>
  );
}

const HUBS = [["whatsapp", "WhatsApp", "chat", "enquiries"], ["payments-hub", "Razorpay Payments", "card", "invoices"], ["logistics-hub", "Logistics & Delivery", "truck", "orders"]];
export function HubTabs() {
  const me = useMe();
  return <nav className="hub-tabs" aria-label="Automations and channels">{HUBS.filter(([, , , p]) => can(me, p)).map(([path, label, icon]) => <NavLink key={path} to={`/admin/${path}`}><Icon name={icon} />{label}</NavLink>)}</nav>;
}

/** Shown when a list has nothing in it: says what belongs here and what to do next. */
export function EmptyState({ title, body, children }) {
  return (
    <div className="empty">
      <svg width="120" height="96" viewBox="0 0 120 96" fill="none" aria-hidden="true">
        <rect x="28" y="10" width="64" height="78" rx="8" fill="#FFFBEB" stroke="#B45309" strokeWidth="1.5" />
        <path d="M40 30h40M40 42h40M40 54h24" stroke="#64748B" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="86" cy="70" r="15" fill="#FFFFFF" stroke="#047857" strokeWidth="1.5" />
        <path d="M79 70l5 5 9-10" stroke="#047857" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <strong>{title}</strong>
      {body && <p>{body}</p>}
      {children}
    </div>
  );
}

export const Stat = ({ n, label, sub, tone = "" }) => <div className={"stat " + tone}><strong>{n}</strong><span>{label}</span>{sub && <small>{sub}</small>}</div>;
