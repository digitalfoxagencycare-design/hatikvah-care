/**
 * HaTikvah Care × Swipe: Product Matching & Image Mapping Engine
 * Strictly read-only audit tool for matching Swipe original items with Hatikvah products.
 *
 * Usage:
 *   node --env-file=.env scripts/swipe-product-matching.js
 */

import fs from 'node:fs';
import path from 'node:path';

export const BASE_URL = process.env.SWIPE_API_BASE_URL || 'https://app.getswipe.in/api/partner';
export const TOKEN = process.env.SWIPE_API_TOKEN;

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Normalise strings for comparison: lowercase, remove special characters, trim whitespace.
 */
export function normalizeName(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/[\–\—\-\/]/g, ' ')
    .replace(/[^a-z0-9\s.]/g, '')
    .replace(/(?<!\d)\.|\.(?!\d)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract tokens representing quantities, volumes, weights, and sizes (e.g., 25ml, 8gms, 7inch).
 */
export function extractMetrics(str) {
  if (!str) return [];
  const metrics = [];
  const regex = /(\d+(?:\.\d+)?)\s*(ml|gms|gm|g|kg|pcs|pc|nos|inch|mm|cm|sachet|ply)/gi;
  let match;
  while ((match = regex.exec(str)) !== null) {
    let unit = match[2].toLowerCase();
    if (unit === 'gm' || unit === 'g') unit = 'gms';
    if (unit === 'pc') unit = 'pcs';
    metrics.push(`${match[1]}${unit}`);
  }
  return metrics;
}

/**
 * Fetch all products from Swipe API with pagination, retry, and rate pacing.
 */
export async function fetchAllSwipeProducts(fetchFn = fetch, token = TOKEN, baseUrl = BASE_URL, numRecords = 100) {
  if (!token) {
    throw new Error('SWIPE_API_TOKEN is missing in environment.');
  }

  const allItems = [];
  let page = 1;
  let reportedTotal = 0;

  while (true) {
    const url = `${baseUrl}/v2/product/list?page=${page}&num_records=${numRecords}`;
    let res;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        res = await fetchFn(url, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });
        if (res.status === 429) {
          const waitMs = Math.pow(2, attempt) * 1000;
          await sleep(waitMs);
          continue;
        }
        break;
      } catch (err) {
        if (attempt === 2) throw err;
        await sleep(1000);
      }
    }

    if (!res || !res.ok) {
      throw new Error(`Failed to fetch Swipe products on page ${page}: HTTP ${res ? res.status : 0}`);
    }

    const data = await res.json();
    if (!data.success && data.success !== undefined) {
      throw new Error(`Swipe API returned success: false on page ${page}: ${data.message || ''}`);
    }

    reportedTotal = data.data?.total_records ?? reportedTotal;
    const items = data.data?.items || [];
    if (items.length === 0) break;

    allItems.push(...items);
    if (items.length < numRecords) break;
    page++;
    await sleep(100); // Polite rate pacing
  }

  // Deduplicate by swipe_id (or fallback id/name)
  const uniqueItems = [];
  const seenIds = new Set();
  for (const item of allItems) {
    const key = item.swipe_id || item.id || item.name;
    if (!seenIds.has(key)) {
      seenIds.add(key);
      uniqueItems.push(item);
    }
  }

  return {
    reportedTotal,
    retrievedCount: allItems.length,
    uniqueCount: uniqueItems.length,
    items: uniqueItems
  };
}

/**
 * Read Hatikvah local products and check image references on disk.
 */
