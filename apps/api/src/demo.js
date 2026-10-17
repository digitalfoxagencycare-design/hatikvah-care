import crypto from "node:crypto";
import { createApp } from "./app.js";
import { hashPassword } from "./auth.js";
import { loadConfig } from "./config.js";
import { seedIfEmpty } from "./seed.js";
import { createStore } from "./store/index.js";

/**
 * Fills a DEVELOPMENT database with realistic sample data (customers, enquiries, quotes, orders, invoices, stock) so every
 * admin screen can be seen working. Refuses to run in production or on a database that already has customers.
 *   npm run seed-demo
 */
const cfg = loadConfig();
if (cfg.prod) { console.error("seed-demo is for development previews only."); process.exit(1); }
const store = await createStore(cfg);
await seedIfEmpty(store, cfg.seedFile, { info() {}, warn() {} });
if ((await store.customers.count()) > 0) { console.error("This database already has customers; demo data not added. Delete the .data folder to start fresh."); await store.close(); process.exit(1); }

const email = (process.env.DEMO_EMAIL || "owner@demo.local").toLowerCase();
const password = process.env.DEMO_PASSWORD || "Demo-" + crypto.randomBytes(6).toString("base64url") + "7";
if (!(await store.admins.findBy("email", email))) await store.admins.insert({ email, name: "Demo Owner", role: "owner", passwordHash: await hashPassword(password), active: true, tokenVersion: 0, createdAt: new Date().toISOString() });

const app = createApp({ cfg: { ...cfg, automationEveryMin: 0 }, store, log: { error: console.error, warn() {} } });
const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}`;
let cookie = "";
async function call(method, url, body) {
  const h = { "x-requested-with": "hc-admin" }; if (cookie) h.cookie = cookie; if (body !== undefined) h["content-type"] = "application/json";
  const res = await fetch(base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const sc = res.headers.getSetCookie?.()[0]; if (sc) cookie = sc.split(";")[0];
  const data = (res.headers.get("content-type") || "").includes("json") ? await res.json() : await res.text();
  if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${JSON.stringify(data)}`);
  return data;
}
const post = (u, b) => call("POST", u, b), patch = (u, b) => call("PATCH", u, b), put = (u, b) => call("PUT", u, b), get = (u) => call("GET", u);
const day = (n) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);
const ago = (n) => new Date(Date.now() - n * 86400_000).toISOString();

await post("/api/admin/login", { email, password });
const s = await get("/api/admin/settings");
await put("/api/admin/settings", { ...s, gstin: "36AAFFE1234K1Z9", stateCode: "36", upiId: "exlmarketing@icici", bankDetails: "Bank: ICICI Bank, Gachibowli\nA/c name: EXL Marketing\nA/c no: 000000000000 (sample)\nIFSC: ICIC0000000" });

// prices, HSN codes and GST rates on the first 40 products
const products = await get("/api/admin/products");
const HSN = { "guest-amenities": ["3305", 18], "eco-friendly-range": ["3401", 18], "biotique-dry-amenities": ["3306", 18], "bath-and-body": ["3304", 18], "tray-amenities": ["4818", 12], "housekeeping-and-others": ["3402", 18], "hotel-linen-and-terry": ["6302", 5], "hospital-linen": ["6302", 5] };
for (const [i, p] of products.slice(0, 40).entries()) {
  const [hsn, gstRate] = HSN[p.category] || ["", 18];
  await patch(`/api/admin/products/${p.id}`, { price: 500 + ((i * 737) % 9000), priceUnit: "per piece", hsn, gstRate, unit: "pcs" });
}

const team = {};
for (const [k, u] of Object.entries({ sales: { email: "ravi@demo.local", name: "Ravi (Sales)", role: "sales", phone: "9000000011", receivesLeads: true }, sales2: { email: "priya@demo.local", name: "Priya (Sales)", role: "sales", phone: "9000000012", receivesLeads: true }, wh: { email: "store@demo.local", name: "Imran (Warehouse)", role: "warehouse", phone: "9000000013" }, acc: { email: "accounts@demo.local", name: "Lakshmi (Accounts)", role: "accounts" } }))
  team[k] = await post("/api/admin/users", { ...u, password: "Team-" + crypto.randomBytes(6).toString("hex") + "1" });

const supplier = await post("/api/admin/suppliers", { name: "Deccan Amenities Pvt Ltd", contactName: "Suresh", phone: "9848000001", email: "orders@deccan.example", gstin: "36AABCD1234E1Z5", stateCode: "36", address: "IDA Jeedimetla, Hyderabad" });
await post("/api/admin/suppliers", { name: "Coimbatore Terry Mills", contactName: "Kannan", phone: "9443000002", stateCode: "33", address: "Coimbatore, Tamil Nadu" });
const pl = await post("/api/admin/price-lists", { name: "Hotel chains (8% off)", discountPct: 8 });

