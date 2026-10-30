/** GST helpers: state codes, line/document totals (all money in integer paise), financial-year document numbers, amount in words. */
import { roundMoneyProduct, safePaise } from "./money.js";
export const STATES = [
  ["01", "Jammu & Kashmir"], ["02", "Himachal Pradesh"], ["03", "Punjab"], ["04", "Chandigarh"], ["05", "Uttarakhand"], ["06", "Haryana"], ["07", "Delhi"],
  ["08", "Rajasthan"], ["09", "Uttar Pradesh"], ["10", "Bihar"], ["11", "Sikkim"], ["12", "Arunachal Pradesh"], ["13", "Nagaland"], ["14", "Manipur"],
  ["15", "Mizoram"], ["16", "Tripura"], ["17", "Meghalaya"], ["18", "Assam"], ["19", "West Bengal"], ["20", "Jharkhand"], ["21", "Odisha"],
  ["22", "Chhattisgarh"], ["23", "Madhya Pradesh"], ["24", "Gujarat"], ["26", "Dadra & Nagar Haveli and Daman & Diu"], ["27", "Maharashtra"],
  ["29", "Karnataka"], ["30", "Goa"], ["31", "Lakshadweep"], ["32", "Kerala"], ["33", "Tamil Nadu"], ["34", "Puducherry"], ["35", "Andaman & Nicobar Islands"],
  ["36", "Telangana"], ["37", "Andhra Pradesh"], ["38", "Ladakh"],
].map(([code, name]) => ({ code, name }));
export const stateName = (code) => STATES.find((s) => s.code === code)?.name || "";
export const GST_RATES = [0, 5, 12, 18, 28];
export const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Totals for a document. Discounts and tax are rounded per line; the grand total is rounded to the rupee (round-off shown separately). */
export function calcTotals(items, interState) {
  let gross = 0, discount = 0, taxable = 0, cgst = 0, sgst = 0, igst = 0;
  const lines = items.map((it) => {
    const g = roundMoneyProduct(it.rate, it.qty), d = roundMoneyProduct(g, it.discountPct || 0, 100), t = safePaise(g - d), tax = roundMoneyProduct(t, it.gstRate || 0, 100);
    const c = interState ? 0 : Number((BigInt(tax) + 1n) / 2n), s = interState ? 0 : tax - c, i = interState ? tax : 0;
    gross += g; discount += d; taxable += t; cgst += c; sgst += s; igst += i;
    [gross, discount, taxable, cgst, sgst, igst].forEach(safePaise);
    return { ...it, amount: t, tax, total: safePaise(t + tax) };
  });
  const exact = safePaise(taxable + cgst + sgst + igst), total = safePaise(roundMoneyProduct(exact, 1, 100) * 100);
  return { lines, totals: { gross, discount, taxable, cgst, sgst, igst, tax: cgst + sgst + igst, roundOff: total - exact, total } };
}

/** Indian financial year (April to March) for a date, e.g. "2026-27". */
export function finYear(d = new Date()) {
  const ist = new Date(d.getTime() + 5.5 * 3600_000), y = ist.getUTCFullYear(), start = ist.getUTCMonth() >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}
/** Q/2026-27/0001 style numbers; a separate sequence per prefix and financial year (max 16 characters, as GST invoices require). */
export async function nextNumber(store, prefix, d = new Date()) {
  const fy = finYear(d);
  const number = `${prefix}/${fy}/${String(await store.nextSeq(`${prefix}:${fy}`)).padStart(4, "0")}`;
  if (number.length > 16) throw new RangeError("Document sequence exhausted: number exceeds 16 characters");
  return number;
}

/** Today's date (YYYY-MM-DD) in India, and date arithmetic on such strings. */
export const todayIST = (d = new Date()) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
export const addDays = (ymd, n) => new Date(Date.parse(ymd + "T00:00:00Z") + n * 86400_000).toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400_000);

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const two = (n) => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : ""));
const three = (n) => [n >= 100 ? ONES[Math.floor(n / 100)] + " Hundred" : "", two(n % 100)].filter(Boolean).join(" ");
function words(n) {
  if (n === 0) return "Zero";
  const parts = [];
  for (const [div, label] of [[10_000_000, "Crore"], [100_000, "Lakh"], [1000, "Thousand"]]) {
    if (n >= div) { parts.push(words(Math.floor(n / div)) + " " + label); n %= div; }
  }
  if (n) parts.push(three(n));
  return parts.join(" ");
}
/** 123456 paise -> "Rupees One Thousand Two Hundred Thirty Four and Fifty Six Paise Only" */
export function amountInWords(paise) {
  const r = Math.floor(Math.abs(paise) / 100), p = Math.abs(paise) % 100;
  return `Rupees ${words(r)}${p ? ` and ${two(p)} Paise` : ""} Only`;
}
