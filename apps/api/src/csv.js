/** Minimal RFC-4180 CSV reader/writer (quotes, commas and newlines inside cells). */
export function parseCsv(text) {
  const rows = []; let row = []; let cell = ""; let q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && s[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.some((x) => x !== "")) rows.push(row); row = []; }
    else cell += c;
  }
  row.push(cell); if (row.some((x) => x !== "")) rows.push(row);
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])));
}

/** Cells starting with = + - @ are prefixed with ' so a spreadsheet never runs them as a formula (CSV injection). */
const safe = (v) => { const s = v == null ? "" : String(v); return /^[=+\-@\t\r]/.test(s) ? "'" + s : s; };
export function toCsv(headers, rows) {
  const esc = (v) => { const s = safe(v); return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\r\n") + "\r\n";
}
