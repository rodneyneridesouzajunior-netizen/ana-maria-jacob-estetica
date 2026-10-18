import {prepareWorkspaceChange,applyPreparedWorkspaceChange} from '../action-confirmation.mjs';
// Actual app router + DOM controllers; persistence and photo I/O are isolated.
import fs from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {webcrypto} from 'node:crypto';
import * as domain from '../domain.mjs';
import {areas} from '../areas.mjs';
import {assertVisitEditable,ensureOperations} from '../operations-domain.mjs';
import {renderPatientRecordOverview} from '../patient-record-ui.mjs';
import {renderVisitRecord,mountVisitRecord} from '../visit-record-ui.mjs';
import {renderComparisonLibrary,mountComparisonLibrary} from '../comparison-library.mjs';
import {renderVisitOperations,mountOperations} from '../operations-ui.mjs';
import {renderDocumentsPage,mountDocuments} from '../documents-ui.mjs';
import {ensureDocuments,documentsSatisfied} from '../documents-domain.mjs';
import {openPatientEditor} from '../patients-ui.mjs';
import {professionalOptions} from '../clinic-ui.mjs';
import {visitWorkflow,createVisit} from '../visit-workflow.mjs';
import {fittedPhotoSize,MAP_ZOOM_LEVELS} from '../map-fit.mjs';

