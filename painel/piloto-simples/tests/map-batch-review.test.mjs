import {prepareWorkspaceChange,applyPreparedWorkspaceChange} from '../action-confirmation.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {webcrypto} from 'node:crypto';
import * as domain from '../domain.mjs';
import {assertVisitEditable} from '../operations-domain.mjs';
import {fittedPhotoSize,MAP_ZOOM_LEVELS} from '../map-fit.mjs';
const {JSDOM}=createRequire(new URL('../../../../../skinpro-analise/test-tools/package.json',import.meta.url))('jsdom');
const source=(await fs.readFile(new URL('../app.mjs',import.meta.url),'utf8')).replace(/^import .*$/gm,'').replace(/^try\{await setHash\(\);\}catch.*$/gm,'');
const tick=()=>new Promise(resolve=>setImmediate(resolve));

// Independent real-handler harness: committed storage is separate from the UI,
// and each transaction stays pending until the test explicitly resolves it.
function harness(t){
 const dom=new JSDOM('<!doctype html><body><nav id="nav"></nav><select id="area-switch"></select><span id="crumb"></span><span id="date-label"></span><main id="content"></main><div id="toast"></div><dialog id="dialog"><h2 id="dialog-title"></h2><form id="dialog-form"><div id="dialog-fields"></div><p id="dialog-error"></p><button id="cancel-dialog"></button></form><button id="close-dialog"></button></dialog></body>',{url:'https://anamariajacob.com.br/app/#paciente/demo-marina/demo-consulta/mapa'});
 const w=dom.window,doc=w.document,queued=[];w.HTMLDialogElement.prototype.close=function(){this.open=false;};w.matchMedia=()=>({matches:false});w.scrollTo=()=>{};w.Element.prototype.setPointerCapture=function(){};
 let stored=domain.seed(),calls=0;stored.visits[0].photos.push({...stored.visits[0].photos[0],id:'second-photo',label:'Segunda foto fictícia'});stored.visits[0].maps['second-photo']={version:0,points:[],history:[]};
 const context=vm.createContext({renderRecycleTools:()=>'',renderRecycleBin:()=>'',mountRecycleUI:()=>()=>{},prepareWorkspaceChange,applyPreparedWorkspaceChange,requestActionCode:async()=>{},...domain,assertVisitEditable,fittedPhotoSize,MAP_ZOOM_LEVELS,structuredClone,crypto:webcrypto,console,document:doc,window:w,location:w.location,history:w.history,FormData:w.FormData,URL:w.URL,isConnected:()=>true,confirm:()=>true,setTimeout:(fn,delay)=>delay===0?setImmediate(fn):0,clearTimeout(){},load:async()=>structuredClone(stored),commit:(revision,update)=>{calls++;return new Promise((resolve,reject)=>queued.push({revision,update,resolve,reject}));}});
 vm.runInContext(source,context);const run=code=>vm.runInContext(code,context);context.fixture=structuredClone(stored);
 run("state=fixture;patientId='demo-marina';visitId='demo-consulta';photoId='demo-foto';tab='mapa';route='paciente';document.getElementById('content').innerHTML=mapPage(visit());");
 const stage=doc.getElementById('photo-stage'),plane=doc.getElementById('photo-plane'),image=doc.getElementById('map-photo');
 Object.defineProperties(image,{complete:{value:true},naturalWidth:{value:800},naturalHeight:{value:1000}});Object.defineProperties(stage,{clientWidth:{value:400},clientHeight:{value:500}});
 stage.getBoundingClientRect=plane.getBoundingClientRect=()=>({left:0,top:0,width:400,height:500,right:400,bottom:500});
 run('fitMapPlane();drawMap();');t.after(()=>w.close());
 const edit=(id,value)=>{const el=doc.getElementById(id);el.value=value;el.dispatchEvent(new w.Event('input',{bubbles:true}));};
 const click=(action,id)=>doc.querySelector(`[data-action="${action}"]${id?`[data-id="${id}"]`:''}`).click();
 const add=(x=.3,y=.4)=>plane.dispatchEvent(new w.MouseEvent('click',{clientX:x*400,clientY:y*500,detail:1,bubbles:true}));
 const flush=async(error)=>{await new Promise(resolve=>setImmediate(resolve));assert.equal(queued.length,1,'Exactly one transaction must be pending');const op=queued.shift();if(error)op.reject(error);else{try{assert.equal(op.revision,stored.revision);const next=structuredClone(stored);op.update(next);next.revision++;stored=next;op.resolve(structuredClone(stored));}catch(e){op.reject(e);}}await tick();};
 return{run,doc,w,add,edit,click,flush,stored:()=>stored,calls:()=>calls,pending:()=>queued.length};
}

