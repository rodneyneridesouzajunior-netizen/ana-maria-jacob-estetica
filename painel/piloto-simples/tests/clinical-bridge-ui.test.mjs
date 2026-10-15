import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mountClinicalBridge,normalizeBridgeDocuments,normalizeBridgeRequests,normalizeBridgeLinks,trustedOriginalPDF,validateOpenedOriginal,OFFICIAL_CLINICAL_FORMS} from '../clinical-bridge-ui.mjs';
import {PUBLIC_BACKEND} from '../integration/public-backend.mjs';
const require=createRequire(new URL('../../../../../skinpro-analise/test-tools/package.json',import.meta.url));
const {JSDOM}=require('jsdom');
const tick=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const sourceId='44444444-4444-4444-8444-444444444444';
const original=()=>({source_kind:'anamnese',source_id:sourceId,title:'Anamnese original',status:'recebido',received_at:'2026-10-15T12:00:00Z',identity:{name:'Paciente <teste>',cpf_masked:'•••••••••25',phone_masked:'•••••••0000'},source_fingerprint:'a'.repeat(64),pdf_sha256:'b'.repeat(64),eligible_for_link:true,clinical_authorization:false});
const listed=d=>({documents:[d||original()],pagination:{limit:25,offset:0,has_more:false},capabilities:{link_received:true,clinical_authorization:false,professional_signature:false}});
const context=()=>({patientId:'patient',visitId:'visit',patientName:'Paciente de teste',visitLabel:'15/10 · Avaliação',revision:6,cpfMasked:'•••••••••25',locked:false});
const pdfURL=()=>`${PUBLIC_BACKEND.supabaseUrl}/storage/v1/object/sign/fichas-pdf/anamneses/${sourceId}/ficha.pdf?token=synthetic`;
function fixture(t,options={}){
  const dom=new JSDOM('<!doctype html><body><main></main></body>',{url:'https://example.invalid/app/'}),host=dom.window.document.querySelector('main'),listeners=new Set(),notices=[],opened=[];
  const service={source:'workspace',session:{subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);}},listDocuments:async()=>listed(),listLinks:async()=>({links:[]}),listSiteRequests:async()=>({solicitacoes_site:[],paginacao:{limit:25,offset:0,has_more:false}}),openDocument:async()=>({document:original(),pdf:{url:pdfURL(),sha256:'b'.repeat(64),expires_in:120}}),getPendingLink:()=>null,isLinkBusy:()=>false,...options.service};
  const popup=()=>{const doc=dom.window.document.implementation.createHTMLDocument();const p={opener:{},document:doc,closed:false,url:null,location:{replace:url=>{p.url=url;}},close(){p.closed=true;}};opened.push(p);return p;};
  let current=context();
  const handle=mountClinicalBridge(host,{getContext:()=>current,notify:(...args)=>notices.push(args),openWindow:popup,confirmDiscard:()=>true,...options,service});
  t.after(()=>{handle.dispose();dom.window.close();});
  return{dom,host,service,handle,listeners,notices,opened,setContext:c=>{current=c;},invalidate:()=>{for(const fn of [...listeners])fn();}};
}
function fillLink(f){f.host.querySelector('[data-cb="link"]').click();const form=f.host.querySelector('[data-cb-link-form]');form.elements.confirmed.checked=true;form.elements.reason.value='Identidade conferida no original';form.dispatchEvent(new f.dom.window.Event('input',{bubbles:true}));return form;}

