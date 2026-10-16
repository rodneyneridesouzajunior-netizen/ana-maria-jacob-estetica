import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudStore} from '../cloud-store.mjs';
import {createClinicalCompletionService} from '../clinical-completion-service.mjs';
import {createSessionBridge} from '../integration/session.mjs';
import {PUBLIC_BACKEND} from '../integration/public-backend.mjs';
import {createWorkspaceHandler} from '../../../supabase/functions/app-workspace/handler.mjs';
import {hash,stable,WorkspaceError} from '../../../supabase/functions/app-workspace/rules.mjs';
import {testPNG} from '../../../supabase/functions/app-workspace/test-images.mjs';
import {saveProcedure,saveProduct,receiveLot,completeVisit} from '../operations-domain.mjs';
import {savePatient} from '../patients-domain.mjs';
import {receivePayment,reversePayment,createInstallments,saveExpense,payExpense,reverseExpensePayment,cancelExpense,financeReport} from '../finance-domain.mjs';

// Real browser-independent session bridge, cloud store, Edge handler and domain rules.
// Repository IO is a fixture; SQL atomicity is covered separately by migration.test.mjs.
const id=n=>'eeeeeeee-eeee-4eee-8eee-'+String(n).padStart(12,'0');
const CLINIC=id(1),USER=id(2),SESSION=id(3),day='2026-10-15',now=day+'T18:00:00.000Z';
const clone=value=>structuredClone(value),op=(operationId,data={})=>({operationId,data,today:day,now});
const png=()=>new Blob([testPNG(1,1)],{type:'image/png'});
function harness(t,{aal='aal2'}={}){
 let row=null,counter=10,event,level=aal,sdkSession={access_token:'fictional-contract-test-only',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:USER}},serverAllowed=true,dropAction=null;
 const clinicalOperations=new Map(),operations=new Map(),versions=new Map(),photos=new Map(),files=new Map(),requests=[],authorizations=[];
 const auth={getSession:async()=>sdkSession,getNextStep:async()=>({step:sdkSession?(level==='aal2'?'ready':'challenge'):'login',session:sdkSession,aal:{currentLevel:level}}),signOut:async()=>{sdkSession=null;event?.('SIGNED_OUT',null);},client:{auth:{onAuthStateChange(fn){event=fn;return {data:{subscription:{unsubscribe(){event=null;}}}};}}}};
 const bridge=createSessionBridge(auth),repository={
  load:async()=>clone(row),operation:async(_clinic,key)=>clone(operations.get(key)||null),version:async(_clinic,n)=>clone(versions.get(n)||null),photos:async()=>clone([...photos.values()].filter(p=>p.status==='ready')),photo:async(_clinic,key)=>clone(photos.get(key)||null),
  async commit(p){if((row?.revision||0)!==p.p_expected)throw new WorkspaceError('revision_conflict','Revisão mudou.',409);row={revision:p.p_expected+1,state:clone(p.p_state),state_hash:p.p_state_hash,updated_at:now};versions.set(row.revision,clone(row));operations.set(p.p_operation,{operation_id:p.p_operation,kind:'commit',status:'committed',fingerprint:p.p_fingerprint,revision:row.revision});return clone(row);},
  async reserve(p){const existing=photos.get(p.p_photo);if(existing)return clone(existing);const photo={...clone(p.p_metadata),status:'pending'};photos.set(p.p_photo,photo);operations.set(p.p_operation,{operation_id:p.p_operation,kind:'upload',status:'pending',fingerprint:p.p_fingerprint,photo_id:p.p_photo});return clone(photo);},
  async ready(p){const operation=operations.get(p.p_operation),photo=photos.get(operation.photo_id);operation.status='committed';photo.status='ready';return clone(photo);},
  async upload(path,bytes,mime){if(files.has(path))assert.deepEqual(files.get(path).bytes,bytes);files.set(path,{bytes:new Uint8Array(bytes),mime});},
  sign:async path=>PUBLIC_BACKEND.supabaseUrl+'/storage/v1/object/sign/app-workspace-media/'+path+'?token=fictional-test',
 };
 repository.completionContext=async()=>({workspace_revision:row.revision,profile:{id:id(4),professional_id:'amj-principal',user_id:USER,professional_name:'Profissional sintética',professional_snapshot:clone(row.state.clinic.professionals[0]),status:'active',version:1},policy:{id:id(5),status:'active',procedure_id:'review-proc',procedure_version:1,procedure_hash:await hash(stable(row.state.visits[0].procedureSnapshot)),requirements:[]}});
 repository.clinicalLinks=async()=>[];
 repository.completionOperation=async p=>clone(clinicalOperations.get(p.p_operation)||null);
 repository.completeClinical=async p=>{const workspace=await repository.commit(p),signature={id:p.p_operation,patient_id:p.p_patient,visit_id:p.p_visit,actor_id:p.p_actor,workspace_revision:workspace.revision,review_hash:p.p_review_hash,signature_method:'authenticated_session_mfa'};const result={workspace,signature,fingerprint:p.p_fingerprint};clinicalOperations.set(p.p_operation,clone(result));return result;};
 const handler=createWorkspaceHandler({repository,now:()=>now,authenticate:async()=>{if(!serverAllowed)throw Object.assign(Error('Revoked'),{status:403});return{authMethod:'supabase_auth',role:'owner',aal:'aal2',clinicId:CLINIC,userId:USER,sessionId:SESSION};},authorize:async(_req,_ctx,scope)=>{authorizations.push(scope);if(!serverAllowed)throw Object.assign(Error('Revoked'),{status:403});}});
 const fetchImpl=async(url,init)=>{
  if(!init.body){const prefix='/storage/v1/object/sign/app-workspace-media/',path=decodeURIComponent(new URL(url).pathname.slice(prefix.length)),file=files.get(path);assert.ok(file);return new Response(file.bytes,{headers:{'Content-Type':file.mime}});}
  const request=new Request(url,{...init,headers:{...init.headers,origin:'https://anamariajacob.com.br'}}),multipart=request.headers.get('content-type').startsWith('multipart/form-data'),payload=multipart?Object.fromEntries(await request.clone().formData()):await request.clone().json();requests.push({url,init,payload});
  const response=await handler(request);if(payload.acao===dropAction&&response.ok){dropAction=null;throw Error('Dropped after successful actual handler response');}return response;
 };
 const store=createCloudStore({session:bridge,uuid:()=>id(++counter),fetchImpl}),clinical=createClinicalCompletionService({session:bridge,uuidFactory:()=>id(++counter),fetchImpl});
 t.after(()=>{clinical.dispose();store.dispose();bridge.destroy();});
 return {store,clinical,requests,authorizations,files,clinicalOperations,row:()=>clone(row),drop(action){dropAction=action;},serverDeny(){serverAllowed=false;},sdkAal(value){level=value;},operations};
}
function addInitial(s){
 savePatient(s,{id:'review-patient',name:'Paciente fictícia de contrato',cpf:'',phone:'',email:'',birthDate:''},{operationId:'review-patient-op',now,today:day});
 saveProcedure(s,op('review-procedure-op',{id:'review-proc',name:'Avaliação fictícia',price:10001,cost:1000,duration:30,recordMode:'simple'}));
 saveProduct(s,op('review-product-op',{id:'review-product',name:'Material fictício',unit:'mL',unitCost:2000}));
 receiveLot(s,op('review-lot-op',{id:'review-lot',productId:'review-product',code:'TESTE',expiry:'2027-10-15',quantity:10,unitCost:2000}));
 s.visits.push({id:'review-visit',patientId:'review-patient',professionalId:'amj-principal',date:day,service:'Avaliação fictícia',status:'rascunho',notes:'',photos:[],maps:{},procedureId:'review-proc',procedureVersion:1,procedureSnapshot:clone(s.procedures[0]),recordMode:'simple'});
}
test('review contract: opening a fresh private workspace never imports the local demo',async t=>{
 const h=harness(t),value=await h.store.load();assert.equal(value.revision,0);for(const key of ['patients','visits','payments','quotes','requests','bills'])assert.deepEqual(value[key],[]);
 assert.equal(h.row(),null);assert.equal(h.requests.length,1);assert.equal(h.authorizations.length,0);
 await assert.rejects(h.store.restoreSnapshot(0,{state:value,photos:[]}),{code:'restore_unavailable'});
});
test('review contract: AAL1 is blocked by the existing SDK bridge before any cloud request',async t=>{
 const h=harness(t,{aal:'aal1'});await assert.rejects(h.store.load(),{code:'mfa_required'});assert.equal(h.requests.length,0);
});
test('review contract: downgrade before a write cannot bypass auth or fall back to IndexedDB',async t=>{
 const h=harness(t);await h.store.load();h.sdkAal('aal1');await assert.rejects(h.store.commit(0,addInitial),{code:'mfa_required'});assert.equal(h.requests.length,1);assert.equal(h.row(),null);assert.equal(h.store.hasPending(),false);await assert.rejects(h.store.load(),{code:'session_closed'});
});
test('review contract: real client/server completion recovers lost response without double stock or money',async t=>{
 const h=harness(t);await h.store.load();const initial=await h.store.commit(0,addInitial);assert.equal(initial.revision,1);h.drop('concluir_consulta_clinica');
 const review=await h.clinical.prepare({expected_revision:1,patient_id:'review-patient',visit_id:'review-visit',procedure_id:'review-proc',consumptions:[{lotId:'review-lot',quantity:.2,reason:'Teste fictício'}],sessions:1});assert.equal(review.ready,true);
 await assert.rejects(h.clinical.confirm({confirmed:true}),e=>e.uncertain);
 assert.equal(h.row().revision,2);assert.ok(h.clinical.getPending());assert.equal(h.store.hasPending(),false);
 const receipt=await h.clinical.resolve();assert.equal(receipt.signature.actor_id,USER);assert.equal(h.clinicalOperations.size,1);assert.equal(h.clinical.getPending(),null);const recovered=await h.store.load();assert.equal(recovered.revision,2);assert.equal(recovered.stockLots[0].balanceUnits,98000);assert.equal(recovered.stockMovements.filter(x=>x.type==='consumo').length,1);assert.equal(recovered.bills.length,1);assert.equal(recovered.bills[0].total,10001);assert.equal(recovered.bills[0].actualCost,1400);assert.equal(recovered.auditLog.length,2);assert.equal(h.store.hasPending(),false);
 assert.equal(h.requests.filter(r=>r.payload.acao==='commit').length,1);assert.equal(h.requests.filter(r=>r.payload.acao==='concluir_consulta_clinica').length,1);assert.equal(h.authorizations.length,2);
 for(const call of h.requests){assert.equal(call.url,PUBLIC_BACKEND.supabaseUrl+'/functions/v1/app-workspace');assert.equal(call.init.headers.Authorization,'Bearer fictional-contract-test-only');assert.equal(call.init.credentials,'omit');assert.equal(call.init.cache,'no-store');assert.equal(call.init.redirect,'error');}
});
test('review contract: server rejects a forged draft snapshot and accepts a later legitimate edit',async t=>{
 const h=harness(t);await h.store.load();await h.store.commit(0,addInitial);
 await assert.rejects(h.store.commit(1,s=>s.visits[0].procedureSnapshot.cost=0),{code:'procedure_snapshot_immutable'});assert.equal(h.row().revision,1);assert.equal(h.store.hasPending(),false);
 const good=await h.store.commit(1,s=>s.visits[0].notes='Nota fictícia preservada');assert.equal(good.revision,2);assert.equal(good.visits[0].notes,'Nota fictícia preservada');
});
test('review contract: revoked server access prevents persistence and ends private client access',async t=>{
 const h=harness(t);await h.store.load();await h.store.commit(0,addInitial);h.serverDeny();
 await assert.rejects(h.store.commit(1,s=>s.visits[0].notes='Não salvar'));
 assert.equal(h.row().revision,1);assert.equal(h.row().state.visits[0].notes,'');assert.equal(h.store.hasPending(),false);await assert.rejects(h.store.load(),{code:'session_closed'});
});
test('review contract: original and preview survive lost upload receipt and private reread',async t=>{
 const h=harness(t);await h.store.load();await h.store.commit(0,addInitial);const original=png(),preview=png(),sha256=await hash(await original.arrayBuffer());h.drop('upload');
 await assert.rejects(h.store.commit(1,s=>{s.visits[0].photos.push({id:'review-photo',sha256,width:1,height:1,label:'Foto fictícia',phase:'antes'});s.visits[0].maps['review-photo']={version:0,points:[],history:[]};},{id:'review-photo',original,preview}),e=>e.uncertain);
 assert.equal(h.row().revision,1);assert.equal(h.files.size,2);const recovered=await h.store.resolvePending();assert.equal(recovered.revision,2);assert.equal(h.requests.filter(r=>r.payload.acao==='upload').length,1);
 const photo=await h.store.getPhoto('review-photo');assert.equal(await hash(await photo.original.arrayBuffer()),sha256);assert.equal(await hash(await photo.preview.arrayBuffer()),sha256);assert.equal(h.files.size,2);
});
test('review contract: the existing map undo action works without permitting arbitrary history loss',async t=>{
 const h=harness(t);await h.store.load();await h.store.commit(0,addInitial);const original=png(),preview=png(),sha256=await hash(await original.arrayBuffer());
 await h.store.commit(1,s=>{s.visits[0].photos.push({id:'review-photo',sha256,width:1,height:1,label:'Foto fictícia',phase:'antes'});s.visits[0].maps['review-photo']={version:0,points:[],history:[]};},{id:'review-photo',original,preview});
 await h.store.commit(2,s=>{const map=s.visits[0].maps['review-photo'];map.history.push(clone(map.points));map.points.push({id:'review-point',kind:'ponto',x:.5,y:.5,region:'Interface fictícia',product:'',quantity:null,unit:'sem quantidade',lot:'',notes:''});map.version++;});
 const undone=await h.store.commit(3,s=>{const map=s.visits[0].maps['review-photo'];map.points=map.history.pop();map.version++;});
 assert.equal(undone.revision,4);assert.equal(undone.visits[0].maps['review-photo'].version,2);assert.deepEqual(undone.visits[0].maps['review-photo'].points,[]);assert.equal(undone.auditLog.length,4);
 await assert.rejects(h.store.commit(4,s=>{s.visits[0].maps['review-photo']={version:3,points:[],history:[[],[]]};}),{code:'map_version_conflict'});
 assert.equal(h.row().revision,4);
});

