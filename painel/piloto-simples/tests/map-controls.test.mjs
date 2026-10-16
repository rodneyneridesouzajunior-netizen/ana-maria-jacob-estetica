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
const sample=(kind='ponto')=>({id:'synthetic-point',kind,x:.3333333333333333,y:.42,...(kind==='ponto'?{}:{x2:.78,y2:.65}),region:'Região de teste',product:'',quantity:null,unit:'sem quantidade',lot:'',notes:''});

function harness(t,{kind='ponto',point=null,status='rascunho',width=800,height=500}={}){
 const dom=new JSDOM('<!doctype html><body><nav id="nav"></nav><select id="area-switch"></select><span id="crumb"></span><span id="date-label"></span><main id="content"></main><div id="toast"></div><dialog id="dialog"><h2 id="dialog-title"></h2><form id="dialog-form"><div id="dialog-fields"></div><p id="dialog-error"></p><button id="cancel-dialog"></button></form><button id="close-dialog"></button></dialog></body>',{url:'https://anamariajacob.com.br/app/#paciente/demo-marina/demo-consulta/mapa'});
 const w=dom.window;w.HTMLDialogElement.prototype.close=function(){this.open=false;};w.matchMedia=()=>({matches:false});
 let context,writes=0;
 context=vm.createContext({...domain,assertVisitEditable,fittedPhotoSize,MAP_ZOOM_LEVELS,structuredClone,crypto:webcrypto,console,document:w.document,window:w,location:w.location,history:w.history,FormData:w.FormData,URL:w.URL,isConnected:()=>true,confirm:()=>true,setTimeout:()=>0,clearTimeout(){},commit:async(expected,update)=>{writes++;const next=structuredClone(vm.runInContext('state',context));assert.equal(next.revision,expected);update(next);next.revision=expected+1;return next;}});
 vm.runInContext(source,context);const run=code=>vm.runInContext(code,context);
 const state=domain.seed();state.visits[0].status=status;if(point)state.visits[0].maps['demo-foto'].points=[point];context.fixture=state;context.kind=kind;
 run("state=fixture;patientId='demo-marina';visitId='demo-consulta';photoId='demo-foto';tool=kind;tab='mapa';document.getElementById('content').innerHTML=mapPage(visit());");
 const doc=w.document,stage=doc.getElementById('photo-stage'),plane=doc.getElementById('photo-plane'),image=doc.getElementById('map-photo');
 Object.defineProperties(image,{complete:{value:true},naturalWidth:{value:1122},naturalHeight:{value:1402}});
 Object.defineProperties(stage,{clientWidth:{value:width},clientHeight:{value:height}});
 const dimensions=()=>({width:parseFloat(plane.style.width)||fittedPhotoSize(width,height,1122,1402).width,height:parseFloat(plane.style.height)||fittedPhotoSize(width,height,1122,1402).height});
 let scrollX=0,scrollY=0;Object.defineProperties(stage,{scrollLeft:{get:()=>Math.max(0,Math.min(scrollX,dimensions().width-width)),set:v=>{scrollX=Math.max(0,Math.min(v,dimensions().width-width));}},scrollTop:{get:()=>Math.max(0,Math.min(scrollY,dimensions().height-height)),set:v=>{scrollY=Math.max(0,Math.min(v,dimensions().height-height));}}});
 stage.getBoundingClientRect=()=>({left:20,top:30,right:20+width,bottom:30+height,width,height});
 plane.getBoundingClientRect=()=>{const size=dimensions(),left=20+Math.max(0,(width-size.width)/2)-stage.scrollLeft,top=30-stage.scrollTop;return{...size,left,top,right:left+size.width,bottom:top+size.height};};
 run('fitMapPlane();drawMap();');
 t.after(()=>w.close());
 const edit=(id,value)=>{const field=doc.getElementById(id);field.value=value;field.dispatchEvent(new w.Event('input',{bubbles:true}));};
 const click=(action,id)=>doc.querySelector(`[data-action="${action}"]${id?`[data-id="${id}"]`:''}`).click();
 const submit=async()=>{doc.getElementById('point-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();};
 return{run,doc,w,stage,plane,writes:()=>writes,click,edit,submit};
}

test('zoom presets and +/- reach 10×, clamp both ends, keep the photo and normalized data unchanged',t=>{
 const h=harness(t,{point:sample(),width:320,height:430}),before=JSON.stringify(h.run('state'));
 assert.deepEqual([...h.doc.querySelectorAll('[data-action="map-zoom"]')].map(b=>b.textContent),['1×','3×','6×','10×']);
 for(const level of MAP_ZOOM_LEVELS){h.click('map-zoom',String(level));assert.equal(h.run('zoom'),level);assert.equal(h.doc.querySelector(`[data-action="map-zoom"][data-id="${level}"]`).getAttribute('aria-pressed'),'true');assert.equal(h.doc.getElementById('zoom-label').textContent,level+'×');}
 h.click('zoom-in');assert.equal(h.run('zoom'),10);h.run('setMapZoom(50)');assert.equal(h.run('zoom'),10);
 h.click('zoom-out');assert.equal(h.run('zoom'),6);h.click('zoom-out');assert.equal(h.run('zoom'),3);h.click('zoom-out');assert.equal(h.run('zoom'),1);assert.equal(h.doc.querySelector('[data-action="zoom-out"]').disabled,true);
 assert.equal(JSON.stringify(h.run('state')),before);assert.equal(h.writes(),0);
});

for(const kind of ['ponto','linha','leque'])test(`${kind}: create without dragging, edit normalized coordinates and reopen the saved map`,async t=>{
 const h=harness(t,{kind}),photoBefore=JSON.stringify(h.run('photo()'));
 h.click('new-map-point');assert.equal(h.doc.activeElement.id,'map-x');assert.equal(h.run('dirty'),true);assert.equal(h.writes(),0);
 h.edit('map-x','25');h.edit('map-y','40');if(kind!=='ponto'){h.edit('map-x2','65');h.edit('map-y2','70');}
 h.edit('point-region','Região escolhida manualmente');await h.submit();
 assert.equal(h.writes(),1);const saved=h.run('map().points[0]');assert.equal(saved.x,.25);assert.equal(saved.y,.4);assert.equal(saved.kind,kind);
 if(kind!=='ponto'){assert.equal(saved.x2,.65);assert.equal(saved.y2,.7);}
 assert.equal(h.run('map().history.length'),1);assert.equal(h.run('map().version'),1);assert.equal(h.run('dirty'),false);assert.equal(JSON.stringify(h.run('photo()')),photoBefore);
 h.click('select-point',saved.id);assert.equal(h.doc.getElementById('map-x').value,'25');assert.equal(h.doc.getElementById('map-y').value,'40');assert.equal(h.writes(),1);
});

test('keyboard arrow movement preserves marker focus, uses Shift fine step and waits for explicit save',async t=>{
 const original=sample(),h=harness(t,{point:original});let marker=h.doc.querySelector('[data-marker]');marker.focus();
 marker.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));
 assert.equal(h.doc.activeElement.dataset.marker,original.id);assert.equal(h.writes(),0);assert.equal(h.run('map().points[0].x'),original.x);
 assert.ok(Math.abs(Number(h.doc.getElementById('map-x').dataset.mapOriginal)-original.x-.01)<1e-12);
 marker=h.doc.activeElement;marker.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'ArrowDown',shiftKey:true,bubbles:true,cancelable:true}));
 assert.ok(Math.abs(Number(h.doc.getElementById('map-y').dataset.mapOriginal)-original.y-.001)<1e-12);
 await h.submit();assert.equal(h.writes(),1);assert.ok(Math.abs(h.run('map().points[0].x')-original.x-.01)<1e-12);assert.ok(Math.abs(h.run('map().points[0].y')-original.y-.001)<1e-12);
});

