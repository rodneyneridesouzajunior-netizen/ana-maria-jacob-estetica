import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {annotationCheck,fanRays,DEFAULT_FAN_SPREAD,translateAnnotation,seed} from '../domain.mjs';
import {buildBackup,verifyBackup,validateBackupState} from '../backup.mjs';
import {renderVisitMarkings,renderVisitRecord} from '../visit-record-ui.mjs';
const {JSDOM}=createRequire(new URL('../../../../../skinpro-analise/test-tools/package.json',import.meta.url))('jsdom');
const near=(a,b,tolerance=1e-12)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);
const sample=(patch={})=>({id:'fan',kind:'leque',x:.4,y:.3,x2:.55,y2:.6,region:'Leque informado',product:'Produto informado',quantity:2,unit:'U',lot:'LOTE-TESTE',notes:'Registro da profissional',...patch});
const modern=patch=>sample({fanSpread:DEFAULT_FAN_SPREAD,...patch});

test('three open fan rays reproduce observed ±24° photo-space geometry',()=>{
 const width=1000,height=1777.7778,p=modern({x:699.21875/width,y:946.618194/height,x2:680.989583/width,y2:1098.962526/height}),before=structuredClone(p),rays=fanRays(Object.freeze(p),width/height);
 assert.equal(rays.length,3);assert.equal(DEFAULT_FAN_SPREAD,48);
 for(const [ray,expected]of rays.map((ray,i)=>[ray,[[744.529599,1093.206136],[680.989583,1098.962526],[620.601556,1078.377196]][i]])){
  near(ray.x1*width,699.21875,1e-6);near(ray.y1*height,946.618194,1e-6);near(ray.x2*width,expected[0],.00001);near(ray.y2*height,expected[1],.00001);
 }
 assert.deepEqual(p,before);assert.equal(rays[1].x2,p.x2);assert.equal(rays[1].y2,p.y2);
});

test('new fans retain equal physical ray lengths and opening across portrait/landscape photos and orientations',()=>{
 for(const aspect of [.5,.5625,1,1.7777778,2])for(const [x2,y2]of [[.6,.3],[.4,.6],[.2,.5],[.3,.1]]){
  const p=modern({x2,y2}),rays=fanRays(p,aspect),axis={x:(p.x2-p.x)*aspect,y:p.y2-p.y},length=Math.hypot(axis.x,axis.y);
  for(const [i,ray]of rays.entries()){
   const vector={x:(ray.x2-ray.x1)*aspect,y:ray.y2-ray.y1};near(Math.hypot(vector.x,vector.y),length);
   const angle=Math.atan2(axis.x*vector.y-axis.y*vector.x,axis.x*vector.x+axis.y*vector.y)*180/Math.PI;near(angle,[-24,0,24][i],1e-10);
  }
 }
});

test('legacy endpoints retain exact historical fixed width, with central ray added and no data migration',()=>{
 const p=Object.freeze(sample()),before=structuredClone(p),dx=p.x2-p.x,dy=p.y2-p.y,length=Math.hypot(dx,dy),nx=-dy/length*.055,ny=dx/length*.055;
 const rays=fanRays(p,.5625);assert.deepEqual(rays,[{x1:p.x,y1:p.y,x2:p.x2+nx,y2:p.y2+ny},{x1:p.x,y1:p.y,x2:p.x2,y2:p.y2},{x1:p.x,y1:p.y,x2:p.x2-nx,y2:p.y2-ny}]);
 assert.deepEqual(fanRays(p,2),rays);assert.deepEqual(p,before);assert.equal(Object.hasOwn(p,'fanSpread'),false);
});

test('opening is explicit, bounded and valid only for fans; translation preserves angle and clinical quantities',()=>{
 for(const fanSpread of [0,-1,120.01,NaN,Infinity,'48',null,undefined])assert.throws(()=>annotationCheck(sample({fanSpread})));
 for(const kind of ['ponto','linha','traco'])assert.throws(()=>annotationCheck(modern({kind})));
 for(const fanSpread of [.01,48,120])assert.equal(annotationCheck(modern({fanSpread})).fanSpread,fanSpread);
 for(const aspect of [0,-1,NaN,Infinity])assert.throws(()=>fanRays(modern(),aspect));
 const original=modern(),next=translateAnnotation(original,{x:.5,y:.4});assert.equal(next.fanSpread,48);assert.equal(next.quantity,2);assert.equal(next.unit,'U');near(next.x2-next.x,original.x2-original.x);near(next.y2-next.y,original.y2-original.y);
});

test('tips outside the photo are preserved for visual clipping, never flattened at the edge',()=>{
 const p=modern({x:.8,y:.8,x2:1,y2:1,fanSpread:120}),rays=fanRays(p,.5);assert(rays.some(ray=>ray.x2>1||ray.y2>1));assert.deepEqual(p,modern({x:.8,y:.8,x2:1,y2:1,fanSpread:120}));
 const zero=fanRays(modern({x2:.4,y2:.3}),.5);assert(zero.every(ray=>ray.x1===ray.x2&&ray.y1===ray.y2));
});

test('summary uses original photo aspect and exactly three unfilled lines without triangulation',t=>{
 const state=seed(),visit=state.visits[0],photo=visit.photos[0],p=modern();photo.width=900;photo.height=1600;visit.maps[photo.id].points=[p];
 const dom=new JSDOM(renderVisitRecord(state,{patientId:visit.patientId,visitId:visit.id}));t.after(()=>dom.window.close());
 const lines=[...dom.window.document.querySelectorAll('.vr-fan-ray')],expected=fanRays(p,900/1600);assert.equal(lines.length,3);assert.equal(dom.window.document.querySelectorAll('.vr-map-shapes path,.vr-map-shapes polygon').length,0);
 for(const [i,line]of lines.entries()){near(Number(line.getAttribute('x2')),expected[i].x2*1000);near(Number(line.getAttribute('y2')),expected[i].y2*1000);assert.equal(line.getAttribute('fill'),'none');}
 const malformed=renderVisitMarkings([modern({fanSpread:'48" onload="bad()'})]);assert.doesNotMatch(malformed,/onload|vr-fan-ray|NaN/);
});

test('portable backup reopens legacy and angular fans with exact history, without adding defaults to old records',async()=>{
 const state=seed(),map=state.visits[0].maps['demo-foto'];map.points=[sample({id:'legacy'}),modern()];map.history=[[sample({id:'legacy'})]];map.version=1;
 const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT8sAAAAASUVORK5CYII='),c=>c.charCodeAt(0));
 const backup=await buildBackup({state,photos:[]},async()=>new Blob([png],{type:'image/png'})),restored=await verifyBackup(backup);assert.deepEqual(restored.state.visits[0].maps,state.visits[0].maps);
 assert.equal(Object.hasOwn(restored.state.visits[0].maps['demo-foto'].points[0],'fanSpread'),false);
 const invalid=structuredClone(state);invalid.visits[0].maps['demo-foto'].history[0][0].fanSpread=121;assert.throws(()=>validateBackupState(invalid),/abertura/);
});
