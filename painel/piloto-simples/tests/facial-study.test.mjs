import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {emptyFacialStudy,FACIAL_APPEARANCE_REGISTRY,validateFacialDocument,ensureFacialStudies,validateFacialStudies,facialStudyContext,latestFacialStudy,saveFacialStudy,assertFacialHistoryPreserved,exportFacialStudyData} from '../facial-study-domain.mjs';
import {createFacialStudyBridge,renderFacialStudy} from '../facial-study-ui.mjs';
import {validateStudy} from '../../rosto3d/v2/study.mjs';
import {viewerPolicy,assertViewerMode,assertViewerStudy} from '../../rosto3d/v2/pilot-mode.mjs';
const op=n=>`11111111-1111-4111-8111-${String(n).padStart(12,'0')}`;
const selection={patientId:'p1',visitId:'v1'},now=new Date('2026-10-15T12:30:00Z');
const fixture=()=>({patients:[{id:'p1',name:'Ana <teste>'},{id:'p2',name:'Outra'}],visits:[{id:'v1',patientId:'p1',date:'2026-10-15',status:'aberto'},{id:'v2',patientId:'p2',date:'2026-10-15',status:'aberto'}]});
const doc=()=>({...emptyFacialStudy(),points:[{id:op(99),mode:'appearance',meshId:'makehuman-head-uv-study-2',triangle:200,barycentric:[.2,.3,.5],label:'Observação',notes:'Sem inferência clínica.'}]});
const save=(state,expectedVersion=0,document=doc(),operationId=op(expectedVersion+1),selectionOverride=selection)=>saveFacialStudy(state,{...selectionOverride,expectedVersion,document,operationId},now);

