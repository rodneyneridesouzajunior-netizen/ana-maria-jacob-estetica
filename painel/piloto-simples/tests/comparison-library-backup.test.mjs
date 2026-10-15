import test from 'node:test';
import assert from 'node:assert/strict';
import {seed} from '../domain.mjs';
import {comparisonSelection} from '../compare.mjs';
import {comparisonRecordDraft,saveComparisonRecord,deleteComparisonRecord} from '../comparison-library.mjs';
import {buildBackup,verifyBackup,backupHash} from '../backup.mjs';
const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT8sAAAAASUVORK5CYII='),c=>c.charCodeAt(0));
const now='2026-10-15T12:00:00.000Z';
const key=id=>JSON.stringify(['demo-consulta',id]);
function fixture(){const s=seed(),visit=s.visits[0];visit.photos.push({...visit.photos[0],id:'second',label:'Foto fictícia para teste de backup'});const draft={...comparisonRecordDraft(s,'demo-marina'),id:'comparison',title:'TESTE — sem resultado clínico',beforeDate:visit.date,before:key('demo-foto'),beforePhotos:[key('demo-foto')]};saveComparisonRecord(s,draft,{operationId:'new',now});return{s,draft};}
const build=s=>buildBackup({state:s,photos:[]},async()=>new Blob([png],{type:'image/png'}));

test('backup faz roundtrip de registro incompleto e biblioteca versionada com todos os originais',async()=>{
 const {s,draft}=fixture(),pending=await verifyBackup(await build(s));assert.equal(pending.state.comparisons[0].after,'');assert.equal(pending.photos.length,2);saveComparisonRecord(s,{...draft,after:key('second'),afterPhotos:[key('second')],afterDate:s.visits[0].date},{expectedVersion:1,operationId:'edit',now});const before=structuredClone(s.comparisons),restored=await verifyBackup(await build(s));assert.deepEqual(restored.state.comparisons,before);assert.deepEqual(new Uint8Array(await restored.photos[0].original.arrayBuffer()),png);assert.equal(restored.state.comparisons[0].history[0].snapshot.after,'');assert.deepEqual((await verifyBackup(await buildBackup(restored))).state.comparisons,before);
});
test('backup conserva exclusão e legado junto das novas comparações, sem reescrever schema 1',async()=>{
 const {s}=fixture();const legacy={id:'legacy',...comparisonSelection(s,'demo-marina',{before:key('demo-foto'),after:key('second'),mode:'slide',split:60,format:'png'}),savedAt:now};s.comparisons.push(legacy);deleteComparisonRecord(s,{id:'comparison',patientId:'demo-marina',expectedVersion:1,reason:'Exclusão fictícia de teste',operationId:'delete',now});const restored=await verifyBackup(await build(s));assert.deepEqual(restored.state.comparisons[1],legacy);assert.equal(restored.state.comparisons[0].status,'excluido');assert.equal(restored.state.comparisons[0].history[0].snapshot.status,'ativo');assert.equal(restored.photos.length,2);
});
test('backup rejeita foto histórica órfã ou paciente trocada mesmo com envelope recalculado',async()=>{
 const {s,draft}=fixture();saveComparisonRecord(s,{...draft,notes:'Nova versão preservando a anterior'},{expectedVersion:1,operationId:'edit',now});const base=await build(s);for(const change of [x=>x.history[0].snapshot.patientId='demo-beatriz',x=>x.history[0].snapshot.beforePhotos=['referência ausente'],x=>x.history[0].snapshot.split=100.1,x=>x.history[0].version=8]){const corrupt=structuredClone(base);change(corrupt.state.comparisons[0]);corrupt.stateHash=await backupHash(JSON.stringify(corrupt.state));await assert.rejects(()=>verifyBackup(corrupt));}
});
