import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,validateTransition,hash,stable} from './rules.mjs';
import {createClinicalCompletion,CLINICAL_DECLARATION_VERSION} from './clinical-completion.mjs';
import {saveProcedure,saveProduct,receiveLot,saveQuote,approveQuote,completeVisit,deliverQuoteProduct,quoteExecutionCosts} from '../_shared/app-workspace-domain/operations-domain.mjs';
import {saveTemplate} from '../_shared/app-workspace-domain/documents-domain.mjs';
import {moveToRecycleBin,restoreRecycleEntry,activeWorkspace,mergeActiveWorkspace} from '../_shared/app-workspace-domain/recycle-bin.mjs';
import {validateBackupState} from '../_shared/app-workspace-domain/backup.mjs';

const today='2026-10-18',created='2026-10-18T14:00:00.000Z',removed='2026-10-18T14:30:00.000Z',now='2026-10-18T15:00:00.000Z',recovered='2026-10-18T16:00:00.000Z';
const op=(operationId,data={})=>({operationId,data,today,now:created});
const uuid=n=>`${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;
function fixture(){
 const s=emptyState();s.revision=1;s.patients.push({id:'patient',name:'Pessoa Fictícia',cpf:'52998224725',birthDate:'1990-01-01'});
 saveTemplate(s,{id:'ana',kind:'anamnese',title:'Ficha sintética',body:'Somente teste isolado.',questions:[]});
 for(const [id,price,cost]of [['a',10000,1000],['b',15000,2000]])saveProcedure(s,op('procedure-'+id,{id,name:'Procedimento '+id,price,cost,duration:30,requiredDocumentIds:['ana']}));
 saveProduct(s,op('product',{id:'product',name:'Produto fictício',unit:'mL',unitCost:1000}));
 receiveLot(s,op('entry',{id:'lot',productId:'product',code:'TESTE',expiry:'2027-01-01',quantity:10,unitCost:2000}));
 const points=s.procedures.map((p,index)=>({id:'point'+index,kind:'ponto',x:.5,y:.5,region:'Fictícia',quantity:.1,unit:'mL',product:'Produto fictício',procedureId:p.id,procedureVersion:p.version,procedureSnapshot:structuredClone(p)}));
 s.visits.push({id:'visit',patientId:'patient',professionalId:'amj-principal',date:today,status:'rascunho',service:'Procedimento a',notes:'Sintético',photos:[{id:'photo',sha256:'a'.repeat(64),width:100,height:100}],maps:{photo:{version:1,history:[[]],points}},procedureId:'a',procedureVersion:1,procedureSnapshot:structuredClone(s.procedures[0]),recordMode:s.procedures[0].recordMode});
 const photos=[{id:'photo',status:'ready',patient_id:'patient',visit_id:'visit',sha256:'a'.repeat(64),width:100,height:100}];
 return {s,photos};
}
function finish(s,{quoteId='',operationId='completion',visitId='visit'}={}){
 const active=activeWorkspace(s),v=active.visits.find(x=>x.id===visitId),consumptions=Object.entries(v.maps).flatMap(([photoId,m])=>m.points.map(p=>({photoId,pointId:p.id,lotId:'lot',quantity:p.quantity})));
 completeVisit(active,{operationId,visitId,procedureId:'a',consumptions,quoteId,...(quoteId?{quoteItems:[{itemId:'item-a',sessions:1}]}:{}),today,now},{documentCheck:()=>true});
 const next=structuredClone(s);mergeActiveWorkspace(next,active);return next;
}
for(const type of ['points','photos'])test(`recycle execution: hidden ${type} do not generate consumption/procedures; later recovery preserves completion`,()=>{
 const {s,photos}=fixture(),original=structuredClone(s.visits[0]);
 moveToRecycleBin(s,{type,id:type==='points'?'point1':'photo',parentId:'visit',...(type==='points'?{photoId:'photo'}:{})},{operationId:'delete-'+type,now:removed});
 const next=finish(s);assert.doesNotThrow(()=>validateTransition(s,next,{photos,now,clinicalCompletions:new Set(['visit'])}));
 const completed=next.visits[0];assert.deepEqual(completed.maps,original.maps);assert.deepEqual(completed.photos,original.photos);assert.equal(completed.procedureExecutions.length,1);assert.equal(completed.consumptions.length,type==='points'?1:0);assert.equal(completed.actualCost,type==='points'?1200:1000);
 const snapshot=structuredClone(completed.completionSnapshot),restored=JSON.parse(JSON.stringify(next));restoreRecycleEntry(restored,'delete-'+type,{now:recovered});
 assert.doesNotThrow(()=>validateTransition(next,restored,{photos,now:recovered}));assert.doesNotThrow(()=>validateBackupState(restored));assert.deepEqual(restored.visits[0].completionSnapshot,snapshot);assert.equal(activeWorkspace(restored).visits[0].maps.photo.points.length,2);
});
test('recycle execution: generic commit cannot attest a filtered completion or rewrite a hidden point',()=>{
 const {s,photos}=fixture();moveToRecycleBin(s,{type:'points',id:'point1',parentId:'visit',photoId:'photo'},{operationId:'delete-point',now:removed});
 const next=finish(s);assert.throws(()=>validateTransition(s,next,{photos,now}),e=>e.code==='clinical_signature_unavailable');
 const forged=structuredClone(next);forged.visits[0].maps.photo.points[1].quantity=.5;assert.throws(()=>validateTransition(s,forged,{photos,now,clinicalCompletions:new Set(['visit'])}),e=>e.code==='recycle_transition_invalid');
});
test('recycle execution: backup does not accept unexecuted points omitted without a matching historical archive',()=>{
 const {s}=fixture();moveToRecycleBin(s,{type:'points',id:'point1',parentId:'visit',photoId:'photo'},{operationId:'delete-point',now:removed});
 const next=finish(s);delete next.recycleBin;assert.throws(()=>validateBackupState(next),/versão preservada|divergem/);
});
function quoted({procedure=false}={}){
 const {s,photos}=fixture();s.visits[0].photos=[];s.visits[0].maps={};
 saveQuote(s,op('quote',{id:'q',patientId:'patient',title:'Proposta sintética',items:[procedure?{id:'item-a',procedureId:'a',sessions:1,unitPrice:10000,unitCost:1000}:{id:'item-product',type:'product',productId:'product',quantity:1,unitPrice:5000,unitCost:1000}]}));
 approveQuote(s,{...op('approval'),quoteId:'q',expectedVersion:1,note:'Teste sintético'});return {s,photos};
}
function deliver(s,operationId){return deliverQuoteProduct(s,{operationId,quoteId:'q',itemId:'item-product',lotId:'lot',quantity:1,unit:'mL',expectedQuoteVersion:1,expectedLotVersion:s.stockLots[0].version,date:today,reason:'Entrega sintética conferida',today,now});}
test('recycle execution: hidden delivery can be replaced without losing stock history; recovery cannot overdeliver',()=>{
 const {s}=quoted();deliver(s,'delivery');const beforeDelete=structuredClone(s);moveToRecycleBin(s,{type:'quoteProductDeliveries',id:'delivery'},{operationId:'delete-delivery',now});
 assert.doesNotThrow(()=>validateTransition(beforeDelete,s,{now}));assert.equal(activeWorkspace(s).bills[0].actualCost,0);assert.equal(s.stockLots[0].balanceUnits,90000);
 const active=activeWorkspace(s);deliver(active,'replacement');const next=structuredClone(s);mergeActiveWorkspace(next,active);
 assert.doesNotThrow(()=>validateTransition(s,next,{now}));assert.equal(next.quoteProductDeliveries.length,2);assert.equal(next.stockLots[0].balanceUnits,80000);assert.equal(activeWorkspace(next).quoteProductDeliveries.length,1);assert.equal(quoteExecutionCosts(activeWorkspace(next),'q').actualCost,2000);
 const restored=structuredClone(next);restoreRecycleEntry(restored,'delete-delivery',{now:recovered});assert.throws(()=>validateTransition(next,restored,{now:recovered}),/Saldo a entregar|quantidade|Quantidade/);
 const forged=structuredClone(next);forged.bills[0].actualCost=0;forged.bills[0].cost=0;assert.throws(()=>validateTransition(s,forged,{now}));
});
test('recycle execution: hidden quoted visit releases session capacity while originals and physical usage remain',()=>{
 let {s,photos}=quoted({procedure:true});s=finish(s,{quoteId:'q'});const beforeDelete=structuredClone(s);moveToRecycleBin(s,{type:'visits',id:'visit'},{operationId:'delete-visit',now:recovered});
 assert.doesNotThrow(()=>validateTransition(beforeDelete,s,{photos,now:recovered}));const active=activeWorkspace(s);assert.equal(active.quoteSessionUses.length,0);assert.equal(active.bills[0].actualCost,0);
 const draft=structuredClone(beforeDelete.visits[0]);for(const key of ['lockedAt','completedAt','completionOperationId','billId','quoteId','consumptions','procedureExecutions','actualCost','addenda','completionSnapshot'])delete draft[key];draft.id='replacement-visit';draft.status='rascunho';active.visits.push(draft);
 const next=structuredClone(s);mergeActiveWorkspace(next,active);const completed=finish(next,{quoteId:'q',operationId:'replacement-completion',visitId:draft.id});
 assert.doesNotThrow(()=>validateTransition(next,completed,{photos,now,clinicalCompletions:new Set([draft.id])}));assert.equal(completed.quoteSessionUses.length,2);assert.doesNotThrow(()=>validateBackupState(completed));
 const restore=structuredClone(completed);restoreRecycleEntry(restore,'delete-visit',{now:'2026-10-18T17:00:00.000Z'});assert.throws(()=>validateTransition(completed,restore,{photos,now:'2026-10-18T17:00:00.000Z'}),/Sessões|sessões/);
});
test('recycle execution: an unrelated archive cannot hide corruption of delivery bill costs in backup',()=>{
 const {s}=quoted();deliver(s,'delivery');moveToRecycleBin(s,{type:'procedures',id:'b'},{operationId:'unrelated',now});s.bills[0].cost++;assert.throws(()=>validateBackupState(s),/Custo da cobrança/);
});
async function clinicalFixture(type){
 const {s,photos}=fixture();moveToRecycleBin(s,{type,id:type==='points'?'point1':'photo',parentId:'visit',...(type==='points'?{photoId:'photo'}:{})},{operationId:'delete-selected',now:removed});
 const row={state:s,revision:1,state_hash:await hash(stable(s))},profile={id:uuid('4'),professional_id:'amj-principal',user_id:uuid('2'),professional_snapshot:structuredClone(s.clinic.professionals[0]),status:'active'},policy={id:uuid('5'),procedure_id:'a',procedure_version:1,procedure_hash:await hash(stable(s.procedures[0])),requirements:[{template_id:'ana',source_type:'anamnese'}],status:'active'};
 const source={source_kind:'anamnese',source_id:uuid('6'),type:'anamnese',status:'recebido',source_version:'1',source_hash:'a'.repeat(64),signature_sha256:'b'.repeat(64),pdf_sha256:'c'.repeat(64),registry_sha256:'d'.repeat(64),source_fingerprint:'e'.repeat(64),identity:{name:'Pessoa Fictícia',cpf:'52998224725',birth_date:'1990-01-01'},storage_valid:true,archived:false,withdrawn:false},saved=[],authorizations=[];
 const repository={load:async()=>row,photos:async()=>photos,completionContext:async()=>({workspace_revision:1,profile,policy}),clinicalLinks:async()=>[{id:uuid('7'),source_kind:source.source_kind,source_id:source.source_id,source_fingerprint:source.source_fingerprint,source_snapshot:{type:'anamnese'},available:true,current_identity_matches:true,status:'vinculado_recebido',linked_at:created}],clinicalSource:async()=>source,verifyClinicalObject:async()=>{},completionOperation:async()=>null,completeClinical:async a=>{saved.push(a);return {workspace:{state:a.p_state,revision:a.p_state.revision,state_hash:a.p_state_hash},signature:{id:a.p_operation}};}};
 const handle=createClinicalCompletion({repository,authorize:async(...args)=>authorizations.push(args),validateTransition,now:()=>now}),ctx={clinicId:uuid('1'),userId:uuid('2'),sessionId:uuid('3')},payload={acao:'preparar_conclusao_clinica',operation_id:uuid('8'),expected_revision:1,patient_id:'patient',visit_id:'visit',procedure_id:'a',consumptions:type==='points'?[{photoId:'photo',pointId:'point0',lotId:'lot',quantity:.1}]:[]};
 return {s,photos,handle,ctx,payload,saved,authorizations};
}
for(const type of ['points','photos'])test(`clinical route: excluded ${type} stay out of signed execution and source requirements`,async()=>{
 const f=await clinicalFixture(type),before=structuredClone(f.s),{review}=await f.handle(f.payload,f.ctx,{});assert.equal(review.ready,true,JSON.stringify(review.blockers));assert.equal(review.summary.procedure_executions.length,1);assert.equal(f.saved.length,0);assert.deepEqual(f.s,before);
 const result=await f.handle({...f.payload,acao:'concluir_consulta_clinica',confirmed:true,review_hash:review.review_hash,declaration_version:CLINICAL_DECLARATION_VERSION},f.ctx,{});assert.equal(f.authorizations.length,1);assert.equal(f.saved.length,1);assert.equal(result.workspace.state.visits[0].procedureExecutions.length,1);assert.deepEqual(result.workspace.state.visits[0].maps,before.visits[0].maps);
});
test('clinical route: a hidden patient/visit cannot be completed through a stale request',async()=>{
 const f=await clinicalFixture('points');moveToRecycleBin(f.s,{type:'patients',id:'patient'},{operationId:'delete-patient',now:removed});await assert.rejects(f.handle(f.payload,f.ctx,{}),e=>e.code==='clinical_visit_missing');assert.equal(f.saved.length,0);
});
