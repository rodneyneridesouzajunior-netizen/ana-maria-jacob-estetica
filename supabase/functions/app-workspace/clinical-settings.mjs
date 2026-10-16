import {fail,hash,stable,uuid,validId} from './rules.mjs';
import {validateClinicalPolicy} from './clinical-completion.mjs';
export const CLINICAL_SETTINGS_ACTIONS=Object.freeze(['listar_configuracao_clinica','configurar_conta_profissional','configurar_documentos_procedimento','status_configuracao_clinica']);
const actor=ctx=>({p_clinic:ctx.clinicId,p_actor:ctx.userId,p_session:ctx.sessionId});
const allowed=(p,keys)=>{if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!['acao',...keys].includes(k)))fail('clinical_configuration_invalid','A configuração contém campos não reconhecidos.');};
function common(p){if(!uuid(p.operation_id)||!Number.isSafeInteger(p.expected_version)||p.expected_version<0||!['active','revoked'].includes(p.status)||typeof p.reason!=='string'||p.reason.trim().length<3||p.reason.trim().length>500||/[\x00-\x1f]/.test(p.reason)||p.confirmed!==true)fail('clinical_configuration_invalid','Confira a seleção, a versão e o motivo; confirme a configuração explicitamente.');}
export function createClinicalSettings({repository,authorize}){
 return async function clinicalSettings(p,ctx,req){
  if(p.acao==='listar_configuracao_clinica'){allowed(p,[]);return {settings:await repository.clinicalSettings(actor(ctx))};}
  if(p.acao==='status_configuracao_clinica'){allowed(p,['operation_id','kind']);if(!uuid(p.operation_id)||!['profile','policy'].includes(p.kind))fail('clinical_configuration_invalid','Confira o identificador e o tipo de configuração.');return {configuration:await repository.clinicalConfigurationOperation({...actor(ctx),p_operation:p.operation_id,p_kind:p.kind})};}
  if(p.acao==='configurar_conta_profissional'){
   allowed(p,['operation_id','professional_id','member_id','expected_version','status','reason','confirmed']);common(p);
   if(!validId(p.professional_id)||!uuid(p.member_id))fail('clinical_configuration_invalid','Selecione a profissional e uma conta existente da clínica.');
   await authorize(req,ctx,{operationId:p.operation_id,targetId:ctx.clinicId,action:'app_workspace_clinical_profile'});
   return {configuration:await repository.configureClinicalProfile({...actor(ctx),p_operation:p.operation_id,p_professional:p.professional_id,p_member:p.member_id,p_expected_version:p.expected_version,p_status:p.status,p_reason:p.reason.trim()})};
  }
  if(p.acao==='configurar_documentos_procedimento'){
   allowed(p,['operation_id','procedure_id','procedure_version','requirements','expected_version','status','reason','confirmed']);common(p);
   if(!validId(p.procedure_id)||!Number.isSafeInteger(p.procedure_version)||p.procedure_version<1||!Array.isArray(p.requirements)||p.requirements.length>100||p.requirements.some(r=>!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).some(k=>!['template_id','source_type'].includes(k))))fail('clinical_configuration_invalid','Selecione uma versão de procedimento e os documentos oficiais correspondentes.');
   await authorize(req,ctx,{operationId:p.operation_id,targetId:ctx.clinicId,action:'app_workspace_clinical_policy'});
   // Recover the original receipt before looking at a newer catalog. A lost
   // response must not turn a committed historical policy into a new operation.
   const prior=await repository.clinicalConfigurationOperation({...actor(ctx),p_operation:p.operation_id,p_kind:'policy'});
   if(prior){if(prior.procedure_id!==p.procedure_id||prior.procedure_version!==p.procedure_version||prior.version!==p.expected_version+1||prior.status!==p.status||prior.reason!==p.reason.trim()||stable(prior.requirements)!==stable(p.requirements))fail('operation_reused','A chave já foi usada com outra configuração.',409);return {configuration:{...prior,replayed:true}};}
   const row=await repository.load(ctx.clinicId),state=row?.state;
   const procedure=state?.procedures?.find(x=>x.id===p.procedure_id&&x.version===p.procedure_version)||state?.visits?.map(v=>v.procedureSnapshot).find(x=>x?.id===p.procedure_id&&x.version===p.procedure_version);
   if(!procedure)fail('clinical_procedure_missing','A versão do procedimento não foi encontrada.');
   const checked=validateClinicalPolicy({status:'active',procedure_id:procedure.id,procedure_version:procedure.version,requirements:p.requirements},procedure,state.documentTemplates||[]);
   if(!checked.ok)fail(checked.code,checked.message);
   return {configuration:await repository.configureClinicalPolicy({...actor(ctx),p_operation:p.operation_id,p_procedure:procedure.id,p_procedure_version:procedure.version,p_procedure_hash:await hash(stable(procedure)),p_requirements:p.requirements,p_expected_version:p.expected_version,p_status:p.status,p_reason:p.reason.trim()})};
  }
  fail('unsupported_action','Configuração clínica não reconhecida.');
 };
}
