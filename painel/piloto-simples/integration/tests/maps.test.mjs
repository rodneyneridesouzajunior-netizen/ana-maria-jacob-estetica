import test from 'node:test';
import assert from 'node:assert/strict';
import {createClinicIntegration} from '../adapter.mjs';
const id=n=>`${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const protocol=id(1),photo=id(2),patient=id(3),operation=id(4);
const binding={clinic_id:id(5),patient_id:patient,protocol_id:protocol,protocol_version:2,photo_id:photo,photo_revision:'a'.repeat(32)};
const v1={schemaVersion:1,points:[{id:'a',x:.1,y:.2,label:'Manual',notes:'Manter'}],notes:''};
const v2={schemaVersion:2,points:[{id:'a',kind:'leque',x:.1,y:.2,x2:.5,y2:.7,region:'Manual',product:'Produto',quantity:1.25,unit:'mL',lot:'L-1',notes:'Manter'}],notes:''};
const payload=document=>({protocolo_id:protocol,foto_id:photo,expected_patient_id:patient,expected_protocol_version:2,expected_photo_revision:binding.photo_revision,expected_version:0,operation_id:operation,document,motivo:'Registro manual'});
function harness({versions,fetchResponse}={}){
 let session={access_token:'test-only',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:id(6)}},calls=[];
 const auth={getSession:async()=>session,getNextStep:async()=>({step:session?'ready':'login',aal:{currentLevel:'aal2'},session}),signOut:async()=>{session=null;}};
 const api=createClinicIntegration({config:{writesEnabled:true},origin:'http://127.0.0.1:8765',authController:auth,fetchImpl:async(url,options)=>{
  const body=JSON.parse(options.body);calls.push(body);
  const response=fetchResponse?.(body)??{binding,annotation:body.acao==='abrir'?null:{id:operation,version:1,document:body.document},...(versions?{capabilities:{document_versions:versions}}:{})};
  return new Response(JSON.stringify({ok:true,auth_method:'supabase_auth',role:'owner',...response}),{status:200});
 }});return {api,calls};
}
test('deployed v1 defaults are explicit; v2 cannot be silently downgraded or sent',async t=>{
 const h=harness();t.after(()=>h.api.dispose());await h.api.maps.open(protocol,photo);await assert.rejects(h.api.maps.save(payload(v2)),{code:'map_version_not_deployed'});assert.equal(h.calls.length,1);
 const saved=await h.api.maps.save(payload(v1));assert.deepEqual(saved.annotation.document,v1);assert.equal(h.calls.length,2);
});
test('v2 capability preserves fan endpoint, quantity and metadata on wire',async t=>{
 const h=harness({versions:[1,2]});t.after(()=>h.api.dispose());await h.api.maps.open(protocol,photo);await h.api.maps.save(payload(v2));assert.deepEqual(h.calls[1].document,v2);assert.equal(h.calls[1].expected_photo_revision,binding.photo_revision);
});
test('save requires prior authenticated open and exact patient/photo/protocol version binding',async t=>{
 const h=harness({versions:[1,2]});t.after(()=>h.api.dispose());await assert.rejects(h.api.maps.save(payload(v2)),{code:'map_open_required'});await h.api.maps.open(protocol,photo);
 for(const extra of [{expected_patient_id:id(9)},{expected_version:1},{expected_protocol_version:3},{expected_photo_revision:'b'.repeat(32)}])await assert.rejects(h.api.maps.save({...payload(v2),...extra}),{code:'map_context_mismatch'});
 assert.equal(h.calls.length,1);
});
test('another photo returned by server cannot establish map context',async t=>{
 const h=harness({fetchResponse:()=>({binding:{...binding,photo_id:id(8)},annotation:null})});t.after(()=>h.api.dispose());await assert.rejects(h.api.maps.open(protocol,photo),{code:'map_context_mismatch'});
});
test('session invalidation removes open map context before another save',async t=>{
 const h=harness({versions:[1,2]});t.after(()=>h.api.dispose());await h.api.maps.open(protocol,photo);await h.api.session.signOut();await assert.rejects(h.api.maps.save(payload(v2)),{code:'map_open_required'});assert.equal(h.calls.length,1);
});
test('unknown fields in source documents are rejected without a save request',async t=>{
 const h=harness({versions:[1,2]});t.after(()=>h.api.dispose());await h.api.maps.open(protocol,photo);await assert.rejects(h.api.maps.save(payload({...v2,unknown:'preserve'})));assert.equal(h.calls.length,1);
});
test('unexpected successful save response is uncertain and invalidates context instead of claiming success',async t=>{
 const h=harness({versions:[1,2],fetchResponse:body=>body.acao==='abrir'?{binding,annotation:null,capabilities:{document_versions:[1,2]}}:{binding,annotation:{id:operation,version:1,document:{...v2,notes:'Different'}}}});t.after(()=>h.api.dispose());
 await h.api.maps.open(protocol,photo);await assert.rejects(h.api.maps.save(payload(v2)),error=>error.code==='map_save_unconfirmed'&&error.uncertain);await assert.rejects(h.api.maps.save(payload(v2)),{code:'map_open_required'});
});
