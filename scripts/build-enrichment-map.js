import fs from 'node:fs';
import path from 'node:path';

const catalog = JSON.parse(fs.readFileSync('data/catalog.json', 'utf8'));
const csv = fs.readFileSync('docs/SWIPE_VERIFIED_PRODUCT_CATALOG.csv', 'utf8');

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

const swipeItems = csv.split('\n').filter(Boolean).slice(1).map(l => {
  const cols = parseCsvLine(l);
  return {
    id: cols[0],
    name: cols[2],
    hsn: cols[5],
    gst: cols[6],
    unit: cols[7],
    price: cols[8]
  };
}).filter(s => s.name && s.name.length > 0);

function clean(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Master HSN classification rules for hospitality items
function getStandardHsnAndGst(p) {
  const name = p.name.toLowerCase();
  const cat = (p.category || '').toLowerCase();
  const col = (p.collection || '').toLowerCase();

  // 1. Dental Kits & Shaving Kits & Vanity / Sewing / Shoe Kits
  if (name.includes('dental kit') || name.includes('tooth kit')) {
    return { hsn: '96050000', gst: 18, desc: 'Hotel Dental Kit containing soft bristle toothbrush and dental paste in hygienic packaging for guest amenities.' };
  }
  if (name.includes('shaving kit') || name.includes('shave kit')) {
    return { hsn: '96050000', gst: 18, desc: 'Guest Shaving Kit featuring twin-blade razor and moisturizing shaving gel sachet.' };
  }
  if (name.includes('vanity kit')) {
    return { hsn: '96050000', gst: 18, desc: 'Compact personal care vanity kit with cotton pads, cotton buds, and emery board.' };
  }
  if (name.includes('sewing kit')) {
    return { hsn: '96050000', gst: 18, desc: 'Travel sewing kit complete with pre-threaded needles, assorted buttons, and safety pin.' };
  }
  if (name.includes('comb')) {
    return { hsn: '96151100', gst: name.includes('wood') ? 12 : 18, desc: 'High quality hygienic hair comb individually packed for hotel guest rooms.' };
  }
  if (name.includes('toothbrush')) {
    return { hsn: '96032100', gst: 18, desc: 'Hotel amenities toothbrush with ergonomic handle and soft bristles in sealed wrap.' };
  }
  if (name.includes('paste') || name.includes('meswak') || name.includes('anchor paste')) {
    return { hsn: '33061020', gst: 18, desc: 'Branded dental cream in travel sachet/tube for hotel room service.' };
  }
  if (name.includes('razor')) {
    return { hsn: '82121010', gst: 18, desc: 'Twin blade disposable safety razor for guest bathroom amenity.' };
  }
  if (name.includes('slipper')) {
    return { hsn: '64052000', gst: 5, desc: 'Comfortable disposable indoor guest slippers with non-slip sole.' };
  }
  if (name.includes('shower cap')) {
    return { hsn: '39232100', gst: 18, desc: 'Elastic band waterproof disposable shower cap in protective packaging.' };
  }
  if (name.includes('loofah')) {
    return { hsn: '39241090', gst: 18, desc: 'Exfoliating bath loofah mesh sponge for rejuvenating shower experience.' };
  }
  if (name.includes('shoe shiner') || name.includes('shoe sponge') || name.includes('shoe mitt')) {
    return { hsn: '34051000', gst: 18, desc: 'Instant shine sponge for leather shoes, packaged for hotel rooms.' };
  }
  if (name.includes('laundry bag')) {
    return { hsn: '63079090', gst: 18, desc: 'Heavy-duty guest laundry collection bag with drawstring closure.' };
  }
  if (name.includes('dnd') || name.includes('do not disturb') || name.includes('card')) {
    return { hsn: '48211020', gst: 18, desc: 'Door hanger sign card (Please Do Not Disturb / Please Clean My Room).' };
  }

  // 2. Soaps & Body Washes & Shampoos
  if (name.includes('soap')) {
    return { hsn: '34011190', gst: 18, desc: 'Gentle cleansing toilet soap bar formulated with natural moisturizers for guest bathrooms.' };
  }
  if (name.includes('shampoo')) {
    const isAyur = name.includes('bio') || name.includes('ayurveda') || name.includes('herbal');
    return { hsn: isAyur ? '30039011' : '33051090', gst: isAyur ? 5 : 18, desc: 'Nourishing hair cleanser shampoo with revitalizing natural extracts.' };
  }
  if (name.includes('conditioner')) {
    return { hsn: '33059011', gst: 18, desc: 'Hair conditioning formulation leaving hair smooth, silky and manageable.' };
  }
  if (name.includes('shower gel') || name.includes('body wash')) {
    return { hsn: '33073090', gst: 18, desc: 'Refreshing and invigorating shower gel and bath wash for hospitality suites.' };
  }
  if (name.includes('lotion') || name.includes('moisturizer') || name.includes('cream')) {
    return { hsn: '33049910', gst: 18, desc: 'Hydrating body lotion with essential moisturizers for skin protection.' };
  }
  if (name.includes('hand wash') || name.includes('sanitizer')) {
    return { hsn: '34029099', gst: 18, desc: 'Anti-bacterial liquid hand cleanser for commercial and guest washrooms.' };
  }

  // 3. Tray Amenities (Tea, Coffee, Sugar, Creamer)
  if (name.includes('tea bag') || name.includes('tea sachet') || name.includes('tetley') || name.includes('taj mahal')) {
    return { hsn: '09024010', gst: 5, desc: 'Individually envelope-wrapped premium tea bags for in-room beverage tray.' };
  }
  if (name.includes('coffee') || name.includes('nescafe') || name.includes('bru')) {
    return { hsn: '21011120', gst: 18, desc: 'Instant coffee sachet portion for hospitality welcome tray.' };
  }
  if (name.includes('sugar sachet') || name.includes('brown sugar') || name.includes('white sugar')) {
    return { hsn: '17019990', gst: 5, desc: 'Portion controlled hygienic sugar sachet for hot beverages.' };
  }
  if (name.includes('creamer') || name.includes('dairy whitener') || name.includes('milk powder')) {
    return { hsn: '04029990', gst: 18, desc: 'Dairy whitener milk creamer sachet for tea and coffee service.' };
  }
  if (name.includes('tray') || name.includes('kettle') || name.includes('coaster')) {
    return { hsn: '44219990', gst: 18, desc: 'Hotel room amenities tray service accessory.' };
  }

  // 4. Linen (Towels, Bedsheets, Covers)
  if (name.includes('towel') || name.includes('bath mat')) {
    return { hsn: '63026090', gst: 5, desc: '100% ringspun cotton terry hotel towel, ultra-absorbent and durable for institutional laundering.' };
  }
  if (name.includes('sheet') || name.includes('bedsheet') || name.includes('duvet') || name.includes('pillow cover') || name.includes('pillowcase')) {
    return { hsn: '63022190', gst: 5, desc: 'High thread count commercial grade cotton bed linen for luxury hotels and healthcare.' };
  }
  if (name.includes('gown') || name.includes('scrub') || name.includes('patient')) {
    return { hsn: '62114290', gst: 5, desc: 'Comfortable, breathable hospital patient apparel with secure ties.' };
  }

  // 5. Housekeeping chemicals & supplies
  if (name.includes('cleaner') || name.includes('taski') || name.includes('disinfectant')) {
    return { hsn: '34029099', gst: 18, desc: 'Commercial grade surface hygiene concentrate for hospitality housekeeping.' };
  }
  if (name.includes('garbage') || name.includes('dustbin') || name.includes('bin')) {
    return { hsn: '39232100', gst: 18, desc: 'Heavy duty waste disposal bag for room and bathroom dustbins.' };
  }

  // Fallback based on category
  if (cat.includes('amenities') || cat.includes('eco')) return { hsn: '96050000', gst: 18, desc: 'Hotel guest room amenity supply.' };
  if (cat.includes('bath') || cat.includes('body')) return { hsn: '34011190', gst: 18, desc: 'Personal care guest amenity.' };
  if (cat.includes('linen')) return { hsn: '63026090', gst: 5, desc: 'Institutional hospitality linen product.' };
  if (cat.includes('tray')) return { hsn: '21011120', gst: 18, desc: 'In-room beverage and tray consumable.' };

  return { hsn: '96050000', gst: 18, desc: 'Hotel and hospitality supply product.' };
}

const enriched = [];
for (const p of catalog.products) {
  const cName = clean(p.name);
  const origWords = cName.split(' ').filter(w => w.length > 2 && !['and', 'with', 'the', 'for', 'hotel'].includes(w));
  
  // Look for Swipe match first
  let matched = swipeItems.find(s => clean(s.name) === cName);
  let matchMethod = 'swipe_exact';

  if (!matched) {
    matched = swipeItems.find(s => {
      const sClean = clean(s.name);
      return sClean && ((sClean.length > 10 && cName.includes(sClean)) || (cName.length > 10 && sClean.includes(cName)));
    });
    if (matched) matchMethod = 'swipe_contains';
  }

  if (!matched && origWords.length > 0) {
    let best = null, maxScore = 0;
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
      matchMethod = `swipe_fuzzy_${Math.round(maxScore * 100)}%`;
    }
  }

  const standard = getStandardHsnAndGst(p);
  let finalHsn = standard.hsn;
  let finalGst = standard.gst;
  let finalPricePaise = p.price;
  let source = 'standard_gst_master';

  if (matched && matched.hsn && matched.hsn.trim().length >= 4) {
    finalHsn = matched.hsn.trim();
    if (matched.gst && matched.gst.includes('%')) {
      const g = parseInt(matched.gst.replace('%', ''), 10);
      if ([0, 5, 12, 18, 28].includes(g)) finalGst = g;
    }
    source = matchMethod;
  }

  const finalDesc = p.description && p.description.trim().length > 10 ? p.description.trim() : standard.desc;

  enriched.push({
    sku: p.sku,
    name: p.name,
    category: p.category,
    image: p.images?.[0] || '',
    hsn: finalHsn,
    gstRate: finalGst,
    description: finalDesc,
    source,
    matchedSwipeName: matched ? matched.name : ''
  });
}

