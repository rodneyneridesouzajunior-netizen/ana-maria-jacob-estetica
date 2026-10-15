import {IntegrationError} from './errors.mjs';
const idPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const requireRecord=(row,key)=>{if(!idPattern.test(row?.id??'')||!Number.isInteger(row[key])||row[key]<1)throw new IntegrationError('edit_context_invalid','Reabra o registro para obter o vínculo e a versão atuais.');};
export const APPOINTMENT_TRANSITIONS=Object.freeze({solicitado:['aguardando_confirmacao','confirmado','concluido','nao_compareceu','cancelado'],aguardando_confirmacao:['confirmado','concluido','nao_compareceu','cancelado'],confirmado:['concluido','nao_compareceu','cancelado'],concluido:[],cancelado:[],nao_compareceu:[],reagendado:[]});
export const STATUS_LABELS=Object.freeze({solicitado:'Solicitado',aguardando_confirmacao:'Aguardando confirmação',confirmado:'Confirmado',concluido:'Concluído',nao_compareceu:'Não compareceu',cancelado:'Cancelado',reagendado:'Reagendado'});
const text=(value,max,required=false)=>{if(typeof value!=='string'||value.length>max||(required&&!value.trim()))throw new IntegrationError('invalid_field','Confira os campos obrigatórios e os limites de texto.');return value;};
export function localAppointmentTime(value){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)).map(p=>[p.type,p.value]));
 return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
export function buildPrivateEdit(kind,source,values,operationId){
 const row=structuredClone(source),input=structuredClone(values);
 if(!idPattern.test(operationId))throw new IntegrationError('invalid_operation','Identificador de operação inválido.');
 if(kind==='edit-patient'){
  requireRecord(row,'versao');if(!Object.hasOwn(row,'cpf')||!Object.hasOwn(row,'telefone_emergencia'))throw new IntegrationError('full_patient_required','Abra a ficha completa antes de editar; a lista não contém todos os dados.');
  if(row.arquivado_em)throw new IntegrationError('record_archived','O cadastro está arquivado.');
  const status=input.status??row.status;if(!['active','inactive'].includes(status))throw new IntegrationError('invalid_status','Status de paciente inválido.');
  return {id:row.id,versao:row.versao,operation_id:operationId,nome:text(input.nome,160,true),cpf:input.cpf??row.cpf,telefone:input.telefone??row.telefone,email:input.email??row.email,telefone_emergencia:input.telefone_emergencia??row.telefone_emergencia,data_nascimento:input.data_nascimento??row.data_nascimento,status,motivo:text(input.motivo,500,true)};
 }
 if(kind==='edit-appointment'||kind==='appointment-status'){
  requireRecord(row,'versao');
  if(kind==='appointment-status'){
   if(!(APPOINTMENT_TRANSITIONS[row.status]??[]).includes(input.status))throw new IntegrationError('invalid_status_transition','Esta mudança de status não é permitida para o horário atual.');
   const payload={id:row.id,versao:row.versao,status:input.status};
   if(input.status==='cancelado'){payload.motivo_cancelamento=text(input.motivo_cancelamento,500,true);if(payload.motivo_cancelamento.trim().length<2)throw new IntegrationError('reason_required','Informe o motivo do cancelamento.');}
   return payload;
  }
  const raw=text(input.data_hora,25,true);if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(raw))throw new IntegrationError('invalid_date','Confira a data e hora em Brasília.');
  const data_hora=raw+(raw.length===16?':00':'')+'-03:00';if(!Number.isFinite(Date.parse(data_hora)))throw new IntegrationError('invalid_date','Confira a data e hora.');
  const duration=Number(input.duracao_min);if(!Number.isInteger(duration)||duration<15||duration>720)throw new IntegrationError('invalid_duration','A duração deve ser de 15 a 720 minutos.');
  const changed=Date.parse(data_hora)!==Date.parse(row.data_hora);
  if(changed&&input.reagendar!=='on'&&input.reagendar!==true)throw new IntegrationError('reschedule_confirmation_required','Marque a confirmação de reagendamento para mudar a data ou o horário.');
  if(changed&&!['solicitado','aguardando_confirmacao','confirmado'].includes(row.status))throw new IntegrationError('reschedule_not_allowed','Este horário não permite reagendamento.');
  // Optional fields deliberately omitted: the existing backend preserves
  // reminder authorizations, return binding, origin and other private details.
  return {id:row.id,versao:row.versao,nome:text(input.nome,120,true),telefone:input.telefone??row.telefone,email:input.email??row.email,categoria:input.categoria??row.categoria,procedimento:text(input.procedimento,160,true),data_hora,duracao_min:duration,observacoes:input.observacoes??row.observacoes,...(changed?{reagendar:true}:{})};
 }
 if(kind==='edit-record'||kind==='finalize-record'){
  requireRecord(row,'version');if(row.status!=='draft'||row.archived_at)throw new IntegrationError('record_locked','Somente um rascunho ativo pode ser editado ou finalizado.');
  if(kind==='finalize-record'){
   if(input.confirmar!=='on'&&input.confirmar!==true)throw new IntegrationError('confirmation_required','Revise o prontuário e marque a confirmação antes de finalizar.');
   return {protocolo_id:row.id,versao_esperada:row.version,operation_id:operationId};
  }
  if(!idPattern.test(row.patient_id)||!row.anamnesis||typeof row.anamnesis!=='object'||Array.isArray(row.anamnesis))throw new IntegrationError('full_record_required','Reabra o prontuário completo antes de editar.');
  return {protocolo_id:row.id,paciente_id:row.patient_id,agendamento_id:row.appointment_id??null,versao_esperada:row.version,idempotency_key:operationId,operation_id:operationId,tipo_procedimento:text(input.tipo_procedimento,120),queixa:text(input.queixa,2000),anamnese:structuredClone(row.anamnesis),notas_tecnica:text(input.notas_tecnica,5000),data_procedimento:input.data_procedimento||null,data_retorno:input.data_retorno||null,orientacoes:text(input.orientacoes,5000)};
 }
 throw new IntegrationError('unsupported_edit','Edição não disponível.');
}
export function confirmPrivateEdit(kind,source,result){
 const row=result?.cliente??result?.agendamento;
 let valid;
 if(kind==='edit-patient'||kind==='edit-appointment'||kind==='appointment-status')valid=row?.id===source.id&&Number.isInteger(row?.versao)&&row.versao>source.versao;
 else valid=result?.protocolo_id===source.id&&Number.isInteger(result?.versao)&&result.versao>source.version&&(kind!=='finalize-record'||(result.finalizado===true&&result.status==='signed'));
 if(!valid)throw new IntegrationError('edit_unconfirmed','A resposta não confirmou a identidade e a nova versão do registro. Reabra para conferir antes de repetir.',{uncertain:true});
 return result;
}
