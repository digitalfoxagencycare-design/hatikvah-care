import fs from "node:fs";
import path from "node:path";
import { MongoClient } from "mongodb";

const MONGO_URI = process.env.MONGODB_URI || "mongodb+srv://novasaas_admin:km6nEqgcCiMFuj6S@cluster0.wlbsole.mongodb.net/?retryWrites=true&w=majority";
const DB_NAME = process.env.MONGODB_DB || "hatikvah_care";

const CSV_PATH = path.resolve("docs/SWIPE_VERIFIED_PRODUCT_CATALOG.csv");
const CATALOG_PATH = path.resolve("data/catalog.json");

function parseCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function normalize(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[\–\—\-\/]/g, " ")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanKeywords(s) {
  return normalize(s)
    .replace(/\b(hotel|packed|in|butter|paper|poly|pack|natural|body|travel|series|divine|white|ivory|premium|series|basic|dry|wet|amenities|for|hotels|disposable)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function wordsMatch(a, b) {
  const wa = cleanKeywords(a).split(" ").filter((w) => w.length > 2);
  const wb = cleanKeywords(b).split(" ").filter((w) => w.length > 2);
  if (wa.length === 0 || wb.length === 0) return false;
  // If all significant words of one are in the other
  const allAinB = wa.every((w) => wb.includes(w) || wb.some((x) => x.startsWith(w) || w.startsWith(x)));
  const allBinA = wb.every((w) => wa.includes(w) || wa.some((x) => x.startsWith(w) || w.startsWith(x)));
  return allAinB || allBinA;
}

function extractMetrics(s) {
  const m = (s || "").match(/(\d+(?:\.\d+)?)\s*(ml|gms|gm|g|kg|pcs|pc|nos|inch|mm|cm|ply)/gi);
  return m ? m.map((x) => x.toLowerCase().replace(/\s+/g, "")) : [];
}

function cleanHsn(raw) {
  if (!raw) return "";
  const cleaned = String(raw).replace(/\D/g, "");
  return cleaned.slice(0, 8);
}

function cleanGstRate(raw) {
  const num = parseFloat(String(raw).replace("%", "")) || 0;
  if ([0, 5, 12, 18, 28].includes(num)) return num;
  if (num > 0 && num <= 5) return 5;
  if (num > 5 && num <= 12) return 12;
  if (num > 12 && num <= 18) return 18;
  return 18;
}

function inferCategory(name) {
  const n = (name || "").toLowerCase();
  if (n.includes("bamboo") || n.includes("wheat") || n.includes("wooden") || n.includes("eco")) {
    return "eco-friendly";
  }
  if (n.includes("biotique") && (n.includes("kit") || n.includes("dry") || n.includes("slipper"))) {
    return "biotique-dry-amenities";
  }
  if (n.includes("shampoo") || n.includes("wash") || n.includes("lotion") || n.includes("soap") || n.includes("gel") || n.includes("dispenser") || n.includes("can") || n.includes("conditioner")) {
    return "bath-body";
  }
  if (n.includes("tea") || n.includes("coffee") || n.includes("sugar") || n.includes("creamer") || n.includes("sachet") || n.includes("honey") || n.includes("cup") || n.includes("stirr")) {
    return "tray-amenities";
  }
  if (n.includes("towel") || n.includes("sheet") || n.includes("pillow") || n.includes("duvet") || n.includes("linen") || n.includes("napkin") || n.includes("robe") || n.includes("mattress") || n.includes("curtain")) {
    return "hotel-linen";
  }
  if (n.includes("foil") || n.includes("cling") || n.includes("catcher") || n.includes("dustbin") || n.includes("bin") || n.includes("bag")) {
    return "housekeeping-others";
  }
  if (n.includes("hospital") || n.includes("medical")) {
    return "hospital-linen";
  }
  return "guest-amenities";
}

const CATEGORY_DEFAULT_IMAGE = {
  "guest-amenities": "/catalog/p05-1.jpg",
  "eco-friendly": "/catalog/p08-1.jpg",
  "biotique-dry-amenities": "/catalog/p09-1.jpg",
  "bath-body": "/catalog/p11-1.jpg",
  "tray-amenities": "/catalog/p27-1.jpg",
  "housekeeping-others": "/catalog/p31-1.jpg",
  "hotel-linen": "/catalog/p34-1.jpg",
  "hospital-linen": "/catalog/p42-1.jpg",
};

export async function runMerge({ apply = false } = {}) {
  console.log("================================================================================");
  console.log(`HaTikvah Care × Swipe: Catalog Mapping & Merge Engine (${apply ? "APPLY MODE" : "DRY-RUN MODE"})`);
  console.log("================================================================================\n");

  // 1. Read Swipe CSV
  const csvRaw = fs.readFileSync(CSV_PATH, "utf8");
  const csvLines = csvRaw.split("\n").filter((l) => l.trim().length > 0);
  const swipeItems = csvLines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    const priceRupees = parseFloat(cols[8]) || 0;
    return {
      swipeId: cols[0],
      name: cols[2],
      itemType: cols[3] || "Product",
      category: cols[4] || "",
      hsn: cleanHsn(cols[5]),
      gstRate: cleanGstRate(cols[6]),
      unit: (cols[7] || "NOS").toUpperCase(),
      pricePaise: priceRupees > 0 ? Math.round(priceRupees * 100) : null,
      priceRupees,
      active: cols[9] === "ACTIVE",
    };
  }).filter((x) => x && x.name);

  console.log(`[1] Loaded ${swipeItems.length} verified products from Swipe CSV.`);

  // 2. Read Website Catalog
  const catalogRaw = fs.readFileSync(CATALOG_PATH, "utf8");
  const catalog = JSON.parse(catalogRaw);
  const webProducts = catalog.products || [];
  console.log(`[2] Loaded ${webProducts.length} website products from catalog.json.`);

  // 3. Matching
  const matchedWeb = [];
  const matchedSwipeIds = new Set();
  const unmatchedWeb = [];

  for (const wp of webProducts) {
    const normW = normalize(wp.name);
    const metricsW = extractMetrics(wp.name);

    // Tier 1: Exact Name Match
    let match = swipeItems.find((sp) => normalize(sp.name) === normW && !matchedSwipeIds.has(sp.swipeId));

    // Tier 2: Metric + Brand / Significant Keyword Match
    if (!match && metricsW.length > 0) {
      match = swipeItems.find((sp) => {
        if (matchedSwipeIds.has(sp.swipeId)) return false;
        const normS = normalize(sp.name);
        const metricsS = extractMetrics(sp.name);
        const sharesMetric = metricsW.some((m) => metricsS.includes(m));
        if (!sharesMetric) return false;

        const brands = ["bio", "biotique", "anchor", "dorco", "meswak", "mesvak", "virgo", "tetra", "lipton", "taj"];
        const sharedBrand = brands.some((b) => normW.includes(b) && normS.includes(b));
        return sharedBrand || wordsMatch(wp.name, sp.name);
      });
    }

    // Tier 3: Semantic Keyword Match
    if (!match) {
      match = swipeItems.find((sp) => {
        if (matchedSwipeIds.has(sp.swipeId)) return false;
        const normS = normalize(sp.name);
        if (normS.length < 4 || normS.includes("bracket")) return false;
        return wordsMatch(wp.name, sp.name);
      });
    }

    if (match) {
      matchedSwipeIds.add(match.swipeId);
      matchedWeb.push({
        webProduct: wp,
        swipeItem: match,
      });
    } else {
      unmatchedWeb.push(wp);
    }
  }

  // Swipe items not matched with existing web products
  const newSwipeItems = swipeItems.filter((sp) => !matchedSwipeIds.has(sp.swipeId));

  console.log(`\n--- MATCHING RESULTS ---`);
  console.log(`  ✓ Matched Web Products (Updated with Swipe HSN/GST/Price + Keeping Photos): ${matchedWeb.length}`);
  console.log(`  ✓ Preserved Unmatched Web Products (Local-only combos): ${unmatchedWeb.length}`);
  console.log(`  ✓ New Products to Add from Swipe (Expanding Catalog): ${newSwipeItems.length}`);
  console.log(`  =======================================================`);
  console.log(`  TOTAL CONSOLIDATED PRODUCTS: ${webProducts.length + newSwipeItems.length}\n`);

  // Show detailed sample updates
  console.log(`--- SAMPLE MATCHED PRODUCTS (Before vs After HSN/GST): ---`);
  matchedWeb.slice(0, 8).forEach(({ webProduct, swipeItem }, i) => {
    console.log(`${i + 1}. "${webProduct.name}" (SKU: ${webProduct.sku})`);
    console.log(`   Photo Preserved: ${webProduct.images?.[0] || "None"}`);
    console.log(`   HSN: "${webProduct.hsn || ""}" ➔ "${swipeItem.hsn}" (Swipe ID: ${swipeItem.swipeId})`);
    console.log(`   GST: ${webProduct.gstRate ?? 18}% ➔ ${swipeItem.gstRate}% | Unit: ${swipeItem.unit}`);
    console.log(`   Price: ${webProduct.price ? "₹" + webProduct.price / 100 : "null"} ➔ ${swipeItem.pricePaise ? "₹" + swipeItem.pricePaise / 100 : "null"}\n`);
  });

  console.log(`--- SAMPLE NEW SWIPE PRODUCTS TO BE CREATED: ---`);
  newSwipeItems.slice(0, 8).forEach((sp, i) => {
    const cat = inferCategory(sp.name);
    console.log(`${i + 1}. Swipe ID ${sp.swipeId}: "${sp.name}"`);
    console.log(`   Category: ${cat} | HSN: ${sp.hsn} | GST: ${sp.gstRate}% | Price: ${sp.priceRupees > 0 ? "₹" + sp.priceRupees : "Price on Request"}`);
    console.log(`   Assigned Photo: ${CATEGORY_DEFAULT_IMAGE[cat]}\n`);
  });

  if (!apply) {
    console.log("--------------------------------------------------------------------------------");
    console.log("DRY-RUN COMPLETE: No changes were made to MongoDB Atlas or data/catalog.json.");
    console.log("Run with apply: true to write changes and merge catalogues.");
    console.log("--------------------------------------------------------------------------------\n");
    return {
      matchedCount: matchedWeb.length,
      unmatchedWebCount: unmatchedWeb.length,
      newSwipeCount: newSwipeItems.length,
      totalCount: webProducts.length + newSwipeItems.length,
    };
  }

  // --- APPLY MODE: Perform the Merge ---
  console.log(">>> APPLY MODE ENGAGED: Updating MongoDB Atlas...");

  // Build merged products list
  const mergedProducts = [];
  const matchedMap = new Map(matchedWeb.map(({ webProduct, swipeItem }) => [webProduct.sku, swipeItem]));

  // 1. Keep all website products in their exact original order (HC-001 to HC-149)
  for (const wp of webProducts) {
    const swipeItem = matchedMap.get(wp.sku);
    if (swipeItem) {
      mergedProducts.push({
        ...wp,
        hsn: swipeItem.hsn || wp.hsn || "",
        gstRate: swipeItem.gstRate ?? wp.gstRate ?? 18,
        unit: swipeItem.unit || wp.unit || "pcs",
        price: swipeItem.pricePaise ?? wp.price,
        swipeId: swipeItem.swipeId,
        active: true,
      });
    } else {
      mergedProducts.push({
        ...wp,
        active: true,
      });
    }
  }

  let nextOrder = webProducts.length + 1;
  const usedSlugs = new Set(mergedProducts.map((p) => p.slug));
  const usedSkus = new Set(mergedProducts.map((p) => p.sku));
  let skuCounter = 500;

  for (const sp of newSwipeItems) {
    let baseSlug = sp.name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "item";
    let slug = baseSlug;
    let n = 2;
    while (usedSlugs.has(slug)) {
      slug = `${baseSlug}-${n++}`;
    }
    usedSlugs.add(slug);

    let sku = `SW-${String(sp.swipeId).padStart(4, "0")}`;
    if (usedSkus.has(sku)) {
      sku = `HC-${skuCounter++}`;
    }
    usedSkus.add(sku);

    const cat = inferCategory(sp.name);

    mergedProducts.push({
      slug,
      sku,
      name: sp.name,
      category: cat,
      collection: "Swipe Master Catalog",
      pack: sp.unit || "NOS",
      variants: [],
      description: `B2B Supply: ${sp.name}. HSN: ${sp.hsn}, Tax: ${sp.gstRate}%.`,
      images: [CATEGORY_DEFAULT_IMAGE[cat]],
      price: sp.pricePaise,
      priceUnit: sp.unit || "NOS",
      minOrder: "",
      active: true,
      featured: false,
      order: nextOrder++,
      hsn: sp.hsn,
      gstRate: sp.gstRate,
      unit: sp.unit || "pcs",
      swipeId: sp.swipeId,
    });
  }

  // Update MongoDB Atlas
  console.log(`[Apply] Connecting to MongoDB Atlas: ${DB_NAME}...`);
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(DB_NAME);

  // Clear existing products and re-seed with full merged catalog
  await db.collection("products").deleteMany({});
  const docsToInsert = mergedProducts.map((p, idx) => ({
    ...p,
    id: `prod_${String(idx + 1).padStart(4, "0")}_${p.sku.toLowerCase()}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));

  const insertRes = await db.collection("products").insertMany(docsToInsert);
  console.log(`[Apply] Successfully inserted ${insertRes.insertedCount} products into MongoDB Atlas 'products' collection!`);

  await client.close();
  console.log("[Apply] MongoDB Atlas migration complete ✓");

  return {
    matchedCount: matchedWeb.length,
    unmatchedWebCount: unmatchedWeb.length,
    newSwipeCount: newSwipeItems.length,
    totalCount: mergedProducts.length,
  };
}

// Direct execution
if (process.argv[1] && process.argv[1].endsWith("merge-swipe-catalog.js")) {
  const isApply = process.argv.includes("--apply");
  runMerge({ apply: isApply })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("FATAL:", err);
      process.exit(1);
    });
}
