import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudStore,CloudStoreError} from '../cloud-store.mjs';
import {normalizeWorkspace} from '../store.mjs';
import {PUBLIC_BACKEND} from '../integration/public-backend.mjs';

const CLINIC='11111111-1111-4111-8111-111111111111';
const OTHER='22222222-2222-4222-8222-222222222222';
const copy=v=>structuredClone(v),uuid=n=>'aaaaaaaa-aaaa-4aaa-8aaa-'+String(n).padStart(12,'0');
const metadata={ok:true,auth_method:'supabase_auth',role:'owner',clinic_id:CLINIC};
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const fixture=()=>normalizeWorkspace({schema:1,revision:0,patients:[{id:'p1',name:'Paciente teste'}],visits:[{id:'v1',patientId:'p1',date:'2026-10-15',status:'aberto',photos:[],maps:{}}],appointments:[],bills:[],payments:[],requests:[],auditLog:[]});
const workspace=state=>({schema:1,revision:state.revision,state:copy(state)});
const saved=(payload,state)=>({...metadata,workspace:workspace(state),operation:{id:payload.operation_id,status:'committed',revision:state.revision}});
function session(){let revision=0;const listeners=new Set();return {async requireReady(){return {token:'unit-test-only',revision};},async assertCurrent(snapshot){if(snapshot.revision!==revision)throw Object.assign(Error('Sessão mudou'),{code:'session_changed'});},subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},invalidate(reason){revision++;for(const fn of listeners)fn(reason);}};}
let operationSequence=0;
function harness(handler){const auth=session(),calls=[],statuses=[],invalidated=[];const store=createCloudStore({session:auth,fetchImpl:async(url,init)=>{const payload=init.body instanceof FormData?Object.fromEntries(init.body):init.body?JSON.parse(init.body):null;calls.push({url,init,payload});return handler({url,init,payload,calls});},uuid:()=>uuid(++operationSequence),timeoutMs:100,onStatus:s=>statuses.push(s),onInvalidated:r=>invalidated.push(r)});return {store,auth,calls,statuses,invalidated};}
function memoryServer(){let state=fixture();const operations=new Map();return {state:()=>state,operations,async handle({payload}){if(payload.acao==='abrir')return response({...metadata,workspace:workspace(state)});if(payload.acao==='status_operacao')return response({...metadata,operation:operations.get(payload.operation_id)||null});if(payload.acao==='commit'){const previous=operations.get(payload.operation_id);if(previous)return response({...metadata,...previous.result,operation:previous});if(payload.expected_revision!==state.revision)return response({ok:false,codigo:'revision_conflict',erro:'Conflito real'},409);state=copy(payload.state);state.revision++;const value=saved(payload,state);operations.set(payload.operation_id,{id:payload.operation_id,kind:'commit',status:'committed',revision:state.revision,result:{workspace:value.workspace}});return response(value);}throw Error('Ação de teste inesperada');}};}