test('normalização não transforma recebimento em aprovação e rejeita referências repetidas',()=>{
 const loaded=normalizeBridgeDocuments(listed());assert.equal(loaded.capabilities.clinical_authorization,false);assert.equal(loaded.capabilities.professional_signature,false);
 assert.throws(()=>normalizeBridgeDocuments({...listed(),documents:[original(),original()]}),/repetida/);
 assert.throws(()=>normalizeBridgeRequests({solicitacoes_site:[{id:'x'},{id:'x'}]}),/repetida/);
 assert.throws(()=>normalizeBridgeLinks({links:[{source_kind:'anamnese',source_id:sourceId,patient_id:'other',visit_id:'visit',status:'vinculado_recebido',clinical_authorization:false}]},context()),/outro contexto/);
});
test('PDF aceita somente armazenamento autorizado e recusa travessia e alteração de identidade/hash',()=>{
 assert.equal(trustedOriginalPDF(pdfURL()),pdfURL());
 for(const url of [pdfURL().replace('https:','http:'),pdfURL().replace('rjxtxoqprnumouqakxbc.supabase.co','foreign.invalid'),pdfURL()+'#x',pdfURL().replace('/ficha.pdf','/%2e%2e/ficha.pdf'),pdfURL().replace('/ficha.pdf','/%252e%252e/ficha.pdf'),pdfURL().replace('/ficha.pdf','/x%2fy.pdf'),pdfURL().replace('?token=synthetic','')])assert.equal(trustedOriginalPDF(url),null,url);
 const selected=normalizeBridgeDocuments(listed()).documents[0],response={document:original(),pdf:{url:pdfURL(),sha256:'b'.repeat(64),expires_in:120}};
 assert.equal(validateOpenedOriginal(response,selected),pdfURL());
 assert.throws(()=>validateOpenedOriginal({...response,document:{...response.document,source_id:'other'}},selected),/mudou/);
 assert.throws(()=>validateOpenedOriginal({...response,pdf:{...response.pdf,sha256:'c'.repeat(64)}},selected),/integridade/);
 assert.throws(()=>validateOpenedOriginal({...response,pdf:{...response.pdf,expires_in:9999}},selected),/prazo/);
});
test('originais e formulários ficam legíveis sem HTML de dados e sem afirmação de revisão',async t=>{
 const f=fixture(t);await f.handle.ready;
 assert.match(f.host.textContent,/Paciente <teste>/);assert.equal(f.host.querySelector('teste'),null);
 assert.match(f.host.textContent,/Sem vínculo nesta consulta/);assert.match(f.host.textContent,/Revisão profissional: pendente/);
 assert.equal(f.host.querySelectorAll('.cb-form-links a').length,7);
 for(const a of f.host.querySelectorAll('.cb-form-links a')){assert.equal(new URL(a.href).origin,'https://anamariajacob.com.br');assert.match(a.rel,/noreferrer/);}
 assert.equal(OFFICIAL_CLINICAL_FORMS.some(f=>f.url.endsWith('/anamnese/')),true);
});
test('vínculo de identidade antiga nunca aparece como vínculo atual válido',async t=>{
 const link={...original(),patient_id:'patient',visit_id:'visit',status:'vinculado_recebido',current_identity_matches:false,available:false,clinical_authorization:false};
 const f=fixture(t,{service:{listLinks:async()=>({links:[link]})}});await f.handle.ready;
 assert.match(f.host.textContent,/Vínculo histórico indisponível/);assert.doesNotMatch(f.host.textContent,/Vinculado a esta consulta/);assert.equal(f.host.querySelector('[data-cb="link"]'),null);
});
test('pedido aceito no CRM não é horário confirmado e não expõe ação de agendamento',async t=>{
 const f=fixture(t,{section:'requests',service:{listSiteRequests:async()=>({solicitacoes_site:[{id:'request',nome:'Pessoa teste',status:'accepted',data_preferida:'2026-10-20',consentimento_contato:true}],paginacao:{limit:25,offset:0,has_more:false}})}});await f.handle.ready;
 assert.match(f.host.textContent,/Recebida no CRM/);assert.match(f.host.textContent,/Sem confirmação de agenda/);assert.equal(f.host.querySelector('[data-action="schedule-request"]'),null);
});
test('falha de leitura não usa fallback nem mantém os originais da resposta anterior',async t=>{
 let fail=false,calls=0;const f=fixture(t,{service:{listDocuments:async()=>{calls++;if(fail)throw Error('Serviço indisponível');return listed();}}});await f.handle.ready;assert.match(f.host.textContent,/Paciente <teste>/);
 fail=true;await f.handle.refresh();assert.doesNotMatch(f.host.textContent,/Paciente <teste>/);assert.match(f.host.textContent,/Consulta indisponível/);assert.equal(calls,2);
});
test('resposta de leitura atrasada não repõe dados após saída da sessão',async t=>{
 const d=deferred(),f=fixture(t,{service:{listDocuments:()=>d.promise}});f.invalidate();d.resolve(listed());await f.handle.ready;
 assert.match(f.host.textContent,/Acesso encerrado/);assert.doesNotMatch(f.host.textContent,/Paciente <teste>/);
});
test('PDF é temporário, sem opener/referrer e janela fecha ao invalidar',async t=>{
 const f=fixture(t);await f.handle.ready;f.host.querySelector('[data-cb="pdf"]').click();await tick();
 assert.equal(f.opened[0].url,pdfURL());assert.equal(f.opened[0].opener,null);assert.equal(f.opened[0].document.querySelector('meta[name="referrer"]').content,'no-referrer');
 assert.equal(f.host.innerHTML.includes('token=synthetic'),false);f.invalidate();assert.equal(f.opened[0].closed,true);
});
test('PDF de resposta tardia é descartado quando muda a consulta',async t=>{
 const d=deferred(),f=fixture(t,{service:{openDocument:()=>d.promise}});await f.handle.ready;f.host.querySelector('[data-cb="pdf"]').click();f.setContext({...context(),visitId:'other'});d.resolve({document:original(),pdf:{url:pdfURL(),sha256:'b'.repeat(64),expires_in:120}});await tick();
 assert.equal(f.opened[0].url,null);assert.equal(f.opened[0].closed,true);
});
test('vínculo exige confirmação, conserva rascunho e bloqueia descarte enquanto grava',async t=>{
 const d=deferred(),payloads=[];let pending=null;const f=fixture(t,{service:{linkDocument:p=>{payloads.push(p);pending={payload:p,rejected:false};return d.promise;},getPendingLink:()=>pending}});await f.handle.ready;
 f.host.querySelector('[data-cb="link"]').click();let form=f.host.querySelector('[data-cb-link-form]');form.dispatchEvent(new f.dom.window.Event('submit',{bubbles:true,cancelable:true}));await tick();assert.equal(payloads.length,0);assert.equal(f.handle.isDirty(),true);
 form.elements.confirmed.checked=true;form.elements.reason.value='Identidade conferida no original';form.dispatchEvent(new f.dom.window.Event('submit',{bubbles:true,cancelable:true}));await tick();
 assert.equal(payloads[0].expected_revision,6);assert.equal(payloads[0].patient_id,'patient');assert.equal(payloads[0].confirmed_identity,true);assert.equal(f.handle.isBusy(),true);assert.equal(f.handle.discard(),false);assert.equal(f.host.querySelector('form[data-cb-link-form]').inert,true);
 pending=null;d.resolve({link:{},operation:{}});await tick();await tick();assert.equal(f.handle.isDirty(),false);assert.equal(f.handle.isBusy(),false);assert.match(f.notices.at(-1)[0],/vinculado como recebido/);
});
test('409 preserva motivo/seleção e atualiza revisão sem reconfirmar a identidade automaticamente',async t=>{
 let pending=null,revision=6;const c=()=>({...context(),revision});const f=fixture(t,{getContext:c,reloadContext:async()=>{revision=7;},service:{linkDocument:async p=>{pending={payload:p,rejected:true};throw Object.assign(Error('Conflito de revisão'),{status:409});},getPendingLink:()=>pending,discardRejectedLink:()=>{pending=null;}}});await f.handle.ready;
 fillLink(f).dispatchEvent(new f.dom.window.Event('submit',{bubbles:true,cancelable:true}));await tick();
 assert.equal(f.handle.isDirty(),true);assert.match(f.host.querySelector('[name="reason"]').value,/Identidade conferida/);assert.ok(f.host.querySelector('[data-cb="refresh-link"]'));
 f.host.querySelector('[data-cb="refresh-link"]').click();await tick();await tick();
 assert.equal(pending,null);assert.equal(f.host.querySelector('[name="confirmed"]').checked,false);assert.match(f.host.querySelector('[name="reason"]').value,/Identidade conferida/);assert.equal(f.handle.isDirty(),true);
});
test('operação incerta mantém seleção e não permite descartar quando status continua ausente',async t=>{
 let pending=null;const f=fixture(t,{service:{linkDocument:async p=>{pending={payload:p,rejected:false};throw Error('Resposta perdida');},getPendingLink:()=>pending,resolveLink:async()=>({pending:true})}});await f.handle.ready;
 fillLink(f).dispatchEvent(new f.dom.window.Event('submit',{bubbles:true,cancelable:true}));await tick();assert.equal(f.handle.hasUncertain(),true);assert.equal(f.handle.discard(),false);
 f.host.querySelector('[data-cb="resolve-link"]').click();await tick();assert.equal(f.handle.isDirty(),true);assert.equal(f.handle.hasUncertain(),true);assert.match(f.host.textContent,/ainda não confirmou/);
 f.invalidate();assert.equal(f.handle.isDirty(),false);assert.doesNotMatch(f.host.textContent,/Identidade conferida/);
});
