import {PUBLIC_BACKEND} from './integration/public-backend.mjs';
import {normalizeWorkspace} from './store.mjs';

export class CloudStoreError extends Error {
  constructor(code,message,{status=0,uncertain=false}={}) { super(message);this.name='CloudStoreError';this.code=code;this.status=status;this.uncertain=uncertain; }
}
const clone=value=>structuredClone(value);
const fail=(code,message,options)=>new CloudStoreError(code,message,options);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const revision=value=>Number.isSafeInteger(value)&&value>=0;
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,179}$/.test(value)&&!['constructor','prototype','__proto__'].includes(value);
const uuidValue=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const mimeTypes=new Set(['image/jpeg','image/png','image/webp']);
const sha=async blob=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),n=>n.toString(16).padStart(2,'0')).join('');
const authError=error=>error?.code?.startsWith('session_')||['mfa_required','login_required','identity_changed'].includes(error?.code);

// Private state and pending payloads exist only in memory. No fallback to demo storage.
// Mutation retries retain both operation IDs and exact immutable photo bytes.
export function createCloudStore({session,fetchImpl=globalThis.fetch,timeoutMs=25000,onStatus=()=>{},onInvalidated=()=>{},uuid=()=>crypto.randomUUID()}={}) {
  if(!session?.requireReady||!session?.assertCurrent)throw Error('Sessão autenticada obrigatória.');
  let current=null,clinicId=null,pending=null,busy=false,closed=false,locked=false,generation=0;
  const controllers=new Set();
  const status=(kind,message,details={})=>{if(locked&&kind!=='locked')return;try{onStatus({kind,message,revision:current?.revision,pending:!!pending,operationId:pending?.payload.operation_id,canDiscardPending:!!pending?.rejected,...details});}catch{}};
  const invalidate=reason=>{if(locked)return;locked=true;generation++;current=null;clinicId=null;pending=null;for(const c of controllers)c.abort();status('locked','Acesso encerrado. Entre novamente.');try{onInvalidated(reason);}catch{}};
  const unsubscribe=session.subscribe?.(invalidate);
  const assertOpen=()=>{if(closed||locked)throw fail('session_closed','A conexão foi encerrada. Entre novamente.');};
  const check=turn=>{assertOpen();if(turn!==generation)throw fail('session_changed','O acesso mudou. A resposta foi descartada.');};
  async function authCurrent(auth,turn){await session.assertCurrent(auth);check(turn);}
  function envelope(data,{write=false}={}){
    if(!plain(data)||data.ok!==true||data.auth_method!=='supabase_auth'||data.role!=='owner'||!uuidValue(data.clinic_id))throw fail('invalid_response','O servidor não confirmou uma resposta autenticada compatível.',{uncertain:write});
    if(clinicId&&clinicId!==data.clinic_id){invalidate('clinic_changed');throw fail('clinic_changed','A clínica mudou. Entre novamente.');}
    return data;
  }
  async function request(payload,{write=false,multipart=false}={}) {
    assertOpen();const turn=generation;let controller,timer,sent=false;
    try {
      const auth=await session.requireReady();check(turn);controller=new AbortController();controllers.add(controller);timer=setTimeout(()=>controller.abort(),timeoutMs);
      sent=true;
      const response=await fetchImpl(PUBLIC_BACKEND.supabaseUrl+'/functions/v1/app-workspace',{
        method:'POST',headers:{apikey:PUBLIC_BACKEND.publishableKey,Authorization:'Bearer '+auth.token,...(!multipart?{'Content-Type':'application/json'}:{})},
        body:multipart?payload:JSON.stringify(payload),signal:controller.signal,cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',redirect:'error'
      });
      await authCurrent(auth,turn);
      // HTTP access denial must invalidate even if a gateway returned HTML.
      if(response.status===401||response.status===403){invalidate('access_denied');session.invalidate?.('access_denied');throw fail('access_denied','O acesso precisa ser confirmado novamente.',{status:response.status});}
      let data;try{data=await response.json();}catch{check(turn);throw fail('invalid_response','O servidor não confirmou o resultado. Confira a operação antes de tentar outra.',{status:response.status,uncertain:write&&(response.ok||response.status>=500)});}
      await authCurrent(auth,turn);
      if(!response.ok||data?.ok===false) {
        const code=typeof data?.codigo==='string'?data.codigo:typeof data?.code==='string'?data.code:typeof data?.error?.code==='string'?data.error.code:'http_'+response.status;
        const supplied=typeof data?.erro==='string'?data.erro:typeof data?.message==='string'?data.message:null;
        const message=response.status===409?'Os dados mudaram ou a operação entrou em conflito. Confira a versão do servidor antes de refazer a alteração.':response.status>=500?'O servidor não confirmou a gravação. Use Conferir gravação para recuperar o resultado.':supplied||'O servidor recusou esta alteração. Confira os campos e tente novamente.';
        throw fail(code,message,{status:response.status,uncertain:write&&response.status>=500});
      }
      return envelope(data,{write});
    }catch(error){
      if(authError(error)){invalidate(error.code);throw error;}
      if(error instanceof CloudStoreError&&(locked||closed))throw error;check(turn);
      if(error instanceof CloudStoreError)throw error;
      throw fail('network_error',write&&sent?'A conexão caiu antes da confirmação. A gravação pode ter chegado ao servidor; use Conferir gravação.':'Não foi possível consultar o servidor. Confira a conexão.',{uncertain:write&&sent});
    }finally{clearTimeout(timer);if(controller)controllers.delete(controller);}
  }
  function accept(result,{write=false,expectedRevision}={}){
    envelope(result,{write});const w=result.workspace;let value;
    try{
      if(!plain(w)||w.schema!==1||!plain(w.state)||!revision(w.revision)||w.state.revision!==w.revision||w.state.schema!==1||expectedRevision!==undefined&&w.revision!==expectedRevision)throw Error('Revisão incompatível.');
      for(const key of ['patients','visits','appointments','bills','payments','requests'])if(!Array.isArray(w.state[key]))throw Error('Coleção ausente.');
      value=normalizeWorkspace(clone(w.state));
    }catch{throw fail('invalid_workspace','Resposta do servidor incompatível. Nenhum dado local foi usado.',{uncertain:write});}
    clinicId=result.clinic_id;current=value;return clone(current);
  }
  function saved(result,op){
    const receipt=result.operation;
    if(!receipt||receipt.id!==op.payload.operation_id||receipt.status!=='committed'||receipt.revision!==op.payload.expected_revision+1||receipt.kind!==undefined&&receipt.kind!=='commit')throw fail('invalid_receipt','O servidor não confirmou a operação esperada. Confira a gravação.',{uncertain:true});
    const value=accept(result,{write:true,expectedRevision:op.payload.expected_revision+1});pending=null;status('saved','Salvo no servidor · revisão '+value.revision,{confirmedOperationId:op.payload.operation_id});return value;
  }
  function statePhoto(state,id){
    const owners=(state?.visits||[]).flatMap(v=>(v.photos||[]).filter(p=>p.id===id).map(photo=>({visit:v,photo})));
    if(owners.length!==1)throw fail('photo_context','A fotografia não pertence a uma única consulta nesta versão.');
    return owners[0];
  }
  function verifyPhoto(photo,expected){
    const keys=['id','patient_id','visit_id','sha256','width','height'];
    for(const key of keys)if(photo?.[key]!==expected[key])throw fail('photo_context','A fotografia recebida não corresponde ao vínculo e ao arquivo esperado.');
    for(const key of ['sha256','preview_sha256'])if(!/^[a-f0-9]{64}$/.test(photo[key]||''))throw fail('invalid_photo','Hash da fotografia não confirmado.');
    for(const [size,max]of [['size_bytes',8*1024*1024],['preview_size_bytes',2*1024*1024]])if(!Number.isSafeInteger(photo[size])||photo[size]<=0||photo[size]>max)throw fail('invalid_photo','Tamanho da fotografia incompatível.');
    if(!mimeTypes.has(photo.mime_type)||!mimeTypes.has(photo.preview_mime_type))throw fail('invalid_photo','Formato da fotografia incompatível.');
    for(const key of ['preview_sha256','size_bytes','preview_size_bytes','mime_type','preview_mime_type'])if(expected[key]!==undefined&&photo[key]!==expected[key])throw fail('photo_integrity','O servidor não confirmou os mesmos arquivos enviados.');
    return photo;
  }
  function verifyUpload(result,op){
    try{
      if(result.operation?.id!==op.upload.fields.operation_id||result.operation.kind!=='upload'||result.operation.status!=='committed')throw Error('Operação de foto incompatível.');
      verifyPhoto(result.photo,op.upload.expected);
    }catch(error){throw fail('upload_unconfirmed',error.message,{uncertain:true});}
    op.upload.done=true;
  }
  function uploadBody(op){const f=new FormData();for(const [key,value]of Object.entries(op.upload.fields))f.set(key,String(value));f.set('original',op.upload.original,op.upload.original.name||'original');f.set('preview',op.upload.preview,'preview');return f;}
  async function executePending(){
    const op=pending;if(!op)throw fail('no_pending','Nenhuma gravação pendente.');op.rejected=false;
    if(op.upload&&!op.upload.done)verifyUpload(await request(uploadBody(op),{write:true,multipart:true}),op);
    assertOpen();if(pending!==op)throw fail('session_changed','A operação perdeu seu contexto.');
    op.commitStarted=true;return saved(await request(op.payload,{write:true}),op);
  }
  function rememberError(error,{keepRejected=false}={}){
    if(!pending)return;
    if(!error.uncertain&&error.status>=400&&error.status<500)pending.rejected=true;
    if(pending.rejected&&error.status!==409&&!keepRejected)pending=null;
  }
  const announceError=error=>status(pending?(pending.rejected?'conflict':'pending'):'error',error.message);
  async function load(){
    assertOpen();if(pending)throw fail('pending_operation','Há uma gravação sem confirmação. Use Conferir gravação antes de atualizar.');
    if(busy)throw fail('busy','Aguarde a operação em andamento.');
    busy=true;try{const value=accept(await request({acao:'abrir'}));status('saved','Dados do servidor · revisão '+value.revision);return value;}catch(error){announceError(error);throw error;}finally{busy=false;}
  }
  async function commit(expectedRevision,update,photo){
    assertOpen();if(busy)throw fail('busy','Aguarde a gravação em andamento.');
    if(pending)throw fail('pending_operation','Confira a gravação pendente antes de criar outra alteração.');
    if(!current||current.revision!==expectedRevision)throw fail('revision_conflict','Atualize os dados antes de gravar.');
    const turn=generation;busy=true;
    try{
      const draft=clone(current),result=update(draft);if(result?.then)throw fail('async_mutation','A alteração precisa ser síncrona.');
      // Detach from objects retained by the caller before any await or retry.
      const candidate=clone(draft);
      if(candidate.revision!==expectedRevision)throw fail('revision_changed','A revisão é controlada pelo servidor.');
      let upload;
      if(photo){
        if(!validId(photo.id)||!(photo.original instanceof Blob)||!(photo.preview instanceof Blob)||!photo.original.size||photo.original.size>8*1024*1024||!photo.preview.size||photo.preview.size>2*1024*1024||!mimeTypes.has(photo.original.type)||!mimeTypes.has(photo.preview.type))throw fail('invalid_photo','Envie original JPEG/PNG/WebP até 8 MB e prévia até 2 MB.');
        if(current.visits.some(v=>(v.photos||[]).some(p=>p.id===photo.id)))throw fail('original_photo_immutable','Uma fotografia existente não pode ser substituída.');
        const {visit,photo:meta}=statePhoto(candidate,photo.id),previous=current.visits.find(v=>v.id===visit.id&&v.patientId===visit.patientId);
        if(!previous)throw fail('photo_context','Salve a consulta antes de adicionar a fotografia.');
        if([previous,visit].some(v=>v.lockedAt||['concluido','cancelado'].includes(v.status)))throw fail('photo_context','A consulta está bloqueada para novas fotografias.');
        const [originalHash,previewHash]=await Promise.all([sha(photo.original),sha(photo.preview)]);check(turn);
        if(originalHash!==meta.sha256)throw fail('photo_integrity','O hash do original não corresponde à fotografia cadastrada.');
        const expected={id:photo.id,patient_id:visit.patientId,visit_id:visit.id,sha256:originalHash,preview_sha256:previewHash,size_bytes:photo.original.size,preview_size_bytes:photo.preview.size,mime_type:photo.original.type,preview_mime_type:photo.preview.type,width:meta.width,height:meta.height};
        upload={fields:{acao:'upload',operation_id:uuid(),expected_revision:expectedRevision,patient_id:visit.patientId,visit_id:visit.id,photo_id:photo.id},expected,original:photo.original,preview:photo.preview,done:false};
      }
      check(turn);pending={payload:{acao:'commit',operation_id:uuid(),expected_revision:expectedRevision,state:candidate},upload,commitStarted:false,rejected:false};
      status('saving','Gravando no servidor…');return await executePending();
    }catch(error){rememberError(error);announceError(error);throw error;}finally{busy=false;}
  }
  async function operation(id,kind){
    const result=await request({acao:'status_operacao',operation_id:id}),op=result.operation;
    if(op===null)return null;
    if(!op||op.id!==id||op.kind!==kind||!['pending','committed'].includes(op.status))throw fail('invalid_operation_status','O servidor não confirmou a identidade e o tipo da operação.',{uncertain:true});
    return {receipt:op,clinic_id:result.clinic_id,auth_method:result.auth_method,role:result.role,ok:true};
  }
  function recoverCommit(result,op){
    return saved({...result,...result.receipt.result,operation:result.receipt},op);
  }
  async function resolvePending(){
    assertOpen();if(busy)throw fail('busy','Aguarde a gravação em andamento.');if(!pending)return load();
    busy=true;try{
      const op=pending;
      if(op.commitStarted){const result=await operation(op.payload.operation_id,'commit');if(result?.receipt.status==='committed')return recoverCommit(result,op);if(result)throw fail('operation_pending','O servidor ainda está processando a operação. Confira novamente.',{uncertain:true});}
      if(op.upload&&!op.upload.done){const result=await operation(op.upload.fields.operation_id,'upload');if(result?.receipt.status==='committed')verifyUpload({...result.receipt.result,operation:result.receipt},op);}
      // A missing status is not failure proof. Reuse the exact same operation and bytes.
      return await executePending();
    }catch(error){rememberError(error,{keepRejected:true});announceError(error);throw error;}finally{busy=false;}
  }
  async function refreshAfterConflict(){
    assertOpen();if(busy)throw fail('busy','Aguarde a operação em andamento.');
    busy=true;try{
      if(pending){
        const op=pending;
        if(op.commitStarted){const result=await operation(op.payload.operation_id,'commit');if(result?.receipt.status==='committed')return recoverCommit(result,op);if(result)throw fail('operation_pending','O servidor ainda está conferindo essa operação.',{uncertain:true});}
        if(!op.rejected)throw fail('pending_operation','A ausência de confirmação não prova que a gravação falhou. Use Conferir gravação para repetir a mesma operação.',{uncertain:true});
        // Clear only after the explicit refresh succeeded, preserving a rejected draft if offline.
        const value=accept(await request({acao:'abrir'}));pending=null;status('saved','Versão atual do servidor · revisão '+value.revision);return value;
      }
      const value=accept(await request({acao:'abrir'}));status('saved','Dados do servidor · revisão '+value.revision);return value;
    }catch(error){announceError(error);throw error;}finally{busy=false;}
  }
  async function readPhotoBytes(url,metadata,variant,turn){
    const original=variant==='original',size=metadata[original?'size_bytes':'preview_size_bytes'],mime=metadata[original?'mime_type':'preview_mime_type'];
    let u;try{u=new URL(url);}catch{throw fail('invalid_photo_url','Endereço privado da fotografia inválido.');}
    const prefix='/storage/v1/object/sign/app-workspace-media/'+encodeURIComponent(clinicId)+'/'+encodeURIComponent(metadata.id)+'/';
    if(u.origin!==PUBLIC_BACKEND.supabaseUrl||u.username||u.password||!u.pathname.startsWith(prefix))throw fail('invalid_photo_url','Endereço privado da fotografia inválido.');
    const controller=new AbortController();controllers.add(controller);const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const response=await fetchImpl(u.href,{cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',signal:controller.signal});check(turn);
      if(!response.ok)throw fail('photo_expired','Acesso à foto expirou. Abra novamente.');
      if(response.headers.get('content-type')?.split(';')[0]!==mime)throw fail('photo_integrity','O formato recebido não corresponde à fotografia.');
      const reader=response.body?.getReader();if(!reader)throw fail('photo_integrity','A fotografia veio vazia.');const parts=[];let total=0;
      while(true){const {done,value}=await reader.read();check(turn);if(done)break;total+=value.byteLength;if(total>size){await reader.cancel();throw fail('photo_integrity','A fotografia excedeu o tamanho confirmado.');}parts.push(value);}
      if(total!==size)throw fail('photo_integrity','A fotografia está incompleta.');return new Blob(parts,{type:mime});
    }catch(error){if(error instanceof CloudStoreError)throw error;check(turn);throw fail('photo_network_error','Não foi possível concluir o download privado. Abra a foto novamente.');}
    finally{clearTimeout(timer);controllers.delete(controller);}
  }
  async function getPhoto(id){
    assertOpen();const turn=generation;let auth;
    try{
      const expected=statePhoto(current,id),binding={id,patient_id:expected.visit.patientId,visit_id:expected.visit.id,sha256:expected.photo.sha256,width:expected.photo.width,height:expected.photo.height};
      auth=await session.requireReady();check(turn);
      const response=await request({acao:'obterfoto',photo_id:id}),photo=verifyPhoto(response.photo,binding);
      const [original,preview]=await Promise.all([readPhotoBytes(photo.original_url,photo,'original',turn),readPhotoBytes(photo.preview_url,photo,'preview',turn)]);
      const [originalHash,previewHash]=await Promise.all([sha(original),sha(preview)]);
      await authCurrent(auth,turn);const live=statePhoto(current,id);
      if(live.visit.id!==binding.visit_id||live.visit.patientId!==binding.patient_id||live.photo.sha256!==binding.sha256)throw fail('photo_context','O vínculo da fotografia mudou durante a leitura.');
      if(originalHash!==photo.sha256||previewHash!==photo.preview_sha256)throw fail('photo_integrity','Os arquivos recebidos não passaram na conferência de integridade.');
      return {id,original,preview};
    }catch(error){if(authError(error))invalidate(error.code);throw error;}
  }
  async function readSnapshot(){
    assertOpen();if(busy)throw fail('busy','Aguarde a operação em andamento.');if(pending)throw fail('pending_operation','Confira a gravação pendente antes de exportar.');
    busy=true;const turn=generation;try{
      const value=accept(await request({acao:'abrir'})),photos=[],snapshotClinic=clinicId;
      for(const visit of value.visits)for(const photo of visit.photos)photos.push(await getPhoto(photo.id));
      check(turn);return {state:value,photos,scope:'clinica-servidor',clinicId:snapshotClinic};
    }finally{busy=false;}
  }
  return {load,commit,getPhoto,readSnapshot,getClinicId:()=>{assertOpen();return clinicId;},resolvePending,refreshAfterConflict,isBusy:()=>busy,hasPending:()=>!!pending,hasConflict:()=>!!pending?.rejected,
    restoreSnapshot:async()=>{throw fail('restore_unavailable','Restauração no servidor exige conferência do histórico e ainda não está disponível nesta versão.');},
    dispose(){closed=true;unsubscribe?.();invalidate('closed');}};
}
