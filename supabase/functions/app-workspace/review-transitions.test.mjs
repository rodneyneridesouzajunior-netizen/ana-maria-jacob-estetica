import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,validateTransition as transition} from './rules.mjs';
import {saveProcedure,saveProduct,receiveLot,completeVisit,saveQuote} from '../_shared/app-workspace-domain/operations-domain.mjs';
import {saveComparisonRecord,comparisonRecordDraft} from '../../../painel/piloto-simples/comparison-library.mjs';
import {comparisonPhotos} from '../../../painel/piloto-simples/compare.mjs';

const day='2026-10-15',now=day+'T18:00:00.000Z';
const validateTransition=(old,next,options={})=>transition(old,next,{now,...options});
const clinicalCompletion={clinicalCompletions:new Set(['review-visit'])};
const op=(operationId,data={})=>({operationId,data,today:day,now});
function fixture(){
 const state=emptyState();
 state.patients.push({id:'review-patient',name:'Paciente fictícia de revisão'});
 state.visits.push({id:'review-visit',patientId:'review-patient',date:day,service:'Avaliação',status:'rascunho',notes:'',photos:[],maps:{}});
 saveProcedure(state,op('review-procedure',{id:'review-proc',name:'Avaliação fictícia',price:10000,cost:1000,duration:30,recordMode:'simple'}));
 saveProduct(state,op('review-product',{id:'review-product',name:'Material fictício',unit:'mL',unitCost:2000}));
 receiveLot(state,op('review-lot',{id:'review-lot',productId:'review-product',code:'TESTE',expiry:'2027-10-15',quantity:10,unitCost:2000}));
 Object.assign(state.visits[0],{procedureId:'review-proc',procedureVersion:1,procedureSnapshot:structuredClone(state.procedures[0]),recordMode:'simple'});
 return state;
}
function completed(old){const next=structuredClone(old);completeVisit(next,{...op('review-complete'),visitId:'review-visit',procedureId:'review-proc',consumptions:[{lotId:'review-lot',quantity:.2,reason:'Material fictício'}]});return next;}