const C = [
  { name: "The Lakeview Resort", contactName: "Anita Rao", phone: "9848012345", email: "purchase@lakeview.example", gstin: "36AACCL1234B1Z2", city: "Hyderabad", billingAddress: "Gandipet Road, Hyderabad 500075", paymentTermsDays: 30, reorderDays: 30, tags: ["resort"], priceListId: pl.id },
  { name: "Grand Deccan Hotels", contactName: "Mahesh Kumar", phone: "9849022222", email: "stores@granddeccan.example", gstin: "36AAGCG5678C1Z1", city: "Hyderabad", billingAddress: "Banjara Hills Road No. 1, Hyderabad 500034", paymentTermsDays: 15, tags: ["5-star", "chain"], priceListId: pl.id },
  { name: "Sunrise Multispeciality Hospital", contactName: "Dr. Kavitha", phone: "9866033333", email: "admin@sunrise.example", gstin: "37AAJCS9012D1Z7", city: "Vijayawada", billingAddress: "MG Road, Vijayawada 520010", paymentTermsDays: 45, tags: ["hospital"] },
  { name: "Coorg Spa Retreat", contactName: "Neha Poonacha", phone: "9845044444", email: "gm@coorgspa.example", gstin: "29AAKCC3456E1Z3", city: "Madikeri", billingAddress: "Madikeri, Karnataka 571201", paymentTermsDays: 30, tags: ["spa"] },
  { name: "Hotel Sai Residency", contactName: "Venkat", phone: "9440055555", city: "Warangal", billingAddress: "Hanamkonda, Warangal", paymentTermsDays: 7, reorderDays: 21 },
];
const cust = [];
for (const [i, c] of C.entries()) cust.push(await post("/api/admin/customers", { ...c, assignedTo: i % 2 ? team.sales2.id : team.sales.id, source: ["website", "referral", "exhibition", "website", "google"][i] }));
const line = (p, qty, extra = {}) => ({ productId: p.id, sku: p.sku, name: p.name, hsn: HSN[p.category]?.[0] || "", unit: "pcs", qty, rate: 500 + ((products.indexOf(p) * 737) % 9000), discountPct: 0, gstRate: HSN[p.category]?.[1] ?? 18, ...extra });

