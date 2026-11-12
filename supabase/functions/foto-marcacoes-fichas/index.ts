import {authenticateDual,authResponseFields,DualAuthError,requireAdminSessionAction,writeClinicAudit,type DualAuthContext} from '../_shared/dual-auth.ts';
import {validatePhotoAnnotation} from '../_shared/photo-annotation.mjs';

const base=(Deno.env.get('SUPABASE_URL')||'').replace(/\/+$/,'');
const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const config={supabaseUrl:base,serviceRoleKey:key,allowedRoles:['owner'] as const,requireAal2:true};
const origins=new Set(['https://anamariajacob.com.br','https://www.anamariajacob.com.br','http://127.0.0.1:8765','http://localhost:8765']);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const signedSeconds=120;
class Failure extends Error {constructor(public status:number,public code:string,message:string){super(message);}}
function contextConflict(code='protocol_context_conflict') {return new Failure(409,code,'A consulta, o paciente ou a foto foi alterado. Reabra a foto antes de continuar.');}
async function service(path:string,body:unknown){
  const response=await fetch(base+path,{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
  const data=await response.json();
  if(!response.ok){
    const message=data?.message;
    if(message==='photo_annotation_protocol_context_conflict')throw contextConflict();
    if(message==='photo_annotation_photo_context_conflict')throw contextConflict('photo_context_conflict');
    if(message==='photo_annotation_unavailable')throw new Failure(404,'photo_not_found','Foto indisponível, arquivada ou fora desta consulta.');
    if(message==='photo_annotation_owner_required')throw new Failure(403,'owner_mfa_required','Confirme seu acesso de administradora com autenticador.');
    if(message==='photo_annotation_invalid_document'||data?.code==='22023')throw new Failure(422,'invalid_document','Documento de marcações inválido.');
    if(data?.code==='40001'||data?.code==='23505')throw new Failure(409,'version_conflict','Outra versão já foi salva. Reabra a foto para conferir as marcações.');
    throw new Failure(503,'storage_unavailable','Não foi possível acessar as marcações agora.');
  }
  return data;
}
async function limitedJSON(req:Request){
  if(!req.headers.get('content-type')?.includes('application/json'))throw new Failure(415,'invalid_type','Conteúdo inválido.');
  const reader=req.body?.getReader();if(!reader)throw new Failure(422,'invalid_body','Conteúdo ausente.');
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2097152){await reader.cancel();throw new Failure(413,'too_large','As marcações excederam o limite permitido.');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new Failure(422,'invalid_json','Conteúdo inválido.');}
}
async function signOriginal(photo:Record<string,unknown>,clinicId:string,protocolId:string){
  const path=typeof photo.storage_path==='string'?photo.storage_path:'';
  const prefix=clinicId+'/'+protocolId+'/';
  if(!path.startsWith(prefix)||path.length<=prefix.length||path.length>600||path.includes('\\')||path.includes('//')||path.split('/').some(part=>part==='.'||part==='..')||/[\u0000-\u001f\u007f]/.test(path))throw new Failure(503,'photo_unavailable','O original desta foto está indisponível.');
  const signed=await service('/storage/v1/object/sign/clinic-media',{expiresIn:signedSeconds,paths:[path]});
  const item=Array.isArray(signed)?signed.find(row=>row.path===path):null;
  if(!item||typeof item.signedURL!=='string')throw new Failure(503,'photo_unavailable','Não foi possível abrir o original desta foto.');
  const result=new URL(base+'/storage/v1'+item.signedURL);
  if(result.origin!==new URL(base).origin||!result.pathname.startsWith('/storage/v1/object/sign/clinic-media/')||!result.searchParams.has('token'))throw new Failure(503,'photo_unavailable','Não foi possível abrir o original desta foto.');
  return result.href;
}
export async function handler(req:Request){
  const origin=req.headers.get('origin')||'';
  const headers={'Access-Control-Allow-Origin':origins.has(origin)?origin:'https://anamariajacob.com.br','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS',Vary:'Origin','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
  const reply=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers});
  if(origin&&!origins.has(origin))return reply({ok:false,erro:'Origem não permitida.',codigo:'origin_forbidden'},403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return reply({ok:false,erro:'Método não permitido.',codigo:'method_forbidden'},405);
  let ctx:DualAuthContext|undefined;
  try{
    ctx=await authenticateDual(req,config);
    if(ctx.authMethod!=='supabase_auth'||ctx.aal!=='aal2'||ctx.role!=='owner'||!ctx.userId||!ctx.clinicId)throw new Failure(403,'owner_mfa_required','Confirme seu acesso de administradora com autenticador.');
    const body=await limitedJSON(req);
    if(!body||!['abrir','salvar'].includes(body.acao)||typeof body.protocolo_id!=='string'||!uuid.test(body.protocolo_id)||typeof body.foto_id!=='string'||!uuid.test(body.foto_id))throw new Failure(422,'invalid_request','Consulta ou foto inválida.');
    const scope={p_clinic_id:ctx.clinicId,p_actor_id:ctx.userId,p_protocol_id:body.protocolo_id,p_photo_id:body.foto_id};
    let result;
    let photo;
    if(body.acao==='abrir'){
      result=await service('/rest/v1/rpc/photo_annotation_open',scope);
      const signedUrl=await signOriginal(result.photo,ctx.clinicId,body.protocolo_id);
      // Signing uses a separate HTTP snapshot. Revalidate auth and binding before
      // releasing any original URL or patient annotation to the browser.
      await requireAdminSessionAction(req,config,ctx,{operationId:crypto.randomUUID(),action:'photo.annotation.read',targetId:body.foto_id});
      const fresh=await service('/rest/v1/rpc/photo_annotation_open',scope);
      if(JSON.stringify(fresh.binding)!==JSON.stringify(result.binding))throw contextConflict();
      result=fresh;
      photo={id:body.foto_id,protocol_id:body.protocolo_id,phase:result.photo.phase,mime_type:result.photo.mime_type,signed_url:signedUrl,expires_in:signedSeconds,width:null,height:null};
    }else{
      if(typeof body.operation_id!=='string'||!uuid.test(body.operation_id)||!Number.isInteger(body.expected_version)||body.expected_version<0||body.expected_version>2147483646)throw new Failure(422,'invalid_version','Versão de marcações inválida.');
      if(typeof body.expected_patient_id!=='string'||!uuid.test(body.expected_patient_id)||!Number.isInteger(body.expected_protocol_version)||body.expected_protocol_version<1||typeof body.expected_photo_revision!=='string'||!/^[a-f0-9]{32}$/.test(body.expected_photo_revision))throw new Failure(422,'invalid_context','Reabra a foto para confirmar o vínculo com a consulta.');
      let document;
      try{document=validatePhotoAnnotation(body.document);}catch(error){throw new Failure(422,'invalid_document',(error as Error).message);}
      const reason=typeof body.motivo==='string'?body.motivo.trim():'';
      if(Array.from(reason).length<3||Array.from(reason).length>500)throw new Failure(422,'reason_required','Informe um motivo de 3 a 500 caracteres.');
      await requireAdminSessionAction(req,config,ctx,{operationId:body.operation_id,action:'photo.annotation.save',targetId:body.foto_id});
      result=await service('/rest/v1/rpc/photo_annotation_save',{...scope,p_operation_id:body.operation_id,p_expected_version:body.expected_version,p_expected_patient_id:body.expected_patient_id,p_expected_protocol_version:body.expected_protocol_version,p_expected_photo_revision:body.expected_photo_revision,p_document:document,p_reason:reason});
    }
    await writeClinicAudit(config,ctx,{entity:'photo_annotation',entityId:body.foto_id,action:body.acao==='abrir'?'read':'save',outcome:'success',details:{endpoint:'foto-marcacoes-fichas',result_count:result.annotation?1:0}});
    return reply({ok:true,binding:result.binding,annotation:result.annotation,...(photo?{photo}:{}),...authResponseFields(ctx)});
  }catch(error){
    const e=error instanceof DualAuthError?{status:error.status,code:error.code,message:error.publicMessage}:error instanceof Failure?error:{status:500,code:'unavailable',message:'Não foi possível concluir. Suas alterações ainda não foram confirmadas.'};
    if(ctx)await writeClinicAudit(config,ctx,{entity:'photo_annotation',action:'request',outcome:e.status===401||e.status===403?'denied':'error',details:{endpoint:'foto-marcacoes-fichas',reason_code:e.code}});
    return reply({ok:false,erro:e.message,codigo:e.code},e.status);
  }
}
Deno.serve(handler);
