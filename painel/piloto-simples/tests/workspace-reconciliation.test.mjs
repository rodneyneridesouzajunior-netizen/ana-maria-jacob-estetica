import test from 'node:test';
import assert from 'node:assert/strict';
import {reconciliationAvailability,reconcileWorkspaceRecords} from '../workspace-reconciliation.mjs';
const emptyState=()=>({schema:1,revision:0,patients:[],visits:[],appointments:[],patientHistory:[],auditLog:[],procedures:[],products:[],bills:[],documentResponses:[],clinic:{name:'Clínica sintética',professionals:[{id:'professional',name:'Profissional sintética'}]}});
const copy=value=>structuredClone(value);
function fixture(){const base=emptyState();base.revision=1;base.patients=[{id:'one',name:'Paciente um'},{id:'two',name:'Paciente dois'}];base.visits=[{id:'visit-one',patientId:'one',notes:'Original',status:'rascunho',photos:[],maps:{}},{id:'visit-two',patientId:'two',notes:'Original',status:'rascunho',photos:[],maps:{}}];const candidate=copy(base),latest=copy(base);latest.revision=2;latest.auditLog.push({id:'server-audit'});return{base,candidate,latest};}
test('reconciliation reapplies whole independent records and preserves the latest server audit without mutating inputs',()=>{
 const f=fixture();f.candidate.patients[1].name='Celular';f.latest.patients[0].name='Notebook';const before=JSON.stringify(f),result=reconcileWorkspaceRecords(f.base,f.candidate,f.latest);
 assert.equal(result.state.patients[0].name,'Notebook');assert.equal(result.state.patients[1].name,'Celular');assert.equal(result.state.revision,2);assert.deepEqual(result.state.auditLog,[{id:'server-audit'}]);assert.deepEqual(result.changes,[{collection:'patients',id:'two'}]);assert.equal(JSON.stringify(f),before);
});
test('reconciliation refuses different fields of the same clinical entity even if both end values agree',()=>{
 for(const identical of [false,true]){const f=fixture();f.candidate.visits[0].notes='Celular';if(identical)f.latest.visits[0].notes='Celular';else f.latest.visits[0].service='Notebook';assert.throws(()=>reconcileWorkspaceRecords(f.base,f.candidate,f.latest),{code:'reconciliation_conflict'});}
});
test('reconciliation rejects changed clinical dependencies, configuration and reserved IDs',()=>{
 for(const change of ['patient','clinic','same-id']){const f=fixture();f.candidate.visits[0].notes='Nova nota';if(change==='patient')f.latest.patients[0].name='Identidade corrigida';if(change==='clinic')f.latest.clinic.professionals[0].name='Equipe corrigida';if(change==='same-id'){f.candidate.visits.push({id:'same',patientId:'one',status:'rascunho',photos:[],maps:{}});f.latest.visits.push({id:'same',patientId:'two',status:'rascunho',photos:[],maps:{}});}assert.throws(()=>reconcileWorkspaceRecords(f.base,f.candidate,f.latest),{code:'reconciliation_conflict'});}
});
test('reconciliation preserves append-only patient history from both devices',()=>{
 const f=fixture();f.candidate.patients[1].name='Celular';f.candidate.patientHistory.push({id:'local-history',patientId:'two'});f.latest.patients[0].name='Notebook';f.latest.patientHistory.push({id:'server-history',patientId:'one'});const result=reconcileWorkspaceRecords(f.base,f.candidate,f.latest);assert.deepEqual(result.state.patientHistory.map(x=>x.id),['server-history','local-history']);
});
test('reconciliation refuses history rewrites, duplicate IDs and unrelated history additions',()=>{
 for(const change of ['rewrite','duplicate','unrelated']){const f=fixture();f.base.patientHistory.push({id:'old',patientId:'two'});f.candidate=copy(f.base);f.candidate.patients[1].name='Celular';f.latest.patientHistory=copy(f.base.patientHistory);if(change==='rewrite')f.candidate.patientHistory[0].patientId='one';if(change==='duplicate')f.candidate.patientHistory.push({id:'old',patientId:'two'});if(change==='unrelated')f.candidate.patientHistory.push({id:'new',patientId:'one'});assert.equal(reconciliationAvailability(f.base,f.candidate).canReconcile,false);}
});
test('reconciliation declines financial effects, documents, catalog, removed records, photos and clinical completion',()=>{
 for(const mutate of [s=>s.bills.push({id:'bill'}),s=>s.documentResponses.push({id:'doc'}),s=>s.products.push({id:'product'}),s=>s.patients.pop(),s=>s.visits[0].photos.push({id:'photo'}),s=>s.visits[0].status='concluido',s=>s.clinic.name='Outra clínica']){const f=fixture();mutate(f.candidate);assert.equal(reconciliationAvailability(f.base,f.candidate).canReconcile,false);assert.throws(()=>reconcileWorkspaceRecords(f.base,f.candidate,f.latest),{code:'reconciliation_unsupported'});}
});
test('independent patient IDs cannot be reconciled into duplicate CPF identities',()=>{
 const f=fixture();f.candidate.patients[1].cpf='52998224725';f.latest.patients[0].cpf='529.982.247-25';assert.throws(()=>reconcileWorkspaceRecords(f.base,f.candidate,f.latest),{code:'reconciliation_conflict'});
});
test('two independent visit IDs cannot create a second visit for one appointment',()=>{
 const f=fixture();const row={patientId:'one',appointmentId:'slot',status:'rascunho',photos:[],maps:{}};f.base.appointments=[{id:'slot',patientId:'one'}];f.candidate.appointments=copy(f.base.appointments);f.latest.appointments=copy(f.base.appointments);f.candidate.visits.push({...row,id:'new-mobile'});f.latest.visits.push({...row,id:'new-notebook'});assert.throws(()=>reconcileWorkspaceRecords(f.base,f.candidate,f.latest),{code:'reconciliation_conflict'});
});