test('review contract: partial receipts and reversed expenses retain cents and event dates through cloud replay',async t=>{
 const h=harness(t);await h.store.load();await h.store.commit(0,addInitial);
 const review=await h.clinical.prepare({expected_revision:1,patient_id:'review-patient',visit_id:'review-visit',procedure_id:'review-proc',consumptions:[],sessions:1});assert.equal(review.ready,true);await h.clinical.confirm({confirmed:true});let state=await h.store.load();
 const billId=state.bills[0].id;
 state=await h.store.commit(state.revision,s=>createInstallments(s,{billId,count:3,firstDueDate:'2026-10-31'}));
 assert.deepEqual(state.installments.map(x=>x.amount),[3334,3334,3333]);
 assert.deepEqual(state.installments.map(x=>x.dueDate),['2026-10-31','2026-11-30','2026-12-31']);
 const installmentId=state.installments[0].id;
 state=await h.store.commit(state.revision,s=>{
  receivePayment(s,{id:'review-receipt',operationId:'review-receipt-op',billId,installmentId,amount:1333,date:'2026-10-15',method:'Pix'});
  saveExpense(s,{id:'review-expense',description:'Despesa fictícia de contrato',amount:3750,dueDate:'2026-10-15',category:'outro'},{operationId:'review-expense-op',date:day});
 });
 h.drop('commit');
 await assert.rejects(h.store.commit(state.revision,s=>payExpense(s,{id:'review-expense-payment',operationId:'review-expense-payment-op',expenseId:'review-expense',amount:3750,date:'2026-10-15',method:'Pix'})),e=>e.uncertain);
 state=await h.store.resolvePending();assert.equal(state.expensePayments.length,1);assert.equal(state.financeHistory.filter(x=>x.action==='pagamento_despesa').length,1);
 const before=financeReport(state,'2026-10');assert.equal(before.received,1333);assert.equal(before.paid,3750);assert.equal(before.cash,-2417);assert.equal(before.outstanding,8668);
 state=await h.store.commit(state.revision,s=>{
  reversePayment(s,{paymentId:'review-receipt',reason:'Teste de devolução no mês seguinte',date:'2026-11-02'});
  reverseExpensePayment(s,{paymentId:'review-expense-payment',reason:'Teste de estorno no mês seguinte',date:'2026-11-02',operationId:'review-expense-reversal-op'});
 });
 const october=financeReport(state,'2026-10'),november=financeReport(state,'2026-11');
 assert.equal(october.received,1333);assert.equal(october.paid,3750);assert.equal(october.cash,-2417);
 assert.equal(november.received,-1333);assert.equal(november.paid,-3750);assert.equal(november.cash,2417);
 assert.equal(october.outstanding,10001);assert.equal(october.expenseOutstanding,3750);
 state=await h.store.commit(state.revision,s=>saveExpense(s,{...s.expenses[0],amount:4001},{operationId:'review-expense-correction-op',expectedVersion:1,date:'2026-11-02',reason:'Correção fictícia após devolução'}));
 assert.equal(state.expenses[0].version,2);assert.equal(state.financeHistory.find(x=>x.action==='correcao_despesa').previous.amount,3750);
 state=await h.store.commit(state.revision,s=>cancelExpense(s,{expenseId:'review-expense',operationId:'review-expense-cancel-op',expectedVersion:2,date:'2026-11-02',reason:'Cancelamento fictício após correção'}));
 const reloaded=await h.store.load();assert.equal(reloaded.revision,state.revision);assert.equal(reloaded.expenses[0].version,3);
 assert.equal(reloaded.payments.length,1);assert.equal(reloaded.paymentReversals.length,1);assert.equal(reloaded.expensePayments.length,1);assert.equal(reloaded.expensePaymentReversals.length,1);
 assert.equal(financeReport(reloaded,'2026-11').cash,2417);assert.equal(financeReport(reloaded,'2026-11').expenseOutstanding,0);
});

test('review contract: generic client commit cannot conclude a visit or inject trusted clinical authorization',async t=>{
 const h=harness(t);await h.store.load();await h.store.commit(0,addInitial);
 await assert.rejects(h.store.commit(1,s=>completeVisit(s,{...op('plain-forged-conclusion'),visitId:'review-visit',procedureId:'review-proc',consumptions:[]})),{code:'clinical_signature_unavailable'});
 await assert.rejects(h.store.commit(1,s=>{completeVisit(s,{...op('forged-conclusion'),visitId:'review-visit',procedureId:'review-proc',consumptions:[]});s.clinicalCompletions=['review-visit'];}),e=>['clinical_signature_unavailable','unknown_state_field'].includes(e.code));
 assert.equal(h.row().revision,1);assert.equal(h.row().state.visits[0].status,'rascunho');assert.equal(h.row().state.bills.length,0);assert.equal(h.clinicalOperations.size,0);
});
