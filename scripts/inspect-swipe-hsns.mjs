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
    name: cols[2],
    hsn: cols[5],
    gst: cols[6],
    unit: cols[7],
    price: cols[8]
  };
});

const hsnMap = new Map();
for (const item of swipeItems) {
  if (item.hsn) {
    if (!hsnMap.has(item.hsn)) hsnMap.set(item.hsn, { count: 0, gsts: new Set(), samples: [] });
    const entry = hsnMap.get(item.hsn);
    entry.count++;
    if (item.gst) entry.gsts.add(item.gst);
    if (entry.samples.length < 3) entry.samples.push(item.name);
  }
}

console.log('Total items:', swipeItems.length);
console.log('Unique HSN count in Swipe:', hsnMap.size);

const sorted = Array.from(hsnMap.entries()).sort((a, b) => b[1].count - a[1].count);
console.log('\nTop 20 HSN Codes in Swipe:');
sorted.slice(0, 20).forEach(([hsn, data]) => {
  console.log(`HSN: ${hsn.padEnd(10)} | GST: ${Array.from(data.gsts).join('/')} | Items: ${data.count} | Examples: ${data.samples.slice(0, 2).join('; ')}`);
});

