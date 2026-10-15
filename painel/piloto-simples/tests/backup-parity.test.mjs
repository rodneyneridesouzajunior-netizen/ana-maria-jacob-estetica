import test from 'node:test';
import assert from 'node:assert/strict';
import {seed} from '../domain.mjs';
import {saveProduct,saveProcedure,saveQuote,approveQuote,cancelQuote,remainingSessions} from '../operations-domain.mjs';
import {validateBackupState} from '../backup.mjs';
import {createVisit} from '../visit-workflow.mjs';
function fixture(withRevision=false,approved=true){const s=seed(),common={today:'2026-10-15',now:'2026-10-15T18:00:00.000Z'};saveProduct(s,{...common,operationId:'product-parity',data:{id:'prod-parity',name:'Material fictício',brand:'Marca teste',unit:'un',unitCost:250,usage:'material'}});saveProcedure(s,{...common,operationId:'procedure-parity',data:{id:'proc-parity',name:'Avaliação fictícia',category:'Teste',emoji:'✦',recordMode:'simple',price:10000,cost:1000,duration:30,returnInterval:1,returnUnit:'months'}});createVisit(s,{id:'visit-parity',patientId:'demo-marina',procedureId:'proc-parity',date:'2026-10-15'});saveQuote(s,{...common,operationId:'quote-parity',data:{id:'quote-parity',patientId:'demo-marina',title:'',validUntil:'',discountBps:1000,paymentMethods:['pix','boleto'],notes:'Teste de backup',items:[{id:'line1',type:'procedure',procedureId:'proc-parity',sessions:2,unitPrice:10000,unitCost:1000,discountBps:500},{id:'line2',type:'product',productId:'prod-parity',quantity:1.5,unitPrice:500,unitCost:250,discountBps:1000}]}});if(withRevision){const q=s.quotes.at(-1);saveQuote(s,{...common,operationId:'quote-parity-revision',data:{...q,expectedVersion:q.version,title:'Proposta revisada'}});}if(approved)approveQuote(s,{...common,operationId:'approve-parity',quoteId:'quote-parity',expectedVersion:withRevision?2:1,note:'Aprovação fictícia'});return s;}
test('backup aceita campos completos do catálogo, snapshot de consulta e orçamento misto sem validade',()=>{assert.doesNotThrow(()=>validateBackupState(fixture()));});
test('backup rejeita uso, tipo de registro, retorno e snapshot inconsistentes',()=>{for(const change of [s=>s.products.at(-1).usage='invalid',s=>s.procedures.at(-1).recordMode='bad',s=>s.procedures.at(-1).returnUnit='years',s=>s.visits.at(-1).procedureSnapshot.version=999]){const s=fixture();change(s);assert.throws(()=>validateBackupState(s));}});
test('backup recusa produto com sessões, quantidade divergente e desconto adulterado',()=>{for(const change of [s=>s.quotes.at(-1).items[1].sessions=1,s=>s.quotes.at(-1).items[1].quantityUnits=1,s=>s.quotes.at(-1).itemDiscount++,s=>s.quotes.at(-1).paymentMethods=['pix','pix']]){const s=fixture();change(s);assert.throws(()=>validateBackupState(s));}});

test('restauração rejeita histórico corrompido antes de disponibilizar orçamento',()=>{
 const valid=JSON.parse(JSON.stringify(fixture(true))),before=structuredClone(valid);
 assert.doesNotThrow(()=>validateBackupState(valid));assert.deepEqual(valid,before);
 for(const change of [
  h=>h[0].snapshot.items=null,
  h=>h[0].snapshot.total++,
  h=>h[0].snapshot.items[1].quantityUnits++,
  h=>h[0].snapshot.items[0].type='outro',
  h=>h[0].at='data inválida',
  h=>h[0].version=3,
  h=>h[0].snapshot.patientId='paciente-ausente',
  h=>h[0].snapshot.items[0].procedureId='procedimento-ausente',
  h=>h[0].snapshot.items[1].productId='produto-ausente'
 ]){const damaged=structuredClone(valid);change(damaged.quotes.at(-1).history);const unchanged=structuredClone(damaged);assert.throws(()=>validateBackupState(damaged));assert.deepEqual(damaged,unchanged);}
});

test('aprovação restaurada continua idempotente e conserva centavos e quantidade fracionada',()=>{
 const restored=JSON.parse(JSON.stringify(fixture())),before=structuredClone(restored),q=restored.quotes.at(-1),bill=restored.bills.find(b=>b.id===q.billId);
 validateBackupState(restored);
 approveQuote(restored,{operationId:'approve-parity',quoteId:q.id,expectedVersion:1,note:'Aprovação fictícia',today:'2026-10-16',now:'2026-10-16T18:00:00.000Z'});
 assert.deepEqual(restored,before);assert.equal(restored.bills.filter(b=>b.quoteId===q.id).length,1);
 assert.equal(q.total,17707);assert.equal(q.cost,2375);assert.equal(q.items[1].quantity,1.5);assert.equal(q.items[1].quantityUnits,15000);assert.equal(bill.total,17707);
});

