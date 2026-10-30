import { sectorOf } from "./sectors.js";

/** The enquiry text for the sales team. An enquiry has no sector or city field, so they travel in the message. */
export function rfqMessage({ mode, sector, city, volume, note, names = [] }) {
  return [
    mode === "sample" ? "Sample request" : "Request for quotation",
    sectorOf(sector) && `Sector: ${sectorOf(sector).label}`,
    city?.trim() && `City: ${city.trim()}`,
    mode === "rfq" && volume?.trim() && `Expected volume: ${volume.trim()}`,
    names.length > 0 && `Interested in: ${names.join(", ")}`,
    note?.trim(),
  ].filter(Boolean).join("\n").slice(0, 2000);
}

/** One of each product for samples; the quantity asked for on a quote. */
export const rfqItems = (mode, lines) => lines.filter((l) => l.productId).map(({ productId, qty, variant }) => ({ productId, qty: mode === "sample" ? 1 : qty, ...(variant ? { variant } : {}) }));
