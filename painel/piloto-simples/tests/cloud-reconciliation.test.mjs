import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudStore} from '../cloud-store.mjs';
import {createWorkspaceHandler} from '../../../supabase/functions/app-workspace/handler.mjs';
import {emptyState,hash,stable,WorkspaceError} from '../../../supabase/functions/app-workspace/rules.mjs';
import {testPNG} from '../../../supabase/functions/app-workspace/test-images.mjs';
import {savePatient} from '../patients-domain.mjs';
import {scheduleClinicAppointment} from '../clinic-domain.mjs';
const id=n=>'cccccccc-cccc-4ccc-8ccc-'+String(n).padStart(12,'0'),copy=v=>structuredClone(v),now='2026-10-15T18:00:00.000Z';
const edit=(patientId,changes,operationId)=>state=>{const old=state.patients.find(p=>p.id===patientId);savePatient(state,{...old,...changes},{expectedVersion:old.version,operationId,now,today:'2026-10-15'});};
async function fixture(t){
 const initial=emptyState();initial.revision=1;
 for(const [patientId,name]of [['one','Paciente um'],['two','Paciente dois']])savePatient(initial,{id:patientId,name},{expectedVersion:0,operationId:'create-'+patientId,now,today:'2026-10-15'});
 initial.visits.push({id:'visit',patientId:'one',professionalId:'amj-principal',date:'2026-10-15',status:'rascunho',notes:'Registro inicial',photos:[],maps:{}});
 let row={revision:1,state:initial,state_hash:await hash(stable(initial))},counter=10;
 const operations=new Map(),versions=new Map([[1,copy(row)]]),clients=[];
 const repository={load:async()=>copy(row),photos:async()=>[],operation:async(_clinic,key)=>copy(operations.get(key)||null),version:async(_clinic,revision)=>copy(versions.get(revision)||null),
  commit:async p=>{if(row.revision!==p.p_expected)throw new WorkspaceError('revision_conflict','Revisão mudou.',409);row={revision:p.p_expected+1,state:copy(p.p_state),state_hash:p.p_state_hash,updated_at:now};versions.set(row.revision,copy(row));operations.set(p.p_operation,{operation_id:p.p_operation,kind:'commit',status:'committed',fingerprint:p.p_fingerprint,revision:row.revision});return copy(row);},
  reserve:async p=>{if(row.revision!==p.p_expected)throw new WorkspaceError('revision_conflict','Revisão mudou.',409);throw Error('Unexpected upload in this fixture');}
 };
 const handler=createWorkspaceHandler({repository,now:()=>now,authenticate:async()=>({authMethod:'supabase_auth',role:'owner',aal:'aal2',clinicId:id(1),userId:id(2),sessionId:id(3)}),authorize:async()=>{}});
 function client(){const calls=[],statuses=[],listeners=new Set(),control={drop:false,force:null,hook:null};let invalidated=false;const session={requireReady:async()=>({token:'synthetic'}),assertCurrent:async()=>{if(invalidated)throw Object.assign(Error('Sessão encerrada'),{code:'session_changed'});},subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},invalidate(){invalidated=true;for(const fn of listeners)fn('signed_out');}};
  const store=createCloudStore({session,uuid:()=>id(++counter),onStatus:s=>statuses.push(s),fetchImpl:async(url,init)=>{
   const req=new Request(url,{...init,headers:{...init.headers,origin:'https://anamariajacob.com.br'}}),multipart=(req.headers.get('content-type')||'').startsWith('multipart/'),p=multipart?Object.fromEntries(await req.clone().formData()):await req.clone().json();calls.push(copy(multipart?{acao:p.acao,operation_id:p.operation_id}:p));
   if(control.hook)await control.hook(p);const response=control.force&&p.acao==='commit'?control.force():await handler(req);
   if(control.drop&&p.acao==='commit'&&response.ok){control.drop=false;throw Error('Response lost after commit');}return response;
  }});const result={store,calls,statuses,control,session};clients.push(result);return result;}
 t.after(()=>clients.forEach(c=>c.store.dispose()));const a=client(),b=client();await a.store.load();await b.store.load();return{a,b,client,row:()=>copy(row),operations};
}
async function conflict(f,mutate){await f.a.store.commit(1,edit('one',{notes:'Edição do notebook'},'notebook-edit'));await assert.rejects(f.b.store.commit(1,mutate),{code:'revision_conflict'});}

