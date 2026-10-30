import { z } from "zod";
import { GST_RATES, GSTIN_RE } from "./lib/gst.js";
import { ROLE_NAMES } from "./lib/permissions.js";

/** Input rules for the business modules (CRM, sales, stock, content). Product/category/enquiry/settings rules live in model.js. */
const text = (max) => z.string().trim().max(max);
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-10-31");
const optDate = z.union([z.literal(""), ymd]).default("");
const id = z.string().max(60);
const phone = z.union([z.literal(""), text(20).regex(/^[0-9+()\s-]{7,20}$/, "Enter a valid phone number")]).default("");
const email = z.union([z.literal(""), z.string().trim().toLowerCase().email().max(160)]).default("");
const stateCode = z.union([z.literal(""), z.string().regex(/^\d{2}$/)]).default("");
const gstin = z.union([z.literal(""), z.string().trim().toUpperCase().regex(GSTIN_RE, "GSTIN should look like 36ABCDE1234F1Z5")]).default("");
const paise = z.number().int().min(0).max(10_000_000_000);

export const customerInput = z.object({
  name: text(160).min(2), contactName: text(100).default(""), phone, email, gstin, stateCode, city: text(80).default(""),
  billingAddress: text(400).default(""), shippingAddress: text(400).default(""), priceListId: id.default(""),
  paymentTermsDays: z.number().int().min(0).max(365).default(30), reorderDays: z.number().int().min(0).max(365).default(0),
  tags: z.array(text(30).min(1)).max(10).default([]), notes: text(2000).default(""), assignedTo: id.default(""), followUpAt: optDate, source: text(80).default(""),
}).strict();

export const activityInput = z.object({
  entity: z.enum(["enquiry", "customer", "quote", "order", "invoice", "purchase"]), entityId: id.min(1),
  kind: z.enum(["note", "call", "email", "whatsapp", "meeting", "visit"]).default("note"), text: text(2000).min(1), followUpAt: optDate.optional(),
}).strict();

export const priceListInput = z.object({
  name: text(80).min(2), discountPct: z.number().min(0).max(90).default(0), prices: z.record(id, paise).default({}),
}).strict();

export const lineInput = z.object({
  productId: id.default(""), sku: text(30).default(""), name: text(200).min(1), hsn: z.string().trim().regex(/^\d{0,8}$/, "HSN code: up to 8 digits").default(""),
  unit: text(20).default("pcs"), qty: z.number().positive().max(10_000_000), rate: paise, discountPct: z.number().min(0).max(100).default(0),
  gstRate: z.number().refine((v) => GST_RATES.includes(v), "GST rate must be 0, 5, 12, 18 or 28").default(18),
  // Ordered by the piece, box or carton; perUnit (pieces per ordered unit) is fixed from the product on the server.
  uom: z.enum(["piece", "box", "carton"]).default("piece"), perUnit: z.number().int().min(1).max(10_000_000).default(1),
}).strict();
const lines = z.array(lineInput).min(1, "Add at least one item").max(150);

export const quoteInput = z.object({
  customerId: id.min(1, "Choose a customer"), enquiryId: id.default(""), items: lines, validUntil: optDate,
  notes: text(2000).default(""), terms: text(3000).default(""), placeOfSupply: stateCode,
}).strict();

export const orderInput = z.object({
  customerId: id.min(1, "Choose a customer"), items: lines, expectedDate: optDate, notes: text(2000).default(""), placeOfSupply: stateCode, poNumber: text(60).default(""),
}).strict();
/** Direct booking from an enquiry: customerId picks a customer, customer creates one, neither matches the enquiry's phone. */
export const bookingInput = z.object({
  customerId: id.default(""), customer: customerInput.pick({ name: true, contactName: true, phone: true, email: true, gstin: true, stateCode: true }).optional(),
  items: lines, deliveryAddress: text(380).min(5, "Enter the delivery address"), pincode: z.union([z.literal(""), z.string().regex(/^\d{6}$/, "PIN code is 6 digits")]).default(""),
  placeOfSupply: stateCode, expectedDate: optDate, poNumber: text(60).default(""), notes: text(2000).default(""), notifyWhatsApp: z.boolean().default(true),
}).strict();
export const dispatchInput = z.object({
  transporter: text(100).default(""), trackingNo: text(100).default(""), vehicleNo: text(30).default(""), date: optDate, notes: text(500).default(""),
  // "shadowfax" books the courier pickup as soon as the challan is made (live tracking link goes to the customer)
  courier: z.enum(["", "shadowfax"]).default(""), dropPincode: z.union([z.literal(""), z.string().regex(/^\d{6}$/, "PIN code is 6 digits")]).default(""),
  weightKg: z.number().positive().max(1000).default(1), packages: z.number().int().min(1).max(500).default(1),
}).strict();

