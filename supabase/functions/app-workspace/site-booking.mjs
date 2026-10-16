import {emptyState,validateTransition,fail,hash,stable,uuid,validId} from './rules.mjs';
import {savePatient} from '../_shared/app-workspace-domain/patients-domain.mjs';
import {validateClinicAppointment} from '../_shared/app-workspace-domain/clinic-domain.mjs';

export const SITE_BOOKING_ACTIONS=Object.freeze(['listar_pedidos_agenda','agendar_pedido_site','status_agendamento_site']);
const name=value=>String(value??'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().trim().replace(/\s+/g,' ');
const phone=value=>{const n=String(value??'').replace(/\D/g,'');return n.length>11&&n.startsWith('55')?n.slice(2):n;};
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const keys=(value,allowed)=>plain(value)&&Object.keys(value).every(k=>allowed.includes(k));
const safeBooking=b=>b?{request_id:b.request_id,appointment_id:b.appointment_id,patient_id:b.patient_id,operation_id:b.operation_id,workspace_revision:b.workspace_revision,scheduled_at:b.scheduled_at,appointment:b.appointment??null}:null;
const actor=ctx=>({p_clinic:ctx.clinicId,p_actor:ctx.userId,p_session:ctx.sessionId});

/** All writes are built from the source request and the current server snapshot. */
export function buildSiteBooking(state,source,input,{now=new Date().toISOString()}={}){
 if(!source||source.id!==input.request_id||!['pending','accepted'].includes(source.status)||source.contact_consent!==true)fail('site_request_unavailable','Pedido indisponível para agendamento.',409);
 if(source.version!==input.expected_request_version)fail('site_request_changed','O pedido mudou. Atualize a lista e confira novamente.',409);
 if(source.booking)fail('site_request_already_booked','Este pedido já possui um horário. Use o agendamento existente para reagendar.',409);
 if(input.confirmed_identity!==true||input.confirmed_schedule!==true)fail('site_booking_confirmation_required','Confira a identidade e confirme o horário combinado.');
 if(!keys(input.appointment,['id','professionalId','date','time','duration','service'])||!uuid(input.appointment.id))fail('site_booking_invalid','Confira os dados do horário.');
 const slotDate=new Date(`${input.appointment.date}T${input.appointment.time}:00-03:00`),reference=new Date(now);
 if(!Number.isFinite(+slotDate)||slotDate<reference||slotDate>+reference+180*86400000)fail('site_booking_date_invalid','Escolha um horário futuro, dentro dos próximos 180 dias.');
 if(state.appointments.some(a=>a.id===input.appointment.id))fail('site_booking_id_conflict','O identificador deste horário já está em uso.',409);
 if(!!input.patient_id===!!input.new_patient)fail('site_booking_patient_required','Escolha uma paciente existente ou um novo cadastro.');
 const draft=structuredClone(state);let patient;
 if(input.patient_id){
  if(!validId(input.patient_id)||(patient=draft.patients.find(p=>p.id===input.patient_id))===undefined)fail('site_booking_patient_required','Paciente não encontrada.');
  if(name(patient.name)!==name(source.full_name)||phone(patient.phone)!==phone(source.phone))fail('site_booking_identity_mismatch','Nome e telefone do cadastro precisam corresponder ao pedido. Confira ou corrija o cadastro antes de vincular.');
 }else{
  const p=input.new_patient;
  if(!keys(p,['id','name','phone'])||!uuid(p.id)||name(p.name)!==name(source.full_name)||phone(p.phone)!==phone(source.phone))fail('site_booking_identity_mismatch','O novo cadastro precisa preservar nome e telefone do pedido.');
  if(draft.patients.some(existing=>existing.id===p.id))fail('site_booking_id_conflict','Identificador de paciente já utilizado.',409);
  if(draft.patients.some(existing=>name(existing.name)===name(p.name)||phone(existing.phone)===phone(p.phone)))fail('site_booking_patient_ambiguous','Há cadastro com o mesmo nome ou telefone. Confira a identidade e selecione a paciente existente.');
  try{patient=savePatient(draft,{...p,phone:phone(p.phone)},{now,today:now.slice(0,10)});}catch(error){fail('site_booking_invalid',error.message);}
 }
 let appointment;try{appointment=validateClinicAppointment(draft,{...input.appointment,patientId:patient.id,status:'confirmado',appointmentType:source.interest==='retorno_acompanhamento'?'Retorno':'Avaliação'});}catch(error){fail('site_booking_slot_invalid',error.message);}
 draft.appointments.push(appointment);
 return {state:draft,patient,appointment};
}

export function createSiteBooking({repository,authorize,now=()=>new Date().toISOString()}){
 return async function booking(p,ctx,req){const a=actor(ctx);
  if(p.acao==='listar_pedidos_agenda'){
   const status=p.status??'available',limit=p.limit??25,offset=p.offset??0;
   if(!['available','scheduled','archived','all'].includes(status)||!Number.isInteger(limit)||limit<1||limit>50||!Number.isInteger(offset)||offset<0||offset>10000)fail('site_booking_filters_invalid','Confira o filtro e a página.');
   const rows=await repository.bookingList({...a,p_status:status,p_limit:limit+1,p_offset:offset});
   return {requests:rows.slice(0,limit),pagination:{limit,offset,has_more:rows.length>limit},capabilities:{schedule_site_request:true}};
  }
  if(!uuid(p.operation_id))fail('invalid_operation','Identificador de operação inválido.');
  if(p.acao==='status_agendamento_site'){
   const previous=await repository.bookingOperation({...a,p_operation:p.operation_id});
   return {operation:previous?{id:p.operation_id,kind:'site_booking',status:'committed',result:{booking:safeBooking(previous.booking),workspace_revision:previous.workspace_revision}}:null};
  }
  if(p.acao!=='agendar_pedido_site')fail('unsupported_action','Operação não reconhecida.');
  if(!keys(p,['acao','operation_id','expected_revision','request_id','expected_request_version','patient_id','new_patient','appointment','confirmed_identity','confirmed_schedule'])||!uuid(p.request_id)||!Number.isSafeInteger(p.expected_revision)||p.expected_revision<0||!Number.isSafeInteger(p.expected_request_version)||p.expected_request_version<1)fail('site_booking_invalid','Confira pedido, revisão e dados do agendamento.');
  await authorize(req,ctx,{operationId:p.operation_id,targetId:ctx.clinicId,action:'app_workspace_site_booking'});
  const fingerprint=await hash(stable(Object.fromEntries(Object.entries(p).filter(([k])=>!['acao','operation_id'].includes(k)))));
  const prior=await repository.bookingOperation({...a,p_operation:p.operation_id});
  if(prior){if(prior.fingerprint!==fingerprint)fail('operation_reused','Esta operação já foi utilizada com outros dados.',409);return {booking:safeBooking(prior.booking),workspace_revision:prior.workspace_revision,operation:{id:p.operation_id,kind:'site_booking',status:'committed',replayed:true}};}
  const row=await repository.load(ctx.clinicId),old=row?.state||emptyState();
  if((row?.revision||0)!==p.expected_revision)fail('revision_conflict','Outra alteração foi salva. Atualize a agenda mantendo os dados do pedido.',409);
  const source=await repository.bookingSource({...a,p_request:p.request_id}),at=now();
  const built=buildSiteBooking(old,source,p,{now:at}),photos=await repository.photos(ctx.clinicId);
  validateTransition(old,built.state,{photos,now:at});
  built.state.revision=p.expected_revision+1;
  built.state.auditLog.push({id:p.operation_id,at,action:'Solicitação do site agendada',revision:built.state.revision,actorId:ctx.userId});
  const saved=await repository.bookSiteRequest({...a,p_operation:p.operation_id,p_fingerprint:fingerprint,p_expected:p.expected_revision,p_request:p.request_id,p_request_version:p.expected_request_version,p_patient:built.patient.id,p_appointment:built.appointment.id,p_state:built.state,p_state_hash:await hash(stable(built.state))});
  return {booking:safeBooking(saved.booking),workspace_revision:saved.workspace_revision,operation:{id:p.operation_id,kind:'site_booking',status:'committed',replayed:saved.replayed===true}};
 };
}
