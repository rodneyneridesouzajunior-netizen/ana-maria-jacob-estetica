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

function harness(t,{kind='ponto',point=null,status='rascunho',width=800,height=500,batch=false}={}){
 const dom=new JSDOM('<!doctype html><body><nav id="nav"></nav><select id="area-switch"></select><span id="crumb"></span><span id="date-label"></span><main id="content"></main><div id="toast"></div><dialog id="dialog"><h2 id="dialog-title"></h2><form id="dialog-form"><div id="dialog-fields"></div><p id="dialog-error"></p><button id="cancel-dialog"></button></form><button id="close-dialog"></button></dialog></body>',{url:'https://anamariajacob.com.br/app/#paciente/demo-marina/demo-consulta/mapa'});
 const w=dom.window;w.HTMLDialogElement.prototype.close=function(){this.open=false;};w.matchMedia=()=>({matches:false});w.Element.prototype.setPointerCapture=function(){};
 let context,writes=0;
 context=vm.createContext({...domain,assertVisitEditable,fittedPhotoSize,MAP_ZOOM_LEVELS,structuredClone,crypto:webcrypto,console,document:w.document,window:w,location:w.location,history:w.history,FormData:w.FormData,URL:w.URL,isConnected:()=>true,confirm:()=>true,setTimeout:(fn,delay)=>delay===0?setImmediate(fn):0,clearTimeout(){},commit:async(expected,update)=>{writes++;const next=structuredClone(vm.runInContext('state',context));assert.equal(next.revision,expected);update(next);next.revision=expected+1;return next;}});
 vm.runInContext(source,context);const run=code=>vm.runInContext(code,context);
 const state=domain.seed();state.visits[0].status=status;if(point)state.visits[0].maps['demo-foto'].points=[point];context.fixture=state;context.kind=kind;context.batchMode=batch;
 run("state=fixture;patientId='demo-marina';visitId='demo-consulta';photoId='demo-foto';tool=kind;mapBatchMode=batchMode;tab='mapa';document.getElementById('content').innerHTML=mapPage(visit());");
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
 const pointer=(target,type,id,x,y)=>{const event=new w.MouseEvent(type,{clientX:x,clientY:y,button:0,bubbles:true,cancelable:true});Object.defineProperty(event,'pointerId',{value:id});target.dispatchEvent(event);};
 return{run,doc,w,stage,plane,writes:()=>writes,click,edit,submit,pointer};
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

test('a second pointer cannot move or finish the first drag and release waits for explicit save',async t=>{
 const original=sample(),h=harness(t,{point:original}),marker=h.doc.querySelector('[data-marker]'),r=h.plane.getBoundingClientRect(),x=r.left+original.x*r.width,y=r.top+original.y*r.height;
 h.pointer(marker,'pointerdown',11,x,y);
 h.pointer(h.doc,'pointermove',22,x+90,y+60);h.pointer(h.doc,'pointerup',22,x+90,y+60);await tick();
 assert.equal(h.run('drag.moved'),false);assert.equal(h.writes(),0);assert.equal(h.run('dirty'),false);assert.deepEqual(structuredClone(h.run('map().points[0]')),original);
 h.pointer(h.doc,'pointermove',11,x+40,y+20);assert.equal(h.run('clean()'),false,'Navigation must not interrupt an active drag');h.pointer(h.doc,'pointerup',11,x+40,y+20);await tick();
 assert.equal(h.run('dirty'),true);assert.equal(h.writes(),0);assert.deepEqual(structuredClone(h.run('map().points[0]')),original);assert.match(h.doc.getElementById('point-state').textContent,/não salv/);
 await h.submit();assert.equal(h.writes(),1);assert.ok(Math.abs(h.run('map().points[0].x')-original.x-40/r.width)<1e-12);assert.equal(h.run('dirty'),false);
});

test('a draft can be dragged repeatedly and cancelling the second gesture preserves the first unsaved adjustment',async t=>{
 const original=sample(),h=harness(t,{point:original}),r=h.plane.getBoundingClientRect(),x=r.left+original.x*r.width,y=r.top+original.y*r.height;
 h.pointer(h.doc.querySelector('[data-marker]'),'pointerdown',1,x,y);h.pointer(h.doc,'pointermove',1,x+30,y+10);h.pointer(h.doc,'pointerup',1,x+30,y+10);await tick();
 const first=Number(h.doc.getElementById('map-x').dataset.mapOriginal);
 h.pointer(h.doc.querySelector('[data-marker]'),'pointerdown',2,x+30,y+10);h.pointer(h.doc,'pointermove',2,x+70,y+10);h.pointer(h.doc,'pointercancel',2,x+70,y+10);
 assert.equal(Number(h.doc.getElementById('map-x').dataset.mapOriginal),first);assert.equal(h.run('dirty'),true);assert.equal(h.writes(),0);
 h.pointer(h.doc.querySelector('[data-marker]'),'pointerdown',3,x+30,y+10);h.pointer(h.doc,'pointermove',3,x+60,y+10);h.pointer(h.doc,'pointerup',3,x+60,y+10);await tick();
 assert.ok(Math.abs(Number(h.doc.getElementById('map-x').dataset.mapOriginal)-original.x-60/r.width)<1e-12);
 h.click('cancel-point');assert.equal(h.run('dirty'),false);assert.equal(h.writes(),0);assert.deepEqual(structuredClone(h.run('map().points[0]')),original);
});

test('refusing a selection on release never applies another marking geometry to the current form',async t=>{
 const original=sample(),h=harness(t,{point:original}),b={...sample(),id:'point-b',x:.65,y:.7};h.run('map().points.push('+JSON.stringify(b)+');drawMap();selectPoint("synthetic-point");confirm=()=>false;');
 const r=h.plane.getBoundingClientRect(),x=r.left+b.x*r.width,y=r.top+b.y*r.height;
 h.pointer(h.doc.querySelector('[data-marker="point-b"]'),'pointerdown',11,x,y);h.pointer(h.doc,'pointermove',11,x+20,y+10);
 h.edit('point-region','Edição pendente de A');h.pointer(h.doc,'pointerup',11,x+20,y+10);await tick();
 assert.equal(h.run('selectedId'),original.id);assert.equal(Number(h.doc.getElementById('map-x').dataset.mapOriginal),original.x);assert.equal(h.doc.getElementById('point-region').value,'Edição pendente de A');assert.equal(h.writes(),0);
});

test('lost pointer capture releases controls and preserves the previously unsaved draft',t=>{
 const original=sample(),h=harness(t,{point:original});h.click('select-point',original.id);h.edit('map-x','40');
 const marker=h.doc.querySelector('[data-marker]'),r=h.plane.getBoundingClientRect(),x=r.left+.4*r.width,y=r.top+original.y*r.height;
 h.pointer(marker,'pointerdown',41,x,y);h.pointer(h.doc,'pointermove',41,x+25,y+10);h.pointer(marker,'lostpointercapture',99,x,y);assert.ok(h.run('drag'));
 h.pointer(marker,'lostpointercapture',41,x+25,y+10);assert.equal(h.run('drag'),null);assert.equal(h.doc.getElementById('map-x').value,'40');assert.equal(h.run('dirty'),true);assert.equal(h.doc.getElementById('point-form').inert,false);assert.equal(h.writes(),0);
});

test('normal capture release after pointerup preserves the prepared draft before and after gesture cleanup',async t=>{
 const original=sample(),h=harness(t,{point:original}),r=h.plane.getBoundingClientRect(),x=r.left+original.x*r.width,y=r.top+original.y*r.height;
 h.pointer(h.doc.querySelector('[data-marker]'),'pointerdown',61,x,y);h.pointer(h.doc,'pointermove',61,x+25,y+15);h.pointer(h.doc,'pointerup',61,x+25,y+15);
 const prepared=Number(h.doc.getElementById('map-x').dataset.mapOriginal);
 h.pointer(h.doc,'lostpointercapture',61,x+25,y+15);assert.equal(h.run('dirty'),true);assert.equal(Number(h.doc.getElementById('map-x').dataset.mapOriginal),prepared);
 await tick();h.pointer(h.doc,'lostpointercapture',61,x+25,y+15);assert.equal(h.run('drag'),null);assert.equal(h.run('dirty'),true);assert.equal(h.run('selectedId'),original.id);assert.equal(Number(h.doc.getElementById('map-x').dataset.mapOriginal),prepared);assert.equal(h.doc.getElementById('point-form').inert,false);assert.equal(h.writes(),0);
 await h.submit();assert.equal(h.writes(),1);assert.equal(h.run('map().points[0].x'),prepared);
});

test('zoom, navigation, selection and toolbar cancellation cannot interrupt an active pointer gesture',async t=>{
 const h=harness(t,{point:sample()}),marker=h.doc.querySelector('[data-marker]'),r=h.plane.getBoundingClientRect(),x=r.left+.3333333333333333*r.width,y=r.top+.42*r.height;
 h.pointer(marker,'pointerdown',51,x,y);
 assert.equal(h.run('clean()'),false,'Even the armed gesture must not navigate away');h.run('setMapZoom(10)');assert.equal(h.run('zoom'),1);
 h.click('cancel-point');h.click('new-map-point');h.click('tool','linha');assert.equal(h.run('tool'),'ponto');assert.equal(h.run('pending'),null);assert.ok(h.run('drag'));assert.equal(h.run('selectPoint("synthetic-point")'),false);
 h.pointer(h.doc,'pointermove',51,x+20,y+10);h.run('setMapZoom(3)');assert.equal(h.run('zoom'),1);h.pointer(h.doc,'pointerup',51,x+20,y+10);await tick();
 assert.equal(h.doc.getElementById('point-form').inert,false);h.click('map-zoom','3');assert.equal(h.run('zoom'),3);assert.equal(h.run('dirty'),true);assert.equal(h.writes(),0);
});

test('export draws thin rose marks clipped to the photo, preserves positions and keeps the full legend outside the clip',async t=>{
 const point={...sample('leque'),x:.9,y:.98,x2:.95,y2:1,region:'Região teste',product:'Produto teste',lot:'LOTE-SINTETICO',quantity:1.25,unit:'mL'},h=harness(t,{point}),before=JSON.stringify(h.run('state'));
 const calls=[],styles={},stack=[];let clipped=false;
 const methods={save(){stack.push({...styles,clipped});},restore(){const saved=stack.pop();Object.assign(styles,saved);clipped=saved.clipped;},beginPath(){},rect(...args){calls.push({method:'rect',args});},clip(){clipped=true;calls.push({method:'clip'});},moveTo(...args){calls.push({method:'moveTo',args,clipped});},lineTo(...args){calls.push({method:'lineTo',args,clipped});},closePath(){},arc(...args){calls.push({method:'arc',args,clipped});},fill(){calls.push({method:'fill',clipped,color:styles.fillStyle});},stroke(){calls.push({method:'stroke',clipped,color:styles.strokeStyle,width:styles.lineWidth});},fillText(...args){calls.push({method:'text',args,clipped,color:styles.fillStyle});},fillRect(){},drawImage(){}};
 const context=new Proxy(methods,{get:(target,key)=>target[key]??styles[key],set:(_target,key,value)=>{styles[key]=value;return true;}});
 h.w.HTMLCanvasElement.prototype.getContext=()=>context;h.w.HTMLCanvasElement.prototype.toBlob=function(callback){callback(new h.w.Blob(['synthetic-png'],{type:'image/png'}));};
 h.run('globalThis.downloads=[];download=(blob,name)=>downloads.push({size:blob.size,name});');await h.run('exportMap()');
 assert.deepEqual(calls.find(call=>call.method==='rect').args,[0,0,1122,1402]);assert.equal(calls.filter(call=>call.method==='clip').length,1);
 assert(calls.filter(call=>['stroke','fill','arc','lineTo'].includes(call.method)).every(call=>call.clipped));
 const arc=calls.find(call=>call.method==='arc');assert.equal(arc.args[0],point.x*1122);assert.equal(arc.args[1],point.y*1402);assert.equal(arc.args[2],11*1122/1000);
 assert(calls.some(call=>call.method==='lineTo'&&call.args[1]>1402),'The out-of-frame fan remains geometrically unchanged and is clipped only when drawn');
 assert(calls.some(call=>call.method==='stroke'&&call.color==='#754859'&&Math.abs(call.width-1.5*1122/1000)<1e-12));
 const legend=calls.find(call=>call.method==='text'&&String(call.args[0]).includes('LOTE-SINTETICO'));assert.equal(legend.clipped,false);assert.equal(legend.color,'#30262c');assert.equal(legend.args[0],'1. Região teste · Produto teste · 1.25 mL · lote LOTE-SINTETICO');
 assert.equal(h.run('downloads.length'),1);assert.equal(h.writes(),0);assert.equal(JSON.stringify(h.run('state')),before);
});

for(const kind of ['linha','leque'])test(`dragging ${kind} previews the whole shape and cancel restores the original geometry`,async t=>{
 const original=sample(kind),h=harness(t,{point:original}),marker=h.doc.querySelector('[data-marker]'),r=h.plane.getBoundingClientRect(),x=r.left+original.x*r.width,y=r.top+original.y*r.height,before=h.doc.getElementById('map-svg').innerHTML;
 h.pointer(marker,'pointerdown',31,x,y);h.pointer(h.doc,'pointermove',31,x+40,y+20);
 const expected=domain.translateAnnotation(original,domain.normalizedPoint(x+40,y+20,r));
 assert.notEqual(h.doc.getElementById('map-svg').innerHTML,before);assert.equal(Number.parseFloat(marker.style.left),expected.x*100);assert.equal(h.writes(),0);assert.deepEqual(structuredClone(h.run('map().points[0]')),original);
 h.pointer(h.doc,'pointercancel',42,x,y);assert.equal(h.run('drag.id'),original.id,'Another pointer cannot cancel the active drag');
 h.pointer(h.doc,'pointercancel',31,x,y);assert.equal(h.run('drag'),null);assert.equal(h.doc.getElementById('map-svg').innerHTML,before);assert.equal(h.run('dirty'),false);assert.equal(h.writes(),0);
});

const traceSample=()=>({id:'synthetic-trace',kind:'traco',x:.2,y:.3,vertices:[{x:.2,y:.3},{x:.7,y:.2},{x:.5,y:.6}],region:'Desenho de teste',product:'',quantity:null,unit:'sem quantidade',lot:'',notes:''});
function drawTrace(h,id=71,vertices=[{x:.2,y:.3},{x:.3,y:.5},{x:.6,y:.4}]){
 const r=h.plane.getBoundingClientRect(),at=p=>({x:r.left+p.x*r.width,y:r.top+p.y*r.height});let position=at(vertices[0]);h.pointer(h.plane,'pointerdown',id,position.x,position.y);
 for(const vertex of vertices.slice(1)){position=at(vertex);h.pointer(h.doc,'pointermove',id,position.x,position.y);}
 h.pointer(h.doc,'pointerup',id,position.x,position.y);return{r,position};
}

test('caneta cria prévia normalizada e só persiste após o botão externo Salvar, preservando foto e geometria',async t=>{
 const h=harness(t,{kind:'traco',width:320,height:430}),before=JSON.stringify(h.run('photo()'));
 assert.equal(h.doc.getElementById('save-point').getAttribute('form'),'point-form');assert.equal(h.doc.getElementById('point-form').contains(h.doc.getElementById('save-point')),false);
 drawTrace(h);assert.equal(h.writes(),0);assert.equal(h.run('dirty'),true);assert.equal(h.run('map().points.length'),0);assert.ok(h.doc.querySelector('#map-svg polyline'));assert.equal(h.doc.getElementById('point-quantity').disabled,true);assert.equal(h.doc.getElementById('point-unit').disabled,true);assert.equal(h.doc.getElementById('map-end-position').hidden,true);assert.equal(h.doc.getElementById('save-point').disabled,false);
 const vertices=structuredClone(h.run('pending.vertices'));assert.equal(vertices.length,3);for(const [i,p]of [{x:.2,y:.3},{x:.3,y:.5},{x:.6,y:.4}].entries()){assert.ok(Math.abs(vertices[i].x-p.x)<1e-12);assert.ok(Math.abs(vertices[i].y-p.y)<1e-12);}
 await tick();h.doc.getElementById('save-point').click();await tick();assert.equal(h.writes(),1);const saved=h.run('map().points[0]');assert.equal(saved.kind,'traco');assert.deepEqual(structuredClone(saved.vertices),vertices);assert.equal(saved.x,saved.vertices[0].x);assert.equal(saved.y,saved.vertices[0].y);assert.equal(saved.quantity,null);assert.equal(saved.unit,'sem quantidade');assert.equal(Object.hasOwn(saved,'x2'),false);assert.equal(h.run('map().version'),1);assert.equal(h.run('map().history.length'),1);assert.equal(JSON.stringify(h.run('photo()')),before);
 h.click('select-point',saved.id);assert.equal(h.doc.getElementById('point-region').value,saved.region);assert.ok(h.doc.querySelector('#map-svg polyline'));assert.equal(h.writes(),1);
});

test('caneta ignora segundo dedo e bloqueia zoom, ferramenta, foco, seleção de foto e salvamento durante o gesto',async t=>{
 const h=harness(t,{kind:'traco'}),r=h.plane.getBoundingClientRect(),x=r.left+.2*r.width,y=r.top+.3*r.height;
 h.doc.getElementById('photo-select').insertAdjacentHTML('beforeend','<option value="other-photo">Outra foto</option>');
 h.pointer(h.plane,'pointerdown',81,x,y);h.pointer(h.doc,'pointermove',82,x+60,y+90);h.pointer(h.doc,'pointerup',82,x+60,y+90);h.pointer(h.doc,'pointercancel',82,x,y);assert.equal(h.run('drag.vertices.length'),1);assert.equal(h.run('drag.pointerId'),81);
 h.click('map-focus');h.click('tool','ponto');h.click('cancel-point');h.run('setMapZoom(10)');await h.submit();assert.equal(h.run('zoom'),1);assert.equal(h.run('tool'),'traco');assert.equal(h.doc.querySelector('.map-layout').classList.contains('is-focused'),false);assert.equal(h.run('clean()'),false);assert.equal(h.writes(),0);
 const select=h.doc.getElementById('photo-select');select.value='other-photo';select.dispatchEvent(new h.w.Event('change',{bubbles:true}));assert.equal(select.value,'demo-foto');assert.equal(h.run('photoId'),'demo-foto');
 h.pointer(h.doc,'pointermove',81,x+40,y+20);h.pointer(h.doc,'pointerup',81,x+40,y+20);await tick();assert.equal(h.run('dirty'),true);assert.equal(h.run('pending.vertices.length'),2);assert.equal(h.writes(),0);assert.equal(h.doc.querySelector('.map-toolbar').inert,false);
});

test('caneta cancelada ou sem movimento não cria rascunho nem altera marcações anteriores',async t=>{
 for(const ending of ['pointercancel','lostpointercapture','pointerup']){const h=harness(t,{kind:'traco',point:sample()}),before=JSON.stringify(h.run('state')),svg=h.doc.getElementById('map-svg').innerHTML,r=h.plane.getBoundingClientRect(),x=r.left+.2*r.width,y=r.top+.2*r.height;
  h.pointer(h.plane,'pointerdown',91,x,y);if(ending!=='pointerup')h.pointer(h.doc,'pointermove',91,x+30,y+60);h.pointer(h.doc,ending,91,x,y);await tick();assert.equal(h.run('drag'),null);assert.equal(h.run('pending'),null);assert.equal(h.run('dirty'),false);assert.equal(h.doc.getElementById('point-form').inert,false);assert.equal(h.doc.getElementById('map-svg').innerHTML,svg);assert.equal(JSON.stringify(h.run('state')),before);assert.equal(h.writes(),0);
 }
});

test('perda normal de captura após terminar caneta conserva o rascunho e recusa troca de foto sem descarte',async t=>{
 const h=harness(t,{kind:'traco'}),{position}=drawTrace(h,101),prepared=JSON.stringify(h.run('pending'));h.pointer(h.doc,'lostpointercapture',101,position.x,position.y);assert.equal(JSON.stringify(h.run('pending')),prepared);await tick();h.pointer(h.doc,'lostpointercapture',101,position.x,position.y);assert.equal(h.run('drag'),null);assert.equal(JSON.stringify(h.run('pending')),prepared);
 h.run('confirm=()=>false');h.doc.getElementById('photo-select').insertAdjacentHTML('beforeend','<option value="other-photo">Outra foto</option>');const select=h.doc.getElementById('photo-select');select.value='other-photo';select.dispatchEvent(new h.w.Event('change',{bubbles:true}));assert.equal(h.run('photoId'),'demo-foto');assert.equal(select.value,'demo-foto');assert.equal(JSON.stringify(h.run('pending')),prepared);assert.equal(h.writes(),0);
});

test('caneta limita amostras longas mantendo início/fim e coordenadas de zoom sem gravações intermediárias',async t=>{
 const h=harness(t,{kind:'traco',width:320,height:430});h.click('map-zoom','3');const points=Array.from({length:700},(_,i)=>({x:.1+.8*i/699,y:i%2?.6:.4}));drawTrace(h,111,points);await tick();const vertices=structuredClone(h.run('pending.vertices'));assert.ok(vertices.length>=2&&vertices.length<=256);assert.ok(Math.abs(vertices[0].x-points[0].x)<1e-12);assert.ok(Math.abs(vertices.at(-1).x-points.at(-1).x)<1e-12);assert.ok(Math.abs(vertices.at(-1).y-points.at(-1).y)<1e-12);assert.equal(h.writes(),0);await h.submit();assert.equal(h.writes(),1);assert.deepEqual(structuredClone(h.run('map().points[0].vertices')),vertices);
});

test('traço pode ser movido por teclado e coordenadas, respeita borda de todos os vértices e mantém foco',async t=>{
 const original=traceSample(),h=harness(t,{kind:'traco',point:original}),before=structuredClone(original);h.click('select-point',original.id);
 h.doc.querySelector('[data-marker]').focus();h.doc.activeElement.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'ArrowRight',shiftKey:true,bubbles:true,cancelable:true}));assert.equal(h.doc.activeElement.dataset.marker,original.id);assert.equal(h.writes(),0);assert.deepEqual(structuredClone(h.run('map().points[0]')),before);
 h.edit('map-x','90');const preview=structuredClone(h.run('readMapGeometry(map().points[0])'));assert.ok(Math.abs(Math.max(...preview.vertices.map(p=>p.x))-1)<1e-12);assert.ok(Math.abs(preview.x-.5)<1e-12);assert.ok(Math.abs(preview.vertices[1].x-preview.vertices[0].x-.5)<1e-12);assert.equal(h.doc.getElementById('map-end-position').hidden,true);
 await h.submit();assert.equal(h.writes(),1);assert.deepEqual(structuredClone(h.run('map().points[0].vertices')),preview.vertices);assert.deepEqual(original,before);
});

