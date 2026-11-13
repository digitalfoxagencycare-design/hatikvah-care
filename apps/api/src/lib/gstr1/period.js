import { todayIST } from "../gst.js";

/**
 * Parses a return period parameter into date bounds and formatted period string.
 * Supports:
 * - "MMYYYY" e.g. "032024" (March 2024)
 * - "FY 23-24" or "2023-24" (Financial year April to March)
 * - from / to date strings (YYYY-MM-DD)
 */
export function parseGstr1Period(query = {}) {
  if (typeof query === "string") {
    query = { period: query };
  }
  const periodStr = String(query.period || query.fp || "").trim();
  const fyStr = String(query.fy || "").trim();

  // 1. Monthly MMYYYY format (official GSTR-1 format e.g. "032024")
  const mMatch = /^(0[1-9]|1[0-2])(\d{4})$/.exec(periodStr);
  if (mMatch) {
    const month = Number(mMatch[1]);
    const year = Number(mMatch[2]);
    const start = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const end = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    return {
      fp: periodStr,
      type: "month",
      from: start,
      to: end,
      label: `${new Date(year, month - 1).toLocaleString("en-US", { month: "short" })} ${year}`,
    };
  }

  // 2. Financial Year format e.g. "FY 23-24", "23-24", "2023-24"
  const fyTarget = fyStr || periodStr;
  const fyMatch = /(?:FY\s*)?(\d{2,4})[-/](\d{2,4})/i.exec(fyTarget);
  if (fyMatch) {
    let startY = Number(fyMatch[1]);
    if (startY < 100) startY += 2000;
    const endY = startY + 1;
    const from = `${startY}-04-01`;
    const to = `${endY}-03-31`;
    const shortFy = `FY ${String(startY).slice(2)}-${String(endY).slice(2)}`;
    return {
      fp: `03${endY}`, // default to closing month for full-year
      type: "fy",
      from,
      to,
      label: shortFy,
    };
  }

  // 3. Explicit from / to range
  if (query.from && query.to) {
    const from = String(query.from);
    const to = String(query.to);
    const m = to.slice(5, 7);
    const y = to.slice(0, 4);
    return {
      fp: `${m}${y}`,
      type: "range",
      from,
      to,
      label: `${from} to ${to}`,
    };
  }

  // Default: Current Month
  const today = todayIST();
  const curY = today.slice(0, 4);
  const curM = today.slice(5, 7);
  const lastDay = new Date(Date.UTC(Number(curY), Number(curM), 0)).getUTCDate();
  return {
    fp: `${curM}${curY}`,
    type: "month",
    from: `${curY}-${curM}-01`,
    to: `${curY}-${curM}-${String(lastDay).padStart(2, "0")}`,
    label: `${new Date(Number(curY), Number(curM) - 1).toLocaleString("en-US", { month: "short" })} ${curY}`,
  };
}

