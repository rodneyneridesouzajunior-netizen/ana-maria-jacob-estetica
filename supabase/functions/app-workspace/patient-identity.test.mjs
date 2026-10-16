import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,validateTransition} from './rules.mjs';
import {validCPF} from '../_shared/app-workspace-domain/patients-domain.mjs';

// Public algorithm examples used only with synthetic names/IDs in memory.
const CPF_A='52998224725',CPF_B='11144477735',CPF_C='12345678909';
const now='2026-10-15T18:00:00.000Z';
const patient=(id,cpf)=>({id,name:'Paciente sintética '+id,cpf,version:1});
const state=(...patients)=>({...emptyState(),patients});
const check=(old,next)=>validateTransition(old,next,{now});
function edited(old,id,changes){
 const next=structuredClone(old),previous=next.patients.find(p=>p.id===id),snapshot={...previous,...changes,version:(previous.version||1)+1};
 next.patients[next.patients.indexOf(previous)]=snapshot;
 next.patientHistory.push({id:'synthetic-identity-edit',schemaVersion:2,patientId:id,action:'cadastro_corrigido',at:now,previous:structuredClone(previous),snapshot:structuredClone(snapshot)});return next;
}
test('identity fixtures have valid check digits without referencing an actual patient',()=>{
 for(const cpf of [CPF_A,CPF_B,CPF_C])assert.equal(validCPF(cpf),true);
});
test('a newly added patient cannot reuse the CPF of another saved ID',()=>{
 const old=state(patient('identity-one',CPF_A)),next=structuredClone(old);next.patients.push(patient('identity-two',CPF_A));const before=structuredClone(old);assert.throws(()=>check(old,next),{code:'duplicate_patient_cpf'});assert.deepEqual(old,before);
});
test('two distinct patients introduced in the same commit cannot share one CPF',()=>{
 const old=state(),next=state(patient('identity-one',CPF_A),patient('identity-two',CPF_A));assert.throws(()=>check(old,next),{code:'duplicate_patient_cpf'});
});
test('editing the CPF of an existing ID cannot collide with another patient even with correct history',()=>{
 const old=state(patient('identity-one',CPF_A),patient('identity-two',CPF_B)),next=edited(old,'identity-two',{cpf:CPF_A});assert.throws(()=>check(old,next),{code:'duplicate_patient_cpf'});
});
test('punctuated and unformatted CPFs are the same identity when adding or changing a patient',()=>{
 const old=state(patient('identity-one','529.982.247-25'),patient('identity-two',CPF_B)),added=structuredClone(old);added.patients.push(patient('identity-three',CPF_A));assert.throws(()=>check(old,added),{code:'duplicate_patient_cpf'});
 const changed=edited(state(patient('identity-one',CPF_A),patient('identity-two',CPF_B)),'identity-two',{cpf:'529.982.247-25'});assert.throws(()=>check(state(patient('identity-one',CPF_A),patient('identity-two',CPF_B)),changed),{code:'duplicate_patient_cpf'});
});
test('unchanged legacy duplicates do not freeze a no-op commit',()=>{
 const old=state(patient('legacy-one',CPF_A),patient('legacy-two','529.982.247-25'));assert.doesNotThrow(()=>check(old,structuredClone(old)));
});
test('an unrelated patient can be corrected while historical duplicate identities are preserved',()=>{
 const old=state(patient('legacy-one',CPF_A),patient('legacy-two',CPF_A),patient('identity-third',CPF_B)),next=edited(old,'identity-third',{notes:'Observação sintética de outro cadastro'});assert.doesNotThrow(()=>check(old,next));assert.deepEqual(next.patients.slice(0,2),old.patients.slice(0,2));
});
test('format-only changes to an existing duplicate do not count as a new CPF identity',()=>{
 const old=state(patient('legacy-one',CPF_A),patient('legacy-two',CPF_A)),next=edited(old,'legacy-two',{cpf:'529.982.247-25'});assert.doesNotThrow(()=>check(old,next));
});
test('deliberate correction of a legacy duplicate to a distinct valid CPF or blank is permitted',()=>{
 for(const cpf of [CPF_C,'']){const old=state(patient('legacy-one',CPF_A),patient('legacy-two',CPF_A)),next=edited(old,'legacy-two',{cpf});assert.doesNotThrow(()=>check(old,next));assert.equal(next.patientHistory[0].previous.cpf,CPF_A);assert.equal(next.patientHistory[0].snapshot.cpf,cpf);}
});
test('blank optional CPFs do not identify unrelated patients as duplicates',()=>{
 const old=state(patient('identity-one','')),next=structuredClone(old);next.patients.push(patient('identity-two',''));assert.doesNotThrow(()=>check(old,next));
});
test('identity correction still requires its preserved history and an advanced version',()=>{
 const old=state(patient('identity-one',CPF_A)),missing=structuredClone(old);missing.patients[0].cpf=CPF_B;assert.throws(()=>check(old,missing),{code:'entity_version_conflict'});missing.patients[0].version=2;assert.throws(()=>check(old,missing),{code:'patient_history_required'});
});
