const DAY_MS = 24 * 3600_000;

/** The WhatsApp customer service window, counted from the customer's last message. */
export function serviceWindow(lastAt, now = Date.now()) {
  const t = Date.parse(lastAt);
  if (!t) return { open: false, msLeft: 0, label: "Template only" };
  const msLeft = Math.max(0, Math.min(DAY_MS, t + DAY_MS - now));
  return { open: msLeft > 0, msLeft, label: msLeft > 0 ? clock(msLeft) : "Template only" };
}

const pad = (n) => String(n).padStart(2, "0");
function clock(ms) {
  const s = Math.ceil(ms / 1000);
  return `${pad(Math.floor(s / 3600))}h ${pad(Math.floor(s / 60) % 60)}m ${pad(s % 60)}s`;
}

/** Fills {{1}}, {{2}}… in a template body; a variable left empty stays visible as its placeholder. */
export const fillTemplate = (body, values) => body.replace(/\{\{(\d+)\}\}/g, (hole, n) => values[n - 1]?.trim() || hole);
