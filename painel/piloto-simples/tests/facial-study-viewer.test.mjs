import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../rosto3d/v2/vendor/three.module.js';
import {annotations} from '../../rosto3d/v2/annotations.mjs';

// Exercise the real editor with real Three geometry, a small deterministic DOM fixture,
// and an injected local persistence bridge. No WebGL/browser result is claimed here.
function setup(save=async(_source,document,version)=>({document,version:version+1})){
  const previous={document:globalThis.document,window:globalThis.window,confirm:globalThis.confirm};
  const ids=new Map(),buttons=['rotate','mark','move'].map(tool=>({dataset:{tool},setAttribute(){}})),events=[];
  let focused=0;
  const element=()=>({dataset:{},value:'',children:[],setAttribute(){},append(v){this.children.push(v);},prepend(v){this.children.unshift(v);},replaceChildren(...v){this.children=v;},get options(){return this.children;},focus(){focused++;},remove(){},getContext(){return {beginPath(){},arc(){},fill(){},fillText(){}};}});
  const section=element();section.querySelector=q=>{if(!ids.has(q))ids.set(q,element());return ids.get(q);};section.querySelectorAll=()=>buttons;
  globalThis.document={querySelector:()=>({prepend(){}}),createElement:tag=>tag==='section'?section:element()};globalThis.window={matchMedia:()=>({matches:true})};globalThis.confirm=()=>true;
  const geometry=new THREE.PlaneGeometry(2,2),material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide}),mesh=new THREE.Mesh(geometry,material),scene=new THREE.Scene();mesh.name='skin';mesh.userData={positions:Array.from(geometry.attributes.position.array),indices:Array.from(geometry.index.array),layer:'skin',mode:'appearance'};scene.add(mesh);scene.updateMatrixWorld();
  const api=annotations({THREE,scene,models:[mesh],registry:{skin:{mode:'appearance',triangles:2}},getMode:()=>'appearance',render:()=>scene.updateMatrixWorld(),host:()=>({saveStudy:save,editorState:(_source,data)=>events.push(data)}),local:true});
  return {api,events,field:id=>section.querySelector('#'+id),tool:name=>buttons.find(b=>b.dataset.tool===name),tap:()=>api.tap(new THREE.Raycaster(new THREE.Vector3(.3,.2,2),new THREE.Vector3(0,0,-1))),focused:()=>focused,dispose(){api.dispose();geometry.dispose();material.dispose();Object.assign(globalThis,previous);}};
}
test('local editor starts locked until context, then marks without forcing the mobile keyboard',()=>{
  const h=setup();try{assert.equal(h.tool('mark').disabled,true);assert.equal(h.field('study-notes').disabled,true);assert.equal(h.field('study-save').textContent,'Salvar neste navegador');h.api.loadStudy(null,'Paciente / consulta local');assert.equal(h.tool('mark').disabled,false);h.tool('mark').onclick();h.tap();assert.equal(h.api.getStudy().points.length,1);assert.equal(h.focused(),0);assert.equal(h.api.hasChanges(),true);assert.match(h.field('point-status').textContent,/ainda não salvas/);assert.equal(h.field('study-save').textContent,'Salvar neste navegador');h.api.unbind();assert.equal(h.field('study-notes').disabled,true);}finally{h.dispose();}
});
test('local saving reports actual version without password wording and releases busy state',async()=>{
  const h=setup();try{h.api.loadStudy(null,'Consulta');h.tool('mark').onclick();h.tap();await h.field('study-save').onclick();assert.equal(h.api.hasChanges(),false);assert.equal(h.api.isBusy(),false);assert.match(h.field('point-status').textContent,/Salvo neste navegador · versão 1/);assert.equal(h.events.at(-1).busy,false);assert.equal(h.events.at(-1).dirty,false);}finally{h.dispose();}
});
test('read-only context allows reading selected points but disables marking, changes and saving',()=>{
  const h=setup();try{h.api.loadStudy(null,'Consulta');h.tool('mark').onclick();h.tap();const record={document:h.api.getStudy(),version:1};h.api.loadStudy(record,'Consulta concluída',{readOnly:true});assert.equal(h.tool('mark').disabled,true);assert.equal(h.tool('move').disabled,true);assert.equal(h.tool('rotate').disabled,false);assert.equal(h.field('study-save').disabled,true);assert.equal(h.field('study-notes').disabled,true);assert.deepEqual(h.api.getStudy(),record.document);assert.equal(h.api.hasChanges(),false);}finally{h.dispose();}
});
test('failed local save preserves the complete editable draft',async()=>{
  const h=setup(async()=>{throw Error('Conflito de versão');});try{h.api.loadStudy(null,'Consulta');h.tool('mark').onclick();h.tap();const before=h.api.getStudy();await h.field('study-save').onclick();assert.deepEqual(h.api.getStudy(),before);assert.equal(h.api.hasChanges(),true);assert.equal(h.api.isBusy(),false);assert.match(h.field('point-status').textContent,/Conflito/);}finally{h.dispose();}
});
