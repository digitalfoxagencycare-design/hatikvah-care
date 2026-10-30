import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";

/** Loads data with loading/error state and a reload function (no blank screens, no silent failures). */
export function useLoad(path) {
  const [s, setS] = useState({ data: null, error: null, loading: true });
  const current = useRef(null);
  const load = useCallback(() => {
    current.current?.abort(); const controller = new AbortController(); current.current = controller;
    setS((x) => ({ ...x, loading: true, error: null }));
    api(path, { signal: controller.signal }).then((data) => { if (!controller.signal.aborted) setS({ data, error: null, loading: false }); }).catch((e) => { if (!controller.signal.aborted) setS({ data: null, error: e.message, loading: false }); });
  }, [path]);
  useEffect(() => { load(); return () => current.current?.abort(); }, [load]);
  return { ...s, reload: load, setData: (d) => setS((x) => ({ ...x, data: typeof d === "function" ? d(x.data) : d })) };
}

export function Loader({ s, children }) {
  if (s.loading && !s.data) return <p className="muted" role="status">Loading…</p>;
  if (s.error) return <p className="alert" role="alert">{s.error} <button className="btn small" onClick={s.reload}>Try again</button></p>;
  return children;
}