test('review: legitimate completion keeps exact cents, original snapshot and stock deduction',()=>{
 const old=fixture(),next=completed(old);
 assert.equal(next.visits[0].actualCost,1400);
 assert.equal(next.stockLots[0].balanceUnits,98000);
 assert.equal(next.bills[0].total,10000);
 assert.doesNotThrow(()=>validateTransition(old,next,clinicalCompletion));
});
test('review: completion cannot keep consumed inventory available',()=>{
 const old=fixture(),next=completed(old);
 next.stockLots=structuredClone(old.stockLots);next.stockMovements=structuredClone(old.stockMovements);
 assert.throws(()=>validateTransition(old,next,clinicalCompletion),'Consumed stock without an inventory movement must be rejected.');
});
test('review: completion cannot fabricate price independently of selected procedure',()=>{
 const old=fixture(),next=completed(old);next.bills[0].total=1;
 assert.throws(()=>validateTransition(old,next,clinicalCompletion),'A one-cent bill cannot replace the selected procedure price.');
});
test('review: matching totals do not authorize rewriting the selected procedure snapshot',()=>{
 const old=fixture(),next=completed(old),v=next.visits[0];
 v.procedureSnapshot.cost=v.completionSnapshot.procedure.cost=0;
 v.actualCost=v.completionSnapshot.actualCost=400;
 next.bills[0].cost=next.bills[0].actualCost=400;
 assert.throws(()=>validateTransition(old,next,clinicalCompletion),'Recalculating forged totals must not make a modified procedure snapshot valid.');
});
test('review: consumption cost must come from its immutable lot, not the client',()=>{
 const old=fixture(),next=completed(old),v=next.visits[0];
 v.consumptions[0].unitCost=v.consumptions[0].cost=0;
 v.completionSnapshot.consumptions=structuredClone(v.consumptions);
 v.actualCost=v.completionSnapshot.actualCost=1000;
 next.bills[0].cost=next.bills[0].actualCost=1000;
 assert.throws(()=>validateTransition(old,next,clinicalCompletion),'The lot costs 2,000 cents per mL even when the client sends zero.');
});
test('review: snapshot cannot be forged in a prior draft commit to bypass completion checks',()=>{
 const old=fixture(),next=structuredClone(old);next.visits[0].procedureSnapshot.cost=0;
 assert.throws(()=>validateTransition(old,next),'Draft changes must preserve the already selected procedure version.');
});
test('review: an initial visit snapshot must match a real catalog version',()=>{
 const old=emptyState(),next=fixture();next.visits[0].procedureSnapshot.cost=0;
 assert.throws(()=>validateTransition(old,next),'A first commit cannot create a self-attested clinical price/cost snapshot.');
});
test('review: a completed visit cannot acquire a duplicate second bill',()=>{
 const old=fixture(),next=completed(old);next.bills.push({...next.bills[0],id:'review-duplicate-bill',total:1});
 assert.throws(()=>validateTransition(old,next,clinicalCompletion),'The bill-to-visit link must be reciprocal and unique.');
});
test('review: a backdated client completion cannot consume a currently expired lot',()=>{
 const old=fixture(),historicalDay='2026-10-13';old.visits[0].date=historicalDay;old.stockLots[0].expiry='2026-10-14';
 const next=structuredClone(old);completeVisit(next,{...op('review-backdated-complete'),today:historicalDay,now:historicalDay+'T18:00:00.000Z',visitId:'review-visit',procedureId:'review-proc',consumptions:[{lotId:'review-lot',quantity:.2,reason:'Material fictício'}]});
 assert.throws(()=>validateTransition(old,next,{...clinicalCompletion,now}),'Expiry of a new inventory consumption must be checked against the server date.');
});
test('review: draft quote edits must preserve the previous commercial version',()=>{
 const old=fixture(),data={id:'review-quote',patientId:'review-patient',title:'Original',validUntil:'',items:[{id:'review-line',procedureId:'review-proc',sessions:1,unitPrice:10000,unitCost:1000}]};
 saveQuote(old,op('review-quote-create',data));const changed=structuredClone(old);changed.quotes[0].title='Rewritten without history';
 assert.throws(()=>validateTransition(old,changed),'The current quote is not disposable merely because it is a draft.');
 const valid=structuredClone(old);saveQuote(valid,op('review-quote-edit',{...data,expectedVersion:1,title:'Nova versão'}));assert.doesNotThrow(()=>validateTransition(old,valid));assert.equal(valid.quotes[0].version,2);
});
test('review: comparison edits must archive the exact previous selection and metadata',()=>{
 const old=fixture(),sha256='a'.repeat(64);old.visits[0].photos.push({id:'review-photo',sha256,width:1,height:1});
 const photos=[{id:'review-photo',patient_id:'review-patient',visit_id:'review-visit',status:'ready',sha256,width:1,height:1}],key=comparisonPhotos(old,'review-patient')[0].key;
 saveComparisonRecord(old,{id:'review-comparison',patientId:'review-patient',title:'Original',area:'',notes:'',beforeDate:day,afterDate:'',beforePhotos:[key],afterPhotos:[],before:key,after:'',mode:'side',split:50,format:'png'},{operationId:'review-comparison-create',now});
 const changed=structuredClone(old);changed.comparisons[0].title='Rewritten without history';assert.throws(()=>validateTransition(old,changed,{photos}));
 const valid=structuredClone(old);saveComparisonRecord(valid,{...comparisonRecordDraft(valid,'review-patient',valid.comparisons[0]),title:'Nova versão'},{operationId:'review-comparison-edit',expectedVersion:1,now});assert.doesNotThrow(()=>validateTransition(old,valid,{photos}));assert.equal(valid.comparisons[0].version,2);
});
test('review: an existing expected return can be cancelled but cannot disappear',()=>{
 const initial=fixture();Object.assign(initial.procedures[0],{returnDays:15,returnInterval:15});initial.visits[0].procedureSnapshot=structuredClone(initial.procedures[0]);
 const old=completed(initial);assert.equal(old.expectedReturns.length,1);
 const removed=structuredClone(old);removed.expectedReturns=[];assert.throws(()=>validateTransition(old,removed),'Use a preserved cancelled return instead of erasing the pending return.');
 const cancelled=structuredClone(old);cancelled.expectedReturns[0].status='cancelado';assert.doesNotThrow(()=>validateTransition(old,cancelled));
});

test('review: an otherwise valid completion requires the private server authorization set',()=>{const old=fixture(),next=completed(old);assert.throws(()=>validateTransition(old,next),{code:'clinical_signature_unavailable'});assert.throws(()=>validateTransition(old,next,{clinicalCompletions:['review-visit']}));assert.doesNotThrow(()=>validateTransition(old,next,clinicalCompletion));});