test('arraste de traço mostra todos os vértices e cancelar preserva sua versão anterior',async t=>{
 const original=traceSample(),h=harness(t,{kind:'traco',point:original}),r=h.plane.getBoundingClientRect(),x=r.left+original.x*r.width,y=r.top+original.y*r.height,svg=h.doc.getElementById('map-svg').innerHTML;
 h.pointer(h.doc.querySelector('[data-marker]'),'pointerdown',121,x,y);h.pointer(h.doc,'pointermove',121,x+35,y+25);assert.notEqual(h.doc.getElementById('map-svg').innerHTML,svg);assert.equal(h.writes(),0);h.pointer(h.doc,'pointerup',121,x+35,y+25);await tick();assert.equal(h.run('dirty'),true);const moved=structuredClone(h.run('readMapGeometry(map().points[0])'));assert.ok(Math.abs(moved.vertices[1].x-original.vertices[1].x-35/r.width)<1e-12);h.click('cancel-point');assert.equal(h.run('dirty'),false);assert.equal(h.doc.getElementById('map-svg').innerHTML,svg);assert.deepEqual(structuredClone(h.run('map().points[0]')),original);assert.equal(h.writes(),0);
});

test('editor ampliado conserva rascunho, geometria e controles ao entrar e sair',async t=>{
 const h=harness(t,{kind:'traco'}),button=h.doc.querySelector('[data-action="map-focus"]');drawTrace(h);await tick();const pending=JSON.stringify(h.run('pending')),before=JSON.stringify(h.run('state'));assert.equal(h.doc.querySelector('.map-layout').classList.contains('has-selection'),true);
 button.focus();h.click('map-focus');assert.equal(button.getAttribute('aria-pressed'),'true');assert.equal(button.textContent,'Voltar ao prontuário');assert.equal(h.doc.querySelector('.map-layout').classList.contains('is-focused'),true);assert.equal(h.doc.activeElement,button);assert.equal(JSON.stringify(h.run('pending')),pending);assert.equal(h.run('dirty'),true);
 h.click('map-focus');assert.equal(button.getAttribute('aria-pressed'),'false');assert.equal(button.textContent,'Ampliar editor');assert.equal(h.doc.querySelector('.map-layout').classList.contains('is-focused'),false);assert.equal(JSON.stringify(h.run('state')),before);assert.equal(h.writes(),0);assert.equal(h.doc.getElementById('save-point').disabled,false);
});

