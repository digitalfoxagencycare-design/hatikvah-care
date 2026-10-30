/** Exact decimal arithmetic at money boundaries. Stored and returned money is safe-integer paise. */
function decimal(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new RangeError('Invalid non-negative decimal');
  const [mantissa, power = '0'] = String(value).toLowerCase().split('e');
  const [whole, part = ''] = mantissa.split('.');
  const exponent = Number(power) - part.length;
  const digits = BigInt(whole + part);
  return exponent >= 0 ? [digits * 10n ** BigInt(exponent), 1n] : [digits, 10n ** BigInt(-exponent)];
}
export function safePaise(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Money exceeds safe-integer paise range');
  return value;
}
export function roundMoneyProduct(paise, multiplier, divisor = 1) {
  safePaise(paise);
  const [n, d] = decimal(multiplier);
  if (!Number.isSafeInteger(divisor) || divisor <= 0) throw new RangeError('Invalid divisor');
  const denominator = d * BigInt(divisor), numerator = BigInt(paise) * n;
  return safePaise(Number((2n * numerator + denominator) / (2n * denominator)));
}

/** Decimal rupees -> paise, exact half-up; blank is price on request, invalid input is NaN. */
export function parseRupees(value, maxPaise = Number.MAX_SAFE_INTEGER) {
  if(value===null||value===undefined||String(value).trim()==='')return null;
  const original=String(value).trim();
  if(original.includes(',')&&!/^(?:\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d{1,9})?$/.test(original))return NaN;
  const input=original.replaceAll(',','');if(!/^\d+(?:\.\d{1,9})?$/.test(input))return NaN;
  const [whole,fraction='']=input.split('.');
  const paise=BigInt(whole)*100n+BigInt((fraction+'00').slice(0,2))+(fraction.length>2&&fraction[2]>='5'?1n:0n);
  return paise<=BigInt(maxPaise)?Number(paise):NaN;
}
