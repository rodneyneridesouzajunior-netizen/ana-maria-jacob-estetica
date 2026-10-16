import test from 'node:test';
import assert from 'node:assert/strict';
import {seed} from '../domain.mjs';
import {buildBackup,verifyBackup,validateBackupState,backupHash} from '../backup.mjs';

const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT8sAAAAASUVORK5CYII='),c=>c.charCodeAt(0));
const legacy={id:'old',kind:'linha',x:.2,y:.3,x2:.6,y2:.7,region:'Registro anterior',product:'',quantity:null,unit:'sem quantidade',lot:'',notes:''};
const drawing={id:'trace',kind:'traco',x:.1,y:.2,vertices:[{x:.1,y:.2},{x:.3,y:.5},{x:.7,y:.4}],region:'Desenho livre',product:'',quantity:null,unit:'sem quantidade',lot:'',notes:''};
function fixture(){const state=seed();state.visits[0].maps['demo-foto']={version:2,points:[structuredClone(legacy),structuredClone(drawing)],history:[[],[structuredClone(legacy)]]};return state;}
const build=state=>buildBackup({state,photos:[]},async()=>new Blob([png],{type:'image/png'}));

test('backup autossuficiente recupera traço e histórico legado sem mudar vértices ou fotografia',async()=>{
 const state=fixture(),before=structuredClone(state),backup=await build(state),restored=await verifyBackup(backup);
 assert.deepEqual(restored.state.visits[0].maps,state.visits[0].maps);assert.deepEqual(new Uint8Array(await restored.photos[0].original.arrayBuffer()),png);assert.deepEqual(state,before);
 const second=await buildBackup(restored),again=await verifyBackup(second);assert.deepEqual(again.state.visits[0].maps,state.visits[0].maps);
});
test('backup valida vértices e uso visual tanto no mapa atual quanto nas versões anteriores',()=>{
 for(const historical of [false,true])for(const mutate of [x=>x.vertices[1].x=2,x=>x.quantity=.1,x=>x.unit='mL',x=>x.x=.8,x=>x.x2=.4,x=>x.vertices=Array(257).fill({x:.1,y:.2})]){
  const state=fixture(),bad=structuredClone(drawing);mutate(bad);const map=state.visits[0].maps['demo-foto'];if(historical)map.history.push([bad]);else map.points.push({...bad,id:'bad'});assert.throws(()=>validateBackupState(state));
 }
});
test('recalcular hash não permite restaurar traço inválido ou na foto de outra consulta',async()=>{
 const backup=await build(fixture());backup.state.visits[0].maps['demo-foto'].points[1].vertices[1].y=-1;backup.stateHash=await backupHash(JSON.stringify(backup.state));await assert.rejects(()=>verifyBackup(backup),/Vértice/);
 const state=fixture();state.visits[0].maps['unknown-photo']=structuredClone(state.visits[0].maps['demo-foto']);assert.throws(()=>validateBackupState(state),/Mapa sem fotografia/);
});
test('retrato de consulta concluída inclui traços e continua imutável na validação do backup',()=>{
 const state=fixture(),visit=state.visits[0];visit.status='concluido';visit.lockedAt='2026-10-15T15:00:00.000Z';visit.completionSnapshot={patientId:visit.patientId,date:visit.date,notes:visit.notes,maps:structuredClone(visit.maps),photos:structuredClone(visit.photos)};assert.doesNotThrow(()=>validateBackupState(state));visit.maps['demo-foto'].points[1].vertices[1].x=.8;assert.throws(()=>validateBackupState(state),/versão preservada/);
});
