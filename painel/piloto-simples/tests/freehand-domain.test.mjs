import test from 'node:test';
import assert from 'node:assert/strict';
import {annotationCheck,translateAnnotation,quantityTotals,MAX_TRACE_VERTICES} from '../domain.mjs';
import {visitMarkings} from '../operations-domain.mjs';

const trace=(vertices=[{x:.3,y:.4},{x:.9,y:.2},{x:.5,y:.8}])=>({id:'trace',kind:'traco',...vertices[0],vertices,region:'Desenho livre',product:'',quantity:null,unit:'sem quantidade',lot:'',notes:'Anotação visual'});
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-12,`${a} != ${b}`);

test('traço aceita de dois a 256 vértices normalizados sem normalizar ou mutar a entrada',()=>{
 assert.equal(MAX_TRACE_VERTICES,256);
 for(const count of [2,256]){const value=trace(Array.from({length:count},(_,i)=>({x:i/(count-1),y:1-i/(count-1)}))),before=structuredClone(value);assert.equal(annotationCheck(value),value);assert.deepEqual(value,before);}
});
test('traço recusa coleções ausentes, curtas, excessivas e esparsas',()=>{
 for(const vertices of [undefined,null,{},[],[{x:.3,y:.4}],Array.from({length:257},()=>({x:.3,y:.4})),[{x:.3,y:.4},, {x:.6,y:.6}]])assert.throws(()=>annotationCheck({...trace(),vertices}));
});
test('traço recusa coordenadas não numéricas, não finitas, fora da foto e campos ocultos no vértice',()=>{
 for(const vertex of [null,[],{x:.5},{x:'0.5',y:.4},{x:NaN,y:.4},{x:Infinity,y:.4},{x:-.001,y:.4},{x:1.001,y:.4},{x:.4,y:-.1},{x:.4,y:1.1},{x:.4,y:.4,path:'M0 0'},{x:.4,y:.4,pressure:.5}])assert.throws(()=>annotationCheck({...trace(),vertices:[{x:.3,y:.4},vertex]}));
});
test('âncora coincide com o primeiro vértice e traço não aceita extremidades de linha',()=>{
 for(const change of [{x:.31},{y:.41},{x2:.7},{y2:.7},{x2:undefined},{y2:undefined}])assert.throws(()=>annotationCheck({...trace(),...change}));
});
test('traço visual nunca admite quantidade nem unidade clínica',()=>{
 for(const change of [{quantity:0},{quantity:.2,unit:'mL'},{quantity:undefined},{unit:'U'},{unit:'mL'},{unit:undefined}])assert.throws(()=>annotationCheck({...trace(),...change}),/anotação visual/);
 const drawing=trace(),point={id:'point',kind:'ponto',x:.5,y:.5,region:'Teste',product:'Teste',quantity:.2,unit:'mL',lot:'',notes:''};
 assert.deepEqual(quantityTotals([drawing,point]),{mL:.2});
 assert.deepEqual(visitMarkings({maps:{photo:{points:[drawing,point]}}}).map(x=>x.pointId),['point']);
});
test('arraste limita o conjunto inteiro por vértices intermediários, mantendo cada deslocamento',()=>{
 const original=trace(),before=structuredClone(original),next=translateAnnotation(original,{x:1,y:0});
 close(next.vertices[1].x,1);close(next.vertices[1].y,0);
 for(let i=0;i<original.vertices.length;i++){close(next.vertices[i].x-original.vertices[i].x,.1);close(next.vertices[i].y-original.vertices[i].y,-.2);}
 assert.equal(next.x,next.vertices[0].x);assert.equal(next.y,next.vertices[0].y);
 assert.notEqual(next.vertices,original.vertices);assert.notEqual(next.vertices[0],original.vertices[0]);assert.deepEqual(original,before);assert.equal(next.notes,original.notes);
 assert.equal(Object.hasOwn(next,'x2'),false);assert.equal(Object.hasOwn(next,'y2'),false);
});
test('arraste de traço é válido nas quatro bordas e recusa alvo inválido',()=>{
 for(const target of [{x:-1,y:-1},{x:2,y:2},{x:-1,y:2},{x:2,y:-1}]){const moved=translateAnnotation(trace(),target);assert.doesNotThrow(()=>annotationCheck(moved));for(const vertex of moved.vertices)assert.ok(vertex.x>=0&&vertex.x<=1&&vertex.y>=0&&vertex.y<=1);}
 for(const target of [{x:NaN,y:.2},{x:.2,y:Infinity},{x:'0.2',y:.2}])assert.throws(()=>translateAnnotation(trace(),target),/Posição inválida/);
});
test('ponto, linha e leque legados conservam formato, quantidades e comportamento',()=>{
 for(const kind of ['ponto','linha','leque']){const original={id:kind,kind,x:.2,y:.3,...(kind==='ponto'?{}:{x2:.4,y2:.6}),region:'Região registrada',product:'Produto',quantity:.1,unit:'mL',lot:'Lote',notes:'Original'},before=structuredClone(original);assert.equal(annotationCheck(original),original);const moved=translateAnnotation(original,{x:.3,y:.4});close(moved.x,.3);close(moved.y,.4);if(kind!=='ponto'){close(moved.x2,.5);close(moved.y2,.7);}assert.equal(Object.hasOwn(moved,'vertices'),false);assert.deepEqual(original,before);assert.equal(moved.quantity,.1);}
});
