import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {webcrypto} from 'node:crypto';
import * as domain from '../domain.mjs';
import {assertVisitEditable,saveProcedure} from '../operations-domain.mjs';
import {fittedPhotoSize,MAP_ZOOM_LEVELS} from '../map-fit.mjs';
import {createCloudStore} from '../cloud-store.mjs';
import {createWorkspaceHandler} from '../../../supabase/functions/app-workspace/handler.mjs';
import {emptyState,hash,stable,WorkspaceError} from '../../../supabase/functions/app-workspace/rules.mjs';

const {JSDOM}=createRequire(new URL('../../../../../skinpro-analise/test-tools/package.json',import.meta.url))('jsdom');
const source=(await readFile(new URL('../app.mjs',import.meta.url),'utf8')).replace(/^import .*$/gm,'').replace(/^try\{await setHash\(\);\}catch.*$/gm,'');
const clone=value=>structuredClone(value),tick=()=>new Promise(resolve=>setImmediate(resolve));
const stamp='2026-10-16T15:00:00.000Z';
const origin='https://anamariajacob.com.br';
const point=(id,quantity=.1)=>({id,kind:'ponto',x:.8,y:.8,region:'Referência sintética',product:'',quantity,unit:'mL',lot:'',notes:'',procedureId:null,procedureVersion:null,procedureSnapshot:null});

/** Actual cloud client, Edge handler and transition validation. Only database
 * IO is in memory; the DOM never serves as the persisted source of truth. */
async function server(t){
 const state=emptyState(),clinicId=webcrypto.randomUUID(),userId=webcrypto.randomUUID(),sessionId=webcrypto.randomUUID();
 state.patients.push({id:'synthetic-patient',name:'Paciente sintética'});
 for(const [suffix,name]of [['a','Procedimento A'],['b','Procedimento B'],['c','Procedimento C']])saveProcedure(state,{operationId:'setup-'+suffix,now:stamp,data:{id:'procedure-'+suffix,name,price:10000,cost:1000,duration:30,recordMode:'injectable'}});
 state.visits.push({id:'synthetic-visit',patientId:'synthetic-patient',professionalId:'amj-principal',date:'2026-10-16',service:'Atendimento sintético',status:'rascunho',notes:'',procedureId:state.procedures[0].id,procedureVersion:1,procedureSnapshot:clone(state.procedures[0]),recordMode:'injectable',photos:[{id:'synthetic-photo',label:'Foto sintética',phase:'antes',sha256:'a'.repeat(64),width:800,height:1000,revision:1}],maps:{'synthetic-photo':{version:0,points:[],history:[]}}});
 state.revision=1;
 let row={state,revision:1,state_hash:await hash(stable(state)),updated_at:stamp},dropBefore=false,dropAfter=false,writes=0;
 const operations=new Map(),versions=new Map([[1,clone(row)]]),requests=[];
 const photo={id:'synthetic-photo',status:'ready',patient_id:'synthetic-patient',visit_id:'synthetic-visit',sha256:'a'.repeat(64),width:800,height:1000};
 const repository={load:async()=>clone(row),photos:async()=>[clone(photo)],operation:async(_clinic,id)=>clone(operations.get(id)||null),version:async(_clinic,revision)=>clone(versions.get(revision)||null),
  commit:async p=>{if(row.revision!==p.p_expected)throw new WorkspaceError('revision_conflict','Conflito de teste.',409);writes++;row={state:clone(p.p_state),revision:p.p_state.revision,state_hash:p.p_state_hash,updated_at:stamp};versions.set(row.revision,clone(row));operations.set(p.p_operation,{operation_id:p.p_operation,kind:'commit',status:'committed',fingerprint:p.p_fingerprint,revision:row.revision});return clone(row);}
 };
 const handler=createWorkspaceHandler({repository,authenticate:async()=>({authMethod:'supabase_auth',role:'owner',aal:'aal2',clinicId,userId,sessionId}),authorize:async()=>{},now:()=>stamp});
 const fetchImpl=async(url,init)=>{
  const payload=JSON.parse(init.body);requests.push(clone(payload));
  if(payload.acao==='commit'&&dropBefore){dropBefore=false;throw Error('Synthetic disconnect before server');}
  const response=await handler(new Request(url,{...init,headers:{...init.headers,Origin:origin}}));
  if(payload.acao==='commit'&&response.ok&&dropAfter){dropAfter=false;throw Error('Synthetic disconnect after server commit');}
  return response;
 };
 return{row:()=>clone(row),writes:()=>writes,requests,dropBefore(){dropBefore=true;},dropAfter(){dropAfter=true;},client(){const statuses=[],store=createCloudStore({session:{requireReady:async()=>({token:'synthetic-test-only'}),assertCurrent:async()=>{}},fetchImpl,onStatus:s=>statuses.push(s)});t.after(()=>store.dispose());return{store,statuses};}};
}

