import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {seed} from '../domain.mjs';
import {CLINIC_DOCUMENT_MODELS} from '../document-library.mjs';
import {ensureDocuments,saveTemplate,prepareDocument} from '../documents-domain.mjs';
import {templateEditor} from '../documents-editor.mjs';
import {importClinicDocumentModels,mountDocuments,renderDocumentsPage} from '../documents-ui.mjs';
import {emptyState,validateTransition} from '../../../supabase/functions/app-workspace/rules.mjs';
const require=createRequire(new URL('../../../../../skinpro-analise/test-tools/package.json',import.meta.url));
const {JSDOM}=require('jsdom');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const fresh=()=>{const s=seed();ensureDocuments(s);s.documentTemplates=[];s.documentResponses=[];s.documentHistory=[];return s;};

function harness(t,{state=fresh(),visitId,mutateHook}={}){
 const dom=new JSDOM('<!doctype html><body><main></main></body>',{url:'https://example.invalid/app/'}),w=dom.window;
 const globals={document:w.document,FormData:w.FormData,confirm:()=>true},saved=new Map(Object.keys(globals).map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 for(const[k,value]of Object.entries(globals))Object.defineProperty(globalThis,k,{value,writable:true,configurable:true});
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 t.after(()=>{for(const[k,descriptor]of saved){if(descriptor)Object.defineProperty(globalThis,k,descriptor);else delete globalThis[k];}w.close();});
 const host=w.document.querySelector('main'),notifications=[];let mutations=0;
 const rerender=async()=>{host.innerHTML=renderDocumentsPage(state,{visitId});};
 const mutate=async fn=>{mutations++;if(mutateHook)await mutateHook();const next=structuredClone(state);fn(next);state=next;};
 void rerender();mountDocuments(host,{getState:()=>state,mutate,rerender,notify:(...args)=>notifications.push(args),visitId});
 const event=(el,type)=>el.dispatchEvent(new w.Event(type,{bubbles:true,cancelable:true}));
 return{w,host,event,notifications,rerender,mutate,get state(){return state;},get mutations(){return mutations;},setState(next){state=next;},get modal(){return w.document.querySelector('dialog');}};
}

test('batch import is idempotent by stable ID and preserves edited versions and issued snapshots',()=>{
 const s=fresh(),first=CLINIC_DOCUMENT_MODELS[0];
 importClinicDocumentModels(s,[first.id]);
 const issued=prepareDocument(s,{id:'issued-original',templateId:first.id,patientId:'demo-marina',visitId:'demo-consulta'});
 saveTemplate(s,{...structuredClone(first),expectedVersion:1,title:'Versão própria revisada',body:'Texto editado pela profissional'});
 const preserved=structuredClone(s.documentTemplates[0]),original=structuredClone(issued),history=structuredClone(s.documentHistory);
 const all=CLINIC_DOCUMENT_MODELS.map(t=>t.id),result=importClinicDocumentModels(s,[...all,...all]);
 assert.equal(result.added.length,all.length-1);assert.deepEqual(result.preserved,[first.id]);
 assert.deepEqual(s.documentTemplates.find(t=>t.id===first.id),preserved);assert.deepEqual(issued,original);
 assert.deepEqual(s.documentHistory.slice(0,history.length),history);assert.equal(s.documentTemplates.length,all.length);
 const before=structuredClone(s);const retry=importClinicDocumentModels(s,all);
 assert.equal(retry.added.length,0);assert.equal(retry.preserved.length,all.length);assert.deepEqual(s,before);
});

test('invalid or empty import selection fails before adding any model',()=>{
 const s=fresh(),before=structuredClone(s);
 assert.throws(()=>importClinicDocumentModels(s,[]),/Selecione/);
 assert.throws(()=>importClinicDocumentModels(s,[CLINIC_DOCUMENT_MODELS[0].id,'unknown']),/não encontrado/);
 assert.deepEqual(s,before);
});

test('the complete library passes server validation in one transition and remains valid on replay',()=>{
 const before=emptyState(),next=structuredClone(before);importClinicDocumentModels(next,CLINIC_DOCUMENT_MODELS.map(t=>t.id));
 assert.doesNotThrow(()=>validateTransition(before,next));assert.equal(next.documentTemplates.length,CLINIC_DOCUMENT_MODELS.length);
 const replay=structuredClone(next);importClinicDocumentModels(replay,CLINIC_DOCUMENT_MODELS.map(t=>t.id));
 assert.deepEqual(replay,next);assert.doesNotThrow(()=>validateTransition(next,replay));
});

test('a single IndexedDB commit survives reopen with every library model and its exact first version',async t=>{
 const {IDBFactory}=require('fake-indexeddb'),previous=Object.getOwnPropertyDescriptor(globalThis,'indexedDB');
 Object.defineProperty(globalThis,'indexedDB',{value:new IDBFactory(),writable:true,configurable:true});
 const api=await import('../store.mjs?document-library-persistence'),db=await api.connect();
 t.after(()=>{db.close();if(previous)Object.defineProperty(globalThis,'indexedDB',previous);else delete globalThis.indexedDB;});
 const original=await api.load(),saved=await api.commit(original.revision,s=>importClinicDocumentModels(s,CLINIC_DOCUMENT_MODELS.map(t=>t.id)));
 assert.equal(saved.revision,original.revision+1);
 const reopened=await api.load();assert.deepEqual(reopened,saved);assert.equal(reopened.documentTemplates.length,CLINIC_DOCUMENT_MODELS.length);
 for(const model of CLINIC_DOCUMENT_MODELS){const template=reopened.documentTemplates.find(t=>t.id===model.id);assert.equal(template.versions.length,1);assert.equal(template.versions[0].body,model.body);assert.deepEqual(template.versions[0].questions,model.questions);assert.deepEqual(template.versions[0].blocks,model.blocks);}
});

test('library shows each built-in once, imported state and custom titles without HTML injection',t=>{
 const s=fresh(),first=CLINIC_DOCUMENT_MODELS[0];importClinicDocumentModels(s,[first.id]);
 saveTemplate(s,{...structuredClone(first),expectedVersion:1,title:'Título <img src=x onerror=alert(1)>'});
 saveTemplate(s,{id:'custom-only',kind:'termo',title:'Termo próprio',body:'Texto',questions:[]});
 const h=harness(t,{state:s}),cards=h.host.querySelectorAll('[data-doc-model]');
 assert.equal(cards.length,CLINIC_DOCUMENT_MODELS.length+1);assert.equal(new Set([...cards].map(c=>c.dataset.docModel)).size,cards.length);
 const card=h.host.querySelector(`[data-doc-model="${first.id}"]`);
 assert.match(card.textContent,/Título <img/);assert.equal(card.querySelector('img'),null);assert.match(card.textContent,/Versão 2/);
 assert.ok(card.querySelector('[data-doc="edit-template"]'));assert.equal(card.querySelector('[data-doc="preset"]'),null);
 assert.match(h.host.textContent,new RegExp('1 de '+CLINIC_DOCUMENT_MODELS.length+' modelos'));
 assert.match(h.host.textContent,/não aprova seu conteúdo clínico/);assert.equal(h.mutations,0);
});

test('search ignores accents, combines type filter and reports empty results without mutation',t=>{
 const h=harness(t),search=h.host.querySelector('[data-doc-search]'),kind=h.host.querySelector('[name=document-kind]');
 search.value='toxina botulinica';h.event(search,'input');
 const visible=()=>[...h.host.querySelectorAll('[data-doc-model]')].filter(c=>!c.hidden);
 assert.equal(visible().length,1);assert.match(visible()[0].textContent,/Toxina botulínica/i);
 kind.value='imagem';h.event(kind,'change');assert.equal(visible().length,0);assert.equal(h.host.querySelector('[data-doc-empty]').hidden,false);
 search.value='';h.event(search,'input');assert.equal(visible().length,CLINIC_DOCUMENT_MODELS.filter(m=>m.kind==='imagem').length);
 kind.value='';h.event(kind,'change');assert.equal(visible().length,CLINIC_DOCUMENT_MODELS.length);assert.equal(h.mutations,0);
});

test('batch dialog requires explicit selection and confirmation, then imports selected models in one mutation',async t=>{
 const h=harness(t);h.host.querySelector('[data-doc="import-models"]').click();const modal=h.modal;
 assert.ok(modal);assert.equal(h.mutations,0);assert.equal(modal.querySelectorAll('[name=models]:checked').length,0);
 assert.equal(modal.querySelector('button[type=submit]').textContent,'Adicionar selecionados');
 assert.match(modal.textContent,/não representa revisão ou aprovação clínica/);assert.equal(modal.querySelectorAll('details').length,CLINIC_DOCUMENT_MODELS.length);
 h.event(modal.querySelector('form'),'submit');await tick();assert.equal(h.mutations,0);assert.match(modal.querySelector('.error').textContent,/Selecione/);
 const chosen=[...modal.querySelectorAll('[name=models]')].slice(0,2);chosen.forEach(field=>{field.checked=true;h.event(field,'change');});
 assert.match(modal.querySelector('[data-model-selection]').textContent,/2 de/);
 h.event(modal.querySelector('form'),'submit');await tick();assert.equal(h.mutations,1);assert.equal(h.modal,null);
 assert.deepEqual(h.state.documentTemplates.map(t=>t.id),chosen.map(c=>c.value));assert.ok(h.state.documentTemplates.every(t=>t.versions.length===1));
 assert.equal(h.state.documentResponses.length,0);assert.match(h.notifications.at(-1)[0],/2 modelo\(s\) adicionado/);
});

test('select all and clear selection are reversible and closing the import dialog never saves',t=>{
 const h=harness(t);h.host.querySelector('[data-doc="import-models"]').click();const modal=h.modal;
 modal.querySelector('[data-model-select=all]').click();assert.equal(modal.querySelectorAll('[name=models]:checked').length,CLINIC_DOCUMENT_MODELS.length);
 modal.querySelector('[data-model-select=none]').click();assert.equal(modal.querySelectorAll('[name=models]:checked').length,0);
 modal.querySelector('[data-close]').click();assert.equal(h.modal,null);assert.equal(h.mutations,0);assert.equal(h.state.documentTemplates.length,0);
});

test('a stale import dialog preserves a model imported and edited in the meantime',async t=>{
 const h=harness(t);h.host.querySelector('[data-doc="import-models"]').click();const modal=h.modal;
 const [first,second]=CLINIC_DOCUMENT_MODELS,latest=structuredClone(h.state);importClinicDocumentModels(latest,[first.id]);
 saveTemplate(latest,{...structuredClone(first),expectedVersion:1,body:'Alteração mais recente preservada'});
 const preserved=structuredClone(latest.documentTemplates[0]);h.setState(latest);
 for(const id of [first.id,second.id])modal.querySelector(`[name=models][value="${id}"]`).checked=true;
 h.event(modal.querySelector('form'),'submit');await tick();
 assert.equal(h.mutations,1);assert.equal(h.state.documentTemplates.length,2);assert.deepEqual(h.state.documentTemplates.find(t=>t.id===first.id),preserved);
 assert.match(h.notifications.at(-1)[0],/1 modelo\(s\) já existente\(s\) preservado/);
});

test('commit failure retains selection and original state; double submit cannot duplicate the import',async t=>{
 let release,attempt=0;const barrier=new Promise(resolve=>release=resolve);
 const h=harness(t,{mutateHook:async()=>{if(++attempt===1){await barrier;throw Error('Conflito de revisão. Atualize e tente novamente.');}}});
 h.host.querySelector('[data-doc="import-models"]').click();const modal=h.modal,field=modal.querySelector('[name=models]');field.checked=true;
 h.event(field,'change');h.event(modal.querySelector('form'),'submit');h.event(modal.querySelector('form'),'submit');
 assert.equal(h.mutations,1);assert.equal(modal.querySelector('[data-close]').disabled,true);release();await tick();
 assert.equal(h.state.documentTemplates.length,0);assert.equal(field.checked,true);assert.ok(modal.isConnected);assert.match(modal.querySelector('.error').textContent,/Conflito/);
 h.event(modal.querySelector('form'),'submit');await tick();assert.equal(h.mutations,2);assert.equal(h.state.documentTemplates.length,1);assert.equal(h.state.documentTemplates[0].versions.length,1);
});

test('opening a previously imported preset edits the saved clinic version, never the library original',t=>{
 const s=fresh(),preset=CLINIC_DOCUMENT_MODELS[0];importClinicDocumentModels(s,[preset.id]);
 saveTemplate(s,{...structuredClone(preset),expectedVersion:1,title:'Versão adaptada',body:'Texto próprio preservado'});
 const h=harness(t,{state:s}),before=structuredClone(s),modal=templateEditor(s,null,h.mutate,{preset});
 assert.equal(modal.querySelector('[name=title]').value,'Versão adaptada');assert.equal(modal.querySelector('[name=body]').value,'Texto próprio preservado');
 assert.match(modal.textContent,/versão 2 salva pela clínica/);assert.equal(modal.querySelector('[name=kind]').disabled,true);assert.equal(modal.querySelector('[type=submit]').textContent,'Publicar nova versão');
 modal.querySelector('[data-close]').click();assert.deepEqual(s,before);assert.equal(h.mutations,0);
});

test('document preparation groups models by type, requires selection and disables existing drafts',async t=>{
 const s=fresh();importClinicDocumentModels(s,CLINIC_DOCUMENT_MODELS.map(t=>t.id));
 const first=CLINIC_DOCUMENT_MODELS[0],issued=prepareDocument(s,{id:'existing-draft',templateId:first.id,patientId:'demo-marina',visitId:'demo-consulta'}),original=structuredClone(issued);
 const h=harness(t,{state:s,visitId:'demo-consulta'});h.host.querySelector('[data-doc=prepare]').click();const modal=h.modal,select=modal.querySelector('[name=template]');
 assert.equal(select.value,'');assert.equal(select.required,true);assert.equal(select.querySelectorAll('optgroup').length,3);
 assert.equal(select.querySelector(`option[value="${first.id}"]`).disabled,true);assert.match(select.querySelector(`option[value="${first.id}"]`).textContent,/já preparado/);
 select.value=CLINIC_DOCUMENT_MODELS[1].id;h.event(modal.querySelector('form'),'submit');await tick();
 assert.equal(h.state.documentResponses.length,2);assert.deepEqual(h.state.documentResponses.find(d=>d.id==='existing-draft'),original);
 assert.equal(h.state.documentResponses.at(-1).templateId,CLINIC_DOCUMENT_MODELS[1].id);assert.equal(h.mutations,1);
});

test('a new template version published while selection is open requires a fresh review',async t=>{
 const s=fresh(),preset=CLINIC_DOCUMENT_MODELS[0];importClinicDocumentModels(s,[preset.id]);
 const h=harness(t,{state:s,visitId:'demo-consulta'});h.host.querySelector('[data-doc=prepare]').click();const modal=h.modal;
 modal.querySelector('[name=template]').value=preset.id;
 const latest=structuredClone(h.state);saveTemplate(latest,{...structuredClone(preset),expectedVersion:1,body:'Nova versão ainda não conferida'});h.setState(latest);
 h.event(modal.querySelector('form'),'submit');await tick();assert.equal(h.state.documentResponses.length,0);assert.match(modal.querySelector('.error').textContent,/modelo mudou/);assert.equal(modal.querySelector('[name=template]').value,preset.id);
});

test('preparation freezes the displayed version even when the same state object changes in place',async t=>{
 const s=fresh(),preset=CLINIC_DOCUMENT_MODELS[0];importClinicDocumentModels(s,[preset.id]);
 const h=harness(t,{state:s,visitId:'demo-consulta'});h.host.querySelector('[data-doc=prepare]').click();const modal=h.modal,option=modal.querySelector(`option[value="${preset.id}"]`);
 assert.match(option.textContent,/v1/);modal.querySelector('[name=template]').value=preset.id;
 saveTemplate(s,{...structuredClone(preset),expectedVersion:1,body:'Nova versão na mesma referência'});
 assert.match(option.textContent,/v1/);h.event(modal.querySelector('form'),'submit');await tick();
 assert.equal(h.state.documentResponses.length,0);assert.match(modal.querySelector('.error').textContent,/modelo mudou/);assert.equal(h.state.documentTemplates[0].versions.length,2);
});
