import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, storeGet, storeSet } from "./api.js";
import { captureSource, loadAnalytics } from "./track.js";

const Ctx = createContext(null);
export const useSite = () => useContext(Ctx);

/** Loads the catalogue + company details once and keeps the cart / quote basket (saved in the browser). */
export function SiteProvider({ children }) {
  const [state, setState] = useState({ loading: true, error: null, catalog: null, settings: null });
  const [basket, setBasket] = useState(() => storeGet("hc_basket", []));
  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.all([api("/api/public/catalog"), api("/api/public/settings")])
      .then(([catalog, settings]) => { setState({ loading: false, error: null, catalog, settings }); loadAnalytics(settings); })
      .catch((e) => setState({ loading: false, error: e.message, catalog: null, settings: null }));
  }, []);
  useEffect(load, [load]);
  useEffect(captureSource, []);
  useEffect(() => storeSet("hc_basket", basket), [basket]);

  // A basket line is a product plus its chosen option (size, fragrance…); the same product in two sizes is two lines.
  const same = (i, productId, variant) => i.productId === productId && (i.variant || "") === (variant || "");
  const value = useMemo(() => ({
    ...state, reload: load, basket,
    add: (productId, qty = 1, variant = "") => setBasket((b) => (b.some((i) => same(i, productId, variant)) ? b.map((i) => (same(i, productId, variant) ? { ...i, qty: Math.min(1_000_000, i.qty + qty) } : i)) : [...b, { productId, qty, variant }])),
    setQty: (productId, qty, variant = "") => setBasket((b) => b.map((i) => (same(i, productId, variant) ? { ...i, qty: Math.max(1, Math.min(1_000_000, qty || 1)) } : i))),
    remove: (productId, variant = "") => setBasket((b) => b.filter((i) => !same(i, productId, variant))),
    clear: () => setBasket([]),
  }), [state, load, basket]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
