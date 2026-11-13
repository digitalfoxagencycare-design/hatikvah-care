import fs from 'node:fs';

const BASE_URL = process.env.SWIPE_API_BASE_URL || 'https://app.getswipe.in/api/partner';
const TOKEN = process.env.SWIPE_API_TOKEN;

async function investigate() {
  const allItems = [];
  const pageMap = new Map();

  for (let p = 1; p <= 5; p++) {
    const res = await fetch(`${BASE_URL}/v2/product/list?page=${p}&num_records=100`, {
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    const d = await res.json();
    const items = d.data?.items || [];
    for (const it of items) {
      allItems.push(it);
      pageMap.set(it.swipe_id, p);
    }
  }

  console.log(`Total Swipe items fetched: ${allItems.length}`);

  // Find Anchor items
  const anchorItems = allItems.filter((it) => it.name.toLowerCase().includes('anchor'));
  console.log(`\nSwipe items containing "anchor": ${anchorItems.length}`);
  anchorItems.forEach((it) => {
    console.log(JSON.stringify({
      swipe_id: it.swipe_id,
      name: it.name,
      hsn_code: it.hsn_code,
      tax_rate: it.tax_rate,
      unit: it.unit,
      unit_price: it.unit_price,
      page: pageMap.get(it.swipe_id),
      timesInSwipeApiResponse: allItems.filter((x) => x.swipe_id === it.swipe_id).length
    }, null, 2));
  });

  // Check matching CSV rows for each Anchor item
  if (fs.existsSync('docs/SWIPE_PRODUCT_MATCHING_REVIEW.csv')) {
    const csv = fs.readFileSync('docs/SWIPE_PRODUCT_MATCHING_REVIEW.csv', 'utf8');
    const lines = csv.split('\n').filter(Boolean);

    console.log('\n--- Checking appearance in SWIPE_PRODUCT_MATCHING_REVIEW.csv ---');
    anchorItems.forEach((it) => {
      const matchingRows = lines.filter((l) => {
        const parts = l.split('","');
        return parts[2] === it.swipe_id;
      });
      console.log(`Swipe ID ${it.swipe_id} ("${it.name}") appears in matching CSV: ${matchingRows.length} times`);
      matchingRows.forEach((r, idx) => {
        const parts = r.split('","').map((s) => s.replace(/^"|"$/g, ''));
        console.log(`  Row ${idx + 1}: Status=${parts[0]} | Hatikvah SKU=${parts[12]} | Hatikvah Name="${parts[11]}"`);
      });
    });
  }
}

investigate().catch(console.error);