test('lost response after server commit recovers exact operation without replaying mutation',async()=>{
  const server=memoryServer();let drop=true;const h=harness(async request=>{const result=await server.handle(request);if(request.payload.acao==='commit'&&drop){drop=false;throw Error('Connection reset after commit');}return result;});
  await h.store.load();await assert.rejects(()=>h.store.commit(0,s=>s.patients[0].name='Nome salvo'),e=>e.uncertain);assert.equal(server.state().revision,1);assert.equal(h.store.hasPending(),true);
  await assert.rejects(()=>h.store.commit(0,()=>{}),/pendente/);const value=await h.store.resolvePending();assert.equal(value.revision,1);assert.equal(value.patients[0].name,'Nome salvo');assert.equal(h.store.hasPending(),false);assert.equal(h.calls.filter(c=>c.payload.acao==='commit').length,1);h.store.dispose();
});
test('invalid successful workspace after commit stays pending until confirmed',async()=>{
  const server=memoryServer();const h=harness(async request=>{const result=await server.handle(request);if(request.payload.acao==='commit'){const body=await result.json();body.workspace.state.schema=2;return response(body);}return result;});
  await h.store.load();await assert.rejects(()=>h.store.commit(0,s=>s.patients[0].name='Novo'),e=>e.code==='invalid_workspace'&&e.uncertain);assert.equal(h.store.hasPending(),true);assert.equal((await h.store.resolvePending()).revision,1);h.store.dispose();
});
test('unknown status does not permit discarding a possibly in-flight commit; retry reuses ID and payload',async()=>{
  const server=memoryServer();let drop=true;const h=harness(async request=>{if(request.payload.acao==='commit'&&drop){drop=false;throw Error('Lost before server');}return server.handle(request);});
  await h.store.load();await assert.rejects(()=>h.store.commit(0,s=>s.patients[0].name='Alteração'));await assert.rejects(()=>h.store.refreshAfterConflict(),e=>e.code==='pending_operation'&&e.uncertain);assert.equal(h.store.hasPending(),true);
  const value=await h.store.resolvePending(),writes=h.calls.filter(c=>c.payload.acao==='commit');assert.equal(value.revision,1);assert.deepEqual(writes[0].payload,writes[1].payload);h.store.dispose();
});
test('pending payload is detached from caller references and cannot drift between retries',async()=>{
  const server=memoryServer();let drop=true,retained;const h=harness(async request=>{if(request.payload.acao==='commit'&&drop){drop=false;throw Error('Offline');}return server.handle(request);});await h.store.load();
  await assert.rejects(()=>h.store.commit(0,s=>{retained=s;s.patients[0].name='Texto confirmado pelo formulário';}));retained.patients[0].name='Mutação tardia fora da operação';
  const value=await h.store.resolvePending();assert.equal(value.patients[0].name,'Texto confirmado pelo formulário');const writes=h.calls.filter(c=>c.payload.acao==='commit');assert.deepEqual(writes[0].payload,writes[1].payload);h.store.dispose();
});
test('wrong commit receipt or revision is never accepted as saved',async()=>{
  for(const edit of [data=>data.operation.id=uuid(999),data=>data.operation.kind='upload',data=>data.workspace.revision=12]){const server=memoryServer(),h=harness(async request=>{const result=await server.handle(request);if(request.payload.acao!=='commit')return result;const body=await result.json();edit(body);return response(body);});await h.store.load();await assert.rejects(()=>h.store.commit(0,()=>{}),e=>e.uncertain);assert.equal(h.store.hasPending(),true);assert.equal((await h.store.resolvePending()).revision,1);const confirmation=h.statuses.at(-1);assert.equal(confirmation.confirmedOperationId,h.calls.find(c=>c.payload.acao==='commit').payload.operation_id);h.store.dispose();}
});
test('two devices cannot silently overwrite each other; explicit conflict refresh retains winner',async()=>{
  const server=memoryServer(),a=harness(request=>server.handle(request)),b=harness(request=>server.handle(request));await a.store.load();await b.store.load();await a.store.commit(0,s=>s.patients[0].name='Notebook');
  await assert.rejects(()=>b.store.commit(0,s=>s.patients[0].name='Celular'),e=>e.status===409&&e.code==='revision_conflict');assert.equal(b.store.hasPending(),true);assert.equal(b.store.hasConflict(),true);assert.equal(b.statuses.at(-1).kind,'conflict');assert.equal(b.statuses.at(-1).canDiscardPending,true);const latest=await b.store.refreshAfterConflict();assert.equal(latest.patients[0].name,'Notebook');assert.equal(latest.revision,1);assert.equal(b.store.hasPending(),false);a.store.dispose();b.store.dispose();
});
test('conflict refresh holds busy across status and load, and preserves rejected draft when offline',async()=>{
  const server=memoryServer();let offline=false,release;const h=harness(async request=>{if(request.payload.acao==='status_operacao'&&offline)await new Promise(resolve=>release=resolve);if(request.payload.acao==='abrir'&&offline)throw Error('Offline');return server.handle(request);});
  await h.store.load();server.state().revision=1;await assert.rejects(()=>h.store.commit(0,()=>{}));offline=true;const refreshing=h.store.refreshAfterConflict();await new Promise(r=>setTimeout(r,0));assert.equal(h.store.isBusy(),true);await assert.rejects(()=>h.store.resolvePending(),/Aguarde/);release();await assert.rejects(()=>refreshing,/conexão/);assert.equal(h.store.hasPending(),true);h.store.dispose();
});
test('status identity and kind cannot be confused with upload or another operation',async()=>{
  for(const wrong of [{kind:'upload'},{id:uuid(900)}]){const server=memoryServer();let once=true;const h=harness(async request=>{if(request.payload.acao==='status_operacao')return response({...metadata,operation:{id:request.payload.operation_id,kind:'commit',status:'committed',revision:1,result:{workspace:workspace(server.state())},...wrong}});const result=await server.handle(request);if(request.payload.acao==='commit'&&once){once=false;throw Error('uncertain');}return result;});await h.store.load();await assert.rejects(()=>h.store.commit(0,()=>{}));await assert.rejects(()=>h.store.resolvePending(),e=>e.code==='invalid_operation_status');assert.equal(h.store.hasPending(),true);h.store.dispose();}
});
test('HTTP 401/403 HTML invalidate access, clear private pending and never fall back to demo',async()=>{
  for(const status of [401,403]){let deny=false;const h=harness(async()=>deny?new Response('<html>Gateway</html>',{status}):response({...metadata,workspace:workspace(fixture())}));await h.store.load();deny=true;await assert.rejects(()=>h.store.commit(0,()=>{}));assert.equal(h.invalidated.length,1);assert.equal(h.store.hasPending(),false);assert.equal(h.statuses.at(-1).kind,'locked');const calls=h.calls.length;await assert.rejects(()=>h.store.load(),/encerrada/);assert.equal(h.calls.length,calls);h.store.dispose();}
});
test('invalidation while parsing a late response prevents accepting its workspace',async()=>{
  let release;const h=harness(async()=>({ok:true,status:200,json:()=>new Promise(resolve=>release=resolve)}));const pending=h.store.load();await new Promise(r=>setTimeout(r,0));h.auth.invalidate('logout');release({...metadata,workspace:workspace(fixture())});await assert.rejects(()=>pending);assert.equal(h.statuses.filter(s=>s.kind==='saved').length,0);assert.equal(h.statuses.at(-1).kind,'locked');h.store.dispose();
});
test('clinic change is rejected even through operation-status recovery',async()=>{
  const server=memoryServer();let lost=true;const h=harness(async request=>{const result=await server.handle(request);if(request.payload.acao==='commit'&&lost){lost=false;throw Error('Drop');}if(request.payload.acao==='status_operacao'){const data=await result.json();data.clinic_id=OTHER;return response(data);}return result;});await h.store.load();await assert.rejects(()=>h.store.commit(0,()=>{}));await assert.rejects(()=>h.store.resolvePending());assert.equal(h.invalidated[0],'clinic_changed');assert.equal(h.store.hasPending(),false);h.store.dispose();
});
test('known validation rejection uses codigo/erro and allows corrected new operation',async()=>{
  let reject=true;const server=memoryServer(),h=harness(request=>request.payload.acao==='commit'&&reject?response({ok:false,codigo:'invalid_state',erro:'Campo recusado'},422):server.handle(request));await h.store.load();await assert.rejects(()=>h.store.commit(0,()=>{}),e=>e.code==='invalid_state'&&e.message==='Campo recusado');assert.equal(h.store.hasPending(),false);reject=false;assert.equal((await h.store.commit(0,()=>{})).revision,1);h.store.dispose();
});
test('timeout keeps uncertain mutation and observer exceptions do not prevent loading',async()=>{
  let counter=0;const auth=session();const store=createCloudStore({session:auth,timeoutMs:10,onStatus(){throw Error('UI callback bug');},fetchImpl:async(_url,init)=>{const p=JSON.parse(init.body);if(p.acao==='abrir')return response({...metadata,workspace:workspace(fixture())});counter++;return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(Error('timeout'))));}});await store.load();await assert.rejects(()=>store.commit(0,()=>{}),e=>e.uncertain);assert.equal(counter,1);assert.equal(store.hasPending(),true);store.dispose();
});
test('observer failure cannot turn a confirmed commit into a failed or pending operation',async()=>{
  const server=memoryServer(),store=createCloudStore({session:session(),uuid:()=>uuid(99999),onStatus(){throw Error('Bad observer');},fetchImpl:async(_url,init)=>server.handle({payload:JSON.parse(init.body)})});await store.load();const value=await store.commit(0,s=>s.patients[0].name='Confirmado');assert.equal(value.revision,1);assert.equal(value.patients[0].name,'Confirmado');assert.equal(store.hasPending(),false);store.dispose();
});

