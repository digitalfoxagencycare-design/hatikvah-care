import { useEffect, useRef, useState } from "react";

let show = () => {}, open = () => {};
/** Floating message, gone in a few seconds. Tone is "ok" or "error". */
export const toast = (text, tone = "ok") => show(text, tone);
/** In-app yes/no question: resolves true or false. Options: confirmLabel, danger. */
export const ask = (title, opts = {}) => new Promise((done) => open({ title, ...opts, done }));
/** In-app text question: resolves the text, or null if cancelled. Options: value, type, placeholder, confirmLabel. */
export const askText = (title, opts = {}) => ask(title, { ...opts, input: true });

function Dialog({ d, onClose }) {
  const [value, setValue] = useState(d.value || "");
  const yes = useRef(null);
  const answer = (v) => { d.done(v); onClose(); };
  const cancel = () => answer(d.input ? null : false);
  useEffect(() => { if (!d.input) yes.current?.focus(); const k = (e) => e.key === "Escape" && cancel(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="modal dialog" role="alertdialog" aria-modal="true" aria-label={d.title} onMouseDown={(e) => e.target === e.currentTarget && cancel()}>
      <form className="modal-box dialog-box" onSubmit={(e) => { e.preventDefault(); answer(d.input ? value : true); }}>
        <h2>{d.title}</h2>
        {d.body && <p className="muted">{d.body}</p>}
        {d.input && <input autoFocus type={d.type || "text"} value={value} placeholder={d.placeholder} autoComplete={d.type === "password" ? "new-password" : "off"} onChange={(e) => setValue(e.target.value)} aria-label={d.title} />}
        <div className="dialog-acts">
          <button type="button" className="btn ghost" onClick={cancel}>Cancel</button>
          <button ref={yes} className={"btn" + (d.danger ? " danger-btn" : "")}>{d.confirmLabel || "OK"}</button>
        </div>
      </form>
    </div>
  );
}

/** Mount once: draws the toasts and the question dialog. */
export function Toaster() {
  const [items, setItems] = useState([]);
  const [dialog, setDialog] = useState(null);
  const next = useRef(1);
  const remove = (id) => setItems((xs) => xs.filter((x) => x.id !== id));
  useEffect(() => {
    show = (text, tone) => {
      const id = next.current++;
      setItems((xs) => (xs.some((x) => x.text === text) ? xs : [...xs.slice(-3), { id, text, tone }]));
      setTimeout(() => remove(id), tone === "error" ? 7000 : 3500);
    };
    open = setDialog;
    return () => { show = () => {}; open = () => {}; };
  }, []);
  return (
    <>
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => <div key={t.id} className={"toast " + t.tone} role={t.tone === "error" ? "alert" : undefined}><i aria-hidden="true" /><span>{t.text}</span><button type="button" aria-label="Dismiss" onClick={() => remove(t.id)}>✕</button></div>)}
      </div>
      {dialog && <Dialog key={dialog.title} d={dialog} onClose={() => setDialog(null)} />}
    </>
  );
}
