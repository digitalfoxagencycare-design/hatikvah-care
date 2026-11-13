import fs from 'node:fs';

const csv = fs.readFileSync('docs/SWIPE_VERIFIED_PRODUCT_CATALOG.csv', 'utf8');
const lines = csv.split('\n').filter(Boolean);

function parseCsvLine(l) {
  const res = [];
  let cur = '', inQ = false;
  for (let i = 0; i < l.length; i++) {
    const c = l[i];
    if (c === '"') inQ = !inQ;
    else if (c === ',' && !inQ) { res.push(cur.trim()); cur = ''; }
    else cur += c;
  }
  res.push(cur.trim());
  return res;
}

const swipeItems = lines.slice(1).map(l => {
  const cols = parseCsvLine(l);
  return {
    id: cols[0],
    partner_id: cols[1],
    name: cols[2],
    type: cols[3],
    category: cols[4],
    hsn: cols[5],
    gst_rate: cols[6],
    unit: cols[7],
    unit_price: cols[8],
    status: cols[9]
  };
}).filter(s => s.name && s.name.length > 0);

const catalog = JSON.parse(fs.readFileSync('data/catalog.json', 'utf8'));

function clean(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

const matches = [];
const noMatch = [];

for (const orig of catalog.products) {
  const cName = clean(orig.name);
  if (!cName) continue;
  const origWords = cName.split(' ').filter(w => w.length > 2 && !['and', 'with', 'the', 'for', 'hotel'].includes(w));
  
  // 1. Exact name match
  let matched = swipeItems.find(s => clean(s.name) === cName);
  let method = 'exact_name';

  // 2. Contains match
  if (!matched) {
    matched = swipeItems.find(s => {
      const sClean = clean(s.name);
      return sClean && ((sClean.length > 10 && cName.includes(sClean)) || (cName.length > 10 && sClean.includes(cName)));
    });
    if (matched) method = 'substring_containment';
  }

  // 3. Keyword score match
  if (!matched && origWords.length > 0) {
    let best = null;
    let maxScore = 0;
    for (const s of swipeItems) {
      const sWords = clean(s.name).split(' ');
      const matchedWords = origWords.filter(w => sWords.includes(w));
      const score = matchedWords.length / Math.max(origWords.length, sWords.length);
      if (score > maxScore && matchedWords.length >= 2) {
        maxScore = score;
        best = s;
      }
    }
    if (best && maxScore >= 0.4) {
      matched = best;
      method = `keyword_overlap_${Math.round(maxScore * 100)}%`;
    }
  }

  if (matched) {
    matches.push({
      sku: orig.sku,
      origName: orig.name,
      swipeName: matched.name,
      swipeId: matched.id,
      hsn: matched.hsn,
      gst_rate: matched.gst_rate,
      price: matched.unit_price,
      method
    });
  } else {
    noMatch.push({
      sku: orig.sku,
      origName: orig.name,
      category: orig.category
    });
  }
}

console.log('Total original products:', catalog.products.length);
console.log('Matches found in Swipe:', matches.length);
console.log('No match found in Swipe:', noMatch.length);
console.log('\n--- SAMPLE 15 MATCHES ---');
matches.slice(0, 15).forEach(m => {
  console.log(`[${m.sku}] "${m.origName}"\n    -> Swipe #${m.swipeId}: "${m.swipeName}" | HSN: ${m.hsn} | GST: ${m.gst_rate} | Price: ₹${m.price} (${m.method})\n`);
});
console.log('\n--- SAMPLE 5 NO MATCH ---');
noMatch.slice(0, 5).forEach(nm => {
  console.log(`[${nm.sku}] "${nm.origName}" (${nm.category})`);
});
