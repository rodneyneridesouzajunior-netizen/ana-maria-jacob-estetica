import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {configureRuntimeStore,isConnected} from '../runtime-store.mjs';
import {seed} from '../domain.mjs';
import {ensureDocuments,saveTemplate,prepareDocument} from '../documents-domain.mjs';
import {renderDocumentsPage,mountDocuments} from '../documents-ui.mjs';
import {renderPatientsPage} from '../patients-ui.mjs';
import {renderClinicPage} from '../clinic-ui.mjs';
import {catalogPage,quoteDocumentHTML} from '../operations-ui.mjs';
import {printable} from '../feature-ui.mjs';
const require=createRequire(new URL('../../../../../skinpro-analise/test-tools/package.json',import.meta.url));
const {JSDOM}=require('jsdom');
const tick=()=>new Promise(resolve=>setImmediate(resolve));

// One isolated Node test process deliberately changes local -> connected once.
// The provider is an in-memory stub: this test makes no network or clinical write.
test('modo conectado preserva conteúdo e impede assinatura demo, inclusive em formulário aberto antes da conexão',async t=>{
 const dom=new JSDOM('<!doctype html><body><main></main></body>',{url:'https://example.invalid/app/'}),w=dom.window;
 const savedDescriptors=new Map(['document','FormData','confirm','window','location','navigator'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 let printed='',copied='',mutations=0,notifications=[];
 const printWindow={document:{open(){},write(html){printed=html;},close(){},getElementById(){return{};}},print(){}};
 for(const[key,value]of Object.entries({document:w.document,FormData:w.FormData,confirm:()=>false,window:{open:()=>printWindow},location:w.location,navigator:{clipboard:{writeText:async value=>{copied=value;}}}}))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 w.HTMLCanvasElement.prototype.getContext=()=>({clearRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){}});
 t.after(()=>{for(const[key,descriptor]of savedDescriptors){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}w.close();});
 const state=seed();ensureDocuments(state);
 const userText='Observação digitada: piloto local, neste navegador, demonstração <preservar>.';
 state.patients[0].notes=userText;
 saveTemplate(state,{id:'template',kind:'anamnese',title:'Modelo de teste',body:userText,questions:[]});
 const document=prepareDocument(state,{id:'doc',templateId:'template',patientId:'demo-marina',visitId:'demo-consulta'});
 const host=w.document.querySelector('main');host.innerHTML=renderDocumentsPage(state);
 mountDocuments(host,{getState:()=>state,mutate:async()=>{mutations++;},notify:(...args)=>notifications.push(args),rerender:async()=>{}});
 assert.equal(isConnected(),false);assert.equal(host.querySelector('[data-doc="sign"]').disabled,false);
 assert.match(renderPatientsPage(state),/Demonstração local/);assert.match(renderClinicPage(state),/Configuração local/);
 assert.match(catalogPage(state,{section:'overview'}),/salvos neste navegador/);
 host.querySelector('[data-doc="sign"]').click();
 const staleDialog=w.document.querySelector('dialog');assert.ok(staleDialog);
 printable('Teste',`<p>${userText}</p>`);assert.match(printed,/Demonstração local com dados fictícios/);

 configureRuntimeStore({load:async()=>state,commit:async()=>{},getPhoto:async()=>null});
 assert.equal(isConnected(),true);
 staleDialog.querySelector('form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();
 assert.match(staleDialog.querySelector('.error').textContent,/indisponível no ambiente conectado/);assert.equal(mutations,0);
 staleDialog.close();host.innerHTML=renderDocumentsPage(state);
 assert.equal(host.querySelector('[data-doc="sign"]').disabled,true);
 // A programmatically dispatched event cannot bypass the disabled control.
 host.querySelector('[data-doc="sign"]').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));await tick();
 assert.equal(mutations,0);assert.equal(w.document.querySelector('dialog'),null);assert.match(notifications.at(-1)[0],/não foi homologada/);
 host.querySelector('[data-doc="link"]').click();await tick();
 assert.equal(copied,'https://example.invalid/app/#documento/doc');assert.match(notifications.at(-1)[0],/conta autorizada/);
 assert.match(renderPatientsPage(state),/Ambiente conectado em homologação/);assert.match(renderClinicPage(state),/Configuração no servidor/);
 assert.match(catalogPage(state,{section:'overview'}),/Homologação conectada/);
 printable('Teste',`<p>${userText}</p>`);assert.match(printed,/Ambiente conectado em homologação/);assert.ok(printed.includes(userText));
 const proposal={patientId:'demo-marina',title:'Teste',version:1,status:'rascunho',items:[{id:'item',procedureId:'procedure',name:'Item local',sessions:1,unitPrice:10000,unitCost:1000}],notes:userText,discountBps:0};
 const quoteHTML=quoteDocumentHTML(state,proposal);assert.match(quoteHTML,/HOMOLOGAÇÃO CONECTADA/);assert.ok(quoteHTML.includes('piloto local, neste navegador, demonstração &lt;preservar&gt;.'));
 assert.equal(state.patients[0].notes,userText);assert.equal(document.snapshot.body,userText);assert.equal(document.status,'rascunho');assert.equal(mutations,0);
});
