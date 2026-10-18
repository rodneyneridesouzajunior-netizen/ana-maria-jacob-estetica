import {fail,hash,stable,uuid,validId} from './rules.mjs';
import {completeVisit,procedureDocumentIds,completionProcedures} from '../_shared/app-workspace-domain/operations-domain.mjs';
import {validCPF} from '../_shared/app-workspace-domain/patients-domain.mjs';
import {activeWorkspace,mergeActiveWorkspace} from '../_shared/app-workspace-domain/recycle-bin.mjs';
import {describeClinicalSource} from './clinical-bridge.mjs';

export const CLINICAL_COMPLETION_ACTIONS=Object.freeze(['preparar_conclusao_clinica','concluir_consulta_clinica','status_conclusao_clinica']);
export const CLINICAL_DECLARATION_VERSION='amj-clinical-review-2026-10-15-v1';
export const CLINICAL_DECLARATION='Confirmo pessoalmente que sou a profissional responsável por esta consulta. Revisei a identificação da paciente, os documentos originais vinculados, o registro do atendimento, as fotos, as marcações, os produtos, os lotes e os valores apresentados. Confirmo a conclusão deste registro e sua preservação no histórico.';
// These are received patient documents, never a professional license or a clinical decision.
export const COMPLETION_SOURCE_TYPES=Object.freeze(['anamnese','tcle_toxina_botulinica','tcle_preenchimento_facial','custom_doc']);
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v);
const actor=ctx=>({p_clinic:ctx.clinicId,p_actor:ctx.userId,p_session:ctx.sessionId});
const envelope=row=>({schema:1,revision:row.revision,state:row.state,state_hash:row.state_hash,updated_at:row.updated_at||row.created_at});
const requiredKeys=['operation_id','expected_revision','patient_id','visit_id','procedure_id','consumptions','quote_id','item_id','sessions','quoteItems'];
function input(p){
 if(!plain(p)||Object.keys(p).some(k=>!['acao',...requiredKeys,'review_hash','declaration_version','confirmed'].includes(k)))fail('invalid_clinical_completion','A conclusão contém campos não reconhecidos.');
 if(!uuid(p.operation_id)||!Number.isSafeInteger(p.expected_revision)||p.expected_revision<1||![p.patient_id,p.visit_id,p.procedure_id].every(validId))fail('invalid_clinical_completion','Selecione a paciente, a consulta e a revisão salvas.');
 if(p.quote_id!==undefined&&p.quote_id!==''&&!validId(p.quote_id)||p.item_id!==undefined&&p.item_id!==''&&!validId(p.item_id))fail('invalid_clinical_completion','Selecione um orçamento válido.');
 const consumptions=p.consumptions??[];if(!Array.isArray(consumptions)||consumptions.length>400)fail('invalid_clinical_completion','Confira os materiais usados.');
 for(const c of consumptions)if(!plain(c)||Object.keys(c).some(k=>!['lotId','quantity','photoId','pointId','reason'].includes(k)))fail('invalid_clinical_completion','Confira os campos dos materiais usados.');
 const quoteItems=p.quoteItems;if(quoteItems!==undefined&&(!Array.isArray(quoteItems)||!quoteItems.length||quoteItems.length>100||!p.quote_id||p.item_id||p.sessions!==undefined&&p.sessions!==1||quoteItems.some(x=>!plain(x)||Object.keys(x).some(k=>!['itemId','sessions'].includes(k))||!validId(x.itemId)||!Number.isSafeInteger(x.sessions)||x.sessions<1||x.sessions>1000)||new Set(quoteItems.map(x=>x.itemId)).size!==quoteItems.length))fail('invalid_clinical_completion','Confira os itens e sessões do orçamento.');
 const sessions=p.sessions??1;if(!Number.isSafeInteger(sessions)||sessions<1||sessions>1000)fail('invalid_clinical_completion','Confira a quantidade de sessões.');
 return {operation_id:p.operation_id,expected_revision:p.expected_revision,patient_id:p.patient_id,visit_id:p.visit_id,procedure_id:p.procedure_id,consumptions:structuredClone(consumptions),quote_id:p.quote_id||'',item_id:p.item_id||'',sessions,...(quoteItems!==undefined?{quoteItems:structuredClone(quoteItems)}:{})};
}
export function validateClinicalPolicy(policy,procedure,templates){
 const required=procedureDocumentIds(procedure);
 if(!policy||policy.status!=='active'||policy.procedure_id!==procedure.id||policy.procedure_version!==procedure.version||!Array.isArray(policy.requirements))return {ok:false,code:'clinical_policy_required',message:'Configure e confira os documentos oficiais desta versão do procedimento.'};
 if(policy.requirements.length!==required.length||new Set(policy.requirements.map(r=>r.template_id)).size!==required.length)return {ok:false,code:'clinical_policy_mismatch',message:'A política deve conter cada documento obrigatório exatamente uma vez.'};
 for(const r of policy.requirements){
  const template=templates.find(t=>t.id===r.template_id);
  if(!required.includes(r.template_id)||!COMPLETION_SOURCE_TYPES.includes(r.source_type)||!template||template.kind==='imagem'||template.kind==='anamnese'&&!['anamnese','custom_doc'].includes(r.source_type)||template.kind==='termo'&&r.source_type==='anamnese')return {ok:false,code:'clinical_policy_mismatch',message:'Confira a correspondência explícita entre modelo e documento oficial. Pré-avaliações não substituem o termo de consentimento.'};
 }
 return {ok:true};
}

