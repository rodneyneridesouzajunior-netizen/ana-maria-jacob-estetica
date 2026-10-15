import test from 'node:test';
import assert from 'node:assert/strict';
import {seed} from '../domain.mjs';
import {savePatient} from '../patients-domain.mjs';
import {buildBackup,verifyBackup,backupHash,validateBackupState} from '../backup.mjs';
const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT8sAAAAASUVORK5CYII='),c=>c.charCodeAt(0));
const build=state=>buildBackup({state,photos:[]},async()=>new Blob([png],{type:'image/png'}));
function changed(){const s=seed();savePatient(s,{id:'demo-marina',name:'Marina Fictícia',address:'Rua de teste',addressNumber:'12',postalCode:'32600-000',neighborhood:'Centro',city:'Betim',state:'MG',complement:'Sala fictícia',notes:'Somente teste',color:'purple'},{expectedVersion:1,operationId:'patient-edit',now:'2026-10-15T12:00:00Z',today:'2026-10-15'});return s;}

test('backup preserva endereço completo, cor, versão e snapshots do cadastro sem alterar fotos e vínculos',async()=>{
 const s=changed(),backup=await build(s),restored=await verifyBackup(backup);assert.deepEqual(restored.state.patients,s.patients);assert.deepEqual(restored.state.patientHistory,s.patientHistory);assert.equal(restored.state.patients[0].postalCode,'32600000');assert.equal(restored.state.patients[0].version,2);assert.equal(restored.state.visits[0].patientId,'demo-marina');assert.deepEqual(new Uint8Array(await restored.photos[0].original.arrayBuffer()),png);assert.deepEqual((await verifyBackup(await buildBackup(restored))).state.patients,s.patients);
});
test('backup rejeita UF/cor/CEP, paciente histórica trocada e versão corrompida mesmo com envelope recalculado',async()=>{
 const backup=await build(changed());for(const change of [s=>s.patients[0].state='XX',s=>s.patients[0].postalCode='123',s=>s.patients[0].color='url(evil)',s=>s.patientHistory[0].previous.id='demo-beatriz',s=>s.patientHistory[0].snapshot.version=20]){const altered=structuredClone(backup);change(altered.state);altered.stateHash=await backupHash(JSON.stringify(altered.state));await assert.rejects(()=>verifyBackup(altered));}
});
test('backup legado sem novos campos ou versão e histórico original continuam restauráveis',async()=>{
 const s=seed(),previous=structuredClone(s.patients[0]);s.patients[0].name='Nome legado corrigido';s.patientHistory=[{id:'legacy-edit',patientId:previous.id,action:'cadastro_corrigido',at:'2026-10-14T12:00:00Z',previous,snapshot:structuredClone(s.patients[0])}];assert.doesNotThrow(()=>validateBackupState(s));const restored=await verifyBackup(await build(s));assert.deepEqual(restored.state.patients,s.patients);assert.deepEqual(restored.state.patientHistory,s.patientHistory);assert.equal(restored.state.patients[0].version,undefined);
});
