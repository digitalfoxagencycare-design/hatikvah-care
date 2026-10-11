import { createContext, useContext, useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import Audit from "./Audit.jsx";
import Categories from "./Categories.jsx";
import Dashboard from "./Dashboard.jsx";
import Enquiries from "./Enquiries.jsx";
import Login from "./Login.jsx";
import ProductForm from "./ProductForm.jsx";
import Products from "./Products.jsx";
import Settings from "./Settings.jsx";
import Team from "./Team.jsx";
import "./admin.css";

const Me = createContext(null);
export const useMe = () => useContext(Me);

export default function AdminApp() {
  const [me, setMe] = useState(undefined); // undefined = checking, null = signed out
  const nav = useNavigate();
  useEffect(() => { document.title = "Admin | HaTikvah Care"; api("/api/admin/me").then(setMe).catch(() => setMe(null)); }, []);
  if (me === undefined) return <div className="center-note">Loading…</div>;
  if (me === null) return <Login onLogin={setMe} />;
  const logout = async () => { await api("/api/admin/logout", { method: "POST" }).catch(() => {}); setMe(null); nav("/admin"); };
  return (
    <Me.Provider value={me}>
      <div className="adm">
        <aside className="adm-side">
          <img src="/brand/hatikvah-logo.png" alt="HaTikvah Care" width="130" height="73" />
          <nav>
            <NavLink to="/admin" end>Dashboard</NavLink>
            <NavLink to="/admin/products">Products</NavLink>
            <NavLink to="/admin/categories">Categories</NavLink>
            <NavLink to="/admin/enquiries">Enquiries</NavLink>
            {me.role === "owner" && <NavLink to="/admin/settings">Company & prices</NavLink>}
            {me.role === "owner" && <NavLink to="/admin/team">Team</NavLink>}
            {me.role === "owner" && <NavLink to="/admin/audit">Activity log</NavLink>}
          </nav>
          <div className="adm-user"><span>{me.name}<small>{me.role}</small></span><button className="link" onClick={logout}>Sign out</button><a href="/" target="_blank" rel="noopener noreferrer">View website ↗</a></div>
        </aside>
        <main className="adm-main">
          <Routes>
            <Route index element={<Dashboard />} />
            <Route path="products" element={<Products />} />
            <Route path="products/new" element={<ProductForm />} />
            <Route path="products/:id" element={<ProductForm />} />
            <Route path="categories" element={<Categories />} />
            <Route path="enquiries" element={<Enquiries />} />
            <Route path="settings" element={me.role === "owner" ? <Settings /> : <Navigate to="/admin" />} />
            <Route path="team" element={me.role === "owner" ? <Team /> : <Navigate to="/admin" />} />
            <Route path="audit" element={me.role === "owner" ? <Audit /> : <Navigate to="/admin" />} />
            <Route path="*" element={<Navigate to="/admin" />} />
          </Routes>
        </main>
      </div>
    </Me.Provider>
  );
}
