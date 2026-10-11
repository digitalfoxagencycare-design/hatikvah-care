import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, storeGet, storeSet } from "./api.js";

const Ctx = createContext(null);
export const useSite = () => useContext(Ctx);

/** Loads the catalogue + company details once and keeps the quote basket (saved in the browser). */
export function SiteProvider({ children }) {
  const [state, setState] = useState({ loading: true, error: null, catalog: null, settings: null });
  const [basket, setBasket] = useState(() => storeGet("hc_basket", []));
  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.all([api("/api/public/catalog"), api("/api/public/settings")])
      .then(([catalog, settings]) => setState({ loading: false, error: null, catalog, settings }))
      .catch((e) => setState({ loading: false, error: e.message, catalog: null, settings: null }));
  }, []);
  useEffect(load, [load]);
  useEffect(() => storeSet("hc_basket", basket), [basket]);

  const value = useMemo(() => ({
    ...state, reload: load, basket,
    add: (productId, qty = 1) => setBasket((b) => (b.some((i) => i.productId === productId) ? b.map((i) => (i.productId === productId ? { ...i, qty: Math.min(1_000_000, i.qty + qty) } : i)) : [...b, { productId, qty }])),
    setQty: (productId, qty) => setBasket((b) => b.map((i) => (i.productId === productId ? { ...i, qty: Math.max(1, Math.min(1_000_000, qty || 1)) } : i))),
    remove: (productId) => setBasket((b) => b.filter((i) => i.productId !== productId)),
    clear: () => setBasket([]),
  }), [state, load, basket]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
