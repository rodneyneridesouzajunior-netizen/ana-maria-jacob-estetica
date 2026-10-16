import {PUBLIC_BACKEND} from './integration/public-backend.mjs';
import {IntegrationError} from './integration/errors.mjs';

// CRM is read-only. The single write associates a received original with a
// consultation; its receipt never represents clinical approval or a signature.
const ACTIONS=Object.freeze({
  'app-workspace':Object.freeze(['listar_documentos_originais','listar_vinculos_documentos','obter_documento_original','vincular_documento','status_vinculo_documento']),
  'crm-fichas':Object.freeze(['listar_solicitacoes_site']),
});
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const id=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(v);
const failure=(code,message,options)=>new IntegrationError(code,message,options);
// A proxy timeout/rate limit is not proof that the Edge transaction failed.
// Only the known app-workspace rejection contract can release its operation ID.
const LINK_REJECTIONS=Object.freeze({
  404:Object.freeze(['document_not_found','document_binding_not_found','document_source_missing']),
  409:Object.freeze(['revision_conflict','operation_reused','document_visit_locked','document_source_changed','document_integrity_invalid','document_deletion_in_progress']),
  413:Object.freeze(['body_too_large']),
  422:Object.freeze(['invalid_document','invalid_document_binding','document_fingerprint_required','invalid_document_link','document_source_unavailable','document_identity_mismatch','document_binding_invalid','document_link_invalid','invalid_workspace_state','source_not_received','source_archived','source_withdrawn','source_integrity_incomplete','patient_cpf_required','identity_cpf_mismatch','identity_name_mismatch','identity_birth_mismatch']),
});
const definitiveLinkRejection=(status,result)=>plain(result)&&result.ok===false&&LINK_REJECTIONS[status]?.includes(result.codigo)===true;
// Show only known diagnostic copy. Never render a raw server error (which may
// contain private paths), and do not mistake an unavailable historical PDF for CAS.
const READ_ERRORS=Object.freeze({
 document_source_changed:[409,'O documento foi alterado desde a consulta. Atualize a lista e abra novamente.'],
 document_not_ready:[409,'Este registro ainda não tem um PDF disponível para leitura. Confira o original no painel operacional.'],
 document_integrity_invalid:[[409,422],'O arquivo não passou na conferência de integridade. O original foi preservado; confira-o no painel operacional.'],
 document_file_missing:[404,'O PDF registrado não foi encontrado no armazenamento. Confira o original no painel operacional.'],
});
const assertPayload=(v,allowed)=>{if(!plain(v)||Object.keys(v).some(k=>!allowed.includes(k)))throw failure('invalid_payload','Os filtros desta consulta não são válidos.');};
function binding(v){if(!id(v.patient_id)||!id(v.visit_id))throw failure('invalid_context','Selecione uma paciente e uma consulta salvas.');return{patient_id:v.patient_id,visit_id:v.visit_id};}
function page(v,max=50){const limit=v.limit??25,offset=v.offset??0;if(!Number.isInteger(limit)||limit<1||limit>max||!Number.isInteger(offset)||offset<0||offset>10000)throw failure('invalid_page','A página solicitada não é válida.');return{limit,offset};}

