import fs from "node:fs";

const rawCsv = fs.readFileSync("docs/SWIPE_VERIFIED_PRODUCT_CATALOG.csv", "utf8");
const lines = rawCsv.split("\n").filter((l) => l.trim().length > 0);

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

const swipeProducts = lines.slice(1).map((line) => {
  const cols = parseCsvLine(line);
  return {
    swipeId: cols[0],
    name: cols[2],
    itemType: cols[3],
    category: cols[4],
    hsn: cols[5],
    gstRate: parseFloat(cols[6]) || 0,
    unit: cols[7] || "NOS",
    price: parseFloat(cols[8]) || 0,
    active: cols[9] === "ACTIVE",
  };
}).filter(Boolean);

const catalog = JSON.parse(fs.readFileSync("data/catalog.json", "utf8"));
const webProducts = catalog.products;

console.log("Total Swipe Products from CSV:", swipeProducts.length);
console.log("Total Website Products from catalog.json:", webProducts.length);

function normalize(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
}

let directMatches = 0;
let fuzzyMatches = 0;
const matched = [];
const unmatchedWeb = [];

for (const wp of webProducts) {
  const normW = normalize(wp.name);
  const found = swipeProducts.find((sp) => normalize(sp.name) === normW);
  if (found) {
    directMatches++;
    matched.push({
      webId: wp.id,
      webName: wp.name,
      swipeId: found.swipeId,
      swipeName: found.name,
      hsn: found.hsn,
      gst: found.gstRate,
      price: found.price,
      image: wp.images?.[0] || "",
      type: "exact",
    });
  } else {
    // Check partial containment or metric match
    const partial = swipeProducts.find((sp) => {
      const normS = normalize(sp.name);
      return (normW.length > 5 && normS.includes(normW)) || (normS.length > 5 && normW.includes(normS));
    });
    if (partial) {
      fuzzyMatches++;
      matched.push({
        webId: wp.id,
        webName: wp.name,
        swipeId: partial.swipeId,
        swipeName: partial.name,
        hsn: partial.hsn,
        gst: partial.gstRate,
        price: partial.price,
        image: wp.images?.[0] || "",
        type: "fuzzy",
      });
    } else {
      unmatchedWeb.push(wp);
    }
  }
}

// Check which Swipe products are unmatched
const matchedSwipeIds = new Set(matched.map((m) => m.swipeId));
const unmatchedSwipe = swipeProducts.filter((sp) => !matchedSwipeIds.has(sp.swipeId));

console.log("\n--- MATCHING SUMMARY ---");
console.log("Exact Name Matches:", directMatches);
console.log("Fuzzy / Variant Matches:", fuzzyMatches);
console.log("Total Website Products Matched with Swipe:", matched.length, `out of ${webProducts.length} (${((matched.length/webProducts.length)*100).toFixed(1)}%)`);
console.log("Remaining Website Products (Local-only / Combos):", unmatchedWeb.length);
console.log("Remaining Swipe Items to be added as New Products:", unmatchedSwipe.length, `out of ${swipeProducts.length}`);

console.log("\n--- SAMPLE HIGH-CONFIDENCE MATCHES (Preserving Web Photos + Updating HSN & GST) ---");
matched.slice(0, 10).forEach((m, i) => {
  console.log(`${i + 1}. [${m.type.toUpperCase()}] "${m.webName}" <==> "${m.swipeName}"`);
  console.log(`   HSN: ${m.hsn || "N/A"} | GST: ${m.gst}% | Price: ₹${m.price} | Image: ${m.image}`);
});

console.log("\n--- SAMPLE NEW SWIPE PRODUCTS TO BE ADDED TO CATALOG ---");
unmatchedSwipe.slice(0, 8).forEach((sp, i) => {
  console.log(`${i + 1}. Swipe ID ${sp.swipeId}: "${sp.name}" | HSN: ${sp.hsn} | GST: ${sp.gstRate}% | Unit: ${sp.unit} | Price: ₹${sp.price}`);
});

