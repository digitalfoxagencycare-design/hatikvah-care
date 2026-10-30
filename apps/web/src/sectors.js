/** Who the catalogue serves. Products carry no sector field, so each sector is matched on the product's category, collection and name. */
export const SECTORS = [
  { key: "hotels", label: "Hotels & Resorts", blurb: "Guest amenities, in-room tray supplies, linen and housekeeping for every room category.", match: /amenit|bath|body|tray|linen|towel|bed|pillow|curtain|robe|kit|housekeeping|coffee|tea|eco|bamboo|dispenser/i, not: /hospital/i },
  { key: "hospitals", label: "Hospitals", blurb: "Hospital linen, patient comfort kits and the hygiene consumables wards get through daily.", match: /hospital|sanitary|dental kit|slipper|blanket|bed sheet|pillow|towel|housekeeping|soap/i },
  { key: "spas", label: "Spas", blurb: "Robes, towels, body care and dispensers for treatment rooms and wellness floors.", match: /\bspas?\b|robe|towel|body|shower|shampoo|conditioner|lotion|soap|dispenser|farm fresh|slipper|bamboo/i },
  { key: "corporate", label: "Corporate", blurb: "Pantry beverages, tray sachets and washroom supplies for offices and guest houses.", match: /coffee|tea|creamer|sugar|sweetener|sachet|beverage|tray|napkin|housekeeping|foil|cling|disposable|dispenser|soap/i },
];

export const sectorOf = (key) => SECTORS.find((s) => s.key === key);

/** Up to n products, taking one from each category in turn so a preview shows the range rather than one kind of item. */
export function spreadByCategory(products, n) {
  const groups = {};
  for (const p of products) (groups[p.category] ||= []).push(p);
  const queues = Object.values(groups), out = [];
  for (let i = 0; out.length < n && queues.some((q) => q[i]); i++) for (const q of queues) if (q[i] && out.length < n) out.push(q[i]);
  return out;
}

export function inSector(product, key) {
  const s = sectorOf(key);
  if (!s) return true;
  const text = `${product.category} ${product.collection} ${product.name}`;
  return s.match.test(text) && !s.not?.test(text);
}
