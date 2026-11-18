// Tamanho dos pontos de marcação e exportação da foto sem marcações.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {annotationCheck,fanRays} from '../domain.mjs';

let canvasLibrary;
try{canvasLibrary=createRequire(import.meta.url)('@napi-rs/canvas');}
catch{canvasLibrary=createRequire(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json'))('@napi-rs/canvas');}
const {createCanvas}=canvasLibrary;
const source=await fs.readFile(new URL('../app.mjs',import.meta.url),'utf8');
const css=await fs.readFile(new URL('../map-controls.css',import.meta.url),'utf8');
const slice=(from,to)=>{const start=source.indexOf(from),end=source.indexOf(to,start);assert(start>=0&&end>start,'Trecho de produção não encontrado: '+from);return source.slice(start,end);};
const sizeSource=slice('const MARKER_SIZES=','function drawMap(');
const exportSource=slice('function drawExportAnnotations(','function download(');
const BACKGROUND=[252,251,250,255];

function sizeContext(stored,{failing=false}={}){
 const values=new Map(stored===undefined?[]:[['amj-map-marker-size',stored]]),stage={dataset:{}},select={value:'grande'};
 const localStorage=failing?{getItem(){throw Error('bloqueado');},setItem(){throw Error('bloqueado');}}:{getItem:key=>values.has(key)?values.get(key):null,setItem:(key,value)=>values.set(key,String(value))};
 const context=vm.createContext({localStorage,$:id=>id==='photo-stage'?stage:id==='map-marker-size'?select:null});
 vm.runInContext(sizeSource+';globalThis.api={MARKER_SIZES,markerSize,setMarkerSize,applyMarkerSize};',context);
 return{...context.api,values,stage,select};
}
function draw(size,points,width=1000,height=1000){
 const canvas=createCanvas(width,height),ctx=canvas.getContext('2d');ctx.fillStyle='#fcfbfa';ctx.fillRect(0,0,width,height);
 const context=vm.createContext({annotationCheck,fanRays,localStorage:{getItem:()=>size,setItem(){}},$:()=>null});
 vm.runInContext(sizeSource+exportSource,context);context.drawExportAnnotations(ctx,points,width,height);
 return(x,y)=>Array.from(ctx.getImageData(x,y,1,1).data);
}

test('o tamanho padrão é o atual e valores desconhecidos não mudam a tela',()=>{
 assert.equal(sizeContext().markerSize(),'grande');
 assert.equal(sizeContext('gigante').markerSize(),'grande');
 assert.equal(sizeContext('__proto__').markerSize(),'grande');
 assert.equal(sizeContext('pequeno').markerSize(),'pequeno');
 assert.deepEqual(Object.keys(sizeContext().MARKER_SIZES),['grande','medio','pequeno']);
});

test('escolher um tamanho guarda a preferência e aplica na foto e no seletor',()=>{
 const app=sizeContext();
 app.setMarkerSize('pequeno');
 assert.equal(app.values.get('amj-map-marker-size'),'pequeno');assert.equal(app.stage.dataset.markerSize,'pequeno');assert.equal(app.select.value,'pequeno');
 app.setMarkerSize('invalido');
 assert.equal(app.values.get('amj-map-marker-size'),'pequeno','Valor inválido não substitui a preferência');assert.equal(app.stage.dataset.markerSize,'pequeno');
});

test('sem armazenamento no navegador o tamanho ainda vale para a tela aberta',()=>{
 const app=sizeContext(undefined,{failing:true});
 assert.equal(app.markerSize(),'grande');
 assert.doesNotThrow(()=>app.setMarkerSize('medio'));assert.equal(app.stage.dataset.markerSize,'medio');
});

test('a imagem exportada desenha pontos menores sem mover a marcação',()=>{
 const points=[{id:'p',kind:'ponto',x:.5,y:.5,region:'Ponto'}];
 const grande=draw('grande',points),medio=draw('medio',points),pequeno=draw('pequeno',points);
 // Raio de 11 px no tamanho grande, cerca de 8 px no médio e 5,5 px no pequeno (foto de 1000 px).
 assert.notDeepEqual(grande(509,500),BACKGROUND);assert.deepEqual(medio(510,500),BACKGROUND);assert.notDeepEqual(medio(506,500),BACKGROUND);
 assert.deepEqual(pequeno(508,500),BACKGROUND);assert.notDeepEqual(pequeno(504,490+10),BACKGROUND);
 for(const pixel of [grande,medio,pequeno])assert.notDeepEqual(pixel(500,494+3),BACKGROUND,'O centro continua no mesmo lugar');
});

test('linhas e traços mantêm a espessura em qualquer tamanho de ponto',()=>{
 const points=[{id:'l',kind:'linha',x:.2,y:.5,x2:.8,y2:.5,region:'Linha'}];
 assert.deepEqual(draw('pequeno',points)(500,500),draw('grande',points)(500,500));
 assert.notDeepEqual(draw('pequeno',points)(500,500),BACKGROUND);
});

test('exportar sem marcações salva somente a fotografia, sem pontos nem legenda',async()=>{
 const drawn=[],texts=[],downloads=[],toasts=[],output={width:0,height:0,getContext:()=>({drawImage:(...args)=>drawn.push(args),fillText:(...args)=>texts.push(args)}),toBlob(callback,type,quality){callback({type,quality});}};
 const image={complete:true,naturalWidth:1013,naturalHeight:1800};
 const context=vm.createContext({annotationCheck,fanRays,photo:()=>({label:'Frontal'}),$:()=>image,document:{createElement:()=>output},download:(blob,name)=>downloads.push({blob,name}),toast:message=>toasts.push(message)});
 vm.runInContext(exportSource,context);await context.exportCleanPhoto();
 assert.equal(output.width,1013);assert.equal(output.height,1800,'Sem rodapé de legenda');
 assert.equal(drawn.length,1);assert.equal(drawn[0][0],image);assert.equal(texts.length,0);
 assert.equal(downloads.length,1);assert.equal(downloads[0].name,'foto-sem-marcacoes-ana-maria-jacob.jpg');assert.equal(downloads[0].blob.type,'image/jpeg');
 assert.deepEqual(toasts,['Foto exportada sem as marcações.']);
});

test('exportar sem marcações espera a fotografia carregar',async()=>{
 const context=vm.createContext({annotationCheck,fanRays,photo:()=>({label:'Frontal'}),$:()=>({complete:false,naturalWidth:0,naturalHeight:0}),document:{createElement(){throw Error('não deve criar a imagem');}},download(){throw Error('não deve baixar');},toast(){}});
 vm.runInContext(exportSource,context);await assert.rejects(context.exportCleanPhoto(),/Aguarde a fotografia/);
});

test('a tela oferece o seletor de tamanho e as duas exportações',()=>{
 assert.match(source,/<select id="map-marker-size">/);assert.match(source,/Tamanho dos pontos/);
 assert.match(source,/data-action="export-map">Exportar com marcações</);assert.match(source,/data-action="export-photo-clean">Exportar sem marcações</);
 assert.match(source,/action==='export-photo-clean'\)await exportCleanPhoto\(\)/);
 assert.match(source,/e\.target\.id==='map-marker-size'\)\{setMarkerSize\(e\.target\.value\);return;\}/);
});

test('os pontos menores encolhem só o círculo; a área de toque continua com 44 px',()=>{
 for(const [size,diameter,selected] of [['medio',16,18],['pequeno',11,13]]){
  assert.ok(css.includes(`.photo-stage[data-marker-size="${size}"] .map-marker::before{width:${diameter}px;height:${diameter}px}`));
  assert.ok(css.includes(`.photo-stage[data-marker-size="${size}"] .map-marker.selected::before{width:${selected}px;height:${selected}px}`));
 }
 assert.ok(css.includes('.map-layout .map-marker{width:44px;height:44px;min-width:44px;min-height:44px'));
 assert.doesNotMatch(css,/data-marker-size="[a-z]+"\] \.map-marker\{[^}]*(?:width|height):/);
});