test('consulta concluída ou bloqueada não aceita caneta nem movimento, mantendo leitura, foco e zoom',t=>{
 for(const status of ['concluido','cancelado','bloqueado']){const h=harness(t,{kind:'traco',point:traceSample(),status:status==='bloqueado'?'rascunho':status});if(status==='bloqueado')h.run("visit().lockedAt='2026-10-15T18:00:00.000Z';drawMap();");const before=JSON.stringify(h.run('state'));drawTrace(h);assert.equal(h.run('drag'),null);assert.equal(h.run('pending'),null);assert.equal(h.run('dirty'),false);h.click('select-point','synthetic-trace');assert.equal(h.doc.getElementById('save-point').disabled,true);assert.equal(h.doc.getElementById('map-x').disabled,true);h.click('move-map-point','right');assert.equal(h.run('dirty'),false);h.click('map-focus');h.click('map-zoom','3');assert.equal(h.run('zoom'),3);assert.equal(JSON.stringify(h.run('state')),before);assert.equal(h.writes(),0);}
});

function tapPhoto(h,x=.3,y=.4){const r=h.plane.getBoundingClientRect();h.plane.dispatchEvent(new h.w.MouseEvent('click',{clientX:r.left+x*r.width,clientY:r.top+y*r.height,detail:1,bubbles:true}));}
const batchIds=h=>[...h.run('mapBatch.items.map(item=>item.point.id)')];

