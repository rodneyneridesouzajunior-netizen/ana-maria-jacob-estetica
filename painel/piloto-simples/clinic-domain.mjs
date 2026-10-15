import {appointmentCheck,dateKey} from './domain.mjs';
import {financeReport} from './finance-domain.mjs';

export const DEFAULT_PROFESSIONAL_ID='amj-principal';
export const WEEKDAYS=['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
export const CLINIC_ROLES={socio:'Sócio(a)',profissional:'Profissional',secretaria:'Secretaria'};
const CANCELLED=new Set(['cancelado','cancelled','void','estornado']);
const clone=value=>structuredClone(value);
const uid=()=>globalThis.crypto.randomUUID();
const requiredText=(value,label,max=120)=>{const s=String(value??'').trim();if(!s||s.length>max)throw Error(`${label}: informe entre 1 e ${max} caracteres.`);return s;};
export function validDate(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return false;const d=new Date(value+'T12:00:00');return Number.isFinite(+d)&&dateKey(d)===value;}
export function timeMinutes(value){if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(value||''))throw Error('Informe um horário válido.');return Number(value.slice(0,2))*60+Number(value.slice(3));}
const timeText=n=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
const overlaps=(start,end,otherStart,otherEnd)=>start<otherEnd&&end>otherStart;
const weekday=date=>new Date(date+'T12:00:00').getDay();
const dateRequired=(value,label='Data')=>{if(!validDate(value))throw Error(`${label} inválida.`);return value;};

export function defaultClinic(){
  return {version:1,name:'Ana Maria Jacob',timezone:'America/Sao_Paulo',hoursConfirmed:false,
    weekly:WEEKDAYS.map((_,day)=>({day,enabled:day>0&&day<6,start:'08:00',end:'18:00',breaks:[{start:'12:00',end:'13:00'}]})),
    professionals:[{id:DEFAULT_PROFESSIONAL_ID,name:'Ana Maria Jacob',role:'profissional',active:true,canAttend:true}],
    holidays:[],blocks:[],goals:[],preferences:{internalAlerts:true,returnAlerts:true,appointmentAlerts:true,reminderMinutes:30},readAlerts:[]};
}
/** Initializes extension fields in place, preserving unknown fields and historical records. */
export function normalizeClinicState(state){
  const defaults=defaultClinic(),existing=state.clinic||{};
  state.clinic={...defaults,...existing,preferences:{...defaults.preferences,...existing.preferences}};
  for(const key of ['weekly','professionals','holidays','blocks','goals','readAlerts'])if(!Array.isArray(state.clinic[key]))state.clinic[key]=defaults[key];
  if(!Array.isArray(state.expectedReturns))state.expectedReturns=[];
  return state;
}
export const ensureClinic=normalizeClinicState;
/** Read model never changes the supplied application state. */
export function clinicConfig(state){return normalizeClinicState({clinic:clone(state.clinic||{}),expectedReturns:[]}).clinic;}
export function effectiveProfessional(item){return item.professionalId||DEFAULT_PROFESSIONAL_ID;}
export function attendingProfessionals(state){return clinicConfig(state).professionals.filter(p=>p.active&&p.canAttend!==false&&p.role!=='secretaria');}
export function professionalName(state,id){return clinicConfig(state).professionals.find(p=>p.id===(id||DEFAULT_PROFESSIONAL_ID))?.name||'Profissional indisponível';}

