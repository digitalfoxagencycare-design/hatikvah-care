import { SECTORS } from "../sectors.js";

/** Filters by the kind of institution buying. withAll adds a tab that clears the filter. */
export default function SectorTabs({ value, onChange, withAll }) {
  return (
    <div className="sector-tabs" role="group" aria-label="Filter by institution">
      {withAll && <button type="button" aria-pressed={!value} onClick={() => onChange("")}>All sectors</button>}
      {SECTORS.map((s) => <button key={s.key} type="button" aria-pressed={value === s.key} onClick={() => onChange(s.key)}>{s.label}</button>)}
    </div>
  );
}