test('real handler reconciles independent patient edits with preserved histories and a fresh operation only after confirmed rejection',async t=>{
 const f=await fixture(t);await conflict(f,edit('two',{notes:'Edição do celular'},'mobile-edit'));const original=f.b.calls.find(p=>p.acao==='commit');assert.equal(f.b.statuses.at(-1).canReconcilePending,true);
 const saved=await f.b.store.reconcilePending();assert.equal(saved.revision,3);assert.equal(saved.patients[0].notes,'Edição do notebook');assert.equal(saved.patients[1].notes,'Edição do celular');assert.equal(saved.patientHistory.length,4);assert.equal(saved.auditLog.length,2);assert.equal(f.b.store.hasPending(),false);
 const writes=f.b.calls.filter(p=>p.acao==='commit');assert.equal(writes.length,2);assert.notEqual(writes[1].operation_id,original.operation_id);assert.equal(writes[1].expected_revision,2);assert.equal(f.operations.has(original.operation_id),false);assert.equal(f.operations.has(writes[1].operation_id),true);assert.equal(saved.patientHistory.filter(h=>h.operationId==='mobile-edit').length,1);
});
test('same patient conflict never silently combines fields or abandons the pending draft',async t=>{
 const f=await fixture(t);await conflict(f,edit('one',{phone:'31999990000'},'mobile-edit'));await assert.rejects(f.b.store.reconcilePending(),{code:'reconciliation_conflict'});assert.equal(f.b.store.hasPending(),true);assert.equal(f.b.store.hasConflict(),true);assert.equal(f.b.calls.filter(p=>p.acao==='commit').length,1);assert.equal(f.b.getPending,undefined);assert.equal(f.b.store.getReconciliationInfo().canReconcilePending,false);assert.match(f.b.store.getReconciliationInfo().reconciliationBlockedReason,/não foram combinados/);assert.equal(f.row().state.patients[0].phone,'');
});
test('uncertain original result keeps its UUID and cannot be used as a reconciliation prerequisite',async t=>{
 const f=await fixture(t);f.b.control.drop=true;await assert.rejects(f.b.store.commit(1,edit('two',{notes:'Salvo uma vez'},'mobile-edit')),e=>e.uncertain);const original=f.b.calls.find(p=>p.acao==='commit');await assert.rejects(f.b.store.reconcilePending(),{code:'reconciliation_unavailable'});assert.equal(f.b.calls.filter(p=>p.acao==='commit').length,1);const saved=await f.b.store.resolvePending();assert.equal(saved.revision,2);assert.equal(f.b.statuses.at(-1).confirmedOperationId,original.operation_id);
});
test('lost response of reconciled write recovers the new exact UUID without duplicate mutation or history',async t=>{
 const f=await fixture(t);await conflict(f,edit('two',{notes:'Rascunho recuperado'},'mobile-edit'));f.b.control.drop=true;await assert.rejects(f.b.store.reconcilePending(),e=>e.uncertain);const writes=f.b.calls.filter(p=>p.acao==='commit'),newId=writes.at(-1).operation_id;assert.equal(f.row().revision,3);assert.equal(f.b.store.hasPending(),true);assert.equal(f.b.store.getReconciliationInfo().canReconcilePending,false);const saved=await f.b.store.resolvePending();assert.equal(saved.revision,3);assert.equal(saved.patientHistory.filter(h=>h.operationId==='mobile-edit').length,1);assert.equal(f.b.statuses.at(-1).confirmedOperationId,newId);assert.equal(f.b.calls.filter(p=>p.acao==='commit').length,2);
});
test('the real server rejects an appointment collision created by independent IDs after reconciliation',async t=>{
 const f=await fixture(t),slot={date:'2026-10-15',time:'09:00',duration:30,professionalId:'amj-principal',service:'Avaliação fictícia',status:'agendado'};
 await f.a.store.commit(1,s=>scheduleClinicAppointment(s,{...slot,id:'slot-one',patientId:'one'}));await assert.rejects(f.b.store.commit(1,s=>scheduleClinicAppointment(s,{...slot,id:'slot-two',patientId:'two'})),{code:'revision_conflict'});
 await assert.rejects(f.b.store.reconcilePending(),{code:'appointment_invalid'});assert.equal(f.row().revision,2);assert.equal(f.row().state.appointments.length,1);assert.equal(f.b.store.hasPending(),true);assert.equal(f.b.store.hasConflict(),true);assert.equal(f.b.store.getReconciliationInfo().canReconcilePending,false);
});
test('financial collections and uploads remain explicitly unsupported without losing the rejected draft',async t=>{
 const f=await fixture(t);await conflict(f,s=>s.bills.push({id:'unsupported-bill'}));assert.equal(f.b.store.getReconciliationInfo().canReconcilePending,false);await assert.rejects(f.b.store.reconcilePending(),{code:'reconciliation_unsupported'});assert.equal(f.b.store.hasPending(),true);assert.equal(f.b.calls.filter(p=>p.acao==='commit').length,1);
 const photoClient=f.client();await photoClient.store.load();await f.a.store.load();await f.a.store.commit(2,edit('one',{notes:'Nova revisão'},'notebook-next'));
 const original=new Blob([testPNG(1,1)],{type:'image/png'}),sha256=await hash(await original.arrayBuffer());await assert.rejects(photoClient.store.commit(2,s=>{s.visits[0].photos.push({id:'new-photo',sha256,width:1,height:1});s.visits[0].maps['new-photo']={version:0,points:[],history:[]};},{id:'new-photo',original,preview:original}),{code:'revision_conflict'});
 assert.match(photoClient.store.getReconciliationInfo().reconciliationBlockedReason,/fotografia/);await assert.rejects(photoClient.store.reconcilePending(),{code:'reconciliation_unsupported'});assert.equal(photoClient.store.hasPending(),true);
});
test('a malformed conflict envelope or another 409 does not authorize generating a fresh operation',async t=>{
 for(const body of [{codigo:'revision_conflict',erro:'Sem envelope confirmado'},{ok:false,codigo:'operation_reused',erro:'Chave existente'}]){const f=await fixture(t);f.b.control.force=()=>Response.json(body,{status:409});await assert.rejects(f.b.store.commit(1,edit('two',{notes:'Não gravar'},'mobile-edit')));assert.equal(f.b.store.getReconciliationInfo().canReconcilePending,false);await assert.rejects(f.b.store.reconcilePending(),{code:'reconciliation_unavailable'});assert.equal(f.b.calls.filter(p=>p.acao==='commit').length,1);}
});
test('an account invalidated while loading reconciliation never sends its merged payload',async t=>{
 const f=await fixture(t);await conflict(f,edit('two',{notes:'Rascunho privado'},'mobile-edit'));f.b.control.hook=async p=>{if(p.acao==='abrir')f.b.session.invalidate();};await assert.rejects(f.b.store.reconcilePending());assert.equal(f.b.calls.filter(p=>p.acao==='commit').length,1);assert.equal(f.b.store.hasPending(),false);assert.equal(f.row().revision,2);
});
test('a third-device race rejects the first reapplication and can reapply later without lost updates',async t=>{
 const f=await fixture(t);await conflict(f,edit('two',{notes:'Edição móvel preservada'},'mobile-edit'));let moved=false;
 f.b.control.hook=async p=>{if(p.acao==='commit'&&p.expected_revision===2&&!moved){moved=true;await f.a.store.load();await f.a.store.commit(2,s=>s.visits[0].notes='Terceira gravação independente');}};
 await assert.rejects(f.b.store.reconcilePending(),{code:'revision_conflict'});assert.equal(f.b.store.hasPending(),true);assert.equal(f.b.store.getReconciliationInfo().canReconcilePending,true);assert.equal(f.row().revision,3);
 const saved=await f.b.store.reconcilePending();assert.equal(saved.revision,4);assert.equal(saved.visits[0].notes,'Terceira gravação independente');assert.equal(saved.patients[0].notes,'Edição do notebook');assert.equal(saved.patients[1].notes,'Edição móvel preservada');assert.equal(saved.patientHistory.filter(h=>h.operationId==='mobile-edit').length,1);assert.equal(new Set(f.b.calls.filter(p=>p.acao==='commit').map(p=>p.operation_id)).size,3);
});
test('offline reconciliation keeps the rejected original operation and does not issue another write',async t=>{
 const f=await fixture(t);await conflict(f,edit('two',{notes:'Preservar offline'},'mobile-edit'));const original=f.b.calls.find(p=>p.acao==='commit').operation_id;
 f.b.control.hook=async p=>{if(p.acao==='abrir')throw Error('Offline');};await assert.rejects(f.b.store.reconcilePending(),{code:'network_error'});assert.equal(f.b.store.hasPending(),true);assert.equal(f.b.statuses.at(-1).operationId,original);assert.equal(f.b.store.getReconciliationInfo().canReconcilePending,true);assert.equal(f.b.calls.filter(p=>p.acao==='commit').length,1);
 f.b.control.hook=null;assert.equal((await f.b.store.reconcilePending()).revision,3);
});
test('a CPF collision discovered across independent patient edits is blocked before generating a merged write',async t=>{
 const f=await fixture(t);await f.a.store.commit(1,edit('one',{cpf:'52998224725'},'notebook-cpf'));await assert.rejects(f.b.store.commit(1,edit('two',{cpf:'52998224725'},'mobile-cpf')),{code:'revision_conflict'});await assert.rejects(f.b.store.reconcilePending(),{code:'reconciliation_conflict'});assert.equal(f.b.calls.filter(p=>p.acao==='commit').length,1);assert.equal(f.row().state.patients[1].cpf,'');assert.equal(f.b.store.hasPending(),true);
});
