/**
 * Physical measurements and the packaging hierarchy of a product.
 * measure: what one piece is (20 ml bottle, 15 g soap, 27x54 inch towel, 1 pair of slippers).
 * packaging: piece → inner pack (box / bundle of N pieces) → master carton (M inner packs).
 * Documents keep the line in the unit it was ordered in (qty 2 boxes at the box rate) and record `perUnit`
 * (pieces in one ordered unit) so stock always moves in pieces. The web line editor mirrors uomOptions().
 */
export const MEASURE_UNITS = { volume: ["ml", "l"], weight: ["g", "kg"], dimensions: ["inch", "cm"], count: ["pcs", "rolls", "pairs"] };
export const UOMS = ["piece", "box", "carton"];

/** "20 ml", "1.5 kg", "27 x 54 inch", "2 pairs"; "" when nothing is set. */
export function measureLabel(m) {
  if (!m?.domain) return "";
  if (m.domain === "dimensions") return m.length && m.width ? `${m.length} x ${m.width} ${m.unit}` : "";
  return m.value ? `${m.value} ${m.unit}` : "";
}

/** Pieces in one inner pack and one master carton (0 = that level is not used). */
export function packCounts(p) {
  const inner = p?.packaging?.innerPack?.qty || 0;
  const cartonPacks = p?.packaging?.masterCarton?.qty || 0;
  return { inner, carton: inner && cartonPacks ? inner * cartonPacks : 0 };
}

/**
 * What a product can be sold in, with the pieces in each and the default rate (paise per ordered unit).
 * Box / carton rates come from packPrices when set, else the piece price times the pieces.
 */
export function uomOptions(p, piecePrice = p?.price ?? null) {
  const { inner, carton } = packCounts(p);
  const pp = p?.packPrices || {};
  const at = (n, own) => (own != null ? own : piecePrice == null ? null : Math.round(piecePrice * n));
  const out = [{ uom: "piece", label: p?.packaging?.baseUnit || "piece", perUnit: 1, rate: piecePrice }];
  if (inner) out.push({ uom: "box", label: `${p.packaging.innerPack.name || "box"} of ${inner}`, perUnit: inner, rate: at(inner, pp.box) });
  if (carton) out.push({ uom: "carton", label: `${p.packaging.masterCarton.name || "carton"} of ${carton}`, perUnit: carton, rate: at(carton, pp.carton) });
  return out;
}

/** Pieces a document line moves in stock. Lines saved before packaging existed count 1 piece per unit. */
export const pieces = (line) => Math.round((line.qty || 0) * (line.perUnit || 1) * 1000) / 1000;

/**
 * Fixes the packaging of document lines from the product record (never trusted from the browser): perUnit, and the
 * unit label shown on the document. A uom the product does not offer is refused. Returns { items } or { error }.
 */
export function expandLines(items, productsById) {
  const out = [];
  for (const it of items) {
    const uom = it.uom || "piece";
    const p = it.productId ? productsById[it.productId] : null;
    if (!p) { out.push({ ...it, uom: "piece", perUnit: it.perUnit || 1 }); continue; }
    const opt = uomOptions(p).find((o) => o.uom === uom);
    if (!opt) return { error: `${p.name} is not sold by the ${uom}` };
    out.push({ ...it, uom, perUnit: opt.perUnit, unit: uom === "piece" ? it.unit || p.unit || "pcs" : opt.label });
  }
  return { items: out };
}
