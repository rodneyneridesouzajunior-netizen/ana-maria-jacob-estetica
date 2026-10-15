import fs from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import * as rules from '../domain.mjs';
import {assertVisitEditable} from '../operations-domain.mjs';

// Real handlers, with a deliberately delayed transaction and a minimal DOM.
// This checks async state transitions; physical pointer/browser tests stay separate.
const source=(await fs.readFile(new URL('../app.mjs',import.meta.url),'utf8'))
  .replace(/^import .*$/gm,'')
  .replace(/^try\{await setHash\(\);\}catch.*$/gm,'');
function harness(){
 const listeners=new Map(),elements=new Map(),queued=[];
 let workspace=rules.seed(),confirmAnswer=true;
 workspace.visits[0].maps['demo-foto'].points=['a','b'].map((id,i)=>({id,kind:'ponto',x:.2+i*.3,y:.3,region:'Região '+id,product:'',quantity:null,unit:'sem quantidade',lot:'',notes:''}));
 const el=id=>{
   if(!elements.has(id))elements.set(id,{id,value:'',textContent:'',innerHTML:'',disabled:false,hidden:false,style:{},dataset:{},classList:{toggle(){return false;}},reset(){},focus(){},addEventListener(){},querySelector(){return el('submit');},showModal(){this.open=true;},close(){this.open=false;}});
   return elements.get(id);
 };
 const document={getElementById:el,querySelector:selector=>selector.includes('undo-map')?el('undo'):null,querySelectorAll:()=>[],addEventListener:(type,fn)=>{const list=listeners.get(type)||[];list.push(fn);listeners.set(type,list);},visibilityState:'visible'};
 const context=vm.createContext({...rules,assertVisitEditable,isConnected:()=>false,structuredClone,crypto:webcrypto,console,document,location:{hash:'#paciente/demo-marina/demo-consulta/mapa'},history:{replaceState(){}},window:{addEventListener(){}},confirm:()=>confirmAnswer,setTimeout:()=>0,clearTimeout(){},load:async()=>structuredClone(workspace),getPhoto:async()=>null,commit:(revision,update)=>new Promise((resolve,reject)=>queued.push(()=>{
   try{assert.equal(revision,workspace.revision);const next=structuredClone(workspace);update(next);next.revision++;workspace=next;resolve(structuredClone(next));}catch(error){reject(error);}
 }))});
 vm.runInContext(source,context);
 context.initial=structuredClone(workspace);
 vm.runInContext("state=initial;patientId='demo-marina';visitId='demo-consulta';photoId='demo-foto';route='paciente';tab='mapa';selectedId='a';",context);
 return {context,el,listeners,run:code=>vm.runInContext(code,context),flush:()=>queued.shift()(),points:()=>workspace.visits[0].maps['demo-foto'].points,workspace:()=>workspace,confirm:value=>confirmAnswer=value};
}
const actionEvent=action=>({target:{closest:selector=>selector==='[data-action]'?{dataset:{action}}:null}});
const submitEvent=id=>({target:{id},preventDefault(){}});
function preparePoint(h){h.el('point-region').value='Edição de a';h.el('point-unit').value='sem quantidade';h.run('dirty=true');}

test('excluir mantém o alvo capturado mesmo se a seleção mudar antes da transação',async()=>{
 const h=harness(),promise=h.listeners.get('click')[0](actionEvent('delete-point'));
 h.run("selectedId='b'");h.flush();await promise;
 assert.deepEqual(h.points().map(p=>p.id),['b']);
});
test('salvar edição mantém IDs únicos e preserva as outras marcações',async()=>{
 const h=harness();preparePoint(h);
 const promise=h.listeners.get('submit')[0](submitEvent('point-form'));
 h.run("selectedId='b'");h.flush();await promise;
 assert.deepEqual(h.points().map(p=>p.id),['a','b']);
 assert.equal(h.points()[0].region,'Edição de a');assert.equal(h.points()[1].region,'Região b');
});
test('seleção e controles do mapa ficam protegidos durante o commit',async()=>{
 const h=harness(),promise=h.listeners.get('click')[0](actionEvent('delete-point'));
 assert.equal(h.el('content').inert,true);h.run("selectPoint('b')");
 assert.equal(h.run('selectedId'),'a');h.flush();await promise;
 assert.equal(h.el('content').inert,false);assert.equal(h.run('busy'),false);
});
test('notas digitadas durante um salvamento continuam marcadas como pendentes',async()=>{
 const h=harness();h.el('visit-notes').value='Texto A antes de salvar';h.run('dirty=true');
 const promise=h.listeners.get('submit')[0](submitEvent('record-form'));
 h.el('visit-notes').value='Texto B digitado durante o salvamento';
 h.listeners.get('input')[0]({target:{id:'visit-notes',closest:()=>null}});
 h.flush();await promise;
 assert.equal(h.workspace().visits[0].notes,'Texto A antes de salvar');
 assert.equal(h.el('visit-notes').value,'Texto B digitado durante o salvamento');assert.equal(h.run('dirty'),true);
 h.confirm(false);assert.equal(h.run('clean()'),false);
});
test('edição de ponto durante commit permanece no formulário para próximo save',async()=>{
 const h=harness();preparePoint(h);const promise=h.listeners.get('submit')[0](submitEvent('point-form'));
 h.el('point-region').value='Edição mais recente';h.listeners.get('input')[0]({target:{id:'point-region',closest:()=>({})}});
 h.flush();await promise;
 assert.equal(h.points()[0].region,'Edição de a');assert.equal(h.el('point-region').value,'Edição mais recente');
 assert.equal(h.run('dirty'),true);assert.equal(h.run('selectedId'),'a');
});
test('recusar descarte impede abertura de Nova consulta e conserva o rascunho',()=>{
 const h=harness();h.el('visit-notes').value='Rascunho em edição';h.run('dirty=true');h.confirm(false);h.run('newVisit()');
 assert.notEqual(h.el('dialog').open,true);assert.equal(h.run('dirty'),true);assert.equal(h.el('visit-notes').value,'Rascunho em edição');
});

