import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import http from 'node:http';
import {createClinicIntegration} from '../adapter.mjs';
import {DEFAULT_CONFIG,validateConfig} from '../config.mjs';
import {createSessionBridge} from '../session.mjs';
import {createIntegrationServer} from '../serve.mjs';
import {mountIntegration,renderIntegrationPage} from '../ui.mjs';
import {createSiteClient} from '../site.mjs';

const id='11111111-1111-4111-8111-111111111111';
const operation='22222222-2222-4222-8222-222222222222';
function authFixture({aal='aal2',expiresAt=Math.floor(Date.now()/1000)+3600}={}) {
  let session={access_token:'fixture-token-not-a-credential',expires_at:expiresAt,user:{id}}, callback, signouts=0;
  const auth={
    initialize:async()=>({session}),
    getSession:async()=>session,
    getNextStep:async()=>({step:session?(aal==='aal2'?'ready':'challenge'):'login',session,aal:{currentLevel:aal}}),
    signOut:async()=>{signouts++;session=null;callback?.('SIGNED_OUT',null);},
    client:{auth:{onAuthStateChange(fn){callback=fn;return {data:{subscription:{unsubscribe(){callback=null;}}}};}}},
  };
  return {auth,get signouts(){return signouts;},setSession(value){session=value;callback?.('SIGNED_IN',value);}};
}
const ok = extra => new Response(JSON.stringify({auth_method:'supabase_auth',role:'owner',identity:{display_name:'Conta de teste',role:'owner'},...extra}),{status:200,headers:{'content-type':'application/json'}});
const errorResponse=(status,codigo)=>new Response(JSON.stringify({erro:'Erro seguro do contrato',codigo}),{status,headers:{'content-type':'application/json'}});
function harness({config={},auth=authFixture(),fetchImpl=async()=>ok({clientes:[]}),origin='http://127.0.0.1:8765'}={}) {
  const calls=[];
  const api=createClinicIntegration({config:{...DEFAULT_CONFIG,...config},authController:auth.auth,origin,fetchImpl:async(...args)=>{calls.push(args);return fetchImpl(...args);}});
  return {api,calls,auth};
}
test('config rejects untrusted token destinations and key substitutions',()=>{
  assert.throws(()=>validateConfig({supabaseUrl:'https://attacker.example'}),{code:'untrusted_backend'});
  assert.throws(()=>validateConfig({publishableKey:'sb_secret_test'}),{code:'invalid_public_key'});
});
test('unsupported local origin blocks before auth or network',async t=>{
  const h=harness({origin:'http://127.0.0.1:8766'});t.after(()=>h.api.dispose());
  await assert.rejects(h.api.patients.list(),{code:'origin_not_allowed'});assert.equal(h.calls.length,0);
});
test('AAL1 cannot consult private records',async t=>{
  const h=harness({auth:authFixture({aal:'aal1'})});t.after(()=>h.api.dispose());
  await assert.rejects(h.api.records.list(),{code:'mfa_required'});assert.equal(h.calls.length,0);
});
test('expired session fails before request; no trusting cached user metadata',async t=>{
  const h=harness({auth:authFixture({expiresAt:1})});t.after(()=>h.api.dispose());
  await assert.rejects(h.api.patients.list(),{code:'session_expired'});assert.equal(h.calls.length,0);
});
test('list patients uses real wire contract, bearer and no-store',async t=>{
  const h=harness();t.after(()=>h.api.dispose());
  const result=await h.api.patients.list({pagina:2,por_pagina:25,busca:'Exemplo'});
  assert.deepEqual(result.clientes,[]);
  const [url,request]=h.calls[0];assert.ok(url.endsWith('/functions/v1/financeiro-fichas'));
  assert.deepEqual(JSON.parse(request.body),{pagina:2,por_pagina:25,busca:'Exemplo',acao:'listar_clientes'});
  assert.equal(request.headers.Authorization,'Bearer fixture-token-not-a-credential');
  assert.equal(request.cache,'no-store');assert.equal(request.redirect,'error');assert.equal(request.credentials,'omit');
});
test('payload is captured before delayed auth; later edits cannot change request',async t=>{
  const auth=authFixture(), original=auth.auth.getNextStep;let release;
  auth.auth.getNextStep=()=>new Promise(resolve=>release=async()=>resolve(await original()));
  const h=harness({auth});t.after(()=>h.api.dispose());
  const filters={busca:'Primeiro'},pending=h.api.patients.list(filters);filters.busca='Alterado';await release();await pending;
  assert.equal(JSON.parse(h.calls[0][1].body).busca,'Primeiro');
});
test('writes and reminder synchronization have separate explicit config guards',async t=>{
  const h=harness();t.after(()=>h.api.dispose());
  await assert.rejects(h.api.patients.create({nome:'Teste',idempotency_key:operation}),{code:'writes_disabled'});
  await assert.rejects(h.api.appointments.list(),{code:'agenda_sync_not_approved'});
  assert.equal(h.calls.length,0);
});
test('version names follow each endpoint and stale response is not retried',async t=>{
  const h=harness({config:{writesEnabled:true},fetchImpl:async()=>errorResponse(409,'version_conflict')});t.after(()=>h.api.dispose());
  assert.throws(()=>h.api.patients.update({id,operation_id:operation,versao_esperada:2}),{code:'version_required'});
  await assert.rejects(h.api.patients.update({id,operation_id:operation,versao:2,nome:'Teste',motivo:'Correção'}),{code:'version_conflict'});
  assert.equal(JSON.parse(h.calls[0][1].body).versao,2);assert.equal(h.calls.length,1);
});
for(const status of [401,403])test(`HTTP ${status} invalidates private state and denies access`,async t=>{
  const h=harness({fetchImpl:async()=>errorResponse(status,'denied')});t.after(()=>h.api.dispose());let cleared=0;h.api.session.subscribe(()=>cleared++);
  await assert.rejects(h.api.patients.list(),error=>error.status===status);assert.equal(cleared,1);
});
test('server must confirm individual owner identity; success status is insufficient',async t=>{
  const h=harness({fetchImpl:async()=>new Response(JSON.stringify({clientes:[]}),{status:200})});t.after(()=>h.api.dispose());
  await assert.rejects(h.api.patients.list(),{code:'unexpected_auth_context'});
});
test('logout discards late successful clinical response even if fetch ignores abort',async t=>{
  let resolve, started;
  const called=new Promise(r=>started=r),h=harness({fetchImpl:()=>new Promise(r=>{resolve=r;started();})});t.after(()=>h.api.dispose());
  const pending=h.api.patients.list();await called;await h.api.session.signOut();resolve(ok({clientes:[{nome:'Privado'}]}));
  await assert.rejects(pending,{code:'session_changed'});assert.equal(h.calls[0][1].signal.aborted,true);
});
test('network failure after write is uncertain and never auto retries',async t=>{
  const h=harness({config:{writesEnabled:true},fetchImpl:async()=>{throw new TypeError('network');}});t.after(()=>h.api.dispose());
  await assert.rejects(h.api.patients.create({idempotency_key:operation,nome:'Teste'}),error=>error.uncertain===true);
  assert.equal(h.calls.length,1);
});
test('photo upload preserves protocol and original bytes, with browser multipart boundary',async t=>{
  const h=harness({config:{writesEnabled:true},fetchImpl:async()=>ok({foto_id:id})});t.after(()=>h.api.dispose());
  const bytes=new Uint8Array([1,2,3]),file=new Blob([bytes],{type:'image/jpeg'});
  await h.api.photos.upload({protocolo_id:id,idempotency_key:operation,fase:'before',arquivo:file,tirada_em:'2026-10-15T10:00:00-03:00'});
  const request=h.calls[0][1];assert.equal(request.headers['Content-Type'],undefined);
  assert.equal(request.body.get('acao'),'adicionar_foto');assert.equal(request.body.get('protocolo_id'),id);
  assert.deepEqual(new Uint8Array(await request.body.get('arquivo').arrayBuffer()),bytes);
});
test('legacy unbound annotation method rejects; callers must use the bound maps API',t=>{
  const h=harness();t.after(()=>h.api.dispose());assert.throws(()=>h.api.photos.saveAnnotations(),{code:'annotations_api_unavailable'});assert.equal(h.calls.length,0);
});
test('private response expires during network processing and is discarded',async()=>{
  let now=100000;const auth=authFixture({expiresAt:200}),bridge=createSessionBridge(auth.auth,{now:()=>now});
  try{const snapshot=await bridge.requireReady();now=201000;await assert.rejects(bridge.assertCurrent(snapshot),{code:'session_changed'});}finally{bridge.destroy();}
});
test('copied SDK and auth controller match original files and recorded SHA256',async()=>{
  const manifests=JSON.parse(await readFile(new URL('../vendor/provenance.json',import.meta.url),'utf8'));
  for(const item of manifests){
    const copy=await readFile(new URL('../vendor/'+item.file,import.meta.url));
    const original=await readFile(new URL('../../../../'+item.source,import.meta.url));
    assert.equal(createHash('sha256').update(copy).digest('hex'),item.sha256);
    assert.deepEqual(copy,original);
  }
});
test('standalone server is loopback-ready with exact CSP and no parent-directory exposure',async t=>{
  const server=createIntegrationServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=path=>new Promise((resolve,reject)=>{const request=http.get(base+path,{headers:{Host:'127.0.0.1:8765'}},response=>{response.resume();response.on('end',()=>resolve(response));});request.on('error',reject);});
  const page=await request('/');assert.equal(page.statusCode,200);assert.match(page.headers['content-security-policy'],/connect-src https:\/\/rjxtxoqprnumouqakxbc\.supabase\.co;/);
  assert.equal((await request('/%2e%2e%2fapp.mjs')).statusCode,404);
  assert.equal((await request('/serve.mjs')).statusCode,404);
  assert.equal((await fetch(base+'/')).status,403);
});
test('UI logout remains usable while a read is pending and clears private DOM',async t=>{
  const elements={body:{innerHTML:'',replaceChildren(){this.innerHTML='';}},message:{textContent:'',className:''},status:{textContent:''}};
  const listeners=new Map();
  const root={matches:()=>true,querySelector:selector=>selector.includes('body')?elements.body:selector.includes('message')?elements.message:elements.status,
    querySelectorAll:()=>[],setAttribute(){},removeAttribute(){},contains:()=>true,addEventListener:(event,fn)=>listeners.set(event,fn),removeEventListener(){}};
  const auth=authFixture();let started,finish;const fetching=new Promise(r=>started=r);
  const mounted=mountIntegration(root,{authController:auth.auth,config:DEFAULT_CONFIG,origin:'http://127.0.0.1:8765',fetchImpl:()=>new Promise(r=>{finish=r;started();})});t.after(()=>mounted.dispose());
  const click=dataset=>listeners.get('click')({target:{closest:()=>({dataset})}});
  const tick=()=>new Promise(resolve=>setImmediate(resolve));
  assert.match(renderIntegrationPage(),/data-clinic-integration/);
  click({ciAction:'start'});await tick();click({ciModule:'patients'});await fetching;
  click({ciAction:'logout'});await tick();assert.equal(auth.signouts,1);assert.doesNotMatch(elements.body.innerHTML,/Consultando o servidor/);
  finish(ok({clientes:[{nome:'Nunca mostrar'}]}));await tick();assert.doesNotMatch(elements.body.innerHTML,/Nunca mostrar/);
});