const hash=async blob=>Buffer.from(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())).toString('hex');
async function photoFixture(){
  const original=new Blob(['original-test-bytes'],{type:'image/png'}),preview=new Blob(['preview-test-bytes'],{type:'image/webp'}),sha256=await hash(original),preview_sha256=await hash(preview);
  const meta={id:'photo1',label:'Teste',phase:'registro',sha256,width:10,height:10};
  const receipt={id:meta.id,patient_id:'p1',visit_id:'v1',sha256,preview_sha256,size_bytes:original.size,preview_size_bytes:preview.size,mime_type:original.type,preview_mime_type:preview.type,width:10,height:10,original_width:10,original_height:10};
  const prefix=PUBLIC_BACKEND.supabaseUrl+'/storage/v1/object/sign/app-workspace-media/'+CLINIC+'/photo1/';
  return {original,preview,meta,receipt,urls:{original_url:prefix+'original.png?token=fake',preview_url:prefix+'preview.webp?token=fake'},input:{id:'photo1',original,preview}};
}
test('lost upload response recovers matching photo receipt and commits once without duplicate upload',async()=>{
  const photo=await photoFixture(),server=memoryServer();let uploadOp,drop=true;const h=harness(async request=>{if(request.payload.acao==='upload'){uploadOp={id:request.payload.operation_id,kind:'upload',status:'committed',revision:null,result:{photo:photo.receipt}};if(drop){drop=false;throw Error('Lost upload response');}return response({...metadata,photo:photo.receipt,operation:uploadOp});}if(request.payload.acao==='status_operacao'&&request.payload.operation_id===uploadOp?.id)return response({...metadata,operation:uploadOp});return server.handle(request);});
  await h.store.load();await assert.rejects(()=>h.store.commit(0,s=>s.visits[0].photos.push(photo.meta),photo.input),e=>e.uncertain);assert.equal(server.state().revision,0);assert.equal((await h.store.resolvePending()).revision,1);assert.equal(h.calls.filter(c=>c.payload.acao==='upload').length,1);assert.equal(h.calls.filter(c=>c.payload.acao==='commit').length,1);h.store.dispose();
});
test('upload recovery rejects a different patient or preview hash without committing workspace',async()=>{
  for(const wrong of [{patient_id:'p2'},{preview_sha256:'0'.repeat(64)}]){const photo=await photoFixture(),server=memoryServer();const h=harness(async request=>{if(request.payload.acao==='upload')return response({...metadata,photo:{...photo.receipt,...wrong},operation:{id:request.payload.operation_id,kind:'upload',status:'committed'}});return server.handle(request);});await h.store.load();await assert.rejects(()=>h.store.commit(0,s=>s.visits[0].photos.push(photo.meta),photo.input),e=>e.code==='upload_unconfirmed'&&e.uncertain);assert.equal(h.calls.filter(c=>c.payload.acao==='commit').length,0);assert.equal(h.store.hasPending(),true);h.store.dispose();}
});
test('existing originals, blocked visits and mismatched original hashes reject before upload',async()=>{
  for(const mode of ['existing','locked','hash']){const photo=await photoFixture(),initial=fixture();if(mode==='existing')initial.visits[0].photos.push(photo.meta);if(mode==='locked')initial.visits[0].lockedAt='2026-10-15T12:00:00Z';const h=harness(async()=>response({...metadata,workspace:workspace(initial)}));await h.store.load();await assert.rejects(()=>h.store.commit(0,s=>{if(mode!=='existing')s.visits[0].photos.push({...photo.meta,...(mode==='hash'?{sha256:'0'.repeat(64)}:{})});},photo.input));assert.equal(h.calls.length,1);assert.equal(h.store.hasPending(),false);h.store.dispose();}
});
async function readHarness({alterPhoto=p=>p,alterPreview=p=>p,onRead=()=>{}}={}){
  const photo=await photoFixture(),state=fixture();state.visits[0].photos.push(photo.meta);
  const h=harness(async request=>{if(!request.payload){onRead();return new Response(request.url.includes('/preview.')?alterPreview(photo.preview):photo.original);}if(request.payload.acao==='abrir')return response({...metadata,workspace:workspace(state)});if(request.payload.acao==='obterfoto')return response({...metadata,photo:alterPhoto({...photo.receipt,...photo.urls})});throw Error('Unexpected call');});await h.store.load();return {...h,photo,state};
}
test('download verifies original and preview and restricts signed paths to this clinic/photo',async()=>{
  const h=await readHarness(),download=await h.store.getPhoto('photo1');assert.equal(await hash(download.original),h.photo.receipt.sha256);assert.equal(await hash(download.preview),h.photo.receipt.preview_sha256);h.store.dispose();
  for(const change of [p=>({...p,patient_id:'p2'}),p=>({...p,original_url:p.original_url.replace(CLINIC,OTHER)}),p=>({...p,original_url:'https://example.com/private.png'})]){const bad=await readHarness({alterPhoto:change});await assert.rejects(()=>bad.store.getPhoto('photo1'));assert.equal(bad.calls.filter(c=>!c.payload).length<=1,true);bad.store.dispose();}
});
test('corrupt preview and oversize byte stream are rejected even if original is valid',async()=>{
  for(const change of [p=>new Blob(['x'.repeat(p.size)],{type:p.type}),p=>new Blob(['x'.repeat(p.size+1)],{type:p.type})]){const h=await readHarness({alterPreview:change});await assert.rejects(()=>h.store.getPhoto('photo1'),e=>e.code==='photo_integrity');h.store.dispose();}
});
test('logout during final hashing discards already downloaded private photos',async()=>{
  const h=await readHarness(),digest=crypto.subtle.digest.bind(crypto.subtle);let invalidated=false;const original=crypto.subtle.digest;
  crypto.subtle.digest=async(...args)=>{const value=await digest(...args);if(!invalidated){invalidated=true;h.auth.invalidate('logout-during-hash');}return value;};
  try{await assert.rejects(()=>h.store.getPhoto('photo1'));assert.equal(h.invalidated[0],'logout-during-hash');assert.equal(h.statuses.at(-1).kind,'locked');}finally{crypto.subtle.digest=original;h.store.dispose();}
});
test('snapshot holds the mutation lock through all photo bytes',async()=>{
  let release,reads=0;const photo=await photoFixture(),state=fixture();state.visits[0].photos.push(photo.meta);const h=harness(async request=>{if(!request.payload){if(++reads===1)await new Promise(resolve=>release=resolve);return new Response(request.url.includes('/preview.')?photo.preview:photo.original);}if(request.payload.acao==='abrir')return response({...metadata,workspace:workspace(state)});return response({...metadata,photo:{...photo.receipt,...photo.urls}});});await h.store.load();const snapshot=h.store.readSnapshot();while(!release)await new Promise(r=>setTimeout(r,0));assert.equal(h.store.isBusy(),true);await assert.rejects(()=>h.store.commit(0,()=>{}),/Aguarde/);release();const result=await snapshot;assert.equal(result.photos.length,1);assert.equal(result.state.revision,0);assert.equal(result.clinicId,CLINIC);h.store.dispose();
});
