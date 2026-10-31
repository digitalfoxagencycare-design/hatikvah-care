/** The counter's category chips. Catalogue categories are too fine for a touchscreen, so each chip matches on category, collection and name. */
export const POS_CATEGORIES = [
  { key: "all", label: "All" },
  { key: "amenities", label: "Hotel Amenities", match: /amenit|bath|body|dental|shav|comb|slipper|soap|shampoo|tray/i },
  { key: "linen", label: "Linen", match: /linen|towel|sheet|pillow|robe|duvet|napkin|curtain|blanket/i },
  { key: "dispensers", label: "Dispensers", match: /dispenser|pump/i },
  { key: "kits", label: "Kits", match: /\bkits?\b|basket/i },
];

export function posCategory(product, key) {
  const c = POS_CATEGORIES.find((x) => x.key === key);
  return !c?.match || c.match.test(`${product.category} ${product.collection} ${product.name}`);
}