test('registry and document remain compatible with exact preserved legacy topology',()=>{
  const registry=JSON.parse(readFileSync(new URL('../../rosto3d/v2/assets/point-registry.json',import.meta.url)));
  assert.deepEqual(FACIAL_APPEARANCE_REGISTRY,Object.fromEntries(Object.entries(registry).filter(([,mesh])=>mesh.mode==='appearance')));
  assert.deepEqual(validateFacialDocument(doc()),validateStudy(doc(),registry));
});
test('save, JSON roundtrip and reopen preserve exact anchors and previous versions',()=>{
  const state=fixture();ensureFacialStudies(state);const first=save(state),copy=structuredClone(first),next=doc();next.points[0].barycentric=[.4,.1,.5];next.notes='Nova nota';
  save(state,1,next);const reopened=JSON.parse(JSON.stringify(state));
  assert.equal(validateFacialStudies(reopened),true);assert.deepEqual(reopened.facialStudies[0],copy);assert.deepEqual(latestFacialStudy(reopened,selection).document,next);
  const returned=latestFacialStudy(reopened,selection);returned.document.notes='Do not mutate stored data';assert.equal(reopened.facialStudies.at(-1).document.notes,'Nova nota');
});
test('stale expected version and mismatched patient reject without mutation',()=>{
  const state=fixture();save(state);const before=structuredClone(state);
  assert.throws(()=>save(state,0,doc(),op(3)),/Outra edição/);
  assert.throws(()=>save(state,1,doc(),op(3),{patientId:'p2',visitId:'v1'}),/vínculo/);assert.deepEqual(state,before);
});
test('reassigning consultation invalidates reading and saving the old study',()=>{
  const state=fixture();save(state);state.visits[0].patientId='p2';
  assert.throws(()=>latestFacialStudy(state,selection),/vínculo/);assert.throws(()=>facialStudyContext(state,{patientId:'p2',visitId:'v1'}),/vínculo/);
});
test('completed, cancelled and locked visits remain readable but cannot acquire a new version',()=>{
  for(const changes of [{status:'concluido'},{status:'cancelado'},{lockedAt:now.toISOString()}]){
    const state=fixture();save(state);Object.assign(state.visits[0],changes);assert.equal(facialStudyContext(state,selection).readOnly,true);
    assert.equal(latestFacialStudy(state,selection).version,1);assert.throws(()=>save(state,1,doc(),op(2)),/bloqueada/);assert.equal(state.facialStudies.length,1);
  }
});
test('idempotent retry preserves the same record, even after completion; changed replay rejects',()=>{
  const state=fixture(),first=save(state);state.visits[0].status='concluido';assert.deepEqual(save(state),first);assert.equal(state.facialStudies.length,1);
  const changed=doc();changed.notes='Outra ação';assert.throws(()=>save(state,0,changed),/outro estudo/);
});
test('independent patients have independent ordered versions',()=>{
  const state=fixture();save(state);save(state,0,doc(),op(2),{patientId:'p2',visitId:'v2'});save(state,1,doc(),op(3));
  assert.equal(latestFacialStudy(state,selection).version,2);assert.equal(latestFacialStudy(state,{patientId:'p2',visitId:'v2'}).version,1);assert.equal(validateFacialStudies(state),true);
});
for(const [name,change]of [
  ['atlas',d=>d.points[0].mode='anatomy'],['unknown mesh',d=>d.points[0].meshId='__proto__'],['triangle',d=>d.points[0].triangle=153672],['NaN',d=>d.points[0].barycentric[0]=NaN],['wrong sum',d=>d.points[0].barycentric=[1,1,0]],['duplicate',d=>d.points.push({...d.points[0]})],['empty name',d=>d.points[0].label=' '],['model mismatch',d=>d.modelVersion='new-geometry']
])test(`invalid ${name} rejects without creating a collection`,()=>{const state=fixture(),value=doc();change(value);assert.throws(()=>save(state,0,value));assert.equal(state.facialStudies,undefined);});
test('aggregate UTF-8 limit rejects otherwise valid individual notes',()=>{
  const value=doc();value.points=Array.from({length:100},(_,i)=>({...value.points[0],id:op(i+500),notes:'á'.repeat(1500)}));assert.throws(()=>validateFacialDocument(value),/240 KiB/);
});
test('history cannot be rewritten, removed or appended on a previously closed visit',()=>{
  const before=fixture();save(before);const rewrite=structuredClone(before);rewrite.facialStudies[0].document.notes='Changed';assert.throws(()=>assertFacialHistoryPreserved(before,rewrite),/preservadas/);
  const deleted=structuredClone(before);deleted.facialStudies=[];assert.throws(()=>assertFacialHistoryPreserved(before,deleted),/preservadas/);
  const next=structuredClone(before);save(next,1,doc(),op(2));assert.equal(assertFacialHistoryPreserved(before,next),true);before.visits[0].status='concluido';assert.throws(()=>assertFacialHistoryPreserved(before,next),/concluída/);
});
test('backup validation rejects broken sequence, duplicate operation and orphan context',()=>{
  const state=fixture();save(state);save(state,1,doc(),op(2));
  for(const change of [s=>s.facialStudies[1].version=4,s=>s.facialStudies[1].operationId=op(1),s=>s.visits=[]]){const broken=structuredClone(state);change(broken);assert.throws(()=>validateFacialStudies(broken));}
});
test('export identifies local generic data and unsaved draft without saving it',()=>{
  const state=fixture();save(state);const draft=doc();draft.notes='Rascunho';const before=structuredClone(state),output=exportFacialStudyData(state,selection,{draft,now}),parsed=JSON.parse(output.json);
  assert.equal(parsed.modelKind,'generic-not-patient-reconstruction');assert.equal(parsed.storage,'local-browser');assert.equal(parsed.records.length,1);assert.equal(parsed.unsavedDraft.notes,'Rascunho');assert.match(output.filename,/rascunho.json$/);assert.deepEqual(state,before);
});
test('HTML escapes names and starts without iframe or unsolicited model load',()=>{
  const html=renderFacialStudy(fixture(),selection);assert.match(html,/Ana &lt;teste&gt;/);assert.doesNotMatch(html,/<iframe|<script/);assert.match(html,/não é uma reconstrução/);
});