test('zoom preserves the same visible location after manually scrolling an enlarged photograph',t=>{
 const h=harness(t,{width:320,height:430});h.click('map-zoom','3');h.stage.scrollLeft=310;h.stage.scrollTop=510;
 const atCenter=()=>{const r=h.plane.getBoundingClientRect(),s=h.stage.getBoundingClientRect();return domain.normalizedPoint(s.left+h.stage.clientWidth/2,s.top+h.stage.clientHeight/2,r);};
 const before=atCenter();h.click('map-zoom','10');const after=atCenter();assert.ok(Math.abs(before.x-after.x)<1e-12);assert.ok(Math.abs(before.y-after.y)<1e-12);assert.equal(h.writes(),0);
});

test('a line started on the photo can receive its endpoint using numeric controls before saving',async t=>{
 const h=harness(t,{kind:'linha'}),r=h.plane.getBoundingClientRect();
 h.plane.dispatchEvent(new h.w.MouseEvent('click',{clientX:r.left+r.width*.3,clientY:r.top+r.height*.4,detail:1,bubbles:true}));
 assert.equal(h.run('pending.kind'),'linha');assert.equal(h.doc.getElementById('save-point').disabled,true);
 h.edit('map-x2','65');h.edit('map-y2','70');h.edit('point-region','Linha definida manualmente');assert.equal(h.doc.getElementById('save-point').disabled,false);await h.submit();
 assert.equal(h.writes(),1);assert.equal(h.run('map().points[0].x2'),.65);assert.equal(h.run('map().points[0].y2'),.7);
});