export const invoiceInput = z.object({
  customerId: id.min(1, "Choose a customer"), items: lines, date: optDate, dueDate: optDate, notes: text(2000).default(""), placeOfSupply: stateCode, poNumber: text(60).default(""),
}).strict();

export const paymentInput = z.object({
  amount: z.number().int().min(1).max(10_000_000_000), date: optDate, mode: z.enum(["bank", "upi", "cash", "cheque", "card", "razorpay", "other"]).default("bank"),
  reference: text(100).default(""), notes: text(500).default(""),
}).strict();

export const batchInput = z.object({ batchNumber: text(40).min(1, "Enter the batch number"), mfgDate: optDate, expDate: optDate }).strict()
  .refine((b) => !b.mfgDate || !b.expDate || b.mfgDate < b.expDate, "Expiry must be after the manufacturing date");
export const stockAdjustInput = z.object({
  productId: id.min(1), qty: z.number().refine((v) => v !== 0 && Math.abs(v) <= 10_000_000, "Quantity cannot be zero"), kind: z.enum(["in", "out", "adjust"]).default("adjust"), note: text(300).default(""),
  batch: batchInput.optional(),
}).strict();

export const supplierInput = z.object({
  name: text(160).min(2), contactName: text(100).default(""), phone, email, gstin, stateCode, address: text(400).default(""), notes: text(1000).default(""),
}).strict();

export const purchaseInput = z.object({
  supplierId: id.min(1, "Choose a supplier"), expectedDate: optDate, notes: text(1000).default(""), billNumber: text(80).default(""), receiveNow: z.boolean().default(false),
  items: z.array(z.object({ productId: id.min(1), qty: z.number().positive().max(10_000_000), rate: paise.default(0) }).strict()).min(1, "Add at least one item").max(150),
}).strict();
export const receiveInput = z.object({ lines: z.array(z.object({ productId: id.min(1), qty: z.number().positive().max(10_000_000), batch: batchInput.optional() }).strict()).min(1) }).strict();

/** Credit note against an invoice: each line names the invoice line (index) and how much of it to credit. */
export const creditNoteInput = z.object({
  invoiceId: id.min(1, "Choose the invoice"), reason: z.enum(["damaged", "incorrect_item", "return", "pricing_adjustment", "other"]),
  restock: z.boolean().optional(), date: optDate, notes: text(1000).default(""),
  items: z.array(z.object({ line: z.number().int().min(0).max(149), qty: z.number().positive().max(10_000_000), rate: paise.optional(), batch: batchInput.optional() }).strict())
    .min(1, "Choose at least one item to credit").max(150),
}).strict();

/** Counter sale: invoice and (optionally) payment in one step. No customer = walk-in, found or created by phone. */
export const posInput = z.object({
  customerId: id.default(""), walkIn: z.object({ name: text(160).min(2), phone, gstin, stateCode }).strict().optional(),
  items: lines, placeOfSupply: stateCode, notes: text(500).default(""),
  payment: z.object({ mode: z.enum(["cash", "upi", "card", "bank", "cheque"]), reference: text(100).default(""), amount: paise.optional() }).strict().nullable().default(null),
}).strict().refine((d) => d.customerId || d.walkIn, "Choose a customer or enter the walk-in buyer's name");

export const PICKUP_WINDOWS = ["09:00-12:00", "12:00-15:00", "15:00-18:00", "18:00-21:00"];
const optPin = z.union([z.literal(""), z.string().regex(/^\d{6}$/, "PIN code is 6 digits")]).optional();
export const shipmentInput = z.object({
  provider: z.enum(["shadowfax", "porter"]).default("shadowfax"), pickupPincode: optPin, dropPincode: optPin,
  weightKg: z.number().positive().max(1000).default(1), packages: z.number().int().min(1).max(500).default(1),
  pickupDate: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-10-31")]).default(""), pickupWindow: z.union([z.literal(""), z.enum(PICKUP_WINDOWS)]).default(""),
  dropLat: z.number().min(-90).max(90).optional(), dropLng: z.number().min(-180).max(180).optional(), // Porter routes by map location, not PIN code
}).strict().refine((d) => !d.pickupDate === !d.pickupWindow, { message: "Choose both the pickup date and the time slot", path: ["pickupWindow"] })
  .refine((d) => d.provider !== "porter" || (d.dropLat !== undefined && d.dropLng !== undefined), { message: "Porter needs the delivery location (latitude and longitude)", path: ["dropLat"] });

