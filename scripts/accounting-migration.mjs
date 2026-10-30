/** Review first. Apply only during maintenance, with an owner-reviewed counter-account mapping for manual legacy entries. */
import fs from 'node:fs/promises';
import { loadConfig } from '../apps/api/src/config.js';
import { createStore } from '../apps/api/src/store/index.js';
import { invoiceLines } from '../apps/api/src/lib/accounting.js';
import { postLedger, ledgerAccount } from '../apps/api/src/lib/sales.js';
import { accountingReadiness } from '../apps/api/src/lib/accounting-readiness.js';
const store=await createStore(loadConfig());
try{
  if(!process.argv.includes('--apply')){console.log(JSON.stringify(await accountingReadiness(store),null,2));}
  else {
    const at=process.argv.indexOf('--manual-map'),mapping=at>=0?JSON.parse(await fs.readFile(process.argv[at+1],'utf8')):{};
    await store.atomic(async()=>{
      const [invoices,payments,notes,old]=await Promise.all([store.invoices.all(),store.payments.all(),store.creditNotes.all(),store.ledger.all()]);
      const manual=old.filter(j=>!j.lines&&!j.legacySupersededBy&&!j.paymentId&&j.kind!=='credit_note');
      for(const j of manual)if(!mapping[j.id]?.contraAccount)throw new Error(`Explicit counter-account mapping required for legacy row ${j.id}`);
      for(const i of invoices){
        const lines=invoiceLines(i.totals);if(!lines.length)continue;
        await postLedger(store,{sourceKey:'invoice:'+i.id,kind:'invoice',account:'accounts_receivable',amount:i.totals.total,invoiceId:i.id,ref:i.number,date:i.date,lines,by:'accounting-migration'});
        if(i.status==='void')await postLedger(store,{sourceKey:'invoice-void:'+i.id,kind:'invoice_void',account:'accounts_receivable',amount:i.totals.total,invoiceId:i.id,ref:i.number,date:i.date,lines:invoiceLines(i.totals,true),by:'accounting-migration'});
      }
      for(const p of payments){
        const account=ledgerAccount(p.mode);
        const posted=await postLedger(store,{sourceKey:'payment:'+p.id,kind:'receipt',account,amount:p.amount,paymentId:p.id,invoiceId:p.invoiceId,ref:p.invoiceNumber,date:p.date,lines:[{account,debit:p.amount,credit:0},{account:'accounts_receivable',debit:0,credit:p.amount}],by:'accounting-migration'});
        if(p.reversedAt)await postLedger(store,{sourceKey:'payment-reversal:'+p.id,kind:'payment',account,amount:p.amount,paymentId:p.id,invoiceId:p.invoiceId,ref:p.invoiceNumber,date:p.reversedAt.slice(0,10),reversalOf:posted.id,lines:posted.lines.map(l=>({...l,debit:l.credit,credit:l.debit})),by:'accounting-migration'});
      }
      for(const n of notes)await postLedger(store,{sourceKey:'credit-note:'+n.id,kind:'credit_note',account:'credit_notes',amount:n.totals.total,invoiceId:n.invoiceId,ref:n.number,date:n.date,lines:invoiceLines(n.totals,true),by:'accounting-migration'});
      for(const j of old.filter(j=>!j.lines&&!j.legacySupersededBy)){
        let replacement;
        if(j.paymentId)replacement=await store.ledger.findBy('sourceKey','payment:'+j.paymentId);
        else if(j.kind==='credit_note'){const n=notes.find(n=>n.number===j.ref);if(n)replacement=await store.ledger.findBy('sourceKey','credit-note:'+n.id);}
        else replacement=await postLedger(store,{...j,id:undefined,sourceKey:'legacy-manual:'+j.id,contraAccount:mapping[j.id].contraAccount,by:'accounting-migration'});
        if(!replacement)throw new Error('Legacy row has no verifiable source: '+j.id);
        await store.ledger.update(j.id,{legacySupersededBy:replacement.id,legacyPreserved:true});
      }
      const result=await accountingReadiness(store);if(!result.ready)throw new Error('Reconciliation remains incomplete; transaction rolled back');
    });
    console.log(JSON.stringify(await accountingReadiness(store),null,2));
  }
}finally{await store.close();}