test('cancelamento aprovado é restaurável, preserva cobrança e histórico e não repete o cancelamento',()=>{
 const restored=JSON.parse(JSON.stringify(fixture(true))),q=restored.quotes.at(-1),originalItems=structuredClone(q.items),billId=q.billId;
 const input={operationId:'cancel-parity',quoteId:q.id,expectedVersion:2,reason:'Cancelamento fictício solicitado',date:'2026-10-15',today:'2026-10-15',now:'2026-10-15T18:05:00.000Z'};
 cancelQuote(restored,input);
 const reloaded=JSON.parse(JSON.stringify(restored)),before=structuredClone(reloaded);assert.doesNotThrow(()=>validateBackupState(reloaded));cancelQuote(reloaded,input);assert.deepEqual(reloaded,before);
 const saved=reloaded.quotes.at(-1),bill=reloaded.bills.find(b=>b.id===billId);
 assert.equal(saved.status,'cancelado');assert.equal(saved.version,3);assert.deepEqual(saved.items,originalItems);assert.equal(saved.history.length,3);assert.equal(saved.history[0].snapshot.total,17707);
 assert.equal(bill.total,17707);assert.equal(bill.cost,2375);assert.equal(bill.quoteVersion,2);assert.equal(bill.cancelledAt,saved.cancelledAt);assert.equal(bill.cancelDate,saved.cancelDate);assert.equal(bill.cancelReason,saved.cancelReason);
 assert.equal(reloaded.financeHistory.filter(e=>e.entityId===bill.id&&e.action==='cancelamento_cobranca').length,1);assert.equal(remainingSessions(reloaded,saved.id,'line1'),0);assert.equal(remainingSessions(reloaded,saved.id,'line2'),0);
 assert.throws(()=>approveQuote(reloaded,{operationId:'approve-after-cancel',quoteId:saved.id,expectedVersion:saved.version,note:'Nova tentativa',today:'2026-10-15',now:'2026-10-15T18:06:00.000Z'}),/indisponível/);assert.deepEqual(reloaded,before);
});

test('restauração recusa situação incompatível entre orçamento e cobrança vinculada',()=>{
 const active=fixture(),q=active.quotes.at(-1),bill=active.bills.find(b=>b.id===q.billId);
 bill.cancelledAt='2026-10-15T18:05:00.000Z';assert.throws(()=>validateBackupState(active),/cobrança.*compatív/i);
 const cancelled=fixture();cancelQuote(cancelled,{operationId:'cancel-parity',quoteId:'quote-parity',expectedVersion:1,reason:'Cancelamento fictício solicitado',date:'2026-10-15',today:'2026-10-15',now:'2026-10-15T18:05:00.000Z'});
 for(const change of [
  s=>delete s.bills.find(b=>b.quoteId==='quote-parity').cancelledAt,
  s=>s.bills.find(b=>b.quoteId==='quote-parity').total++,
  s=>s.quotes.at(-1).cancelDate='2026-02-30',
  s=>s.quotes.at(-1).cancelReason=''
 ]){const damaged=JSON.parse(JSON.stringify(cancelled));change(damaged);assert.throws(()=>validateBackupState(damaged));}
});

test('rascunho cancelado no formato anterior continua restaurável sem fabricar data ou motivo novos',()=>{
 const legacy=fixture(false,false),q=legacy.quotes.at(-1);
 // Formato efetivamente gravado pelo cancelQuote anterior: só status, cancelledAt e decisão no histórico.
 q.status='cancelado';q.cancelledAt='2026-10-15T18:05:00.000Z';q.history.push({version:q.version,status:'cancelado',at:q.cancelledAt,note:'Cancelamento fictício anterior'});
 const restored=JSON.parse(JSON.stringify(legacy)),before=structuredClone(restored);
 assert.doesNotThrow(()=>validateBackupState(restored));assert.deepEqual(restored,before);
 assert.equal(restored.quotes.at(-1).cancelDate,undefined);assert.equal(restored.quotes.at(-1).cancelReason,undefined);
});

test('restauração exige vínculo reverso da cobrança e cancelamento coerente mesmo se billId sumir',()=>{
 const s=fixture();cancelQuote(s,{operationId:'cancel-parity',quoteId:'quote-parity',expectedVersion:1,reason:'Cancelamento fictício solicitado',date:'2026-10-15',today:'2026-10-15',now:'2026-10-15T18:05:00.000Z'});
 for(const change of [
  x=>{delete x.quotes.at(-1).billId;delete x.bills.find(b=>b.quoteId==='quote-parity').cancelledAt;},
  x=>x.bills.find(b=>b.quoteId==='quote-parity').cancelDate='2026-10-14',
  x=>x.bills.find(b=>b.quoteId==='quote-parity').cancelReason='Motivo diferente'
 ]){const damaged=JSON.parse(JSON.stringify(s));change(damaged);assert.throws(()=>validateBackupState(damaged));}
});
