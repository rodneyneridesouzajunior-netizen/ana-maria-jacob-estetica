import {prepareWorkspaceChange,applyPreparedWorkspaceChange} from '../action-confirmation.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {webcrypto} from 'node:crypto';
import * as domain from '../domain.mjs';
import {assertVisitEditable} from '../operations-domain.mjs';
const {JSDOM}=createRequire(new URL('../../../../../skinpro-analise/test-tools/package.json',import.meta.url))('jsdom');
const source=(await fs.readFile(new URL('../app.mjs',import.meta.url),'utf8')).replace(/^import .*$/gm,'').replace(/^try\{await setHash\(\);\}catch.*$/gm,'');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};

// Execute the actual app event handlers and photo cache. Only the renderer and
// network boundaries are substituted; the form, locking and session DOM are real.
function harness(t,{confirm=true,getPhoto=async()=>null}={}){
 const dom=new JSDOM('<!doctype html><body><nav id="nav"></nav><select id="area-switch"></select><span id="crumb"></span><span id="date-label"></span><main id="content"><form id="draft" data-unsaved="true"><textarea name="notes">Rascunho ainda não confirmado</textarea><button>Salvar</button></form></main><div id="toast"></div><dialog id="dialog" open><h2 id="dialog-title">Revisão</h2><form id="dialog-form" data-unsaved="true"><div id="dialog-fields"><input name="amount" value="0,2"></div><p id="dialog-error"></p><button type="submit">Salvar</button><button type="button" id="cancel-dialog">Cancelar</button></form><button id="close-dialog">Fechar</button></dialog></body>',{url:'https://anamariajacob.com.br/app/#paciente/demo-marina/demo-consulta/resumo'});
 const w=dom.window,events=new Map(),add=w.addEventListener.bind(w),created=[],revoked=[],renders=[],confirmations=[];let commits=0,loads=0;
 w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.addEventListener=(type,fn,...args)=>{events.set(type,[...(events.get(type)||[]),fn]);add(type,fn,...args);};
 const context=vm.createContext({prepareWorkspaceChange,applyPreparedWorkspaceChange,requestActionCode:async()=>{},...domain,assertVisitEditable,isConnected:()=>true,structuredClone,crypto:webcrypto,console,document:w.document,window:w,location:w.location,history:w.history,FormData:w.FormData,URL:{createObjectURL:blob=>{const url='blob:synthetic-'+(created.length+1);created.push({url,blob});return url;},revokeObjectURL:url=>revoked.push(url)},confirm:message=>{confirmations.push(message);return confirm;},setTimeout:()=>0,clearTimeout(){},load:async()=>{loads++;return domain.seed();},commit:async()=>{commits++;return domain.seed();},getPhoto,renders});
 vm.runInContext(source,context);const run=code=>vm.runInContext(code,context);
 run("state=seed();state.revision=4;patientId='demo-marina';visitId='demo-consulta';photoId='demo-foto';dirty=true;pending={id:'draft-point',x:0.42,y:0.57};selectedId='saved-point';editGeneration=9;render=async()=>{renders.push({revision:state.revision,notes:state.visits[0].notes});document.getElementById('content').textContent='Confirmado: '+state.visits[0].notes;};");
 const dialog=w.document.getElementById('dialog');dialog.inert=false;
 t.after(()=>w.close());
 return{run,doc:w.document,w,created,revoked,renders,confirmations,commits:()=>commits,loads:()=>loads,emit:async(type,event={})=>{for(const fn of events.get(type)||[])await fn(event);}};
}
test('failed reconciliation retains the exact unsaved form and map draft while restoring controls',async t=>{
 const h=harness(t),before=JSON.stringify(h.run('state')),draft=h.doc.getElementById('draft'),dialog=h.doc.getElementById('dialog'),generation=h.run('editGeneration'),operation=deferred();let calls=0;
 const work=h.emit('amj:cloud-reconcile-request',{detail:{reconcile:()=>{calls++;return operation.promise;}}});
 assert.equal(h.run('busy'),true);assert.equal(h.doc.getElementById('content').inert,true);assert.equal(dialog.inert,true);assert.equal(h.run('dirty'),true);assert.equal(draft.dataset.unsaved,'true');assert.equal(h.renders.length,0);
 operation.reject(Error('O mesmo registro mudou no celular'));await work;
 assert.equal(calls,1);assert.equal(h.run('busy'),false);assert.equal(h.doc.getElementById('content').inert,false);assert.equal(dialog.inert,false);assert.equal(dialog.open,true);assert.equal(h.doc.getElementById('draft'),draft);assert.equal(draft.elements.notes.value,'Rascunho ainda não confirmado');assert.equal(draft.dataset.unsaved,'true');assert.equal(h.doc.getElementById('dialog-form').elements.amount.value,'0,2');assert.equal(h.run('dirty'),true);assert.equal(h.run('pending.id'),'draft-point');assert.equal(h.run('selectedId'),'saved-point');assert.equal(h.run('editGeneration'),generation);assert.equal(JSON.stringify(h.run('state')),before);assert.equal(h.renders.length,0);assert.match(h.doc.getElementById('toast').textContent,/mesmo registro/);assert.equal(h.commits(),0);assert.equal(h.loads(),0);
});
test('successful reconciliation clears drafts and redraws only after the returned server confirmation',async t=>{
 const h=harness(t),operation=deferred(),draft=h.doc.getElementById('draft'),dialog=h.doc.getElementById('dialog'),next=structuredClone(h.run('state'));next.revision=6;next.visits[0].notes='Versão confirmada pelo servidor';
 const work=h.emit('amj:cloud-reconcile-request',{detail:{reconcile:()=>operation.promise}});
 assert.equal(h.run('state.revision'),4);assert.equal(h.run('pending.id'),'draft-point');assert.equal(h.run('dirty'),true);assert.equal(dialog.open,true);assert.equal(h.renders.length,0);
 operation.resolve(next);await work;
 assert.equal(h.run('state.revision'),6);assert.equal(h.run('dirty'),false);assert.equal(h.run('pending'),null);assert.equal(h.run('selectedId'),null);assert.equal(h.run('editGeneration'),10);assert.equal(draft.dataset.unsaved,undefined);assert.equal(dialog.open,false);assert.equal(h.doc.getElementById('dialog-form').dataset.unsaved,undefined);assert.equal(h.renders.length,1);assert.equal(h.renders[0].revision,6);assert.match(h.doc.getElementById('content').textContent,/Versão confirmada pelo servidor/);assert.match(h.doc.getElementById('toast').textContent,/confirmada no servidor/);assert.equal(h.run('busy'),false);assert.equal(h.commits(),0);assert.equal(h.loads(),0);
});
test('declining draft replacement never calls reconciliation, closes a form or alters unsaved data',async t=>{
 const h=harness(t,{confirm:false}),before=JSON.stringify(h.run('state'));let calls=0;await h.emit('amj:cloud-reconcile-request',{detail:{reconcile:async()=>{calls++;}}});
 assert.equal(calls,0);assert.equal(h.confirmations.length,1);assert.match(h.confirmations[0],/Alterações digitadas depois/);assert.equal(h.run('dirty'),true);assert.equal(h.run('pending.id'),'draft-point');assert.equal(h.doc.getElementById('dialog').open,true);assert.equal(h.doc.getElementById('draft').dataset.unsaved,'true');assert.equal(JSON.stringify(h.run('state')),before);assert.equal(h.renders.length,0);
});
test('logout during reconciliation discards a late result without rendering or reactivating the private form',async t=>{
 const h=harness(t),operation=deferred(),next=structuredClone(h.run('state'));next.revision=8;const work=h.emit('amj:cloud-reconcile-request',{detail:{reconcile:()=>operation.promise}});
 await h.emit('amj:connection-invalidated');operation.resolve(next);await work;
 assert.equal(h.run('connectionEnded'),true);assert.equal(h.run('state'),null);assert.equal(h.run('dirty'),false);assert.equal(h.run('pending'),null);assert.equal(h.renders.length,0);assert.equal(h.doc.getElementById('content').childElementCount,0);assert.equal(h.doc.getElementById('dialog').inert,true);assert.equal(h.doc.getElementById('toast').textContent,'');assert.equal(h.commits(),0);assert.equal(h.loads(),0);
});
test('another reconciliation event cannot start while one request is in flight',async t=>{
 const h=harness(t),operation=deferred();let calls=0;const detail={reconcile:()=>{calls++;return operation.promise;}};const work=h.emit('amj:cloud-reconcile-request',{detail});await h.emit('amj:cloud-reconcile-request',{detail});assert.equal(calls,1);operation.reject(Error('Falha controlada'));await work;assert.equal(h.run('dirty'),true);assert.equal(h.renders.length,0);
});
test('logout while the photo getter is pending prevents creation and retention of a private blob URL',async t=>{
 const photo=deferred(),h=harness(t,{getPhoto:()=>photo.promise}),work=h.run("photoUrl({id:'late-photo'})"),rejected=assert.rejects(work,/visualização.*encerrada|Acesso encerrado/);
 await h.emit('amj:connection-invalidated');photo.resolve({preview:new Blob(['synthetic-private-photo'])});await rejected;
 assert.equal(h.created.length,0);assert.equal(h.run('objectUrls.size'),0);assert.equal(h.doc.querySelector('img'),null);
});
test('a changed render generation prevents a late photo from caching or falling back to its source',async t=>{
 const photo=deferred(),h=harness(t,{getPhoto:()=>photo.promise}),work=h.run("photoUrl({id:'old-photo',src:'assets/face-demonstrativa.png'})"),rejected=assert.rejects(work,/visualização.*encerrada/);h.run('renderSeq++');photo.resolve(null);await rejected;assert.equal(h.created.length,0);assert.equal(h.run('objectUrls.size'),0);
});
test('simultaneous reads reuse one blob URL and session invalidation revokes that retained URL',async t=>{
 const photo=deferred(),h=harness(t,{getPhoto:()=>photo.promise}),first=h.run("photoUrl({id:'same-photo'})"),second=h.run("photoUrl({id:'same-photo'})");photo.resolve({preview:new Blob(['synthetic-photo'])});assert.equal(await first,await second);assert.equal(h.created.length,1);assert.equal(h.run('objectUrls.size'),1);await h.emit('amj:connection-invalidated');assert.deepEqual(h.revoked,[h.created[0].url]);assert.equal(h.run('objectUrls.size'),0);await assert.rejects(h.run("photoUrl({id:'same-photo'})"),/Acesso encerrado/);assert.equal(h.created.length,1);
});
