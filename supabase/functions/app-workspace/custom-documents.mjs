import {reject,exact,uuid,identifier,canonical,digest,issueSnapshot,describeIssue} from '../_shared/custom-documents.mjs';
export const CUSTOM_DOCUMENT_ACTIONS=Object.freeze(['emitir_documento_paciente','listar_emissoes_documento','revogar_documento_paciente','obter_pdf_documento_paciente']);
const actor=ctx=>({p_clinic:ctx.clinicId,p_actor:ctx.userId,p_session:ctx.sessionId});
export function createCustomDocuments({repository,authorize,now=()=>new Date().toISOString()}){
 const described=async row=>({...describeIssue(row),...(!row.revoked_at&&Date.parse(row.expires_at)>Date.now()?{public_url:await repository.customPublicURL(row)}:{})});
 return async(p,ctx,req)=>{
  const a=actor(ctx);
  if(p.acao==='listar_emissoes_documento'){exact(p,['acao','document_id']);if(!identifier(p.document_id))reject('custom_binding_invalid','Selecione um documento preparado.');const rows=await repository.customIssues({...a,p_document:p.document_id});return{issues:await Promise.all(rows.map(described))};}
  if(p.acao==='obter_pdf_documento_paciente'){exact(p,['acao','issue_id']);if(!uuid(p.issue_id))reject('custom_binding_invalid','Selecione uma emissão.');const row=await repository.customIssue({...a,p_id:p.issue_id});if(!row?.received_at)reject('custom_not_received','Este documento ainda não foi recebido.',409);return{issue:describeIssue(row),pdf:await repository.customOriginalPDF(row)};}
  if(p.acao==='revogar_documento_paciente'){
   exact(p,['acao','operation_id','issue_id']);if(!uuid(p.operation_id)||!uuid(p.issue_id))reject('custom_binding_invalid','Confira a emissão selecionada.');await authorize(req,ctx,{operationId:p.operation_id,targetId:ctx.clinicId,action:'app_custom_document_revoke'});
   const row=await repository.customRevoke({...a,p_operation:p.operation_id,p_id:p.issue_id});return{issue:describeIssue(row),operation:{id:p.operation_id,kind:'custom_document_revoke',status:'committed'}};
  }
  exact(p,['acao','operation_id','expected_revision','document_id','expires_in_days']);const days=p.expires_in_days??7;
  if(!uuid(p.operation_id)||!identifier(p.document_id)||!Number.isSafeInteger(p.expected_revision)||p.expected_revision<1||!Number.isInteger(days)||days<1||days>30)reject('custom_issue_invalid','Confira documento, revisão e validade entre 1 e 30 dias.');
  await authorize(req,ctx,{operationId:p.operation_id,targetId:ctx.clinicId,action:'app_custom_document_issue'});
  const request_hash=await digest(canonical({document_id:p.document_id,expected_revision:p.expected_revision,expires_in_days:days}));
  let row=await repository.customIssue({...a,p_id:p.operation_id});
  if(row){if(row.request_hash!==request_hash)reject('custom_operation_reused','Esta operação já emitiu outro documento.',409);}
  else{
   const workspace=await repository.load(ctx.clinicId);if(workspace?.revision!==p.expected_revision)reject('revision_conflict','O prontuário mudou. Atualize antes de emitir.',409);
   const document=workspace.state.documentResponses?.find(d=>d.id===p.document_id),patient=workspace.state.patients?.find(x=>x.id===document?.patientId),visit=workspace.state.visits?.find(x=>x.id===document?.visitId);
   const stamp=now(),snapshot=issueSnapshot(document,patient,visit,{now:stamp}),candidate={...snapshot,id:p.operation_id,clinic_id:ctx.clinicId,token_nonce:crypto.randomUUID(),expires_at:new Date(Date.parse(stamp)+days*86400000).toISOString()};
   candidate.snapshot_hash=await digest(canonical(snapshot));candidate.token_hash=await repository.customTokenHash(candidate);
   row=await repository.customIssueCreate({...a,p_operation:p.operation_id,p_expected:p.expected_revision,p_request_hash:request_hash,p_snapshot:candidate});
  }
  return{issue:await described(row),operation:{id:p.operation_id,kind:'custom_document_issue',status:'committed'}};
 };
}