test('sequência padrão registra vinte toques numerados sem abrir formulário nem exigir dados e salva uma só transação',async t=>{
 const h=harness(t,{batch:true}),before=JSON.stringify(h.run('state'));assert.ok(h.run('mapBatch'));assert.equal(h.doc.querySelector('[data-action="toggle-map-batch"]').getAttribute('aria-pressed'),'true');
 for(let i=0;i<20;i++)tapPhoto(h,.1+i*.03,.2+i*.02);
 assert.equal(h.run('mapBatch.items.length'),20);assert.equal(h.writes(),0);assert.equal(JSON.stringify(h.run('state')),before);assert.equal(h.doc.querySelector('.map-layout').classList.contains('has-selection'),false);assert.equal(h.doc.querySelectorAll('[data-batch-marker]').length,20);assert.deepEqual([...h.doc.querySelectorAll('[data-batch-marker]')].map(b=>b.textContent),Array.from({length:20},(_,i)=>String(i+1)));assert.match(h.doc.getElementById('map-batch-status').textContent,/20 marcações pendentes/);
 assert.equal(h.doc.getElementById('point-region')===h.doc.activeElement,false);h.click('save-map-batch');await tick();assert.equal(h.writes(),1);assert.equal(h.run('map().points.length'),20);assert.equal(h.run('map().version'),1);assert.equal(h.run('map().history.length'),1);assert.equal(h.run('mapBatch.items.length'),0);assert.equal(h.run('dirty'),false);assert.equal(h.doc.querySelector('.map-layout').classList.contains('has-selection'),false);assert(h.run('map().points.every(p=>p.quantity===null&&p.unit==="sem quantidade")'));
});

