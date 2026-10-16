// Real DOM/FormData in jsdom 26.1.0, isolated in workspace test-tools.
// This exercises actual editor event handlers; it does not start a browser or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {seed} from '../domain.mjs';
import {ensureDocuments,saveTemplate,prepareDocument} from '../documents-domain.mjs';
import {templateEditor,responseEditor} from '../documents-editor.mjs';
const require=createRequire(new URL('../../../../../skinpro-analise/test-tools/package.json',import.meta.url));
const {JSDOM}=require('jsdom');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness(t){
 const dom=new JSDOM('<!doctype html><body></body>',{url:'https://example.invalid/app/'}),w=dom.window,previous={document:globalThis.document,FormData:globalThis.FormData,confirm:globalThis.confirm};
 Object.assign(globalThis,{document:w.document,FormData:w.FormData,confirm:()=>false});
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 let state=seed(),saves=0;ensureDocuments(state);
 t.after(()=>{for(const [key,value]of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}w.close();});
 const event=(el,type)=>el.dispatchEvent(new w.Event(type,{bubbles:true,cancelable:true}));
 const set=(modal,name,value,type='input')=>{const field=modal.querySelector(`[name="${name}"]`);assert.ok(field,'Campo '+name);if(field.type==='checkbox')field.checked=value;else field.value=value;event(field,type);return field;};
 const save=async fn=>{const next=structuredClone(state);fn(next);state=next;saves++;};
 return{w,event,set,save,get state(){return state;},get saves(){return saves;}};
}

