import {emptyState,validateTransition,stable,hash,uuid,validId,fail,WorkspaceError,imageInfo} from './rules.mjs';
import {CLINICAL_ACTIONS,createClinicalBridge} from './clinical-bridge.mjs';
import {SITE_BOOKING_ACTIONS,createSiteBooking} from './site-booking.mjs';
import {CLINICAL_COMPLETION_ACTIONS,createClinicalCompletion} from './clinical-completion.mjs';
import {CLINICAL_SETTINGS_ACTIONS,createClinicalSettings} from './clinical-settings.mjs';
import {CUSTOM_DOCUMENT_ACTIONS,createCustomDocuments} from './custom-documents.mjs';
import {CustomDocumentError} from '../_shared/custom-documents.mjs';
const ORIGINS=new Set(['https://anamariajacob.com.br','https://www.anamariajacob.com.br','http://127.0.0.1:8765','http://localhost:8765','http://127.0.0.1:8766','http://localhost:8766']);
const ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
const revision=n=>Number.isSafeInteger(n)&&n>=0;
async function limited(req,max){if(Number(req.headers.get('content-length')||0)>max)fail('body_too_large','Envio acima do limite.',413);const reader=req.body?.getReader(),chunks=[];let length=0;if(!reader)return new Uint8Array();while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>max){await reader.cancel();fail('body_too_large','Envio acima do limite.',413);}chunks.push(value);}const result=new Uint8Array(length);let offset=0;for(const part of chunks){result.set(part,offset);offset+=part.length;}return result;}
function publicPhoto(p){if(!p)return null;const {original_path,preview_path,status,...safe}=p;return safe;}
function workspace(row,state){return {schema:1,revision:row?.revision||0,state:row?.state||state,state_hash:row?.state_hash||null,updated_at:row?.updated_at||row?.created_at||null};}
export function createWorkspaceHandler({authenticate,authorize,repository,now=()=>new Date().toISOString()}){
 const clinical=createClinicalBridge({repository,authorize});
 const siteBooking=createSiteBooking({repository,authorize,now});
 const completion=createClinicalCompletion({repository,authorize,validateTransition,now});
 const settings=createClinicalSettings({repository,authorize});
 const customDocuments=createCustomDocuments({repository,authorize,now});
 return async function handle(req){const origin=req.headers.get('origin')||'',cors={'Access-Control-Allow-Origin':ORIGINS.has(origin)?origin:'https://anamariajacob.com.br','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS',Vary:'Origin','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff'};
  const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});
  let ctx;try{
   if(origin&&!ORIGINS.has(origin))fail('origin_forbidden','Origem não autorizada.',403);
   if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
   if(req.method!=='POST')fail('method_not_allowed','Use POST.',405);
   ctx=await authenticate(req);if(ctx.authMethod!=='supabase_auth'||ctx.role!=='owner'||ctx.aal!=='aal2'||!uuid(ctx.clinicId)||!uuid(ctx.userId)||!uuid(ctx.sessionId))fail('owner_mfa_required','Entre com a conta proprietária e confirme o autenticador.',403);
   const fields={ok:true,auth_method:'supabase_auth',role:'owner',clinic_id:ctx.clinicId};
   const multipart=(req.headers.get('content-type')||'').startsWith('multipart/form-data');
   const bytes=await limited(req,multipart?11*1024*1024:5*1024*1024);let p;
   try{p=multipart?await new Request(req.url,{method:'POST',headers:{'Content-Type':req.headers.get('content-type')},body:bytes}).formData():JSON.parse(new TextDecoder().decode(bytes));}catch{fail('invalid_payload','Envio inválido.');}
   const action=multipart?p.get('acao'):p?.acao;if(!['abrir','commit','status_operacao','upload','obterfoto',...CLINICAL_ACTIONS,...SITE_BOOKING_ACTIONS,...CLINICAL_COMPLETION_ACTIONS,...CLINICAL_SETTINGS_ACTIONS,...CUSTOM_DOCUMENT_ACTIONS].includes(action)||multipart!== (action==='upload'))fail('unsupported_action','Operação não reconhecida.');
   if(CUSTOM_DOCUMENT_ACTIONS.includes(action))return response({...fields,...await customDocuments(p,ctx,req)});
   if(SITE_BOOKING_ACTIONS.includes(action))return response({...fields,...await siteBooking(p,ctx,req)});
   if(CLINICAL_COMPLETION_ACTIONS.includes(action))return response({...fields,...await completion(p,ctx,req)});
   if(CLINICAL_SETTINGS_ACTIONS.includes(action))return response({...fields,...await settings(p,ctx,req)});
   if(CLINICAL_ACTIONS.includes(action))return response({...fields,...await clinical(p,ctx,req)});
   if(action==='abrir'){const row=await repository.load(ctx.clinicId),state=emptyState();return response({...fields,workspace:workspace(row,state)});}
   if(action==='status_operacao'){
    if(!uuid(p.operation_id))fail('invalid_operation','Identificador de operação inválido.');const op=await repository.operation(ctx.clinicId,p.operation_id);if(!op)return response({...fields,operation:null});
    let result=null;if(op.status==='committed')result=op.kind==='upload'?{photo:publicPhoto(await repository.photo(ctx.clinicId,op.photo_id))}:{workspace:workspace(await repository.version(ctx.clinicId,op.revision))};
    return response({...fields,operation:{id:op.operation_id,kind:op.kind,status:op.status,revision:op.revision||null,result}});
   }
   if(action==='obterfoto'){
    if(!validId(p.photo_id))fail('invalid_photo','Fotografia inválida.');const [row,photo]=await Promise.all([repository.load(ctx.clinicId),repository.photo(ctx.clinicId,p.photo_id)]);const owner=row?.state.visits.find(v=>v.id===photo?.visit_id&&v.patientId===photo?.patient_id&&v.photos.some(x=>x.id===photo?.id&&x.sha256===photo?.sha256));if(!photo||photo.status!=='ready'||!owner)fail('photo_not_found','Fotografia não encontrada nesta clínica.',404);
    const [original_url,preview_url]=await Promise.all([repository.sign(photo.original_path),repository.sign(photo.preview_path)]);return response({...fields,photo:{...publicPhoto(photo),original_url,preview_url,expires_in:120}});
   }
   const rawExpected=multipart?p.get('expected_revision'):p.expected_revision;
   const operationId=multipart?p.get('operation_id'):p.operation_id,expected=multipart&&typeof rawExpected==='string'&&/^\d+$/.test(rawExpected)?Number(rawExpected):rawExpected;
   if(!uuid(operationId)||!revision(expected))fail('invalid_operation','Confira identificador e revisão da operação.');
   await authorize(req,ctx,{operationId,targetId:ctx.clinicId,action:action==='commit'?'app_workspace_commit':'app_workspace_upload'});
   const actor={p_clinic:ctx.clinicId,p_actor:ctx.userId,p_session:ctx.sessionId,p_operation:operationId};
   if(action==='commit'){
    if(!p.state||p.state.revision!==expected)fail('revision_conflict','A revisão enviada difere do estado.',409);
    const fingerprint=await hash(stable({expected_revision:expected,state:p.state})),prior=await repository.operation(ctx.clinicId,operationId);
    if(prior){if(prior.kind!=='commit'||prior.fingerprint!==fingerprint)fail('operation_reused','Esta operação já foi usada com outros dados.',409);const saved=await repository.version(ctx.clinicId,prior.revision);return response({...fields,workspace:workspace(saved),operation:{id:operationId,status:'committed',revision:prior.revision,replayed:true}});}
    const [row,photos]=await Promise.all([repository.load(ctx.clinicId),repository.photos(ctx.clinicId)]),old=row?.state||emptyState();if((row?.revision||0)!==expected)fail('revision_conflict','Outra alteração foi salva. Mantenha o rascunho e confira a versão atual.',409);
    try{validateTransition(old,p.state,{photos,now:now()});}catch(error){if(error instanceof WorkspaceError)throw error;fail('invalid_state','O estado contém valores incompatíveis com as regras operacionais.');}const state=structuredClone(p.state);state.revision=expected+1;state.auditLog.push({id:operationId,at:now(),action:'Alteração operacional confirmada',revision:state.revision,actorId:ctx.userId});
    const saved=await repository.commit({...actor,p_fingerprint:fingerprint,p_expected:expected,p_state:state,p_state_hash:await hash(stable(state))});return response({...fields,workspace:workspace(saved),operation:{id:operationId,status:'committed',revision:saved.revision,replayed:saved.replayed}});
   }
   const id=p.get('photo_id'),patient=p.get('patient_id'),visit=p.get('visit_id'),original=p.get('original'),preview=p.get('preview');if(![id,patient,visit].every(validId)||!(original instanceof Blob)||!(preview instanceof Blob)||!original.size||original.size>8*1024*1024||!preview.size||preview.size>2*1024*1024||!ext[original.type]||!ext[preview.type])fail('invalid_photo','Envie original JPEG/PNG/WebP até 8 MB e prévia até 2 MB.');
   const originalBytes=new Uint8Array(await original.arrayBuffer()),previewBytes=new Uint8Array(await preview.arrayBuffer()),originalInfo=imageInfo(originalBytes,original.type),previewInfo=imageInfo(previewBytes,preview.type),sha256=await hash(originalBytes),previewHash=await hash(previewBytes),path=ctx.clinicId+'/'+id;
   const metadata={id,patient_id:patient,visit_id:visit,sha256,mime_type:original.type,size_bytes:original.size,preview_sha256:previewHash,preview_mime_type:preview.type,preview_size_bytes:preview.size,width:previewInfo.width,height:previewInfo.height,original_width:originalInfo.width,original_height:originalInfo.height,original_path:path+'/original-'+sha256+'.'+ext[original.type],preview_path:path+'/preview-'+previewHash+'.'+ext[preview.type]};
   const fingerprint=await hash(stable({expected_revision:expected,metadata}));let reserved=await repository.reserve({...actor,p_fingerprint:fingerprint,p_expected:expected,p_photo:id,p_patient:patient,p_visit:visit,p_metadata:metadata});
   if(reserved.status!=='ready'){await repository.upload(metadata.original_path,originalBytes,original.type,sha256);await repository.upload(metadata.preview_path,previewBytes,preview.type,previewHash);reserved=await repository.ready({...actor,p_fingerprint:fingerprint});}
   return response({...fields,photo:publicPhoto(reserved),operation:{id:operationId,kind:'upload',status:'committed'}});
  }catch(error){const known=error instanceof WorkspaceError||error instanceof CustomDocumentError,status=known?error.status:([401,403].includes(error?.status)?error.status:503);return response({ok:false,codigo:known?error.code:status===401?'session_invalid':status===403?'access_denied':'backend_unavailable',erro:known?error.message:status===401?'A sessão expirou. Entre novamente.':status===403?'Acesso negado. Confira a conta e o autenticador.':'Não foi possível confirmar a operação. Preserve a mesma chave antes de repetir.'},status);}
 };
}
