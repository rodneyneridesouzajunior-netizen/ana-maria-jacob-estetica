import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {annotationCheck,MAX_TRACE_VERTICES,fanRays} from '../domain.mjs';
import {renderVisitRecord,renderVisitMarkings} from '../visit-record-ui.mjs';

const {JSDOM}=createRequire(new URL('../../../../../skinpro-analise/test-tools/package.json',import.meta.url))('jsdom');
let canvasLibrary;
try{canvasLibrary=createRequire(import.meta.url)('@napi-rs/canvas');}
catch{canvasLibrary=createRequire(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json'))('@napi-rs/canvas');}
const {createCanvas,loadImage}=canvasLibrary;
const source=await fs.readFile(new URL('../app.mjs',import.meta.url),'utf8');
const exportStart=source.indexOf('function drawExportAnnotations('),exportEnd=source.indexOf('function download(',exportStart);
assert(exportStart>=0&&exportEnd>exportStart,'Use the production renderer and export function');
const exportSource=source.slice(exportStart,exportEnd);
const trace=(overrides={})=>({id:'trace-test',kind:'traco',x:.2,y:.2,vertices:[{x:.2,y:.2},{x:.8,y:.2},{x:.8,y:.8}],region:'Contorno manual',product:'',notes:'Observação da profissional',lot:'',quantity:null,unit:'sem quantidade',...overrides});
const fixture=points=>({patients:[{id:'patient',name:'Paciente sintética'}],visits:[{id:'visit',patientId:'patient',date:'2026-10-15',status:'rascunho',photos:[{id:'photo',label:'Frontal',width:1000,height:1250}],maps:{photo:{points,history:[],version:1}}}],bills:[],payments:[]});
function dom(t,html){const value=new JSDOM('<!doctype html><body>'+html);t.after(()=>value.window.close());return value.window.document;}
function draw(points,width=500,height=500){
 const canvas=createCanvas(width,height+100),ctx=canvas.getContext('2d');ctx.fillStyle='#fcfbfa';ctx.fillRect(0,0,width,height+100);
 const context=vm.createContext({annotationCheck,fanRays});vm.runInContext(exportSource,context);
 context.drawExportAnnotations(ctx,points,width,height);
 return{canvas,ctx,pixel:(x,y)=>Array.from(ctx.getImageData(x,y,1,1).data)};
}
const frozen=value=>{if(value&&typeof value==='object'){for(const item of Object.values(value))frozen(item);Object.freeze(value);}return value;};

test('read-only overlay renders every normalized trace vertex in order without closing or filling it',t=>{
 const value=frozen(trace()),before=structuredClone(value),doc=dom(t,renderVisitMarkings([value]));
 const line=doc.querySelector('polyline');assert(line);assert.equal(line.getAttribute('points'),'200,200 800,200 800,800');assert.equal(line.getAttribute('fill'),'none');assert.equal(line.getAttribute('vector-effect'),'non-scaling-stroke');
 assert.equal(doc.querySelector('.vr-map-number').getAttribute('style'),'left:20%;top:20%');assert.equal(doc.querySelectorAll('path').length,0);assert.deepEqual(value,before);
});

test('summary names free drawing separately and never adds its quantity to a dose total',t=>{
 const point={id:'dose',kind:'ponto',x:.4,y:.5,region:'Registro existente',quantity:2,unit:'U'};
 const s=frozen(fixture([trace(),point])),before=structuredClone(s),doc=dom(t,renderVisitRecord(s,{patientId:'patient',visitId:'visit',connected:true}));
 assert.equal(doc.querySelector('.vr-point-kind').textContent,'Desenho livre');assert.equal(doc.querySelector('.vr-point-amount').textContent,'Sem quantidade');assert.equal(doc.querySelector('.vr-totals strong').textContent,'2 U');assert.deepEqual(s,before);
 const bad=fixture([trace({quantity:999,unit:'U'}),point]),invalid=dom(t,renderVisitRecord(bad,{patientId:'patient',visitId:'visit'}));
 assert.equal(invalid.querySelectorAll('polyline').length,0);assert.equal(invalid.querySelector('.vr-totals strong').textContent,'2 U');assert.doesNotMatch(invalid.body.textContent,/999/);
});

test('a photo containing only free drawings does not claim a missing dose or product consumption',t=>{
 const doc=dom(t,renderVisitRecord(fixture([trace()]),{patientId:'patient',visitId:'visit'}));
 assert.equal(doc.querySelector('.vr-totals strong').textContent,'Desenhos livres sem quantidade');assert.equal(doc.querySelectorAll('.vr-products li').length,0);
});

test('malformed trace geometry cannot become SVG markup or a partial exported image',t=>{
 const malformed=[
  trace({vertices:[{x:.2,y:.2}]}),trace({vertices:Array.from({length:257},()=>({x:.2,y:.2}))}),
  trace({vertices:[{x:.2,y:.2},{x:'1" onload="bad()',y:.2}]}),trace({vertices:[{x:.2,y:.2},{x:1.01,y:.2}]}),
  trace({vertices:[{x:.2,y:.2},{x:NaN,y:.2}]}),trace({vertices:[{x:.2,y:.2},{x:.4,y:.5,extra:1}]}),
  trace({x:.3}),trace({x2:undefined}),trace({y2:undefined}),trace({quantity:1,unit:'mL'})
 ];
 for(const value of malformed){const doc=dom(t,renderVisitMarkings([value]));assert.equal(doc.querySelectorAll('polyline,.vr-map-number,[onload]').length,0);assert.throws(()=>draw([value]));}
});

test('maximum-length valid trace preserves all 256 vertices and original data',t=>{
 const vertices=Array.from({length:MAX_TRACE_VERTICES},(_,i)=>({x:i/(MAX_TRACE_VERTICES-1),y:.5})),value=frozen(trace({x:0,y:.5,vertices}));
 const doc=dom(t,renderVisitMarkings([value]));assert.equal(doc.querySelector('polyline').getAttribute('points').split(' ').length,256);draw([value]);assert.equal(value.vertices[255].x,1);
});

test('real PNG contains the open rose trace, leaves its interior clear, clips to the photo, and reopens',async()=>{
 const value=frozen(trace()),before=structuredClone(value),{canvas,pixel}=draw([value]);
 assert.notDeepEqual(pixel(250,100),[252,251,250,255],'The horizontal segment must be painted');
 assert.deepEqual(pixel(250,250),[252,251,250,255],'Do not close the open polyline with a diagonal');
 assert.deepEqual(pixel(300,200),[252,251,250,255],'Do not fill the outlined area');
 assert.deepEqual(pixel(250,550),[252,251,250,255],'The footer must remain outside the clipped drawing');
 const bytes=canvas.toBuffer('image/png');assert.equal(bytes.subarray(1,4).toString(),'PNG');const reopened=await loadImage(bytes);assert.equal(reopened.width,500);assert.equal(reopened.height,600);assert.deepEqual(value,before);
 const edge=draw([trace({x:1,y:1,vertices:[{x:1,y:1},{x:.8,y:1}]})]);assert.deepEqual(edge.pixel(499,501),[252,251,250,255]);
});

test('legacy point, line and fan still render alongside a trace with stable numbering',t=>{
 const points=[{kind:'ponto',x:.1,y:.1},{kind:'linha',x:.2,y:.4,x2:.4,y2:.4},{kind:'leque',x:.4,y:.6,x2:.6,y2:.7},trace()];
 const doc=dom(t,renderVisitMarkings(points));assert.equal(doc.querySelectorAll('.vr-map-number').length,4);assert.equal(doc.querySelectorAll('line').length,4);assert.equal(doc.querySelectorAll('.vr-fan-ray').length,3);assert.equal(doc.querySelectorAll('path').length,0);assert.equal(doc.querySelectorAll('polyline').length,1);assert.deepEqual([...doc.querySelectorAll('.vr-map-number')].map(el=>el.textContent),['1','2','3','4']);draw(points);
});

test('real PNG fan has three open equal rays at the photo aspect, without a filled wedge or closing base',()=>{
 const point=frozen({id:'fan',kind:'leque',x:.5,y:.2,x2:.5,y2:.7,fanSpread:48,region:'Leque manual',quantity:2,unit:'U'}),before=structuredClone(point),width=500,height=1000;
 const {pixel}=draw([point],width,height),rays=fanRays(point,width/height);
 for(const ray of rays){const x=Math.round((ray.x1+ray.x2)/2*width),y=Math.round((ray.y1+ray.y2)/2*height);assert.notDeepEqual(pixel(x,y),[252,251,250,255],'Every ray must be painted at its physical midpoint');}
 assert.deepEqual(pixel(300,450),[252,251,250,255],'The space between central and outer rays remains clear');
 assert.deepEqual(pixel(300,657),[252,251,250,255],'There is no closed triangular base');
 assert.deepEqual(pixel(250,1050),[252,251,250,255],'The legend remains outside the drawing');assert.deepEqual(point,before);
});

test('complete PNG export labels free drawing without a dose and preserves saved points',async()=>{
 const points=frozen([trace(),{id:'old',kind:'ponto',x:.1,y:.1,region:'Ponto existente',product:'Produto informado',quantity:2,unit:'U',lot:'LOTE-TESTE'}]),before=structuredClone(points);
 const photoCanvas=createCanvas(500,500);photoCanvas.getContext('2d').fillStyle='#fcfbfa';photoCanvas.getContext('2d').fillRect(0,0,500,500);const image=await loadImage(photoCanvas.toBuffer('image/png'));Object.defineProperties(image,{complete:{value:true},naturalWidth:{value:500},naturalHeight:{value:500}});
 const output=createCanvas(1,1),ctx=output.getContext('2d'),labels=[],downloads=[];
 const spy=new Proxy(ctx,{get(target,key){if(key==='fillText')return(...args)=>{labels.push(String(args[0]));return target.fillText(...args);};const value=target[key];return typeof value==='function'?value.bind(target):value;},set(target,key,value){target[key]=value;return true;}});
 output.toBlob=callback=>callback(new Blob([output.toBuffer('image/png')],{type:'image/png'}));
 const context=vm.createContext({annotationCheck,fanRays,dirty:false,pending:null,drag:null,photo:()=>({label:'Frontal'}),map:()=>({points,version:4}),visit:()=>({date:'2026-10-15'}),$:()=>image,isConnected:()=>false,document:{createElement:()=>({set width(v){output.width=v;},set height(v){output.height=v;},getContext:()=>spy,toBlob:output.toBlob})},download:(blob,name)=>downloads.push({blob,name}),toast(){}});
 vm.runInContext(exportSource,context);await context.exportMap();assert.equal(downloads.length,1);
 assert(labels.includes('1. Contorno manual · Desenho livre'));assert(labels.includes('2. Ponto existente · Produto informado · 2 U · lote LOTE-TESTE'));assert(!labels.some(label=>label.includes('sem quantidade')||label.includes('null')));
 const reopened=await loadImage(Buffer.from(await downloads[0].blob.arrayBuffer()));assert.equal(reopened.width,500);assert.equal(reopened.height,686);assert.deepEqual(points,before);
});
