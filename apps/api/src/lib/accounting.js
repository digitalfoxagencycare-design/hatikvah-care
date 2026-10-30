import { safePaise } from './money.js';
const invalid = message => Object.assign(new Error(message), { userError: true, status: 400 });
export function validateJournal(lines) {
  if (!Array.isArray(lines) || lines.length < 2) throw invalid('A journal requires at least two balanced lines');
  let debit=0n,credit=0n;
  for(const line of lines){
    if(typeof line.account!=='string'||!/^[a-z][a-z0-9_]{1,60}$/.test(line.account))throw invalid('Invalid ledger account');
    try{safePaise(line.debit);safePaise(line.credit);}catch{throw invalid('Journal amounts must be safe-integer paise');}
    if(!((line.debit>0&&line.credit===0)||(line.credit>0&&line.debit===0)))throw invalid('A journal line requires exactly one positive side');
    debit+=BigInt(line.debit);credit+=BigInt(line.credit);
  }
  if(debit!==credit||debit<=0n||debit>BigInt(Number.MAX_SAFE_INTEGER))throw invalid('Journal debits must equal credits within safe paise range');
  return Number(debit);
}
export function invoiceLines(t, reverse=false) {
  for(const k of ['total','taxable','cgst','sgst','igst'])safePaise(t[k]||0);
  if(!Number.isSafeInteger(t.roundOff||0))throw invalid('Invalid round-off');
  const lines=[{account:'accounts_receivable',debit:t.total,credit:0},
    {account:'sales_revenue',debit:0,credit:t.taxable},
    ...['cgst','sgst','igst'].map(k=>({account:'output_'+k,debit:0,credit:t[k]||0})),
    {account:'round_off',debit:Math.max(0,-(t.roundOff||0)),credit:Math.max(0,t.roundOff||0)}].filter(l=>l.debit||l.credit);
  return reverse?lines.map(l=>({...l,debit:l.credit,credit:l.debit})):lines;
}
export function postJournal(store,e) {
  validateJournal(e.lines);
  return store.atomic(async()=>{
    if(e.sourceKey){const old=await store.ledger.findBy('sourceKey',e.sourceKey);if(old)return old;}
    return store.ledger.insert({...e,lines:e.lines.map(l=>({...l})),postedAt:new Date().toISOString(),createdAt:new Date().toISOString(),immutable:true});
  });
}
