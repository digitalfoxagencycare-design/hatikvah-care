export const COLLECTIONS = ['products','categories','enquiries','admins','audit','settings','customers','activities','priceLists','quotes','orders','invoices','payments','stockMoves','suppliers','purchases','outbox','otps','ledger','inbox','creditNotes','webhookEvents'];
export const UNIQUE = { products: ['slug'], admins: ['email'], settings: ['key'], quotes: ['number'], orders: ['number'], invoices: ['number'], purchases: ['number'], creditNotes: ['number'], payments: ['external'], inbox: ['waMessageId'], webhookEvents: ['eventKey'], ledger: ['sourceKey'] };
export const LEGACY_UNIQUE = new Set(['products:slug','admins:email','quotes:number','orders:number','invoices:number','purchases:number','creditNotes:number']);
export const conflict = message => Object.assign(new Error(message), { status: 409, userError: true, code: 'CONFLICT' });
export function scalarField(field, value) {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(field) || (value !== null && !['string','number','boolean'].includes(typeof value)) || (typeof value === 'number' && !Number.isFinite(value))) throw new TypeError('Store queries require a scalar field/value');
}
export function page({ sort, skip = 0, limit = 0 } = {}) {
  if (!Number.isSafeInteger(skip) || skip < 0 || !Number.isSafeInteger(limit) || limit < 0) throw new RangeError('Invalid pagination');
  if (sort) for (const [k,v] of Object.entries(sort)) { scalarField(k, null); if (![1,-1].includes(v)) throw new RangeError('Invalid sort direction'); }
  return { sort, skip, limit };
}
export function document(doc, id) {
  const { id: supplied, _id: ignored, ...rest } = structuredClone(doc);
  const canonical = id ?? supplied;
  if (typeof canonical !== 'string' || !canonical.length || canonical.length > 100) throw new TypeError('Document id must be a non-empty string');
  return { ...rest, id: canonical };
}
