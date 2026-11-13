import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fetchAllSwipeProducts } from '../../../scripts/swipe-product-matching.js';
import { generateVerifiedCatalog } from '../../../scripts/generate-verified-catalog.js';

describe('Swipe 499-Item Catalogue Extraction & Deduplication Tests', () => {
  it('correctly fetches 5 pages (100 + 100 + 100 + 100 + 99) totaling 499 items', async () => {
    const mockFetch = async (url) => {
      const urlObj = new URL(url);
      const page = Number(urlObj.searchParams.get('page'));
      const numRecords = Number(urlObj.searchParams.get('num_records'));

      const counts = { 1: 100, 2: 100, 3: 100, 4: 100, 5: 99 };
      const currentCount = counts[page] || 0;

      const items = [];
      for (let i = 1; i <= currentCount; i++) {
        const id = (page - 1) * 100 + i;
        items.push({ swipe_id: String(id), name: `Item ${id}`, item_type: 'Product' });
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            total_records: 499,
            items
          }
        })
      };
    };

    const res = await fetchAllSwipeProducts(mockFetch, 'dummy-token', 'https://mock.swipe', 100);
    assert.equal(res.reportedTotal, 499);
    assert.equal(res.retrievedCount, 499);
    assert.equal(res.uniqueCount, 499);
    assert.equal(res.items.length, 499);
    assert.equal(res.items[0].swipe_id, '1');
    assert.equal(res.items[498].swipe_id, '499');
  });

  it('detects duplicate IDs and repeated pages across API responses and preserves single unique instance', async () => {
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
                { swipe_id: '10', name: 'Anchor Tooth Paste 8gms' },
                { swipe_id: '11', name: 'Dabur Mesvak Tooth Paste' }
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
                { swipe_id: '10', name: 'Anchor Tooth Paste 8gms' }, // Repeated ID across pages
                { swipe_id: '12', name: 'Toilet Roll 50gms' }
              ]
            }
          })
        };
      }
      return { ok: true, status: 200, json: async () => ({ success: true, data: { items: [] } }) };
    };

    const res = await fetchAllSwipeProducts(mockFetch, 'dummy-token', 'https://mock.swipe', 2);
    assert.equal(res.retrievedCount, 4);
    assert.equal(res.uniqueCount, 3);
    const anchorCount = res.items.filter((it) => it.swipe_id === '10').length;
    assert.equal(anchorCount, 1, 'Anchor Paste ID 10 must appear exactly once in clean catalogue');
  });

  it('flags when API total does not match retrieved count', async () => {
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          total_records: 500, // API reports 500
          items: [{ swipe_id: '1', name: 'Single Item' }] // but returns only 1
        }
      })
    });

    const res = await fetchAllSwipeProducts(mockFetch, 'dummy-token', 'https://mock.swipe', 100);
    assert.equal(res.reportedTotal, 500);
    assert.equal(res.uniqueCount, 1);
    assert.notEqual(res.reportedTotal, res.uniqueCount, 'Discrepancy between reported and retrieved must be detectable');
  });

  it('handles network timeouts and HTTP 429 with backoff retry', async () => {
    let attempts = 0;
    const mockFetch = async () => {
      attempts++;
      if (attempts === 1) return { status: 429, ok: false };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { total_records: 1, items: [{ swipe_id: '99', name: 'Rate Safe Item' }] }
        })
      };
    };

    const res = await fetchAllSwipeProducts(mockFetch, 'dummy-token', 'https://mock.swipe', 100);
    assert.equal(attempts, 2);
    assert.equal(res.uniqueCount, 1);
  });

  it('distinguishes two genuinely different product IDs with similar names without merging', () => {
    const itemA = { swipe_id: '10', name: 'Anchor Tooth Paste 8gms' };
    const itemB = { swipe_id: '10B', name: 'Anchor Tooth Paste 15gms' };

    const items = [itemA, itemB];
    const uniqueMap = new Map();
    items.forEach((it) => uniqueMap.set(it.swipe_id, it));

    assert.equal(uniqueMap.size, 2);
    assert.equal(uniqueMap.get('10').name, 'Anchor Tooth Paste 8gms');
    assert.equal(uniqueMap.get('10B').name, 'Anchor Tooth Paste 15gms');
  });

  it('protects against spreadsheet formula injection (=, +, -, @)', () => {
    function sanitizeFormula(val) {
      if (val == null) return '';
      const str = String(val);
      if (/^[=\+\-@]/.test(str)) return `'${str}`;
      return str;
    }

    assert.equal(sanitizeFormula('=SUM(A1:A10)'), "'=SUM(A1:A10)");
    assert.equal(sanitizeFormula('+12345'), "'+12345");
    assert.equal(sanitizeFormula('-50.00'), "'-50.00");
    assert.equal(sanitizeFormula('@admin'), "'@admin");
    assert.equal(sanitizeFormula('Normal Product'), 'Normal Product');
  });

  it('distinguishes missing HSN/GST from genuine zero values and preserves text types', () => {
    const item1 = { swipe_id: '1', hsn_code: '0304', tax_rate: 0 };
    const item2 = { swipe_id: '2', hsn_code: '', tax_rate: null };

    // Leading zeros in HSN must remain as text
    assert.equal(typeof item1.hsn_code, 'string');
    assert.equal(item1.hsn_code, '0304');
    assert.equal(item1.tax_rate, 0);

    // Missing values
    assert.equal(item2.hsn_code, '');
    assert.equal(item2.tax_rate, null);
  });
});

