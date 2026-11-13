import fs from 'node:fs';

const csv = fs.readFileSync('docs/SWIPE_PRODUCT_MATCHING_REVIEW.csv', 'utf8');
const lines = csv.split('\n').filter(Boolean);
const swipeItems = new Map();

for (let i = 1; i < lines.length; i++) {
  const row = lines[i];
  const fields = row.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || [];
  const clean = fields.map((f) => f.replace(/^"|"$/g, ''));
  const sId = clean[2];
  const sName = clean[3];
  const sType = clean[4];
  const sCat = clean[5];
  const sHsn = clean[6];
  const sGst = clean[7];
  const sUnit = clean[8];
  const sPrice = clean[9];

  if (sId && !swipeItems.has(sId)) {
    swipeItems.set(sId, {
      swipe_id: sId,
      name: sName,
      item_type: sType,
      category: sCat,
      hsn_code: sHsn,
      tax_rate: sGst,
      unit: sUnit,
      unit_price: sPrice
    });
  }
}

console.log('Unique Swipe items preserved from earlier snapshot:', swipeItems.size);
const itemsArray = [...swipeItems.values()];
console.log('Sample item:', itemsArray[0]);

// Find Anchor items
const anchor = itemsArray.filter((it) => it.name.toLowerCase().includes('anchor'));
console.log('\nAnchor items in Swipe snapshot:', anchor.length);
anchor.forEach((a) => console.log(a));