export function createClinicalBridgeService({session,request,fetchImpl=globalThis.fetch,timeoutMs=15000,uuidFactory=()=>crypto.randomUUID()}={}){
  if(!session?.requireReady||!session?.assertCurrent||!session?.subscribe)throw failure('session_required','O acesso individual precisa estar ativo.');
  if(request!==undefined&&typeof request!=='function')throw failure('invalid_transport','Transporte de consulta inválido.');
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000)throw failure('invalid_timeout','Prazo da consulta inválido.');
  let closed=false,generation=0,clinicId=null,pendingLink=null,linkBusy=false;
  const controllers=new Set();
  const stop=()=>{closed=true;generation++;clinicId=null;pendingLink=null;linkBusy=false;for(const c of controllers)c.abort();controllers.clear();};
  const unsubscribe=session.subscribe(stop);
  const check=turn=>{if(closed||turn!==generation)throw failure('session_closed','O acesso mudou. A resposta foi descartada.');};
  const invalidate=code=>{stop();session.invalidate?.(code);};
  async function call(endpoint,action,payload){
    if(!ACTIONS[endpoint]?.includes(action))throw failure('unsupported_operation','Esta operação não faz parte da consulta de originais.');
    const turn=generation,write=action==='vincular_documento';check(turn);
    // Freeze the selected IDs/filters before any credential lookup can yield.
    const captured=JSON.parse(JSON.stringify(payload)),body=JSON.stringify({...captured,acao:action});
    const auth=await session.requireReady();check(turn);
    const controller=new AbortController();controllers.add(controller);let timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);
    try{
      let result;
      if(request){result=await request(endpoint,action,captured,{signal:controller.signal});}
      else{
        const response=await fetchImpl(`${PUBLIC_BACKEND.supabaseUrl}/functions/v1/${endpoint}`,{
          method:'POST',headers:{Authorization:`Bearer ${auth.token}`,apikey:PUBLIC_BACKEND.publishableKey,Accept:'application/json','Content-Type':'application/json'},
          body,signal:controller.signal,credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',
        });
        check(turn);await session.assertCurrent(auth);check(turn);
        // Even an HTML gateway denial must revoke the session, before parsing.
        if(response.status===401||response.status===403){invalidate(`http_${response.status}`);throw failure('access_denied','A sessão não foi aceita. Entre novamente com sua conta e autenticador.',{status:response.status});}
        try{result=await response.json();}catch{throw failure('invalid_response','O serviço retornou uma resposta inesperada.',{status:response.status,uncertain:write});}
        check(turn);await session.assertCurrent(auth);check(turn);
        if(!response.ok){
          const rejected=write&&definitiveLinkRejection(response.status,result);
          const knownRead=!write&&plain(result)&&result.ok===false&&[].concat(READ_ERRORS[result.codigo]?.[0]||[]).includes(response.status)?READ_ERRORS[result.codigo]:null;
          const message=knownRead?knownRead[1]:write&&!rejected?'O resultado do vínculo não foi confirmado. Confira a gravação antes de repetir.':response.status===409?'O original ou o contexto mudou. Preserve a seleção e atualize a consulta antes de tentar novamente.':response.status===422?(write?'O servidor recusou o vínculo. Confira identidade, recebimento e situação do original.':'Os filtros ou a consulta não foram aceitos pelo serviço.'):response.status===404?'O registro ou a consulta ainda não está disponível neste serviço. Use o painel operacional.':write?'O servidor recusou este envio. Confira os dados antes de continuar.':'Não foi possível consultar os registros. Tente atualizar ou use o painel operacional.';
          throw Object.assign(failure(knownRead?result.codigo:`http_${response.status}`,message,{status:response.status,uncertain:write&&!rejected}),{definitiveLinkRejection:rejected});
        }
      }
      check(turn);await session.assertCurrent(auth);check(turn);
      if(timedOut)throw failure('timeout',write?'O resultado do vínculo não foi confirmado. Confira a gravação.':'A consulta demorou mais que o esperado. Tente atualizar.',{uncertain:write});
      if(!plain(result)||result.ok===false||result.erro||result.auth_method!=='supabase_auth'||result.role!=='owner'||endpoint==='app-workspace'&&(result.ok!==true||!uuid(result.clinic_id))){
        invalidate('unexpected_auth_context');throw failure('unexpected_auth_context','O serviço não confirmou o acesso à clínica. Entre novamente.');
      }
      // The established CRM response does not expose a clinic ID. Its fixed
      // endpoint validates membership; do not invent that response field.
      if(endpoint==='app-workspace'){
        if(clinicId&&clinicId!==result.clinic_id){invalidate('clinic_changed');throw failure('clinic_changed','A clínica mudou durante a consulta. Entre novamente.');}
        clinicId=result.clinic_id;
      }
      return result;
    }catch(error){
      if(error instanceof IntegrationError)throw error;
      check(turn);
      throw failure(timedOut?'timeout':'connection_failed',write?'O resultado do vínculo não foi confirmado. Confira a gravação antes de repetir.':timedOut?'A consulta demorou mais que o esperado. Tente atualizar.':'Não foi possível consultar o serviço. Confira a conexão e tente atualizar.',{uncertain:write});
    }finally{clearTimeout(timer);controllers.delete(controller);}
  }
  function confirmReceipt(result,payload,{status=false}={}){
    const op=result?.operation,receipt=status?op?.result:result,l=receipt?.link;
    if(!op||op.id!==payload.operation_id||op.kind!=='document_link'||op.status!=='committed'||!l||l.id!==payload.operation_id||
      l.patient_id!==payload.patient_id||l.visit_id!==payload.visit_id||l.source_kind!==payload.source_kind||l.source_id!==payload.source_id||
      l.source_fingerprint!==payload.expected_source_fingerprint||l.status!=='vinculado_recebido'||l.clinical_authorization!==false||
      receipt.workspace_revision!==payload.expected_revision)throw failure('invalid_link_receipt','O servidor não confirmou o vínculo esperado. Confira a gravação antes de continuar.',{uncertain:true});
    pendingLink=null;return{link:l,operation:op,workspace_revision:receipt.workspace_revision};
  }
  async function sendPending(){
    check(generation);if(linkBusy)throw failure('link_busy','Aguarde a conferência do vínculo.');
    if(!pendingLink||pendingLink.rejected)throw failure('no_pending_link','Não há vínculo incerto para reenviar.');
    const selected=pendingLink,turn=generation;linkBusy=true;
    try{const result=await call('app-workspace','vincular_documento',selected.payload);check(turn);return confirmReceipt(result,selected.payload);}
    catch(error){if(!closed&&pendingLink===selected){selected.code=error.code||'connection_failed';selected.rejected=error.definitiveLinkRejection===true;}throw error;}
    finally{if(turn===generation)linkBusy=false;}
  }
  return Object.freeze({source:'workspace',session,
    listDocuments(v={}){assertPayload(v,['patient_id','visit_id','search','limit','offset']);const search=v.search??'';if(typeof search!=='string'||search.length>120)throw failure('invalid_search','A busca deve ter até 120 caracteres.');return call('app-workspace','listar_documentos_originais',{...page(v),search:search.trim(),...(v.patient_id!==undefined||v.visit_id!==undefined?binding(v):{})});},
    listLinks(v){assertPayload(v,['patient_id','visit_id']);return call('app-workspace','listar_vinculos_documentos',binding(v));},
    openDocument(v){assertPayload(v,['source_kind','source_id','expected_source_fingerprint']);if(!['anamnese','documento_clinico'].includes(v.source_kind)||!uuid(v.source_id)||!/^([a-f0-9]{64})$/.test(v.expected_source_fingerprint||''))throw failure('invalid_document','Atualize a lista e selecione um documento original válido.');return call('app-workspace','obter_documento_original',{source_kind:v.source_kind,source_id:v.source_id,expected_source_fingerprint:v.expected_source_fingerprint});},
    listSiteRequests(v={}){assertPayload(v,['status','limit','offset']);const status=v.status??'pending';if(!['pending','accepted','archived','all'].includes(status))throw failure('invalid_status','O filtro de solicitações não é válido.');return call('crm-fichas','listar_solicitacoes_site',{...page(v,100),status});},
    linkDocument(v){
      check(generation);if(linkBusy||pendingLink)throw failure('pending_link','Confira o vínculo anterior antes de iniciar outro.');
      assertPayload(v,['expected_revision','patient_id','visit_id','source_kind','source_id','expected_source_fingerprint','confirmed_identity','reason']);binding(v);
      if(!Number.isSafeInteger(v.expected_revision)||v.expected_revision<1||!['anamnese','documento_clinico'].includes(v.source_kind)||!uuid(v.source_id)||!/^[a-f0-9]{64}$/.test(v.expected_source_fingerprint||'')||v.confirmed_identity!==true||typeof v.reason!=='string'||v.reason.trim().length<3||v.reason.trim().length>500||/[\x00-\x1f]/.test(v.reason))throw failure('invalid_link','Confira a identidade e informe um motivo de 3 a 500 caracteres.');
      const operation_id=uuidFactory();if(!uuid(operation_id))throw failure('invalid_operation','Não foi possível identificar a operação de vínculo.');
      pendingLink={payload:{...v,reason:v.reason.trim(),operation_id},rejected:false};return sendPending();
    },
    retryLink:()=>sendPending(),
    async resolveLink(){
      check(generation);if(linkBusy)throw failure('link_busy','Aguarde a conferência do vínculo.');
      if(!pendingLink)throw failure('no_pending_link','Não há vínculo pendente para conferir.');
      if(pendingLink.rejected)throw failure('link_rejected','O vínculo foi recusado. Atualize a consulta mantendo a seleção.');
      const selected=pendingLink,turn=generation;linkBusy=true;
      try{const result=await call('app-workspace','status_vinculo_documento',{operation_id:selected.payload.operation_id});check(turn);if(result.operation===null)return{pending:true};return confirmReceipt(result,selected.payload,{status:true});}
      finally{if(turn===generation)linkBusy=false;}
    },
    getPendingLink:()=>pendingLink?structuredClone(pendingLink):null,
    isLinkBusy:()=>linkBusy,
    discardRejectedLink(){check(generation);if(linkBusy||pendingLink&&!pendingLink.rejected)throw failure('pending_link','Confira a gravação incerta antes de descartar a operação.');pendingLink=null;},
    dispose(){if(closed){unsubscribe?.();return;}stop();unsubscribe?.();},
  });
}