test('sequência conserva campos e posições individuais ao alternar marcações, usando quantidades independentes',async t=>{
 const h=harness(t,{batch:true});tapPhoto(h,.2,.3);tapPhoto(h,.5,.6);tapPhoto(h,.7,.4);const ids=batchIds(h);
 h.click('select-batch-point',ids[0]);assert.equal(h.doc.querySelector('.map-layout').classList.contains('has-selection'),true);h.edit('point-region','Região A');h.edit('point-product','Produto A');h.edit('point-quantity','0,2');h.edit('point-unit','mL');h.edit('point-lot','LOTE A');h.edit('point-notes','Nota A');h.edit('map-x','25');
 h.click('select-batch-point',ids[1]);h.edit('point-region','Região B');h.edit('point-quantity','3');h.edit('point-unit','U');h.click('select-batch-point',ids[0]);assert.equal(h.doc.getElementById('point-region').value,'Região A');assert.equal(h.doc.getElementById('point-quantity').value,'0,2');assert.equal(h.doc.getElementById('point-product').value,'Produto A');assert.equal(h.doc.getElementById('map-x').value,'25');assert.match(h.doc.querySelector('.map-procedure-context').textContent,/Avaliação facial/);
 h.click('save-map-batch');await tick();const saved=structuredClone(h.run('map().points'));assert.equal(h.writes(),1);assert.equal(saved[0].quantity,.2);assert.equal(saved[0].unit,'mL');assert.equal(saved[0].x,.25);assert.equal(saved[0].lot,'LOTE A');assert.equal(saved[0].notes,'Nota A');assert.equal(saved[1].quantity,3);assert.equal(saved[1].unit,'U');assert.equal(saved[2].quantity,null);
});

