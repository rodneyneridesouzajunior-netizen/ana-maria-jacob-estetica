import fs from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {webcrypto} from 'node:crypto';
import * as domain from '../domain.mjs';
import {areas} from '../areas.mjs';
import {mountOperations,renderVisitOperations} from '../operations-ui.mjs';
import {mountClinicalCompletion} from '../clinical-completion-ui.mjs';
import {createClinicalCompletionService} from '../clinical-completion-service.mjs';
import {emptyState,validateTransition} from '../../../supabase/functions/app-workspace/rules.mjs';
import {saveProcedure,saveProduct,receiveLot,assertVisitEditable} from '../operations-domain.mjs';

const require=createRequire(new URL('../../../../../skinpro-analise/test-tools/package.json',import.meta.url)),{JSDOM}=require('jsdom');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const id=n=>`${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;
const source=(await fs.readFile(new URL('../app.mjs',import.meta.url),'utf8')).replace(/^import .*$/gm,'').replace(/^try\{await setHash\(\);\}catch.*$/gm,'');
const html=await fs.readFile(new URL('../connected.html',import.meta.url),'utf8');
function workspace(){
 const s=emptyState(),now='2026-10-15T18:00:00.000Z',options={now,today:'2026-10-15'};s.revision=4;s.patients.push({id:'patient',name:'Paciente sintética'});
 saveProcedure(s,{...options,operationId:'proc-op',data:{id:'proc',name:'Avaliação sintética',price:10001,cost:1000,duration:30,recordMode:'simple'}});
 saveProduct(s,{...options,operationId:'product-op',data:{id:'product',name:'Material sintético',unit:'mL',unitCost:2000}});
 receiveLot(s,{...options,operationId:'lot-op',data:{id:'lot',productId:'product',code:'TESTE',expiry:'2027-10-15',quantity:10,unitCost:2000}});
 s.visits.push({id:'visit',patientId:'patient',professionalId:'amj-principal',date:'2026-10-15',status:'rascunho',notes:'Registro salvo',photos:[],maps:{},procedureId:'proc',procedureVersion:1,procedureSnapshot:structuredClone(s.procedures[0])});return s;
}
function domSetup(t){
 const dom=new JSDOM(html,{url:'https://example.invalid/app/#paciente/patient/visit/consultas'}),w=dom.window,previous={};
 for(const name of ['document','FormData','AbortController','confirm']){previous[name]=globalThis[name];globalThis[name]=name==='confirm'?()=>false:w[name];}
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 t.after(()=>{w.close();for(const [name,value]of Object.entries(previous))if(value===undefined)delete globalThis[name];else globalThis[name]=value;});return{dom,w};
}
function operations(t,completeClinical,{legacy=false,bindClinicalProcedure}={}){
 const {dom,w}=domSetup(t),host=w.document.getElementById('content'),state=workspace(),calls={mutate:0,render:0};if(legacy){delete state.visits[0].procedureSnapshot;delete state.visits[0].procedureVersion;delete state.visits[0].professionalId;}host.innerHTML=renderVisitOperations(state,'visit');
 const dispose=mountOperations(host,{getState:()=>state,completeClinical,bindClinicalProcedure:bindClinicalProcedure&&((payload)=>bindClinicalProcedure(payload,state)),beforeOperation:()=>true,mutate(){calls.mutate++;throw Error('Generic commit must never handle clinical conclusion');},render(){calls.render++;}});t.after(dispose);
 host.querySelector('[data-op=visit-review]').click();const form=host.querySelector('[data-op-form]');if(!legacy){form.elements.extraLot.value='lot';form.elements.extraQuantity.value='0,2';form.elements.extraReason.value='Material da paciente';form.elements.sessions.value='1';form.elements.reviewed.checked=true;form.elements.extraQuantity.dispatchEvent(new w.Event('input',{bubbles:true}));}
 const submit=()=>form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));return{dom,w,host,form,state,calls,submit};
}

test('connected visit form passes exact clinical inputs, blocks repeat submits and never calls generic commit',async t=>{
 let settle;const received=[],h=operations(t,data=>{received.push(data);return new Promise(resolve=>settle=resolve);});h.submit();await tick();h.submit();
 assert.equal(received.length,1);assert.equal(received[0].visitId,'visit');assert.equal(received[0].procedureId,'proc');assert.equal(received[0].sessions,1);assert.deepEqual(received[0].consumptions,[{lotId:'lot',quantity:'0,2',reason:'Material da paciente'}]);assert.equal(h.calls.mutate,0);assert.equal(h.form.inert,true);assert.equal(h.form.isConnected,true);
 settle(true);await tick();assert.equal(h.form.isConnected,false);assert.equal(h.calls.render,1);assert.equal(h.calls.mutate,0);
});

test('cancelled clinical review retains the exact original form, lot, reason and unsaved status',async t=>{
 const h=operations(t,async()=>false);h.submit();await tick();assert.equal(h.form.isConnected,true);assert.equal(h.form.closest('dialog').open,true);assert.equal(h.form.inert,false);assert.equal(h.form.elements.extraQuantity.value,'0,2');assert.equal(h.form.elements.extraReason.value,'Material da paciente');assert.equal(h.form.elements.extraLot.value,'lot');assert.equal(h.form.dataset.unsaved,'true');assert.equal(h.calls.mutate,0);assert.equal(h.calls.render,0);
});

test('failed handoff retains the completion draft and reports the error next to the form',async t=>{
 const h=operations(t,async()=>{throw Error('Revisão temporariamente indisponível');});h.submit();await tick();assert.equal(h.form.isConnected,true);assert.equal(h.form.inert,false);assert.equal(h.form.dataset.unsaved,'true');assert.equal(h.form.elements.extraQuantity.value,'0,2');assert.match(h.form.querySelector('.op-form-error').textContent,/temporariamente/);assert.equal(h.calls.mutate,0);
});

function app(t,{ready=true,failReload=false}={}){
 const {dom,w}=domSetup(t),state=workspace(),calls=[];let reads=0,completed=false;
 const review={ready,review_hash:'a'.repeat(64),workspace_revision:4,blockers:ready?[]:[{code:'professional_account_required',message:'Vincule a conta pessoal.'}],declaration_version:'fixture-v1',declaration:'Confirmação exclusivamente sintética.',summary:{patient_name:'Paciente sintética',procedure_name:'Avaliação sintética',professional_name:'Profissional sintética',documents:[]}};
 const session={requireReady:async()=>({token:'synthetic'}),assertCurrent:async()=>{},subscribe:()=>()=>{},invalidate(){}};
 const service=createClinicalCompletionService({session,uuidFactory:()=>id('2'),request:async(_endpoint,action,payload)=>{calls.push({action,payload});if(action==='preparar_conclusao_clinica')return{ok:true,auth_method:'supabase_auth',role:'owner',clinic_id:id('1'),review};if(action==='concluir_consulta_clinica'){completed=true;const saved=structuredClone(state);saved.revision=5;saved.visits[0].status='concluido';return{ok:true,auth_method:'supabase_auth',role:'owner',clinic_id:id('1'),workspace:{revision:5,state:saved},signature:{id:id('2'),patient_id:'patient',visit_id:'visit',review_hash:review.review_hash,workspace_revision:5,signature_method:'authenticated_session_mfa'},operation:{id:id('2'),kind:'clinical_completion',status:'committed'}};}throw Error('Unexpected operation '+action);}});t.after(()=>service.dispose());
 const context=vm.createContext({...domain,areas,assertVisitEditable,structuredClone,crypto:webcrypto,document:w.document,window:w,location:w.location,history:w.history,confirm:()=>false,setTimeout:()=>0,clearTimeout(){},isConnected:()=>true,getClinicalBridge:()=>({session}),createClinicalCompletionService:()=>service,mountClinicalCompletion,load:async()=>{if(completed&&failReload&&reads++===0)throw Error('Conexão de releitura caiu');const saved=structuredClone(state);if(completed){saved.revision=5;saved.visits[0].status='concluido';}return saved;},renderIntegrationPage:()=>'',documentsSatisfied:()=>false});
 vm.runInContext(source,context);context.fixture=state;vm.runInContext('state=fixture',context);
 const open=()=>vm.runInContext("openClinicalCompletion({visitId:'visit',procedureId:'proc',consumptions:[],sessions:1})",context);
 return{dom,w,context,service,calls,open,run:code=>vm.runInContext(code,context)};
}

test('app root opens real review service, sends only allowed fields and cancellation returns to the draft',async t=>{
 const h=app(t),result=h.open();await tick();assert.equal(h.calls.length,1);assert.equal(h.calls[0].action,'preparar_conclusao_clinica');assert.deepEqual(Object.keys(h.calls[0].payload).sort(),['consumptions','expected_revision','operation_id','patient_id','procedure_id','sessions','visit_id']);assert.equal(h.w.document.querySelector('[name=confirmed]').checked,false);
 h.w.document.querySelector('[data-cc=cancel]').click();assert.equal(await result,false);assert.equal(h.w.document.querySelector('.cc-modal'),null);assert.equal(h.calls.length,1);
});

test('app clinical handoff forwards distinct quote items without a legacy item binding',async t=>{
 const h=app(t),result=h.run("openClinicalCompletion({visitId:'visit',procedureId:'proc',consumptions:[],sessions:1,quoteId:'quote',itemId:'obsolete-item',quoteItems:[{itemId:'item-a',sessions:1},{itemId:'item-b',sessions:2}]})");await tick();
 assert.equal(h.calls[0].payload.quote_id,'quote');assert.equal(Object.hasOwn(h.calls[0].payload,'item_id'),false);assert.equal(Object.hasOwn(h.calls[0].payload,'quote_items'),false);
 assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0].payload.quoteItems)),[{itemId:'item-a',sessions:1},{itemId:'item-b',sessions:2}]);
 h.w.document.querySelector('[data-cc=cancel]').click();assert.equal(await result,false);assert.equal(h.calls.length,1);
});

test('app clinical handoff preserves the legacy one-item quote contract',async t=>{
 const h=app(t),result=h.run("openClinicalCompletion({visitId:'visit',procedureId:'proc',consumptions:[],sessions:2,quoteId:'quote',itemId:'item-a'})");await tick();
 assert.equal(h.calls[0].payload.quote_id,'quote');assert.equal(h.calls[0].payload.item_id,'item-a');assert.equal(h.calls[0].payload.sessions,2);assert.equal(Object.hasOwn(h.calls[0].payload,'quoteItems'),false);
 h.w.document.querySelector('[data-cc=cancel]').click();assert.equal(await result,false);assert.equal(h.calls.length,1);
});

test('confirmed clinical conclusion survives failed reread and only rereads when the user retries',async t=>{
 const h=app(t,{failReload:true}),result=h.open();await tick();const form=h.w.document.querySelector('[data-cc-confirm]');form.elements.confirmed.checked=true;form.dispatchEvent(new h.w.Event('submit',{bubbles:true,cancelable:true}));await tick();
 assert.match(h.w.document.querySelector('.cc-modal').textContent,/concluído no servidor/);assert.match(h.w.document.querySelector('.cc-modal').textContent,/não conclua novamente/);assert.equal(h.run('clean()'),false);assert.equal(h.calls.filter(x=>x.action==='concluir_consulta_clinica').length,1);
 h.w.document.querySelector('.cc-modal button').click();assert.equal(await result,true);assert.equal(h.run('state.revision'),5);assert.equal(h.w.document.querySelector('.cc-modal'),null);assert.equal(h.calls.filter(x=>x.action==='concluir_consulta_clinica').length,1);
});

test('blocked review exposes exact patient/visit document route without signing anything',async t=>{
 const h=app(t,{ready:false}),result=h.open();await tick();assert.equal(h.w.document.querySelector('[data-cc-confirm]'),null);assert.ok(h.w.document.querySelector('a[href="#originais/patient/visit"]'));assert.ok(h.w.document.querySelector('a[href="#configuracao-clinica"]'));assert.equal(h.calls.length,1);h.w.document.querySelector('[data-cc=cancel]').click();assert.equal(await result,false);
});


test('legacy visit binds an explicit procedure version and clinician before exposing completion',async t=>{
 let settle;const writes=[],h=operations(t,async()=>{assert.fail('Binding must not conclude a visit');},{legacy:true,bindClinicalProcedure:(payload,state)=>{writes.push(payload);return new Promise(resolve=>settle=()=>{const visit=state.visits[0],procedure=state.procedures.find(p=>p.id===payload.procedureId);Object.assign(visit,{procedureId:procedure.id,procedureVersion:procedure.version,procedureSnapshot:structuredClone(procedure),professionalId:payload.professionalId});state.revision++;resolve();});}});
 assert.equal(h.form.dataset.opForm,'visit-bind-procedure');assert.equal(h.form.elements.procedureSelection.value,'');assert.equal(h.form.elements.professionalId.value,'');assert.equal(h.form.elements.confirmed.checked,false);
 h.submit();await tick();assert.equal(writes.length,0);assert.equal(h.form.isConnected,true);
 h.form.elements.procedureSelection.value=JSON.stringify(['proc',1]);h.form.elements.professionalId.value='amj-principal';h.form.elements.confirmed.checked=true;h.form.elements.professionalId.dispatchEvent(new h.w.Event('change',{bubbles:true}));h.submit();await tick();assert.equal(h.form.inert,true);assert.deepEqual(writes,[{visitId:'visit',procedureId:'proc',procedureVersion:1,professionalId:'amj-principal'}]);settle();await tick();
 assert.equal(h.form.isConnected,false);assert.ok(h.host.querySelector('[data-op-form=visit-complete]'));assert.equal(h.state.visits[0].notes,'Registro salvo');assert.equal(h.state.visits[0].status,'rascunho');assert.equal(h.state.revision,5);assert.equal(h.calls.mutate,0);
});

test('legacy binding failure leaves chosen procedure, clinician and confirmation available for correction',async t=>{
 const h=operations(t,async()=>false,{legacy:true,bindClinicalProcedure:async()=>{throw Error('A versão do procedimento mudou.');}});h.form.elements.procedureSelection.value=JSON.stringify(['proc',1]);h.form.elements.professionalId.value='amj-principal';h.form.elements.confirmed.checked=true;h.form.elements.professionalId.dispatchEvent(new h.w.Event('change',{bubbles:true}));h.submit();await tick();
 assert.equal(h.form.isConnected,true);assert.equal(h.form.inert,false);assert.equal(h.form.dataset.unsaved,'true');assert.equal(h.form.elements.procedureSelection.value,JSON.stringify(['proc',1]));assert.equal(h.form.elements.professionalId.value,'amj-principal');assert.match(h.form.querySelector('.op-form-error').textContent,/versão/);assert.equal(h.host.querySelector('[data-op-form=visit-complete]'),null);assert.equal(h.state.revision,4);
});


test('blocked review route links navigate and dispose the review without an implicit signature',async t=>{
 const h=app(t,{ready:false}),result=h.open();await tick();h.run('render=async()=>{disposeAuxiliary();};drawMap=()=>{};');h.w.document.querySelector('a[href="#configuracao-clinica"]').click();await tick();await tick();
 assert.equal(await result,false);assert.equal(h.w.location.hash,'#configuracao-clinica');assert.equal(h.run('route'),'configuracao-clinica');assert.equal(h.w.document.querySelector('.cc-modal'),null);assert.equal(h.calls.filter(x=>x.action==='concluir_consulta_clinica').length,0);
});

test('root legacy binder uses a valid draft CAS and preserves original clinical content',async t=>{
 const h=app(t);h.run("delete state.visits[0].procedureSnapshot;delete state.visits[0].procedureVersion;delete state.visits[0].professionalId;");let commits=0;
 h.context.commit=async(revision,update)=>{assert.equal(revision,4);const old=structuredClone(h.run('state')),next=structuredClone(old);update(next);validateTransition(old,next,{now:'2026-10-15T18:00:00.000Z'});next.revision=5;commits++;return next;};
 await h.run("bindClinicalProcedure({visitId:'visit',procedureId:'proc',procedureVersion:1,professionalId:'amj-principal'})");assert.equal(commits,1);assert.equal(h.run('state.visits[0].professionalId'),'amj-principal');assert.equal(h.run('state.visits[0].procedureSnapshot.version'),1);assert.equal(h.run('state.visits[0].notes'),'Registro salvo');assert.equal(h.run('state.visits[0].date'),'2026-10-15');assert.equal(h.run('state.visits[0].status'),'rascunho');assert.equal(h.run('state.bills.length'),0);assert.equal(h.calls.length,0);
});
