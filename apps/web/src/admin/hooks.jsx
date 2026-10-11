import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";

/** Loads data with loading/error state and a reload function (no blank screens, no silent failures). */
export function useLoad(path) {
  const [s, setS] = useState({ data: null, error: null, loading: true });
  const load = useCallback(() => {
    setS((x) => ({ ...x, loading: true, error: null }));
    api(path).then((data) => setS({ data, error: null, loading: false })).catch((e) => setS({ data: null, error: e.message, loading: false }));
  }, [path]);
  useEffect(load, [load]);
  return { ...s, reload: load, setData: (d) => setS((x) => ({ ...x, data: typeof d === "function" ? d(x.data) : d })) };
}

export function Loader({ s, children }) {
  if (s.loading && !s.data) return <p className="muted" role="status">Loading…</p>;
  if (s.error) return <p className="alert" role="alert">{s.error} <button className="btn small" onClick={s.reload}>Try again</button></p>;
  return children;
}