console.log('Total products enriched:', enriched.length);
const hsnStats = {};
const gstStats = {};
enriched.forEach(e => {
  hsnStats[e.hsn] = (hsnStats[e.hsn] || 0) + 1;
  gstStats[e.gstRate] = (gstStats[e.gstRate] || 0) + 1;
});
console.log('GST Rate breakdown:', gstStats);
console.log('Unique HSNs assigned:', Object.keys(hsnStats).length);

// Generate CSV
const csvRows = ['sku,name,category,hsn,gst_rate_pct,description,image_preserved,enrichment_source,swipe_matched_item'];
for (const e of enriched) {
  csvRows.push([
    `"${e.sku}"`,
    `"${e.name.replace(/"/g, '""')}"`,
    `"${e.category}"`,
    `"${e.hsn}"`,
    `"${e.gstRate}%"`,
    `"${e.description.replace(/"/g, '""')}"`,
    `"${e.image}"`,
    `"${e.source}"`,
    `"${e.matchedSwipeName.replace(/"/g, '""')}"`
  ].join(','));
}

fs.writeFileSync('docs/ORIGINAL_PRODUCTS_ENRICHMENT_MAP.csv', csvRows.join('\n'));
console.log('Saved docs/ORIGINAL_PRODUCTS_ENRICHMENT_MAP.csv');

