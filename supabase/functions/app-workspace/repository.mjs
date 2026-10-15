import {fail,hash} from './rules.mjs';
const BUCKET='app-workspace-media';
export function createRepository({supabaseUrl,serviceRoleKey,fetchImpl=fetch}){
 const base=supabaseUrl.replace(/\/+$/,''),headers={apikey:serviceRoleKey,Authorization:'Bearer '+serviceRoleKey};
 async function request(path,options={}){
  const response=await fetchImpl(base+path,{...options,headers:{...headers,...options.headers},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(25000)});
  if(!response.ok){let body;try{body=await response.json();}catch{}const message=String(body?.message||'');
   if(message.includes('revision_conflict')||body?.code==='40001')fail('revision_conflict','Outra alteração foi salva. Atualize antes de tentar novamente.',409);
   if(message.includes('workspace_access_denied')||body?.code==='42501')fail('workspace_access_denied','A sessão ou o acesso à clínica mudou.',403);
   if(message.includes('operation_reused')||body?.code==='23505')fail('operation_reused','Identificador já utilizado com outros dados.',409);
   if(body?.code==='22023')fail('invalid_workspace_state','O servidor recusou o vínculo ou os dados enviados.');
   fail('backend_unavailable','Não foi possível confirmar a operação no servidor.',503);
  }return response;
 }
 const json=async(path,options)=> (await request(path,options)).json();
 const rows=(table,filters)=>json('/rest/v1/'+table+'?select=*&'+filters);
 const rpc=(name,args)=>json('/rest/v1/rpc/'+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args)});
 const filter=(clinic,tail='')=>'clinic_id=eq.'+encodeURIComponent(clinic)+tail;
 const photoRow=row=>row?{...row.metadata,id:row.id,patient_id:row.patient_id,visit_id:row.visit_id,status:row.status}:null;
 return {
  async load(clinic){return (await rows('app_workspaces',filter(clinic)+'&limit=1'))[0]||null;},
  async operation(clinic,id){return (await rows('app_workspace_operations',filter(clinic)+'&operation_id=eq.'+encodeURIComponent(id)+'&limit=1'))[0]||null;},
  async version(clinic,revision){return (await rows('app_workspace_versions',filter(clinic)+'&revision=eq.'+revision+'&limit=1'))[0]||null;},
  async photos(clinic){const result=[];while(true){const page=await rows('app_workspace_photos',filter(clinic)+'&status=eq.ready&order=id.asc&limit=1000&offset='+result.length);if(!page.length)return result.map(photoRow);result.push(...page);if(result.length>10000)fail('photo_limit_reached','O acervo excede o limite desta versão operacional. Preserve os dados e amplie o contrato antes de continuar.',413);}},
  async photo(clinic,id){return photoRow((await rows('app_workspace_photos',filter(clinic)+'&id=eq.'+encodeURIComponent(id)+'&limit=1'))[0]);},
  commit:args=>rpc('app_workspace_commit',args),
  async reserve(args){return photoRow(await rpc('app_workspace_photo_reserve',args));},
  async ready(args){return photoRow(await rpc('app_workspace_photo_ready',args));},
  async upload(path,bytes,mime,expectedHash){
   const encoded=path.split('/').map(encodeURIComponent).join('/');
   const response=await fetchImpl(base+'/storage/v1/object/'+BUCKET+'/'+encoded,{method:'POST',headers:{...headers,'Content-Type':mime,'x-upsert':'false'},body:bytes,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(25000)});
   if(response.ok)return;
   // A lost response or concurrent retry may have already written this immutable object.
   if(response.status===400||response.status===409){const existing=await fetchImpl(base+'/storage/v1/object/'+BUCKET+'/'+encoded,{headers,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(25000)});if(existing.ok){const value=await existing.arrayBuffer();if(value.byteLength===bytes.byteLength&&await hash(value)===expectedHash)return;fail('photo_content_conflict','O arquivo existente não corresponde ao envio. O original foi preservado.',409);}}
   fail('upload_unconfirmed','O envio da foto não foi confirmado. Repita a mesma operação e arquivo.',503);
  },
  async sign(path){const encoded=path.split('/').map(encodeURIComponent).join('/'),value=await json('/storage/v1/object/sign/'+BUCKET+'/'+encoded,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expiresIn:120})});const signed=value.signedURL||value.signedUrl;if(typeof signed!=='string'||!signed.startsWith('/object/sign/'+BUCKET+'/'))fail('invalid_photo_url','Não foi possível abrir a fotografia.',503);return base+'/storage/v1'+signed;},
 };
}
