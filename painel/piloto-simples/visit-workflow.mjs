import {validDate,PROCEDURE_RECORD_MODES} from './operations-domain.mjs';
import {attendingProfessionals,DEFAULT_PROFESSIONAL_ID} from './clinic-domain.mjs';

export const RECORD_MODE_LABELS={injectable:'Com aplicação injetável',non_injectable:'Sem aplicação injetável',simple:'Registro simples'};
export const APPOINTMENT_TYPES=['Avaliação','Primeiro atendimento','Retorno','Sessão','Procedimento','Revisão','Pós-atendimento','Outro'];
export const APPOINTMENT_COLORS=['auto','rose','purple','blue','teal','green','amber','orange','slate'];
const text=(value,max,label)=>{const s=String(value??'').trim();if(s.length>max)throw Error(`${label} excede ${max} caracteres.`);return s;};

/** Preserve the procedure selected at creation, independently from subsequent catalog edits. */
export function createVisit(state,input){
  const id=text(input.id,180,'Identificador');
  if(!id)throw Error('Identificador da consulta ausente.');
  if(!state.patients.some(p=>p.id===input.patientId))throw Error('Paciente não encontrada.');
  const prior=state.visits.find(v=>v.id===id);
  if(prior)throw Error('Identificador de consulta já utilizado.');
  const appointment=input.appointmentId?(state.appointments||[]).find(a=>a.id===input.appointmentId):null;
  if(input.appointmentId&&(!appointment||appointment.patientId!==input.patientId||appointment.status==='cancelado'))throw Error('Agendamento indisponível para esta paciente.');
  if(appointment&&state.visits.some(v=>v.appointmentId===appointment.id))throw Error('Este agendamento já possui uma consulta. Abra o registro existente.');
  const professionalId=input.professionalId||appointment?.professionalId||DEFAULT_PROFESSIONAL_ID;
  if(!attendingProfessionals(state).some(p=>p.id===professionalId))throw Error('Selecione um profissional ativo para atender.');
  const procedureId=input.procedureId||appointment?.procedureId;
  const procedure=procedureId?(state.procedures||[]).find(p=>p.id===procedureId):null;
  if(procedureId&&(!procedure||procedure.active===false))throw Error('O procedimento está indisponível. Selecione um cadastro ativo.');
  if(!procedure&&!appointment)throw Error('Selecione um procedimento do catálogo.');
  const service=text(procedure?.name||input.service||appointment?.service,120,'Atendimento');
  if(!service)throw Error('Informe o atendimento.');
  const recordMode=procedure?.recordMode||'injectable';
  if(!PROCEDURE_RECORD_MODES.includes(recordMode))throw Error('Tipo de registro inválido.');
  const visit={id,patientId:input.patientId,professionalId,date:validDate(input.date||appointment?.date),service,notes:text(input.notes,4000,'Observações'),status:'rascunho',photos:[],maps:{}};
  if(appointment)visit.appointmentId=appointment.id;
  if(procedure)Object.assign(visit,{procedureId:procedure.id,procedureVersion:procedure.version,procedureSnapshot:structuredClone(procedure),recordMode});
  state.visits.push(visit);
  return structuredClone(visit);
}

/** Optional metadata never changes stock, creates a visit or claims an appointment is available. */
export function appointmentMetadata(state,input){
  const appointmentType=input.appointmentType||'Procedimento',color=input.color||'auto',procedureId=input.procedureId||'';
  if(!APPOINTMENT_TYPES.includes(appointmentType)||!APPOINTMENT_COLORS.includes(color))throw Error('Tipo ou cor do agendamento inválidos.');
  const procedure=procedureId?(state.procedures||[]).find(p=>p.id===procedureId):null;
  if(procedureId&&(!procedure||procedure.active===false))throw Error('Selecione um procedimento ativo.');
  return {appointmentType,color,procedureId};
}

export function visitWorkflow(visit){
  const mode=visit.recordMode||visit.procedureSnapshot?.recordMode||'injectable';
  const core=[{tab:'documentos',label:'Documentos'},{tab:'registro',label:'Evolução e revisão'}];
  if(mode==='simple')return {mode,label:RECORD_MODE_LABELS[mode],steps:core,description:'Registre as observações e revise valor, custos e documentos configurados antes de concluir.'};
  return {mode,label:RECORD_MODE_LABELS[mode]||RECORD_MODE_LABELS.injectable,steps:[core[0],{tab:'mapa',label:mode==='injectable'?'Foto e marcações':'Registro fotográfico'},{tab:'fotos',label:'Fotos e comparação'},core[1]],description:mode==='injectable'?'Registre documentos, fotografias e marcações. Produtos, lotes e quantidades são conferidos na revisão antes da baixa do estoque.':'As fotos são opcionais. Registre a evolução e revise os produtos efetivamente utilizados e os documentos configurados.'};
}
