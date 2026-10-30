import { useEffect, useState } from "react";
import { Loader, useLoad } from "./hooks.jsx";
import { fillTemplate } from "./waWindow.js";

/** Shows what each WhatsApp Manager template says, and which record fills each variable. */
export default function TemplatePreview({ customer }) {
  const s = useLoad("/api/admin/whatsapp/templates");
  const [name, setName] = useState("hc_quote");
  const [values, setValues] = useState([]);
  const t = s.data?.find((x) => x.name === name);
  useEffect(() => {
    if (t) setValues(t.variables.map((v) => (v.label === "customer name" && customer) || v.sample));
  }, [t, customer]);
  return (
    <section className="tpl" aria-label="Message templates">
      <h3>Message templates</h3>
      <Loader s={s}>{t && (
        <>
          <div className="tpl-tabs" role="group" aria-label="Template">
            {s.data.map((x) => <button key={x.name} type="button" aria-pressed={x.name === name} className={x.approved ? "" : "pending"} onClick={() => setName(x.name)}>{x.name}</button>)}
          </div>
          <div className="tpl-grid">
            <div>
              <p className="tpl-status">
                <span className={"wa-state " + (t.approved ? "approved" : "pending")}>{t.approved ? "Approved by Meta" : "Not approved yet"}</span>
                <small>{t.label}, {t.category}, {t.language}</small>
              </p>
              <dl className="tpl-vars">
                {t.variables.map((v, i) => (
                  <div key={v.label}>
                    <dt><label htmlFor={`tpl-${i}`}>{`{{${i + 1}}}`} {v.label}</label><small>{v.source}</small></dt>
                    <dd><input id={`tpl-${i}`} value={values[i] ?? ""} maxLength={200} onChange={(e) => setValues(values.map((x, k) => (k === i ? e.target.value : x)))} /></dd>
                  </div>
                ))}
              </dl>
            </div>
            <figure className="tpl-phone">
              <figcaption>Preview</figcaption>
              <div className="tpl-msg">
                <p>{fillTemplate(t.body, values)}</p>
                {t.button && <span className="tpl-btn">{t.button.label}{t.button.url && <small>{t.button.url}</small>}</span>}
              </div>
            </figure>
          </div>
          <p className="muted small-print">
            {!t.approved
              ? `Create ${t.name} in WhatsApp Manager and wait for Meta to approve it. Until then, confirmations outside the window use the general template.`
              : t.connected
                ? `Sends as ${t.connected} for: ${t.usedFor}.`
                : `Approved, but ${t.env} is not set on this server, so it will not send until it is.`}
          </p>
        </>
      )}</Loader>
    </section>
  );
}
