import test from 'node:test';
import assert from 'node:assert/strict';
import {comparisonPhotos,resolveComparison,comparisonSelection,buildComparisonImage,mountComparison} from '../compare.mjs';

function state(){return{patients:[{id:'ana'},{id:'outra'}],visits:[
  {id:'v1',patientId:'ana',date:'2026-10-01',service:'Avaliação',photos:[{id:'p1',label:'Frontal',sha256:'hash-1'},{id:'p2',label:'Perfil',sha256:'hash-2'}]},
  {id:'v2',patientId:'ana',date:'2026-10-15',service:'Retorno',photos:[{id:'p3',label:'Frontal',sha256:'hash-3'}]},
  {id:'v3',patientId:'outra',date:'2026-10-16',service:'Avaliação',photos:[{id:'p4',label:'Frontal',sha256:'hash-4'}]}
]};}
const key=(visit,photo)=>JSON.stringify([visit,photo]);

test('comparação reúne exclusivamente fotos da paciente, incluindo consultas diferentes',()=>{
  const s=state(),before=structuredClone(s),photos=comparisonPhotos(s,'ana');
  assert.deepEqual(photos.map(item=>item.photo.id),['p1','p2','p3']);
  const pair=resolveComparison(s,'ana',key('v1','p1'),key('v2','p3'));
  assert.equal(pair.before.visitId,'v1');assert.equal(pair.after.visitId,'v2');assert.deepEqual(s,before);
});
test('foto de outra paciente e seleção inexistente são rejeitadas mesmo com chave direta',()=>{
  assert.throws(()=>resolveComparison(state(),'ana',key('v1','p1'),key('v3','p4')),/desta paciente/);
  assert.throws(()=>resolveComparison(state(),'ana',key('v1','p1'),'ausente'),/desta paciente/);
  assert.throws(()=>comparisonPhotos(state(),'ausente'),/não encontrada/);
});
test('mesma foto e duplicação do mesmo original em outra consulta não viram antes/depois',()=>{
  assert.throws(()=>resolveComparison(state(),'ana',key('v1','p1'),key('v1','p1')),/diferentes/);
  const s=state();s.visits[1].photos[0].sha256='hash-1';
  assert.throws(()=>resolveComparison(s,'ana',key('v1','p1'),key('v2','p3')),/mesmo arquivo/);
});
test('ordem invertida é rejeitada; duas fotos distintas da mesma data são aceitas',()=>{
  assert.throws(()=>resolveComparison(state(),'ana',key('v2','p3'),key('v1','p1')),/posterior/);
  assert.doesNotThrow(()=>resolveComparison(state(),'ana',key('v1','p1'),key('v1','p2')));
  const s=state();s.visits[1].date='2026-02-30';
  assert.throws(()=>resolveComparison(s,'ana',key('v1','p1'),key('v2','p3')),/data válida/);
});

test('composição persistível guarda referências e preferências sem duplicar imagens ou mudar o estado',()=>{
  const s=state(),original=structuredClone(s),selection={before:key('v1','p1'),after:key('v2','p3'),mode:'slide',split:38,format:'jpeg'};
  const saved=comparisonSelection(s,'ana',selection);
  assert.deepEqual(saved,{schemaVersion:1,patientId:'ana',...selection});assert.deepEqual(s,original);
  assert.equal(Object.values(saved).some(value=>value instanceof Blob),false);
  assert.throws(()=>comparisonSelection(s,'ana',{...selection,split:101}),/divisor/);
  assert.throws(()=>comparisonSelection(s,'ana',{...selection,format:'webp'}),/Formato/);
  assert.throws(()=>comparisonSelection(s,'ana',{...selection,after:key('v3','p4')}),/desta paciente/);
});

