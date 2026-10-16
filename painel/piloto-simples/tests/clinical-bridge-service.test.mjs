import test from 'node:test';
import assert from 'node:assert/strict';
import {createClinicalBridgeService} from '../clinical-bridge-service.mjs';
import {PUBLIC_BACKEND} from '../integration/public-backend.mjs';
const clinic='11111111-1111-4111-8111-111111111111';
const authenticated=(extra={})=>({ok:true,auth_method:'supabase_auth',role:'owner',clinic_id:clinic,...extra});
function session(){let closed=false,reason=null;const listeners=new Set();return{get reason(){return reason;},requireReady:async()=>{if(closed)throw Error('closed');return{token:'synthetic',userId:'user',revision:1};},assertCurrent:async()=>{if(closed)throw Error('closed');},subscribe:f=>{listeners.add(f);return()=>listeners.delete(f);},invalidate:r=>{closed=true;reason=r;for(const f of listeners)f();}};}
test('transporte usa somente endpoints fixos, sessão individual e nenhum cookie/cache/referrer',async t=>{
 const calls=[],s=session(),service=createClinicalBridgeService({session:s,fetchImpl:async(url,options)=>{calls.push({url,options});return Response.json(authenticated({documents:[]}));}});t.after(()=>service.dispose());
 await service.listDocuments({patient_id:'patient',visit_id:'visit',search:' Teste ',limit:25,offset:0});
 assert.equal(calls[0].url,PUBLIC_BACKEND.supabaseUrl+'/functions/v1/app-workspace');assert.equal(calls[0].options.headers.Authorization,'Bearer synthetic');
 assert.equal(calls[0].options.credentials,'omit');assert.equal(calls[0].options.cache,'no-store');assert.equal(calls[0].options.referrerPolicy,'no-referrer');assert.equal(calls[0].options.redirect,'error');
 assert.deepEqual(JSON.parse(calls[0].options.body),{patient_id:'patient',visit_id:'visit',search:'Teste',limit:25,offset:0,acao:'listar_documentos_originais'});
 assert.throws(()=>service.listDocuments({acao:'vincular_documento'}),/filtros/);assert.throws(()=>service.listDocuments({patient_id:'patient'}),/consulta/);assert.throws(()=>service.listSiteRequests({status:'confirmed'}),/filtro/);assert.equal(calls.length,1);
});
test('contrato CRM existente é aceito sem inventar clinic_id/ok e continua somente leitura',async t=>{
 const calls=[],service=createClinicalBridgeService({session:session(),fetchImpl:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return Response.json({auth_method:'supabase_auth',role:'owner',solicitacoes_site:[],paginacao:{limit:25,offset:0,has_more:false}});}});t.after(()=>service.dispose());
 const result=await service.listSiteRequests({status:'accepted'});assert.equal(result.clinic_id,undefined);assert.equal(calls[0].url.endsWith('/crm-fichas'),true);assert.equal(calls[0].body.acao,'listar_solicitacoes_site');assert.equal(service.acceptSiteRequest,undefined);
});
test('401/403 em HTML encerra acesso antes de decodificar e impede outra chamada',async()=>{
 for(const status of [401,403]){let calls=0;const s=session(),service=createClinicalBridgeService({session:s,fetchImpl:async()=>{calls++;return new Response('<html>denied</html>',{status});}});
 await assert.rejects(service.listDocuments(),e=>e.code==='access_denied');assert.equal(s.reason,`http_${status}`);await assert.rejects(service.listDocuments(),e=>e.code==='session_closed');assert.equal(calls,1);service.dispose();}
});
test('troca de clínica e resposta com autenticação incompatível não chegam à UI',async()=>{
 for(const replacement of [authenticated({clinic_id:'99999999-9999-4999-8999-999999999999'}),authenticated({role:'professional'}),authenticated({ok:undefined})]){let count=0;const s=session(),service=createClinicalBridgeService({session:s,fetchImpl:async()=>Response.json(count++?replacement:authenticated())});
 await service.listDocuments();await assert.rejects(service.listDocuments());assert.ok(s.reason);service.dispose();}
});
test('filtros são capturados antes de autenticação assíncrona e falha não tem fallback',async t=>{
 let ready;const wait=new Promise(r=>{ready=r;}),s=session(),calls=[];s.requireReady=async()=>{await wait;return{token:'synthetic'};};
 const service=createClinicalBridgeService({session:s,fetchImpl:async(url,options)=>{calls.push(JSON.parse(options.body));return Response.json({erro:'not installed'},{status:422});}});t.after(()=>service.dispose());
 const input={patient_id:'patient',visit_id:'visit'},promise=service.listDocuments(input);input.patient_id='other';ready();await assert.rejects(promise);assert.equal(calls[0].patient_id,'patient');assert.equal(calls.length,1);
});