async function ui(t,client){
 const initial=await client.store.load(),d=new JSDOM('<!doctype html><body><nav id="nav"></nav><select id="area-switch"></select><span id="crumb"></span><span id="date-label"></span><main id="content"></main><div id="toast"></div><dialog id="dialog"><h2 id="dialog-title"></h2><form id="dialog-form"><div id="dialog-fields"></div><p id="dialog-error"></p><button id="cancel-dialog"></button></form><button id="close-dialog"></button></dialog></body>',{url:origin+'/app/#paciente/synthetic-patient/synthetic-visit/mapa'});
 const w=d.window,doc=w.document,inflight=new Set();w.HTMLDialogElement.prototype.close=function(){this.open=false;};w.matchMedia=()=>({matches:false});w.scrollTo=()=>{};w.Element.prototype.setPointerCapture=function(){};
 const context=vm.createContext({...domain,assertVisitEditable,fittedPhotoSize,MAP_ZOOM_LEVELS,structuredClone,crypto:webcrypto,console,document:doc,window:w,location:w.location,history:w.history,FormData:w.FormData,URL:w.URL,isConnected:()=>true,confirm:()=>true,setTimeout:(fn,delay)=>delay===0?setImmediate(fn):0,clearTimeout(){},load:()=>client.store.load(),commit:(...args)=>{const result=client.store.commit(...args);inflight.add(result);result.then(()=>inflight.delete(result),()=>inflight.delete(result));return result;}});
 vm.runInContext(source,context);const run=code=>vm.runInContext(code,context);
 function repaint(value){context.fixture=clone(value);run("state=fixture;patientId='synthetic-patient';visitId='synthetic-visit';photoId='synthetic-photo';route='paciente';tab='mapa';mapBatchMode=true;mapBatch=null;pending=null;selectedId=null;dirty=false;document.getElementById('content').innerHTML=mapPage(visit());");
  const image=doc.getElementById('map-photo'),stage=doc.getElementById('photo-stage'),plane=doc.getElementById('photo-plane');
  Object.defineProperties(image,{complete:{value:true},naturalWidth:{value:800},naturalHeight:{value:1000}});Object.defineProperties(stage,{clientWidth:{value:400},clientHeight:{value:500}});
  stage.getBoundingClientRect=plane.getBoundingClientRect=()=>({left:0,top:0,width:400,height:500,right:400,bottom:500});run('fitMapPlane();drawMap();');
 }
 repaint(initial);t.after(()=>w.close());
 const settle=async()=>{await tick();while(inflight.size)await Promise.allSettled([...inflight]);await tick();};
 const click=(action,id)=>{const el=doc.querySelector(`[data-action="${action}"]${id?`[data-id="${id}"]`:''}`);assert.ok(el,'Control '+action);el.click();};
 const edit=(id,value)=>{const el=doc.getElementById(id);assert.ok(el,id);el.value=value;el.dispatchEvent(new w.Event('input',{bubbles:true}));};
 const choose=id=>{const option=[...doc.getElementById('point-procedure').options].find(o=>{try{return JSON.parse(o.value).procedureId===id;}catch{return false;}});assert.ok(option,id);edit('point-procedure',option.value);};
 const add=(x,y)=>doc.getElementById('photo-plane').dispatchEvent(new w.MouseEvent('click',{clientX:x*400,clientY:y*500,detail:1,bubbles:true}));
 return{run,doc,w,add,edit,choose,click,settle,repaint,ids:()=>[...run('mapBatch.items.map(item=>item.point.id)')],save:async()=>{click('save-map-batch');await settle();},submit:async()=>{doc.getElementById('point-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await settle();}};
}

function createThree(h){h.add(.2,.25);h.add(.45,.5);h.add(.7,.7);return h.ids();}
function fillThree(h,ids){
 for(const [index,quantity]of ['0,1','0,25','0,1'].entries()){
  h.click('select-batch-point',ids[index]);h.choose('procedure-'+['a','b','c'][index]);h.edit('point-quantity',quantity);h.edit('point-unit','mL');h.edit('point-notes','Nota sintética '+(index+1));
 }
}
const savedMap=s=>s.visits[0].maps['synthetic-photo'];

test('previous/next and continue marking preserve each individual form, resume the active item and never commit before explicit save',async t=>{
 const backend=await server(t),h=await ui(t,backend.client()),ids=createThree(h);
 assert.equal(h.doc.getElementById('map-batch-navigation').hidden,true);
 h.click('select-batch-point',ids[0]);
 const action=name=>h.doc.querySelector('[data-action="'+name+'"]');
 assert.equal(h.doc.getElementById('map-batch-position').textContent,'1 de 3');
 assert.equal(action('batch-previous-point').disabled,true);assert.equal(action('batch-next-point').disabled,false);
 h.click('batch-previous-point');assert.equal(h.run('pending.id'),ids[0]);
 h.choose('procedure-a');h.edit('point-quantity','0,1');h.edit('point-unit','mL');h.edit('point-notes','Primeiro ponto sintético');
 h.click('batch-next-point');assert.equal(h.run('pending.id'),ids[1]);assert.equal(h.doc.getElementById('map-batch-position').textContent,'2 de 3');
 assert.equal(h.doc.getElementById('point-quantity').value,'');assert.equal(h.doc.getElementById('point-procedure').value,'');
 h.choose('procedure-b');h.edit('point-quantity','0,25');h.edit('point-unit','mL');h.edit('point-notes','Segundo ponto sintético');
 h.click('batch-next-point');assert.equal(h.run('pending.id'),ids[2]);assert.equal(action('batch-next-point').disabled,true);
 h.click('batch-next-point');assert.equal(h.run('pending.id'),ids[2]);h.choose('procedure-c');h.edit('point-quantity','0,1');h.edit('point-unit','mL');
 h.click('batch-previous-point');assert.equal(h.run('pending.id'),ids[1]);assert.equal(h.doc.getElementById('point-quantity').value,'0,25');assert.equal(h.doc.getElementById('point-notes').value,'Segundo ponto sintético');
 h.click('continue-map-batch');assert.equal(h.run('mapBatch.editing'),false);assert.equal(h.doc.getElementById('map-batch-navigation').hidden,true);assert.equal(h.doc.activeElement.id,'photo-stage');assert.equal(h.run('pending.id'),ids[1]);assert.deepEqual(h.ids(),ids);
 h.click('edit-map-batch');assert.equal(h.run('pending.id'),ids[1]);assert.equal(h.run('mapBatch.editing'),true);assert.equal(h.doc.getElementById('map-batch-position').textContent,'2 de 3');assert.equal(h.doc.getElementById('point-quantity').value,'0,25');
 assert.equal(backend.writes(),0);assert.equal(backend.requests.some(p=>p.acao==='commit'),false);assert.equal(savedMap(backend.row().state).points.length,0);
 h.click('continue-map-batch');h.add(.85,.25);assert.equal(h.ids().length,4);assert.equal(h.doc.getElementById('point-procedure').value,'');assert.equal(h.doc.getElementById('point-quantity').value,'');
 h.click('select-batch-point',ids[0]);assert.equal(h.doc.getElementById('point-notes').value,'Primeiro ponto sintético');assert.equal(h.doc.getElementById('map-batch-position').textContent,'1 de 4');
 await h.save();assert.equal(backend.writes(),1);assert.deepEqual(savedMap(backend.row().state).points.map(p=>[p.procedureId,p.quantity]),[['procedure-a',.1],['procedure-b',.25],['procedure-c',.1],[null,null]]);
});

test('live legend shows individual decimal amounts and keeps saved totals separate from invalid or unsaved previews',async t=>{
 const backend=await server(t),h=await ui(t,backend.client()),ids=createThree(h);fillThree(h,ids);
 const entry=id=>h.doc.querySelector('[data-action="select-batch-point"][data-id="'+id+'"]');
 for(const [index,amount]of ['0,1 mL','0,25 mL','0,1 mL'].entries()){assert.equal(entry(ids[index]).querySelector('[data-map-quantity]').textContent,amount);assert.match(entry(ids[index]).textContent,new RegExp('Procedimento '+['A','B','C'][index]));}
 assert.match(h.doc.getElementById('quantity-totals').textContent,/Salvo: quantidades não informadas/);assert.match(h.doc.getElementById('quantity-totals').textContent,/Prévia não salva: 0,45 mL/);
 h.click('select-batch-point',ids[1]);h.edit('point-unit','sem quantidade');assert.match(entry(ids[1]).querySelector('[data-map-quantity]').textContent,/Escolha a unidade/);assert.match(h.doc.getElementById('quantity-totals').textContent,/confira 1 quantidade\(s\) ou unidade\(s\)/);assert.doesNotMatch(h.doc.getElementById('quantity-totals').textContent,/0,45 mL/);
 h.edit('point-unit','mL');await h.save();assert.equal(backend.writes(),1);assert.match(h.doc.getElementById('quantity-totals').textContent,/Salvo: 0,45 mL/);assert.doesNotMatch(h.doc.getElementById('quantity-totals').textContent,/Prévia não salva/);
 h.click('select-point',ids[1]);h.edit('point-quantity','0,1');assert.match(h.doc.getElementById('quantity-totals').textContent,/Salvo: 0,45 mL/);assert.match(h.doc.getElementById('quantity-totals').textContent,/Prévia não salva: 0,3 mL/);assert.equal(backend.writes(),1);assert.equal(savedMap(backend.row().state).points[1].quantity,.25);
});

test('four-decimal amounts stay visible and exact in saved legend, preview and a separate client',async t=>{
 const backend=await server(t),h=await ui(t,backend.client());h.add(.35,.4);const [id]=h.ids();h.click('select-batch-point',id);h.choose('procedure-a');h.edit('point-quantity','0,0001');h.edit('point-unit','mL');
 assert.equal(h.doc.querySelector('[data-map-quantity]').textContent,'0,0001 mL');assert.match(h.doc.getElementById('quantity-totals').textContent,/Prévia não salva: 0,0001 mL/);assert.doesNotMatch(h.doc.getElementById('quantity-totals').textContent,/\b0 mL\b/);
 await h.save();assert.equal(savedMap(backend.row().state).points[0].quantity,.0001);assert.match(h.doc.getElementById('quantity-totals').textContent,/Salvo: 0,0001 mL/);
 const reopened=await ui(t,backend.client());assert.equal(reopened.doc.querySelector('[data-map-quantity]').textContent,'0,0001 mL');reopened.click('select-point',id);reopened.edit('point-quantity','0,1');await reopened.submit();
 reopened.click('select-point',id);reopened.edit('point-quantity','0,25');assert.match(reopened.doc.getElementById('quantity-totals').textContent,/Salvo: 0,1 mL/);assert.match(reopened.doc.getElementById('quantity-totals').textContent,/Prévia não salva: 0,25 mL/);assert.equal(savedMap(backend.row().state).points[0].quantity,.1);assert.equal(backend.writes(),2);
});

test('three sequential locations keep independent procedures and decimal amounts, then reopen through a separate cloud client',async t=>{
 const backend=await server(t),a=backend.client(),h=await ui(t,a),ids=createThree(h);
 assert.equal(backend.writes(),0);assert.equal(h.run('mapBatch.items.length'),3);
 for(const id of ids){h.click('select-batch-point',id);assert.equal(h.doc.getElementById('point-procedure').value,'');assert.equal(h.doc.getElementById('point-quantity').value,'');assert.equal(h.doc.getElementById('point-unit').value,'sem quantidade');assert.equal(h.doc.getElementById('point-product').value,'');}
 fillThree(h,ids);
 for(const index of [0,2,1,0]){h.click('select-batch-point',ids[index]);assert.equal(JSON.parse(h.doc.getElementById('point-procedure').value).procedureId,'procedure-'+['a','b','c'][index]);assert.equal(h.doc.getElementById('point-quantity').value,['0,1','0,25','0,1'][index]);assert.equal(h.doc.getElementById('point-notes').value,'Nota sintética '+(index+1));}
 h.add(.8,.2);const fourth=h.ids().at(-1);assert.equal(h.doc.getElementById('point-procedure').value,'');assert.equal(h.doc.getElementById('point-quantity').value,'');assert.equal(h.doc.getElementById('point-unit').value,'sem quantidade');
 await h.save();assert.equal(backend.writes(),1,h.doc.getElementById('point-error').textContent);assert.equal(a.store.hasPending(),false);assert.equal(h.run('dirty'),false);
 const map=savedMap(backend.row().state);assert.deepEqual(map.points.map(p=>p.id),[...ids,fourth]);assert.deepEqual(map.points.map(p=>p.procedureId),['procedure-a','procedure-b','procedure-c',null]);assert.deepEqual(map.points.map(p=>p.quantity),[.1,.25,.1,null]);assert.deepEqual(map.points.map(p=>[p.x,p.y]),[[.2,.25],[.45,.5],[.7,.7],[.8,.2]]);assert.equal(map.history.length,1);assert.equal(map.version,1);assert.deepEqual(domain.quantityTotals(map.points),{mL:.45});
 const b=backend.client(),reopened=await ui(t,b);assert.equal(reopened.run('map().points.length'),4);
 reopened.click('select-point',ids[1]);assert.equal(JSON.parse(reopened.doc.getElementById('point-procedure').value).procedureId,'procedure-b');assert.equal(Number(reopened.doc.getElementById('point-quantity').value.replace(',','.')),.25);
 reopened.edit('point-quantity','0,1');await reopened.submit();assert.equal(backend.writes(),2);assert.deepEqual(savedMap(backend.row().state).points.map(p=>p.quantity),[.1,.1,.1,null]);assert.deepEqual(savedMap(backend.row().state).history.at(-1).map(p=>p.quantity),[.1,.25,.1,null]);
 const again=await a.store.load();assert.deepEqual(savedMap(again),savedMap(backend.row().state));
});

test('invalid quantity on one selected location blocks the entire batch and correction preserves all sibling drafts',async t=>{
 const backend=await server(t),h=await ui(t,backend.client()),ids=createThree(h);fillThree(h,ids);h.click('select-batch-point',ids[1]);h.edit('point-quantity','0,12345');await h.save();
 assert.equal(backend.writes(),0);assert.equal(h.run('dirty'),true);assert.equal(h.run('pending.id'),ids[1]);assert.match(h.doc.getElementById('point-error').textContent,/quantidade/i);assert.equal(savedMap(backend.row().state).history.length,0);
 for(const index of [0,2]){h.click('select-batch-point',ids[index]);assert.equal(h.doc.getElementById('point-quantity').value,'0,1');assert.equal(JSON.parse(h.doc.getElementById('point-procedure').value).procedureId,'procedure-'+['a','b','c'][index]);}
 h.click('select-batch-point',ids[1]);assert.equal(h.doc.getElementById('point-quantity').value,'0,12345');h.edit('point-quantity','0,25');await h.save();assert.equal(backend.writes(),1);assert.deepEqual(savedMap(backend.row().state).points.map(p=>p.quantity),[.1,.25,.1]);
});

for(const phase of ['before','after'])test(`batch receipt recovery: disconnect ${phase} server commit preserves exact operation and individual values without duplicate points`,async t=>{
 const backend=await server(t),a=backend.client(),h=await ui(t,a),ids=createThree(h);fillThree(h,ids);backend[phase==='before'?'dropBefore':'dropAfter']();await h.save();
 assert.equal(a.store.hasPending(),true);assert.equal(h.run('dirty'),true);assert.equal(h.run('busy'),false);assert.deepEqual(h.ids(),ids);assert.equal(backend.writes(),phase==='after'?1:0);
 const original=backend.requests.find(r=>r.acao==='commit'),operationId=original.operation_id;
 await assert.rejects(a.store.commit(1,()=>{}),{code:'pending_operation'});assert.equal(backend.requests.filter(r=>r.acao==='commit').length,1);
 for(const index of [1,0,2]){h.click('select-batch-point',ids[index]);assert.equal(JSON.parse(h.doc.getElementById('point-procedure').value).procedureId,'procedure-'+['a','b','c'][index]);assert.equal(h.doc.getElementById('point-quantity').value,['0,1','0,25','0,1'][index]);}
 const recovered=await a.store.resolvePending();assert.equal(a.store.hasPending(),false);assert.equal(backend.writes(),1);assert.deepEqual(savedMap(recovered).points.map(p=>p.id),ids);assert.deepEqual(savedMap(recovered).points.map(p=>p.quantity),[.1,.25,.1]);assert.equal(savedMap(recovered).history.length,1);
 const commits=backend.requests.filter(r=>r.acao==='commit');assert.equal(commits.length,phase==='before'?2:1);assert.ok(commits.every(p=>p.operation_id===operationId));if(commits.length===2)assert.deepEqual(commits[1],commits[0]);
 const reopened=await ui(t,backend.client());assert.deepEqual([...reopened.run('map().points.map(p=>p.id)')],ids);
});

test('same-map conflict on another device refuses silent merge, keeps all three drafts and does not overwrite the saved foreign point',async t=>{
 const backend=await server(t),a=backend.client(),b=backend.client(),h=await ui(t,a),other=await b.store.load(),ids=createThree(h);fillThree(h,ids);
 await b.store.commit(other.revision,state=>{const map=savedMap(state);map.history.push(clone(map.points));map.points.push(point('other-device-point'));map.version++;});
 await h.save();assert.equal(a.store.hasPending(),true);assert.equal(a.store.hasConflict(),true);assert.equal(h.run('dirty'),true);assert.deepEqual(h.ids(),ids);
 const refused=backend.requests.filter(p=>p.acao==='commit').at(-1),before=backend.row();
 await assert.rejects(a.store.reconcilePending(),{code:'reconciliation_conflict'});
 assert.deepEqual(backend.row(),before);assert.equal(a.store.hasPending(),true);assert.equal(backend.writes(),1);assert.deepEqual(savedMap(before.state).points.map(p=>p.id),['other-device-point']);
 for(const [index,quantity]of ['0,1','0,25','0,1'].entries()){h.click('select-batch-point',ids[index]);assert.equal(h.doc.getElementById('point-quantity').value,quantity);assert.equal(JSON.parse(h.doc.getElementById('point-procedure').value).procedureId,'procedure-'+['a','b','c'][index]);}
 await assert.rejects(a.store.resolvePending(),{code:'revision_conflict'});const repeat=backend.requests.filter(p=>p.acao==='commit').at(-1);assert.equal(repeat.operation_id,refused.operation_id);assert.deepEqual(repeat.state,refused.state);assert.equal(backend.writes(),1);
});
