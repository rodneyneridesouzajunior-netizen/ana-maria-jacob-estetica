import {prepareWorkspaceChange,applyPreparedWorkspaceChange} from '../action-confirmation.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {webcrypto} from 'node:crypto';
import * as rules from '../domain.mjs';
import {assertVisitEditable} from '../operations-domain.mjs';
const require=createRequire(new URL('../../../../../skinpro-analise/test-tools/package.json',import.meta.url));
const {JSDOM}=require('jsdom');
const source=(await fs.readFile(new URL('../app.mjs',import.meta.url),'utf8')).replace(/^import .*$/gm,'').replace(/^try\{await setHash\(\);\}catch.*$/gm,'');

// Real app invalidation handlers and real DOM, without starting browser/login/network.
function harness(t){
 const dom=new JSDOM('<!doctype html><body><nav id="nav">PRIVATE-NAV</nav><select id="area-switch"><option>PRIVATE-AREA</option></select><span id="crumb">PRIVATE-CRUMB</span><span id="date-label"></span><main id="content"><p>PRIVATE-CONTENT</p></main><div id="toast">PRIVATE-TOAST</div><dialog id="dialog" open><h2 id="dialog-title">PRIVATE-TITLE</h2><form id="dialog-form" data-unsaved="true"><div id="dialog-fields"><textarea name="notes">PRIVATE-NATIVE-NOTES</textarea><img src="blob:private-photo"></div><p id="dialog-error">PRIVATE-ERROR</p><button type="submit">Salvar</button><button id="cancel-dialog" type="button">Cancelar</button></form><button id="close-dialog">Fechar</button></dialog><dialog id="outside-modal" open><p>PRIVATE-OUTSIDE</p><textarea>PRIVATE-DYNAMIC-NOTES</textarea></dialog></body>',{url:'https://anamariajacob.com.br/app/connected.html#paciente/demo-marina/demo-consulta/mapa'});
 const w=dom.window,events=new Map(),add=w.addEventListener.bind(w),revoked=[],disposed=[];let loads=0,writes=0;
 w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.addEventListener=(type,fn,...rest)=>{events.set(type,[...(events.get(type)||[]),fn]);add(type,fn,...rest);};
 const context=vm.createContext({renderRecycleTools:()=>'',renderRecycleBin:()=>'',mountRecycleUI:()=>()=>{},prepareWorkspaceChange,applyPreparedWorkspaceChange,requestActionCode:async()=>{},...rules,assertVisitEditable,isConnected:()=>true,structuredClone,crypto:webcrypto,console,document:w.document,window:w,location:w.location,history:w.history,FormData:w.FormData,URL:{revokeObjectURL:url=>revoked.push(url)},confirm:()=>true,setTimeout:()=>0,clearTimeout(){},load:async()=>{loads++;return rules.seed();},commit:async()=>{writes++;return rules.seed();},getPhoto:async()=>null,disposed});
 vm.runInContext(source,context);const run=code=>vm.runInContext(code,context);
 run("state=seed();patientId='demo-marina';visitId='demo-consulta';photoId='demo-foto';dialogSubmit=()=>{throw Error('private callback must be cleared');};dirty=true;pending={id:'private-pending'};drag={private:true};selectedId='private-point';objectUrls.set('photo','blob:private-photo');comparisonSelections.set('patient',{private:true});patientView.query='PRIVATE-QUERY';facialHandle={dispose:()=>disposed.push('facial')};patientsHandle={dispose:()=>disposed.push('patients')};patientEditor={dispose:()=>disposed.push('patient-editor')};comparisonHandle={dispose:()=>disposed.push('comparison')};integrationHandle={dispose:()=>disposed.push('integration')};agendaDispose=()=>disposed.push('agenda');mapFitObserver={disconnect:()=>disposed.push('resize')};");
 t.after(()=>w.close());
 return {run,document:w.document,revoked,disposed,loads:()=>loads,writes:()=>writes,emit:async(type,event={})=>{for(const fn of events.get(type)||[])await fn(event);}};
}
test('logout clears private native/dynamic dialogs, photos and retained app context outside main content',async t=>{
 const h=harness(t);await h.emit('amj:connection-invalidated');
 assert.equal(h.run('connectionEnded'),true);assert.equal(h.run('state'),null);assert.equal(h.run('dialogSubmit'),null);assert.equal(h.run('patientId'),undefined);assert.equal(h.run('visitId'),undefined);assert.equal(h.run('photoId'),undefined);assert.equal(h.run('pending'),null);assert.equal(h.run('drag'),null);assert.equal(h.run('selectedId'),null);assert.equal(h.run('dirty'),false);assert.equal(h.run('objectUrls.size'),0);assert.equal(h.run('comparisonSelections.size'),0);assert.equal(h.run('patientView.query'),'');
 assert.deepEqual(h.revoked,['blob:private-photo']);assert.deepEqual(h.disposed.sort(),['agenda','comparison','facial','integration','patient-editor','patients','resize']);
 assert.equal(h.document.getElementById('dialog').open,false);assert.equal(h.document.getElementById('dialog').inert,true);assert.equal(h.document.getElementById('dialog-form').dataset.unsaved,undefined);assert.equal(h.document.getElementById('dialog-fields').childElementCount,0);assert.equal(h.document.getElementById('outside-modal'),null);assert.equal(h.document.querySelector('img'),null);assert.doesNotMatch(h.document.body.innerHTML,/PRIVATE-/);
});
test('after logout setHash, refresh and persistence cannot reload or save a private context',async t=>{
 const h=harness(t);await h.emit('amj:connection-invalidated');await h.run('setHash()');await h.emit('amj:cloud-refresh');
 await assert.rejects(h.run('persist(()=>{})'),/Acesso encerrado/);h.run("toast('PRIVATE-LATE-NOTICE');");
 assert.equal(h.loads(),0);assert.equal(h.writes(),0);assert.equal(h.run('state'),null);assert.equal(h.document.getElementById('toast').textContent,'');assert.doesNotMatch(h.document.body.innerHTML,/PRIVATE-/);
});