// website enquiries (go through the public form, so assignment, alerts and auto-replies run)
const pub = async (body) => { const r = await fetch(base + "/api/public/enquiries", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return r.json(); };
const E = [
  { name: "Arjun Mehta", company: "Hotel Blue Lotus", phone: "9811100001", email: "arjun@bluelotus.example", message: "Need 2000 dental kits with our logo", items: [{ productId: products[0].id, qty: 2000 }, { productId: products[1].id, qty: 2000 }], source: { utm_source: "google", utm_medium: "cpc", utm_campaign: "amenities-hyd" } },
  { name: "Fatima Shaikh", company: "Zara Serviced Apartments", phone: "9811100002", message: "Monthly supply of slippers and shower caps, 40 rooms", items: [{ productId: products[5].id, qty: 1200 }], source: { utm_source: "instagram", utm_medium: "social" } },
  { name: "Rohit Varma", company: "Green Valley Resort", phone: "9811100003", email: "rohit@greenvalley.example", message: "Eco-friendly amenities for 120 rooms", items: [{ productId: products[12].id, qty: 5000 }], source: { referrer: "https://www.justdial.com/" } },
  { name: "Sister Mary", company: "St. Ann's Hospital", phone: "9811100004", message: "Hospital linen: bed sheets and patient gowns", items: [] , source: {} },
];
const enqRefs = [];
for (const e of E) enqRefs.push((await pub(e)).ref);
await new Promise((r) => setTimeout(r, 400));
const enqs = await get("/api/admin/enquiries");
const byRef = (ref) => enqs.find((e) => e.ref === ref);
await patch(`/api/admin/enquiries/${byRef(enqRefs[1]).id}`, { status: "contacted", followUpAt: day(0) });
await post("/api/admin/activities", { entity: "enquiry", entityId: byRef(enqRefs[1]).id, kind: "call", text: "Spoke to Fatima, wants samples before ordering", followUpAt: day(0) });
// enquiry → customer → quote (sent, waiting)
const conv = await post(`/api/admin/enquiries/${byRef(enqRefs[0]).id}/convert`);
await patch(`/api/admin/customers/${conv.customer.id}`, { gstin: "36AAHCB7890F1Z4", billingAddress: "Kukatpally, Hyderabad 500072", city: "Hyderabad" });
const q1 = await post(`/api/admin/quotes/from-enquiry/${byRef(enqRefs[0]).id}`);
await post(`/api/admin/quotes/${q1.id}/send`);

// quote accepted online by the customer → sales order created automatically
const q2 = await post("/api/admin/quotes", { customerId: cust[0].id, items: [line(products[2], 1500), line(products[3], 1500), line(products[20], 300)], notes: "Branding with Lakeview logo included." });
await post(`/api/admin/quotes/${q2.id}/send`);
await fetch(`${base}/api/public/doc/quote/${q2.token}/accept`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Anita Rao", note: "Please deliver before the 25th" }) });
// interstate quote (Karnataka → IGST), sent 4 days ago, so a reminder is due
const q3 = await post("/api/admin/quotes", { customerId: cust[3].id, items: [line(products[8], 800), line(products[9], 800, { discountPct: 5 })] });
await post(`/api/admin/quotes/${q3.id}/send`);
await store.quotes.update(q3.id, { sentAt: ago(4) });
await post("/api/admin/quotes", { customerId: cust[2].id, items: [line(products[35], 400), line(products[36], 200)], notes: "Draft: waiting for bed count" });

// stock: opening stock for 10 products, two of them low
for (const [i, p] of products.slice(0, 10).entries()) {
  await patch(`/api/admin/stock/${p.id}`, { stockTracked: true, reorderLevel: 500, reorderQty: 3000, supplierId: supplier.id, costPrice: 300 + i * 40 });
  await post("/api/admin/stock/adjust", { productId: p.id, kind: "in", qty: i < 2 ? 200 : 6000, note: "Opening stock" });
}

// orders in different states, invoices, payments
const orders = await get("/api/admin/orders");
const auto = orders[0];
await post(`/api/admin/orders/${auto.id}/status`, { status: "packed" });
const o2 = await post("/api/admin/orders", { customerId: cust[1].id, items: [line(products[4], 2000), line(products[6], 1000)], poNumber: "GDH/PO/7781", expectedDate: day(3) });
await post(`/api/admin/orders/${o2.id}/dispatch`, { transporter: "VRL Logistics", trackingNo: "VRL98234", vehicleNo: "TS09 UB 1234" });
const inv2 = await post(`/api/admin/orders/${o2.id}/invoice`);
await post(`/api/admin/invoices/${inv2.id}/payments`, { amount: Math.round(inv2.totals.total / 2), mode: "bank", reference: "NEFT UTR 4471", date: day(0) });
const o3 = await post("/api/admin/orders", { customerId: cust[4].id, items: [line(products[7], 500), line(products[3], 500)] });
await post(`/api/admin/orders/${o3.id}/dispatch`, { transporter: "Own vehicle" });
await post(`/api/admin/orders/${o3.id}/status`, { status: "delivered" });
const inv3 = await post(`/api/admin/orders/${o3.id}/invoice`);
await post(`/api/admin/invoices/${inv3.id}/payments`, { amount: inv3.totals.total, mode: "upi", reference: "UPI 2231" });
// an overdue invoice from last month (interstate customer)
const old = await post("/api/admin/invoices", { customerId: cust[2].id, items: [line(products[38], 300), line(products[39], 300)], date: day(-40), dueDate: day(-10) });
await store.invoices.update(old.id, { createdAt: ago(40) });

const po = await post("/api/admin/purchases/from-low-stock");
if (po.created[0]) await post(`/api/admin/purchases/${po.created[0].id}/status`, { status: "sent" });

const home = await get("/api/admin/content/home");
await put("/api/admin/content/home", { ...home, banner: { active: true, text: "Custom-branded amenity kits for the festive season. Ask for a quote", link: "/quote" },
  testimonials: [{ quote: "Consistent quality and they never miss a delivery date. Our go-to supplier for amenities.", name: "Anita Rao", role: "Purchase Manager, The Lakeview Resort" }, { quote: "Hospital linen of excellent quality at the right price.", name: "Dr. Kavitha", role: "Sunrise Multispeciality Hospital" }],
  clients: C.slice(0, 4).map((c) => ({ name: c.name, logo: "" })) });
await post("/api/admin/automation/run");

server.close(); await store.close();
console.log(`\nDemo data added.\n  Admin:    http://localhost:${cfg.port}/admin\n  Email:    ${email}\n  Password: ${password}\n(Other demo team members have random passwords; reset them in Team if you want to sign in as them.)`);
