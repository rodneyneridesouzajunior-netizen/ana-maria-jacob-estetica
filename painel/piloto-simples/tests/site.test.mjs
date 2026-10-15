import test from 'node:test';
import assert from 'node:assert/strict';
import {seed} from '../domain.mjs';
import {normalizeClinicState,saveBlock} from '../clinic-domain.mjs';
import {saveSiteRequest,confirmSiteRequest,findRequestPatientMatches,sitePhoneDigits,SITE_DEMO_CONSENT_VERSION} from '../site-domain.mjs';

const now=new Date('2026-10-15T09:00:00'),DAY='2026-10-15';
function state(){const s=normalizeClinicState(seed());s.appointments=[];s.visits=[];return s;}
const input=extra=>({operationId:'operation-test-001',name:'Pessoa Fictícia',phone:'(31) 99999-0000',date:DAY,period:'Tarde',interest:'Avaliação inicial',demoConsent:true,...extra});
function request(s,extra={}){return saveSiteRequest(s,input(extra),{now});}
const slot=extra=>({date:DAY,time:'14:00',duration:60,service:'Avaliação inicial',...extra});

test('solicitação registra origem, estado, consentimento e não reserva agenda',()=>{
  const s=state(),patients=s.patients.length,r=request(s);
  assert.equal(r.status,'pendente');assert.equal(r.mode,'demo');assert.equal(r.origin,'site-demo-local');assert.equal(r.demoConsent,true);assert.equal(r.consent.version,SITE_DEMO_CONSENT_VERSION);assert.equal(r.phoneNormalized,'31999990000');assert.equal(s.appointments.length,0);assert.equal(s.patients.length,patients);assert.equal(r.appointmentId,undefined);
});
test('duplo envio da mesma operação é idempotente, inclusive após virar o dia',()=>{
  const s=state(),first=request(s),again=request(s);assert.equal(again.id,first.id);assert.equal(s.requests.length,1);
  assert.equal(saveSiteRequest(s,input(),{now:new Date('2026-10-16T09:00:00')}).id,first.id);assert.equal(s.requests.length,1);
});
test('mesma operação com dados diferentes é recusada e não reescreve pedido',()=>{const s=state(),r=request(s),before=structuredClone(r);assert.throws(()=>request(s,{date:'2026-10-16'}),/outros dados/);assert.deepEqual(s.requests[0],before);});
test('formatação telefônica equivalente não cria duplicidade de operação',()=>{const s=state(),a=request(s);assert.equal(request(s,{phone:'+55 (31) 99999-0000'}).id,a.id);assert.equal(sitePhoneDigits('+55 (31) 3333-4444'),'3133334444');});
test('nova operação é independente e não deduplica pessoas apenas por contato',()=>{const s=state();request(s);request(s,{operationId:'operation-test-002'});assert.equal(s.requests.length,2);assert.equal(s.appointments.length,0);});
test('data impossível, anterior ou malformada não é salva',()=>{const s=state();for(const date of ['2026-02-30','2026-10-14','15/10/2026','2026-13-01',''])assert.throws(()=>request(s,{date}));assert.equal(s.requests,undefined);});
test('nome, telefone, período e interesse são verificados no domínio',()=>{const s=state();for(const bad of [{name:'A'},{name:'1234'},{name:'<script>'},{phone:'99990000'},{phone:'00000000000'},{phone:'(31) telefone'},{period:'Madrugada'},{interest:'campo inventado'}])assert.throws(()=>request(s,bad));assert.equal(s.requests,undefined);});
test('consentimento precisa ser booleano verdadeiro e ambiente permanece demo',()=>{const s=state();for(const bad of [{demoConsent:false},{demoConsent:undefined},{demoConsent:'true'},{mode:'production'}])assert.throws(()=>request(s,bad));assert.equal(s.requests,undefined);});
test('operação inválida e pedido legado não ganham consentimento por inferência',()=>{const s=state();assert.throws(()=>request(s,{operationId:''}));s.requests=[{...input(),id:'legacy',demoConsent:undefined,mode:undefined,status:'pendente'}];assert.throws(()=>request(s),/antiga/);assert.throws(()=>confirmSiteRequest(s,{requestId:'legacy',patientId:s.patients[0].id,appointment:slot(),now}),/antigo/);assert.equal(s.requests[0].mode,undefined);});
test('confirmação cria paciente via módulo próprio e mantém pedido original e histórico',()=>{
  const s=state(),r=request(s),count=s.patients.length,result=confirmSiteRequest(s,{requestId:r.id,newPatient:true,appointment:slot(),now});
  assert.equal(s.patients.length,count+1);assert.equal(s.appointments.length,1);assert.equal(s.requests.length,1);assert.equal(s.requests[0].name,r.name);assert.equal(s.requests[0].status,'agendado');assert.equal(s.requests[0].appointmentId,result.appointment.id);assert.equal(result.appointment.siteRequestId,r.id);assert.equal(result.appointment.patientId,result.patient.id);assert.equal(s.patientHistory.length,1);assert.equal(s.requests[0].history.length,2);
});
test('segunda confirmação falha sem criar outra paciente ou horário',()=>{const s=state(),r=request(s);confirmSiteRequest(s,{requestId:r.id,newPatient:true,appointment:slot(),now});const before=structuredClone(s);assert.throws(()=>confirmSiteRequest(s,{requestId:r.id,newPatient:true,appointment:slot({time:'15:00'}),now}),/já foi processada/);assert.deepEqual(s,before);});
test('vincular paciente existente é explícito e não altera seu cadastro',()=>{const s=state(),r=request(s),p=structuredClone(s.patients[0]);confirmSiteRequest(s,{requestId:r.id,patientId:p.id,appointment:slot(),now});assert.deepEqual(s.patients.find(x=>x.id===p.id),p);assert.equal(s.patients.length,3);});
test('contatos ou nomes ambíguos impedem criação automática; seleção explícita resolve',()=>{const s=state(),r=request(s);s.patients.push({id:'same-1',name:'Outra Pessoa',phone:'31999990000'},{id:'same-2',name:'Pessoa Fictícia',phone:'3133334444'});assert.equal(findRequestPatientMatches(s,r).length,2);assert.throws(()=>confirmSiteRequest(s,{requestId:r.id,newPatient:true,appointment:slot(),now}),/ambíguo/);assert.equal(s.appointments.length,0);confirmSiteRequest(s,{requestId:r.id,patientId:'same-1',appointment:slot(),now});assert.equal(s.requests[0].patientId,'same-1');});
test('sem escolha de paciente não ocorre correspondência automática por telefone',()=>{const s=state(),r=request(s);s.patients[0].phone=r.phone;assert.throws(()=>confirmSiteRequest(s,{requestId:r.id,appointment:slot(),now}),/explicitamente/);assert.equal(s.appointments.length,0);});
test('falha de disponibilidade reverte até o novo cadastro e seu histórico',()=>{const s=state(),r=request(s);saveBlock(s,{date:DAY,start:'14:00',end:'15:00',reason:'Bloqueio de teste'});const before=structuredClone(s);assert.throws(()=>confirmSiteRequest(s,{requestId:r.id,newPatient:true,appointment:slot(),now}),/bloqueado/);assert.deepEqual(s,before);});
test('fechamento semanal e intervalo também bloqueiam confirmação de pedido',()=>{for(const appointment of [slot({date:'2026-10-18'}),slot({time:'12:00'})]){const s=state(),r=request(s),before=structuredClone(s);assert.throws(()=>confirmSiteRequest(s,{requestId:r.id,newPatient:true,appointment,now}));assert.deepEqual(s,before);}});
test('paciente divergente, identificador repetido e duas opções de cadastro são rejeitados',()=>{const s=state(),r=request(s);assert.throws(()=>confirmSiteRequest(s,{requestId:r.id,patientId:'demo-marina',newPatient:true,appointment:slot(),now}),/duas opções/);assert.throws(()=>confirmSiteRequest(s,{requestId:r.id,patientId:'demo-marina',appointment:slot({patientId:'demo-beatriz'}),now}),/não corresponde/);s.appointments.push({...slot(),id:'existing',patientId:'demo-lucia',status:'confirmado'});assert.throws(()=>confirmSiteRequest(s,{requestId:r.id,patientId:'demo-marina',appointment:slot({id:'existing',time:'15:00'}),now}),/identificador/);assert.equal(s.requests[0].status,'pendente');});
test('repetir envio após confirmação retorna pedido agendado sem nova reserva',()=>{const s=state(),r=request(s);confirmSiteRequest(s,{requestId:r.id,newPatient:true,appointment:slot(),now});assert.equal(request(s).status,'agendado');assert.equal(s.requests.length,1);assert.equal(s.appointments.length,1);});
