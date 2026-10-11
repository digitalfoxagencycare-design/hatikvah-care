import { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { SiteProvider } from "./data.jsx";
import Layout from "./components/Layout.jsx";
import Home from "./pages/Home.jsx";
import Catalog from "./pages/Catalog.jsx";
import Product from "./pages/Product.jsx";
import Quote from "./pages/Quote.jsx";
import NotFound from "./pages/NotFound.jsx";
import "./styles.css";

const Admin = lazy(() => import("./admin/AdminApp.jsx"));

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Routes>
      <Route path="/admin/*" element={<Suspense fallback={<div className="center-note">Loading…</div>}><Admin /></Suspense>} />
      <Route element={<SiteProvider><Layout /></SiteProvider>}>
        <Route index element={<Home />} />
        <Route path="catalog" element={<Catalog />} />
        <Route path="product/:slug" element={<Product />} />
        <Route path="quote" element={<Quote />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  </BrowserRouter>,
);
