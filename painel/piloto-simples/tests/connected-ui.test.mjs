import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {configureRuntimeStore,isConnected} from '../runtime-store.mjs';
import {configureClinicalBridge,clearClinicalBridge} from '../clinical-bridge-runtime.mjs';
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
 const savedDescriptors=new Map(['document','FormData','confirm','window','location','navigator','fetch','addEventListener','removeEventListener'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 let printed='',copied='',mutations=0,notifications=[];const requests=[],listeners=new Set(),session={requireReady:async()=>({token:'synthetic'}),assertCurrent:async()=>{},subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);}};
 const printWindow={document:{open(){},write(html){printed=html;},close(){},getElementById(){return{};}},print(){}};
 for(const[key,value]of Object.entries({document:w.document,FormData:w.FormData,confirm:()=>false,window:{open:()=>printWindow},location:w.location,navigator:{clipboard:{writeText:async value=>{copied=value;}}},addEventListener:w.addEventListener.bind(w),removeEventListener:w.removeEventListener.bind(w),fetch:async(_url,init)=>{requests.push(JSON.parse(init.body));return Response.json({ok:true,auth_method:'supabase_auth',role:'owner',clinic_id:'11111111-1111-4111-8111-111111111111',issues:[]});}}))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 w.HTMLCanvasElement.prototype.getContext=()=>({clearRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){}});
 t.after(()=>{clearClinicalBridge();for(const[key,descriptor]of savedDescriptors){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}w.close();});
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
 configureClinicalBridge({session,listDocuments(){},listSiteRequests(){},dispose(){for(const fn of [...listeners])fn();}});
 assert.equal(host.querySelector('[data-doc="sign"]').disabled,false);
 // The connected action opens the server receipt flow, never the demo signer.
 host.querySelector('[data-doc="sign"]').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));await tick();
 assert.equal(mutations,0);const delivery=w.document.querySelector('dialog');assert.ok(delivery);assert.match(delivery.textContent,/Gerar link para a paciente/);assert.equal(delivery.querySelector('canvas'),null);assert.equal(delivery.querySelector('[name=reviewed]').checked,false);assert.equal(requests.length,1);assert.equal(requests[0].acao,'listar_emissoes_documento');delivery.querySelector('[data-delivery=close]').click();
 host.querySelector('[data-doc="link"]').click();await tick();
 assert.equal(copied,'');assert.equal(requests.length,2);assert.ok(requests.every(x=>x.acao==='listar_emissoes_documento'));assert.ok(w.document.querySelector('[data-issue]'));w.document.querySelector('[data-delivery=close]').click();
 assert.match(renderPatientsPage(state),/Ambiente conectado em homologação/);assert.match(renderClinicPage(state),/Configuração no servidor/);
 assert.match(catalogPage(state,{section:'overview'}),/Homologação conectada/);
 printable('Teste',`<p>${userText}</p>`);assert.match(printed,/Ambiente conectado em homologação/);assert.ok(printed.includes(userText));
 const proposal={patientId:'demo-marina',title:'Teste',version:1,status:'rascunho',items:[{id:'item',procedureId:'procedure',name:'Item local',sessions:1,unitPrice:10000,unitCost:1000}],notes:userText,discountBps:0};
 const quoteHTML=quoteDocumentHTML(state,proposal);assert.match(quoteHTML,/HOMOLOGAÇÃO CONECTADA/);assert.ok(quoteHTML.includes('piloto local, neste navegador, demonstração &lt;preservar&gt;.'));
 assert.equal(state.patients[0].notes,userText);assert.equal(document.snapshot.body,userText);assert.equal(document.status,'rascunho');assert.equal(mutations,0);
});