test('line controls translate both endpoints together, clamp to the photograph and cancel without a write',t=>{
 const original={...sample('linha'),x:.89,y:.4,x2:.995,y2:.65},h=harness(t,{point:original});h.click('select-point',original.id);
 h.click('move-map-point','right');const first=Number(h.doc.getElementById('map-x').dataset.mapOriginal),last=Number(h.doc.getElementById('map-x2').dataset.mapOriginal);
 assert.ok(Math.abs(first-.895)<1e-12);assert.equal(last,1);assert.ok(Math.abs((last-first)-(original.x2-original.x))<1e-12);
 h.click('move-map-point','right');assert.equal(Number(h.doc.getElementById('map-x2').dataset.mapOriginal),1);
 h.click('cancel-point');assert.equal(h.run('dirty'),false);assert.deepEqual(structuredClone(h.run('map().points[0]')),original);assert.equal(h.writes(),0);
});

test('editing text alone does not round high precision coordinates and invalid position cannot be saved',async t=>{
 const original=sample(),h=harness(t,{point:original});h.click('select-point',original.id);h.edit('point-region','Texto revisado');await h.submit();assert.equal(h.run('map().points[0].x'),original.x);
 h.click('select-point',original.id);h.edit('map-x','101');assert.equal(h.doc.getElementById('save-point').disabled,true);await h.submit();assert.equal(h.writes(),1);assert.match(h.doc.getElementById('point-error').textContent,/0% e 100%/);
});

test('Enter on the photograph creates a draft and completed records retain zoom without allowing movement',t=>{
 const editable=harness(t);editable.stage.dispatchEvent(new editable.w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));assert.equal(editable.run('pending.kind'),'ponto');assert.equal(editable.writes(),0);
 const locked=harness(t,{point:sample(),status:'concluido'});assert.equal(locked.doc.querySelector('[data-action="new-map-point"]').disabled,true);locked.click('select-point','synthetic-point');assert.equal(locked.doc.getElementById('map-x').disabled,true);
 const marker=locked.doc.querySelector('[data-marker]');marker.dispatchEvent(new locked.w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));locked.stage.dispatchEvent(new locked.w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
 assert.equal(locked.run('pending'),null);assert.equal(locked.run('dirty'),false);assert.equal(locked.writes(),0);locked.click('map-zoom','10');assert.equal(locked.run('zoom'),10);
});