test('public site request confirms receipt, never a scheduled appointment; no bearer sent',async()=>{
  let calls=0;
  const api=createSiteClient({config:{writesEnabled:true},origin:'http://127.0.0.1:8765',fetchImpl:async(url,request)=>{
    calls++;assert.ok(url.endsWith('/agendamento-submit'));assert.equal(request.headers.Authorization,undefined);
    assert.equal(JSON.parse(request.body).website,'');return new Response(JSON.stringify({ok:true,recebido:true}),{status:202});
  }});
  const result=await api.requestAppointment({idempotency_key:operation,started_at:'2026-10-15T10:00:00-03:00',website:'',nome:'Teste',telefone:'31999999999',primeira_visita:'primeira_avaliacao',interesse:'avaliacao_sem_procedimento',data_preferida:'2026-10-16',periodo:'tarde',consentimento_contato:true});
  assert.deepEqual(result,{received:true,appointmentConfirmed:false});assert.equal(calls,1);
  await assert.rejects(api.requestAppointment({idempotency_key:operation,consentimento_contato:true,clinical_notes:'Não enviar'}),{code:'unexpected_site_field'});
  assert.equal(calls,1);
});
test('UI enables writes only after explicit confirmation without sending clinical data',async t=>{
  const elements={body:{innerHTML:'',replaceChildren(){this.innerHTML='';}},message:{textContent:'',className:''},status:{textContent:''}};
  const listeners=new Map(),root={matches:()=>true,querySelector:selector=>selector.includes('body')?elements.body:selector.includes('message')?elements.message:elements.status,
    querySelectorAll:()=>[],setAttribute(){},removeAttribute(){},contains:()=>true,addEventListener:(event,fn)=>listeners.set(event,fn),removeEventListener(){}};
  let calls=0;const auth=authFixture(),mounted=mountIntegration(root,{authController:auth.auth,origin:'http://127.0.0.1:8765',fetchImpl:async()=>{calls++;return ok({clientes:[]});}});t.after(()=>mounted.dispose());
  const click=action=>listeners.get('click')({target:{closest:()=>({dataset:{ciAction:action}})}}),tick=()=>new Promise(r=>setImmediate(r));
  click('start');await tick();click('enable-writes');await tick();
  assert.match(elements.body.innerHTML,/Habilitar gravações na base real/);assert.match(elements.body.innerHTML,/gravações desativadas/);
  click('confirm-writes');await tick();assert.match(elements.body.innerHTML,/Gravações habilitadas nesta sessão/);assert.equal(calls,0);
  click('disable-writes');await tick();assert.match(elements.body.innerHTML,/gravações desativadas/);assert.equal(calls,0);
});