const require=createRequire(new URL('../../../../../skinpro-analise/test-tools/package.json',import.meta.url));
const {JSDOM}=require('jsdom');
const source=(await fs.readFile(new URL('../app.mjs',import.meta.url),'utf8')).replace(/^import .*$/gm,'').replace(/^try\{await setHash\(\);\}catch.*$/gm,'');
const html=await fs.readFile(new URL('../connected.html',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 const s=domain.seed();ensureOperations(s);ensureDocuments(s);s.comparisons=[];
 s.patients[0].name='Paciente Alfa';s.patients[1].name='Paciente Beta';s.visits[0].service='Avaliação Alfa';s.visits[0].notes='Evolução original Alfa';s.visits[0].photos[0].label='Frontal Alfa';
 s.visits[0].photos.push({id:'alpha-profile',src:'assets/face-demonstrativa.png',label:'Perfil Alfa',phase:'depois',width:1122,height:1402});
 s.visits[0].maps={'demo-foto':{version:1,points:[{id:'a-point',kind:'ponto',x:.4,y:.3,region:'Região Alfa',product:'Produto Alfa',quantity:.2,unit:'mL',lot:'Lote Alfa',notes:''}],history:[]},'alpha-profile':{version:1,points:[{id:'a-profile-point',kind:'linha',x:.2,y:.4,x2:.6,y2:.4,region:'Perfil com linha Alfa',product:'Produto Alfa',quantity:.1,unit:'mL',lot:'Lote Alfa',notes:''}],history:[]}};
 s.visits.push({id:'beta-visit',patientId:'demo-beatriz',date:domain.dateKey(),service:'Segredo Beta',notes:'Notas privadas Beta',status:'rascunho',photos:[{id:'beta-photo',src:'assets/beta-secret.png',label:'Foto privada Beta',phase:'antes'}],maps:{'beta-photo':{version:1,points:[{id:'b-point',kind:'ponto',x:.5,y:.5,region:'Ponto privado Beta',quantity:77,unit:'U'}],history:[]}}});
 return s;
}
function harness(t,{hash='#paciente/demo-marina',initial}={}){
 const dom=new JSDOM(html,{url:'https://example.invalid/app/'+hash}),w=dom.window,oldGlobals={};let workspace=initial||fixture(),confirmAnswer=false,loads=0,writes=0,prints=0;const photoReads=[],libraryMounts=[];
 for(const key of ['document','window','FormData','AbortController','confirm','Image'])oldGlobals[key]=globalThis[key];
 Object.assign(globalThis,{document:w.document,window:w,FormData:w.FormData,AbortController:w.AbortController,confirm:()=>confirmAnswer,Image:class{constructor(){this.naturalWidth=1122;this.naturalHeight=1402;}set src(value){this._src=value;queueMicrotask(()=>this.onload?.());}get src(){return this._src;}}});
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 w.print=()=>{prints++;};
 const context=vm.createContext({renderRecycleTools:()=>'',renderRecycleBin:()=>'',mountRecycleUI:()=>()=>{},prepareWorkspaceChange,applyPreparedWorkspaceChange,requestActionCode:async()=>{},...domain,areas,assertVisitEditable,structuredClone,crypto:webcrypto,console,document:w.document,window:w,location:w.location,history:w.history,FormData:w.FormData,URL:w.URL,confirm:()=>confirmAnswer,setTimeout:()=>0,clearTimeout(){},isConnected:()=>false,
  renderPatientRecordOverview,renderVisitRecord,mountVisitRecord,renderComparisonLibrary,mountComparisonLibrary:(root,options)=>{libraryMounts.push({root,patientId:options.patientId});return mountComparisonLibrary(root,options);},renderVisitOperations,mountOperations,renderDocumentsPage,mountDocuments,documentsSatisfied,openPatientEditor,professionalOptions,visitWorkflow,createVisit,fittedPhotoSize,MAP_ZOOM_LEVELS,renderIntegrationPage:()=>'',
  load:async()=>{loads++;return structuredClone(workspace);},getPhoto:async id=>{photoReads.push(id);return null;},commit:async(revision,update)=>{assert.equal(revision,workspace.revision);const next=structuredClone(workspace);update(next);next.revision++;workspace=next;writes++;return structuredClone(next);}
 });
 vm.runInContext(source,context);const run=code=>vm.runInContext(code,context);
 t.after(()=>{run('comparisonHandle?.dispose();visitRecordDispose?.();patientEditor?.dispose();');for(const [key,value]of Object.entries(oldGlobals)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}w.close();});
 const event=(element,type)=>element.dispatchEvent(new w.Event(type,{bubbles:true,cancelable:true}));
 return{w,document:w.document,run,event,photoReads,libraryMounts,confirm(value){confirmAnswer=value;},async open(nextHash){if(nextHash)w.history.replaceState(null,'',nextHash);await run('setHash()');await tick();},get workspace(){return workspace;},get loads(){return loads;},get writes(){return writes;},get prints(){return prints;}};
}

test('overview monta biblioteca real e disponibiliza apenas fotografias e contadores da paciente',async t=>{
 const h=harness(t);await h.open();assert.equal(h.libraryMounts.length,1);assert.equal(h.libraryMounts[0].patientId,'demo-marina');assert.equal(h.libraryMounts[0].root.id,'comparison-panel');assert.deepEqual([...h.document.querySelectorAll('.pr-stat strong')].map(e=>e.textContent),['1','1']);
 h.document.querySelector('[data-library="new"]').click();const photos=[...h.document.querySelectorAll('[data-library-photo="before"]')].map(e=>JSON.parse(e.value)[1]);assert.deepEqual(photos.sort(),['alpha-profile','demo-foto']);assert.ok(!h.document.getElementById('content').textContent.includes('Beta'));assert.equal(h.writes,0);
});
test('biblioteca embutida mantém rascunho quando navegação não é autorizada',async t=>{
 const h=harness(t);await h.open();h.document.querySelector('[data-library="new"]').click();const title=h.document.querySelector('[name=title]');title.value='Comparação ainda em edição';h.event(title,'input');const loads=h.loads;
 const href='#paciente/demo-marina/demo-consulta/registro';h.document.querySelector('a[href="'+href+'"]').click();assert.equal(h.w.location.hash,'#paciente/demo-marina');assert.equal(h.document.querySelector('[name=title]').value,'Comparação ainda em edição');assert.equal(h.run('comparisonHandle.isDirty()'),true);assert.equal(h.loads,loads);
 h.w.history.replaceState(null,'',href);await h.run('setHash()');assert.equal(h.w.location.hash,'#paciente/demo-marina');assert.equal(h.document.querySelector('[name=title]').value,'Comparação ainda em edição');assert.equal(h.writes,0);
 h.confirm(true);await h.open(href);assert.ok(h.document.getElementById('record-form'));assert.equal(h.run('comparisonHandle'),null);assert.equal(h.workspace.comparisons.length,0);
});
test('resumo do atendimento abre com fotos reais isoladas e seletor troca foto e legenda juntos',async t=>{
 const h=harness(t,{hash:'#paciente/demo-marina/demo-consulta'});await h.open();assert.ok(h.document.querySelector('[data-vr-record]'));assert.equal(h.run('tab'),'resumo');assert.deepEqual(h.photoReads,['demo-foto','alpha-profile']);
 const images=[...h.document.querySelectorAll('[data-photo-src]')];assert.deepEqual(images.map(e=>e.dataset.photoSrc),['demo-foto','alpha-profile']);assert.ok(images.every(e=>e.src.endsWith('/app/assets/face-demonstrativa.png')));
 const selector=h.document.querySelector('[data-vr-photo-select]');selector.value='1';h.event(selector,'change');assert.equal(h.document.querySelector('[data-vr-photo-count]').textContent,'2 de 2');assert.equal(h.document.querySelector('[data-vr-photo-panel="0"]').hidden,true);assert.equal(h.document.querySelector('[data-vr-photo-panel="1"]').hidden,false);assert.equal(h.document.querySelector('[data-vr-legend-panel="1"]').hidden,false);assert.match(h.document.querySelector('[data-vr-legend-panel="1"]').textContent,/Perfil com linha Alfa/);assert.ok(!h.document.getElementById('content').textContent.includes('Beta'));assert.equal(h.writes,0);
});
test('rotas de edição, documentos, fotos e mapa seguem acessíveis a partir do resumo',async t=>{
 const h=harness(t,{hash:'#paciente/demo-marina/demo-consulta/resumo'});await h.open();
 for(const tab of ['registro','documentos','fotos','mapa'])assert.ok(h.document.querySelector('a[href="#paciente/demo-marina/demo-consulta/'+tab+'"]'),tab);
 await h.open('#paciente/demo-marina/demo-consulta/documentos');assert.ok(h.document.querySelector('[data-doc="prepare"]'));assert.ok(h.document.querySelector('.visit-workspace-tabs a[href$="/resumo"]'));
 await h.open('#paciente/demo-marina/demo-consulta/mapa');assert.ok(h.document.getElementById('point-form'));assert.ok(h.document.querySelector('[data-action="new-map-point"]'));assert.match(h.document.getElementById('point-list').textContent,/Região Alfa/);assert.ok(!h.document.getElementById('point-list').textContent.includes('Beta'));assert.equal(h.writes,0);
});
test('texto não salvo permanece ao negar clique de aba e hash externo; descarte é explícito',async t=>{
 const h=harness(t,{hash:'#paciente/demo-marina/demo-consulta/registro'});await h.open();const notes=h.document.getElementById('visit-notes');notes.value='Evolução ainda não salva';h.event(notes,'input');const snapshot=structuredClone(h.workspace),loads=h.loads;
 h.document.querySelector('.visit-workspace-tabs a[href$="/mapa"]').click();assert.equal(h.w.location.hash,'#paciente/demo-marina/demo-consulta/registro');assert.equal(h.document.getElementById('visit-notes').value,'Evolução ainda não salva');assert.equal(h.loads,loads);
 h.w.history.replaceState(null,'','#paciente/demo-marina/demo-consulta/resumo');await h.run('setHash()');assert.equal(h.w.location.hash,'#paciente/demo-marina/demo-consulta/registro');assert.equal(h.document.getElementById('visit-notes').value,'Evolução ainda não salva');assert.equal(h.run('dirty'),true);assert.deepEqual(h.workspace,snapshot);
 h.confirm(true);await h.open('#paciente/demo-marina/demo-consulta/resumo');assert.ok(h.document.querySelector('[data-vr-record]'));assert.match(h.document.querySelector('.vr-notes').textContent,/Evolução original Alfa/);assert.equal(h.run('dirty'),false);assert.equal(h.writes,0);
});
test('marcação em edição impede trocar aba e preserva os campos até autorização',async t=>{
 const h=harness(t,{hash:'#paciente/demo-marina/demo-consulta/mapa'});await h.open();h.run("selectPoint('a-point')");const field=h.document.getElementById('point-region');field.value='Região em edição';h.event(field,'input');
 h.document.querySelector('.visit-workspace-tabs a[href$="/documentos"]').click();assert.equal(h.w.location.hash,'#paciente/demo-marina/demo-consulta/mapa');assert.equal(h.document.getElementById('point-region').value,'Região em edição');assert.equal(h.workspace.visits[0].maps['demo-foto'].points[0].region,'Região Alfa');assert.equal(h.writes,0);
});
test('URL com consulta de outra paciente não carrega nenhuma foto nem expõe números e notas',async t=>{
 const h=harness(t,{hash:'#paciente/demo-marina/beta-visit/resumo'});await h.open();assert.match(h.document.getElementById('content').textContent,/Atendimento não encontrado/);assert.equal(h.photoReads.length,0);assert.ok(!h.document.getElementById('content').textContent.includes('Beta'));assert.equal(h.document.querySelector('[data-vr-record]'),null);assert.equal(h.document.querySelector('[data-marker]'),null);
});
test('botão Editar paciente abre editor existente e impressão chama a ação real sem gravar',async t=>{
 const h=harness(t);await h.open();h.document.querySelector('[data-action="edit-patient"]').click();assert.ok(h.document.querySelector('.patients-editor-section'));assert.equal(h.document.querySelector('dialog [name="name"]').value,'Paciente Alfa');h.run('patientEditor.dispose();patientEditor=null;');
 await h.open('#paciente/demo-marina/demo-consulta/resumo');h.document.querySelector('[data-action="print-visit"]').click();assert.equal(h.prints,1);assert.equal(h.writes,0);
});
test('links percent-encoded de identificadores legados continuam resolvendo a paciente e a consulta',async t=>{
 const s=fixture();s.patients[0].id='patient:legacy';s.visits[0].patientId='patient:legacy';s.visits[0].id='visit:legacy';const h=harness(t,{hash:'#paciente/patient%3Alegacy/visit%3Alegacy/resumo',initial:s});await h.open();assert.equal(h.run('patientId'),'patient:legacy');assert.equal(h.run('visitId'),'visit:legacy');assert.ok(h.document.querySelector('[data-vr-record]'));assert.equal(h.document.querySelector('[data-vr-record]').dataset.vrVisit,'visit:legacy');
});

test('foto indisponível não paralisa outras fotos nem o seletor; mapa abre na foto selecionada no resumo',async t=>{
 const s=fixture();delete s.visits[0].photos[0].src;const before=structuredClone(s),h=harness(t,{hash:'#paciente/demo-marina/demo-consulta/resumo',initial:s});await h.open();
 const first=h.document.querySelector('[data-photo-src="demo-foto"]'),second=h.document.querySelector('[data-photo-src="alpha-profile"]');assert.equal(first.hasAttribute('src'),false);assert.match(first.alt,/fotografia indisponível/);assert.ok(second.src.endsWith('/app/assets/face-demonstrativa.png'));assert.deepEqual(h.photoReads,['demo-foto','alpha-profile']);
 const selector=h.document.querySelector('[data-vr-photo-select]');selector.value='1';h.event(selector,'change');assert.equal(h.run('photoId'),'alpha-profile');assert.equal(h.document.querySelector('[data-vr-photo-panel="1"]').hidden,false);assert.equal(h.document.querySelector('[data-vr-legend-panel="1"]').hidden,false);assert.equal(h.document.querySelector('[data-vr-photo-count]').textContent,'2 de 2');
 await h.open('#paciente/demo-marina/demo-consulta/mapa');assert.equal(h.document.getElementById('photo-select').value,'alpha-profile');assert.match(h.document.getElementById('point-list').textContent,/Perfil com linha Alfa/);assert.deepEqual(h.workspace,before);assert.equal(h.writes,0);
});
