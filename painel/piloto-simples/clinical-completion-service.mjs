import {PUBLIC_BACKEND} from './integration/public-backend.mjs';
import {IntegrationError} from './integration/errors.mjs';
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v);
const copy=v=>structuredClone(v);
const fail=(code,message,options)=>{throw new IntegrationError(code,message,options);};
const actions=new Set(['listar_configuracao_clinica','configurar_conta_profissional','configurar_documentos_procedimento','preparar_conclusao_clinica','concluir_consulta_clinica','status_conclusao_clinica','status_configuracao_clinica']);
const knownRejections=new Set(['clinical_configuration_invalid','clinical_procedure_missing','clinical_policy_mismatch','clinical_policy_required','clinical_confirmation_required','invalid_clinical_completion','clinical_requirements_pending','clinical_review_changed','clinical_visit_missing','clinical_visit_locked','clinical_procedure_snapshot_required','revision_conflict','operation_reused','invalid_workspace_state','clinical_professional_missing','clinical_professional_unavailable','clinical_completion_invalid','clinical_professional_changed','clinical_policy_changed','clinical_documents_incomplete','clinical_document_changed','document_integrity_invalid','document_source_missing','document_source_unavailable','document_deletion_in_progress','document_binding_invalid']);
export function createClinicalCompletionService({session,request,fetchImpl=globalThis.fetch,uuidFactory=()=>crypto.randomUUID(),timeoutMs=25000}={}){
 if(!session?.requireReady||!session?.assertCurrent||!session?.subscribe)fail('session_required','Entre com a conta da clínica.');
 let closed=false,generation=0,clinicId=null,pending=null,prepared=null,busy=false;const controllers=new Set();
 const stop=()=>{closed=true;generation++;pending=null;prepared=null;busy=false;for(const c of controllers)c.abort();controllers.clear();};
 const unsubscribe=session.subscribe(stop),check=g=>{if(closed||g!==generation)fail('session_closed','A sessão mudou. A resposta foi descartada.');};
 async function call(action,data={},write=false){
  if(!actions.has(action))fail('unsupported_operation','Operação clínica não reconhecida.');
  const g=generation;check(g);const captured=copy(data),auth=await session.requireReady();check(g);const controller=new AbortController();controllers.add(controller);let expired=false;const timer=setTimeout(()=>{expired=true;controller.abort();},timeoutMs);
  try{let result;
   if(request)result=await request('app-workspace',action,captured,{signal:controller.signal});
   else {const response=await fetchImpl(PUBLIC_BACKEND.supabaseUrl+'/functions/v1/app-workspace',{method:'POST',headers:{Authorization:'Bearer '+auth.token,apikey:PUBLIC_BACKEND.publishableKey,'Content-Type':'application/json'},body:JSON.stringify({...captured,acao:action}),signal:controller.signal,credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer'});
    check(g);await session.assertCurrent(auth);check(g);
    if([401,403].includes(response.status)){stop();session.invalidate?.('clinical_access_denied');fail('access_denied','Entre novamente com sua conta pessoal e o autenticador.',{status:response.status});}
    try{result=await response.json();}catch{fail('invalid_response','Não foi possível confirmar a resposta do serviço.',{uncertain:write});}
    if(!response.ok){const rejected=write&&[404,409,422].includes(response.status)&&result.ok===false&&knownRejections.has(result.codigo);const error=new IntegrationError(result.codigo||'service_error',typeof result.erro==='string'?result.erro.slice(0,1000):'Não foi possível confirmar a operação.',{status:response.status,uncertain:write&&!rejected});error.definitiveRejection=rejected;throw error;}
   }
   check(g);await session.assertCurrent(auth);check(g);if(expired)fail('timeout','O serviço demorou. Confira a gravação antes de repetir.',{uncertain:write});
   if(!plain(result)||result.ok!==true||result.auth_method!=='supabase_auth'||result.role!=='owner'||!uuid(result.clinic_id)||clinicId&&result.clinic_id!==clinicId){stop();session.invalidate?.('clinical_context_changed');fail('unexpected_auth_context','O serviço não confirmou a clínica e a conta atuais.');}
   clinicId=result.clinic_id;return result;
  }catch(error){if(error instanceof IntegrationError)throw error;check(g);fail('connection_failed',write?'Resultado ainda não confirmado. Confira a gravação ou reenvie a mesma operação.':'Não foi possível consultar a clínica. Tente novamente.',{uncertain:write});}
  finally{clearTimeout(timer);controllers.delete(controller);}
 }
 function receipt(result,job){
  if(job.action==='concluir_consulta_clinica'){
   if(result.operation?.id!==job.payload.operation_id||result.operation?.kind!=='clinical_completion'||result.operation?.status!=='committed'||result.signature?.id!==job.payload.operation_id||result.signature?.patient_id!==job.payload.patient_id||result.signature?.visit_id!==job.payload.visit_id||result.signature?.review_hash!==job.payload.review_hash||result.signature?.signature_method!=='authenticated_session_mfa'||result.workspace?.revision!==job.payload.expected_revision+1||result.signature?.workspace_revision!==result.workspace.revision||result.workspace?.state?.visits?.find(v=>v.id===job.payload.visit_id)?.status!=='concluido')fail('invalid_receipt','A conclusão esperada não foi confirmada. Confira a gravação.',{uncertain:true});
  }else{const c=result.configuration;if(!c||c.id!==job.payload.operation_id||c.version!==job.payload.expected_version+1||c.status!==job.payload.status||job.action==='configurar_conta_profissional'&&(c.professional_id!==job.payload.professional_id||c.user_id!==job.payload.member_id)||job.action==='configurar_documentos_procedimento'&&(c.procedure_id!==job.payload.procedure_id||c.procedure_version!==job.payload.procedure_version))fail('invalid_receipt','A configuração esperada não foi confirmada. Reenvie a mesma operação.',{uncertain:true});}
  pending=null;prepared=null;return result;
 }
 async function send(){check(generation);if(busy)fail('clinical_busy','Aguarde a operação atual.');if(!pending)fail('no_pending_operation','Nenhuma operação pendente.');const job=pending;busy=true;try{return receipt(await call(job.action,job.payload,true),job);}catch(error){if(error.definitiveRejection&&pending===job)pending=null;throw error;}finally{busy=false;}}
 function start(action,payload){if(pending||busy)fail('clinical_pending','Confira a operação anterior antes de iniciar outra.');const operation_id=uuidFactory();if(!uuid(operation_id))fail('invalid_operation','Não foi possível identificar a operação.');pending={action,payload:{...copy(payload),operation_id}};return send();}
 return Object.freeze({session,
  settings:()=>call('listar_configuracao_clinica'),
  configureProfile:data=>start('configurar_conta_profissional',data),
  configurePolicy:data=>start('configurar_documentos_procedimento',data),
  async prepare(data){check(generation);if(pending||busy)fail('clinical_pending','Confira a operação pendente antes de revisar.');const operation_id=uuidFactory();if(!uuid(operation_id))fail('invalid_operation','Identificador inválido.');const payload={...copy(data),operation_id},g=generation;busy=true;try{const result=await call('preparar_conclusao_clinica',payload);check(g);const r=result.review;if(!r||typeof r.ready!=='boolean'||!Array.isArray(r.blockers)||!/^[a-f0-9]{64}$/.test(r.review_hash||'')||r.workspace_revision!==payload.expected_revision||typeof r.declaration!=='string'||typeof r.declaration_version!=='string')fail('invalid_review','A revisão não corresponde à versão solicitada.');prepared={payload,review:copy(r)};return copy(r);}finally{busy=false;}},
  confirm({confirmed=false}={}){check(generation);if(!confirmed||!prepared?.review.ready)fail('clinical_confirmation_required','Leia a revisão e confirme pessoalmente a declaração.');if(pending||busy)fail('clinical_pending','Confira a operação pendente.');pending={action:'concluir_consulta_clinica',payload:{...prepared.payload,review_hash:prepared.review.review_hash,declaration_version:prepared.review.declaration_version,confirmed:true}};return send();},
  retry:()=>send(),
  async resolve(){check(generation);if(busy||!pending)fail('clinical_pending','Não há operação disponível para conferência.');const job=pending;if(job.action!=='concluir_consulta_clinica'){busy=true;try{const result=await call('status_configuracao_clinica',{operation_id:job.payload.operation_id,kind:job.action==='configurar_conta_profissional'?'profile':'policy'});if(result.configuration===null)return {pending:true};return receipt(result,job);}finally{busy=false;}}busy=true;try{const result=await call('status_conclusao_clinica',{operation_id:job.payload.operation_id});if(result.operation===null)return {pending:true};const op=result.operation;if(op?.id!==job.payload.operation_id||op.kind!=='clinical_completion'||op.status!=='committed')fail('invalid_receipt','O serviço retornou outra operação.',{uncertain:true});return receipt({...op.result,operation:op},job);}finally{busy=false;}},
  getPending:()=>pending?copy(pending):null,isBusy:()=>busy,
  discardPrepared(){if(pending||busy)fail('clinical_pending','Confira a gravação antes de sair.');prepared=null;},
  dispose(){stop();unsubscribe?.();},
 });
}