test('PNG e JPEG saem em Full HD, com imagens inteiras e carimbo de teste',async t=>{
  const original={document:globalThis.document,Image:globalThis.Image,createImageBitmap:globalThis.createImageBitmap};
  t.after(()=>Object.assign(globalThis,original));
  const draws=[],texts=[],canvases=[],closed=[];
  globalThis.Image=class{set src(value){this.width=320;this.height=100;queueMicrotask(()=>this.onload());}};
  globalThis.createImageBitmap=async source=>({width:source instanceof Blob?1000:320,height:source instanceof Blob?1500:100,close(){closed.push(true);}});
  globalThis.document={createElement:tag=>{
    assert.equal(tag,'canvas');const canvas={width:0,height:0,getContext:()=>({fillRect(){},strokeRect(){},fillText:message=>texts.push(message),drawImage:(...args)=>draws.push(args)}),toBlob(callback,mime,quality){this.mime=mime;this.quality=quality;callback(new Blob(['encoded-fixture'],{type:mime}));}};
    canvases.push(canvas);return canvas;
  }};
  const pair=resolveComparison(state(),'ana',key('v1','p1'),key('v2','p3'));
  const bytes=new Uint8Array([7,8,9]),source=new Blob([bytes],{type:'image/jpeg'}),read=async()=>source;
  await assert.rejects(buildComparisonImage(pair,read),/fictícias/);
  for(const [format,layout] of [['png','fullhd'],['jpeg','fullhd'],['png','feed'],['jpeg','story']]){
    const result=await buildComparisonImage(pair,read,{format,layout,testImagesConfirmed:true});assert.equal(result.type,format==='jpeg'?'image/jpeg':'image/png');
  }
  assert.deepEqual(canvases.map(c=>[c.width,c.height]),[[1920,1080],[1920,1080],[1080,1350],[1080,1920]]);
  assert.equal(canvases[1].quality,.95);
  // drawImage is called with image + destination only (no source cropping).
  assert.ok(draws.every(args=>args.length===5));
  const photoDraws=draws.filter(args=>args[0].width===1000);
  assert.ok(photoDraws.every(args=>Math.abs(args[3]/args[4]-2/3)<1e-9));
  assert.ok(texts.includes('PILOTO — DADOS FICTÍCIOS'));assert.ok(texts.includes('TESTE · SEM RESULTADO CLÍNICO'));
  assert.ok(texts.includes('Data da consulta: 01/10/2026'));assert.equal(closed.length,12);
  assert.deepEqual(new Uint8Array(await source.arrayBuffer()),bytes);
});

function comparisonHarness(onSave){
  const elements=new Map();
  const element=selector=>{
    if(!elements.has(selector))elements.set(selector,{value:'',disabled:false,checked:false,hidden:false,textContent:'',dataset:{},listeners:{},style:{values:{},setProperty(key,value){this.values[key]=value;}},classList:{toggle(){}},setAttribute(){},append(){},addEventListener(event,fn){this.listeners[event]=fn;},showModal(){this.open=true;},close(){this.open=false;this.listeners.close?.();}});
    return elements.get(selector);
  };
  const modes=['side','slide'].map(mode=>{const item=element('mode-'+mode);item.dataset.compareMode=mode;return item;});
  const root={isConnected:true,innerHTML:'',querySelector:element,querySelectorAll:selector=>selector==='[data-compare-mode]'?modes:[]};
  const saved={before:key('v1','p1'),after:key('v2','p3'),mode:'slide',split:38,format:'jpeg'};
  const mounted=mountComparison(root,{state:state(),patientId:'ana',selection:saved,readPhoto:async()=>'/fixture.jpg',onSave});
  return {element,root,mounted,saved};
}
test('reabrir restaura formato/divisor e onSave aguarda confirmação sem anunciar falso sucesso',async t=>{
  const OriginalImage=globalThis.Image;t.after(()=>{globalThis.Image=OriginalImage;});
  globalThis.Image=class{set src(value){queueMicrotask(()=>this.onload());}};
  let resolveSave,received;
  const h=comparisonHarness(value=>new Promise(resolve=>{received=value;resolveSave=resolve;}));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.element('[data-compare-format]').value,'jpeg');assert.equal(h.element('#compare-position').value,'38');
  const pending=h.element('[data-compare-save]').listeners.click();
  assert.equal(h.element('#compare-before').disabled,true);assert.doesNotMatch(h.element('.compare-status').textContent,/Composição salva/);
  assert.deepEqual(received,{schemaVersion:1,patientId:'ana',...h.saved});
  resolveSave();await pending;assert.match(h.element('.compare-status').textContent,/Composição salva/);assert.equal(h.element('#compare-before').disabled,false);
  h.mounted.dispose();
});
test('falha de persistência mantém composição selecionada e não mostra salva',async t=>{
  const OriginalImage=globalThis.Image;t.after(()=>{globalThis.Image=OriginalImage;});
  globalThis.Image=class{set src(value){queueMicrotask(()=>this.onload());}};
  const h=comparisonHarness(async()=>{throw Error('Conflito de revisão. Reabra a consulta.');});
  await new Promise(resolve=>setImmediate(resolve));await h.element('[data-compare-save]').listeners.click();
  assert.match(h.element('.compare-status').textContent,/Conflito/);assert.doesNotMatch(h.element('.compare-status').textContent,/Composição salva/);
  assert.equal(h.element('[data-compare-format]').value,'jpeg');h.mounted.dispose();
});
