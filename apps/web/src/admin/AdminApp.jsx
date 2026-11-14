import { createContext, lazy, Suspense, useContext, useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import Login from "./Login.jsx";
import { MetaProvider } from "./ui.jsx";
import { Toaster } from "./toast.jsx";
import { Icon } from "./visual.jsx";
import "./admin.css";

const Me = createContext(null);
export const useMe = () => useContext(Me);
export const can = (me, p) => me?.permissions?.includes(p);

const page = (f) => lazy(async () => {
  try {
    return await f();
  } catch (err) {
    const isChunkError = err?.message?.includes("dynamically imported module") || err?.message?.includes("Failed to fetch") || err?.name === "ChunkLoadError" || err instanceof TypeError;
    const key = "hc_chunk_reload_ts";
    const last = Number(sessionStorage.getItem(key) || 0);
    if (isChunkError && Date.now() - last > 15000) {
      sessionStorage.setItem(key, String(Date.now()));
      window.location.reload();
      return new Promise(() => {});
    }
    throw err;
  }
});
const P = {
  Dashboard: page(() => import("./Dashboard.jsx")), Products: page(() => import("./Products.jsx")), ProductForm: page(() => import("./ProductForm.jsx")),
  Categories: page(() => import("./Categories.jsx")), Enquiries: page(() => import("./Enquiries.jsx")), Customers: page(() => import("./Customers.jsx")),
  CustomerDetail: page(() => import("./CustomerDetail.jsx")), PriceLists: page(() => import("./PriceLists.jsx")), Quotes: page(() => import("./Quotes.jsx")),
  QuoteDetail: page(() => import("./QuoteDetail.jsx")), Orders: page(() => import("./Orders.jsx")), OrderDetail: page(() => import("./OrderDetail.jsx")),
  Invoices: page(() => import("./Invoices.jsx")), InvoiceDetail: page(() => import("./InvoiceDetail.jsx")), Stock: page(() => import("./Stock.jsx")),
  Purchases: page(() => import("./Purchases.jsx")), PurchaseDetail: page(() => import("./PurchaseDetail.jsx")), Suppliers: page(() => import("./Suppliers.jsx")),
  Reports: page(() => import("./Reports.jsx")), Content: page(() => import("./Content.jsx")), Automation: page(() => import("./Automation.jsx")),
  Settings: page(() => import("./Settings.jsx")), Team: page(() => import("./Team.jsx")), Audit: page(() => import("./Audit.jsx")), Account: page(() => import("./Account.jsx")),
  CreditNotes: page(() => import("./CreditNotes.jsx")), POS: page(() => import("./POS.jsx")), WhatsApp: page(() => import("./WhatsApp.jsx")), Ledger: page(() => import("./Ledger.jsx")),
  PaymentsHub: page(() => import("./PaymentsHub.jsx")), LogisticsHub: page(() => import("./LogisticsHub.jsx")), More: page(() => import("./More.jsx")),
};
// [path, label, permission, component, icon]
// Swipe 1:1 14 Primary Sidebar Modules
const NAV = [
  ["Core Sales & Billing", [
    ["invoices", "Sales (Invoices)", "invoices", "Invoices", "invoice"],
    ["pos", "Counter Billing (POS)", "pos", "POS", "pos"],
    ["quotes", "Quotations+", "quotes", "Quotes", "quote"],
    ["orders", "Projects & Orders", "orders", "Orders", "truck"],
  ]],
  ["Purchases & Expenses", [
    ["purchase-orders", "Purchases", "stock", "Purchases", "purchase"],
    ["ledger", "Expenses+ & Cash Book", "ledger", "Ledger", "card"],
    ["vendors", "Vendors / Suppliers", "stock", "Suppliers", "vendor"],
  ]],
  ["Catalog & Inventory", [
    ["products", "Products & Services", "catalog", "Products", "product"],
    ["stock", "Inventory (Stock)", "stock", "Stock", "product"],
  ]],
  ["Finance, CRM & Insights", [
    ["payments-hub", "Payments (Razorpay)", "invoices", "PaymentsHub", "card"],
    ["customers", "Customers", "customers", "Customers", "chat"],
    ["reports", "Reports & GSTR-1", "reports", "Reports", "reports"],
    ["logistics-hub", "Logistics & Delivery", "orders", "LogisticsHub", "truck"],
  ]],
];
// Off the sidebar, on the More page: [path, label, permission, component, hint]
export const MORE = [["enquiries", "Enquiries", "enquiries", "Enquiries", "Quote requests from the website"], ["customers", "Customers", "customers", "Customers", "Hotel accounts and credit terms"], ["orders", "Sales orders", "orders", "Orders", "Packing and dispatch"],
  ["stock", "Stock levels", "stock", "Stock", "Adjustments, batches and transfers"], ["price-lists", "Offers & discounts", "customers", "PriceLists", "Special price lists"], ["credit-notes", "Credit notes", "invoices", "CreditNotes", "Returns, needed for GST filing"],
  ["ledger", "Cash & bank book", "ledger", "Ledger", "Money in and out"], ["reports", "Reports", "reports", "Reports", "GST, sales and stock reports"], ["automation", "Automation & messages", "automation", "Automation", "Message rules and the outbox"],
  ["content", "Website content", "content", "Content", "Pages, banners and testimonials"], ["settings", "Company & GST", "settings", "Settings", "Business details on every invoice"], ["team", "Team", "team", "Team", "Staff sign-ins and roles"], ["audit", "Activity log", "audit", "Audit", "Who changed what"]];
const DETAIL = [["products/new", "catalog", "ProductForm"], ["products/:id", "catalog", "ProductForm"], ["customers/:id", "customers", "CustomerDetail"], ["quotes/:id", "quotes", "QuoteDetail"],
  ["orders/:id", "orders", "OrderDetail"], ["invoices/:id", "invoices", "InvoiceDetail"], ["purchase-orders/:id", "stock", "PurchaseDetail"]];

/** Old links to purchase orders and suppliers keep working. */
function OldPurchase() { const { id } = useParams(); return <Navigate to={`/admin/purchase-orders/${id}`} replace />; }

/** Remounts a detail page when its id changes (e.g. "new" → the saved record), so no stale data is shown. */
function ById({ name }) { const { id } = useParams(); const C = P[name]; return <C key={id} />; }

export default function AdminApp() {
  const [me, setMe] = useState(undefined); // undefined = checking, null = signed out
  const [menu, setMenu] = useState(false);
  const [command, setCommand] = useState(false);
  const [query, setQuery] = useState("");
  const nav = useNavigate(), loc = useLocation();
  useEffect(() => { document.title = "Admin | HaTikvah Care"; api("/api/admin/me").then(setMe).catch(() => setMe(null)); }, []);
  useEffect(() => { setMenu(false); setCommand(false); setQuery(""); }, [loc.pathname]);
  useEffect(() => {
    const key = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setCommand((v) => !v); }
      if (e.key === "Escape") setCommand(false);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  if (me === undefined) return <div className="center-note">Loading…</div>;
  if (me === null) return <><Login onLogin={setMe} /><Toaster /></>;
  const logout = async () => { await api("/api/admin/logout", { method: "POST" }).catch(() => {}); setMe(null); nav("/admin"); };
  const el = (name) => { const C = P[name]; return <C />; };
  const link = ([path, label, , , icon]) => <NavLink key={path} to={`/admin/${path}`}><Icon name={icon} />{label}</NavLink>;
  return (
    <Me.Provider value={me}><MetaProvider>
      <div className="adm">
        <aside className="adm-side">
          <div className="row-between"><img src="/brand/hatikvah-logo.png" alt="HaTikvah Care" width="110" height="62" /><button className="menu-btn adm-menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>{menu ? "Close" : "Menu"}</button></div>
          <div className="tenant-pill">HaTikvah Care <span>NOVA-004</span></div>
          <nav className={menu ? "open" : ""}>
            <NavLink to="/admin" end><Icon name="dashboard" />Overview</NavLink>
            {NAV.map(([group, items]) => {
              const mine = items.filter(([, , perm]) => can(me, perm));
              return mine.length > 0 && <div key={group} className="nav-group">{group && <small>{group}</small>}{mine.map(link)}</div>;
            })}
            <NavLink className="nav-more" to="/admin/more"><Icon name="more" />More tools</NavLink>
          </nav>
          <div className="adm-user"><span>{me.name}<small>{me.role}{me.twoFactor ? " · 2-step on" : ""}</small></span><NavLink to="/admin/account">My account</NavLink><button className="link" onClick={logout}>Sign out</button><a href="/" target="_blank" rel="noopener noreferrer">View website ↗</a></div>
          <div className="nova-brand"><span aria-hidden="true">⬡</span> Powered by NovaSaaS</div>
        </aside>
        <main className="adm-main">
          <header className="cockpit-topbar">
            <button className="command-trigger" onClick={() => setCommand(true)}><Icon name="search" /> Ask SwipeAI / Search <kbd>Ctrl K</kbd></button>
            <div className="top-actions">
              {can(me, "invoices") && <NavLink className="top-link" to="/admin/invoices/new">+ Create Invoice</NavLink>}
              {can(me, "quotes") && <NavLink className="top-link" to="/admin/quotes/new">+ New quote</NavLink>}
              {can(me, "pos") && <NavLink className="top-primary" to="/admin/pos">+ POS walk-in</NavLink>}
            </div>
            <span className="top-brand">Powered by NovaSaaS</span>
          </header>
          {command && (
            <div className="command-overlay" onMouseDown={() => setCommand(false)}>
              <div className="command-dialog" role="dialog" aria-modal="true" aria-label="Search navigation" onMouseDown={(e) => e.stopPropagation()}>
                <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search pages..." aria-label="Search pages" />
                <div className="command-results">
                  {[["", "Overview", null], ...NAV.flatMap(([, items]) => items), ...MORE]
                    .filter((x) => (!x[2] || can(me, x[2])) && x[1].toLowerCase().includes(query.toLowerCase()))
                    .map((x) => <NavLink key={x[0]} to={`/admin/${x[0]}`}>{x[1]} <span>↗</span></NavLink>)}
                </div>
                <small>Searches pages available to your role · Esc to close</small>
              </div>
            </div>
          )}
          <Suspense fallback={<p className="muted">Loading…</p>}>
            <Routes>
              <Route index element={el("Dashboard")} />
              <Route path="account" element={el("Account")} />
              <Route path="more" element={el("More")} />
              <Route path="purchases" element={<Navigate to="/admin/purchase-orders" replace />} />
              <Route path="purchases/:id" element={<OldPurchase />} />
              <Route path="suppliers" element={<Navigate to="/admin/vendors" replace />} />
              {[...NAV.flatMap(([, items]) => items), ...MORE].map(([path, , perm, C]) => <Route key={path} path={path} element={can(me, perm) ? el(C) : <Navigate to="/admin" />} />)}
              {DETAIL.map(([path, perm, C]) => <Route key={path} path={path} element={can(me, perm) ? <ById name={C} /> : <Navigate to="/admin" />} />)}
              <Route path="*" element={<Navigate to="/admin" />} />
            </Routes>
          </Suspense>
        </main>
        <Toaster />
      </div>
    </MetaProvider></Me.Provider>
  );
}
