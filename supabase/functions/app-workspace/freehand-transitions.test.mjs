import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,validateTransition} from './rules.mjs';
import {annotationCheck as serverAnnotationCheck,translateAnnotation as serverTranslate} from '../_shared/app-workspace-domain/domain.mjs';
import {annotationCheck,translateAnnotation} from '../../../painel/piloto-simples/domain.mjs';
import {saveProcedure,completeVisit,visitMarkings} from '../_shared/app-workspace-domain/operations-domain.mjs';

const day='2026-10-15',now=day+'T18:00:00.000Z',sha='a'.repeat(64);
const photo={id:'photo',patient_id:'patient',visit_id:'visit',status:'ready',sha256:sha,width:100,height:200};
const options={photos:[photo],now};
const legacy={id:'old',kind:'leque',x:.4,y:.4,x2:.6,y2:.7,region:'Anterior',product:'',quantity:null,unit:'sem quantidade',lot:'',notes:''};
const drawing={id:'trace',kind:'traco',x:.1,y:.2,vertices:[{x:.1,y:.2},{x:.3,y:.5},{x:.7,y:.4}],region:'Desenho livre',product:'',quantity:null,unit:'sem quantidade',lot:'',notes:''};
function fixture(){const state=emptyState();state.patients.push({id:'patient',name:'Paciente fictícia'});state.visits.push({id:'visit',patientId:'patient',date:day,service:'Avaliação',status:'rascunho',notes:'',photos:[{id:'photo',label:'Frontal',phase:'antes',sha256:sha,revision:sha,width:100,height:200}],maps:{photo:{version:1,points:[structuredClone(legacy)],history:[[]]}}});return state;}
function add(old,value=drawing){const next=structuredClone(old),map=next.visits[0].maps.photo;map.history=[...map.history,structuredClone(map.points)].slice(-20);map.points.push(structuredClone(value));map.version++;return next;}
const validate=(old,next,extra={})=>validateTransition(old,next,{...options,...extra});

test('backend aceita traço junto do leque legado, preservando versão e histórico sem efeitos financeiros',()=>{
 const old=fixture(),before=structuredClone(old),next=add(old);assert.doesNotThrow(()=>validate(old,next));assert.deepEqual(old,before);assert.deepEqual(next.visits[0].maps.photo.points[0],legacy);assert.deepEqual(visitMarkings(next.visits[0]),[]);for(const key of ['stockMovements','stockLots','bills','payments'])assert.deepEqual(next[key],old[key]);
});
test('backend e cliente compartilham exatamente a validação e translação dos traços',()=>{
 assert.deepEqual(serverAnnotationCheck(structuredClone(drawing)),annotationCheck(structuredClone(drawing)));assert.deepEqual(serverTranslate(drawing,{x:1,y:0}),translateAnnotation(drawing,{x:1,y:0}));
 const max={...drawing,vertices:Array.from({length:256},(_,i)=>({x:i/255,y:.2})),x:0};assert.doesNotThrow(()=>validate(fixture(),add(fixture(),max)));
});
test('backend rejeita traço malformado, quantidade clínica e histórico adulterado mesmo em JSON válido',()=>{
 for(const mutate of [x=>x.vertices=[],x=>x.vertices=[{x:.1,y:.2}],x=>x.vertices=Array(257).fill({x:.1,y:.2}),x=>x.vertices[1].x=1.01,x=>x.vertices[1].y='0.2',x=>x.vertices[1].path='M0 0',x=>x.x=.2,x=>x.x2=.3,x=>x.y2=.3,x=>x.quantity=1,x=>x.unit='mL']){const old=fixture(),value=structuredClone(drawing);mutate(value);assert.throws(()=>validate(old,add(old,value)),error=>error.code==='invalid_state');}
 const old=fixture(),next=add(old);next.visits[0].maps.photo.history.push([{...drawing,vertices:[{x:.1,y:.2},{x:2,y:.5}]}]);assert.throws(()=>validate(old,next),error=>error.code==='invalid_state');
});
test('backend aceita desfazer exato do traço e recusa perda de histórico ou versão conflitante',()=>{
 const old=fixture(),saved=add(old);const undo=structuredClone(saved),map=undo.visits[0].maps.photo;map.points=structuredClone(map.history.at(-1));map.history=map.history.slice(0,-1);map.version++;assert.doesNotThrow(()=>validate(saved,undo));assert.deepEqual(map.points,[legacy]);
 for(const mutate of [m=>m.version--,m=>m.history=[],m=>m.history[0].push(drawing)]){const next=add(old);mutate(next.visits[0].maps.photo);assert.throws(()=>validate(old,next),error=>error.code==='map_version_conflict');}
 const forged=structuredClone(undo);forged.visits[0].maps.photo.points[0].notes='Não era o estado anterior';assert.throws(()=>validate(saved,forged),error=>error.code==='map_version_conflict');
});
test('backend mantém limite global de quatro MiB apesar do limite de vértices por traço',()=>{
 const old=fixture(),next=add(old),map=next.visits[0].maps.photo;map.points=Array.from({length:1000},(_,i)=>({...drawing,id:'trace-'+i,vertices:Array.from({length:256},()=>({x:.1,y:.2}))}));assert.throws(()=>validate(old,next),error=>error.code==='state_too_large'&&error.status===413);
});
test('backend exige mesma foto/paciente e protege traços da consulta concluída',()=>{
 const old=fixture(),next=add(old);assert.throws(()=>validate(old,next,{photos:[{...photo,patient_id:'other'}]}),error=>error.code==='photo_binding_invalid');
 const ready=add(old);saveProcedure(ready,{operationId:'create-procedure',data:{id:'procedure',name:'Avaliação',price:10000,cost:1000,duration:30,recordMode:'simple'},today:day,now});const completed=structuredClone(ready);completeVisit(completed,{operationId:'complete',visitId:'visit',procedureId:'procedure',consumptions:[],today:day,now});assert.doesNotThrow(()=>validate(ready,completed,{clinicalCompletions:new Set(['visit'])}));assert.deepEqual(completed.visits[0].completionSnapshot.maps,ready.visits[0].maps);assert.deepEqual(completed.stockMovements,ready.stockMovements);
 const edited=add(completed,{...drawing,id:'forbidden'});edited.visits[0].completionSnapshot.maps=structuredClone(edited.visits[0].maps);assert.throws(()=>validate(completed,edited),error=>error.code==='immutable_visit');
});