const linkSelection=()=>({expected_revision:7,patient_id:'patient',visit_id:'visit',source_kind:'anamnese',source_id:'44444444-4444-4444-8444-444444444444',expected_source_fingerprint:'a'.repeat(64),confirmed_identity:true,reason:'Identidade fictícia conferida'});
const operation='66666666-6666-4666-8666-666666666666';
function linkedReceipt(p){return authenticated({link:{id:p.operation_id,patient_id:p.patient_id,visit_id:p.visit_id,source_kind:p.source_kind,source_id:p.source_id,source_fingerprint:p.expected_source_fingerprint,status:'vinculado_recebido',clinical_authorization:false},workspace_revision:p.expected_revision,operation:{id:p.operation_id,kind:'document_link',status:'committed'}});}

test('408 e 429 após envio mantêm UUID/corpo e somente retry idêntico pode confirmar',async t=>{
 for(const status of [408,429]){
  const calls=[],service=createClinicalBridgeService({session:session(),uuidFactory:()=>operation,fetchImpl:async(url,opts)=>{const p=JSON.parse(opts.body);calls.push(p);return calls.length===1?Response.json({message:'Gateway did not confirm the upstream transaction'},{status}):Response.json(linkedReceipt(p));}});t.after(()=>service.dispose());
  await assert.rejects(service.linkDocument(linkSelection()),e=>e.status===status&&e.uncertain===true);
  const retained=service.getPendingLink();assert.equal(retained.rejected,false);assert.equal(retained.payload.operation_id,operation);
  assert.throws(()=>service.discardRejectedLink(),e=>e.code==='pending_link');assert.throws(()=>service.linkDocument(linkSelection()),e=>e.code==='pending_link');
  const recovered=await service.retryLink();assert.equal(recovered.operation.id,operation);assert.deepEqual(calls[1],calls[0]);assert.equal(service.getPendingLink(),null);
 }
});

test('envelope/código/status desconhecidos não liberam operação; consulta de status recupera recebimento exato',async t=>{
 const cases=[{status:409,body:{message:'gateway conflict'}},{status:422,body:{ok:false,codigo:'unrecognized_rejection'}},{status:404,body:{codigo:'document_not_found'}},{status:408,body:{ok:false,codigo:'revision_conflict'}}];
 for(const entry of cases){
  let submitted;const calls=[],service=createClinicalBridgeService({session:session(),uuidFactory:()=>operation,fetchImpl:async(url,opts)=>{const p=JSON.parse(opts.body);calls.push(p);if(p.acao==='vincular_documento'){submitted=p;return Response.json(entry.body,{status:entry.status});}const r=linkedReceipt(submitted);return Response.json(authenticated({operation:{...r.operation,result:{link:r.link,workspace_revision:r.workspace_revision}}}));}});t.after(()=>service.dispose());
  await assert.rejects(service.linkDocument(linkSelection()),e=>e.uncertain===true);assert.equal(service.getPendingLink().rejected,false);assert.throws(()=>service.discardRejectedLink(),e=>e.code==='pending_link');
  await service.resolveLink();assert.equal(service.getPendingLink(),null);assert.deepEqual(calls.map(p=>p.acao),['vincular_documento','status_vinculo_documento']);assert.equal(calls[1].operation_id,operation);
 }
});

test('recusas conhecidas do backend preservam seleção e permitem descarte explícito após revisão',async t=>{
 for(const [status,codigo] of [[409,'revision_conflict'],[409,'document_source_changed'],[409,'document_deletion_in_progress'],[422,'document_identity_mismatch'],[422,'identity_cpf_mismatch'],[404,'document_source_missing'],[413,'body_too_large']]){
  const service=createClinicalBridgeService({session:session(),uuidFactory:()=>operation,fetchImpl:async()=>Response.json({ok:false,codigo,erro:'Known backend rejection'},{status})});t.after(()=>service.dispose());
  await assert.rejects(service.linkDocument(linkSelection()),e=>e.status===status&&e.uncertain===false);const pending=service.getPendingLink();assert.equal(pending.rejected,true);assert.equal(pending.payload.reason,linkSelection().reason);assert.equal(pending.payload.operation_id,operation);
  await assert.rejects(service.retryLink(),e=>e.code==='no_pending_link');service.discardRejectedLink();assert.equal(service.getPendingLink(),null);
 }
});

test('leitura distingue PDF indisponível, integridade e alteração sem mostrar texto privado do servidor',async t=>{
 for(const [status,codigo,expected] of [[409,'document_not_ready',/não tem um PDF disponível/],[409,'document_source_changed',/alterado desde a consulta/],[409,'document_integrity_invalid',/conferência de integridade/],[422,'document_integrity_invalid',/conferência de integridade/],[404,'document_file_missing',/não foi encontrado/]]){
  const s=session(),service=createClinicalBridgeService({session:s,fetchImpl:async()=>Response.json({ok:false,codigo,erro:'PRIVATE PATH /secret.pdf'},{status})});t.after(()=>service.dispose());
  await assert.rejects(service.openDocument({source_kind:'anamnese',source_id:linkSelection().source_id,expected_source_fingerprint:'a'.repeat(64)}),e=>{assert.equal(e.code,codigo);assert.match(e.message,expected);assert.doesNotMatch(e.message,/PRIVATE|secret/);assert.equal(e.uncertain,false);return true;});assert.equal(s.reason,null);assert.equal(service.getPendingLink(),null);
 }
});
