import test from 'node:test';
import assert from 'node:assert/strict';
import {mountPrivateMap,newMapPoint,moveMapPoint} from '../map-ui.mjs';
const empty={schemaVersion:1,points:[],notes:''};
test('manual points carry no inferred treatment and line endpoints survive bounded dragging',()=>{
 const old=newMapPoint(1,'ponto',{x:.1,y:.2});assert.equal(old.label,'');assert.equal(old.notes,'');assert.equal(old.quantity,undefined);
 const line=newMapPoint(2,'linha',{x:.2,y:.3},{x:.8,y:.9});assert.equal(line.quantity,null);assert.equal(line.product,'');
 const moved=moveMapPoint(line,.5,.5);assert.equal(moved.x2,1);assert.equal(moved.y2,1);assert.ok(Math.abs((moved.x2-moved.x)-.6)<1e-12);assert.equal(line.x,.2);
});
function harness(save){
 const elements={reason:{value:'Registro manual'},image:{naturalWidth:1000,naturalHeight:1500,addEventListener(){},removeAttribute(){}},stage:{clientWidth:800,clientHeight:600},plane:{style:{},getBoundingClientRect:()=>({left:0,top:0,width:500,height:750})},svg:{innerHTML:''},dirty:{textContent:''}};
 const names={'[data-map-reason]':'reason','[data-map-image]':'image','[data-map-stage]':'stage','[data-map-plane]':'plane','[data-map-svg]':'svg','[data-map-dirty]':'dirty'},events=new Map(),messages=[];
 const container={innerHTML:'',querySelector:s=>elements[names[s]],querySelectorAll:()=>[],addEventListener:(n,fn)=>events.set(n,fn),removeEventListener:n=>events.delete(n),setAttribute(){},removeAttribute(){}};
 const binding={protocol_id:'protocol',photo_id:'photo',patient_id:'patient',protocol_version:1,photo_revision:'a'.repeat(32)};
 const api={config:{supabaseUrl:'https://example.test'},maps:{save,open:async()=>({binding,annotation:{version:1,document:empty}})}};
 const view=mountPrivateMap(container,{api,opened:{binding,annotation:null,photo:{signed_url:'https://example.test/storage/v1/object/sign/clinic-media/test?token=fake',expires_in:120}},writesEnabled:true,onMessage:text=>messages.push(text)});
 const clickAction=action=>events.get('click')({target:{closest:s=>s==='[data-map-action]'?{dataset:{mapAction:action}}:null}});
 const add=()=>events.get('click')({clientX:100,clientY:225,target:{closest:s=>s==='[data-map-plane]'?{}:null}});
 const input=(key,value)=>events.get('input')({target:{dataset:{mapField:key},value,matches:()=>false}});
 return {view,container,messages,api,add,input,clickAction,elements};
}
test('actual private editor snapshots save, blocks edits while busy and confirms only server response',async t=>{
 let finish,sent;const h=harness(payload=>{sent=payload;return new Promise(resolve=>finish=resolve);});t.after(()=>h.view.dispose());
 await h.add();h.input('label','Registro 1');assert.equal(h.view.isDirty(),true);
 const saving=h.clickAction('save');assert.equal(h.view.isBusy(),true);h.input('label','Alteração durante envio');assert.equal(sent.document.points[0].label,'Registro 1');
 finish({binding:sent,annotation:{version:1,document:sent.document}});await saving;assert.equal(h.view.isDirty(),false);assert.match(h.messages.at(-1),/confirmada pelo servidor/);
});
test('uncertain save keeps draft and prevents another write until reconciled',async t=>{
 let calls=0;const h=harness(async()=>{calls++;throw Object.assign(Error('unknown'),{uncertain:true});});t.after(()=>h.view.dispose());
 await h.add();const before=h.container.innerHTML;await h.clickAction('save');assert.equal(h.view.isDirty(),true);assert.notEqual(h.container.innerHTML,before);assert.match(h.container.innerHTML,/data-map-action="verify"/);
 await h.clickAction('save');assert.equal(calls,1);assert.match(h.messages.at(-1),/rascunho foi mantido/);
});
test('private editor disposal ignores late response and clears listeners',async()=>{
 let finish;const h=harness(payload=>new Promise(resolve=>finish=()=>resolve({binding:{},annotation:{version:1,document:payload.document}})));
 await h.add();const saving=h.clickAction('save');h.view.dispose();const html=h.container.innerHTML;finish();await saving;assert.equal(h.container.innerHTML,html);assert.equal(h.messages.length,0);
});
test('uncertain reconciliation cannot accept identical document bound to another patient',async t=>{
 let payload;const h=harness(async value=>{payload=value;throw Object.assign(Error('unknown'),{uncertain:true});});t.after(()=>h.view.dispose());
 await h.add();await h.clickAction('save');h.api.maps.open=async()=>({binding:{protocol_id:'protocol',photo_id:'photo',patient_id:'other',protocol_version:1,photo_revision:'a'.repeat(32)},annotation:{version:1,document:payload.document}});
 await h.clickAction('verify');assert.equal(h.view.isDirty(),true);assert.match(h.messages.at(-1),/não substituirá outra versão automaticamente/);
});
