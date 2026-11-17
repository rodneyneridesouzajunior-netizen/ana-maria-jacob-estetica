// Anamnese recebida → cadastro da paciente criado ou completado, sem redigitar.
import test from 'node:test';
import assert from 'node:assert/strict';
import {seed} from '../domain.mjs';
import {identityFields,findPatientForIdentity,planPatientFromIdentity,applyPatientPlan,needsPatientData,syncAnamnesePatients,describeSync,SYNC_STORAGE_KEY} from '../anamnese-patient-sync.mjs';
import {createClinicalBridgeService} from '../clinical-bridge-service.mjs';
import {emptyState,validateTransition} from '../../../supabase/functions/app-workspace/rules.mjs';
import {createWorkspaceHandler} from '../../../supabase/functions/app-workspace/handler.mjs';

const today='2026-11-16',id=n=>`${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;
const identity=(extra={})=>({name:'Joana  Lima Souza',cpf:'529.982.247-25',birth_date:'1990-05-10',phone:'(31) 98888-7777',...extra});
const listed=(n,extra={})=>({source_kind:'anamnese',source_id:id(n),type:'anamnese',status:'recebido',archived:false,withdrawn:false,source_fingerprint:'e'.repeat(64),identity:{name:'Joana Lima Souza',cpf_masked:'•••••••••25',birth_date:'1990-05-10',phone_masked:'•••••••7777'},...extra});
const memory=()=>{const data=new Map();return{getItem:k=>data.has(k)?data.get(k):null,setItem:(k,v)=>data.set(k,String(v)),data};};

test('identidade válida vira campos do cadastro; dados inválidos são descartados',()=>{
  assert.deepEqual(identityFields(identity(),{today}),{name:'Joana Lima Souza',cpf:'52998224725',birthDate:'1990-05-10',phone:'31988887777'});
  assert.deepEqual(identityFields({name:'J',cpf:'111.111.111-11',birth_date:'2990-01-01',phone:'123'},{today}),{name:'',cpf:'',birthDate:'',phone:''});
  assert.equal(planPatientFromIdentity([],{name:'Sem CPF',cpf:''},{today}).action,'skip');
});

test('cria o cadastro que falta e completa só os campos vazios do que já existe',()=>{
  const s=seed();let plan=planPatientFromIdentity(s.patients,identity(),{today});assert.equal(plan.action,'create');
  const created=applyPatientPlan(s,plan,{today,patientId:'nova'});assert.equal(created.name,'Joana Lima Souza');assert.equal(created.cpf,'52998224725');assert.equal(created.birthDate,'1990-05-10');assert.equal(created.phone,'31988887777');
  assert.equal(planPatientFromIdentity(s.patients,identity(),{today}).action,'none','segunda vez não muda nada');
  // Cadastro feito à mão sem CPF nem nascimento: encontrado pelo nome e completado.
  const t=seed();t.patients.push({id:'manual',name:'JOANA LIMA SOUZA',phone:'31911112222'});plan=planPatientFromIdentity(t.patients,identity(),{today});
  assert.equal(plan.action,'update');assert.deepEqual(plan.patch,{cpf:'52998224725',birthDate:'1990-05-10'});const updated=applyPatientPlan(t,plan,{today});
  assert.equal(updated.cpf,'52998224725');assert.equal(updated.birthDate,'1990-05-10');assert.equal(updated.phone,'31911112222','telefone já preenchido é preservado');assert.equal(t.patients.filter(p=>p.cpf==='52998224725').length,1);
  // Mesmo CPF com nascimento diferente: não sobrescreve, só avisa.
  const u=seed();u.patients.push({id:'outra',name:'Joana Lima',cpf:'52998224725',birthDate:'1989-01-01',phone:'31900000000'});plan=planPatientFromIdentity(u.patients,identity(),{today});
  assert.equal(plan.action,'none');assert.deepEqual(plan.conflicts,['data de nascimento','nome']);assert.equal(u.patients.at(-1).birthDate,'1989-01-01');
  // Dois cadastros sem CPF com o mesmo nome: não adivinha qual é; cria um novo com CPF.
  const v=seed();v.patients.push({id:'a',name:'Joana Lima Souza'},{id:'b',name:'Joana Lima Souza'});assert.equal(findPatientForIdentity(v.patients,identityFields(identity(),{today})),null);
});

test('a lista mascarada indica quando ainda falta trazer os dados',()=>{
  assert.equal(needsPatientData([],listed('4')),true);
  assert.equal(needsPatientData([{name:'Joana Lima Souza',cpf:'52998224725',birthDate:'1990-05-10',phone:'31988887777'}],listed('4')),false);
  assert.equal(needsPatientData([{name:'Joana Lima Souza',cpf:'52998224725',phone:'31988887777'}],listed('4')),true,'falta nascimento');
  assert.equal(needsPatientData([{name:'Joana Lima Souza',cpf:'52998224725',birthDate:'1990-05-10'}],listed('4')),true,'falta telefone');
  assert.equal(needsPatientData([{name:'Joana Lima Souza',cpf:'11144477735',birthDate:'1990-05-10',phone:'1'}],listed('4')),true,'CPF de outra pessoa');
});

test('sincronização: cria e completa em salvamentos aceitos pelo servidor, uma vez por anamnese',async()=>{
  let state=emptyState();state.patients.push({id:'manual',name:'Maria Teste Silva',version:1,createdAt:'2026-11-01T12:00:00.000Z',updatedAt:'2026-11-01T12:00:00.000Z'});const calls=[],storage=memory();let saves=0;
  const documents=[listed('4'),listed('5',{identity:{name:'Maria Teste Silva',cpf_masked:'•••••••••35',birth_date:'1985-03-02',phone_masked:'•••••••4444'}}),listed('6',{type:'tcle_toxina_botulinica',source_kind:'documento_clinico'}),listed('7',{status:'processando'}),listed('8',{archived:true})];
  const identities={[id('4')]:identity(),[id('5')]:{name:'Maria Teste Silva',cpf:'11144477735',birth_date:'1985-03-02',phone:'31955554444'}};
  const service={listDocuments:async v=>{calls.push('list:'+v.limit);return{documents};},documentIdentity:async v=>{calls.push('identity:'+v.source_id);return{identity:identities[v.source_id]};}};
  const persist=async update=>{const next=structuredClone(state);update(next);validateTransition(state,next);state=next;saves++;return state;};
  const result=await syncAnamnesePatients({service,getState:()=>state,persist,storage,today});
  assert.deepEqual(result.created,['Joana Lima Souza']);assert.deepEqual(result.updated,['Maria Teste Silva']);assert.equal(result.failed,'');assert.equal(saves,2);
  assert.deepEqual(calls,['list:50','identity:'+id('4'),'identity:'+id('5')],'só anamneses recebidas e ativas são consultadas');
  const joana=state.patients.find(p=>p.cpf==='52998224725'),maria=state.patients.find(p=>p.id==='manual');assert.equal(joana.birthDate,'1990-05-10');assert.equal(maria.cpf,'11144477735');assert.equal(maria.birthDate,'1985-03-02');assert.equal(maria.phone,'31955554444');
  assert.match(describeSync(result),/Cadastro criado pela anamnese: Joana Lima Souza\. Cadastro completado pela anamnese: Maria Teste Silva\./);
  // Segunda rodada: nada a fazer, nenhuma consulta de identidade e nenhum salvamento.
  calls.length=0;const again=await syncAnamnesePatients({service,getState:()=>state,persist,storage,today});assert.deepEqual(calls,['list:50']);assert.equal(saves,2);assert.equal(describeSync(again),'');
  // Paciente apagada à mão não é recriada neste aparelho.
  state.patients=state.patients.filter(p=>p.id!==joana.id);calls.length=0;await syncAnamnesePatients({service,getState:()=>state,persist,storage,today});assert.deepEqual(calls,['list:50']);assert.ok(JSON.parse(storage.data.get(SYNC_STORAGE_KEY)).includes(id('4')));
});

test('servidor ainda sem a função nova ou falha de rede: para sem gravar nada e tenta de novo depois',async()=>{
  const state=emptyState(),storage=memory();let saves=0;
  const service={listDocuments:async()=>({documents:[listed('4'),listed('5')]}),documentIdentity:async()=>{throw Object.assign(Error('recusado'),{code:'http_422'});}};
  const result=await syncAnamnesePatients({service,getState:()=>state,persist:async()=>{saves++;},storage,today});
  assert.equal(result.failed,'http_422');assert.equal(result.checked,0);assert.equal(saves,0);assert.equal(storage.data.size,0);assert.equal(describeSync(result),'');
  assert.equal((await syncAnamnesePatients({service:{listDocuments:async()=>({documents:[]})},getState:()=>state,persist:async()=>{},storage,today})).failed,'unsupported');
});

test('servidor: identidade completa só para anamnese recebida, com titular e MFA, e impressão digital atual',async()=>{
  const ctx={authMethod:'supabase_auth',role:'owner',aal:'aal2',clinicId:id('1'),userId:id('2'),sessionId:id('3')},origin='https://anamariajacob.com.br';
  const source=(extra={})=>({source_kind:'anamnese',source_id:id('4'),type:'anamnese',status:'recebido',source_version:'2026-08-19-v1',source_hash:'a'.repeat(64),signature_sha256:'b'.repeat(64),pdf_sha256:'c'.repeat(64),registry_sha256:'d'.repeat(64),source_fingerprint:'e'.repeat(64),received_at:'2026-11-15T18:00:00Z',identity:{name:' Paciente Fictícia ',cpf:'529.982.247-25',birth_date:'1990-01-01',phone:'(31) 90000-0000'},archived:false,withdrawn:false,bucket:'fichas-pdf',pdf_path:'anamneses/'+id('4')+'/ficha.pdf',signature_path:'anamneses/'+id('4')+'/assinatura.png',storage_valid:true,...extra});
  const make=(current,auth=ctx)=>{const handler=createWorkspaceHandler({repository:{load:async()=>({revision:1,state:{patients:[],visits:[]}}),clinicalSource:async()=>current?structuredClone(current):null},authenticate:async()=>auth,authorize:async()=>{}});return async p=>{const r=await handler(new Request(origin,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(p)}));return{status:r.status,body:await r.json()};};};
  const payload={acao:'identidade_documento_original',source_kind:'anamnese',source_id:id('4'),expected_source_fingerprint:'e'.repeat(64)};
  const ok=await make(source())(payload);assert.equal(ok.status,200);assert.deepEqual(ok.body.identity,{name:'Paciente Fictícia',cpf:'52998224725',birth_date:'1990-01-01',phone:'31900000000'});assert.equal(ok.body.document.identity.cpf_masked,'•••••••••25');assert.equal(JSON.stringify(ok.body).includes('pdf_path'),false);
  assert.equal((await make(source())({...payload,expected_source_fingerprint:'f'.repeat(64)})).status,409);
  assert.equal((await make(null)(payload)).status,404);
  assert.equal((await make(source({status:'processando'}))(payload)).body.codigo,'source_not_received');
  assert.equal((await make(source({archived:true}))(payload)).body.codigo,'source_not_received');
  assert.equal((await make(source())({...payload,source_kind:'documento_clinico'})).status,422);
  for(const auth of [{...ctx,aal:'aal1'},{...ctx,role:'professional'}])assert.notEqual((await make(source(),auth)(payload)).status,200,'sem titular com MFA não há identidade');
  const bad=await make(source({identity:{name:'X',cpf:'11111111111',birth_date:'10/05/1990',phone:'12'}}))(payload);assert.deepEqual(bad.body.identity,{name:'X',cpf:'',birth_date:'',phone:''});
});

test('cliente: o serviço só pede identidade de anamnese com identificadores válidos',async()=>{
  const sent=[],session={requireReady:async()=>({token:'t'}),assertCurrent:async()=>{},subscribe:()=>()=>{}};
  const service=createClinicalBridgeService({session,request:async(endpoint,action,payload)=>{sent.push([endpoint,action,payload]);return{ok:true,auth_method:'supabase_auth',role:'owner',clinic_id:id('1'),identity:identity()};}});
  const good={source_kind:'anamnese',source_id:id('4'),expected_source_fingerprint:'e'.repeat(64)};assert.deepEqual((await service.documentIdentity(good)).identity,identity());assert.deepEqual(sent,[['app-workspace','identidade_documento_original',good]]);
  for(const bad of [{...good,source_kind:'documento_clinico'},{...good,source_id:'x'},{...good,expected_source_fingerprint:'abc'},{...good,extra:1}])assert.throws(()=>service.documentIdentity(bad));
});
