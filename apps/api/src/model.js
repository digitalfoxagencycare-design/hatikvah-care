import { z } from "zod";

export const slugify = (s) => String(s).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70) || "item";
export async function uniqueSlug(rows, base, selfId) {
  let slug = base, n = 2;
  while (rows.some((r) => r.slug === slug && r.id !== selfId)) slug = `${base}-${n++}`;
  return slug;
}

const imageUrl = z.string().max(200).regex(/^(\/catalog\/[\w.-]+\.(jpe?g|png|webp)|\/media\/[0-9a-f-]{36})$/, "Image must be an uploaded or catalogue image");
const paise = z.number().int().min(0).max(100_000_000).nullable();
const text = (max) => z.string().trim().max(max);

export const productInput = z.object({
  name: text(160).min(2),
  sku: text(30).regex(/^[A-Za-z0-9._-]*$/, "SKU may use letters, numbers . _ -").optional(),
  category: text(60).min(1),
  collection: text(80).default(""),
  pack: text(120).default(""),
  variants: z.array(text(60).min(1)).max(20).default([]),
  description: text(2000).default(""),
  images: z.array(imageUrl).max(8).default([]),
  price: paise.default(null),
  priceUnit: text(40).default(""),
  minOrder: text(60).default(""),
  active: z.boolean().default(true),
  featured: z.boolean().default(false),
  order: z.number().int().min(0).max(100000).optional(),
  hsn: z.string().trim().regex(/^\d{0,8}$/, "HSN code: up to 8 digits").default(""),
  gstRate: z.number().refine((v) => [0, 5, 12, 18, 28].includes(v), "GST rate must be 0, 5, 12, 18 or 28").default(18),
  unit: text(20).default("pcs"),
  costPrice: paise.default(null),
  stockTracked: z.boolean().default(false),
  reorderLevel: z.number().min(0).max(10_000_000).default(0),
  reorderQty: z.number().min(0).max(10_000_000).default(0),
  supplierId: z.string().max(60).default(""),
}).strict();
export const productPatch = productInput.partial().strict();

export const categoryInput = z.object({
  name: text(80).min(2), description: text(400).default(""), order: z.number().int().min(0).max(1000).default(0),
}).strict();

export const enquiryInput = z.object({
  name: text(100).min(2),
  company: text(120).default(""),
  phone: text(20).regex(/^[0-9+()\s-]{7,20}$/, "Enter a valid phone number"),
  email: z.union([z.literal(""), z.string().trim().email().max(160)]).default(""),
  message: text(2000).default(""),
  items: z.array(z.object({ productId: z.string().max(60), qty: z.number().int().min(1).max(1_000_000) })).max(60).default([]),
  website: z.string().max(200).optional(), // honeypot: real people leave it empty
  source: z.object({ utm_source: text(100).optional(), utm_medium: text(100).optional(), utm_campaign: text(100).optional(), referrer: text(200).optional(), page: text(200).optional() }).strict().optional(),
}).strict();

export const settingsInput = z.object({
  name: text(100).min(2), legalName: text(100).default(""), tagline: text(200).default(""), about: text(3000).default(""),
  phone: text(30).default(""), whatsapp: text(20).regex(/^[0-9]{0,15}$/, "WhatsApp number: digits only, with country code").default(""),
  email: z.union([z.literal(""), z.string().trim().email().max(160)]).default(""),
  website: text(160).default(""), address: text(400).default(""), hours: text(200).default(""),
  showPrices: z.boolean().default(true),
  gstin: z.union([z.literal(""), z.string().trim().toUpperCase().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, "GSTIN should look like 36ABCDE1234F1Z5")]).default(""),
  stateCode: z.string().regex(/^\d{2}$/, "Choose the company's state").default("36"),
  bankDetails: text(500).default(""), upiId: text(80).default(""),
  quoteTerms: text(3000).default(""), invoiceTerms: text(3000).default(""),
  quoteValidityDays: z.number().int().min(1).max(365).default(15), paymentTermsDays: z.number().int().min(0).max(365).default(30),
  ga4Id: z.union([z.literal(""), z.string().trim().regex(/^G-[A-Z0-9]{4,15}$/, "Google Analytics ID looks like G-XXXXXXX")]).default(""),
  metaPixelId: z.union([z.literal(""), z.string().trim().regex(/^\d{5,20}$/, "Meta Pixel ID is digits only")]).default(""),
  brochureUrl: z.union([z.literal(""), z.string().regex(/^\/media\/[0-9a-f-]{36}$/)]).default(""),
}).strict();

export const DEFAULT_SETTINGS = {
  key: "company",
  name: "HaTikvah Care", legalName: "EXL Marketing",
  tagline: "Hospitality · Hygiene · Wellness Supplies",
  about: "Established in 2002 and rebranded as EXL Marketing in 2022, HaTikvah Care is a trusted provider of premium hospitality supply solutions: guest amenities, F&B disposables, housekeeping products, hygiene solutions, eco-friendly products, healthcare and institutional supplies, and customised branding materials. We serve hotels, resorts, spas, serviced apartments, hospitals, corporate institutions and large-scale events across India.",
  phone: "+91 79954 44434", whatsapp: "917995444434", email: "exlhygiene@gmail.com", website: "www.hatikvahcare.com",
  address: "Eshwar Nilayam, Plot No. 4-1447, Kondapur Golden Tulip Estate, JV Hills, Gachibowli, Hyderabad, Telangana – 500084",
  hours: "", showPrices: true,
  gstin: "", stateCode: "36", bankDetails: "", upiId: "",
  quoteTerms: "1. Prices are exclusive of freight unless stated.\n2. Delivery within 7–10 working days of order confirmation.\n3. Custom branding requires artwork approval.",
  invoiceTerms: "Goods once sold will not be taken back. Subject to Hyderabad jurisdiction.",
  quoteValidityDays: 15, paymentTermsDays: 30, ga4Id: "", metaPixelId: "", brochureUrl: "",
};
/** Company settings with defaults filled in for fields added after the database was created. */
export async function getSettings(store) {
  const s = await store.settings.findBy("key", "company");
  return { ...DEFAULT_SETTINGS, ...(s || {}) };
}

/** What a visitor may see. Prices only when the owner has them switched on and a price exists. */
export function publicProduct(p, settings) {
  const showPrice = settings.showPrices && p.price != null;
  return {
    id: p.id, slug: p.slug, sku: p.sku, name: p.name, category: p.category, collection: p.collection, pack: p.pack, variants: p.variants,
    description: p.description, images: p.images, featured: p.featured, pricePaise: showPrice ? p.price : null, priceUnit: showPrice ? p.priceUnit : "",
    minOrder: p.minOrder,
  };
}
