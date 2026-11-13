/**
 * Read-Only Swipe API Discovery & Inventory Script
 * Strictly GET-only audit tool for retrieving metadata, counts, and series without mutating state.
 *
 * Usage:
 *   node --env-file=.env scripts/swipe-audit.js
 */

const BASE_URL = process.env.SWIPE_API_BASE_URL || 'https://app.getswipe.in/api/partner';
const TOKEN = process.env.SWIPE_API_TOKEN;

if (!TOKEN) {
  console.error('[SWIPE AUDIT ERROR] No API token configured.');
  console.error('Please configure SWIPE_API_TOKEN in your environment or .env file.');
  process.exit(1);
}

const HEADERS = {
  'Authorization': `Bearer ${TOKEN}`,
  'Content-Type': 'application/json'
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithRetry(url, options = {}, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options);
      if (res.status === 429) {
        const waitMs = Math.pow(2, i) * 1000;
        console.warn(`[RATE LIMIT] HTTP 429 encountered. Backing off for ${waitMs}ms...`);
        await sleep(waitMs);
        continue;
      }
      return res;
    } catch (err) {
      if (i === retries - 1) throw err;
      await sleep(1000);
    }
  }
}

async function auditEndpoint(name, path) {
  try {
    const res = await fetchWithRetry(`${BASE_URL}${path}`, { method: 'GET', headers: HEADERS });
    const data = await res.json().catch(() => ({}));
    const total = data.data?.total_records ?? (Array.isArray(data.data) ? data.data.length : (data.data?.customers?.length || data.data?.items?.length || data.data?.vendors?.length || data.data?.transactions?.length || 'N/A'));
    return {
      name,
      path,
      status: res.status,
      success: data.success ?? res.ok,
      totalRecords: total,
      message: data.message || (res.ok ? 'OK' : 'Failed')
    };
  } catch (e) {
    return { name, path, status: 0, success: false, totalRecords: 0, message: e.message };
  }
}

export async function runAudit() {
  console.log('========================================================');
  console.log('   Swipe API Discovery & Read-Only Audit Running...     ');
  console.log('========================================================');

  const auditEndpoints = [
    { name: 'Customers', path: '/v2/customer/list' },
    { name: 'Vendors', path: '/v2/vendor/list' },
    { name: 'Products / Items', path: '/v2/product/list' },
    { name: 'Invoices (All Time)', path: '/v2/doc/list?document_type=invoice&start_date=01-01-2020&end_date=12-11-2026' },
    { name: 'Estimates / Quotes', path: '/v2/doc/list?document_type=estimate&start_date=01-01-2020&end_date=12-11-2026' },
    { name: 'Purchases', path: '/v2/doc/list?document_type=purchase&start_date=01-01-2020&end_date=12-11-2026' },
    { name: 'Delivery Challans', path: '/v2/doc/list?document_type=delivery_challan&start_date=01-01-2020&end_date=12-11-2026' },
    { name: 'Payments (All)', path: '/v2/payment/list?start_date=01-01-2020&end_date=12-11-2026&status=all' }
  ];

  const results = [];
  for (const ep of auditEndpoints) {
    const res = await auditEndpoint(ep.name, ep.path);
    results.push(res);
    console.log(`[${res.status}] ${res.name.padEnd(22)} | Records: ${String(res.totalRecords).padStart(5)} | ${res.message}`);
    await sleep(200); // Polite rate pacing
  }

  return results;
}

if (process.argv[1]?.endsWith('swipe-audit.js')) {
  runAudit().catch(console.error);
}

