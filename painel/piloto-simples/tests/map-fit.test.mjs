import test from 'node:test';
import assert from 'node:assert/strict';
import {fittedPhotoSize,MAP_ZOOM_LEVELS} from '../map-fit.mjs';
import {normalizedPoint} from '../domain.mjs';

test('100% ajusta retrato inteiro pela altura do estágio sem cortar o rosto',()=>{
  const fit=fittedPhotoSize(900,570,1122,1402);
  assert.ok(Math.abs(fit.height-570)<1e-9);assert.ok(fit.width<900);
  assert.ok(Math.abs(fit.width/fit.height-1122/1402)<1e-12);
});
test('paisagem cabe pela largura; zoom amplia a mesma imagem e mantém coordenadas',()=>{
  const fit=fittedPhotoSize(900,570,1800,1000),zoom=fittedPhotoSize(900,570,1800,1000,2);
  assert.deepEqual(fit,{width:900,height:500,zoom:1});assert.deepEqual(zoom,{width:1800,height:1000,zoom:2});
  const normal=normalizedPoint(450,250,{left:0,top:0,width:fit.width,height:fit.height});
  const enlarged=normalizedPoint(900,500,{left:0,top:0,width:zoom.width,height:zoom.height});
  assert.deepEqual(normal,enlarged);
});
test('resize preserva proporção e coordenadas normalizadas sem impor dimensões de imagem ausente',()=>{
  const small=fittedPhotoSize(320,430,1122,1402);assert.ok(small.width<=320&&small.height<=430);
  assert.equal(fittedPhotoSize(0,570,1122,1402),null);assert.equal(fittedPhotoSize(900,570,0,0),null);
  assert.equal(fittedPhotoSize(900,570,1122,1402,Infinity),null);
  assert.equal(fittedPhotoSize(900,570,1122,1402,20).zoom,10);
  assert.equal(fittedPhotoSize(900,570,1122,1402,-2).zoom,1);
});
test('1×, 3×, 6× e 10× preservam geometria em retrato, paisagem e celular',()=>{
 assert.deepEqual(MAP_ZOOM_LEVELS,[1,3,6,10]);
 for(const [sw,sh,iw,ih]of [[900,570,1122,1402],[900,570,1800,1000],[320,430,1122,1402]]){
  const base=fittedPhotoSize(sw,sh,iw,ih);
  for(const scale of MAP_ZOOM_LEVELS){const fit=fittedPhotoSize(sw,sh,iw,ih,scale);
   assert.equal(fit.zoom,scale);assert.ok(Math.abs(fit.width/base.width-scale)<1e-10);
   const point=normalizedPoint(45+fit.width*.371,70+fit.height*.629,{left:45,top:70,width:fit.width,height:fit.height});
   assert.ok(Math.abs(point.x-.371)<1e-12);assert.ok(Math.abs(point.y-.629)<1e-12);
  }
 }
});
