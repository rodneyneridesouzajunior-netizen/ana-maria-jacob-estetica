import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspaceHandler} from './handler.mjs';
import {createRepository} from './repository.mjs';
import {historicalPDFPath} from './clinical-document-access.mjs';
import {hash} from './rules.mjs';
import {createClinicalBridgeService} from '../../../painel/piloto-simples/clinical-bridge-service.mjs';
import {PUBLIC_BACKEND} from '../../../painel/piloto-simples/integration/public-backend.mjs';

const uuid=n=>`${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;
const actor={authMethod:'supabase_auth',role:'owner',aal:'aal2',clinicId:uuid('1'),userId:uuid('2'),sessionId:uuid('3')};
const pdf=new TextEncoder().encode('%PDF-1.4\nSynthetic historical record\n%%EOF');
const original=()=>({source_kind:'anamnese',source_id:uuid('4'),type:'anamnese',status:'legado',source_version:null,source_hash:null,signature_sha256:null,pdf_sha256:null,registry_sha256:null,source_fingerprint:'a'.repeat(64),received_at:'2026-08-01T12:00:00Z',identity:{name:'Paciente Fictícia',cpf:'52998224725'},archived:false,withdrawn:false,bucket:'fichas-pdf',pdf_path:'historico-ficticio-12345678.pdf',signature_path:null,storage_valid:false});
function fixture(t,options={}){
 const current={...original(),...options.source},calls=[],sent=[];let invalidated=false;
 const repository=createRepository({supabaseUrl:PUBLIC_BACKEND.supabaseUrl,serviceRoleKey:'synthetic-only',fetchImpl:async(url,opts={})=>{
  const path=new URL(url).pathname;calls.push({path,method:opts.method||'GET'});
  if(path.startsWith('/rest/v1/rpc/')){const args=JSON.parse(opts.body);assert.equal(args.p_clinic,actor.clinicId);assert.equal(args.p_actor,actor.userId);assert.equal(args.p_session,actor.sessionId);
   if(path.endsWith('/app_workspace_documents_list'))return Response.json([current]);
   if(path.endsWith('/app_workspace_document_source')){assert.equal(args.p_kind,'anamnese');assert.equal(args.p_id,uuid('4'));return Response.json(options.missing?null:current);}
   if(path.endsWith('/app_workspace_document_operation'))return Response.json(null);
  }
  if(path.startsWith('/rest/v1/app_workspaces?')||path==='/rest/v1/app_workspaces')return Response.json([{revision:6,state:{patients:[{id:'patient',name:'Paciente Fictícia',cpf:'52998224725'}],visits:[{id:'visit',patientId:'patient',status:'rascunho'}]}}]);
  if(path==='/storage/v1/object/fichas-pdf/'+encodeURIComponent(current.pdf_path))return options.fileResponse?options.fileResponse():new Response(pdf);
  if(path==='/storage/v1/object/sign/fichas-pdf/'+encodeURIComponent(current.pdf_path)){assert.deepEqual(JSON.parse(opts.body),{expiresIn:120});return Response.json({signedURL:options.signedURL||'/object/sign/fichas-pdf/'+encodeURIComponent(current.pdf_path)+'?token=synthetic-only'});}
  assert.fail('Unexpected backend operation: '+path);
 }});
 const handler=createWorkspaceHandler({repository,authenticate:async()=>({...actor,...options.actor}),authorize:async()=>{}});
 const session={requireReady:async()=>({token:'synthetic-session'}),assertCurrent:async()=>{},subscribe:()=>()=>{},invalidate:()=>{invalidated=true;}};
 const service=createClinicalBridgeService({session,fetchImpl:async(url,opts)=>{sent.push(JSON.parse(opts.body));return handler(new Request(url,opts));}});
 t.after(()=>service.dispose());
 const open=()=>service.openDocument({source_kind:'anamnese',source_id:uuid('4'),expected_source_fingerprint:'a'.repeat(64)});
 return {current,calls,sent,open,service,repository,get invalidated(){return invalidated;}};
}

test('historical PDF: real client/handler/repository opens exact legacy object without promoting receipt or changing records',async t=>{
 const f=fixture(t),before=JSON.stringify(f.current),list=await f.service.listDocuments(),d=list.documents[0];
 assert.equal(d.status,'legado');assert.equal(d.pdf_access,'historical');assert.equal(d.pdf_sha256,null);assert.equal(d.eligible_for_link,false);assert.equal(d.clinical_authorization,false);
 const opened=await f.open();assert.equal(opened.document.source_fingerprint,d.source_fingerprint);assert.equal(opened.document.pdf_sha256,null);assert.equal(opened.pdf.sha256,await hash(pdf));assert.equal(opened.pdf.integrity,'historical_file_only');assert.equal(opened.pdf.expires_in,120);
 assert.equal(JSON.stringify(f.current),before);assert.equal(f.invalidated,false);
 assert.deepEqual(f.calls.map(c=>c.path),['/rest/v1/rpc/app_workspace_documents_list','/rest/v1/rpc/app_workspace_document_source','/storage/v1/object/fichas-pdf/historico-ficticio-12345678.pdf','/storage/v1/object/sign/fichas-pdf/historico-ficticio-12345678.pdf']);
 assert.deepEqual(f.sent.map(p=>p.acao),['listar_documentos_originais','obter_documento_original']);
 await assert.rejects(f.service.linkDocument({expected_revision:6,patient_id:'patient',visit_id:'visit',source_kind:'anamnese',source_id:uuid('4'),expected_source_fingerprint:'a'.repeat(64),confirmed_identity:true,reason:'Revisão fictícia'}),e=>e.status===422&&e.uncertain===false);
 assert.equal(f.calls.some(c=>c.path.endsWith('/app_workspace_link_document')),false);
});

test('historical PDF: changed metadata, other source and unauthorized session never read or sign a file',async t=>{
 for(const options of [{source:{source_fingerprint:'b'.repeat(64)}},{missing:true},{actor:{aal:'aal1'}},{actor:{role:'professional'}}]){
  const f=fixture(t,options);await assert.rejects(f.open());assert.equal(f.calls.some(c=>c.path.startsWith('/storage/')),false);
 }
});

test('historical PDF: only exact root PDF from legacy anamnese is permitted; no modern-read downgrade',async t=>{
 for(const patch of [{pdf_path:'../other.pdf'},{pdf_path:'a/b.pdf'},{pdf_path:'a\\b.pdf'},{pdf_path:'%2e%2e.pdf'},{pdf_path:'other.pdf?x'},{pdf_path:'a\0.pdf'},{pdf_path:' a.pdf'},{bucket:'documentos-clinicos'},{source_kind:'documento_clinico'},{status:'recebido'}]){
  assert.equal(historicalPDFPath({...original(),...patch}),null);
 }
 const modern=fixture(t,{source:{status:'recebido'}});await assert.rejects(modern.open(),e=>e.code==='document_not_ready');assert.equal(modern.calls.some(c=>c.path.startsWith('/storage/')),false);
});

test('historical PDF: missing/invalid/oversized files and mismatching stored hash cannot get a signed URL',async t=>{
 const cases=[{fileResponse:()=>new Response(null,{status:404}),code:'document_file_missing'},{fileResponse:()=>new Response('<html>not a PDF</html>'),code:'document_integrity_invalid'},{fileResponse:()=>new Response(pdf,{headers:{'Content-Length':'6000000'}})},{fileResponse:()=>new Response(new Uint8Array(5*1024*1024+1))},{source:{pdf_sha256:'f'.repeat(64)},code:'document_integrity_invalid'}];
 for(const options of cases){const f=fixture(t,options);await assert.rejects(f.open(),e=>!options.code||e.code===options.code);assert.equal(f.calls.some(c=>c.path.includes('/object/sign/')),false);assert.equal(f.invalidated,false);}
});

test('historical PDF: foreign signed URL is rejected and reported without private server details',async t=>{
 const f=fixture(t,{signedURL:'https://foreign.invalid/file.pdf'});await assert.rejects(f.open(),e=>e.status===503&&!e.message.includes('foreign.invalid'));assert.equal(f.invalidated,false);
});
