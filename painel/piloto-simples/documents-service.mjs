import {PUBLIC_BACKEND} from './integration/public-backend.mjs';
import {getClinicalBridge} from './clinical-bridge-runtime.mjs';

const uuid=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/i.test(value);
const copy=value=>structuredClone(value);
const services=new WeakMap();
const fail=(code,message,uncertain=false)=>Object.assign(new Error(message),{code,uncertain});
export function safeDocumentURL(raw,{publicPage=false}={}){
 const u=new URL(raw);const base=new URL(PUBLIC_BACKEND.supabaseUrl);
 if(publicPage){if(u.origin!=='https://anamariajacob.com.br'||u.pathname!=='/documento/'||u.search||!/^#token=[a-f0-9-]{36}\.[a-f0-9]{64}$/i.test(u.hash))throw Error('Link de assinatura não reconhecido.');}
 else if(u.origin!==base.origin||!u.pathname.startsWith('/storage/v1/object/sign/app-custom-documents/')||u.hash)throw Error('O servidor não confirmou o endereço do original.');
 return u.href;
}
/** One pending operation retains its exact ID and payload until the server
 * confirms it. An ambiguous timeout must never create a second emission. */
export function createDocumentsService({session,fetchImpl=globalThis.fetch,timeoutMs=25000,uuidFactory=()=>crypto.randomUUID()}={}){
 if(!session?.requireReady||!session?.assertCurrent||!session?.subscribe)throw Error('Sessão da clínica obrigatória.');
 let closed=false,generation=0,clinicId=null,pending=null,busy=false;
 const controllers=new Set();
 const check=g=>{if(closed||g!==generation)throw fail('session_closed','A sessão mudou. Entre novamente.');};
 const stop=()=>{closed=true;generation++;pending=null;for(const c of controllers)c.abort();controllers.clear();};
 const unsubscribe=session.subscribe(stop);
 async function call(action,data,write=false){
  const g=generation;check(g);const body=JSON.stringify({acao:action,...copy(data)}),auth=await session.requireReady();check(g);
  const controller=new AbortController();controllers.add(controller);let timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);
  try{
   const response=await fetchImpl(PUBLIC_BACKEND.supabaseUrl+'/functions/v1/app-workspace',{method:'POST',headers:{Authorization:'Bearer '+auth.token,apikey:PUBLIC_BACKEND.publishableKey,'Content-Type':'application/json'},body,signal:controller.signal,credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer'});
   check(g);await session.assertCurrent(auth);check(g);
   if([401,403].includes(response.status)){stop();session.invalidate?.('document_access_denied');throw fail('access_denied','Entre novamente com sua conta e autenticador.');}
   let result;try{result=await response.json();}catch{throw fail('invalid_response','A resposta não foi confirmada. Confira a emissão antes de repetir.',write);}
   check(g);await session.assertCurrent(auth);check(g);
   if(timedOut)throw fail('timeout','O resultado ainda não foi confirmado. Reenvie a mesma operação.',write);
   if(!response.ok||result?.ok!==true){
    const known=result?.ok===false&&typeof result.codigo==='string'&&[404,409,422].includes(response.status);
    const error=fail(result?.codigo||'server_error',known&&typeof result.erro==='string'?result.erro:'Não foi possível confirmar a operação. Tente novamente.',write&&!known);error.definitive=known;throw error;
   }
   if(result.auth_method!=='supabase_auth'||result.role!=='owner'||!uuid(result.clinic_id)||clinicId&&clinicId!==result.clinic_id){stop();throw fail('context_changed','A clínica não foi confirmada. Entre novamente.');}
   clinicId=result.clinic_id;return result;
  }catch(error){check(g);if(error.code)throw error;throw fail('connection_failed','A conexão caiu. Preserve esta janela e reenvie a mesma operação.',write);}
  finally{clearTimeout(timer);controllers.delete(controller);}
 }
 async function send(){check(generation);if(busy||!pending)throw fail('busy','Aguarde a operação atual.');busy=true;const job=pending;
  try{const result=await call(job.action,job.payload,true);const issue=result.issue,op=result.operation,kind=job.action==='emitir_documento_paciente'?'custom_document_issue':'custom_document_revoke';
   if(op?.id!==job.payload.operation_id||op.kind!==kind||op.status!=='committed'||job.action==='emitir_documento_paciente'&&issue?.id!==job.payload.operation_id)throw fail('invalid_receipt','A operação esperada não foi confirmada. Reenvie a mesma operação.',true);
   if(!issue||job.action==='emitir_documento_paciente'&&issue.document_id!==job.payload.document_id||job.action==='revogar_documento_paciente'&&issue.id!==job.payload.issue_id)throw fail('invalid_receipt','O servidor não confirmou o documento esperado. Reenvie a mesma operação.',true);
   if(issue.public_url)safeDocumentURL(issue.public_url,{publicPage:true});
   pending=null;return result;
  }catch(error){if(error.definitive&&pending===job)pending=null;throw error;}finally{busy=false;}
 }
 function start(action,data){if(pending||busy)throw fail('pending','Confira a emissão pendente antes de iniciar outra.');pending={action,payload:{...copy(data),operation_id:uuidFactory()}};return send();}
 return Object.freeze({session,
  list:document_id=>call('listar_emissoes_documento',{document_id}),
  openPDF:issue_id=>call('obter_pdf_documento_paciente',{issue_id}),
  issue:data=>start('emitir_documento_paciente',data),
  revoke:issue_id=>start('revogar_documento_paciente',{issue_id}),
  retry:send,getPending:()=>pending?copy(pending):null,isBusy:()=>busy,
  dispose(){stop();unsubscribe?.();},
 });
}
export function getDocumentsService(){
 const bridge=getClinicalBridge();if(!bridge?.session)return null;
 if(!services.has(bridge)){const service=createDocumentsService({session:bridge.session});services.set(bridge,service);
  const guard=event=>{if(service.isBusy()||service.getPending()){event.preventDefault();if(event.type==='beforeunload')event.returnValue='';}};
  addEventListener('amj:before-sign-out',guard);addEventListener('beforeunload',guard);
  bridge.session.subscribe(()=>{removeEventListener('amj:before-sign-out',guard);removeEventListener('beforeunload',guard);service.dispose();services.delete(bridge);});
 }
 return services.get(bridge);
}
