import fs from 'node:fs';

const csv = fs.readFileSync('docs/SWIPE_PRODUCT_MATCHING_REVIEW.csv', 'utf8');
const lines = csv.split('\n').filter(Boolean);

const uniqueSwipeConfirmed = new Set();
const uniqueSwipeHigh = new Set();
const uniqueSwipeManual = new Set();
const uniqueSwipeUnmatched = new Set();

const uniqueHatikvahConfirmed = new Set();
const uniqueHatikvahHigh = new Set();
const uniqueHatikvahManual = new Set();
const uniqueHatikvahUnmatched = new Set();

let totalConflicts = 0;

for (let i = 1; i < lines.length; i++) {
  const row = lines[i];
  const fields = row.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || [];
  const clean = fields.map((f) => f.replace(/^"|"$/g, ''));
  const status = clean[0];
  const sId = clean[2];
  const hId = clean[10];
  const conflict = clean[19];

  if (conflict && conflict.length > 0) totalConflicts++;

  if (status === 'CONFIRMED_MATCH') {
    if (sId) uniqueSwipeConfirmed.add(sId);
    if (hId) uniqueHatikvahConfirmed.add(hId);
  } else if (status === 'HIGH_CONFIDENCE') {
    if (sId) uniqueSwipeHigh.add(sId);
    if (hId) uniqueHatikvahHigh.add(hId);
  } else if (status === 'MANUAL_REVIEW') {
    if (sId) uniqueSwipeManual.add(sId);
    if (hId) uniqueHatikvahManual.add(hId);
  } else if (status === 'UNMATCHED_SWIPE') {
    if (sId) uniqueSwipeUnmatched.add(sId);
  } else if (status === 'UNMATCHED_HATIKVAH') {
    if (hId) uniqueHatikvahUnmatched.add(hId);
  }
}

console.log('=== UNIQUE RECORD BREAKDOWN ===');
console.log('Swipe Items (Total: 499):');
console.log('  Confirmed Matches:            ', uniqueSwipeConfirmed.size);
console.log('  High-Confidence Suggestions:  ', uniqueSwipeHigh.size);
console.log('  Manual-Review Suggestions:    ', uniqueSwipeManual.size);
console.log('  Unmatched Swipe Items:        ', uniqueSwipeUnmatched.size);
console.log('  Sum of Swipe Items:           ', uniqueSwipeConfirmed.size + uniqueSwipeHigh.size + uniqueSwipeManual.size + uniqueSwipeUnmatched.size);

console.log('\nHatikvah Products (Total: 153):');
console.log('  Matched High-Confidence:      ', uniqueHatikvahHigh.size);
console.log('  Matched in Manual-Review:     ', uniqueHatikvahManual.size);
const totalHatikvahMatched = new Set([...uniqueHatikvahConfirmed, ...uniqueHatikvahHigh, ...uniqueHatikvahManual]);
console.log('  Total Distinct Matched:       ', totalHatikvahMatched.size);
console.log('  Unmatched Hatikvah Products:  ', uniqueHatikvahUnmatched.size);
console.log('  Sum of Hatikvah Products:     ', totalHatikvahMatched.size + uniqueHatikvahUnmatched.size);

console.log('\nData Conflicts Count (Rows with HSN/GST/Category difference):', totalConflicts);
