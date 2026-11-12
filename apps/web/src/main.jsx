import { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { SiteProvider } from "./data.jsx";
import Layout from "./components/Layout.jsx";
import Home from "./pages/Home.jsx";
import Catalog from "./pages/Catalog.jsx";
import Product from "./pages/Product.jsx";
import Quote from "./pages/Quote.jsx";
import Cart from "./pages/Cart.jsx";
import About from "./pages/About.jsx";
import Contact from "./pages/Contact.jsx";
import NotFound from "./pages/NotFound.jsx";
import "./styles.css";
import ErrorBoundary from "./components/ErrorBoundary.jsx";

const safeLazy = (f) => lazy(async () => {
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

const Admin = safeLazy(() => import("./admin/AdminApp.jsx"));
const DocPage = safeLazy(() => import("./pages/DocPage.jsx"));
const Checkout = safeLazy(() => import("./pages/Checkout.jsx"));
const Account = safeLazy(() => import("./buyer/BuyerPortal.jsx")); // buyer portal: quotes, orders, tracking, invoices, reorder
const wait = (el) => <Suspense fallback={<div className="center-note">Loading…</div>}>{el}</Suspense>;

createRoot(document.getElementById("root")).render(
  <ErrorBoundary><BrowserRouter>
    <Routes>
      <Route path="/doc/:kind/:token" element={<Suspense fallback={<div className="center-note">Loading…</div>}><DocPage /></Suspense>} />
      <Route path="/admin/*" element={<Suspense fallback={<div className="center-note">Loading…</div>}><Admin /></Suspense>} />
      <Route element={<SiteProvider><Layout /></SiteProvider>}>
        <Route index element={<Home />} />
        <Route path="shop" element={<Catalog />} />
        <Route path="catalog" element={<Catalog />} />
        <Route path="product/:slug" element={<Product />} />
        <Route path="quote" element={<Quote />} />
        <Route path="cart" element={<Cart />} />
        <Route path="checkout" element={wait(<Checkout />)} />
        <Route path="account" element={wait(<Account />)} />
        <Route path="about" element={<About />} />
        <Route path="contact" element={<Contact />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  </BrowserRouter></ErrorBoundary>,
);
