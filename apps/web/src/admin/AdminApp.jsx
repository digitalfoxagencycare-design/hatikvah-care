import { createContext, lazy, Suspense, useContext, useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import Login from "./Login.jsx";
import { MetaProvider } from "./ui.jsx";
import "./admin.css";

const Me = createContext(null);
export const useMe = () => useContext(Me);
export const can = (me, p) => me?.permissions?.includes(p);

const page = (f) => lazy(f);
const P = {
  Dashboard: page(() => import("./Dashboard.jsx")), Products: page(() => import("./Products.jsx")), ProductForm: page(() => import("./ProductForm.jsx")),
  Categories: page(() => import("./Categories.jsx")), Enquiries: page(() => import("./Enquiries.jsx")), Customers: page(() => import("./Customers.jsx")),
  CustomerDetail: page(() => import("./CustomerDetail.jsx")), PriceLists: page(() => import("./PriceLists.jsx")), Quotes: page(() => import("./Quotes.jsx")),
  QuoteDetail: page(() => import("./QuoteDetail.jsx")), Orders: page(() => import("./Orders.jsx")), OrderDetail: page(() => import("./OrderDetail.jsx")),
  Invoices: page(() => import("./Invoices.jsx")), InvoiceDetail: page(() => import("./InvoiceDetail.jsx")), Stock: page(() => import("./Stock.jsx")),
  Purchases: page(() => import("./Purchases.jsx")), PurchaseDetail: page(() => import("./PurchaseDetail.jsx")), Suppliers: page(() => import("./Suppliers.jsx")),
  Reports: page(() => import("./Reports.jsx")), Content: page(() => import("./Content.jsx")), Automation: page(() => import("./Automation.jsx")),
  Settings: page(() => import("./Settings.jsx")), Team: page(() => import("./Team.jsx")), Audit: page(() => import("./Audit.jsx")), Account: page(() => import("./Account.jsx")),
};
// [path, label, permission, component, extra routes]
const NAV = [
  ["Sell", [["enquiries", "Enquiries", "enquiries", "Enquiries"], ["customers", "Customers", "customers", "Customers"], ["quotes", "Quotations", "quotes", "Quotes"], ["orders", "Sales orders", "orders", "Orders"], ["invoices", "Invoices & payments", "invoices", "Invoices"]]],
  ["Catalogue", [["products", "Products", "catalog", "Products"], ["categories", "Categories", "catalog", "Categories"], ["price-lists", "Price lists", "customers", "PriceLists"]]],
  ["Stock", [["stock", "Stock", "stock", "Stock"], ["purchases", "Purchase orders", "stock", "Purchases"], ["suppliers", "Suppliers", "stock", "Suppliers"]]],
  ["Business", [["reports", "Reports", "reports", "Reports"], ["automation", "Automation & messages", "automation", "Automation"], ["content", "Website content", "content", "Content"]]],
  ["Admin", [["settings", "Company & GST", "settings", "Settings"], ["team", "Team", "team", "Team"], ["audit", "Activity log", "audit", "Audit"]]],
];
const DETAIL = [["products/new", "catalog", "ProductForm"], ["products/:id", "catalog", "ProductForm"], ["customers/:id", "customers", "CustomerDetail"], ["quotes/:id", "quotes", "QuoteDetail"],
  ["orders/:id", "orders", "OrderDetail"], ["invoices/:id", "invoices", "InvoiceDetail"], ["purchases/:id", "stock", "PurchaseDetail"]];

/** Remounts a detail page when its id changes (e.g. "new" → the saved record), so no stale data is shown. */
function ById({ name }) { const { id } = useParams(); const C = P[name]; return <C key={id} />; }

export default function AdminApp() {
  const [me, setMe] = useState(undefined); // undefined = checking, null = signed out
  const [menu, setMenu] = useState(false);
  const nav = useNavigate(), loc = useLocation();
  useEffect(() => { document.title = "Admin | HaTikvah Care"; api("/api/admin/me").then(setMe).catch(() => setMe(null)); }, []);
  useEffect(() => setMenu(false), [loc.pathname]);
  if (me === undefined) return <div className="center-note">Loading…</div>;
  if (me === null) return <Login onLogin={setMe} />;
  const logout = async () => { await api("/api/admin/logout", { method: "POST" }).catch(() => {}); setMe(null); nav("/admin"); };
  const el = (name) => { const C = P[name]; return <C />; };
  return (
    <Me.Provider value={me}><MetaProvider>
      <div className="adm">
        <aside className="adm-side">
          <div className="row-between"><img src="/brand/hatikvah-logo.png" alt="HaTikvah Care" width="110" height="62" /><button className="menu-btn adm-menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>{menu ? "Close" : "Menu"}</button></div>
          <nav className={menu ? "open" : ""}>
            <NavLink to="/admin" end>Dashboard</NavLink>
            {NAV.map(([group, items]) => {
              const mine = items.filter(([, , perm]) => can(me, perm));
              return mine.length > 0 && <div key={group} className="nav-group"><small>{group}</small>{mine.map(([path, label]) => <NavLink key={path} to={`/admin/${path}`}>{label}</NavLink>)}</div>;
            })}
          </nav>
          <div className="adm-user"><span>{me.name}<small>{me.role}{me.twoFactor ? " · 2-step on" : ""}</small></span><NavLink to="/admin/account">My account</NavLink><button className="link" onClick={logout}>Sign out</button><a href="/" target="_blank" rel="noopener noreferrer">View website ↗</a></div>
        </aside>
        <main className="adm-main">
          <Suspense fallback={<p className="muted">Loading…</p>}>
            <Routes>
              <Route index element={el("Dashboard")} />
              <Route path="account" element={el("Account")} />
              {NAV.flatMap(([, items]) => items).map(([path, , perm, C]) => <Route key={path} path={path} element={can(me, perm) ? el(C) : <Navigate to="/admin" />} />)}
              {DETAIL.map(([path, perm, C]) => <Route key={path} path={path} element={can(me, perm) ? <ById name={C} /> : <Navigate to="/admin" />} />)}
              <Route path="*" element={<Navigate to="/admin" />} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </MetaProvider></Me.Provider>
  );
}
