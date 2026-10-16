import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,validateTransition} from './rules.mjs';
import {fanRays as serverFanRays,annotationCheck as serverCheck} from '../_shared/app-workspace-domain/domain.mjs';
import {fanRays,annotationCheck} from '../../../painel/piloto-simples/domain.mjs';
const sha='a'.repeat(64),photo={id:'photo',patient_id:'patient',visit_id:'visit',status:'ready',sha256:sha,width:900,height:1600};
const options={photos:[photo],now:'2026-10-15T18:00:00.000Z'};
const legacy={id:'legacy',kind:'leque',x:.3,y:.4,x2:.5,y2:.6,region:'Leque anterior',quantity:null,unit:'sem quantidade',product:'',notes:'',lot:''};
const modern={...legacy,id:'new',fanSpread:48};
function fixture(){const state=emptyState();state.patients.push({id:'patient',name:'Paciente fictícia'});state.visits.push({id:'visit',patientId:'patient',date:'2026-10-15',service:'Avaliação',status:'rascunho',notes:'',photos:[{id:'photo',label:'Frontal',phase:'antes',sha256:sha,revision:sha,width:900,height:1600}],maps:{photo:{version:1,points:[structuredClone(legacy)],history:[[]]}}});return state;}
function add(old,point=modern){const next=structuredClone(old),map=next.visits[0].maps.photo;map.history.push(structuredClone(map.points));map.points.push(structuredClone(point));map.version++;return next;}
test('server accepts angular fan alongside legacy with exact version/history and no stock or financial effect',()=>{
 const old=fixture(),before=structuredClone(old),next=add(old);assert.doesNotThrow(()=>validateTransition(old,next,options));assert.deepEqual(old,before);assert.deepEqual(next.visits[0].maps.photo.points[0],legacy);
 for(const key of ['stockMovements','stockLots','bills','payments'])assert.deepEqual(next[key],old[key]);
 assert.deepEqual(serverFanRays(modern,.5625),fanRays(modern,.5625));assert.deepEqual(serverCheck(modern),annotationCheck(modern));
});
test('server refuses invalid opening in live or historical geometry and cannot overwrite legacy without version history',()=>{
 for(const fanSpread of [0,-1,121,'48',null]){const old=fixture();assert.throws(()=>validateTransition(old,add(old,{...modern,fanSpread}),options),e=>e.code==='invalid_state');}
 const old=fixture(),next=add(old);next.visits[0].maps.photo.history[1][0].fanSpread=121;assert.throws(()=>validateTransition(old,next,options),e=>e.code==='invalid_state');
 const forged=structuredClone(old);forged.visits[0].maps.photo.points[0].fanSpread=48;assert.throws(()=>validateTransition(old,forged,options),e=>e.code==='map_version_conflict');
});