export const upiCloseInput = z.object({ payment: z.object({ mode: z.enum(["cash", "card", "bank", "cheque"]), reference: text(100).default("") }).strict().nullable().default(null) }).strict();

const imageRef = z.union([z.literal(""), z.string().max(200).regex(/^(\/catalog\/[\w.-]+\.(jpe?g|png|webp)|\/brand\/[\w.-]+\.(jpe?g|png|webp)|\/media\/[0-9a-f-]{36})$/, "Choose an uploaded image")]);
export const homeInput = z.object({
  hero: z.object({ eyebrow: text(100).default(""), title: text(140).min(3), lead: text(500).default(""), image: imageRef.default(""), cta: text(40).default("Browse the catalogue"), cta2: text(40).default("Request a quote") }).strict(),
  banner: z.object({ active: z.boolean().default(false), text: text(200).default(""), link: text(200).regex(/^(\/[\w\-/?=&#.]*|https:\/\/[\w.-]+[\w\-/?=&#.%]*)?$/, "Link must start with / or https://").default("") }).strict(),
  stats: z.array(z.object({ value: text(30).min(1), label: text(60).default("") }).strict()).max(6).default([]),
  why: z.array(z.object({ title: text(80).min(1), text: text(240).default("") }).strict()).max(12).default([]),
  serve: z.array(text(40).min(1)).max(20).default([]),
  testimonials: z.array(z.object({ quote: text(500).min(3), name: text(80).min(1), role: text(100).default("") }).strict()).max(12).default([]),
  clients: z.array(z.object({ name: text(80).min(1), logo: imageRef.default("") }).strict()).max(30).default([]),
  faq: z.array(z.object({ q: text(200).min(3), a: text(1000).min(1) }).strict()).max(30).default([]),
}).strict();

export const userInput = z.object({
  email: z.string().trim().toLowerCase().email().max(160), name: z.string().trim().min(2).max(80), role: z.enum(ROLE_NAMES).default("staff"),
  password: z.string(), phone: z.union([z.literal(""), text(20).regex(/^[0-9+()\s-]{7,20}$/)]).default(""), receivesLeads: z.boolean().default(false),
}).strict();
export const userPatch = z.object({
  active: z.boolean().optional(), role: z.enum(ROLE_NAMES).optional(), password: z.string().optional(), name: z.string().trim().min(2).max(80).optional(),
  phone: z.union([z.literal(""), text(20).regex(/^[0-9+()\s-]{7,20}$/)]).optional(), receivesLeads: z.boolean().optional(),
}).strict();

export const DEFAULT_HOME = {
  hero: { eyebrow: "Hospitality · Hygiene · Wellness Supplies", title: "Everything your property needs, under one roof.", lead: "Guest amenities, F&B disposables, housekeeping and hygiene products, hotel linen and healthcare supplies for hotels, resorts, spas and hospitals across India since 2002.", image: "/brand/hero-travel-kit.jpg", cta: "Browse the catalogue", cta2: "Request a quote" },
  banner: { active: false, text: "", link: "" },
  stats: [{ value: "Since 2002", label: "Trusted hospitality supplier" }, { value: "150+", label: "Products in the catalogue" }, { value: "8", label: "Product categories" }, { value: "Pan-India", label: "Supply and delivery" }],
  why: [
    { title: "20+ years of industry experience", text: "Supplying the hospitality & tourism industry since 2002." },
    { title: "One-stop procurement", text: "Amenities, disposables, housekeeping and linen from a single supplier." },
    { title: "Made to reflect your brand", text: "Tailor-made and branded solutions for your property." },
    { title: "Cost-effective import substitution", text: "Quality alternatives without import lead times." },
    { title: "Reliable supply, timely deliveries", text: "Consistent quality and dependable delivery schedules." },
    { title: "Trusted across institutions", text: "Hotels, resorts, spas, hospitals and corporate institutions." },
  ],
  serve: ["Hotels", "Resorts", "Spas", "Serviced apartments", "Hospitals", "Corporate institutions", "Large-scale events"],
  testimonials: [], clients: [],
  faq: [
    { q: "Do you supply outside Hyderabad?", a: "Yes. We supply hotels, resorts and hospitals across India." },
    { q: "Can amenities carry our hotel's logo?", a: "Yes. Most amenities, kits and linen can be customised with your branding. Ask us for minimum quantities." },
    { q: "How do I get prices?", a: "Add products to your quote list and send it, or message us on WhatsApp. We reply with a quotation including GST." },
  ],
};
