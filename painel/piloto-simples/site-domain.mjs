import {dateKey} from './domain.mjs';
import {validDate,validateClinicAppointment} from './clinic-domain.mjs';
import {savePatient} from './patients-domain.mjs';

export const SITE_DEMO_CONSENT_VERSION='demo-local-v1';
export const SITE_PERIODS=['Manhã','Tarde','A combinar'];
export const SITE_INTERESTS=['Avaliação inicial','Retorno','Informações sobre atendimento'];
const uid=()=>globalThis.crypto.randomUUID();
const fail=(message,field)=>{const error=Error(message);error.field=field;throw error;};
const canonicalName=value=>String(value??'').trim().replace(/\s+/g,' ');
const nameKey=value=>canonicalName(value).normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
export function sitePhoneDigits(value){
  let digits=String(value??'').replace(/\D/g,'');
  if((digits.length===12||digits.length===13)&&digits.startsWith('55'))digits=digits.slice(2);
  return digits;
}
export function ensureSiteState(state){if(!Array.isArray(state.requests))state.requests=[];return state;}
function normalizedInput(input){
  const operationId=String(input.operationId??'');
  if(!/^[a-zA-Z0-9._:-]{8,100}$/.test(operationId))fail('Não foi possível identificar esta tentativa. Reabra o formulário.','operationId');
  const name=canonicalName(input.name);
  if(name.length<2||name.length>120||!/[\p{L}]/u.test(name)||/[<>\u0000-\u001f]/u.test(name))fail('Informe um nome de teste entre 2 e 120 caracteres.','name');
  const phone=String(input.phone??'').trim(),phoneNormalized=sitePhoneDigits(phone);
  if(!/^\+?[\d\s()\-]{8,25}$/.test(phone)||!/^\d{10,11}$/.test(phoneNormalized)||phoneNormalized[0]==='0'||/^(\d)\1+$/.test(phoneNormalized))fail('Informe um telefone de teste com DDD (10 ou 11 dígitos), com +55 opcional.','phone');
  const date=String(input.date??'');if(!validDate(date))fail('Informe uma data de preferência válida.','date');
  if(!SITE_PERIODS.includes(input.period))fail('Selecione um período válido.','period');
  if(!SITE_INTERESTS.includes(input.interest))fail('Selecione o motivo do contato.','interest');
  if(input.demoConsent!==true)fail('Confirme que este é um teste local com dados fictícios.','demoConsent');
  if(input.mode&&input.mode!=='demo')fail('Este formulário recebe somente solicitações locais de demonstração.','demoConsent');
  return{operationId,name,phone,phoneNormalized,date,period:input.period,interest:input.interest,demoConsent:true};
}
const fingerprint=request=>JSON.stringify([canonicalName(request.name),sitePhoneDigits(request.phone),request.date,request.period,request.interest,true]);
/** An idempotent local request never creates a patient, an appointment, or a reservation. */
export function saveSiteRequest(state,input,{now=new Date()}={}){
  const value=normalizedInput(input),existing=(state.requests||[]).find(r=>r.operationId===value.operationId);
  if(existing){if(existing.mode!=='demo'||existing.demoConsent!==true)fail('Esta operação antiga não possui registro do consentimento de teste. Use uma nova solicitação.','operationId');if(fingerprint(existing)!==fingerprint(value))fail('Esta tentativa já foi registrada com outros dados. Use uma nova solicitação.','operationId');return existing;}
  if(!(now instanceof Date)||!Number.isFinite(+now))throw Error('Referência de data inválida.');
  if(value.date<dateKey(now))fail('Escolha hoje ou uma data futura para a preferência.','date');
  const at=now.toISOString();
  const request={id:uid(),...value,origin:'site-demo-local',mode:'demo',status:'pendente',createdAt:at,consent:{demo:true,version:SITE_DEMO_CONSENT_VERSION,acceptedAt:at},history:[{action:'solicitacao_criada',at,actor:'visitante-demo-local'}]};
  ensureSiteState(state);state.requests.push(request);return request;
}
export function findRequestPatientMatches(state,request){
  const phone=sitePhoneDigits(request.phone),name=nameKey(request.name);
  return(state.patients||[]).filter(patient=>(phone&&sitePhoneDigits(patient.phone)===phone)||(name&&nameKey(patient.name)===name));
}
/** Explicit staff decision. Validates a cloned draft before updating the caller's state. */
export function confirmSiteRequest(state,{requestId,patientId,newPatient,appointment,confirmedAmbiguity=false,now=new Date()}={}){
  const request=(state.requests||[]).find(r=>r.id===requestId);
  if(!request)throw Error('Solicitação indisponível. Reabra a agenda.');
  if(request.status!=='pendente'||request.appointmentId)throw Error('Esta solicitação já foi processada; não será criada outra confirmação.');
  if(request.mode!=='demo'||request.demoConsent!==true)throw Error('Pedido antigo sem registro do consentimento de teste. Preserve o histórico e crie uma nova solicitação fictícia.');
  if(!(now instanceof Date)||!Number.isFinite(+now))throw Error('Referência de data inválida.');
  if(patientId&&newPatient)throw Error('Escolha um cadastro existente ou crie um novo, sem usar as duas opções.');
  if(!appointment)throw Error('Informe o horário que será confirmado.');
  const draft=structuredClone(state);draft.patients??=[];draft.appointments??=[];
  let patient;
  if(patientId){patient=draft.patients.find(p=>p.id===patientId);if(!patient)throw Error('Paciente selecionada não encontrada.');}
  else if(newPatient){
    const matches=findRequestPatientMatches(draft,request);
    if(matches.length&&!confirmedAmbiguity)throw Error('Já há cadastro com o mesmo nome ou contato. Selecione explicitamente a paciente; não criaremos um cadastro ambíguo.');
    const supplied=typeof newPatient==='object'?newPatient:{};
    const value={...supplied,id:supplied.id||uid(),name:supplied.name??request.name,phone:supplied.phone??request.phone,notes:supplied.notes||''};
    if(draft.patients.some(p=>p.id===value.id))throw Error('O identificador do novo cadastro já existe. Selecione a paciente existente.');
    patient=savePatient(draft,value);
  }else throw Error('Selecione explicitamente a paciente ou a opção de criar cadastro.');
  if(appointment.patientId&&appointment.patientId!==patient.id)throw Error('A paciente do horário não corresponde ao cadastro escolhido.');
  const id=appointment.id||uid();if(draft.appointments.some(a=>a.id===id))throw Error('Este identificador de agendamento já existe.');
  const scheduled=validateClinicAppointment(draft,{...appointment,id,patientId:patient.id,professionalId:appointment.professionalId,status:'confirmado',siteRequestId:request.id});
  draft.appointments.push(scheduled);
  const stored=draft.requests.find(r=>r.id===request.id),at=now.toISOString();
  Object.assign(stored,{status:'agendado',appointmentId:scheduled.id,patientId:patient.id,confirmedAt:at,confirmedBy:'operador-local-demo'});
  stored.history=[...(stored.history||[]),{action:'horario_confirmado',at,actor:'operador-local-demo',patientId:patient.id,appointmentId:scheduled.id}];
  Object.assign(state,draft);return{request:stored,patient,appointment:scheduled};
}