function bridgeFixture({mutate:customMutate,capabilities}={}){
  let state=fixture(),dirty=false,busy=false,active=true,loaded=null,opNumber=100;const frame={},events=[];
  const viewer={ready:()=>true,capabilities:()=>capabilities||{storage:'local-browser',appearanceOnly:true},isBusy:()=>busy,hasChanges:()=>dirty,loadStudy(record,label,options){loaded={record,label,options};dirty=false;},unbind(){dirty=false;}};
  const mutate=customMutate?fn=>customMutate(fn,state):async fn=>{const copy=structuredClone(state);fn(copy);state=copy;};
  const bridge=createFacialStudyBridge({...selection,getState:()=>state,mutate,getFrameWindow:()=>frame,getViewer:()=>viewer,isActive:()=>active,operationId:()=>op(++opNumber),notify:(...args)=>events.push(args)});
  return {bridge,frame,viewer,state:()=>state,loaded:()=>loaded,events,dirty(v){dirty=v;},busy(v){busy=v;},active(v){active=v;}};
}
test('bridge binds exact frame and context before accepting a saved version',async()=>{
  const h=bridgeFixture();assert.equal(h.bridge.frameAttached({}),false);assert.equal(h.bridge.frameAttached(undefined),false);
  await assert.rejects(()=>h.bridge.saveStudy(h.frame,doc(),0),/carregamento/);h.bridge.frameReady(h.frame);assert.match(h.loaded().label,/Ana <teste>/);
  const saved=await h.bridge.saveStudy(h.frame,doc(),0);assert.equal(saved.version,1);assert.equal(h.state().facialStudies.length,1);assert.match(h.events.at(-1)[0],/neste navegador/);
});
test('bridge rejects inactive, stale frames and old/private viewer capabilities',async()=>{
  const h=bridgeFixture();h.bridge.frameReady(h.frame);h.active(false);await assert.rejects(()=>h.bridge.saveStudy(h.frame,doc(),0),/ativo/);h.active(true);
  await assert.rejects(()=>h.bridge.saveStudy({},doc(),0),/ativo/);const old=bridgeFixture({capabilities:{storage:'legacy-private',appearanceOnly:false}});assert.throws(()=>old.bridge.frameReady(old.frame),/compatível/);
});
test('duplicate ready notification preserves dirty notes; explicit discard allows fresh binding',()=>{
  const h=bridgeFixture();h.bridge.frameReady(h.frame);h.dirty(true);const loaded=h.loaded();h.bridge.frameReady(h.frame);assert.equal(h.bridge.isDirty(),true);assert.equal(h.loaded(),loaded);
  assert.equal(h.bridge.discard(),true);h.bridge.frameReady(h.frame);assert.equal(h.bridge.isDirty(),false);assert.notEqual(h.loaded(),loaded);
});
test('bridge keeps dirty draft after failed persistence and reuses the idempotent operation on retry',async()=>{
  const operations=[];let fail=true;const h=bridgeFixture({mutate:async(fn,state)=>{const copy=structuredClone(state);fn(copy);operations.push(copy.facialStudies.at(-1).operationId);if(fail)throw Error('Falha de disco');Object.assign(state,copy);}});
  h.bridge.frameReady(h.frame);h.dirty(true);await assert.rejects(()=>h.bridge.saveStudy(h.frame,doc(),0),/disco/);assert.equal(h.bridge.isDirty(),true);assert.equal(h.bridge.isBusy(),false);
  fail=false;await h.bridge.saveStudy(h.frame,doc(),0);assert.equal(operations[0],operations[1]);
});
test('busy blocks a second save, discard and reload; dispose invalidates old frame',async()=>{
  let release;const h=bridgeFixture({mutate:async(fn,state)=>{await new Promise(resolve=>release=resolve);fn(state);}});h.bridge.frameReady(h.frame);
  const pending=h.bridge.saveStudy(h.frame,doc(),0);assert.equal(h.bridge.isBusy(),true);assert.equal(h.bridge.discard(),false);assert.throws(()=>h.bridge.reload(),/Aguarde/);
  await assert.rejects(()=>h.bridge.saveStudy(h.frame,doc(),0),/Aguarde/);h.bridge.dispose();release();await assert.rejects(()=>pending,/fechada/);assert.equal(h.bridge.frameAttached(h.frame),false);assert.equal(h.state().facialStudies,undefined);
});
test('completed consultation is passed read-only and save is independently rejected',async()=>{
  const h=bridgeFixture();h.state().visits[0].status='concluido';h.bridge.frameReady(h.frame);assert.equal(h.loaded().options.readOnly,true);await assert.rejects(()=>h.bridge.saveStudy(h.frame,doc(),0),/bloqueada/);
});
test('opt-in local mode blocks atlas in mode switch and loaded document, legacy remains unchanged',()=>{
  const local=viewerPolicy('?mode=local-pilot'),legacy=viewerPolicy('');assert.equal(local.appearanceOnly,true);assert.equal(legacy.local,false);
  assert.throws(()=>assertViewerMode('anatomy',local),/externo/);assert.equal(assertViewerMode('anatomy',legacy),'anatomy');const study={document:doc()};study.document.points[0].mode='anatomy';assert.throws(()=>assertViewerStudy(study,local),/camadas/);assert.equal(assertViewerStudy(study,legacy),study);
});