test('erro de um item não grava nenhum e mantém texto inválido ao alternar e corrigir',async t=>{
 const h=harness(t,{batch:true});tapPhoto(h,.2,.3);tapPhoto(h,.5,.6);const ids=batchIds(h);h.click('select-batch-point',ids[0]);h.edit('point-quantity','erro');h.click('select-batch-point',ids[1]);h.edit('point-notes','Preservar');h.click('save-map-batch');await tick();assert.equal(h.writes(),0);assert.equal(h.run('map().points.length'),0);assert.equal(h.run('pending.id'),ids[0]);assert.equal(h.doc.getElementById('point-quantity').value,'erro');assert.match(h.doc.getElementById('point-error').textContent,/Marcação 1/);
 h.edit('point-quantity','.2');h.click('save-map-batch');await tick();assert.equal(h.writes(),0);h.edit('point-quantity','0.2');h.edit('point-unit','mL');h.click('save-map-batch');await tick();assert.equal(h.writes(),1);assert.equal(h.run('map().points[1].notes'),'Preservar');
});

test('caneta e leque em sequência preservam todos os rascunhos sem exigir salvar entre itens',async t=>{
 const h=harness(t,{batch:true});tapPhoto(h,.2,.3);h.click('tool','leque');tapPhoto(h,.5,.5);assert.equal(h.run('mapBatch.items.length'),2);assert.equal(h.run('pending.x2'),undefined);tapPhoto(h,.7,.3);assert.equal(h.run('mapBatch.items.length'),2);assert.ok(Math.abs(h.run('pending.x2')-.7)<1e-12);h.click('tool','traco');drawTrace(h,301);await tick();drawTrace(h,302,[{x:.6,y:.5},{x:.7,y:.6}]);await tick();assert.equal(h.run('mapBatch.items.length'),4);assert.equal(h.writes(),0);h.click('save-map-batch');await tick();assert.equal(h.writes(),1);assert.deepEqual([...h.run('map().points.map(p=>p.kind)')],['ponto','leque','traco','traco']);
});

