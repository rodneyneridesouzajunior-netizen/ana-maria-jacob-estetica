import {test,before,after} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {createRequire} from 'node:module';
import {createRepository} from '../functions/app-workspace/repository.mjs';import {createWorkspaceHandler} from '../functions/app-workspace/handler.mjs';import {createPublicDocumentHandler} from '../functions/documento-paciente/handler.mjs';import {createPDFRenderer,PDF_ASSETS,wrapPDFLines} from '../functions/documento-paciente/pdf.mjs';import {capability,digest,validateSubmission,CustomDocumentError,issueSnapshot,signatureStrokes,requireAdultBirthDate} from '../functions/_shared/custom-documents.mjs';
const require=createRequire(import.meta.url),runtime=createRequire('C:/Users/rotan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json'),{PDFDocument,rgb}=runtime('pdf-lib'),fontkit=require('../../skinpro-analise/revisoes/codigo-provas/custom-docs-pdf/package/dist/fontkit.umd.js'),{PGlite}=require('../../skinpro-analise/revisoes/codigo-provas/map2d-sql/node_modules/@electric-sql/pglite');
const db=new PGlite(),root=new URL('../../',import.meta.url),clinic=crypto.randomUUID(),actor=crypto.randomUUID(),session=crypto.randomUUID(),secret='SYNTHETIC TEST SECRET ONLY',ctx={authMethod:'supabase_auth',role:'owner',aal:'aal2',clinicId:clinic,userId:actor,sessionId:session};
const state={schema:1,revision:1,patients:[{id:'test-patient',name:'TESTE Marina Exemplo',cpf:'52998224725',birthDate:'1990-01-01',phone:'31999990000'}],visits:[{id:'test-visit',patientId:'test-patient',status:'rascunho'}],documentResponses:[]};
const snapshot={version:1,editorVersion:2,title:'Termo TESTE',body:'Este documento utiliza dados fictícios. Riscos, direitos e dúvidas permanecem no texto.',questions:[{id:'informada',label:'Recebeu explicações?',type:'yesno',required:true},{id:'detalhe',label:'Explique a dúvida',type:'text',required:true,condition:{questionId:'informada',value:'Não'}}],publishedAt:'2026-10-16T12:00:00Z'};
let storage=new Map(),uploadFailures=0,finishLost=false,renderCalls=0,assets;
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const sql=async(name,args)=>{const entries=Object.entries(args),q=`select public.${name}(${entries.map(([k],i)=>`${k}=>$${i+1}`).join(',')}) as result`;return(await db.query(q,entries.map(([,v])=>v))).rows[0].result;};
async function mockFetch(input,init={}){
 const url=new URL(input),path=url.pathname;
 if(path.startsWith('/rest/v1/rpc/')){const name=path.split('/').at(-1);try{const result=await sql(name,JSON.parse(init.body));if(name==='app_custom_document_finish'&&finishLost){finishLost=false;return json({message:'lost'},503);}return json(result);}catch(e){return json({message:e.message,code:e.code},400);}}
 if(path==='/rest/v1/app_workspaces')return json((await db.query('select * from app_workspaces where clinic_id=$1',[url.searchParams.get('clinic_id').slice(3)])).rows);
 const prefix='/storage/v1/object/',key=decodeURIComponent(path.slice(prefix.length));
 if(path.startsWith(prefix+'sign/'))return json({signedURL:'/object/sign/'+path.slice((prefix+'sign/').length)+'?token=synthetic'});
 if(path.startsWith(prefix)){
  if(init.method==='POST'){assert.equal(init.headers['x-upsert'],'false');if(uploadFailures-->0)return json({},503);if(storage.has(key))return json({},409);storage.set(key,new Uint8Array(init.body));return json({});}
  return storage.has(key)?new Response(storage.get(key)):json({},404);
 }throw Error('unexpected '+path);
}
const repository=createRepository({supabaseUrl:'https://test.supabase.co',serviceRoleKey:secret,fetchImpl:mockFetch}),privateHandler=createWorkspaceHandler({authenticate:async()=>ctx,authorize:async()=>{},repository}),rawRenderer=createPDFRenderer({PDFDocument,rgb,fontkit,assets:null,fetchImpl:async url=>new Response(url===PDF_ASSETS.font.url?assets.font:assets.logo)}),publicHandler=createPublicDocumentHandler({repository,renderPDF:Object.assign(async(...a)=>{renderCalls++;return rawRenderer(...a);},{validate:(...a)=>rawRenderer.validate(...a)}),rateLimit:async()=>({allowed:true})});
const req=body=>new Request('https://test/functions/v1/test',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://anamariajacob.com.br'},body:JSON.stringify(body)}),send=async(fn,p)=>{const r=await fn(req(p));return{...await r.json(),status:r.status};};
async function saveState(){await db.query('update app_workspaces set state=$1 where clinic_id=$2',[state,clinic]);}
async function emit(kind='termo'){
 const document={id:'doc-'+crypto.randomUUID(),patientId:'test-patient',visitId:'test-visit',templateId:'template-'+kind,templateVersion:1,kind,status:'rascunho',snapshot:structuredClone(snapshot),answers:{}};state.documentResponses.push(document);await saveState();
 const operation_id=crypto.randomUUID(),p={acao:'emitir_documento_paciente',document_id:document.id,expected_revision:1,operation_id};const result=await send(privateHandler,p);assert.equal(result.status,200,JSON.stringify(result));const token=new URL(result.issue.public_url).hash.slice(7);return{document,p,issue:result.issue,token};
}
async function signPayload(e,extra={}){const opened=await send(publicHandler,{acao:'abrir',token:e.token});assert.equal(opened.status,200);return{acao:'assinar',token:e.token,operation_id:crypto.randomUUID(),snapshot_hash:opened.snapshot_hash,confirmation_version:opened.confirmation.version,answers:{informada:'Sim',detalhe:'This hidden answer must not persist'},signer_name:'TESTE Marina Exemplo',signature_strokes:[[{x:.1,y:.2},{x:.7,y:.5}]],confirmed:true,...extra};}
before(async()=>{
 assets={font:new Uint8Array(await readFile(new URL('assets/amj-poppins-20261015.ttf',root))),logo:new Uint8Array(await readFile(new URL('assets/identidade-visual-transparente-v1.png',root)))};
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid);create table clinics(id uuid primary key);create table clinic_members(clinic_id uuid,user_id uuid,role text,status text);create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(bucket_id text);alter table storage.objects enable row level security;create function clinic_validate_auth_session(p_user_id uuid,p_session_id uuid) returns boolean language sql as $$select exists(select 1 from auth.sessions where id=p_session_id and user_id=p_user_id)$$;grant usage on schema public,auth to service_role;grant select on clinic_members,auth.sessions to service_role;grant execute on function clinic_validate_auth_session(uuid,uuid) to service_role;`);
 await db.query('insert into clinics values($1)',[clinic]);await db.query('insert into auth.users values($1)',[actor]);await db.query('insert into auth.sessions values($1,$2)',[session,actor]);await db.query("insert into clinic_members values($1,$2,'owner','active')",[clinic,actor]);
 await db.exec(await readFile(new URL('supabase/migrations/20261015220006_app_workspace_private_cas.sql',root),'utf8'));
 const legacy=await readFile(new URL('supabase/migrations/20261015224148_app_workspace_clinical_document_links.sql',root),'utf8');await db.exec(legacy.slice(legacy.indexOf('create function public.app_workspace_document_cpf'),legacy.indexOf('-- Narrow privileged guard')));
 await db.exec(await readFile(new URL('supabase/migrations/20261016010000_app_custom_documents.sql',root),'utf8'));
 await db.query('insert into app_workspaces(clinic_id,revision,state,state_hash,updated_by) values($1,1,$2,$3,$4)',[clinic,state,'a'.repeat(64),actor]);
});after(()=>db.close());
test('SQL RLS/private bucket/direct table immutability and forbidden browser RPC',async()=>{
 const r=(await db.query("select has_table_privilege('anon','app_custom_document_issues','SELECT') a,has_table_privilege('authenticated','app_custom_document_receipts','INSERT') b,has_table_privilege('service_role','app_custom_document_receipts','UPDATE') c,has_table_privilege('service_role','app_custom_document_issues','UPDATE') d,has_function_privilege('service_role','app_custom_document_row(uuid)','EXECUTE') e,has_function_privilege('authenticated','app_custom_document_public(uuid,text)','EXECUTE') f,(select public from storage.buckets where id='app-custom-documents') g")).rows[0];assert.deepEqual(r,{a:false,b:false,c:false,d:false,e:false,f:false,g:false});
 await db.exec('set role authenticated');try{await assert.rejects(sql('app_custom_document_public',{p_id:crypto.randomUUID(),p_token_hash:'a'.repeat(64)}),/permission denied/);}finally{await db.exec('reset role');}
});
test('MFA, actor/session and clinic boundaries are required to issue/list',async()=>{
 for(const change of [{aal:'aal1'},{role:'professional'},{authMethod:'legacy'}]){const h=createWorkspaceHandler({authenticate:async()=>({...ctx,...change}),authorize:async()=>{},repository});assert.equal((await send(h,{acao:'listar_emissoes_documento',document_id:'x'})).status,403);}
 await assert.rejects(repository.customIssues({p_clinic:clinic,p_actor:actor,p_session:crypto.randomUUID(),p_document:'x'}),e=>e.code==='workspace_access_denied');await assert.rejects(repository.customIssues({p_clinic:crypto.randomUUID(),p_actor:actor,p_session:session,p_document:'x'}),e=>e.code==='workspace_access_denied');
});
test('issuance reports missing CPF before reaching SQL, preserving optional CPF in registration',async()=>{
 const document={id:'doc-cpf-required',patientId:'test-patient',visitId:'test-visit',templateId:'template-termo',templateVersion:1,kind:'termo',status:'rascunho',snapshot:structuredClone(snapshot),answers:{}};
 state.documentResponses.push(document);const original=state.patients[0].cpf;
 try {
  for(const value of ['',undefined,'   ','11111111111']){
   state.patients[0].cpf=value;await saveState();
   const result=await send(privateHandler,{acao:'emitir_documento_paciente',document_id:document.id,expected_revision:1,operation_id:crypto.randomUUID()});
   assert.equal(result.status,422);assert.equal(result.codigo,'custom_identity_required');
  }
  assert.equal((await db.query('select count(*)::int n from app_custom_document_issues where document_id=$1',[document.id])).rows[0].n,0);
 }finally{state.patients[0].cpf=original;await saveState();}
});
test('issuance uses persisted snapshot, preserves version and reopens same capability across SQL timestamp normalization',async()=>{
 const e=await emit();const repeated=await send(privateHandler,e.p);assert.equal(repeated.issue.public_url,e.issue.public_url);assert.equal((await send(privateHandler,{...e.p,expires_in_days:8})).status,409);
 const opened=await send(publicHandler,{acao:'abrir',token:e.token});assert.equal(opened.document.patientName,state.patients[0].name);assert.deepEqual(opened.document.snapshot,e.document.snapshot);assert.equal(opened.document.patientId,undefined);assert.equal(JSON.stringify(opened).includes('52998224725'),false);assert.equal(opened.confirmation.general_data_text,undefined);
 e.document.snapshot.body='EDITED AFTER EMISSION';await saveState();assert.equal((await send(publicHandler,{acao:'abrir',token:e.token})).document.snapshot.body,snapshot.body);
 assert.equal((await send(privateHandler,{...e.p,operation_id:crypto.randomUUID()})).codigo,'custom_active_issue_exists');
});
test('required decisions/answers/name/signature are validated without accepting hidden answers or invented general consent',async()=>{
 const e=await emit(),p=await signPayload(e);
 for(const change of [{confirmed:false},{signer_name:'Outra pessoa'},{snapshot_hash:'f'.repeat(64)},{confirmation_version:'future'},{answers:{}},{answers:{informada:'Não'}},{answers:{informada:'Sim',unknown:'yes'}},{signature_strokes:[]},{signature_strokes:[[{x:0,y:0},{x:2,y:0}]]},{general_data_consent:true},{image_use:'publicacao'}]){const r=await send(publicHandler,{...p,...change});assert.notEqual(r.status,200,JSON.stringify(change));}
 const count=(await db.query('select count(*)::int n from app_custom_document_receipts')).rows[0].n;assert.equal(count,0);
});
test('real PDF, immutable upload, public receipt and hash-verified private reopen; same operation retries do not sign again',async()=>{
 const e=await emit(),p=await signPayload(e),result=await send(publicHandler,p);assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.receipt.clinical_authorization,false);
 const row=await repository.customIssue({p_clinic:clinic,p_actor:actor,p_session:session,p_id:e.issue.id}),pdf=storage.get('app-custom-documents/'+row.pdf_path),signature=storage.get('app-custom-documents/'+row.signature_path);
 assert.ok((await PDFDocument.load(pdf)).getPageCount()>=1);assert.equal(await digest(pdf),row.pdf_sha256);assert.equal(await digest(signature),row.signature_sha256);const packet=JSON.parse(new TextDecoder().decode(signature));assert.equal(packet.submission.answers.detalhe,undefined);assert.equal(packet.submission.general_data_consent,undefined);
 const calls=renderCalls;const retry=await send(publicHandler,p);assert.equal(retry.receipt.pdf_sha256,result.receipt.pdf_sha256);assert.equal(renderCalls,calls);assert.equal((await send(publicHandler,{...p,operation_id:crypto.randomUUID()})).status,409);
 const reopened=await send(privateHandler,{acao:'obter_pdf_documento_paciente',issue_id:e.issue.id});assert.equal(reopened.pdf.sha256,row.pdf_sha256);assert.ok(reopened.pdf.url.includes(row.pdf_path));
 const source=await repository.customClinicalSource({p_clinic:clinic,p_actor:actor,p_session:session,p_id:e.issue.id});assert.equal(source.source_kind,'custom_doc');assert.equal(source.source_version,'1');assert.equal(source.storage_valid,true);assert.equal(source.status,'recebido');assert.equal(source.withdrawn,false);
});
test('upload failure preserves first submission and permits byte-identical retry; lost finish response recovers original',async()=>{
 const e=await emit(),p=await signPayload(e);uploadFailures=1;assert.equal((await send(publicHandler,p)).status,503);let row=await repository.customIssue({p_clinic:clinic,p_actor:actor,p_session:session,p_id:e.issue.id});assert.equal(row.received_at,null);const stamp=row.signed_at;
 assert.equal((await send(publicHandler,{...p,answers:{informada:'Não',detalhe:'changed'}})).status,409);
 finishLost=true;assert.equal((await send(publicHandler,p)).status,503);const original=new Map(storage);const replay=await send(publicHandler,p);assert.equal(replay.status,200,JSON.stringify(replay));row=await repository.customIssue({p_clinic:clinic,p_actor:actor,p_session:session,p_id:e.issue.id});assert.equal(row.signed_at,stamp);assert.deepEqual(storage,original);
});
test('anamnese requires separate general authorization; image requires explicit independent purpose including refusal',async()=>{
 const a=await emit('anamnese'),p=await signPayload(a);assert.equal((await send(publicHandler,p)).codigo,'custom_general_consent_required');assert.equal((await send(publicHandler,{...p,general_data_consent:true})).status,200);
 const e=await emit('imagem'),q=await signPayload(e);assert.equal((await send(publicHandler,q)).codigo,'custom_image_choice_required');assert.equal((await send(publicHandler,{...q,image_use:'nao_autorizado'})).status,200);
});
test('revocation after receipt blocks public reopening but preserves private original and withdraws future clinical eligibility',async()=>{
 const e=await emit(),p=await signPayload(e);assert.equal((await send(publicHandler,p)).status,200);const before=new Map(storage),op={acao:'revogar_documento_paciente',operation_id:crypto.randomUUID(),issue_id:e.issue.id};assert.equal((await send(privateHandler,op)).issue.status,'revoked');assert.equal((await send(privateHandler,op)).status,200);
 assert.equal((await send(publicHandler,{acao:'recibo',token:e.token})).status,404);assert.equal((await send(publicHandler,{acao:'abrir',token:e.token})).status,404);assert.equal((await send(privateHandler,{acao:'obter_pdf_documento_paciente',issue_id:e.issue.id})).status,200);assert.deepEqual(storage,before);
 assert.equal((await repository.customClinicalSource({p_clinic:clinic,p_actor:actor,p_session:session,p_id:e.issue.id})).withdrawn,true);
});
test('expiry/forged token/foreign clinic fail closed; corrupt original is never offered',async()=>{
 const e=await emit(),p=await signPayload(e);assert.equal((await send(publicHandler,p)).status,200);assert.equal((await send(publicHandler,{acao:'abrir',token:e.token.slice(0,-1)+(e.token.endsWith('0')?'1':'0')})).status,404);
 assert.equal(await repository.customIssue({p_clinic:clinic,p_actor:actor,p_session:session,p_id:crypto.randomUUID()}),null);
 const row=await repository.customIssue({p_clinic:clinic,p_actor:actor,p_session:session,p_id:e.issue.id}),key='app-custom-documents/'+row.pdf_path,old=storage.get(key);storage.set(key,new Uint8Array([1,2,3]));assert.equal((await send(publicHandler,{acao:'recibo',token:e.token})).status,409);storage.set(key,old);
 await db.query("update app_custom_document_issues set issued_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 day' where id=$1",[e.issue.id]);assert.equal((await send(publicHandler,{acao:'abrir',token:e.token})).status,404);assert.equal((await send(privateHandler,{acao:'obter_pdf_documento_paciente',issue_id:e.issue.id})).status,200);
});
test('SQL lease prevents two writers; stale claim cannot finish and changed patient/locked visit blocks reserve',async()=>{
 const e=await emit(),p=await signPayload(e),row=await repository.customIssue({p_clinic:clinic,p_actor:actor,p_session:session,p_id:e.issue.id}),a={p_id:e.issue.id,p_token_hash:await digest(e.token),p_operation:p.operation_id,p_submission_hash:'a'.repeat(64),p_payload:validateSubmission(p,row),p_claim:crypto.randomUUID()};
 const first=await repository.customReserve(a);await assert.rejects(repository.customReserve({...a,p_claim:crypto.randomUUID()}),e=>e.code==='custom_processing');await repository.customRelease({p_id:a.p_id,p_claim:a.p_claim});
 state.patients[0].name='OTHER PERSON';await saveState();await assert.rejects(repository.customReserve(a),e=>e.code==='custom_identity_mismatch');state.patients[0].name='TESTE Marina Exemplo';state.visits[0].lockedAt=new Date().toISOString();await saveState();await assert.rejects(repository.customReserve(a),e=>e.code==='custom_visit_locked');delete state.visits[0].lockedAt;await saveState();
 const next=await repository.customReserve({...a,p_claim:crypto.randomUUID()});assert.equal(next.signed_at,first.signed_at);await assert.rejects(repository.customFinish({p_id:a.p_id,p_token_hash:a.p_token_hash,p_claim:a.p_claim,p_artifacts:{}}),e=>e.code==='custom_claim_expired');await repository.customRelease({p_id:a.p_id,p_claim:next.claim_id});
});
test('body/origin/rate limits and signature total bounds reject without writing',async()=>{
 const h=createPublicDocumentHandler({repository,renderPDF:rawRenderer,rateLimit:async()=>({allowed:false})});assert.equal((await send(h,{acao:'abrir',token:'x'})).status,429);
 const origin=await publicHandler(new Request('https://test',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:'{}'}));assert.equal(origin.status,403);
 assert.equal((await publicHandler(req({acao:'abrir',token:'x',padding:'x'.repeat(1500001)}))).status,413);
 assert.throws(()=>signatureStrokes(Array.from({length:21},()=>Array.from({length:1024},(_,i)=>({x:i/1024,y:.5})))),CustomDocumentError);
});
test('adult policy requires valid DOB, exactly eighteenth birthday and Sao Paulo day boundary',()=>{
 for(const value of ['',undefined,'2008-02-30','2026-99-01'])assert.throws(()=>requireAdultBirthDate(value,'2026-10-16T12:00:00Z'),e=>e.code==='custom_birth_date_required');
 assert.equal(requireAdultBirthDate('2008-10-16','2026-10-16T12:00:00Z'),'2008-10-16');
 assert.throws(()=>requireAdultBirthDate('2008-10-17','2026-10-16T12:00:00Z'),e=>e.code==='custom_adult_required');
 assert.throws(()=>requireAdultBirthDate('2008-10-16','2026-10-16T01:00:00Z'),e=>e.code==='custom_adult_required');
 assert.throws(()=>requireAdultBirthDate('2008-02-29','2026-02-28T12:00:00Z'),e=>e.code==='custom_adult_required');
 assert.equal(requireAdultBirthDate('2008-02-29','2026-03-01T12:00:00Z'),'2008-02-29');
});
test('reload resumes only already confirmed immutable submission; no token-only signature can be invented',async()=>{
 const e=await emit();assert.equal((await send(publicHandler,{acao:'retomar',token:e.token})).codigo,'custom_resume_unavailable');
 const p=await signPayload(e);uploadFailures=1;assert.equal((await send(publicHandler,p)).status,503);
 const fresh=createPublicDocumentHandler({repository,renderPDF:rawRenderer,rateLimit:async()=>({allowed:true})}),opened=await send(fresh,{acao:'abrir',token:e.token});assert.equal(opened.can_resume,true);assert.equal(opened.submission_payload,undefined);
 assert.equal((await send(fresh,{acao:'retomar',token:e.token,signature_strokes:p.signature_strokes})).status,422);
 const received=await send(fresh,{acao:'retomar',token:e.token});assert.equal(received.status,200,JSON.stringify(received));assert.equal((await send(fresh,{acao:'retomar',token:e.token})).receipt.pdf_sha256,received.receipt.pdf_sha256);
 const row=await repository.customIssue({p_clinic:clinic,p_actor:actor,p_session:session,p_id:e.issue.id});assert.equal(row.submit_operation_id,p.operation_id);assert.equal(row.submission_payload.confirmed,true);assert.deepEqual(row.submission_payload.signature_strokes,p.signature_strokes);
});
test('real service_role RPCs work without mutable-table privileges; immutable original bytes survive rerender',async()=>{
 const e=await emit(),p=await signPayload(e);await db.exec('set role service_role');try{
  assert.equal((await send(publicHandler,p)).status,200);
  await assert.rejects(db.query("update app_custom_document_issues set title='other' where id=$1",[e.issue.id]),/permission denied/);
  await assert.rejects(db.query('delete from app_custom_document_receipts where issue_id=$1',[e.issue.id]),/permission denied/);
  const row=await repository.customIssue({p_clinic:clinic,p_actor:actor,p_session:session,p_id:e.issue.id}),packet=JSON.parse(new TextDecoder().decode(storage.get('app-custom-documents/'+row.signature_path)));
  assert.equal(await digest(await rawRenderer(row,packet)),row.pdf_sha256);
  const different=new Uint8Array([1,2,3]);await assert.rejects(repository.customUpload(row.pdf_path,different,'application/pdf',await digest(different)),e=>e.code==='custom_content_conflict');
 }finally{await db.exec('reset role');}
});
test('finish rechecks patient context and rejects stale artifacts after revocation',async()=>{
 const e=await emit(),p=await signPayload(e),row=await repository.customIssue({p_clinic:clinic,p_actor:actor,p_session:session,p_id:e.issue.id}),a={p_id:e.issue.id,p_token_hash:await digest(e.token),p_operation:p.operation_id,p_submission_hash:'b'.repeat(64),p_payload:validateSubmission(p,row),p_claim:crypto.randomUUID()};await repository.customReserve(a);
 state.visits[0].lockedAt=new Date().toISOString();await saveState();await assert.rejects(repository.customFinish({p_id:a.p_id,p_token_hash:a.p_token_hash,p_claim:a.p_claim,p_artifacts:{}}),e=>e.code==='custom_visit_locked');delete state.visits[0].lockedAt;await saveState();
 await send(privateHandler,{acao:'revogar_documento_paciente',operation_id:crypto.randomUUID(),issue_id:e.issue.id});await assert.rejects(repository.customFinish({p_id:a.p_id,p_token_hash:a.p_token_hash,p_claim:a.p_claim,p_artifacts:{}}),e=>e.code==='custom_link_unavailable');
 assert.equal((await db.query('select count(*)::int n from app_custom_document_receipts where issue_id=$1',[e.issue.id])).rows[0].n,0);
});
test('unsupported text is rejected before reservation so corrected confirmed answers can be submitted',async()=>{
 const e=await emit(),p=await signPayload(e),invalid={...p,answers:{informada:'Não',detalhe:'Dúvida 😀'}};
 assert.equal((await send(publicHandler,invalid)).codigo,'custom_pdf_character');const row=await repository.customIssue({p_clinic:clinic,p_actor:actor,p_session:session,p_id:e.issue.id});assert.equal(row.status,'issued');assert.equal(row.submission_payload,null);assert.equal(row.submit_operation_id,null);
 assert.equal((await send(publicHandler,{...invalid,answers:{informada:'Não',detalhe:'Dúvida esclarecida'}})).status,200);
});
test('word wrap preserves complete Portuguese words, explicit newlines and blank paragraphs',()=>{
 const text='A paciente recebeu explicações sobre riscos e cuidados.',lines=wrapPDFLines(text,s=>[...s].length,19);assert.equal(lines.join(' '),text);assert.ok(lines.every(line=>line.length<=19));assert.ok(lines.every(line=>line.split(' ').every(word=>text.split(' ').includes(word))));
 assert.deepEqual(wrapPDFLines('Primeira linha\n\nÚltima linha',s=>s.length,40),['Primeira linha','','Última linha']);
});
test('hard breaks apply only to over-wide tokens and preserve Unicode grapheme clusters',()=>{
 const token='a'.repeat(64),lines=wrapPDFLines('Hash '+token+' fim',s=>s.length,12);assert.equal(lines[0],'Hash');assert.equal(lines.slice(1).join('').replace(' fim','').replace('fim',''),token);assert.ok(lines.every(line=>line.length<=12));
 const clusters=Array.from({length:9},()=> 'a\u0301').join(''),unicode=wrapPDFLines(clusters,s=>[...new Intl.Segmenter('pt',{granularity:'grapheme'}).segment(s)].length,4);assert.equal(unicode.join(''),clusters);assert.ok(unicode.every(line=>!/^\p{Mark}/u.test(line)));assert.deepEqual(unicode.map(line=>[...new Intl.Segmenter('pt',{granularity:'grapheme'}).segment(line)].length),[4,4,1]);
});
test('real font wrapping fits page margins and preflight enforces the page budget before receiving a signature',async()=>{
 const font=fontkit.create(assets.font),measure=s=>font.layout(s).glyphs.reduce((n,g)=>n+g.advanceWidth,0)/font.unitsPerEm*9.5,text='Este documento não é consentimento para procedimento e não possui validade clínica ou jurídica. A assinatura desenhada é sintética e serve somente para verificar gravação, integridade, recuperação e leitura do PDF. Nenhuma pessoa está consentindo em tratamento.',lines=wrapPDFLines(text,measure,503.28);
 assert.equal(lines.join(' '),text);assert.ok(lines.length>=2);assert.ok(lines.every(line=>measure(line)<=503.28));assert.ok(lines.every(line=>line.split(' ').every(word=>text.split(' ').includes(word))));
 const e=await emit(),p=await signPayload(e),row=await repository.customIssue({p_clinic:clinic,p_actor:actor,p_session:session,p_id:e.issue.id}),submission=validateSubmission(p,row);
 await assert.rejects(rawRenderer.validate({...row,snapshot:{...row.snapshot,body:'\n'.repeat(3001)}},submission),e=>e.code==='custom_pdf_limit');
 await rawRenderer.validate({...row,snapshot:{...row.snapshot,body:'\n'.repeat(2800)}},submission);
 const longer={...row,signed_at:'2026-10-16T04:43:52.166Z',snapshot:{...row.snapshot,body:Array.from({length:100},()=>text).join('\n')}},pdf=await rawRenderer(longer,{submission});assert.ok((await PDFDocument.load(pdf)).getPageCount()>2);assert.ok((await PDFDocument.load(pdf)).getPageCount()<150);
});
test('new emissions freeze renderer v2, while already-issued v1 reproduces the legacy original on retries',async()=>{
 const e=await emit(),p=await signPayload(e),row=await repository.customIssue({p_clinic:clinic,p_actor:actor,p_session:session,p_id:e.issue.id}),submission=validateSubmission(p,row);assert.equal(row.confirmation.renderer_version,'2026-10-16-v2');
 const issued={...row,signed_at:'2026-10-16T04:43:52.166Z',snapshot:{...row.snapshot,body:'Este documento não é consentimento para procedimento e não possui validade clínica ou jurídica. A assinatura desenhada é sintética e serve somente para verificar gravação, integridade, recuperação e leitura do PDF. Nenhuma pessoa está consentindo em tratamento.'}},legacy=structuredClone(issued);delete legacy.confirmation.renderer_version;
 const before=await rawRenderer(legacy,{submission}),after=await rawRenderer(legacy,{submission}),modern=await rawRenderer(issued,{submission});assert.deepEqual(after,before);assert.notEqual(await digest(modern),await digest(before));assert.ok((await PDFDocument.load(before)).getPageCount()>=1);
 const unknown=structuredClone(issued);unknown.confirmation.renderer_version='future';await assert.rejects(rawRenderer.validate(unknown,submission),e=>e.code==='custom_pdf_version');
});
