import test from 'node:test';
import assert from 'node:assert/strict';
import {comparisonPhotos,comparisonSelection} from '../compare.mjs';
import {saveComparisonRecord,deleteComparisonRecord,validateComparisonRecord,comparisonRecordDraft,renderComparisonLibrary} from '../comparison-library.mjs';
const now='2026-10-15T12:00:00.000Z',later='2026-10-16T12:00:00.000Z';
const key=(v,p)=>JSON.stringify([v,p]);
function state(){return{patients:[{id:'ana'},{id:'outra'}],comparisons:[],visits:[
 {id:'v1',patientId:'ana',date:'2026-10-01',service:'Consulta fictícia',photos:Array.from({length:11},(_,i)=>({id:'p'+i,label:'Foto '+i,sha256:(i+1).toString(16).padStart(64,'0')}))},
 {id:'v2',patientId:'ana',date:'2026-10-15',service:'Retorno fictício',photos:[{id:'after',label:'Depois',sha256:'a'.repeat(64)}]},
 {id:'v3',patientId:'outra',date:'2026-10-15',service:'Outra paciente',photos:[{id:'other',label:'Outra',sha256:'b'.repeat(64)}]}
]};}
function input(overrides={}){return{id:'cmp',patientId:'ana',title:'Avaliação visual fictícia',area:'Rosto',notes:'Sem resultado clínico',beforeDate:'2026-10-01',afterDate:'',beforePhotos:[key('v1','p0')],afterPhotos:[],before:key('v1','p0'),after:'',mode:'side',split:50,format:'png',...overrides};}
const save=(s,d=input(),options={})=>saveComparisonRecord(s,d,{operationId:'op-new',now,...options});