function customEligible(source,patient,visit,template){
 const norm=v=>String(v||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').trim().replace(/\s+/g,' '),digits=v=>String(v||'').replace(/\D/g,'');
 const identity=source?.identity||{},cpf=digits(identity.cpf);
 return source?.source_kind==='custom_doc'&&source.type==='custom_doc'&&uuid(source.source_id)&&source.patient_id===patient.id&&source.visit_id===visit.id&&source.template_id===template.id&&source.template_kind===template.kind&&['anamnese','termo'].includes(template.kind)&&source.status==='recebido'&&!source.archived&&!source.withdrawn&&source.storage_valid===true&&!!source.source_version&&[source.source_hash,source.source_fingerprint,source.signature_sha256,source.pdf_sha256,source.registry_sha256].every(hex)&&validCPF(cpf)&&cpf===digits(patient.cpf)&&norm(identity.name).length>=2&&norm(identity.name)===norm(patient.name)&&(!identity.birth_date||!patient.birthDate||identity.birth_date===patient.birthDate);
}

/** Only this server-owned route may construct clinical completion state. A generic
 * client snapshot never supplies the trusted clinicalCompletions validation set. */
export function createClinicalCompletion({repository,authorize,validateTransition,now=()=>new Date().toISOString()}){
 if(typeof validateTransition!=='function')throw Error('Clinical completion requires the operational transition validator.');
 async function inspect(p,ctx){
  const request=input(p),row=await repository.load(ctx.clinicId);
  if(!row||row.revision!==request.expected_revision)fail('revision_conflict','A consulta mudou. Reabra a revisão antes de confirmar.',409);
  const canonical=row.state,state=activeWorkspace(canonical),visit=state.visits.find(v=>v.id===request.visit_id&&v.patientId===request.patient_id),patient=state.patients.find(p=>p.id===request.patient_id);
  if(!visit||!patient)fail('clinical_visit_missing','Consulta e paciente não encontradas.',404);
  if(visit.lockedAt||['concluido','cancelado'].includes(visit.status))fail('clinical_visit_locked','A consulta já foi encerrada. Preserve o histórico.',409);
  const procedure=visit.procedureSnapshot;
  if(!procedure||procedure.id!==request.procedure_id||visit.procedureId!==procedure.id||visit.procedureVersion!==procedure.version)fail('clinical_procedure_snapshot_required','A consulta precisa preservar a versão do procedimento selecionado.');
  const configuration=await repository.completionContext({...actor(ctx),p_patient:patient.id,p_visit:visit.id});
  if(!configuration||configuration.workspace_revision!==row.revision)fail('revision_conflict','O contexto mudou durante a conferência.',409);
  let procedures;try{procedures=completionProcedures(visit,procedure);}catch(error){fail('clinical_procedure_versions_conflict',error.message);}
  const blockers=[],profile=configuration.profile,policies=configuration.policies||[configuration.policy].filter(Boolean),policy=policies.find(p=>p.procedure_id===procedure.id&&p.procedure_version===procedure.version),requirements=new Map();
  const person=state.clinic?.professionals?.find(p=>p.id===visit.professionalId);
  if(!profile||profile.status!=='active'||profile.professional_id!==visit.professionalId||!person||stable(person)!==stable(profile.professional_snapshot))blockers.push({code:'professional_account_required',message:'Vincule a conta pessoal da profissional responsável nas configurações clínicas.'});
  else if(profile.user_id!==ctx.userId)blockers.push({code:'professional_account_mismatch',message:'A profissional responsável precisa entrar com sua própria conta e autenticador para concluir.'});
  for(const procedure of procedures){
   const selected=policies.find(p=>p.procedure_id===procedure.id&&p.procedure_version===procedure.version),checked=validateClinicalPolicy(selected,procedure,state.documentTemplates||[]);
   if(!checked.ok){blockers.push({code:checked.code,procedure_id:procedure.id,message:procedure.name+': '+checked.message});continue;}
   if(selected.procedure_hash!==await hash(stable(procedure))){blockers.push({code:'clinical_policy_stale',procedure_id:procedure.id,message:'A configuração não corresponde à versão preservada de '+procedure.name+'.'});continue;}
   for(const r of selected.requirements){const prior=requirements.get(r.template_id);if(prior&&prior.source_type!==r.source_type)blockers.push({code:'clinical_policy_mismatch',message:'O mesmo documento tem origens diferentes nas políticas. Confira a configuração.'});else requirements.set(r.template_id,r);}
  }
  const templates=state.documentTemplates||[];
  if(![...requirements.values()].some(r=>templates.find(t=>t.id===r.template_id)?.kind==='anamnese'))requirements.set('@anamnese-universal',{template_id:'@anamnese-universal',source_type:'anamnese',universal:true});
  const links=await repository.clinicalLinks({...actor(ctx),p_patient:patient.id,p_visit:visit.id}),documents=[];
  const custom=typeof repository.customClinicalSources==='function'?await repository.customClinicalSources({...actor(ctx),p_patient:patient.id,p_visit:visit.id}):[];
  for(const requirement of requirements.values()){
   const template=templates.find(t=>t.id===requirement.template_id);
   let source=null,link=null;
   if(requirement.source_type==='custom_doc'||requirement.universal){
    const candidates=custom.filter(s=>{const t=requirement.universal?templates.find(t=>t.id===s.template_id&&t.kind==='anamnese'):template;return t&&customEligible(s,patient,visit,t);}).sort((a,b)=>String(b.received_at).localeCompare(String(a.received_at))||String(a.source_id).localeCompare(String(b.source_id)));
    source=candidates[0]||null;
   }
   if(!source&&requirement.source_type!=='custom_doc'){
    const candidates=links.filter(l=>l.source_snapshot?.type===requirement.source_type&&l.available===true&&l.current_identity_matches===true&&l.status==='vinculado_recebido').sort((a,b)=>String(b.linked_at).localeCompare(String(a.linked_at))||String(a.id).localeCompare(String(b.id)));
    link=candidates[0];
    if(link){source=await repository.clinicalSource({...actor(ctx),p_kind:link.source_kind,p_id:link.source_id});if(!source||source.source_fingerprint!==link.source_fingerprint||source.type!==requirement.source_type){blockers.push({code:'clinical_document_changed',template_id:requirement.template_id,message:'Um documento vinculado mudou. Confira o original e preserve seu histórico.'});continue;}if(!describeClinicalSource(source,patient).eligible_for_link){blockers.push({code:'clinical_document_unavailable',template_id:requirement.template_id,message:'Documento indisponível: confira identidade, recebimento e eventual retirada.'});continue;}}
   }
   if(!source){blockers.push({code:'clinical_document_missing',template_id:requirement.template_id,message:'Receba e confira o documento: '+(requirement.universal?'Ficha de anamnese':template?.title||requirement.template_id)+'.'});continue;}
   await repository.verifyClinicalObject(source,'pdf');await repository.verifyClinicalObject(source,'signature');
   documents.push({template_id:requirement.template_id,...(link?{link_id:link.id}:{}),source_kind:source.source_kind,source_id:source.source_id,source_type:source.type,source_version:source.source_version,source_fingerprint:source.source_fingerprint,pdf_sha256:source.pdf_sha256,signature_sha256:source.signature_sha256});
  }
  // A preview always exercises stock, billing and immutable-history rules, even
  // when human setup remains pending. No changes are written during this pass.
  const stamp=now(),today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'}).format(new Date(stamp));
  const next=structuredClone(canonical),edited=structuredClone(state);let result;
  try{
   result=completeVisit(edited,{operationId:request.operation_id,visitId:visit.id,procedureId:procedure.id,consumptions:request.consumptions,quoteId:request.quote_id,itemId:request.item_id,sessions:request.sessions,...(request.quoteItems!==undefined?{quoteItems:request.quoteItems}:{}),now:stamp,today},{documentCheck:()=>true});
   mergeActiveWorkspace(next,edited);
   validateTransition(canonical,next,{photos:await repository.photos(ctx.clinicId),now:stamp,clinicalCompletions:new Set([visit.id])});
  }catch(error){blockers.push({code:error.code||'clinical_operational_pending',message:error.message||'Revise materiais, valores e registro antes de concluir.'});}
  const reviewHash=await hash(stable({request,state_hash:row.state_hash||await hash(stable(canonical)),profile,policies,documents,declaration_version:CLINICAL_DECLARATION_VERSION}));
  return {request,row,next,result,profile,policy,policies,documents,reviewHash,stamp,blockers,patientName:patient.name,procedureName:procedures.map(p=>p.name).join(' + ')};
 }
 return async function clinicalCompletion(p,ctx,req){
  if(p.acao==='status_conclusao_clinica'){
   if(!uuid(p.operation_id))fail('invalid_operation','Identificador de operação inválido.');
   const prior=await repository.completionOperation({...actor(ctx),p_operation:p.operation_id});
   return {operation:prior?{id:p.operation_id,kind:'clinical_completion',status:'committed',result:{workspace:envelope(prior.workspace),signature:prior.signature}}:null};
  }
  if(!CLINICAL_COMPLETION_ACTIONS.includes(p.acao))fail('unsupported_action','Operação clínica não reconhecida.');
  const request=input(p),confirmed=p.acao==='concluir_consulta_clinica';
  if(confirmed&&(p.confirmed!==true||p.declaration_version!==CLINICAL_DECLARATION_VERSION||!hex(p.review_hash)))fail('clinical_confirmation_required','Leia a revisão e confirme pessoalmente a declaração apresentada.');
  const fingerprint=await hash(stable({request,review_hash:p.review_hash||null,declaration_version:CLINICAL_DECLARATION_VERSION,actor_id:ctx.userId}));
  if(confirmed){
   await authorize(req,ctx,{operationId:request.operation_id,targetId:ctx.clinicId,action:'app_workspace_clinical_completion'});
   const prior=await repository.completionOperation({...actor(ctx),p_operation:request.operation_id});
   if(prior){if(prior.fingerprint!==fingerprint)fail('operation_reused','A operação já foi usada com outra revisão.',409);return {workspace:envelope(prior.workspace),signature:prior.signature,operation:{id:request.operation_id,kind:'clinical_completion',status:'committed',replayed:true}};}
  }
  const reviewed=await inspect(p,ctx);
  const finished=reviewed.next.visits.find(v=>v.id===request.visit_id),bill=reviewed.next.bills.find(b=>b.id===finished?.billId);
  const summary={patient_name:reviewed.patientName,procedure_name:reviewed.procedureName,professional_name:reviewed.profile?.professional_name||null,documents:reviewed.documents,result:reviewed.result||null,bill_total:bill?.total??null,consumptions:(finished?.consumptions||[]).map(c=>({product_name:c.productName,lot_code:c.lotCode,quantity:c.quantity,unit:c.unit,expiry:c.expiry})),procedure_executions:finished?.procedureExecutions||[],notes:finished?.notes||''};
  if(!confirmed)return {review:{ready:reviewed.blockers.length===0,review_hash:reviewed.reviewHash,workspace_revision:reviewed.row.revision,blockers:reviewed.blockers,declaration_version:CLINICAL_DECLARATION_VERSION,declaration:CLINICAL_DECLARATION,summary}};
  if(reviewed.blockers.length)fail('clinical_requirements_pending',reviewed.blockers.map(x=>x.message).join(' '));
  if(reviewed.reviewHash!==p.review_hash)fail('clinical_review_changed','Os documentos, a conta profissional ou a consulta mudaram. Reabra a revisão.',409);
  const state=reviewed.next;state.revision=request.expected_revision+1;state.auditLog.push({id:request.operation_id,at:reviewed.stamp,action:'Conclusão clínica confirmada pela profissional',revision:state.revision,actorId:ctx.userId});
  const saved=await repository.completeClinical({...actor(ctx),p_operation:request.operation_id,p_fingerprint:fingerprint,p_expected:request.expected_revision,p_patient:request.patient_id,p_visit:request.visit_id,p_profile:reviewed.profile.id,p_policy:reviewed.policy.id,p_policy_ids:reviewed.policies.map(p=>p.id),p_documents:reviewed.documents,p_review_hash:reviewed.reviewHash,p_declaration_version:CLINICAL_DECLARATION_VERSION,p_declaration:CLINICAL_DECLARATION,p_state:state,p_state_hash:await hash(stable(state))});
  return {workspace:envelope(saved.workspace),signature:saved.signature,operation:{id:request.operation_id,kind:'clinical_completion',status:'committed',replayed:saved.replayed===true}};
 };
}