export function parseBreaks(text){
  if(!String(text||'').trim())return [];
  return String(text).split(',').map(part=>{const values=part.trim().split(/\s*[-–]\s*/);if(values.length!==2)throw Error('Use intervalos como 12:00-13:00, separados por vírgula.');return{start:values[0],end:values[1]};});
}
export function validateWeekly(weekly){
  if(!Array.isArray(weekly)||weekly.length!==7||new Set(weekly.map(d=>d.day)).size!==7)throw Error('Configure os sete dias da semana.');
  return weekly.map(day=>{
    if(!Number.isInteger(day.day)||day.day<0||day.day>6)throw Error('Dia da semana inválido.');
    if(typeof day.enabled!=='boolean')throw Error('Informe se o dia está aberto.');
    if(!day.enabled)return{...day,breaks:clone(day.breaks||[])};
    const start=timeMinutes(day.start),end=timeMinutes(day.end);
    if(end<=start)throw Error(`${WEEKDAYS[day.day]}: o fim deve ser depois do início.`);
    if(!Array.isArray(day.breaks)||day.breaks.length>6)throw Error('Use até seis intervalos por dia.');
    const breaks=day.breaks.map(b=>({start:b.start,end:b.end})).sort((a,b)=>a.start.localeCompare(b.start));
    for(let i=0;i<breaks.length;i++){
      const from=timeMinutes(breaks[i].start),to=timeMinutes(breaks[i].end);
      if(from<start||to>end||from>=to)throw Error(`${WEEKDAYS[day.day]}: intervalo fora do expediente.`);
      if(i&&from<timeMinutes(breaks[i-1].end))throw Error(`${WEEKDAYS[day.day]}: intervalos sobrepostos.`);
    }
    return{day:day.day,enabled:true,start:day.start,end:day.end,breaks};
  }).sort((a,b)=>a.day-b.day);
}
export function saveClinicSettings(state,{name,weekly}){
  const checked={name:requiredText(name,'Nome da clínica'),weekly:validateWeekly(weekly)};
  ensureClinic(state);Object.assign(state.clinic,checked,{hoursConfirmed:true});return state.clinic;
}
export function saveProfessional(state,input){
  const name=requiredText(input.name,'Nome'),role=input.role;
  if(!Object.hasOwn(CLINIC_ROLES,role))throw Error('Papel da equipe inválido.');
  ensureClinic(state);const old=input.id?state.clinic.professionals.find(p=>p.id===input.id):null;
  if(input.id&&!old)throw Error('Integrante indisponível. Reabra a página.');
  const person={...old,id:old?.id||uid(),name,role,active:input.active===true,canAttend:role!=='secretaria'};
  if(old)state.clinic.professionals=state.clinic.professionals.map(p=>p.id===old.id?person:p);else state.clinic.professionals.push(person);
  return person;
}
export function saveHoliday(state,input){
  dateRequired(input.date);const reason=requiredText(input.reason,'Motivo',160);ensureClinic(state);
  if(state.clinic.holidays.some(h=>h.date===input.date&&h.id!==input.id))throw Error('Já existe fechamento nesta data.');
  const old=input.id?state.clinic.holidays.find(h=>h.id===input.id):null;
  if(input.id&&!old)throw Error('Fechamento indisponível.');
  const item={id:old?.id||uid(),date:input.date,reason};
  if(old)state.clinic.holidays=state.clinic.holidays.map(h=>h.id===old.id?item:h);else state.clinic.holidays.push(item);
  return item;
}
export function blockApplies(block,date,professionalId){
  if(block.active===false||date<block.date||(block.endDate&&date>block.endDate))return false;
  if(block.professionalId&&block.professionalId!==professionalId)return false;
  return block.repeat==='weekly'?weekday(date)===weekday(block.date):date<=(block.endDate||block.date);
}
export function saveBlock(state,input){
  dateRequired(input.date);const repeat=input.repeat||'none';
  if(!['none','weekly'].includes(repeat))throw Error('Repetição inválida.');
  const endDate=input.endDate||(repeat==='none'?input.date:'');
  if(endDate){dateRequired(endDate,'Data final');if(endDate<input.date)throw Error('A data final não pode vir antes da inicial.');}
  if(timeMinutes(input.end)<=timeMinutes(input.start))throw Error('O fim do bloqueio deve ser depois do início.');
  const reason=requiredText(input.reason,'Motivo',160);ensureClinic(state);
  const professionalId=input.professionalId||null;
  if(professionalId&&!state.clinic.professionals.some(p=>p.id===professionalId))throw Error('Profissional inválido.');
  const old=input.id?state.clinic.blocks.find(b=>b.id===input.id):null;
  if(input.id&&!old)throw Error('Bloqueio indisponível.');
  const item={...old,id:old?.id||uid(),date:input.date,endDate,start:input.start,end:input.end,professionalId,reason,repeat,active:true};
  if(old)state.clinic.blocks=state.clinic.blocks.map(b=>b.id===old.id?item:b);else state.clinic.blocks.push(item);
  return item;
}
function availabilityError(state,item,excludeId){
  const c=clinicConfig(state),professionalId=effectiveProfessional(item),start=timeMinutes(item.time),end=start+item.duration;
  const person=c.professionals.find(p=>p.id===professionalId);
  if(!person||!person.active||person.canAttend===false||person.role==='secretaria')return 'Selecione um profissional ativo que realiza atendimentos.';
  const holiday=c.holidays.find(h=>h.date===item.date);if(holiday)return `Clínica fechada nesta data: ${holiday.reason}.`;
  const day=c.weekly.find(d=>d.day===weekday(item.date));
  if(!day?.enabled)return 'A clínica está fechada neste dia da semana.';
  if(start<timeMinutes(day.start)||end>timeMinutes(day.end))return `Atendimento fora do expediente (${day.start}–${day.end}).`;
  if(day.breaks.some(b=>overlaps(start,end,timeMinutes(b.start),timeMinutes(b.end))))return 'O atendimento coincide com um intervalo da clínica.';
  const block=c.blocks.find(b=>blockApplies(b,item.date,professionalId)&&overlaps(start,end,timeMinutes(b.start),timeMinutes(b.end)));
  if(block)return `Horário bloqueado: ${block.reason}.`;
  const conflict=(state.appointments||[]).find(a=>a.id!==excludeId&&a.id!==item.id&&a.date===item.date&&!CANCELLED.has(a.status)&&(effectiveProfessional(a)===professionalId||(item.patientId&&a.patientId===item.patientId))&&overlaps(start,end,timeMinutes(a.time),timeMinutes(a.time)+a.duration));
  if(conflict)return effectiveProfessional(conflict)!==professionalId?'A paciente já tem atendimento com outro profissional neste intervalo.':'Já existe um atendimento deste profissional nesse intervalo.';
  return null;
}
/** Full replacement for appointmentCheck; do not call the old global conflict check afterward. */
export function validateClinicAppointment(state,item,excludeId=item.id){
  const value={...item,professionalId:effectiveProfessional(item)};
  appointmentCheck(value,[],state.patients||[]);
  if(!['agendado','confirmado','concluido','cancelado','em_atendimento'].includes(value.status))throw Error('Situação do agendamento inválida.');
  if(value.status==='cancelado')return value;
  const error=availabilityError(state,value,excludeId);if(error)throw Error(error);
  return value;
}
export function getAvailableSlots(state,{date,professionalId=DEFAULT_PROFESSIONAL_ID,duration=60,step=15,patientId,excludeId,fromTime}={}){
  dateRequired(date);if(!Number.isInteger(duration)||duration<5||duration>480)throw Error('A duração deve ficar entre 5 e 480 minutos.');
  if(!Number.isInteger(step)||step<5||step>120)throw Error('Passo de horários inválido.');
  const c=clinicConfig(state),day=c.weekly.find(d=>d.day===weekday(date));
  if(!day?.enabled)return [];
  const slots=[],first=Math.max(timeMinutes(day.start),fromTime?timeMinutes(fromTime):0),last=timeMinutes(day.end);
  for(let start=timeMinutes(day.start);start+duration<=last;start+=step){
    if(start<first)continue;
    const item={date,time:timeText(start),duration,professionalId,patientId};
    if(!availabilityError(state,item,excludeId))slots.push(item.time);
  }
  return slots;
}
export function scheduleClinicAppointment(state,input){
  const old=input.id?(state.appointments||[]).find(a=>a.id===input.id):null;
  if(old&&old.patientId!==input.patientId&&(state.visits||[]).some(v=>v.appointmentId===old.id))throw Error('Este horário já possui consulta. Crie outro agendamento para trocar a paciente.');
  if(old&&(old.status==='concluido'||(state.visits||[]).some(v=>v.appointmentId===old.id&&(v.status==='concluido'||v.lockedAt)))){
    const candidate={...old,...input},changed=['patientId','date','time','duration','service','status'].some(key=>candidate[key]!==old[key])||effectiveProfessional(candidate)!==effectiveProfessional(old);
    if(changed)throw Error('Atendimento concluído: preserve o horário e o profissional do histórico. Para novo atendimento, crie outro agendamento.');
    return old;
  }
  const value=validateClinicAppointment(state,{...old,...input,id:input.id||uid(),status:input.status||'agendado'},input.id);
  ensureClinic(state);state.appointments??=[];
  const returnId=value.expectedReturnId;
  if(returnId){
    const expected=state.expectedReturns.find(r=>r.id===returnId);
    if(!expected||expected.patientId!==value.patientId)throw Error('O retorno não pertence a esta paciente.');
    if(expected.status!=='previsto'&&!(expected.status==='agendado'&&expected.appointmentId===value.id))throw Error('Este retorno já foi agendado ou cancelado.');
    expected.status=value.status==='cancelado'?'previsto':'agendado';
    if(value.status==='cancelado')delete expected.appointmentId;else expected.appointmentId=value.id;
  }
  if(old)state.appointments=state.appointments.map(a=>a.id===old.id?value:a);else state.appointments.push(value);
  syncExpectedReturnAppointment(state,value);return value;
}
export function syncExpectedReturnAppointment(state,item){
  for(const expected of state.expectedReturns||[]){
    if(expected.appointmentId!==item.id)continue;
    if(item.status==='cancelado'){expected.status='previsto';delete expected.appointmentId;}
    else if(item.status==='concluido')expected.status='concluido';
  }
}
export function pendingReturns(state,today=dateKey()){
  return(state.expectedReturns||[]).filter(r=>r.status==='previsto').map(r=>({...r,overdue:r.date<today,dueToday:r.date===today})).sort((a,b)=>a.date.localeCompare(b.date));
}
export function cancelExpectedReturn(state,id){ensureClinic(state);const item=state.expectedReturns.find(r=>r.id===id);if(!item||item.status!=='previsto')throw Error('Somente retornos previstos podem ser cancelados aqui.');item.status='cancelado';return item;}
export function saveMonthlyGoal(state,{month,basis,target}){
  if(!/^\d{4}-\d{2}$/.test(month)||!validDate(month+'-01'))throw Error('Selecione um mês válido.');
  if(!['billed','received'].includes(basis))throw Error('Escolha cobrado ou recebido.');
  if(!Number.isSafeInteger(target)||target<=0||target>100000000)throw Error('Informe uma meta positiva em centavos, dentro do limite local.');
  ensureClinic(state);const goal={month,basis,target};state.clinic.goals=state.clinic.goals.filter(g=>g.month!==month);state.clinic.goals.push(goal);return goal;
}
export function getMonthlyGoal(state,month=dateKey().slice(0,7),{today}={}){
  if(today!==undefined&&!validDate(today))throw Error('Data de referência da meta inválida.');
  const goal=clinicConfig(state).goals.find(g=>g.month===month);
  if(!goal)return{month,configured:false,basis:'received',target:0,actual:0,remaining:0,percent:0};
  // Use the same financial contract as the Finance page, without normalizing the caller in a read.
  // Explicit Home cutoff; historical months and the existing two-argument API remain complete.
  const period=today&&month===today.slice(0,7)?{period:'month',today}:month;
  const report=financeReport({...state,bills:state.bills||[],payments:state.payments||[]},period);
  const gross=goal.basis==='billed'?report.billed:report.grossReceived;
  const reversals=goal.basis==='received'?report.reversed:0;
  const actual=goal.basis==='billed'?report.billed:report.received;
  return{...goal,configured:true,actual,gross,reversals,remaining:Math.max(0,goal.target-actual),percent:goal.target>0?Math.round(actual/goal.target*1000)/10:0};
}
export function saveClinicPreferences(state,input){
  const minutes=Number(input.reminderMinutes);if(![15,30,60,1440].includes(minutes))throw Error('Antecedência inválida.');
  ensureClinic(state);state.clinic.preferences={internalAlerts:!!input.internalAlerts,returnAlerts:!!input.returnAlerts,appointmentAlerts:!!input.appointmentAlerts,reminderMinutes:minutes};return state.clinic.preferences;
}
export function getClinicAlerts(state,now=new Date()){
  const c=clinicConfig(state);if(!c.preferences.internalAlerts)return [];
  const today=dateKey(now),alerts=[];
  if(c.preferences.returnAlerts)for(const r of pendingReturns(state,today).filter(r=>r.date<=today))alerts.push({id:'return:'+r.id+':'+r.date,kind:'return',title:r.overdue?'Retorno previsto em atraso':'Retorno previsto para hoje',detail:(state.patients||[]).find(p=>p.id===r.patientId)?.name||'Paciente indisponível',date:r.date});
  if(c.preferences.appointmentAlerts)for(const a of state.appointments||[]){
    if(!['agendado','confirmado'].includes(a.status)||!validDate(a.date))continue;
    const delta=(new Date(a.date+'T'+a.time+':00')-now)/60000;
    if(delta<0||delta>c.preferences.reminderMinutes)continue;
    alerts.push({id:'appointment:'+a.id+':'+a.date+':'+a.time,kind:'appointment',title:`Atendimento às ${a.time}`,detail:(state.patients||[]).find(p=>p.id===a.patientId)?.name||'Paciente indisponível',date:a.date});
  }
  return alerts.filter(a=>!c.readAlerts.includes(a.id));
}
export function dismissClinicAlert(state,id){ensureClinic(state);state.clinic.readAlerts=[...new Set([...state.clinic.readAlerts,id])].slice(-500);}

/** Existing commitments are never silently moved when settings change. */
export function clinicScheduleWarnings(state,fromDate=dateKey()){
  return(state.appointments||[]).filter(a=>a.date>=fromDate&&['agendado','confirmado'].includes(a.status)).flatMap(a=>{try{validateClinicAppointment(state,a,a.id);return [];}catch(error){return[{appointmentId:a.id,date:a.date,time:a.time,patientId:a.patientId,reason:error.message}];}});
}
