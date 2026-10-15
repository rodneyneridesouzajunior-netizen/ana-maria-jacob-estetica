import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createClinicalBridgeService} from '../clinical-bridge-service.mjs';
import {mountClinicalBridge} from '../clinical-bridge-ui.mjs';
import {IntegrationError} from '../integration/errors.mjs';
const require=createRequire(new URL('../../../../../skinpro-analise/test-tools/package.json',import.meta.url));
const {JSDOM}=require('jsdom');

const uuid=n=>`${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;
const envelope={ok:true,auth_method:'supabase_auth',role:'owner',clinic_id:uuid('1')};
const selection=()=>({expected_revision:7,patient_id:'patient',visit_id:'visit',source_kind:'anamnese',source_id:uuid('4'),expected_source_fingerprint:'a'.repeat(64),confirmed_identity:true,reason:'Identidade fictícia conferida no teste'});
const link=p=>({id:p.operation_id,patient_id:p.patient_id,visit_id:p.visit_id,source_kind:p.source_kind,source_id:p.source_id,source_fingerprint:p.expected_source_fingerprint,status:'vinculado_recebido',clinical_authorization:false});
const receipt=p=>({...envelope,link:link(p),workspace_revision:p.expected_revision,operation:{id:p.operation_id,kind:'document_link',status:'committed'}});
function fixture(t,respond){
 let closed=false,sequence=0;const listeners=new Set(),requests=[];
 const session={async requireReady(){if(closed)throw new IntegrationError('session_closed','Sessão encerrada.');return {token:'synthetic-session',userId:'synthetic-user',revision:1};},async assertCurrent(){if(closed)throw new IntegrationError('session_closed','Sessão encerrada.');},subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},invalidate(){closed=true;for(const fn of listeners)fn('SIGNED_OUT');}};
 const service=createClinicalBridgeService({session,uuidFactory:()=>uuid(String(++sequence+5)),fetchImpl:async(url,opts)=>{const p=JSON.parse(opts.body);requests.push(p);return respond(p,requests.length,opts);}});
 t.after(()=>service.dispose());return{service,session,requests};
}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const settle=async predicate=>{for(let i=0;i<60;i++){if(predicate())return;await new Promise(r=>setImmediate(r));}assert.fail('Expected UI state was not reached.');};
function uiFixture(t,respond){
 const dom=new JSDOM('<main id="host"></main>',{url:'https://anamariajacob.com.br/app/connected.html#originais/patient/visit'});
 const original={...link({...selection(),operation_id:uuid('6')}),key:'anamnese:'+uuid('4'),title:'Ficha original fictícia',identity:{name:'PRIVATE-FICTITIOUS-PATIENT',cpf_masked:'•••••••••25'},status:'recebido',received_at:'2026-10-15T18:00:00Z',source_fingerprint:'a'.repeat(64),pdf_sha256:'b'.repeat(64),eligible_for_link:true,blockers:[],clinical_authorization:false};
 const f=fixture(t,p=>p.acao==='listar_documentos_originais'?Response.json({...envelope,documents:[original],pagination:{limit:25,offset:0,has_more:false},capabilities:{link_received:true}}):p.acao==='listar_vinculos_documentos'?Response.json({...envelope,links:[]}):respond(p));
 const context={patientId:'patient',visitId:'visit',patientName:'PRIVATE-FICTITIOUS-PATIENT',visitLabel:'Consulta fictícia',revision:7,locked:false,cpfMasked:'•••••••••25'};
 const host=dom.window.document.getElementById('host'),handle=mountClinicalBridge(host,{service:f.service,getContext:()=>context,reloadContext:async()=>{context.revision=8;},notify:()=>{},confirmDiscard:()=>true});
 t.after(()=>{handle.dispose();dom.window.close();});
 const edit=()=>{host.querySelector('[data-cb="link"]').click();const form=host.querySelector('[data-cb-link-form]');form.elements.reason.value='PRIVATE-LINK-REASON';form.elements.confirmed.checked=true;form.dispatchEvent(new dom.window.Event('input',{bubbles:true}));return form;};
 const submit=form=>form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
 return{...f,dom,host,handle,context,edit,submit};
}

test('bridge adversarial: lost response after commit retains exact payload/UUID, and retry confirms without creating a new operation',async t=>{
 let persisted;
 const f=fixture(t,p=>{if(!persisted){persisted=structuredClone(p);throw TypeError('Simulated lost response after commit');}assert.deepEqual(p,persisted);return Response.json(receipt(p));});
 const input=selection();await assert.rejects(f.service.linkDocument(input));input.reason='Caller changed this object';
 const {acao,...sent}=persisted,pending=f.service.getPendingLink();assert.deepEqual(pending.payload,sent);assert.equal(pending.rejected,false);
 pending.payload.reason='Cannot mutate internal pending operation';
 assert.equal(f.service.getPendingLink().payload.reason,selection().reason);
 const success=await f.service.retryLink();assert.equal(success.operation.id,persisted.operation_id);assert.equal(f.service.getPendingLink(),null);
 assert.equal(f.requests.length,2);assert.deepEqual(f.requests[1],f.requests[0]);
});

test('bridge adversarial: absent operation is not proof of failure and cannot release a second submission',async t=>{
 const f=fixture(t,p=>{if(p.acao==='status_vinculo_documento')return Response.json({...envelope,operation:null});throw TypeError('Connection lost');});
 await assert.rejects(f.service.linkDocument(selection()));const retained=f.service.getPendingLink();
 assert.equal((await f.service.resolveLink()).pending,true);assert.deepEqual(f.service.getPendingLink(),retained);
 await assert.rejects(async()=>f.service.discardRejectedLink());
 await assert.rejects(async()=>f.service.linkDocument({...selection(),reason:'Different submission'}));assert.equal(f.requests.filter(p=>p.acao==='vincular_documento').length,1);
});

test('bridge adversarial: explicit 409 preserves selected source and reason until deliberate rejection discard',async t=>{
 const f=fixture(t,()=>Response.json({ok:false,codigo:'revision_conflict',erro:'changed'},{status:409}));
 await assert.rejects(f.service.linkDocument(selection()));const pending=f.service.getPendingLink();
 assert.equal(pending.rejected,true);assert.equal(pending.payload.reason,selection().reason);assert.equal(pending.payload.expected_revision,7);
 assert.equal(pending.payload.source_id,selection().source_id);f.service.discardRejectedLink();assert.equal(f.service.getPendingLink(),null);
});

test('bridge adversarial: server error remains uncertain, while exact status receipt recovers the original binding',async t=>{
 let original;
 const f=fixture(t,p=>{if(p.acao==='vincular_documento'){original=p;return Response.json({ok:false,codigo:'backend_unavailable'},{status:503});}return Response.json({...envelope,operation:{id:original.operation_id,kind:'document_link',status:'committed',result:{link:link(original),workspace_revision:7}}});});
 await assert.rejects(f.service.linkDocument(selection()));assert.equal(f.service.getPendingLink().rejected,false);
 await assert.rejects(async()=>f.service.discardRejectedLink());await f.service.resolveLink();assert.equal(f.service.getPendingLink(),null);
 assert.deepEqual(f.requests.map(p=>p.acao),['vincular_documento','status_vinculo_documento']);
});

test('bridge adversarial: a receipt for another patient, source fingerprint or revision cannot confirm this submission',async t=>{
 for(const alter of [r=>r.link.patient_id='foreign',r=>r.link.source_fingerprint='b'.repeat(64),r=>r.workspace_revision=8,r=>r.operation.id=uuid('9'),r=>r.link.clinical_authorization=true]){
  const f=fixture(t,p=>{const r=receipt(p);alter(r);return Response.json(r);});
  await assert.rejects(f.service.linkDocument(selection()));assert.ok(f.service.getPendingLink());assert.equal(f.service.getPendingLink().rejected,false);
 }
});

test('bridge adversarial: sign-out during a write clears retained data and discards the late committed receipt',async t=>{
 const gate=deferred(),entered=deferred();let original;
 const f=fixture(t,async p=>{original=p;entered.resolve();await gate.promise;return Response.json(receipt(p));});
 const write=f.service.linkDocument(selection());await entered.promise;assert.equal(f.service.isLinkBusy(),true);f.session.invalidate();
 assert.equal(f.service.getPendingLink(),null);gate.resolve();await assert.rejects(write);
 assert.equal(f.service.getPendingLink(),null);await assert.rejects(async()=>f.service.linkDocument(selection()));assert.equal(f.requests.length,1);assert.ok(original.operation_id);
});

test('bridge adversarial: concurrent click cannot send a second write before the first receipt',async t=>{
 const gate=deferred(),entered=deferred();
 const f=fixture(t,async p=>{entered.resolve();await gate.promise;return Response.json(receipt(p));});
 const write=f.service.linkDocument(selection());await entered.promise;
 await assert.rejects(async()=>f.service.linkDocument(selection()));await assert.rejects(f.service.retryLink());assert.equal(f.requests.length,1);
 gate.resolve();await write;assert.equal(f.service.isLinkBusy(),false);assert.equal(f.service.getPendingLink(),null);
});

test('bridge adversarial DOM: uncertain link keeps the selection protected; sign-out removes its text and retained payload',async t=>{
 const h=uiFixture(t,()=>{throw TypeError('Lost response');});await h.handle.ready;h.submit(h.edit());await settle(()=>!h.handle.isBusy());
 assert.equal(h.handle.isDirty(),true);assert.equal(h.handle.hasUncertain(),true);assert.equal(h.handle.discard(),false);
 assert.equal(h.host.querySelector('textarea[name="reason"]').value,'PRIVATE-LINK-REASON');assert.equal(h.host.querySelector('[data-cb="cancel-link"]').disabled,true);
 h.host.querySelector('[data-cb="section"][data-section="requests"]').click();assert.ok(h.host.querySelector('[data-cb-link-form]'));
 h.session.invalidate();assert.equal(h.service.getPendingLink(),null);assert.equal(h.handle.isDirty(),false);assert.equal(h.host.querySelector('form'),null);assert.doesNotMatch(h.host.innerHTML,/PRIVATE-/);
});

test('bridge adversarial DOM: 409 reload preserves reason and source but requires new identity confirmation at the latest revision',async t=>{
 const h=uiFixture(t,()=>Response.json({ok:false,codigo:'revision_conflict'},{status:409}));await h.handle.ready;h.submit(h.edit());await settle(()=>!h.handle.isBusy());
 assert.equal(h.service.getPendingLink().rejected,true);assert.equal(h.host.querySelector('textarea[name="reason"]').value,'PRIVATE-LINK-REASON');
 h.host.querySelector('[data-cb="refresh-link"]').click();await settle(()=>!h.handle.isBusy());
 assert.equal(h.context.revision,8);assert.equal(h.service.getPendingLink(),null);assert.equal(h.host.querySelector('textarea[name="reason"]').value,'PRIVATE-LINK-REASON');assert.equal(h.host.querySelector('input[name="confirmed"]').checked,false);assert.equal(h.handle.isDirty(),true);
 const form=h.host.querySelector('[data-cb-link-form]');form.elements.confirmed.checked=true;h.submit(form);await settle(()=>!h.handle.isBusy());
 const writes=h.requests.filter(x=>x.acao==='vincular_documento');assert.equal(writes.length,2);assert.equal(writes[1].expected_revision,8);assert.equal(writes[1].source_id,writes[0].source_id);assert.notEqual(writes[1].operation_id,writes[0].operation_id);
});