test('leque incompleto impede gravação do conjunto inteiro e pode receber ponto final depois',async t=>{
 const h=harness(t,{batch:true});tapPhoto(h,.2,.3);h.click('tool','leque');tapPhoto(h,.5,.5);const fanId=batchIds(h)[1];h.click('save-map-batch');await tick();assert.equal(h.writes(),0);assert.equal(h.run('pending.id'),fanId);tapPhoto(h,.6,.3);h.click('save-map-batch');await tick();assert.equal(h.writes(),1);assert.equal(h.run('map().points.length'),2);
});

test('descartar conjunto exige confirmação, preserva mapa salvo e reverte todos os rascunhos',t=>{
 const original=sample(),h=harness(t,{batch:true,point:original});tapPhoto(h,.2,.2);tapPhoto(h,.6,.6);h.run('confirm=()=>false');h.click('discard-map-batch');assert.equal(h.run('mapBatch.items.length'),2);assert.equal(h.run('clean()'),false);assert.equal(h.run('dirty'),true);h.run('confirm=()=>true');h.click('discard-map-batch');assert.equal(h.run('mapBatch.items.length'),0);assert.equal(h.run('pending'),null);assert.equal(h.run('dirty'),false);assert.deepEqual(structuredClone(h.run('map().points')),[original]);assert.equal(h.writes(),0);
});

test('conflito ao salvar conjunto preserva IDs, geometria e dados e repetição não cria marcações duplicadas',async t=>{
 const h=harness(t,{batch:true});tapPhoto(h,.2,.3);tapPhoto(h,.5,.6);const ids=batchIds(h);h.edit('point-notes','Preservado após conflito');h.run('globalThis.realCommit=commit;commit=async()=>{throw Error("Outra alteração foi salva; confira a versão.")};');h.click('save-map-batch');await tick();assert.equal(h.run('mapBatch.items.length'),2);assert.deepEqual(batchIds(h),ids);assert.equal(h.run('dirty'),true);assert.equal(h.doc.getElementById('point-notes').value,'Preservado após conflito');assert.match(h.doc.getElementById('point-error').textContent,/Outra alteração/);assert.equal(h.run('map().points.length'),0);
 h.run('commit=realCommit');h.click('save-map-batch');await tick();assert.equal(h.writes(),1);assert.deepEqual([...h.run('map().points.map(p=>p.id)')],ids);h.click('save-map-batch');await tick();assert.equal(h.writes(),1);
});

test('troca de foto e navegação recusadas mantêm conjunto completo, inclusive dados do item não selecionado',t=>{
 const h=harness(t,{batch:true});tapPhoto(h,.2,.3);tapPhoto(h,.5,.6);const ids=batchIds(h);h.click('select-batch-point',ids[0]);h.edit('point-region','Não perder');h.click('select-batch-point',ids[1]);h.run('confirm=()=>false');const before=JSON.stringify(h.run('mapBatch'));assert.equal(h.run('clean()'),false);h.doc.getElementById('photo-select').insertAdjacentHTML('beforeend','<option value="other">Outra foto</option>');const select=h.doc.getElementById('photo-select');select.value='other';select.dispatchEvent(new h.w.Event('change',{bubbles:true}));assert.equal(h.run('photoId'),'demo-foto');assert.equal(JSON.stringify(h.run('mapBatch')),before);h.click('select-batch-point',ids[0]);assert.equal(h.doc.getElementById('point-region').value,'Não perder');assert.equal(h.writes(),0);
});