test('editor DOM salva etapas, opção de lista, condição e blocos ordenados sem perder campos digitados',async t=>{
 const h=harness(t),modal=templateEditor(h.state,null,h.save);
 h.set(modal,'title','Modelo fictício DOM');h.set(modal,'body','Texto introdutório preservado');
 modal.querySelector('[data-doc-edit="add-question"]').click();let first=modal.querySelector('[data-question]').dataset.question;
 h.set(modal,'label-'+first,'Primeira pergunta');h.set(modal,'type-'+first,'select','change');h.set(modal,'options-'+first,'Um\nDois');h.set(modal,'required-'+first,true,'change');
 modal.querySelector('[data-doc-edit="add-step"]').click();let second=modal.querySelectorAll('[data-doc-step]')[1];const sid=second.dataset.docStep;h.set(modal,'step-title-'+sid,'Segunda etapa');second.querySelector('[data-doc-edit="add-question"]').click();
 let child=modal.querySelectorAll('[data-question]')[1].dataset.question;h.set(modal,'label-'+child,'Detalhe fictício');h.set(modal,'type-'+child,'long','change');h.set(modal,'condition-'+child,first,'change');h.set(modal,'equals-'+child,'Um','change');
 modal.querySelector('[data-doc-edit="add-block"]').click();let block=modal.querySelector('[data-doc-block]').dataset.docBlock;h.set(modal,'block-title-'+block,'Bloco A');h.set(modal,'block-body-'+block,'Texto A\nSegunda linha');
 modal.querySelector('[data-doc-edit="add-block"]').click();let last=modal.querySelectorAll('[data-doc-block]')[1],lastId=last.dataset.docBlock;h.set(modal,'block-title-'+lastId,'Bloco B');h.set(modal,'block-body-'+lastId,'Texto B');last.querySelector('[data-doc-edit="move-block"][data-direction="up"]').click();
 assert.equal(modal.querySelector('[name=title]').value,'Modelo fictício DOM');assert.equal(modal.querySelector('[name=body]').value,'Texto introdutório preservado');assert.equal(modal.querySelector('form').dataset.unsaved,'true');
 h.event(modal.querySelector('form'),'submit');await tick();assert.equal(h.saves,1);const version=h.state.documentTemplates[0].versions[0];assert.equal(version.steps.length,2);assert.deepEqual(version.questions[0].options,['Um','Dois']);assert.equal(version.questions[0].required,true);assert.deepEqual(version.questions[1].condition,{questionId:first,value:'Um'});assert.deepEqual(version.blocks.map(x=>x.title),['Bloco B','Bloco A']);assert.equal(version.blocks[1].body,'Texto A\nSegunda linha');assert.equal(modal.isConnected,false);
});
test('editor DOM recusa mover/remover a origem de condição e conserva o texto não salvo',t=>{
 const h=harness(t);saveTemplate(h.state,{id:'template',kind:'anamnese',title:'Teste',body:'',questions:[{id:'a',label:'Origem',type:'yesno'},{id:'b',label:'Dependente',type:'text',condition:{questionId:'a',value:'Sim'}}],steps:[{id:'s1',title:'Etapa um',questionIds:['a']},{id:'s2',title:'Etapa dois',questionIds:['b']}]});const modal=templateEditor(h.state,'template',h.save);
 h.set(modal,'label-b','Texto digitado antes da reordenação');modal.querySelector('[data-id="s2"][data-doc-edit="move-step"][data-direction="up"]').click();assert.match(modal.querySelector('.error').textContent,/condição/);assert.deepEqual([...modal.querySelectorAll('[data-doc-step]')].map(x=>x.dataset.docStep),['s1','s2']);assert.equal(modal.querySelector('[name=label-b]').value,'Texto digitado antes da reordenação');
 modal.querySelector('[data-id="a"][data-doc-edit="remove-question"]').click();assert.match(modal.querySelector('.error').textContent,/condição/);assert.equal(modal.querySelectorAll('[data-question]').length,2);
});
test('preenchimento DOM navega etapas, limpa cadeia condicional oculta e salva somente respostas visíveis',async t=>{
 const h=harness(t);saveTemplate(h.state,{id:'template',kind:'anamnese',title:'Teste',body:'',questions:[{id:'a',label:'Origem',type:'yesno',required:true},{id:'b',label:'Escolha',type:'yesnona',condition:{questionId:'a',value:'Sim'}},{id:'c',label:'Detalhe',type:'long',required:true,condition:{questionId:'b',value:'Não se aplica'}}],steps:[{id:'s1',title:'Etapa um',questionIds:['a']},{id:'s2',title:'Etapa dois',questionIds:['b','c']}]});const d=prepareDocument(h.state,{id:'doc',templateId:'template',patientId:'demo-marina',visitId:'demo-consulta'}),modal=responseEditor(d,h.state,h.save);
 assert.equal(modal.querySelector('[name=answer-b]').disabled,true);h.set(modal,'answer-a','Sim','change');assert.equal(modal.querySelector('[name=answer-b]').disabled,false);modal.querySelector('[data-response-next]').click();assert.equal(modal.querySelector('[data-response-step="1"]').hidden,false);
 h.set(modal,'answer-b','Não se aplica','change');h.set(modal,'answer-c','Texto condicional');modal.querySelector('[data-response-prev]').click();assert.equal(modal.querySelector('[name=answer-c]').value,'Texto condicional');h.set(modal,'answer-a','Não','change');assert.equal(modal.querySelector('[name=answer-b]').value,'');assert.equal(modal.querySelector('[name=answer-c]').value,'');assert.equal(modal.querySelector('[name=answer-c]').disabled,true);
 modal.querySelector('[data-response-next]').click();assert.equal(modal.querySelector('[data-response-step="1"] [data-empty-step]').hidden,false);h.event(modal.querySelector('form'),'submit');await tick();assert.equal(h.saves,1);assert.deepEqual(h.state.documentResponses[0].answers,{a:'Não'});
});
test('preenchimento DOM aceita zero de escala e decimal com vírgula; erro conserva respostas para correção',async t=>{
 const h=harness(t);saveTemplate(h.state,{id:'template',kind:'anamnese',title:'Teste',body:'',questions:[{id:'n',label:'Número',type:'number'},{id:'scale',label:'Escala',type:'scale',min:0,max:5},{id:'phone',label:'Telefone',type:'phone'}]});const d=prepareDocument(h.state,{id:'doc',templateId:'template',patientId:'demo-marina',visitId:'demo-consulta'}),modal=responseEditor(d,h.state,h.save);
 h.set(modal,'answer-n','1,25');h.set(modal,'answer-scale','0');h.set(modal,'answer-phone','inválido');h.event(modal.querySelector('form'),'submit');await tick();assert.equal(h.saves,0);assert.match(modal.querySelector('.error').textContent,/Telefone/);assert.equal(modal.querySelector('[name=answer-n]').value,'1,25');assert.equal(modal.isConnected,true);
 h.set(modal,'answer-phone','31999990000');h.event(modal.querySelector('form'),'submit');await tick();assert.equal(h.saves,1);assert.deepEqual(h.state.documentResponses[0].answers,{n:'1.25',scale:'0',phone:'31999990000'});
});
test('ações estruturais marcam rascunho e Esc não descarta sem confirmação',t=>{
 const h=harness(t),modal=templateEditor(h.state,null,h.save);modal.querySelector('[data-doc-edit="add-block"]').click();assert.equal(modal.querySelector('form').dataset.unsaved,'true');assert.equal(h.event(modal,'cancel'),false);assert.equal(modal.open,true);modal.querySelector('[data-close]').click();assert.equal(modal.open,true);
});

