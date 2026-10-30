import { validateJournal } from './accounting.js';
export async function accountingReadiness(store) {
  const [journals,invoices,payments,notes]=await Promise.all([store.ledger.all(),store.invoices.all(),store.payments.all(),store.creditNotes.all()]);
  const problems=[],sources=new Set(journals.map(j=>j.sourceKey).filter(Boolean));
  for(const j of journals){
    if(!j.lines){if(!j.legacySupersededBy)problems.push({kind:'legacy_journal',id:j.id});continue;}
    try{validateJournal(j.lines);}catch{problems.push({kind:'invalid_journal',id:j.id});}
  }
  for(const i of invoices)if(i.totals?.total>0&&!sources.has('invoice:'+i.id))problems.push({kind:'invoice_not_posted',id:i.id});
  for(const i of invoices)if(i.status==='void'&&i.totals?.total>0&&!sources.has('invoice-void:'+i.id))problems.push({kind:'void_not_posted',id:i.id});
  for(const p of payments)if(!sources.has('payment:'+p.id))problems.push({kind:'payment_not_posted',id:p.id});
  for(const n of notes)if(!sources.has('credit-note:'+n.id))problems.push({kind:'credit_note_not_posted',id:n.id});
  for(const i of invoices){const credited=notes.filter(n=>n.invoiceId===i.id).reduce((s,n)=>s+n.totals.total,0);if(credited!==(i.creditedAmount||0))problems.push({kind:'credit_aggregate_mismatch',id:i.id});}
  return{ready:problems.length===0,problems,counts:{journals:journals.length,invoices:invoices.length,payments:payments.length,creditNotes:notes.length}};
}
export async function assertAccountingReady(store) {
  const state=await accountingReadiness(store);
  if(!state.ready)throw new Error(`Accounting reconciliation required before production startup (${state.problems.length} unresolved records); run scripts/accounting-migration.mjs in review mode`);
  return state;
}
