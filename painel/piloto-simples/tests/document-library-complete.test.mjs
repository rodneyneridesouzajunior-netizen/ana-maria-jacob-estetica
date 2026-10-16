import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {CLINIC_DOCUMENT_MODELS} from '../document-library.mjs';
import {seed} from '../domain.mjs';
import {saveTemplate,prepareDocument,saveDocumentAnswers,visibleQuestions,validateDocumentVersion} from '../documents-domain.mjs';
import {validateBackupState} from '../backup.mjs';
import {saveProcedure,visitRequiredDocumentIds} from '../operations-domain.mjs';
import {procedureForm} from '../operations-ui.mjs';
import {renderDocumentsPage,mountDocuments} from '../documents-ui.mjs';
import {issueSnapshot,validateSubmission,assertIssueIntegrity,publicDocument,canonical,digest,capability} from '../../../supabase/functions/_shared/custom-documents.mjs';
import {createPDFRenderer} from '../../../supabase/functions/documento-paciente/pdf.mjs';
import {createCustomDocuments} from '../../../supabase/functions/app-workspace/custom-documents.mjs';
import {createPublicDocumentHandler} from '../../../supabase/functions/documento-paciente/handler.mjs';

const oldIds=['amj-anamnese-geral-20261016','amj-termo-toxina-20261016','amj-termo-preenchimento-20261016','amj-imagem-20261016'];
const newIds=['amj-termo-labial-20261016','amj-termo-full-face-20261016','amj-termo-rinomodelacao-20261016','amj-termo-bioestimuladores-20261016','amj-termo-fios-pdo-20261016','amj-termo-fios-silhouette-20261016','amj-termo-hialuronidase-20261016','amj-termo-lipoescultura-pescoco-20261016'];
const expectedIds=[...oldIds,...newIds];
const stamp='2026-10-16T15:00:00.000Z';
const runtime=createRequire('C:/Users/rotan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const require=createRequire(import.meta.url);
const {PDFDocument,rgb}=runtime('pdf-lib');
const fontkit=require('../../../skinpro-analise/revisoes/codigo-provas/custom-docs-pdf/package/dist/fontkit.umd.js');
const jsdomRequire=createRequire(new URL('../../../../../skinpro-analise/test-tools/package.json',import.meta.url));
const {JSDOM}=jsdomRequire('jsdom');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const cleanText=s=>String(s).normalize('NFC').replace(/\s+/gu,' ').trim();

function fixture(){
 const state=seed();state.documentTemplates=[];state.documentResponses=[];state.documentHistory=[];
 const patient=state.patients.find(p=>p.id==='demo-marina');
 Object.assign(patient,{name:'PACIENTE FICTÍCIA DE TESTE',cpf:'52998224725',birthDate:'1990-01-01'});
 const visit=state.visits.find(v=>v.id==='demo-consulta');visit.status='rascunho';delete visit.lockedAt;
 return{state,patient,visit};
}
function answersFor(snapshot){
 const answers={};
 for(const q of snapshot.questions){
  if(!visibleQuestions(snapshot,answers).some(x=>x.id===q.id))continue;
  answers[q.id]=q.type==='yesno'||q.type==='yesnona'?'Não':q.type==='select'?q.options[0]:q.type==='scale'?String(q.min):q.type==='number'?'1':q.type==='date'?'2026-10-16':q.type==='phone'?'31999990000':'Resposta exclusivamente sintética para testar o documento.';
 }
 return answers;
}
async function emitted(model,f=fixture()){
 const version=saveTemplate(f.state,structuredClone(model));validateDocumentVersion(version);
 const record=prepareDocument(f.state,{id:'document-'+model.id,templateId:model.id,patientId:f.patient.id,visitId:f.visit.id});
 const envelope=issueSnapshot(record,f.patient,f.visit,{now:stamp});
 const issue={...envelope,id:crypto.randomUUID(),clinic_id:crypto.randomUUID(),signed_at:stamp,snapshot_hash:await digest(canonical(envelope))};
 const payload={operation_id:crypto.randomUUID(),snapshot_hash:issue.snapshot_hash,confirmation_version:issue.confirmation.version,answers:answersFor(record.snapshot),signer_name:f.patient.name,signature_strokes:[[{x:.1,y:.3},{x:.7,y:.4}]],confirmed:true,...(model.kind==='anamnese'?{general_data_consent:true}:{}),...(model.kind==='imagem'?{image_use:'nao_autorizado'}:{})};
 return{...f,record,issue,payload,submission:validateSubmission(payload,issue)};
}
function dom(t){
 const d=new JSDOM('<!doctype html><main></main>',{url:'https://example.invalid/app/'}),w=d.window,previous={document:globalThis.document,FormData:globalThis.FormData,confirm:globalThis.confirm};
 Object.assign(globalThis,{document:w.document,FormData:w.FormData,confirm:()=>false});
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 t.after(()=>{w.close();for(const [key,value]of Object.entries(previous))if(value===undefined)delete globalThis[key];else globalThis[key]=value;});
 return{w,host:w.document.querySelector('main')};
}

test('complete clinic inventory has eight new specific terms plus the four preserved models, with one general anamnese',()=>{
 assert.deepEqual(CLINIC_DOCUMENT_MODELS.map(m=>m.id).sort(),expectedIds.toSorted());
 assert.equal(CLINIC_DOCUMENT_MODELS.filter(m=>m.kind==='anamnese').length,1);
 assert.equal(CLINIC_DOCUMENT_MODELS.filter(m=>m.kind==='imagem').length,1);
 assert.equal(CLINIC_DOCUMENT_MODELS.filter(m=>m.kind==='termo').length,10);
 const general=CLINIC_DOCUMENT_MODELS.find(m=>m.kind==='anamnese');
 const generalQuestions=new Set(general.questions.map(q=>cleanText(q.label).toLocaleLowerCase('pt-BR')));
 for(const id of newIds){
  const model=CLINIC_DOCUMENT_MODELS.find(m=>m.id===id);assert.equal(model.kind,'termo',id);
  assert.ok(model.questions.length>0,id+' must contain the specific response fields');
  for(const q of model.questions){assert.ok(!generalQuestions.has(cleanText(q.label).toLocaleLowerCase('pt-BR')),id+' repeats a general anamnese question');assert.equal(Object.hasOwn(q,'default'),false,id+' must not pre-confirm answers');}
  const text=[model.body,...(model.blocks||[]).map(b=>b.body)].join('\n');
  assert.doesNotMatch(text,/Autorizo o tratamento dos meus dados pessoais|Autoriza divulgar seu primeiro nome|Autoriza divulgação em comparativo de antes e depois/i,id);
 }
});

test('all library documents survive save/reopen/backup and a later template revision preserves the prepared and emitted version',async()=>{
 const f=fixture();
 for(const model of CLINIC_DOCUMENT_MODELS){
  const {record,issue}=await emitted(model,f),before=structuredClone(record),issued=structuredClone(issue);
  saveDocumentAnswers(f.state,{id:record.id,answers:answersFor(record.snapshot),...(model.kind==='imagem'?{imageUse:'nao_autorizado'}:{})});
  const answered=structuredClone(f.state.documentResponses.find(d=>d.id===record.id));
  saveTemplate(f.state,{...structuredClone(model),body:model.body+'\nRevisão sintética posterior.',expectedVersion:1});
  assert.equal(f.state.documentTemplates.find(t=>t.id===model.id).versions.length,2);
  assert.deepEqual(f.state.documentResponses.find(d=>d.id===record.id),answered);
  assert.deepEqual(issue,issued);assert.deepEqual(issue.snapshot,before.snapshot);
  await assertIssueIntegrity(issue);
  const reopened=publicDocument(JSON.parse(JSON.stringify(issue)));
  assert.deepEqual(reopened.snapshot,before.snapshot);assert.equal(reopened.templateVersion,1);assert.equal(reopened.kind,model.kind);
  assert.equal(reopened.patientId,undefined);assert.equal(reopened.patientName,f.patient.name);
 }
 const restored=JSON.parse(JSON.stringify(f.state));validateBackupState(restored);
 assert.deepEqual(restored.documentResponses,f.state.documentResponses);
 assert.deepEqual(restored.documentTemplates,f.state.documentTemplates);
});

test('private issuance and public reopening accept every specific library ID and keep the server-owned original after catalog edits',async()=>{
 const f=fixture(),rows=new Map(),secret='IN-MEMORY SYNTHETIC TEST SECRET ONLY',ctx={clinicId:crypto.randomUUID(),userId:crypto.randomUUID(),sessionId:crypto.randomUUID()};
 let authorizations=0;
 const repository={
  load:async clinic=>{assert.equal(clinic,ctx.clinicId);return{revision:17,state:JSON.parse(JSON.stringify(f.state))};},
  customIssue:async p=>structuredClone(rows.get(p.p_id)||null),
  customTokenHash:async row=>digest(await capability(row,secret)),
  customPublicURL:async row=>'https://example.invalid/documento/#token='+await capability(row,secret),
  customIssueCreate:async p=>{assert.equal(p.p_expected,17);assert.equal(p.p_clinic,ctx.clinicId);const row={...structuredClone(p.p_snapshot),request_hash:p.p_request_hash,status:'issued',issued_at:stamp,received_at:null,revoked_at:null};rows.set(row.id,row);return structuredClone(row);},
  customPublic:async p=>{const row=rows.get(p.p_id);assert.equal(p.p_token_hash,row.token_hash);return structuredClone(row);}
 };
 const issue=createCustomDocuments({repository,authorize:async()=>{authorizations++;}});
 const open=createPublicDocumentHandler({repository,rateLimit:async()=>({allowed:true}),renderPDF:()=>{throw Error('Opening a link must never sign or render a PDF');}});
 for(const model of CLINIC_DOCUMENT_MODELS){
  saveTemplate(f.state,structuredClone(model));const record=prepareDocument(f.state,{id:'issued-'+model.id,templateId:model.id,patientId:f.patient.id,visitId:f.visit.id});
  const request={acao:'emitir_documento_paciente',document_id:record.id,expected_revision:17,operation_id:crypto.randomUUID()};
  const result=await issue(request,ctx,{}),token=new URL(result.issue.public_url).hash.slice(7),firstRow=structuredClone(rows.get(result.issue.id));
  assert.equal(result.issue.template_id,model.id);assert.equal(result.issue.kind,model.kind);assert.equal(result.operation.status,'committed');
  saveTemplate(f.state,{...structuredClone(model),body:'Revisão sintética posterior à emissão.',expectedVersion:1});
  const repeat=await issue(request,ctx,{});assert.equal(repeat.issue.public_url,result.issue.public_url);assert.deepEqual(rows.get(result.issue.id),firstRow);
  const response=await open(new Request('https://example.invalid/functions/documento-paciente',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://anamariajacob.com.br'},body:JSON.stringify({acao:'abrir',token})}));
  const reopened=await response.json();assert.equal(response.status,200,JSON.stringify(reopened));assert.equal(reopened.status,'issued');assert.deepEqual(reopened.document.snapshot,record.snapshot);assert.equal(reopened.document.templateVersion,1);assert.equal(reopened.document.kind,model.kind);assert.equal(reopened.document.patientId,undefined);assert.equal(JSON.stringify(reopened).includes(f.patient.cpf),false);
 }
 assert.equal(rows.size,expectedIds.length);assert.equal(authorizations,expectedIds.length*2);
});

test('all ten terms can be selected and associated to distinct procedures without requiring general data or image consent again',async()=>{
 const f=fixture(),procedures=[];
 for(const model of CLINIC_DOCUMENT_MODELS){
  const {issue,payload}=await emitted(model,f);
  if(model.kind!=='termo')continue;
  assert.equal(issue.confirmation.general_data_text,undefined);
  assert.throws(()=>validateSubmission({...payload,general_data_consent:true},issue),e=>e.code==='custom_general_consent_unexpected');
  assert.throws(()=>validateSubmission({...payload,image_use:'publicacao'},issue),e=>e.code==='custom_image_choice_unexpected');
  procedures.push(saveProcedure(f.state,{operationId:'procedure-'+model.id,now:stamp,data:{id:'procedure-'+model.id,name:model.title,price:10000,cost:1000,duration:30,recordMode:'simple',consentTemplateId:model.id,requiredDocumentIds:[model.id],active:true}}));
 }
 assert.equal(procedures.length,10);
 const savedVisit=f.state.visits.find(v=>v.id===f.visit.id);savedVisit.procedureSnapshot=procedures[0];
 savedVisit.maps={synthetic:{points:procedures.slice(1).map((p,i)=>({id:'point-'+i,procedureId:p.id,procedureVersion:p.version,procedureSnapshot:p}))}};
 assert.deepEqual(visitRequiredDocumentIds(savedVisit).sort(),CLINIC_DOCUMENT_MODELS.filter(m=>m.kind==='termo').map(m=>m.id).sort());
 const before=structuredClone(procedures[0]);
 saveProcedure(f.state,{operationId:'change-procedure',now:stamp,data:{...before,consentTemplateId:procedures[1].consentTemplateId,expectedVersion:1}});
 assert.deepEqual(f.state.visits.find(v=>v.id===f.visit.id).procedureSnapshot,before,'Existing visit keeps its explicit consent binding');
});

test('library, preparation picker and procedure picker expose every exact model without silently creating a document',async t=>{
 const h=dom(t),f=fixture();h.host.innerHTML=renderDocumentsPage(f.state);
 assert.deepEqual([...h.host.querySelectorAll('[data-doc=preset]')].map(b=>b.dataset.id).sort(),expectedIds.toSorted());
 assert.equal(f.state.documentResponses.length,0);
 for(const model of CLINIC_DOCUMENT_MODELS)saveTemplate(f.state,structuredClone(model));
 h.host.innerHTML=renderDocumentsPage(f.state,{visitId:f.visit.id});
 const notices=[];mountDocuments(h.host,{getState:()=>f.state,mutate:async fn=>fn(f.state),notify:(...x)=>notices.push(x),rerender:async()=>{},visitId:f.visit.id});
 h.host.querySelector('[data-doc=prepare]').click();await tick();
 const modal=h.w.document.querySelector('dialog'),select=modal.querySelector('[name=template]');
 assert.deepEqual([...select.options].map(o=>o.value).filter(Boolean).sort(),expectedIds.toSorted());
 assert.equal(f.state.documentResponses.length,0);
 select.value=newIds.at(-1);modal.querySelector('form').dispatchEvent(new h.w.Event('submit',{bubbles:true,cancelable:true}));await tick();await tick();
 assert.equal(f.state.documentResponses.length,1);assert.equal(f.state.documentResponses[0].templateId,newIds.at(-1));assert.equal(notices.some(n=>n[1]===true),false);
 const holder=h.w.document.createElement('div');holder.innerHTML=procedureForm(f.state,null).body;
 assert.deepEqual([...holder.querySelector('[name=consentTemplateId]').options].map(o=>o.value).filter(Boolean).sort(),CLINIC_DOCUMENT_MODELS.filter(m=>m.kind==='termo').map(m=>m.id).sort());
});

test('real PDF renderer preserves complete library content across pages, footer numbering and immutable replay',async t=>{
 const assets={font:new Uint8Array(await readFile(new URL('../../../assets/amj-poppins-20261015.ttf',import.meta.url))),logo:new Uint8Array(await readFile(new URL('../../../assets/identidade-visual-transparente-v1.png',import.meta.url)))};
 const render=createPDFRenderer({PDFDocument,rgb,fontkit,assets});
 const {getDocument}=await import(pathToFileURL(runtime.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
 let multiPageCount=0;
 for(const model of CLINIC_DOCUMENT_MODELS)await t.test(model.id,async modelTest=>{
  const {issue,submission,state}=await emitted(model);await render.validate(issue,submission);
  const pdf=await render(issue,{submission}),loaded=await PDFDocument.load(pdf),pages=loaded.getPageCount();
  modelTest.diagnostic(`${pages} page(s); complete text extraction and exact retry checked`);
  assert.ok(pages>=1&&pages<150);if(pages>1)multiPageCount++;
  const task=getDocument({data:pdf.slice(),disableFontFace:true,useSystemFonts:false,isEvalSupported:false});
  const doc=await task.promise,all=[];
  try{
   assert.equal(doc.numPages,pages);
   for(let p=1;p<=pages;p++){
    const page=await doc.getPage(p),content=await page.getTextContent();
    assert.ok(content.items.some(item=>item.str===`${p} / ${pages}`),'Page '+p+' has its actual footer');
    all.push(...content.items.filter(item=>Math.abs(item.transform?.[5]-28)>.1).map(item=>item.str));
   }
  }finally{await doc.destroy();}
  const extracted=cleanText(all.join(' '));
  for(const text of [issue.title,issue.snapshot.body,...(issue.snapshot.blocks||[]).flatMap(b=>[b.title,b.body]),...visibleQuestions(issue.snapshot,submission.answers).flatMap(q=>[q.label,submission.answers[q.id]]),submission.confirmation_text,submission.signer_name])assert.ok(extracted.includes(cleanText(text)),model.id+' omitted or changed PDF text: '+String(text).slice(0,75));
  if(model.kind==='anamnese')assert.ok(extracted.includes(cleanText(submission.general_data_text)));
  else assert.doesNotMatch(extracted,/Autorizo o tratamento dos meus dados pessoais e de saúde pela clínica/);
  saveTemplate(state,{...structuredClone(model),body:'Texto sintético revisado depois da emissão.',expectedVersion:1});
  assert.deepEqual(await render(issue,{submission}),pdf,'A later catalog version must not change a retry of an issued original');
 });
 assert.ok(multiPageCount>0,'Actual library content must exercise the multipage renderer');
});