test('comparação bloqueia saída enquanto grava e descarta uma única vez após confirmação',()=>{
 const h=harness();h.run('comparisonHandle={isBusy:()=>true,isDirty:()=>true,discard:()=>{throw Error("não deveria descartar enquanto grava");}}');
 assert.equal(h.run('clean()'),false);assert.match(h.el('toast').textContent,/comparação/);
 h.run('let discarded=0;comparisonHandle={isBusy:()=>false,isDirty:()=>discarded===0,discard:()=>{discarded++;return true;}}');
 h.confirm(false);assert.equal(h.run('clean()'),false);assert.equal(h.run('discarded'),0);
 h.confirm(true);assert.equal(h.run('clean()'),true);assert.equal(h.run('clean()'),true);assert.equal(h.run('discarded'),1);
});

test('mudança de visibilidade preserva comparação pendente sem carregar outro estado',async()=>{
 const h=harness();h.run('comparisonHandle={isBusy:()=>false,isDirty:()=>true};load=()=>{throw Error("rascunho não deve ser substituído");}');
 await h.listeners.get('visibilitychange')[0]();assert.equal(h.el('toast').textContent,'');
});
test('falha de transação libera a interface e mantém a edição pendente',async()=>{
 const h=harness();preparePoint(h);h.run('state.revision=123');
 const promise=h.listeners.get('submit')[0](submitEvent('point-form'));h.flush();await promise;
 assert.equal(h.el('content').inert,false);assert.equal(h.run('busy'),false);assert.equal(h.run('dirty'),true);
 assert.equal(h.el('point-region').value,'Edição de a');assert.equal(h.points()[0].region,'Região a');
});
test('consulta concluída recusa alteração de notas mesmo por submit direto',async()=>{
 const h=harness();h.workspace().visits[0].status='concluido';h.el('visit-notes').value='Alteração proibida';
 const before=h.workspace().visits[0].notes,promise=h.listeners.get('submit')[0](submitEvent('record-form'));h.flush();await promise;
 assert.equal(h.workspace().visits[0].notes,before);assert.match(h.el('toast').textContent,/conclu|adendo/i);
});
test('consulta concluída recusa excluir marcação mesmo por ação direta',async()=>{
 const h=harness();h.workspace().visits[0].status='concluido';const promise=h.listeners.get('click')[0](actionEvent('delete-point'));h.flush();await promise;
 assert.deepEqual(h.points().map(p=>p.id),['a','b']);assert.match(h.el('toast').textContent,/conclu|adendo/i);
});
test('rascunho privado e operação remota impedem abandonar a integração sem conferência',()=>{
 const h=harness();h.run('integrationHandle={isDirty:()=>true,isBusy:()=>false}');h.confirm(false);
 assert.equal(h.run('clean()'),false);
 h.confirm(true);assert.equal(h.run('clean()'),true);
 h.run('integrationHandle={isDirty:()=>false,isBusy:()=>true}');
 assert.equal(h.run('clean()'),false);assert.match(h.el('toast').textContent,/área privada/);
});
test('Hoje preserva o dia atual ao recusar descarte de uma edição',async()=>{
 const h=harness();h.run("agendaDate='2026-10-16';dirty=true");h.confirm(false);
 await h.listeners.get('click')[0](actionEvent('today'));
 assert.equal(h.run('agendaDate'),'2026-10-16');assert.equal(h.run('dirty'),true);
});
