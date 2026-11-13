import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeName,
  extractMetrics,
  matchProductCatalog,
  fetchAllSwipeProducts,
  generateReviewCsv
} from '../../../scripts/swipe-product-matching.js';

describe('Swipe Product Matching & Image Mapping - Real Function Verification', () => {
  it('normalizes strings and handles punctuation, slashes, and dashes', () => {
    assert.equal(normalizeName('Hotel Dental Kit – Anchor Toothbrush (1+1)'), 'hotel dental kit anchor toothbrush 11');
    assert.equal(normalizeName('White/Ivory Handle Comb 7" 10.5 Gms White'), 'white ivory handle comb 7 10.5 gms white');
    assert.equal(normalizeName('   Bio Green Apple Shampoo 25ml  '), 'bio green apple shampoo 25ml');
  });

  it('extracts metrics (volume, weight, count, sizes) accurately', () => {
    const m1 = extractMetrics('Bio Green Apple Shampoo 25ml');
    assert.deepEqual(m1, ['25ml']);

    const m2 = extractMetrics('Anchor Paste 8 gms');
    assert.deepEqual(m2, ['8gms']);

    const m3 = extractMetrics('Comb 7 inch 10.5 gm');
    assert.deepEqual(m3, ['7inch', '10.5gms']);
  });

  it('handles multiple API pages, deduplicating repeated items and calculating unique counts', async () => {
    let callCount = 0;
    const mockFetch = async (url) => {
      callCount++;
      const urlObj = new URL(url);
      const page = Number(urlObj.searchParams.get('page'));

      if (page === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: {
              total_records: 3,
              items: [
                { swipe_id: 'S1', name: 'Product Alpha 25ml', item_type: 'Product' },
                { swipe_id: 'S2', name: 'Product Beta 50ml', item_type: 'Product' }
              ]
            }
          })
        };
      } else if (page === 2) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: {
              total_records: 3,
              items: [
                { swipe_id: 'S2', name: 'Product Beta 50ml', item_type: 'Product' }, // duplicate on page 2
                { swipe_id: 'S3', name: 'Product Gamma 100ml', item_type: 'Product' }
              ]
            }
          })
        };
      }
      return { ok: true, status: 200, json: async () => ({ success: true, data: { total_records: 3, items: [] } }) };
    };

    // pass numRecords = 2 so page 1 doesn't early-terminate
    const res = await fetchAllSwipeProducts(mockFetch, 'dummy-token', 'https://mock.swipe', 2);
    assert.equal(res.retrievedCount, 4);
    assert.equal(res.uniqueCount, 3);
    assert.equal(res.items.length, 3);
    assert.equal(res.items[0].swipe_id, 'S1');
    assert.equal(res.items[1].swipe_id, 'S2');
    assert.equal(res.items[2].swipe_id, 'S3');
  });

  it('recovers from HTTP 429 rate limit backoff and retries', async () => {
    let attempts = 0;
    const mockFetch = async () => {
      attempts++;
      if (attempts === 1) {
        return { status: 429, ok: false };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { total_records: 1, items: [{ swipe_id: 'S1', name: 'Rate Test' }] }
        })
      };
    };

    const res = await fetchAllSwipeProducts(mockFetch, 'dummy-token', 'https://mock.swipe');
    assert.equal(attempts, 2);
    assert.equal(res.uniqueCount, 1);
  });

  it('matches high-confidence items and detects HSN / GST conflicts', () => {
    const swipeItems = [
      {
        swipe_id: '1',
        name: 'Anchor Tooth Paste 8gms',
        hsn_code: '33061020',
        tax_rate: 18,
        unit: 'NOS',
        unit_price: 15
      },
      {
        swipe_id: '2',
        name: 'Bio Green Apple Shampoo 25ml',
        hsn_code: '30039011',
        tax_rate: 5,
        unit: 'NOS',
        unit_price: 10.75
      }
    ];

    const hatikvahProducts = [
      {
        id: 'h1',
        name: 'Anchor Paste 8 gms',
        sku: 'HC-008',
        hsn: '3306',
        gstRate: 18,
        unit: 'pcs',
        images: ['/catalog/p06-2.jpg']
      },
      {
        id: 'h2',
        name: 'Different Product Unrelated 500ml',
        sku: 'HC-999',
        hsn: '9999',
        gstRate: 18,
        unit: 'pcs',
        images: ['/catalog/p99.jpg']
      }
    ];

    const res = matchProductCatalog(swipeItems, hatikvahProducts);

    const anchorMatch = res.matchedPairs.find((m) => m.swipe.swipe_id === '1');
    assert.ok(anchorMatch);
    assert.equal(anchorMatch.status, 'HIGH_CONFIDENCE');
    assert.equal(anchorMatch.hatikvah.sku, 'HC-008');
    assert.equal(anchorMatch.hasConflict, true);
    assert.ok(anchorMatch.conflictDetails.includes('HSN mismatch'));

    assert.ok(res.unmatchedSwipe.some((s) => s.swipe_id === '2'));
    assert.ok(res.unmatchedHatikvah.some((h) => h.id === 'h2'));
  });

  it('flags ambiguous multiple candidates for Manual Review', () => {
    const swipeItems = [
      { swipe_id: 'S_NAP', name: 'Table Napkin', item_type: 'Product' }
    ];

    const hatikvahProducts = [
      { id: 'H1', name: 'Table Napkins White Plain', sku: 'HC-N1' },
      { id: 'H2', name: 'Satin Band Table Napkins', sku: 'HC-N2' },
      { id: 'H3', name: 'Jacquard Table Napkins', sku: 'HC-N3' }
    ];

    const res = matchProductCatalog(swipeItems, hatikvahProducts);
    const manualMatches = res.matchedPairs.filter((m) => m.swipe.swipe_id === 'S_NAP');
    assert.ok(manualMatches.length > 1);
    assert.equal(manualMatches[0].status, 'MANUAL_REVIEW');
    assert.ok(manualMatches[0].reason.includes('Ambiguous match'));
  });

  it('generates valid sanitized CSV output with image paths and blank review decision', () => {
    const matchedPairs = [
      {
        status: 'HIGH_CONFIDENCE',
        reason: 'Semantic match',
        swipe: { swipe_id: 'S1', name: 'Test Prod', item_type: 'Product', unit_price: 10 },
        hatikvah: { id: 'H1', name: 'Test Prod', sku: 'SKU1', images: ['/catalog/img1.jpg'], allImagesExist: true },
        hasConflict: false,
        conflictDetails: ''
      }
    ];

    const csv = generateReviewCsv(matchedPairs, [], []);
    assert.ok(csv.includes('match_status,match_reason'));
    assert.ok(csv.includes('"HIGH_CONFIDENCE"'));
    assert.ok(csv.includes('"/catalog/img1.jpg"'));
    assert.ok(csv.includes('"VALID_ON_DISK"'));
    assert.ok(!csv.includes('Bearer'));
    assert.ok(!csv.includes('Authorization'));
  });
});