test('conjunto limita 1000 itens e remoção individual não altera outros itens nem o histórico salvo',t=>{
 const h=harness(t,{batch:true});tapPhoto(h,.2,.3);const first=batchIds(h)[0];h.run('const batchTemplate=structuredClone(mapBatch.items[0]);mapBatch.items=Array.from({length:1000},(_,i)=>({...structuredClone(batchTemplate),point:{...batchTemplate.point,id:"draft-"+i}}));pending=mapBatch.items[0].point;');const count=h.run('mapBatch.items.length');assert.equal(h.run('addBatchMark({kind:"ponto",x:.4,y:.4})'),false);assert.equal(h.run('mapBatch.items.length'),count);assert.equal(h.writes(),0);
 h.run('mapBatch.items=mapBatch.items.slice(0,2);pending=mapBatch.items[0].point;drawMap()');h.click('cancel-point');assert.equal(h.run('mapBatch.items.length'),1);assert.equal(h.run('mapBatch.items[0].point.id'),'draft-1');assert.equal(h.run('map().history.length'),0);assert.equal(h.writes(),0);
});

for(const kind of ['linha','leque'])test(`${kind}: arrastar cria direção/comprimento no lote sem salvar e recusa segundo dedo`,async t=>{
 const h=harness(t,{batch:true,kind}),r=h.plane.getBoundingClientRect(),x=r.left+.3*r.width,y=r.top+.5*r.height,x2=r.left+.6*r.width,y2=r.top+.3*r.height;
 h.pointer(h.plane,'pointerdown',401,x,y);h.pointer(h.doc,'pointermove',402,x2,y2);h.pointer(h.doc,'pointerup',402,x2,y2);assert.equal(h.run('mapBatch.items.length'),0);assert.equal(h.run('drag.moved'),false);
 h.pointer(h.doc,'pointermove',401,x2,y2);assert.equal(h.run('mapBatch.items.length'),0);assert.equal(h.doc.querySelectorAll('#map-svg line').length,kind==='leque'?3:1);assert.equal(h.doc.querySelectorAll('#map-svg path').length,0);h.pointer(h.doc,'pointerup',401,x2,y2);await tick();assert.equal(h.run('mapBatch.items.length'),1);assert.equal(h.run('dirty'),true);assert.equal(h.writes(),0);const p=h.run('mapBatch.items[0].point');assert.ok(Math.abs(p.x-.3)<1e-12);assert.ok(Math.abs(p.y-.5)<1e-12);assert.ok(Math.abs(p.x2-.6)<1e-12);assert.ok(Math.abs(p.y2-.3)<1e-12);if(kind==='leque')assert.equal(p.fanSpread,48);assert.equal(h.doc.querySelector('.map-layout').classList.contains('has-selection'),false);
 h.click('save-map-batch');await tick();assert.equal(h.writes(),1);assert.equal(h.run('map().points.length'),1);
});

test('cancelar gesto de leque conserva lote anterior e dois toques continuam válidos sem comprimento automático',async t=>{
 const h=harness(t,{batch:true});tapPhoto(h,.2,.3);h.click('tool','leque');const before=JSON.stringify(h.run('mapBatch')),r=h.plane.getBoundingClientRect(),x=r.left+.5*r.width,y=r.top+.5*r.height;
 h.pointer(h.plane,'pointerdown',411,x,y);h.pointer(h.doc,'pointermove',411,x+40,y+30);h.pointer(h.doc,'pointercancel',411,x+40,y+30);assert.equal(h.run('mapBatch.items.length'),1);assert.equal(JSON.stringify(h.run('mapBatch')),before);assert.equal(h.writes(),0);
 h.pointer(h.plane,'pointerdown',412,x,y);h.pointer(h.doc,'pointerup',412,x,y);tapPhoto(h,.5,.5);await tick();assert.equal(h.run('mapBatch.items.length'),2);assert.equal(h.run('pending.x2'),undefined);tapPhoto(h,.7,.3);assert.equal(h.run('mapBatch.items.length'),2);assert.equal(h.run('pending.fanSpread'),48);
});

test('desfazer reverte o conjunto inteiro e o próximo conjunto usa a revisão atual do mapa',async t=>{
 const original=sample(),h=harness(t,{batch:true,point:original});tapPhoto(h,.2,.3);tapPhoto(h,.5,.6);h.click('save-map-batch');await tick();assert.equal(h.run('map().points.length'),3);assert.equal(h.run('map().history.length'),1);h.click('undo-map');await tick();assert.deepEqual(structuredClone(h.run('map().points')),[original]);assert.equal(h.run('map().version'),2);assert.equal(h.run('map().history.length'),0);tapPhoto(h,.4,.5);h.click('save-map-batch');await tick();assert.equal(h.writes(),3);assert.equal(h.run('map().points.length'),2);assert.equal(h.run('map().version'),3);
});