function privateUIFixture(fetchImpl){
 const elements={body:{innerHTML:'',replaceChildren(){this.innerHTML='';}},message:{textContent:'',className:''},status:{textContent:''}},listeners=new Map();
 const root={matches:()=>true,querySelector:selector=>selector.includes('body')?elements.body:selector.includes('message')?elements.message:elements.status,querySelectorAll:()=>[],setAttribute(){},removeAttribute(){},contains:()=>true,addEventListener:(event,fn)=>listeners.set(event,fn),removeEventListener:event=>listeners.delete(event)};
 const mounted=mountIntegration(root,{authController:authFixture().auth,config:{...DEFAULT_CONFIG,writesEnabled:true},origin:'http://127.0.0.1:8765',fetchImpl});
 const click=dataset=>listeners.get('click')({target:{closest:()=>({dataset})}}),tick=()=>new Promise(resolve=>setImmediate(resolve));
 return {mounted,elements,listeners,click,tick};
}
test('patient UI opens complete detail and guards dirty edit navigation until explicit discard',async t=>{
 const calls=[],patient={id,nome:'Paciente teste',cpf:'00000000000',cpf_mascarado:'***.***.***-00',telefone_emergencia:null,versao:2,status:'active'};
 const h=privateUIFixture(async(_url,request)=>{const body=JSON.parse(request.body);calls.push(body);return body.acao==='obter_cliente'?ok({cliente:patient}):ok({clientes:[{...patient,cpf:undefined}],paginacao:{tem_mais:false}});});t.after(()=>h.mounted.dispose());
 h.click({ciAction:'start'});await h.tick();h.click({ciModule:'patients'});await h.tick();h.click({ciAction:'patient',id});await h.tick();h.click({ciAction:'edit-patient',id});await h.tick();
 assert.match(h.elements.body.innerHTML,/name="cpf" value="00000000000"/);assert.equal(calls.length,2);
 h.listeners.get('input')({target:{closest:()=>({})}});assert.equal(h.mounted.isDirty(),true);h.click({ciAction:'reload'});await h.tick();assert.equal(calls.length,2);assert.match(h.elements.message.textContent,/alterações pendentes/);
 h.click({ciAction:'cancel-edit'});await h.tick();assert.equal(h.mounted.isDirty(),false);assert.equal(calls.length,3);
});
test('record UI rechecks server before editing and rejects a now-finalized protocol',async t=>{
 let lists=0;const row={id,patient_id:operation,paciente:{nome:'Paciente teste'},version:1,status:'draft',anamnesis:{},fotos_resumo:{ativas:1}};
 const h=privateUIFixture(async()=>{lists++;return ok({protocolos:[{...row,status:lists===1?'draft':'signed'}],paginacao:{tem_mais:false}});});t.after(()=>h.mounted.dispose());
 h.click({ciAction:'start'});await h.tick();h.click({ciModule:'records'});await h.tick();h.click({ciAction:'record',id});await h.tick();h.click({ciAction:'finalize-record',id});await h.tick();
 assert.equal(lists,2);assert.match(h.elements.message.textContent,/já foi finalizado/);assert.doesNotMatch(h.elements.body.innerHTML,/data-ci-form="finalize-record"/);
});
test('photo list rejects changed patient binding instead of showing originals under stale patient name',async t=>{
 let lists=0,photoCalls=0;const row={id,patient_id:operation,paciente:{nome:'Paciente anterior'},version:1,status:'draft',fotos_resumo:{ativas:1}};
 const h=privateUIFixture(async(_url,request)=>{const body=JSON.parse(request.body);if(body.acao==='listar_fotos'){photoCalls++;return ok({fotos:[],paginacao:{tem_mais:false}});}lists++;return ok({protocolos:[{...row,patient_id:lists===1?operation:id}],paginacao:{tem_mais:false}});});t.after(()=>h.mounted.dispose());
 h.click({ciAction:'start'});await h.tick();h.click({ciModule:'records'});await h.tick();h.click({ciAction:'photos',id});await h.tick();assert.equal(photoCalls,1);assert.equal(lists,2);assert.match(h.elements.message.textContent,/vínculo foi alterado/);assert.doesNotMatch(h.elements.body.innerHTML,/ci-photo-grid/);
});
test('financial feature request remains limited by explicit actions and write/auth guards',async t=>{
 const h=harness(),enabled=harness({config:{writesEnabled:true}});t.after(()=>{h.api.dispose();enabled.api.dispose();});
 for(const action of ['criar_lancamento','programar_parcelas','registrar_pagamento','estornar_pagamento','cancelar_lancamento']){
  await assert.rejects(h.api.request('financeiro-fichas',action,{operation_id:operation}),{code:'writes_disabled'});
  await enabled.api.request('financeiro-fichas',action,{operation_id:operation});
 }
 await assert.rejects(enabled.api.request('financeiro-fichas','apagar_todos',{}),{code:'unsupported_operation'});assert.equal(h.calls.length,0);assert.equal(enabled.calls.length,5);
 assert.ok(enabled.calls.every(([url,request])=>url.endsWith('/functions/v1/financeiro-fichas')&&JSON.parse(request.body).operation_id===operation));
});