test('biblioteca permite salvar só Antes, sem duplicar fotos ou alterar consultas',()=>{
 const s=state(),visits=structuredClone(s.visits),record=save(s);assert.equal(record.after,'');assert.equal(record.status,'ativo');assert.equal(record.version,1);assert.deepEqual(record.history,[]);assert.deepEqual(s.visits,visits);assert.equal(s.comparisons.length,1);assert.equal(validateComparisonRecord(s,record),record);
});
test('retorno acrescenta Depois, preserva versão anterior e todas as referências',()=>{
 const s=state(),first=structuredClone(save(s));const changed=save(s,input({afterPhotos:[key('v2','after')],after:key('v2','after'),afterDate:'2026-10-15',notes:'Registro posterior'}),{expectedVersion:1,operationId:'op-edit',now:later});assert.equal(changed.version,2);assert.deepEqual(changed.history[0].snapshot,((({history,...x})=>x)(first)));assert.equal(changed.history[0].snapshot.after,'');assert.equal(s.comparisons.length,1);assert.equal(changed.savedAt,now);assert.equal(changed.updatedAt,later);
});
test('múltiplas comparações da mesma paciente continuam independentes e reabrem pelas suas IDs',()=>{
 const s=state();save(s);save(s,input({id:'cmp2',title:'Segunda comparação'}),{operationId:'op-two'});assert.equal(s.comparisons.length,2);assert.equal(comparisonRecordDraft(s,'ana',s.comparisons[0]).title,'Avaliação visual fictícia');assert.equal(comparisonRecordDraft(s,'ana',s.comparisons[1]).title,'Segunda comparação');
});
test('até 10 fotos por grupo e principal obrigatoriamente selecionada',()=>{
 const s=state(),keys=comparisonPhotos(s,'ana').filter(x=>x.visitId==='v1').map(x=>x.key);save(s,input({beforePhotos:keys.slice(0,10),before:keys[9]}));assert.equal(s.comparisons[0].beforePhotos.length,10);assert.throws(()=>save(state(),input({beforePhotos:keys})),/10 fotos/);assert.throws(()=>save(state(),input({before:keys[9]})),/principal/);assert.throws(()=>save(state(),input({beforePhotos:[]})),/1 a 10/);
});
test('referências de outra paciente, desconhecidas e mesmo arquivo conhecido são recusadas',()=>{
 assert.throws(()=>save(state(),input({after:key('v3','other'),afterPhotos:[key('v3','other')]})),/desta paciente/);assert.throws(()=>save(state(),input({beforePhotos:['inexistente']})),/desta paciente/);assert.throws(()=>save(state(),input({after:key('v1','p0'),afterPhotos:[key('v1','p0')]})),/mesma fotografia/);const s=state();s.visits[1].photos[0].sha256=s.visits[0].photos[0].sha256.toUpperCase();assert.throws(()=>save(s,input({after:key('v2','after'),afterPhotos:[key('v2','after')]})),/mesmo arquivo/);
});
test('não afirma detectar arquivo duplicado quando hash original é desconhecido',()=>{
 const s=state();delete s.visits[0].photos[0].sha256;delete s.visits[1].photos[0].sha256;assert.doesNotThrow(()=>save(s,input({after:key('v2','after'),afterPhotos:[key('v2','after')]})));
});
test('ordem das consultas vale também para fotos secundárias, datas informadas e limites do divisor',()=>{
 assert.throws(()=>save(state(),input({beforePhotos:[key('v1','p0'),key('v2','after')],afterPhotos:[key('v1','p1')],after:key('v1','p1')})),/posteriores/);for(const patch of [{beforeDate:'2026-02-30'},{afterDate:'2026-09-30'},{split:101},{split:-1},{mode:'magic'},{format:'svg'}])assert.throws(()=>save(state(),input(patch)));assert.doesNotThrow(()=>save(state(),input({after:key('v1','p1'),afterPhotos:[key('v1','p1')]})));
});
test('repetição de salvamento é idempotente, inclusive depois de nova versão, e chave alterada é recusada',()=>{
 const s=state(),first=save(s);assert.equal(save(s),first);save(s,input({notes:'Edição'}),{expectedVersion:1,operationId:'op-edit',now:later});assert.equal(save(s).version,2);assert.equal(s.comparisons[0].history.length,1);assert.throws(()=>save(s,input({title:'Outra carga'})),/outros dados/);
});
test('versão desatualizada não sobrescreve nem remove a mais recente',()=>{
 const s=state();save(s);save(s,input({notes:'Edição'}),{expectedVersion:1,operationId:'op-edit',now:later});const snapshot=structuredClone(s);assert.throws(()=>save(s,input({notes:'Aba antiga'}),{expectedVersion:1,operationId:'op-stale'}),/mudou/);assert.throws(()=>deleteComparisonRecord(s,{id:'cmp',patientId:'ana',expectedVersion:1,reason:'Duplicada no teste',operationId:'delete-stale',now:later}),/mudou/);assert.deepEqual(s,snapshot);
});
test('exclusão exige motivo e preserva versões, originais e idempotência; registro excluído não é reescrito',()=>{
 const s=state();save(s);const visits=structuredClone(s.visits),options={id:'cmp',patientId:'ana',expectedVersion:1,reason:'Duplicada no teste',operationId:'op-delete',now:later};assert.throws(()=>deleteComparisonRecord(s,{...options,reason:''}),/motivo/);const deleted=deleteComparisonRecord(s,options);assert.equal(deleted.version,2);assert.equal(deleted.status,'excluido');assert.equal(deleted.history[0].snapshot.status,'ativo');assert.equal(deleteComparisonRecord(s,options),deleted);assert.deepEqual(s.visits,visits);assert.throws(()=>save(s,input(),{expectedVersion:2,operationId:'rewrite'}),/excluída/);assert.doesNotMatch(renderComparisonLibrary(s,{patientId:'ana'}),/data-id="cmp"/);assert.match(renderComparisonLibrary(s,{patientId:'ana',includeDeleted:true}),/data-id="cmp"/);
});
test('comparação schema 1 abre sem mutação e migra na primeira edição preservando snapshot exato',()=>{
 const s=state(),legacy={id:'cmp',...comparisonSelection(s,'ana',{before:key('v1','p0'),after:key('v2','after'),mode:'slide',split:67,format:'jpeg'}),savedAt:now};s.comparisons.push(legacy);const original=structuredClone(legacy);validateComparisonRecord(s,legacy);const draft=comparisonRecordDraft(s,'ana',legacy);assert.deepEqual(legacy,original);assert.equal(draft.split,67);assert.equal(draft.beforeDate,'2026-10-01');const edited=save(s,{...draft,title:'Título atualizado'},{expectedVersion:1,operationId:'op-upgrade',now:later});assert.equal(edited.schemaVersion,2);assert.deepEqual(edited.history[0].snapshot,original);assert.equal(edited.version,2);
});
test('validador rejeita corrupção em versão histórica, paciente, referências, limites e datas',()=>{
 const s=state();save(s);save(s,input({notes:'Edição'}),{expectedVersion:1,operationId:'op-edit',now:later});const record=s.comparisons[0];for(const corrupt of [x=>x.history[0].snapshot.patientId='outra',x=>x.history[0].snapshot.beforePhotos=[key('v3','other')],x=>x.history[0].snapshot.split=101,x=>x.history[0].version=2,x=>x.history[0].snapshot.history=[],x=>x.history[0].snapshot.savedAt=later,x=>x.history[0].at='2030-01-01',x=>x.history=[],x=>x.history[0].snapshot.operationId=x.operationId]){const altered=structuredClone(record);corrupt(altered);assert.throws(()=>validateComparisonRecord(s,altered));}const unchanged=structuredClone(record);validateComparisonRecord(s,record);assert.deepEqual(record,unchanged);
});
test('biblioteca escapa título, área, notas e origem externa no HTML',()=>{
 const s=state();save(s,input({title:'<img src=x onerror=alert(1)>',area:'<script>erro</script>',notes:'<b>literal</b>'}));const html=renderComparisonLibrary(s,{patientId:'ana'});assert.ok(html.includes('&lt;img'));assert.ok(html.includes('&lt;script'));assert.doesNotMatch(html,/<script>|<img src=x/);
});