test('batch review: late edits survive pending commit; retry replaces stable IDs without duplicate persisted points',async t=>{
 const h=harness(t);h.add(.2,.3);h.add(.6,.7);const ids=[...h.run('mapBatch.items.map(x=>x.point.id)')];h.edit('point-notes','Before commit');h.click('save-map-batch');assert.equal(h.pending(),1);assert.equal(h.doc.getElementById('content').inert,true);
 h.edit('point-notes','Newer draft');h.edit('map-x','64');h.click('save-map-batch');h.add(.8,.8);assert.equal(h.pending(),1);assert.equal(h.run('mapBatch.items.length'),2);
 await h.flush();assert.equal(h.stored().visits[0].maps['demo-foto'].points[1].notes,'Before commit');assert.equal(h.run('dirty'),true);assert.equal(h.doc.getElementById('point-notes').value,'Newer draft');assert.deepEqual([...h.run('mapBatch.persistedIds')],ids);
 h.click('save-map-batch');await h.flush();const points=h.stored().visits[0].maps['demo-foto'].points;assert.deepEqual(Array.from(points,p=>p.id),ids);assert.equal(points[1].notes,'Newer draft');assert.equal(points[1].x,.64);assert.equal(h.run('dirty'),false);assert.equal(h.calls(),2);
});

test('batch review: newest draft on failed CAS remains intact and no partial map/history is stored',async t=>{
 const h=harness(t);h.add();h.add(.6,.7);const ids=[...h.run('mapBatch.items.map(x=>x.point.id)')];h.edit('point-quantity','0,3');h.edit('point-unit','mL');h.click('save-map-batch');h.edit('point-notes','Draft typed while request was pending');await h.flush(Object.assign(Error('Conflito de revisão'),{status:409}));
 assert.equal(h.run('dirty'),true);assert.equal(h.run('busy'),false);assert.deepEqual([...h.run('mapBatch.items.map(x=>x.point.id)')],ids);assert.equal(h.doc.getElementById('point-notes').value,'Draft typed while request was pending');assert.equal(h.stored().visits[0].maps['demo-foto'].points.length,0);assert.equal(h.stored().visits[0].maps['demo-foto'].history.length,0);
 h.click('save-map-batch');await h.flush();assert.equal(h.stored().visits[0].maps['demo-foto'].points[1].notes,'Draft typed while request was pending');assert.equal(h.stored().visits[0].maps['demo-foto'].points[1].quantity,.3);
});

test('batch review: an empty new batch refreshes its base version after undo so the next set can save',async t=>{
 const h=harness(t);h.add();h.click('save-map-batch');await h.flush();assert.equal(h.run('map().points.length'),1);h.click('undo-map');await h.flush();assert.equal(h.run('map().points.length'),0);assert.equal(h.run('map().version'),2);
 h.add(.7,.2);const id=h.run('pending.id');h.click('save-map-batch');await h.flush();assert.equal(h.run('map().points.length'),1);assert.equal(h.run('map().points[0].id'),id);assert.equal(h.run('dirty'),false);
});

test('batch review: late edits render each persisted/draft ID once while waiting for the second save',async t=>{
 const h=harness(t);h.add();h.add(.6,.7);h.click('save-map-batch');h.edit('point-notes','Later edit');await h.flush();
 const buttons=[...h.doc.querySelectorAll('[data-marker]')],markers=buttons.map(el=>el.dataset.marker);assert.equal(new Set(markers).size,2);assert.equal(markers.length,2,'A saved base and its newer draft must not draw duplicate faces/labels');assert.deepEqual(buttons.map(el=>el.textContent),['1','2']);
 const legend=[...h.doc.querySelectorAll('#point-list [data-id]')];assert.equal(legend.length,2);assert.equal(new Set(legend.map(el=>el.dataset.id)).size,2);assert.deepEqual(legend.map(el=>el.querySelector('.number').textContent),['1','2']);
});

