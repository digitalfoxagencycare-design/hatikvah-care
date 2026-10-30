import assert from 'node:assert/strict';

/** Audit release gate only; this does not add accounting enforcement to production posting. */
export function assertBalancedJournals(entries) {
  assert.ok(Array.isArray(entries) && entries.length > 0, 'no posted journals to validate');
  for (const entry of entries) {
    assert.ok(Array.isArray(entry.lines) && entry.lines.length >= 2, 'cashbook entry has no double-entry journal lines');
    let debits = 0n, credits = 0n;
    for (const line of entry.lines) {
      const d = line.debit ?? 0, c = line.credit ?? 0;
      assert.ok(Number.isSafeInteger(d) && d >= 0 && Number.isSafeInteger(c) && c >= 0, 'journal money must be non-negative safe-integer paise');
      assert.ok((d > 0 && c === 0) || (c > 0 && d === 0), 'each journal line must have exactly one positive side');
      debits += BigInt(d); credits += BigInt(c);
    }
    assert.ok(debits === credits && debits > 0n, 'journal debits do not equal credits');
    assert.ok(debits <= BigInt(Number.MAX_SAFE_INTEGER), 'journal total exceeds safe-integer paise range');
  }
}