test('documento assinado abre leitura dentro do app sem popup nem mutação do original',async t=>{
 const h=harness(t);saveTemplate(h.state,{id:'read-only',kind:'anamnese',title:'TESTE <seguro>',body:'Texto preservado',questions:[{id:'answer',label:'Pergunta',type:'text'}]});
 const d=prepareDocument(h.state,{id:'signed-test',templateId:'read-only',patientId:'demo-marina',visitId:'demo-consulta'});
 d.answers={answer:'Resposta <script> sem execução'};d.status='assinado_demo';
 d.signature={signerName:'TESTE',signedAt:'2026-10-16T12:00:00Z',contentHash:'a'.repeat(64),strokes:[[{x:.1,y:.2},{x:.3,y:.4}]]};
 const before=JSON.stringify(d),modal=responseEditor(d,h.state,h.save);
 assert.equal(modal.open,true);assert.match(modal.textContent,/Visualização somente para leitura/);
 assert.match(modal.querySelector('.document-readonly').textContent,/Resposta <script> sem execução/);
 assert.equal(modal.querySelector('.document-readonly script'),null);
 assert.equal(modal.querySelectorAll('input,textarea,select').length,0);
 assert.equal(modal.querySelector('polyline').getAttribute('points'),'100,72 300,144');
 assert.ok(modal.querySelector('[data-preview-download]'));assert.ok(modal.querySelector('[data-preview-print]'));
 h.event(modal.querySelector('form'),'submit');await tick();
 assert.equal(h.saves,0);assert.equal(JSON.stringify(d),before);assert.equal(modal.isConnected,false);
});

test('popup bloqueado conserva a leitura do documento e oferece download alternativo',t=>{
 const h=harness(t);saveTemplate(h.state,{id:'read-only',kind:'termo',title:'TESTE',body:'Texto preservado',questions:[]});
 const d=prepareDocument(h.state,{id:'signed-test',templateId:'read-only',patientId:'demo-marina',visitId:'demo-consulta'});d.status='assinado_demo';
 const prior=Object.getOwnPropertyDescriptor(globalThis,'window');Object.defineProperty(globalThis,'window',{configurable:true,value:{open:()=>null}});
 t.after(()=>{if(prior)Object.defineProperty(globalThis,'window',prior);else delete globalThis.window;});
 const modal=responseEditor(d,h.state,h.save);modal.querySelector('[data-preview-print]').click();
 assert.equal(modal.open,true);assert.match(modal.querySelector('.error').textContent,/Permita a abertura/);
 assert.match(modal.querySelector('.document-readonly').textContent,/Texto preservado/);assert.ok(modal.querySelector('[data-preview-download]'));
});

test('relatório financeiro abre leitura sem popup e preserva os valores e o estado',async t=>{
 const h=harness(t),{mountFinance}=await import('../finance-ui.mjs');
 const host=h.w.document.createElement('main');host.innerHTML='<div data-finance-period="month" data-finance-today="2026-10-16"></div><button data-fin="print">Relatório / PDF</button>';h.w.document.body.append(host);
 const {ensureFinance}=await import('../finance-domain.mjs');ensureFinance(h.state);const before=JSON.stringify(h.state),messages=[];
 mountFinance(host,{getState:()=>h.state,mutate:()=>assert.fail('Leitura não pode gravar'),notify:m=>messages.push(m),rerender:()=>{}});
 host.querySelector('button').click();await tick();
 const modal=h.w.document.querySelector('dialog');assert.ok(modal?.open);assert.match(modal.textContent,/Resumo financeiro/);assert.match(modal.textContent,/01\/10\/2026 a 16\/10\/2026/);assert.match(modal.textContent,/recebido líquido/);assert.match(modal.textContent,/Não representa lucro líquido/);
 assert.ok(modal.querySelector('[data-preview-download]'));assert.equal(JSON.stringify(h.state),before);assert.deepEqual(messages,[]);
});