export function loadHatikvahProducts(filePath = '.data/products.json', publicDir = 'apps/web/public') {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Hatikvah data file not found: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const products = JSON.parse(raw);

  const enriched = products.map((p) => {
    const images = p.images || [];
    const imageStatuses = images.map((img) => {
      const diskPath = path.join(publicDir, img.replace(/^\//, ''));
      return {
        path: img,
        existsOnDisk: fs.existsSync(diskPath),
        diskPath
      };
    });

    return {
      ...p,
      imagesDetail: imageStatuses,
      hasValidImage: imageStatuses.some((i) => i.existsOnDisk),
      allImagesExist: imageStatuses.length > 0 && imageStatuses.every((i) => i.existsOnDisk)
    };
  });

  return enriched;
}

/**
 * Core matching logic between Swipe products and Hatikvah products.
 */
export function matchProductCatalog(swipeItems, hatikvahProducts) {
  const matches = []; // Detailed paired records
  const matchedSwipeIds = new Set();
  const matchedHatikvahIds = new Set();

  const synonyms = [
    [/tooth\s*brush/gi, 'toothbrush'],
    [/tooth\s*paste/gi, 'paste'],
    [/toothpaste/gi, 'paste'],
    [/shower\s*gel/gi, 'showergel'],
    [/body\s*wash/gi, 'bodywash'],
    [/hair\s*shampoo/gi, 'shampoo'],
    [/shave\s*gel/gi, 'shaving gel'],
    [/napkins?/gi, 'napkin'],
    [/slippers?/gi, 'slipper'],
    [/mesvak/gi, 'meswak'],
    [/biotique/gi, 'bio'],
    [/boutique/gi, 'bio']
  ];

  function cleanAliases(str) {
    let s = normalizeName(str);
    for (const [re, rep] of synonyms) {
      s = s.replace(re, rep);
    }
    return s.replace(/\s+/g, ' ').trim();
  }

  // 1. Phase 1: Exact matches and verified SKU matches
  for (const s of swipeItems) {
    const sClean = cleanAliases(s.name);

    for (const h of hatikvahProducts) {
      const hClean = cleanAliases(h.name);

      // Category A: Confirmed Match (Existing verified mapping or exact SKU match with compatible name)
      if (h.sku && s.sku && h.sku.toLowerCase() === s.sku.toLowerCase() && sClean === hClean) {
        matches.push({
          status: 'CONFIRMED_MATCH',
          reason: 'Exact SKU and identical product name match',
          swipe: s,
          hatikvah: h,
          hasConflict: s.hsn_code !== h.hsn || s.tax_rate !== h.gstRate,
          conflictDetails: getConflictDetails(s, h)
        });
        matchedSwipeIds.add(s.swipe_id);
        matchedHatikvahIds.add(h.id);
        continue;
      }

      // Exact Clean Name Match
      if (sClean === hClean) {
        matches.push({
          status: 'HIGH_CONFIDENCE',
          reason: 'Exact normalized name match',
          swipe: s,
          hatikvah: h,
          hasConflict: (s.hsn_code && h.hsn && s.hsn_code !== h.hsn) || (s.tax_rate != null && h.gstRate != null && s.tax_rate !== h.gstRate),
          conflictDetails: getConflictDetails(s, h)
        });
        matchedSwipeIds.add(s.swipe_id);
        matchedHatikvahIds.add(h.id);
      }
    }
  }

  // 2. Phase 2: High-Confidence Suggested Matches (token overlap + matching metrics)
  for (const s of swipeItems) {
    if (matchedSwipeIds.has(s.swipe_id)) continue;

    const sClean = cleanAliases(s.name);
    const sTokens = new Set(sClean.split(' ').filter((t) => t.length > 2));
    const sMetrics = extractMetrics(s.name);

    const candidates = [];

    for (const h of hatikvahProducts) {
      const hClean = cleanAliases(h.name);
      const hTokens = new Set(hClean.split(' ').filter((t) => t.length > 2));
      const hMetrics = extractMetrics(h.name);

      let common = 0;
      for (const t of sTokens) {
        if (hTokens.has(t)) common++;
      }

      const minTokens = Math.min(sTokens.size, hTokens.size);
      const similarity = minTokens > 0 ? common / minTokens : 0;

      let metricMatch = true;
      if (sMetrics.length > 0 && hMetrics.length > 0) {
        metricMatch = sMetrics.some((m) => hMetrics.includes(m));
      }

      if (similarity >= 0.6 && metricMatch && common >= 2) {
        candidates.push({ h, similarity, common, metricMatch });
      } else if (sClean.includes(hClean) || hClean.includes(sClean)) {
        if (metricMatch && common >= 2) {
          candidates.push({ h, similarity: 0.85, common, metricMatch });
        }
      }
    }

    if (candidates.length === 1) {
      const best = candidates[0].h;
      matches.push({
        status: 'HIGH_CONFIDENCE',
        reason: `High semantic similarity (${Math.round(candidates[0].similarity * 100)}%) with compatible variant/size`,
        swipe: s,
        hatikvah: best,
        hasConflict: (s.hsn_code && best.hsn && s.hsn_code !== best.hsn) || (s.tax_rate != null && best.gstRate != null && s.tax_rate !== best.gstRate),
        conflictDetails: getConflictDetails(s, best)
      });
      matchedSwipeIds.add(s.swipe_id);
      matchedHatikvahIds.add(best.id);
    } else if (candidates.length > 1) {
      for (const cand of candidates) {
        matches.push({
          status: 'MANUAL_REVIEW',
          reason: `Ambiguous match: Swipe item has ${candidates.length} possible Hatikvah candidates`,
          swipe: s,
          hatikvah: cand.h,
          hasConflict: true,
          conflictDetails: getConflictDetails(s, cand.h)
        });
        matchedHatikvahIds.add(cand.h.id);
      }
      matchedSwipeIds.add(s.swipe_id);
    }
  }

  // 3. Phase 3: Partial keyword matches -> Manual Review
  for (const s of swipeItems) {
    if (matchedSwipeIds.has(s.swipe_id)) continue;

    const sClean = cleanAliases(s.name);
    const sTokens = new Set(sClean.split(' ').filter((t) => t.length > 2));

    for (const h of hatikvahProducts) {
      const hClean = cleanAliases(h.name);
      const hTokens = new Set(hClean.split(' ').filter((t) => t.length > 2));

      let common = 0;
      for (const t of sTokens) {
        if (hTokens.has(t)) common++;
      }

      if (common >= 2 && (sTokens.size <= 3 || hTokens.size <= 3)) {
        matches.push({
          status: 'MANUAL_REVIEW',
          reason: `Partial keyword overlap (${common} tokens), requires human verification of size/packaging`,
          swipe: s,
          hatikvah: h,
          hasConflict: true,
          conflictDetails: getConflictDetails(s, h)
        });
        matchedSwipeIds.add(s.swipe_id);
        matchedHatikvahIds.add(h.id);
        break;
      }
    }
  }

  // 4. Unmatched Swipe Items
  const unmatchedSwipe = swipeItems.filter((s) => !matchedSwipeIds.has(s.swipe_id));

  // 5. Unmatched Hatikvah Products
  const unmatchedHatikvah = hatikvahProducts.filter((h) => !matchedHatikvahIds.has(h.id));

  return {
    matchedPairs: matches,
    unmatchedSwipe,
    unmatchedHatikvah,
    matchedSwipeCount: matchedSwipeIds.size,
    matchedHatikvahCount: matchedHatikvahIds.size
  };
}

function getConflictDetails(s, h) {
  const conflicts = [];
  if (s.hsn_code && h.hsn && s.hsn_code !== h.hsn) {
    conflicts.push(`HSN mismatch (Swipe: ${s.hsn_code} vs Hatikvah: ${h.hsn})`);
  }
  if (s.tax_rate != null && h.gstRate != null && Number(s.tax_rate) !== Number(h.gstRate)) {
    conflicts.push(`GST mismatch (Swipe: ${s.tax_rate}% vs Hatikvah: ${h.gstRate}%)`);
  }
  if (s.category && h.category && normalizeName(s.category) !== normalizeName(h.category)) {
    conflicts.push(`Category mismatch (Swipe: "${s.category}" vs Hatikvah: "${h.category}")`);
  }
  return conflicts.join('; ');
}

/**
 * Generate Review CSV
 */
export function generateReviewCsv(matchedPairs, unmatchedSwipe, unmatchedHatikvah) {
  const header = [
    'match_status',
    'match_reason',
    'swipe_item_id',
    'swipe_item_name',
    'swipe_item_type',
    'swipe_category',
    'swipe_hsn',
    'swipe_gst_rate',
    'swipe_unit',
    'swipe_price',
    'hatikvah_product_id',
    'hatikvah_product_name',
    'hatikvah_sku',
    'hatikvah_category',
    'hatikvah_hsn',
    'hatikvah_gst_rate',
    'hatikvah_unit',
    'existing_image_paths',
    'image_file_status',
    'conflict_details',
    'review_decision'
  ].join(',');

  const rows = [];

  const escapeCsv = (val) => {
    if (val == null) return '""';
    const s = String(val).replace(/"/g, '""');
    return `"${s}"`;
  };

  for (const m of matchedPairs) {
    const s = m.swipe;
    const h = m.hatikvah;
    const images = (h.images || []).join('; ');
    const imgStatus = h.allImagesExist ? 'VALID_ON_DISK' : h.hasValidImage ? 'PARTIAL_EXISTS' : 'NO_IMAGE_FILE';

    rows.push([
      escapeCsv(m.status),
      escapeCsv(m.reason),
      escapeCsv(s.swipe_id),
      escapeCsv(s.name),
      escapeCsv(s.item_type || 'Product'),
      escapeCsv(s.category || ''),
      escapeCsv(s.hsn_code || ''),
      escapeCsv(s.tax_rate != null ? `${s.tax_rate}%` : ''),
      escapeCsv(s.unit || ''),
      escapeCsv(s.unit_price != null ? `₹${s.unit_price}` : ''),
      escapeCsv(h.id),
      escapeCsv(h.name),
      escapeCsv(h.sku || ''),
      escapeCsv(h.category || ''),
      escapeCsv(h.hsn || ''),
      escapeCsv(h.gstRate != null ? `${h.gstRate}%` : ''),
      escapeCsv(h.unit || ''),
      escapeCsv(images),
      escapeCsv(imgStatus),
      escapeCsv(m.conflictDetails || ''),
      '""'
    ].join(','));
  }

  for (const s of unmatchedSwipe) {
    rows.push([
      escapeCsv('UNMATCHED_SWIPE'),
      escapeCsv('No suitable Hatikvah product or image found in catalog'),
      escapeCsv(s.swipe_id),
      escapeCsv(s.name),
      escapeCsv(s.item_type || 'Product'),
      escapeCsv(s.category || ''),
      escapeCsv(s.hsn_code || ''),
      escapeCsv(s.tax_rate != null ? `${s.tax_rate}%` : ''),
      escapeCsv(s.unit || ''),
      escapeCsv(s.unit_price != null ? `₹${s.unit_price}` : ''),
      '""', '""', '""', '""', '""', '""', '""', '""',
      escapeCsv('NO_HATIKVAH_IMAGE'),
      '""',
      '""'
    ].join(','));
  }

  for (const h of unmatchedHatikvah) {
    const images = (h.images || []).join('; ');
    const imgStatus = h.allImagesExist ? 'VALID_ON_DISK' : h.hasValidImage ? 'PARTIAL_EXISTS' : 'NO_IMAGE_FILE';
    rows.push([
      escapeCsv('UNMATCHED_HATIKVAH'),
      escapeCsv('Hatikvah website product not found in Swipe original catalog'),
      '""', '""', '""', '""', '""', '""', '""', '""',
      escapeCsv(h.id),
      escapeCsv(h.name),
      escapeCsv(h.sku || ''),
      escapeCsv(h.category || ''),
      escapeCsv(h.hsn || ''),
      escapeCsv(h.gstRate != null ? `${h.gstRate}%` : ''),
      escapeCsv(h.unit || ''),
      escapeCsv(images),
      escapeCsv(imgStatus),
      '""',
      '""'
    ].join(','));
  }

  return [header, ...rows].join('\n');
}

/**
 * Main Execution
 */
export async function runProductAudit() {
  console.log('Fetching complete Swipe product catalogue...');
  const swipeData = await fetchAllSwipeProducts();
  console.log(`Retrieved ${swipeData.uniqueCount} unique Swipe items (Reported total: ${swipeData.reportedTotal}).`);

  console.log('Loading Hatikvah products from .data/products.json...');
  const hatikvahProducts = loadHatikvahProducts();
  console.log(`Loaded ${hatikvahProducts.length} Hatikvah products.`);

  console.log('Running product matching engine...');
  const result = matchProductCatalog(swipeData.items, hatikvahProducts);

  console.log('Generating CSV review file...');
  const csv = generateReviewCsv(result.matchedPairs, result.unmatchedSwipe, result.unmatchedHatikvah);
  fs.writeFileSync('docs/SWIPE_PRODUCT_MATCHING_REVIEW.csv', csv, 'utf8');
  console.log('Saved: docs/SWIPE_PRODUCT_MATCHING_REVIEW.csv');

  return {
    swipeData,
    hatikvahProducts,
    result
  };
}

if (process.argv[1]?.endsWith('swipe-product-matching.js')) {
  runProductAudit().catch(console.error);
}
