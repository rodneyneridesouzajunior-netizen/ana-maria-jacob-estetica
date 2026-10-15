import test from 'node:test';
import assert from 'node:assert/strict';
import {createVisit} from '../visit-workflow.mjs';
import {completeVisit} from '../operations-domain.mjs';
const now='2026-10-15T12:00:00Z',today='2026-10-15';
function fixture(){const state={patients:[{id:'p'}],visits:[],appointments:[],bills:[],payments:[],procedures:[{id:'proc',name:'Procedimento de teste v1',version:1,active:true,recordMode:'simple',price:10000,cost:1200,duration:30,returnDays:15,requiredDocumentIds:['old-document']}]};createVisit(state,{id:'v',patientId:'p',date:today,procedureId:'proc'});return state;}
const complete=(s,options={},settings={documentCheck:()=>true})=>completeVisit(s,{visitId:'v',procedureId:'proc',operationId:'complete',consumptions:[],today,now,...options},settings);
test('conclusão usa snapshot da abertura mesmo após edição do catálogo, incluindo documentos, preço, custo e retorno',()=>{
 const s=fixture(),snapshot=structuredClone(s.visits[0].procedureSnapshot);Object.assign(s.procedures[0],{name:'Catálogo v2',version:2,recordMode:'injectable',price:90000,cost:7000,returnDays:90,requiredDocumentIds:['new-document']});let checked;
 complete(s,{}, {documentCheck:(_,visit,ids)=>{checked=ids;return visit.patientId==='p';}});assert.deepEqual(checked,['old-document']);assert.deepEqual(s.visits[0].procedureSnapshot,snapshot);assert.deepEqual(s.visits[0].completionSnapshot.procedure,snapshot);assert.equal(s.visits[0].procedureVersion,1);assert.equal(s.visits[0].recordMode,'simple');assert.equal(s.bills[0].total,10000);assert.equal(s.bills[0].cost,1200);assert.equal(s.expectedReturns[0].date,'2026-10-30');assert.equal(s.procedures[0].version,2);
});
test('conclusão rejeita troca silenciosa de procedimento e snapshot com versão incompatível sem efeitos parciais',()=>{
 const s=fixture();s.procedures[0].active=false;const inactive=structuredClone(s);assert.throws(()=>complete(s),/inativo/);assert.deepEqual(s,inactive);s.procedures[0].active=true;s.procedures.push({...s.procedures[0],id:'other'});let before=structuredClone(s);assert.throws(()=>complete(s,{procedureId:'other'}),/versão selecionada/);assert.deepEqual(s,before);s.visits[0].procedureVersion=2;before=structuredClone(s);assert.throws(()=>complete(s),/versão selecionada/);assert.deepEqual(s,before);
});
test('consulta legada sem snapshot continua usando procedimento explícito e não contorna inatividade',()=>{
 const s=fixture();delete s.visits[0].procedureSnapshot;delete s.visits[0].procedureVersion;delete s.visits[0].procedureId;s.procedures[0].active=false;const before=structuredClone(s);assert.throws(()=>complete(s),/inativo/);assert.deepEqual(s,before);s.procedures[0].active=true;complete(s);assert.equal(s.visits[0].procedureVersion,1);
});
