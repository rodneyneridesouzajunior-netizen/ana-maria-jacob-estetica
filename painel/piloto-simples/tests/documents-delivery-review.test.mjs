// Independent regression coverage: real service transport and JSDOM handlers only.
// No live requests, real patient data, or automatic signatures.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createDocumentsService,safeDocumentURL} from '../documents-service.mjs';
import {openDocumentDelivery} from '../documents-delivery-ui.mjs';
import {createPatientDocumentClient} from '../../../documento/public-client.mjs';
import {mountPatientDocument} from '../../../documento/documento.mjs';
import {PUBLIC_BACKEND} from '../integration/public-backend.mjs';
const require=createRequire(new URL('../../../../../skinpro-analise/test-tools/package.json',import.meta.url)),{JSDOM}=require('jsdom');
const tick=()=>new Promise(r=>setImmediate(r));
const id=n=>`${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;
const token=id('2')+'.'+'c'.repeat(64),hash='a'.repeat(64),publicURL='https://anamariajacob.com.br/documento/#token='+token;
const pdfURL=PUBLIC_BACKEND.supabaseUrl+'/storage/v1/object/sign/app-custom-documents/synthetic/original.pdf?token=synthetic';
const record=()=>({id:'doc-a',patientId:'patient-a',visitId:'visit-a',title:'Documento <sintético>',templateVersion:1});
const issue=(overrides={})=>({id:id('2'),document_id:'doc-a',patient_id:'patient-a',visit_id:'visit-a',status:'issued',expires_at:'2026-11-01T18:00:00Z',public_url:publicURL,...overrides});
const envelope=data=>({ok:true,auth_method:'supabase_auth',role:'owner',clinic_id:id('1'),...data});
const operation=(overrides={})=>({id:id('2'),kind:'custom_document_issue',status:'committed',...overrides});
const receipt=()=>({id:id('2'),status:'received',signed_at:'2026-10-16T14:00:00Z',clinical_authorization:false,pdf_sha256:'b'.repeat(64),pdf_url:pdfURL,snapshot_hash:hash});
function auth(){const listeners=new Set();return{requireReady:async()=>({token:'synthetic'}),assertCurrent:async()=>{},subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},invalidate(){for(const fn of [...listeners])fn();}};}
function privateService(t,fetchImpl){const session=auth(),service=createDocumentsService({session,fetchImpl,uuidFactory:()=>id('2')});t.after(()=>service.dispose());return{session,service};}
function dom(t){const d=new JSDOM('<!doctype html><main></main>',{url:publicURL}),w=d.window,previous={},disposers=[];
 for(const [key,value] of Object.entries({document:w.document,FormData:w.FormData,addEventListener:w.addEventListener.bind(w),removeEventListener:w.removeEventListener.bind(w),confirm:()=>false})){previous[key]=globalThis[key];globalThis[key]=value;}
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 w.HTMLCanvasElement.prototype.getContext=()=>({beginPath(){},moveTo(){},lineTo(){},stroke(){},clearRect(){}});w.HTMLCanvasElement.prototype.setPointerCapture=()=>{};w.HTMLCanvasElement.prototype.getBoundingClientRect=()=>({left:0,top:0,width:1000,height:360});
 t.after(()=>{for(const dispose of disposers.reverse())dispose();w.close();for(const [key,value] of Object.entries(previous))if(value===undefined)delete globalThis[key];else globalThis[key]=value;});
 return{w,host:w.document.querySelector('main'),cleanup:fn=>disposers.push(fn),event:(el,name)=>el.dispatchEvent(new w.Event(name,{bubbles:true,cancelable:true}))};
}
const patientOpen=(overrides={})=>({ok:true,status:'issued',snapshot_hash:hash,confirmation:{version:'test-v1',text:'Confirmação sintética.',general_data_text:'Declaração sintética de dados.'},document:{...record(),id:id('2'),kind:'termo',patientName:'Paciente sintética',snapshot:{version:1,editorVersion:2,title:'Documento sintético',body:'Leia este texto.',publishedAt:'2026-10-16T12:00:00Z',questions:[{id:'answer',label:'Pergunta obrigatória',type:'text',required:true}],steps:[{id:'questions',title:'Respostas',questionIds:['answer']}]}},...overrides});
function sign(h){h.host.querySelector('[data-step="2"]').click();h.host.querySelector('[name=answer-answer]').value='Resposta preservada';h.host.querySelector('[name=signer_name]').value='Paciente sintética';h.host.querySelector('[name=confirmed]').checked=true;h.event(h.host.querySelector('[name=answer-answer]'),'input');const canvas=h.host.querySelector('canvas');canvas.onpointerdown({pointerId:1,clientX:100,clientY:100,preventDefault(){}});canvas.onpointermove({pointerId:1,clientX:400,clientY:120});canvas.onpointerup({pointerId:1});}

test('document issue ambiguity freezes exact operation and retry never creates a second emission',async t=>{
 const calls=[];let fail=true;const f=privateService(t,async(_url,init)=>{calls.push(JSON.parse(init.body));if(fail){fail=false;throw Error('lost response');}return Response.json(envelope({issue:issue(),operation:operation()}));});
 await assert.rejects(f.service.issue({document_id:'doc-a',expected_revision:7,expires_in_days:7}),/conexão/);assert.equal(f.service.getPending().payload.operation_id,id('2'));assert.throws(()=>f.service.issue({document_id:'doc-b',expected_revision:8}),/pendente/);
 await f.service.retry();assert.deepEqual(calls[1],calls[0]);assert.equal(f.service.getPending(),null);
});

test('document issue rejects a receipt for a different operation even when document matches',async t=>{
 const f=privateService(t,async()=>Response.json(envelope({issue:issue({id:id('3')}),operation:operation({id:id('3')})})));
 await assert.rejects(f.service.issue({document_id:'doc-a',expected_revision:7}),error=>error.code==='invalid_receipt'&&error.uncertain===true);assert.ok(f.service.getPending(),'An unrelated receipt must not release the original pending operation');
});

test('document service discards a delayed authenticated response after logout',async t=>{
 let resolve;const f=privateService(t,()=>new Promise(r=>resolve=r)),pending=f.service.list('doc-a');await tick();f.session.invalidate();resolve(Response.json(envelope({issues:[issue()]})));await assert.rejects(pending,/sessão/);await assert.rejects(f.service.list('doc-a'),/sessão/);assert.equal(f.service.getPending(),null);
});

test('document delivery dialog does not emit on open and removes patient content after logout',async t=>{
 const h=dom(t);let resolve;const f=privateService(t,()=>new Promise(r=>resolve=r)),state={revision:7,documentResponses:[record()]},dialog=openDocumentDelivery(record(),{getState:()=>state,service:f.service});await tick();
 assert.equal(dialog.querySelector('[name=reviewed]').checked,false);assert.equal(dialog.querySelector('sintético'),null);f.session.invalidate();assert.equal(dialog.isConnected,false);resolve(Response.json(envelope({issues:[issue()]})));await tick();assert.equal(h.w.document.querySelector('dialog'),null);assert.doesNotMatch(h.w.document.body.textContent,/Paciente sintética/);
});

test('document delivery preserves pending emission through close attempt and confirms same retry',async t=>{
 const h=dom(t),calls=[];let issueFailed=false;const f=privateService(t,async(_url,init)=>{const p=JSON.parse(init.body);calls.push(p);if(p.acao==='listar_emissoes_documento')return Response.json(envelope({issues:issueFailed?[issue()]:[]}));if(!issueFailed){issueFailed=true;throw Error('lost');}return Response.json(envelope({issue:issue(),operation:operation()}));});
 const dialog=openDocumentDelivery(record(),{getState:()=>({revision:7,documentResponses:[record()]}),service:f.service});await tick();assert.equal(calls.length,1);dialog.querySelector('[name=reviewed]').checked=true;h.event(dialog.querySelector('form'),'submit');await tick();assert.ok(f.service.getPending());assert.equal(dialog.querySelector('[data-delivery=retry]').hidden,false);dialog.querySelector('[data-delivery=close]').click();assert.equal(dialog.isConnected,true);assert.equal(h.event(dialog,'cancel'),false);
 dialog.querySelector('[data-delivery=retry]').click();await tick();assert.equal(f.service.getPending(),null);assert.deepEqual(calls.filter(x=>x.acao==='emitir_documento_paciente')[1],calls.filter(x=>x.acao==='emitir_documento_paciente')[0]);assert.match(dialog.textContent,/Link confirmado|Gravação confirmada/);dialog.querySelector('[data-delivery=close]').click();assert.equal(dialog.isConnected,false);
});

test('delivery reopening reads received status and original without issuing or signing again',async t=>{
 const h=dom(t),calls=[],f=privateService(t,async(_url,init)=>{calls.push(JSON.parse(init.body));return Response.json(envelope({issues:[issue({status:'received',received_at:'2026-10-16T14:00:00Z'})]}));});
 const dialog=openDocumentDelivery(record(),{getState:()=>({revision:7,documentResponses:[record()]}),service:f.service});await tick();assert.match(dialog.textContent,/aguardando revisão profissional/);assert.ok(dialog.querySelector('[data-delivery=pdf]'));assert.equal(calls.length,1);assert.equal(calls[0].acao,'listar_emissoes_documento');dialog.querySelector('[data-delivery=close]').click();
});

test('inline revocation requires a second explicit click; cancel writes nothing and double click revokes once',async t=>{
 const h=dom(t),calls=[];let revoked=false,release;globalThis.confirm=()=>assert.fail('The delivery dialog must never open a native confirmation');
 const original=()=>issue({status:revoked?'revoked':'received',received_at:'2026-10-16T14:00:00Z',...(revoked?{public_url:undefined,revoked_at:'2026-10-16T15:00:00Z'}:{})}),f=privateService(t,async(_url,init)=>{const p=JSON.parse(init.body);calls.push(p);if(p.acao==='listar_emissoes_documento')return Response.json(envelope({issues:[original()]}));assert.equal(p.acao,'revogar_documento_paciente');return new Promise(resolve=>{release=()=>{revoked=true;resolve(Response.json(envelope({issue:original(),operation:operation({kind:'custom_document_revoke'})})));};});});
 const dialog=openDocumentDelivery(record(),{getState:()=>({revision:7,documentResponses:[record()]}),service:f.service});await tick();dialog.querySelector('[data-delivery=revoke]').click();await tick();assert.equal(calls.length,1);const confirmation=dialog.querySelector('[aria-label="Confirmação de revogação"]');assert.ok(confirmation.closest('[data-issue-id]'));assert.match(confirmation.textContent,/original já recebido.*continuará preservado/);assert.equal(h.w.document.activeElement.dataset.delivery,'revoke-cancel');
 dialog.querySelector('[data-delivery=revoke-cancel]').click();await tick();assert.equal(calls.length,1);assert.equal(dialog.querySelector('[data-delivery=revoke-confirm]'),null);assert.equal(h.w.document.activeElement.dataset.delivery,'revoke');
 dialog.querySelector('[data-delivery=revoke]').click();await tick();const confirm=dialog.querySelector('[data-delivery=revoke-confirm]');confirm.click();confirm.click();await tick();assert.equal(calls.filter(p=>p.acao==='revogar_documento_paciente').length,1);assert.equal(confirm.disabled,true);assert.equal(dialog.querySelector('[data-delivery=revoke-cancel]').disabled,true);assert.equal(calls.at(-1).issue_id,id('2'));release();await tick();
 assert.equal(f.service.getPending(),null);assert.match(dialog.textContent,/Link revogado/);assert.ok(dialog.querySelector('[data-delivery=pdf]'),'The preserved original remains available');assert.equal(dialog.querySelector('[data-delivery=revoke-confirm]'),null);assert.equal(dialog.querySelector('[data-delivery=revoke]'),null);
});

test('uncertain inline revocation keeps the same operation and blocks cancellation until retry confirms it',async t=>{
 const h=dom(t),calls=[];let attempted=false,revoked=false;const f=privateService(t,async(_url,init)=>{const p=JSON.parse(init.body);calls.push(p);if(p.acao==='listar_emissoes_documento')return Response.json(envelope({issues:[issue({status:revoked?'revoked':'issued'})]}));if(!attempted){attempted=true;throw Error('Lost revocation response');}revoked=true;return Response.json(envelope({issue:issue({status:'revoked'}),operation:operation({kind:'custom_document_revoke'})}));});
 const dialog=openDocumentDelivery(record(),{getState:()=>({revision:7,documentResponses:[record()]}),service:f.service});await tick();dialog.querySelector('[data-delivery=revoke]').click();await tick();dialog.querySelector('[data-delivery=revoke-confirm]').click();await tick();assert.equal(f.service.getPending().action,'revogar_documento_paciente');assert.equal(dialog.querySelector('[data-delivery=revoke-cancel]').disabled,true);assert.equal(dialog.querySelector('[data-delivery=revoke-confirm]').disabled,true);assert.equal(dialog.querySelector('[data-delivery=retry]').hidden,false);
 h.event(dialog.querySelector('[data-delivery=revoke-confirm]'),'click');await tick();dialog.querySelector('[data-delivery=close]').click();assert.equal(dialog.isConnected,true);assert.equal(h.event(dialog,'cancel'),false);assert.equal(calls.filter(p=>p.acao==='revogar_documento_paciente').length,1);
 dialog.querySelector('[data-delivery=retry]').click();await tick();const writes=calls.filter(p=>p.acao==='revogar_documento_paciente');assert.equal(writes.length,2);assert.deepEqual(writes[1],writes[0]);assert.equal(f.service.getPending(),null);assert.match(dialog.textContent,/Link revogado/);
});

test('logout removes an inline revocation confirmation and stale controls cannot submit it',async t=>{
 const h=dom(t),calls=[],f=privateService(t,async(_url,init)=>{calls.push(JSON.parse(init.body));return Response.json(envelope({issues:[issue()]}));}),dialog=openDocumentDelivery(record(),{getState:()=>({revision:7,documentResponses:[record()]}),service:f.service});await tick();dialog.querySelector('[data-delivery=revoke]').click();await tick();const confirm=dialog.querySelector('[data-delivery=revoke-confirm]');assert.ok(confirm);f.session.invalidate();assert.equal(dialog.isConnected,false);h.event(confirm,'click');await tick();assert.equal(calls.length,1);assert.equal(h.w.document.querySelector('dialog'),null);
});

test('patient document requires manual answers, signature and confirmation; no submit on mount or navigation',async t=>{
 const h=dom(t),writes=[],client={open:async()=>patientOpen(),hasPending:()=>false,dispose(){},submit:async p=>{writes.push(p);return receipt();}};const handle=await mountPatientDocument(h.host,{client});h.cleanup(()=>handle.dispose());
 assert.equal(writes.length,0);assert.equal(h.host.querySelector('[name=confirmed]').checked,false);h.host.querySelector('[data-step="2"]').click();h.event(h.host.querySelector('form'),'submit');await tick();assert.equal(writes.length,0);assert.match(h.host.querySelector('[data-status]').textContent,/Responda/);sign(h);h.event(h.host.querySelector('form'),'submit');await tick();assert.equal(writes.length,1);assert.equal(writes[0].confirmed,true);assert.deepEqual(writes[0].answers,{answer:'Resposta preservada'});assert.match(h.host.textContent,/Recebimento confirmado/);assert.match(h.host.textContent,/ainda precisa revisar/);
});

test('patient uncertain delivery freezes original answers and retries exact signature with same ID',async t=>{
 const h=dom(t),requests=[];let first=true;const client=createPatientDocumentClient({token,uuidFactory:()=>id('2'),fetchImpl:async(_url,init)=>{const p=JSON.parse(init.body);requests.push(p);if(p.acao==='abrir')return Response.json(patientOpen());if(first){first=false;throw Error('lost');}return Response.json({ok:true,receipt:receipt()});}});const handle=await mountPatientDocument(h.host,{client});h.cleanup(()=>handle.dispose());sign(h);h.event(h.host.querySelector('form'),'submit');await tick();
 assert.equal(client.hasPending(),true);assert.equal(h.host.querySelector('[name=answer-answer]').disabled,true);assert.equal(h.host.querySelector('[data-recovery]').hidden,false);assert.equal(h.host.querySelector('[name=answer-answer]').value,'Resposta preservada');h.host.querySelector('[data-retry]').click();await tick();assert.equal(client.hasPending(),false);assert.deepEqual(requests[2],requests[1]);assert.match(h.host.textContent,/Recebimento confirmado/);
});

test('patient reopening a received document fetches receipt without creating a new signature',async t=>{
 const h=dom(t),requests=[],client=createPatientDocumentClient({token,fetchImpl:async(_url,init)=>{const p=JSON.parse(init.body);requests.push(p);return Response.json(p.acao==='abrir'?patientOpen({status:'received'}):{ok:true,receipt:receipt()});}});const handle=await mountPatientDocument(h.host,{client});h.cleanup(()=>handle.dispose());
 assert.deepEqual(requests.map(x=>x.acao),['abrir','recibo']);assert.equal(h.host.querySelector('form'),null);assert.match(h.host.textContent,/Recebimento confirmado/);assert.equal(h.host.querySelector('a').href,pdfURL);
});

test('document links refuse another origin or a wrong storage bucket',()=>{
 assert.throws(()=>safeDocumentURL(publicURL.replace('anamariajacob.com.br','example.invalid'),{publicPage:true}));assert.throws(()=>safeDocumentURL(pdfURL.replace('app-custom-documents','other-private-bucket')));assert.equal(safeDocumentURL(publicURL,{publicPage:true}),publicURL);
});

for(const code of ['custom_processing','custom_claim_expired'])test(`public ${code} retains the exact signature operation for retry`,async t=>{
 const requests=[];let first=true;const client=createPatientDocumentClient({token,uuidFactory:()=>id('2'),fetchImpl:async(_url,init)=>{requests.push(JSON.parse(init.body));if(first){first=false;return Response.json({ok:false,codigo:code,erro:'Repita a mesma operação.'},{status:409});}return Response.json({ok:true,receipt:receipt()});}});t.after(()=>client.dispose());
 const payload={snapshot_hash:hash,confirmation_version:'test-v1',answers:{answer:'Resposta'},signer_name:'Paciente sintética',signature_strokes:[[{x:.1,y:.2},{x:.4,y:.5}]],confirmed:true};
 await assert.rejects(client.submit(payload),e=>e.code===code);assert.equal(client.hasPending(),true,'The server still owns the first UUID; dropping it prevents recovery');await client.retry();assert.deepEqual(requests[1],requests[0]);assert.equal(client.hasPending(),false);
});

test('definitively rejected signature lets the patient correct the form without losing the original stroke',async t=>{
 const h=dom(t),requests=[];let writes=0,ids=1;const client=createPatientDocumentClient({token,uuidFactory:()=>id(String(++ids)),fetchImpl:async(_url,init)=>{const p=JSON.parse(init.body);requests.push(p);if(p.acao==='abrir')return Response.json(patientOpen());if(++writes===1)return Response.json({ok:false,codigo:'custom_signer_name_invalid',erro:'Confira seu nome.'},{status:422});return Response.json({ok:true,receipt:receipt()});}});const handle=await mountPatientDocument(h.host,{client});h.cleanup(()=>handle.dispose());sign(h);h.event(h.host.querySelector('form'),'submit');await tick();
 assert.equal(client.hasPending(),false);assert.equal(h.host.querySelector('[name=answer-answer]').disabled,false);assert.equal(h.host.querySelector('[name=answer-answer]').value,'Resposta preservada');assert.match(h.host.querySelector('[data-status]').textContent,/nome/);
 h.host.querySelector('[name=signer_name]').value='Nome corrigido';h.event(h.host.querySelector('form'),'submit');await tick();const submissions=requests.filter(p=>p.acao==='assinar');assert.equal(submissions.length,2);assert.notEqual(submissions[0].operation_id,submissions[1].operation_id);assert.deepEqual(submissions[1].signature_strokes,submissions[0].signature_strokes);assert.equal(submissions[1].signer_name,'Nome corrigido');assert.match(h.host.textContent,/Recebimento confirmado/);
});

test('image choice remains independent and a refusal is sent without consent for publicity or general data',async t=>{
 const h=dom(t),writes=[],result=patientOpen();result.document.kind='imagem';const client={open:async()=>result,hasPending:()=>false,dispose(){},submit:async p=>{writes.push(p);return receipt();}};const handle=await mountPatientDocument(h.host,{client});h.cleanup(()=>handle.dispose());sign(h);
 assert.equal(h.host.querySelector('[name=image_use]').value,'');assert.equal(h.host.querySelector('[name=general_data_consent]'),null);h.event(h.host.querySelector('form'),'submit');await tick();assert.equal(writes.length,0);assert.match(h.host.querySelector('[data-status]').textContent,/imagem/);
 h.host.querySelector('[name=image_use]').value='nao_autorizado';h.event(h.host.querySelector('form'),'submit');await tick();assert.equal(writes.length,1);assert.equal(writes[0].image_use,'nao_autorizado');assert.equal(Object.hasOwn(writes[0],'general_data_consent'),false);
});

test('patient form restored from the mobile back-forward cache can still submit its original draft',async t=>{
 const h=dom(t),requests=[],client=createPatientDocumentClient({token,uuidFactory:()=>id('2'),fetchImpl:async(_url,init)=>{const p=JSON.parse(init.body);requests.push(p);return Response.json(p.acao==='abrir'?patientOpen():{ok:true,receipt:receipt()});}});const handle=await mountPatientDocument(h.host,{client});h.cleanup(()=>handle.dispose());sign(h);
 h.w.dispatchEvent(new h.w.PageTransitionEvent('pagehide',{persisted:true}));h.w.dispatchEvent(new h.w.PageTransitionEvent('pageshow',{persisted:true}));
 h.event(h.host.querySelector('form'),'submit');await tick();assert.equal(requests.filter(x=>x.acao==='assinar').length,1);assert.match(h.host.textContent,/Recebimento confirmado/);
});

test('reload after reserved signature failure resumes only the stored server submission without another UUID',async t=>{
 const h=dom(t),requests=[];let reserved=false,uuidCalls=0,release;
 const transport=async(_url,init)=>{const p=JSON.parse(init.body);requests.push(p);if(p.acao==='abrir')return Response.json(patientOpen(reserved?{status:'processing',can_resume:true}:{}));if(p.acao==='assinar'){reserved=true;return Response.json({ok:false,codigo:'custom_unavailable',erro:'Upload interrompido.'},{status:503});}if(p.acao==='retomar')return new Promise(resolve=>{release=()=>resolve(Response.json({ok:true,receipt:receipt()}));});assert.fail('Unexpected operation '+p.acao);};
 const first=createPatientDocumentClient({token,fetchImpl:transport,uuidFactory:()=>{uuidCalls++;return id('3');}}),firstMount=await mountPatientDocument(h.host,{client:first});h.cleanup(()=>firstMount.dispose());sign(h);h.event(h.host.querySelector('form'),'submit');await tick();assert.equal(first.hasPending(),true);assert.equal(uuidCalls,1);firstMount.dispose();
 const reopened=createPatientDocumentClient({token,fetchImpl:transport,uuidFactory:()=>{assert.fail('Recovery must not create a new signature UUID');}}),secondMount=await mountPatientDocument(h.host,{client:reopened});h.cleanup(()=>secondMount.dispose());
 assert.equal(h.host.querySelector('form'),null);assert.equal(h.host.querySelector('canvas'),null);assert.match(h.host.textContent,/envio está em conferência/);assert.deepEqual(requests.map(p=>p.acao),['abrir','assinar','abrir']);const button=h.host.querySelector('[data-resume]');button.click();button.click();await tick();assert.equal(requests.filter(p=>p.acao==='retomar').length,1);assert.deepEqual(requests.at(-1),{acao:'retomar',token});assert.equal(button.disabled,true);release();await tick();
 assert.match(h.host.textContent,/Recebimento confirmado/);assert.equal(requests.filter(p=>p.acao==='assinar').length,1);assert.equal(uuidCalls,1);
});

test('resume failure keeps recovery controls and refuses a receipt belonging to another document',async t=>{
 const h=dom(t),requests=[];let resumes=0;const client=createPatientDocumentClient({token,uuidFactory:()=>assert.fail('Resume must not create a UUID'),fetchImpl:async(_url,init)=>{const p=JSON.parse(init.body);requests.push(p);if(p.acao==='abrir')return Response.json(patientOpen({status:'processing',can_resume:true}));if(++resumes===1)return Response.json({ok:false,codigo:'custom_processing',erro:'Repita a mesma operação.'},{status:409});return Response.json({ok:true,receipt:{...receipt(),id:id('4')}});}});const handle=await mountPatientDocument(h.host,{client});h.cleanup(()=>handle.dispose());
 h.host.querySelector('[data-resume]').click();await tick();assert.match(h.host.querySelector('[data-status]').textContent,/Repita/);assert.equal(h.host.querySelector('[data-resume]').disabled,false);assert.equal(h.host.querySelector('form'),null);h.host.querySelector('[data-resume]').click();await tick();assert.match(h.host.querySelector('[data-status]').textContent,/não corresponde/);assert.doesNotMatch(h.host.textContent,/Recebimento confirmado/);assert.deepEqual(requests.map(p=>p.acao),['abrir','retomar','retomar']);assert.deepEqual(requests[1],requests[2]);
});
