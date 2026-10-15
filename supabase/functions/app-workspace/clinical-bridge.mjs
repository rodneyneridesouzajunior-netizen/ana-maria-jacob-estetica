// Links received originals to the isolated workspace. This is never clinical authorization.
import {fail,hash,stable,uuid,validId} from './rules.mjs';
import {validCPF} from '../_shared/app-workspace-domain/patients-domain.mjs';
export const CLINICAL_ACTIONS=Object.freeze(['listar_documentos_originais','listar_vinculos_documentos','obter_documento_original','vincular_documento','status_vinculo_documento']);
const types={anamnese:'Ficha de anamnese',tcle_toxina_botulinica:'TCLE · Toxina botulínica',tcle_preenchimento_facial:'TCLE · Preenchimento facial',tcle_intradermoterapia_estetica:'Pré-avaliação · Intradermoterapia',tcle_bioestimulador_colageno:'Pré-avaliação · Bioestimulador',tcle_peeling_quimico:'Pré-avaliação · Peeling químico',tcle_fios_pdo:'Pré-avaliação · Fios de PDO'};
const kinds=['anamnese','documento_clinico'];
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const digits=x=>String(x||'').replace(/\D/g,'');
const name=x=>String(x||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').trim().replace(/\s+/g,' ');
const mask=(x,visible)=>{const d=digits(x);return d?'•'.repeat(Math.max(0,d.length-visible))+d.slice(-visible):'';};
const capabilities=Object.freeze({link_received:true,clinical_authorization:false,professional_signature:false});
function sourceId(p){if(!kinds.includes(p.source_kind)||!uuid(p.source_id))fail('invalid_document','Documento original inválido.');}
function binding(p){if(!validId(p.patient_id)||!validId(p.visit_id))fail('invalid_document_binding','Selecione paciente e consulta salvas.');}
function context(row,p,{editable=false}={}){binding(p);const patient=row?.state?.patients?.find(x=>x.id===p.patient_id),visit=row?.state?.visits?.find(x=>x.id===p.visit_id&&x.patientId===p.patient_id);if(!patient||!visit)fail('document_binding_not_found','A paciente e a consulta não foram encontradas neste ambiente.',404);if(editable&&(visit.status==='concluido'||visit.status==='cancelado'||visit.lockedAt))fail('document_visit_locked','A consulta está encerrada. Preserve o histórico e utilize uma consulta aberta.',409);return {patient,visit};}
export function describeClinicalSource(source,patient){
 if(!source||!kinds.includes(source.source_kind)||!uuid(source.source_id)||!types[source.type]||!hex(source.source_fingerprint))fail('invalid_document_source','Não foi possível verificar o documento original.',503);
 const identity=source.identity||{},cpf=digits(identity.cpf),target=digits(patient?.cpf),matching={cpf_matches:!!patient&&cpf.length===11&&validCPF(cpf)&&target===cpf,name_matches:!!patient&&name(identity.name).length>=2&&name(identity.name)===name(patient.name),birth_matches:!identity.birth_date||!patient?.birthDate||identity.birth_date===patient.birthDate};
 const blockers=[];if(source.status!=='recebido')blockers.push('source_not_received');if(source.archived)blockers.push('source_archived');if(source.withdrawn)blockers.push('source_withdrawn');if(!source.source_version||![source.source_hash,source.signature_sha256,source.pdf_sha256,source.registry_sha256].every(hex)||!source.storage_valid)blockers.push('source_integrity_incomplete');
 if(!patient)blockers.push('patient_selection_required');else {if(target.length!==11||!validCPF(target))blockers.push('patient_cpf_required');else if(!matching.cpf_matches)blockers.push('identity_cpf_mismatch');if(!matching.name_matches)blockers.push('identity_name_mismatch');if(!matching.birth_matches)blockers.push('identity_birth_mismatch');}
 return {source_kind:source.source_kind,source_id:source.source_id,type:source.type,title:types[source.type],status:source.status,source_version:source.source_version,source_hash:source.source_hash,signature_sha256:source.signature_sha256,pdf_sha256:source.pdf_sha256,source_fingerprint:source.source_fingerprint,received_at:source.received_at,identity:{name:String(identity.name||''),cpf_masked:mask(cpf,2),birth_date:identity.birth_date||'',phone_masked:mask(identity.phone,4)},archived:source.archived===true,withdrawn:source.withdrawn===true,eligible_for_link:blockers.length===0,blockers,matching,clinical_authorization:false};
}
export function createClinicalBridge({repository,authorize}){
 const actor=ctx=>({p_clinic:ctx.clinicId,p_actor:ctx.userId,p_session:ctx.sessionId});
 return async function clinical(p,ctx,req){const a=actor(ctx);
  if(p.acao==='status_vinculo_documento'){if(!uuid(p.operation_id))fail('invalid_operation','Identificador de operação inválido.');const prior=await repository.clinicalOperation({...a,p_operation:p.operation_id});return {operation:prior?{id:p.operation_id,kind:'document_link',status:'committed',result:{link:prior.link,workspace_revision:prior.workspace_revision}}:null};}
  if(p.acao==='listar_vinculos_documentos'){const row=await repository.load(ctx.clinicId);context(row,p);return {links:await repository.clinicalLinks({...a,p_patient:p.patient_id,p_visit:p.visit_id}),workspace_revision:row.revision,capabilities};}
  if(p.acao==='listar_documentos_originais'){
   const limit=p.limit??25,offset=p.offset??0,search=p.search??'';if(!Number.isInteger(limit)||limit<1||limit>50||!Number.isInteger(offset)||offset<0||offset>10000||typeof search!=='string'||search.length>120)fail('invalid_document_filters','Confira a busca e a página de documentos.');
   let patient;if(p.patient_id!==undefined||p.visit_id!==undefined)patient=context(await repository.load(ctx.clinicId),p).patient;
   const rows=await repository.clinicalList({...a,p_search:search.trim(),p_limit:limit+1,p_offset:offset});return {documents:rows.slice(0,limit).map(s=>describeClinicalSource(s,patient)),pagination:{limit,offset,has_more:rows.length>limit},capabilities};
  }
  sourceId(p);if(!hex(p.expected_source_fingerprint))fail('document_fingerprint_required','Reabra o documento original antes de continuar.');
  if(p.acao==='obter_documento_original'){
   const source=await repository.clinicalSource({...a,p_kind:p.source_kind,p_id:p.source_id});if(!source)fail('document_not_found','Documento não encontrado nesta clínica.',404);if(source.source_fingerprint!==p.expected_source_fingerprint)fail('document_source_changed','O documento mudou. Atualize a lista antes de abrir.',409);
   const document=describeClinicalSource(source);if(source.status!=='recebido'||!source.storage_valid||!hex(source.pdf_sha256))fail('document_not_ready','O original ainda não tem um PDF recebido verificável.',409);
   await repository.verifyClinicalObject(source,'pdf');const url=await repository.signClinical(source);return {document,pdf:{url,sha256:source.pdf_sha256,expires_in:120}};
  }
  if(p.acao!=='vincular_documento')fail('unsupported_action','Operação não reconhecida.');
  binding(p);if(!uuid(p.operation_id)||!Number.isSafeInteger(p.expected_revision)||p.expected_revision<0||p.confirmed_identity!==true||typeof p.reason!=='string'||p.reason.trim().length<3||p.reason.trim().length>500||/[\x00-\x1f]/.test(p.reason))fail('invalid_document_link','Confira a revisão, a confirmação da identidade e o motivo do vínculo.');
  await authorize(req,ctx,{operationId:p.operation_id,targetId:ctx.clinicId,action:'app_workspace_document_link'});
  const request={expected_revision:p.expected_revision,patient_id:p.patient_id,visit_id:p.visit_id,source_kind:p.source_kind,source_id:p.source_id,expected_source_fingerprint:p.expected_source_fingerprint,confirmed_identity:true,reason:p.reason.trim()},fingerprint=await hash(stable(request)),prior=await repository.clinicalOperation({...a,p_operation:p.operation_id});
  if(prior){if(prior.fingerprint!==fingerprint)fail('operation_reused','Esta operação já foi utilizada com outros dados.',409);return {link:prior.link,workspace_revision:prior.workspace_revision,operation:{id:p.operation_id,kind:'document_link',status:'committed',replayed:true}};}
  const row=await repository.load(ctx.clinicId);if(row?.revision!==p.expected_revision)fail('revision_conflict','Outra alteração foi salva. Preserve a seleção e atualize a consulta.',409);const {patient}=context(row,p,{editable:true});
  const source=await repository.clinicalSource({...a,p_kind:p.source_kind,p_id:p.source_id});if(!source)fail('document_not_found','Documento não encontrado nesta clínica.',404);if(source.source_fingerprint!==p.expected_source_fingerprint)fail('document_source_changed','O documento mudou. Confira o original novamente.',409);const described=describeClinicalSource(source,patient);if(!described.eligible_for_link)fail(described.blockers[0], 'Não é possível vincular: confira recebimento, identidade, integridade e situação do original.');
  await repository.verifyClinicalObject(source,'pdf');await repository.verifyClinicalObject(source,'signature');
  const saved=await repository.linkClinical({...a,p_operation:p.operation_id,p_fingerprint:fingerprint,p_expected:p.expected_revision,p_patient:p.patient_id,p_visit:p.visit_id,p_kind:p.source_kind,p_id:p.source_id,p_source_fingerprint:p.expected_source_fingerprint,p_reason:p.reason.trim()});
  return {link:saved.link,workspace_revision:saved.workspace_revision,operation:{id:p.operation_id,kind:'document_link',status:'committed',replayed:saved.replayed===true}};
 };
}