test('batch review: pending commit blocks photo changes and route changes to another patient',async t=>{
 const h=harness(t);h.add();h.click('save-map-batch');const before=h.w.location.hash,select=h.doc.getElementById('photo-select');select.value='second-photo';select.dispatchEvent(new h.w.Event('change',{bubbles:true}));h.run("navigate('paciente/other-patient/other-visit/mapa')");assert.equal(h.w.location.hash,before);assert.equal(h.run('photoId'),'demo-foto');assert.equal(select.value,'demo-foto');
 await h.flush();assert.equal(h.stored().visits[0].maps['second-photo'].points.length,0);assert.equal(h.stored().visits[0].maps['demo-foto'].points.length,1);
});

test('batch review: explicit context mismatch fails closed without moving drafts into another photo',async t=>{
 const h=harness(t);h.add();const before=JSON.stringify(h.run('mapBatch'));h.run("photoId='second-photo'");await h.run('saveMapBatch()');assert.equal(h.calls(),0);assert.equal(JSON.stringify(h.run('mapBatch')),before);assert.match(h.doc.getElementById('point-error').textContent,/outra foto/);assert.equal(h.stored().visits[0].maps['second-photo'].points.length,0);
});

test('batch review: logout during commit removes all drafts and ignores the late successful result',async t=>{
 const h=harness(t);h.add();h.edit('point-notes','Private synthetic note');h.click('save-map-batch');h.w.dispatchEvent(new h.w.Event('amj:connection-invalidated'));assert.equal(h.run('mapBatch'),null);assert.equal(h.run('state'),null);assert.doesNotMatch(h.doc.getElementById('content').textContent,/Private synthetic/);
 await h.flush();assert.equal(h.run('state'),null);assert.equal(h.run('mapBatch'),null);assert.equal(h.doc.getElementById('content').textContent,'');assert.equal(h.run('dirty'),false);
});

test('batch review: locked consultation cannot persist an existing draft or fabricate quantity for a free trace',async t=>{
 const h=harness(t);h.run('addBatchMark({kind:"traco",x:.2,y:.3,vertices:[{x:.2,y:.3},{x:.5,y:.5}]})');h.edit('point-quantity','2');h.edit('point-unit','mL');h.run("visit().lockedAt='2026-10-15T12:00:00Z'");await h.run('saveMapBatch()');assert.equal(h.calls(),0);assert.equal(h.run('dirty'),true);h.run('delete visit().lockedAt');h.click('save-map-batch');await h.flush();const point=h.stored().visits[0].maps['demo-foto'].points[0];assert.equal(point.quantity,null);assert.equal(point.unit,'sem quantidade');assert.deepEqual(domain.quantityTotals([point]),{});
});

test('batch review: exactly 1000 drafts save in one history step with distinct IDs and no assumed quantities',async t=>{
 const h=harness(t);h.add();h.run('const boundedItem=structuredClone(mapBatch.items[0]);mapBatch.items=Array.from({length:1000},(_,i)=>({...structuredClone(boundedItem),point:{...structuredClone(boundedItem.point),id:"bounded-"+i}}));pending=mapBatch.items[0].point;drawMap();');
 assert.equal(h.run('addBatchMark({kind:"ponto",x:.8,y:.8})'),false);assert.equal(h.run('mapBatch.items.length'),1000);h.click('save-map-batch');assert.equal(h.pending(),1);await h.flush();
 const saved=h.stored().visits[0].maps['demo-foto'];assert.equal(saved.points.length,1000);assert.equal(new Set(saved.points.map(p=>p.id)).size,1000);assert.equal(saved.history.length,1);assert.equal(saved.version,1);assert.equal(h.calls(),1);assert(saved.points.every(p=>p.quantity===null&&p.unit==='sem quantidade'));assert.deepEqual(domain.quantityTotals(saved.points),{});
});
