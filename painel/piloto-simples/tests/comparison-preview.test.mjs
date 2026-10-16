import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mountSavedComparisonPreview} from '../comparison-preview.mjs';
import {mountComparisonLibrary,saveComparisonRecord,comparisonRecordDraft} from '../comparison-library.mjs';
const require=createRequire(new URL('../../../../../skinpro-analise/test-tools/package.json',import.meta.url));
const {JSDOM}=require('jsdom');
const deferred=()=>{let resolve,reject;const promise=new Promise((ok,fail)=>{resolve=ok;reject=fail;});return{promise,resolve,reject};};
function harness(t){const dom=new JSDOM('<body><div id="preview"></div></body>',{url:'https://example.invalid/app/'}),root=dom.window.document.getElementById('preview');t.after(()=>dom.window.close());return{w:dom.window,root,event:(el,type)=>el.dispatchEvent(new dom.window.Event(type,{bubbles:true}))};}
const photo=(id)=>Object.freeze({key:JSON.stringify(['visit',id]),patientId:'patient',visitId:'visit',date:'2026-10-15',photo:Object.freeze({id,label:id})});

test('prévia de Antes sem Depois usa uma foto e mantém comparação indisponível',async t=>{
 const h=harness(t),before=photo('before'),reads=[],handle=mountSavedComparisonPreview(h.root,{before,readPhoto:async(item,original)=>{reads.push([item,original]);return '/before.png';}});t.after(()=>handle.dispose());await handle.ready;
 assert.deepEqual(reads,[[before,false]]);assert.equal(h.root.querySelector('.saved-comparison-before img').getAttribute('src'),'/before.png');assert.equal(h.root.querySelector('.saved-comparison-after').hidden,true);assert.equal(h.root.querySelector('button').hidden,true);assert.equal(h.root.querySelector('label').hidden,true);assert.match(h.root.querySelector('[role=status]').textContent,/Depois pendente/);
});
test('divisor e lado a lado alternam apenas apresentação preservando seleção e objetos originais',async t=>{
 const h=harness(t),before=photo('before'),after=photo('after'),snapshot=structuredClone({before,after}),reads=[],handle=mountSavedComparisonPreview(h.root,{before,after,readPhoto:async(item,original)=>{reads.push([item.photo.id,original]);return '/'+item.photo.id+'.png';}});t.after(()=>handle.dispose());await handle.ready;
 const stage=h.root.querySelector('.saved-comparison-stage'),range=h.root.querySelector('input'),toggle=h.root.querySelector('button'),divider=h.root.querySelector('.saved-comparison-divider');assert.equal(stage.dataset.savedMode,'slide');assert.equal(range.parentElement.hidden,false);assert.equal(divider.hidden,false);
 range.value='73';h.event(range,'input');assert.equal(stage.style.getPropertyValue('--saved-split'),'73%');toggle.click();assert.equal(stage.dataset.savedMode,'side');assert.equal(range.parentElement.hidden,true);assert.equal(divider.hidden,true);assert.equal(toggle.textContent,'Ver com divisor');toggle.click();assert.equal(stage.dataset.savedMode,'slide');assert.equal(stage.style.getPropertyValue('--saved-split'),'73%');assert.equal(range.parentElement.hidden,false);assert.deepEqual({before,after},snapshot);assert.deepEqual(reads,[['before',false],['after',false]]);
});
test('dispose antes da leitura terminar não publica fontes nem reescreve nova tela',async t=>{
 const h=harness(t),pending=deferred(),handle=mountSavedComparisonPreview(h.root,{before:photo('before'),readPhoto:()=>pending.promise}),image=h.root.querySelector('img');handle.dispose();h.root.innerHTML='<p>Outra paciente</p>';pending.resolve('/private-before.png');await handle.ready;assert.equal(h.root.innerHTML,'<p>Outra paciente</p>');assert.equal(image.hasAttribute('src'),false);
});
test('remoção do host enquanto carrega impede inserir URL após a navegação',async t=>{
 const h=harness(t),pending=deferred(),handle=mountSavedComparisonPreview(h.root,{before:photo('before'),readPhoto:()=>pending.promise}),image=h.root.querySelector('img');t.after(()=>handle.dispose());h.root.remove();pending.resolve('/private-before.png');await handle.ready;assert.equal(image.hasAttribute('src'),false);
});
test('falha de arquivo é texto seguro e não vira HTML executável',async t=>{
 const h=harness(t),message='<img src=x onerror=alert(1)>',handle=mountSavedComparisonPreview(h.root,{before:photo('before'),readPhoto:async()=>{throw Error(message);}});t.after(()=>handle.dispose());await handle.ready;assert.equal(h.root.querySelector('[role=status]').textContent,message);assert.equal(h.root.querySelectorAll('[onerror]').length,0);assert.equal(h.root.querySelector('button').hidden,true);
});
test('erro de decodificação da imagem exibe falha e listeners são removidos no dispose',async t=>{
 const h=harness(t),handle=mountSavedComparisonPreview(h.root,{before:photo('before'),after:photo('after'),readPhoto:async p=>'/'+p.photo.id+'.png'});await handle.ready;const image=h.root.querySelector('img'),range=h.root.querySelector('input'),toggle=h.root.querySelector('button'),stage=h.root.querySelector('.saved-comparison-stage');h.event(image,'error');assert.match(h.root.querySelector('[role=status]').textContent,/Não foi possível carregar/);const split=stage.style.getPropertyValue('--saved-split');handle.dispose();range.value='90';h.event(range,'input');toggle.click();assert.equal(stage.dataset.savedMode,'slide');assert.equal(stage.style.getPropertyValue('--saved-split'),split);assert.ok([...h.root.querySelectorAll('img')].every(i=>!i.hasAttribute('src')));
});
test('rejeição tardia após dispose não modifica a página nem causa rejeição não tratada',async t=>{
 const h=harness(t),pending=deferred(),handle=mountSavedComparisonPreview(h.root,{before:photo('before'),readPhoto:()=>pending.promise});handle.dispose();h.root.innerHTML='<p>Tela atual</p>';pending.reject(Error('Leitura tardia falhou'));await handle.ready;assert.equal(h.root.textContent,'Tela atual');
});
test('biblioteca monta prévias somente da paciente selecionada e dispose cancela atualização tardia',async t=>{
 const h=harness(t),key=(v,p)=>JSON.stringify([v,p]),state={patients:[{id:'patient'},{id:'other'}],comparisons:[],visits:[{id:'visit',patientId:'patient',date:'2026-10-15',service:'Consulta Alfa',photos:[{id:'before',label:'Antes Alfa'},{id:'after',label:'Depois Alfa'}]},{id:'other-visit',patientId:'other',date:'2026-10-15',service:'Segredo Beta',photos:[{id:'other-photo',label:'Foto privada Beta'}]}]};
 for(const [patientId,visitId,beforeId,afterId]of [['patient','visit','before','after'],['other','other-visit','other-photo',null]]){
  saveComparisonRecord(state,{...comparisonRecordDraft(state,patientId),id:'comparison-'+patientId,title:patientId==='patient'?'Comparação Alfa':'Privado Beta',beforeDate:'2026-10-15',beforePhotos:[key(visitId,beforeId)],before:key(visitId,beforeId),afterDate:afterId?'2026-10-15':'',afterPhotos:afterId?[key(visitId,afterId)]:[],after:afterId?key(visitId,afterId):''},{operationId:'operation-'+patientId,now:'2026-10-15T15:00:00Z'});
 }
 const snapshot=structuredClone(state),reads=[],pending=deferred(),handle=mountComparisonLibrary(h.root,{getState:()=>state,patientId:'patient',readPhoto:async p=>{reads.push(p.photo.id);return pending.promise;},mutate:()=>{throw Error('A visualização não deve salvar');}});assert.deepEqual(reads,['before','after']);assert.equal(h.root.querySelectorAll('[data-saved-comparison]').length,1);assert.ok(!h.root.textContent.includes('Beta'));assert.equal(handle.isDirty(),false);const images=[...h.root.querySelectorAll('.saved-comparison img')];handle.dispose();h.root.innerHTML='<p>Outra área</p>';pending.resolve('/photo.png');await new Promise(resolve=>setImmediate(resolve));assert.equal(h.root.textContent,'Outra área');assert.ok(images.every(i=>!i.hasAttribute('src')));assert.deepEqual(state,snapshot);
});
