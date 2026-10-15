// Independent regression review. PostgreSQL/WASM, synthetic identities only.
// The fixture loads the real migrations and legacy FK blocker, not a SQL mock.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createClinicalSqlFixture,clinicalId} from './clinical-sql-fixture.mjs';

async function setState(f,state){await f.db.query('update app_workspaces set state=$1 where clinic_id=$2',[state,f.clinic]);}
async function counts(f){return (await f.db.query('select (select count(*)::int from app_workspace_document_links) links,(select count(*)::int from app_workspace_document_events) events')).rows[0];}

test('clinical review: closed/locked/wrong-patient visits reject a link; success does not change clinical state',async()=>{
 const f=await createClinicalSqlFixture();try{
  for(const change of [{status:'concluido'},{status:'cancelado'},{lockedAt:'2026-10-15T18:00:00Z'},{patientId:'other'}]){
   const state=structuredClone(f.state);Object.assign(state.visits[0],change);await setState(f,state);
   await assert.rejects(f.link(),/document_binding_invalid/);assert.deepEqual(await counts(f),{links:0,events:0});
  }
  await setState(f,f.state);await assert.rejects(f.link({patient:'other'}),/document_binding_invalid/);
  const before=(await f.db.query('select state,revision,state_hash from app_workspaces')).rows[0];
  const result=await f.link();assert.equal(result.link.clinical_authorization,false);
  assert.deepEqual((await f.db.query('select state,revision,state_hash from app_workspaces')).rows[0],before);
  assert.equal(before.state.visits[0].status,'rascunho');assert.equal(before.state.visits[0].lockedAt,undefined);
 }finally{await f.close();}
});

test('clinical review: TCLE has its own FK and blocks the real legacy deletion scan',async()=>{
 const f=await createClinicalSqlFixture();try{
  const id=clinicalId('7');await f.seed('documento_clinico',id);
  const result=await f.link({kind:'documento_clinico',id});assert.equal(result.link.source_snapshot.type,'tcle_toxina_botulinica');
  const fk=(await f.db.query('select anamnese_id,documento_clinico_id from app_workspace_document_links')).rows[0];
  assert.deepEqual(fk,{anamnese_id:null,documento_clinico_id:id});
  const blockers=(await f.db.query("select private.fichas_exclusao_vinculos($1,'documento_clinico',$2) result",[f.clinic,id])).rows[0].result;
  assert.ok(blockers.some(x=>x.codigo==='relacao_obrigatoria'));
  await assert.rejects(f.db.query('delete from documentos_clinicos where id=$1',[id]),/foreign key/);
  assert.deepEqual(await counts(f),{links:1,events:1});
 }finally{await f.close();}
});

test('clinical review: changed or withdrawn originals become unavailable without rewriting the audited snapshot',async()=>{
 const f=await createClinicalSqlFixture();try{
  const saved=await f.link(),snapshot=structuredClone(saved.link.source_snapshot);
  await f.db.query('update anamneses set pdf_sha256=$1 where id=$2',['f'.repeat(64),f.sourceId]);
  let current=(await f.links())[0];assert.equal(current.current_identity_matches,true);assert.equal(current.available,false);assert.deepEqual(current.source_snapshot,snapshot);
  await f.db.query('update anamneses set pdf_sha256=$1,consentimento_retirado_em=now() where id=$2',['c'.repeat(64),f.sourceId]);
  current=(await f.links())[0];assert.equal(current.available,false);assert.deepEqual(current.source_snapshot,snapshot);
  const historical=await f.link({sourceFingerprint:snapshot.source_fingerprint});assert.equal(historical.replayed,true);assert.deepEqual(historical.link.source_snapshot,snapshot);
  assert.deepEqual(await counts(f),{links:1,events:1});
 }finally{await f.close();}
});

test('clinical review: replay rejects missing request/source hashes and missing CAS rather than accepting SQL NULL',async()=>{
 const f=await createClinicalSqlFixture();try{
  await f.link();
  for(const malformed of [{fingerprint:null},{sourceFingerprint:null},{expected:null}])await assert.rejects(f.link(malformed),/document_link_invalid/);
  assert.deepEqual(await counts(f),{links:1,events:1});
 }finally{await f.close();}
});

test('clinical review: duplicate attempts stay single; a stale workspace and inactive owner cannot add a different link',async()=>{
 const f=await createClinicalSqlFixture();try{
  const results=await Promise.all([f.link(),f.link()]);assert.equal(results.filter(x=>!x.replayed).length,1);assert.equal(results.filter(x=>x.replayed).length,1);
  await assert.rejects(f.link({operation:clinicalId('8'),fingerprint:'f'.repeat(64)}),/unique constraint/);
  await f.db.exec("update app_workspaces set revision=2,state=jsonb_set(state,'{revision}','2'::jsonb)");
  await assert.rejects(f.link({operation:clinicalId('8')}),/revision_conflict/);
  await f.db.exec("update clinic_members set status='inactive'");await assert.rejects(f.link(),/workspace_access_denied/);
  assert.deepEqual(await counts(f),{links:1,events:1});
 }finally{await f.close();}
});

test('clinical review: neither browser roles nor service mutations can erase links, events or private deletion state',async()=>{
 const f=await createClinicalSqlFixture();try{
  await f.link();
  for(const role of ['anon','authenticated','service_role']){
   await f.db.exec('set role '+role);
   for(const sql of ['truncate app_workspace_document_links cascade','truncate app_workspace_document_events','delete from app_workspace_document_links','update app_workspace_document_events set created_at=now()','select * from private.fichas_exclusao_intencoes','select * from fichas_exclusao_tombstones'])await assert.rejects(f.db.exec(sql),/permission denied/);
   await f.db.exec('reset role');
  }
  await f.db.exec('set role service_role');
  await assert.rejects(f.db.query('select private.app_workspace_document_delete_guard($1,$2,$3,$4,$5)',[f.clinic,clinicalId('9'),f.session,'anamnese',f.sourceId]),/workspace_access_denied/);
  await f.db.exec('reset role');assert.deepEqual(await counts(f),{links:1,events:1});
 }finally{await f.close();}
});
