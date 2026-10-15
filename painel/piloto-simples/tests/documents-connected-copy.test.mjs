import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {configureRuntimeStore} from '../runtime-store.mjs';
import {seed} from '../domain.mjs';
import {ensureDocuments,saveTemplate,prepareDocument} from '../documents-domain.mjs';
import {templateEditor,responseEditor,documentBody} from '../documents-editor.mjs';
import {mountOperations} from '../operations-ui.mjs';
const require=createRequire(new URL('../../../../../skinpro-analise/test-tools/package.json',import.meta.url));
const {JSDOM}=require('jsdom');
// Only the local test provider changes. No browser, backend or auth is involved.
configureRuntimeStore({load:async()=>null,commit:async()=>{},getPhoto:async()=>null});
function dom(t){
 const d=new JSDOM('<body><main></main></body>'),w=d.window,keys=['document','FormData','confirm','AbortController'],saved=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 for(const[k,v]of Object.entries({document:w.document,FormData:w.FormData,confirm:()=>true,AbortController:w.AbortController}))Object.defineProperty(globalThis,k,{value:v,writable:true,configurable:true});
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 t.after(()=>{for(const[k,v]of saved){if(v)Object.defineProperty(globalThis,k,v);else delete globalThis[k];}w.close();});return w;
}
test('connected document editors describe drafts and official signature without changing user text or signed-demo labels',t=>{
 const w=dom(t),s=seed();ensureDocuments(s);const original='Texto da profissional: demonstração local — preservar.';
 saveTemplate(s,{id:'term',kind:'termo',title:'Modelo fictício',body:original,questions:[]});
 const model=templateEditor(s,'term',async()=>{});assert.equal(model.querySelector('[name=body]').value,original);assert.doesNotMatch(model.querySelector('.small-label').textContent,/demonstração local/);assert.match(model.querySelector('.small-label').textContent,/Revise o conteúdo/);
 const record=prepareDocument(s,{id:'doc',templateId:'term',patientId:'demo-marina',visitId:'demo-consulta'}),response=responseEditor(record,s,async()=>{});
 assert.match(response.textContent,/rascunho incompleto/);assert.match(response.textContent,/assinatura clínica é realizada pelo fluxo oficial/);assert.doesNotMatch(response.textContent,/antes da assinatura de demonstração/);
 assert.match(documentBody({...record,kind:'imagem',imageUse:'publicacao'},s),/Publicação solicitada em rascunho/);
 const demo={...record,status:'assinado_demo',signature:{strokes:[[{x:0,y:0},{x:1,y:1}]],signerName:'Fictício',signedAt:'2026-10-15',contentHash:'a'.repeat(64)}};
 assert.match(documentBody(demo,s),/Assinatura de demonstração/);assert.match(documentBody(demo,s),/Texto da profissional/);assert.ok(w.document.querySelector('dialog'));
});
test('catalog DOM shows the main term as included and preserves every prior additional requirement while switching it',t=>{
 const w=dom(t),host=w.document.querySelector('main'),s={documentTemplates:[{id:'a',kind:'termo',title:'Termo A'},{id:'b',kind:'termo',title:'Termo B'},{id:'anam',kind:'anamnese',title:'Anamnese'}],procedures:[{id:'proc',name:'Procedimento fictício',price:10000,cost:0,duration:30,returnDays:0,recordMode:'simple',consentTemplateId:'a',requiredDocumentIds:['a','anam','not-loaded'],active:true,version:1}]};
 host.innerHTML='<button data-op="procedure-edit" data-id="proc">Editar</button>';const errors=[];const dispose=mountOperations(host,{getState:()=>s,notify:(m,error)=>{if(error)errors.push(m);}});t.after(dispose);host.querySelector('button').click();assert.deepEqual(errors,[]);
 const form=host.querySelector('form'),primary=form.elements.consentTemplateId;
 assert.equal(primary.options[0].textContent,'Nenhum termo específico');
 const field=id=>form.querySelector(`input[type=checkbox][value="${id}"]`),values=()=>new w.FormData(form).getAll('requiredDocumentIds').sort();
 assert.equal(field('a').hidden,true);assert.equal(field('a').disabled,true);assert.equal(field('a').closest('label').querySelector('[data-principal-note]').hidden,false);assert.deepEqual(values(),['a','anam','not-loaded']);
 primary.value='b';primary.dispatchEvent(new w.Event('change',{bubbles:true}));assert.equal(field('a').hidden,false);assert.equal(field('a').checked,true);assert.equal(field('b').hidden,true);assert.deepEqual(values(),['a','anam','not-loaded']);
 primary.value='';primary.dispatchEvent(new w.Event('change',{bubbles:true}));assert.equal(field('b').hidden,false);assert.equal(field('b').checked,false);assert.deepEqual(values(),['a','anam','not-loaded']);assert.equal(form.dataset.unsaved,'true');
});
