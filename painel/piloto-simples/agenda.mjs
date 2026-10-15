import {dateKey} from './domain.mjs';
import {clinicConfig,effectiveProfessional,validDate} from './clinic-domain.mjs';
import {APPOINTMENT_COLORS} from './visit-workflow.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const normalized=value=>String(value??'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
const STATUS={agendado:'A confirmar',confirmado:'Confirmado',em_atendimento:'Em atendimento',concluido:'Atendido',cancelado:'Cancelado'};
const VIEWS={day:'Dia',week:'Semana',month:'Mês'};
const DAYS=['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'];
const path={prev:'<path d="m12 4-6 6 6 6"/>',next:'<path d="m8 4 6 6-6 6"/>',plus:'<path d="M10 4v12M4 10h12"/>',search:'<circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/>',calendar:'<rect x="3" y="5" width="14" height="12" rx="2"/><path d="M6 3v4m8-4v4M3 10h14"/>',arrow:'<path d="M3 10h13m-5-5 5 5-5 5"/>'};
const icon=name=>`<svg viewBox="0 0 20 20" aria-hidden="true">${path[name]||path.arrow}</svg>`;
const civil=value=>validDate(value)&&Number(value.slice(0,4))>=1&&Number(value.slice(0,4))<=9999;
const dayObject=value=>new Date(value+'T12:00:00');
const pretty=(value,options)=>dayObject(value).toLocaleDateString('pt-BR',options);
const shortDate=value=>pretty(value,{day:'2-digit',month:'2-digit'});
const serviceTone=service=>{const text=normalized(service);return /\bavalia/.test(text)?'avaliacao':/\bretorno\b/.test(text)?'retorno':'procedimento';};

export function normalizeAgendaView(options={},now=new Date()){
  return {date:civil(options.date)?options.date:dateKey(now),view:Object.hasOwn(VIEWS,options.view)?options.view:'day',query:String(options.query??'').slice(0,120),professionalId:String(options.professionalId??''),status:Object.hasOwn(STATUS,options.status)?options.status:''};
}

export function addAgendaDays(date,delta){
  if(!civil(date)||!Number.isInteger(delta))throw Error('Data ou intervalo inválido.');
  const value=dayObject(date);value.setDate(value.getDate()+delta);const result=dateKey(value);
  if(!civil(result))throw Error('A data está fora do intervalo do calendário.');
  return result;
}

/** Month navigation clamps the selected day instead of overflowing into another month. */
export function shiftAgendaDate(date,view,direction){
  if(!civil(date)||![-1,1].includes(direction))throw Error('Data ou direção inválida.');
  if(view!=='month')return addAgendaDays(date,direction*(view==='week'?7:1));
  const value=dayObject(date),day=value.getDate();value.setDate(1);value.setMonth(value.getMonth()+direction);
  const nextMonth=new Date(value);nextMonth.setMonth(nextMonth.getMonth()+1);nextMonth.setDate(0);
  value.setDate(Math.min(day,nextMonth.getDate()));const result=dateKey(value);
  if(!civil(result))throw Error('A data está fora do intervalo do calendário.');
  return result;
}

export function agendaCalendar(date,view='day'){
  if(!civil(date))throw Error('Selecione uma data válida.');
  const selected=dayObject(date),monthStart=date.slice(0,7)+'-01';
  let start=date,length=1,periodStart=date,periodEnd=date;
  if(view==='week'){
    start=addAgendaDays(date,-((selected.getDay()+6)%7));length=7;periodStart=start;periodEnd=addAgendaDays(start,6);
  }else if(view==='month'){
    const first=dayObject(monthStart),last=new Date(first);last.setMonth(last.getMonth()+1);last.setDate(0);
    start=addAgendaDays(monthStart,-((first.getDay()+6)%7));length=42;periodStart=monthStart;periodEnd=dateKey(last);
  }
  return {start,end:addAgendaDays(start,length-1),periodStart,periodEnd,dates:Array.from({length},(_,i)=>addAgendaDays(start,i))};
}

function counts(items){return {total:items.length,active:items.filter(a=>a.status!=='cancelado').length,cancelled:items.filter(a=>a.status==='cancelado').length,completed:items.filter(a=>a.status==='concluido').length,inProgress:items.filter(a=>a.status==='em_atendimento').length};}
const countLabel=(number,singular='registro',plural='registros')=>`${number} ${number===1?singular:plural}`;

/** Read-only view model. Unknown/inactive professionals with history remain filterable. */
export function getAgendaData(state,options={},now=new Date()){
  const selection=normalizeAgendaView(options,now),calendar=agendaCalendar(selection.date,selection.view);
  const people=new Map((state.patients||[]).map(p=>[p.id,p.name]));
  const professionals=new Map(clinicConfig(state).professionals.map(p=>[p.id,{...p}]));
  const appointments=state.appointments||[];
  for(const item of appointments){const id=effectiveProfessional(item);if(!professionals.has(id))professionals.set(id,{id,name:'Profissional indisponível',active:false});}
  const words=normalized(selection.query).trim().split(/\s+/).filter(Boolean);
  const all=appointments.filter(item=>civil(item.date)).map(item=>{const tone=serviceTone(item.appointmentType||item.service);return {...item,patientName:people.get(item.patientId)||'Paciente indisponível',professionalName:professionals.get(effectiveProfessional(item))?.name||'Profissional indisponível',effectiveProfessionalId:effectiveProfessional(item),tone,typeLabel:item.appointmentType||({avaliacao:'Avaliação',retorno:'Retorno',procedimento:'Atendimento'}[tone]),color:APPOINTMENT_COLORS.includes(item.color)?item.color:'auto'};});
  const visible=all.filter(item=>item.date>=calendar.start&&item.date<=calendar.end&&(!selection.professionalId||item.effectiveProfessionalId===selection.professionalId)&&(!selection.status||item.status===selection.status)&&words.every(word=>normalized(item.patientName+' '+(item.service||'')+' '+item.typeLabel).includes(word))).sort((a,b)=>a.date.localeCompare(b.date)||String(a.time).localeCompare(String(b.time))||a.patientName.localeCompare(b.patientName,'pt-BR')||String(a.id).localeCompare(String(b.id)));
  const items=visible.filter(item=>item.date>=calendar.periodStart&&item.date<=calendar.periodEnd),today=dateKey(now);
  const label=selection.view==='month'?pretty(selection.date,{month:'long',year:'numeric'}):selection.view==='week'?`${shortDate(calendar.periodStart)} a ${pretty(calendar.periodEnd,{day:'2-digit',month:'2-digit',year:'numeric'})}`:pretty(selection.date,{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  return {...selection,...calendar,label,today,items,counts:counts(items),visibleItems:visible,periodTotal:all.filter(item=>item.date>=calendar.periodStart&&item.date<=calendar.periodEnd).length,invalidDateCount:appointments.filter(item=>!civil(item.date)).length,professionals:[...professionals.values()].sort((a,b)=>a.name.localeCompare(b.name,'pt-BR')),days:calendar.dates.map(date=>{const entries=visible.filter(item=>item.date===date);return {date,selected:date===selection.date,today:date===today,inMonth:date.slice(0,7)===selection.date.slice(0,7),items:entries,counts:counts(entries)};})};
}

function timeRange(item){
  const start=String(item.time||'');if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(start))return 'Horário não informado';
  const duration=Number(item.duration);if(!Number.isFinite(duration)||duration<=0)return start;
  const total=Number(start.slice(0,2))*60+Number(start.slice(3))+duration;
  return `${start}–${String(Math.floor(total/60)%24).padStart(2,'0')}:${String(total%60).padStart(2,'0')}${total>=1440?' (+1 dia)':''}`;
}
function appointmentCard(item,compact=false){
  const cancelled=item.status==='cancelado',completed=item.status==='concluido',inProgress=item.status==='em_atendimento';
  const openLabel=completed?'Consultar':inProgress?'Continuar':'Abrir';
  return `<article class="ag-appointment ${compact?'ag-appointment-compact':''} ${cancelled?'ag-cancelled':''}" data-service-tone="${item.tone}" data-appointment-color="${item.color}"><div class="ag-time"><strong>${esc(item.time||'Sem horário')}</strong><span>${Number.isFinite(Number(item.duration))?esc(item.duration)+' min':'Duração não informada'}</span></div><div class="ag-person"><h3>${esc(item.patientName)}</h3><span class="ag-type">${esc(item.typeLabel)}</span><p class="ag-service">${esc(item.service||'Atendimento sem nome')}</p><p class="ag-professional">${esc(item.professionalName)}</p>${compact?`<small>${esc(timeRange(item))}</small>`:''}</div><div class="ag-record-actions"><span class="ag-status" data-status="${esc(item.status)}">${esc(STATUS[item.status]||item.status||'Sem situação')}</span><div class="ag-buttons"><button type="button" class="ag-open" data-action="attend" data-id="${esc(item.id)}" ${cancelled?'disabled title="Agendamento cancelado: atendimento indisponível"':''} aria-label="${openLabel} atendimento de ${esc(item.patientName)}">${openLabel} ${icon('arrow')}</button><button type="button" class="ag-edit" data-action="edit-appointment" data-id="${esc(item.id)}" ${completed?'disabled title="Atendimento concluído: edição protegida"':''} aria-label="Editar agendamento de ${esc(item.patientName)}">Editar</button></div></div></article>`;
}
function emptyDay(filtered=false){return `<div class="ag-empty"><span>${icon('calendar')}</span><strong>${filtered?'Nenhum registro para estes filtros.':'Nenhum agendamento neste dia.'}</strong><p>${filtered?'Ajuste a busca ou limpe os filtros para ver os demais registros.':'Confira os horários livres e os bloqueios no painel de disponibilidade abaixo.'}</p>${filtered?'<button type="button" class="ag-button" data-agenda-action="clear">Limpar filtros</button>':''}</div>`;}
function dayView(data){return `<section class="ag-day-list" aria-label="Agendamentos do dia">${data.items.length?data.items.map(item=>appointmentCard(item)).join(''):emptyDay(Boolean(data.query.trim()||data.professionalId||data.status))}</section>`;}
function weekView(data){return `<div class="ag-week" aria-label="Agendamentos da semana">${data.days.map(day=>`<section class="ag-week-day ${day.selected?'is-selected':''} ${day.today?'is-today':''}" aria-label="${pretty(day.date,{weekday:'long',day:'numeric',month:'long'})}"><button class="ag-week-heading" type="button" data-agenda-action="select-day" data-date="${day.date}" aria-label="Abrir ${pretty(day.date,{weekday:'long',day:'numeric',month:'long'})}, ${countLabel(day.counts.total)}"><span>${pretty(day.date,{weekday:'short'}).replace('.','')}</span><strong>${shortDate(day.date)}</strong><small>${countLabel(day.counts.total)}</small>${day.today?'<b>Hoje</b>':''}</button><div class="ag-week-items">${day.items.length?day.items.map(item=>appointmentCard(item,true)).join(''):'<p class="ag-no-records">Sem registros</p>'}</div></section>`).join('')}</div>`;}
function monthView(data){
  const rows=Array.from({length:6},(_,row)=>`<div class="ag-month-row" role="row">${data.days.slice(row*7,row*7+7).map(day=>{const text=`${pretty(day.date,{weekday:'long',day:'numeric',month:'long',year:'numeric'})}; ${countLabel(day.counts.total)}, ${countLabel(day.counts.cancelled,'cancelado','cancelados')}${day.today?'; hoje':''}`;return `<div role="gridcell" aria-selected="${day.selected}" class="ag-month-cell ${day.inMonth?'':'is-other-month'} ${day.selected?'is-selected':''} ${day.today?'is-today':''}"><button type="button" class="ag-month-day" data-agenda-action="select-day" data-date="${day.date}" tabindex="${day.selected?'0':'-1'}" aria-label="${text}"><span class="ag-month-number"><strong>${Number(day.date.slice(8))}</strong>${day.today?'<span class="ag-today-label">Hoje</span>':''}<small class="ag-month-count">${day.counts.total||''}</small></span><span class="ag-month-events">${day.items.slice(0,2).map(item=>`<span class="ag-month-event ${item.status==='cancelado'?'ag-cancelled':''}" data-service-tone="${item.tone}" data-appointment-color="${item.color}" title="${esc(item.typeLabel+' · '+(item.service||''))}"><b>${esc(item.time)}</b><span>${esc(item.patientName)}</span>${item.status==='cancelado'?'<em>Cancelado</em>':item.status==='em_atendimento'?'<em class="ag-month-progress">Em atendimento</em>':''}</span>`).join('')}${day.items.length>2?`<span class="ag-month-more">+ ${day.items.length-2} registro(s)</span>`:''}</span></button></div>`;}).join('')}</div>`).join('');
  return `<div class="ag-month" role="grid" aria-label="Calendário de ${esc(data.label)}"><div class="ag-month-head" role="row">${DAYS.map(day=>`<span role="columnheader">${day}</span>`).join('')}</div>${rows}</div><p class="ag-calendar-help">Selecione um dia para ver ou editar os atendimentos. No teclado, use as setas para percorrer os dias.</p>`;
}

export function renderAgenda(state,options={}){
  const data=getAgendaData(state,options),filtered=Boolean(data.query.trim()||data.professionalId||data.status),periodName=data.view==='day'?'no dia':data.view==='week'?'na semana':'no mês';
  return `<section class="ag-module" data-agenda-module aria-label="Calendário da agenda">
    <div class="ag-topbar"><div class="ag-period"><span class="ag-kicker">Sua agenda</span><h2 id="ag-period-title">${esc(data.label)}</h2><p role="status" aria-live="polite">${countLabel(data.counts.total)} ${periodName}${filtered?' · filtros aplicados':''}${data.counts.cancelled?' · '+countLabel(data.counts.cancelled,'cancelado','cancelados'):''}${data.counts.inProgress?' · '+data.counts.inProgress+' em atendimento':''}</p></div><div class="ag-top-actions"><div class="ag-view-switch" role="group" aria-label="Visualização da agenda">${Object.entries(VIEWS).map(([view,label])=>`<button type="button" data-agenda-action="view" data-view="${view}" aria-pressed="${data.view===view}">${label}</button>`).join('')}</div><button type="button" class="ag-new" data-action="new-appointment">${icon('plus')} Agendar</button></div></div>
    <div class="ag-navigation"><div class="ag-date-actions"><button type="button" class="ag-icon-button" data-agenda-action="previous" aria-label="${data.view==='day'?'Dia anterior':data.view==='week'?'Semana anterior':'Mês anterior'}">${icon('prev')}</button><button type="button" class="ag-button" data-agenda-action="today">Hoje</button><button type="button" class="ag-icon-button" data-agenda-action="next" aria-label="${data.view==='day'?'Próximo dia':data.view==='week'?'Próxima semana':'Próximo mês'}">${icon('next')}</button></div><label class="ag-date-field"><span>Ir para a data</span><input type="date" data-agenda-field="date" value="${data.date}" min="0001-01-01" max="9999-12-31" aria-label="Data selecionada"></label><div class="ag-legend" aria-label="Cores automáticas por tipo de atendimento"><small>Cores automáticas</small><span data-service-tone="avaliacao">Avaliação</span><span data-service-tone="procedimento">Atendimento</span><span data-service-tone="retorno">Retorno</span></div></div>
    <div class="ag-filters" role="search" aria-label="Filtrar agendamentos"><label class="ag-search-field"><span>Paciente ou atendimento</span><span class="ag-search-input">${icon('search')}<input type="search" data-agenda-field="query" maxlength="120" value="${esc(data.query)}" placeholder="Buscar nome ou procedimento" autocomplete="off"></span></label><label><span>Profissional</span><select data-agenda-field="professionalId"><option value="">Todos os profissionais</option>${data.professionals.map(person=>`<option value="${esc(person.id)}" ${person.id===data.professionalId?'selected':''}>${esc(person.name)}${person.active===false?' · inativo':''}</option>`).join('')}</select></label><label><span>Situação</span><select data-agenda-field="status"><option value="">Todas as situações</option>${Object.entries(STATUS).map(([status,label])=>`<option value="${status}" ${data.status===status?'selected':''}>${label}</option>`).join('')}</select></label>${filtered?'<button type="button" class="ag-clear" data-agenda-action="clear">Limpar filtros</button>':''}</div>
    <div class="ag-calendar-body" aria-labelledby="ag-period-title">${data.view==='month'?monthView(data):data.view==='week'?weekView(data):dayView(data)}</div>
    <p class="ag-feedback" data-agenda-feedback role="alert" hidden></p><p class="ag-note">${filtered?`${countLabel(data.counts.total)} de ${data.periodTotal} no período. `:''}Contagens incluem cancelados, exceto quando um filtro os exclui. Dias sem registros não significam horários disponíveis; consulte o painel de disponibilidade.${data.visibleItems.some(item=>item.color!=='auto')?' Cores personalizadas seguem o cadastro; o tipo permanece indicado no texto.':''}</p>${data.invalidDateCount?`<p class="ag-warning">${countLabel(data.invalidDateCount)} com data inválida não apareceu no calendário. Revise os dados de origem.</p>`:''}
  </section>`;
}

/**
 * The owner owns rendering and dirty-state guards. setView receives the complete
 * next selection and {reason,focus}; return false to reject a transition.
 * onViewChange is an optional notification after a successful setView.
 * Clinical data-action buttons are intentionally delegated to the application.
 */
export function mountAgenda(host,{getView,setView,onViewChange}={}){
  if(!host||typeof getView!=='function'||typeof setView!=='function')throw Error('Agenda: informe host, getView e setView.');
  let searchTimer=null,disposed=false;
  const selected=()=>normalizeAgendaView(getView()||{});
  const clearTimer=()=>{if(searchTimer!==null){clearTimeout(searchTimer);searchTimer=null;}};
  const restoreFields=()=>{const current=selected();for(const key of ['date','query','professionalId','status']){const field=host.querySelector(`[data-agenda-field="${key}"]`);if(field)field.value=current[key];}};
  async function commit(patch,reason,focus=null){
    const pendingQuery=host.querySelector('[data-agenda-field="query"]')?.value;
    const next=normalizeAgendaView({...selected(),...(pendingQuery===undefined?{}:{query:pendingQuery}),...patch});
    try{
      const accepted=await setView(next,{reason,focus});
      if(accepted===false){restoreFields();return;}
      if(onViewChange)await onViewChange(next,{reason});
      if(focus){const field=host.querySelector(focus.selector);if(field){field.focus({preventScroll:true});if(focus.start!=null&&typeof field.setSelectionRange==='function')try{field.setSelectionRange(focus.start,focus.end);}catch{ /* Date/select inputs do not expose text selection. */ }}}
    }catch(error){restoreFields();const feedback=host.querySelector('[data-agenda-feedback]');if(feedback){feedback.textContent=error.message||'Não foi possível atualizar a agenda.';feedback.hidden=false;}}
  }
  const click=event=>{
    const button=event.target.closest?.('[data-agenda-action]');if(!button||!host.contains(button)||button.disabled)return;
    clearTimer();const action=button.dataset.agendaAction,current=selected();
    if(action==='view')void commit({view:button.dataset.view},'view',{selector:`[data-agenda-action="view"][data-view="${button.dataset.view}"]`});
    else if(action==='today')void commit({date:dateKey()},'today',{selector:'[data-agenda-action="today"]'});
    else if(action==='previous'||action==='next'){
      try{void commit({date:shiftAgendaDate(current.date,current.view,action==='next'?1:-1)},action,{selector:`[data-agenda-action="${action}"]`});}catch{ /* Boundary dates stay on their current period. */ }
    }else if(action==='select-day')void commit({date:button.dataset.date,view:'day'},'select-day',{selector:'[data-agenda-field="date"]'});
    else if(action==='clear')void commit({query:'',professionalId:'',status:''},'clear',{selector:'[data-agenda-field="query"]'});
  };
  const change=event=>{
    const field=event.target,key=field.dataset?.agendaField;if(!key||!host.contains(field))return;
    // Search uses input/debounce. Re-rendering on blur would consume a click on
    // the next calendar control before its click event can reach the owner.
    if(key==='query')return;
    clearTimer();if(key==='date'&&!civil(field.value)){field.setCustomValidity('Selecione uma data válida.');field.reportValidity();return;}
    field.setCustomValidity?.('');void commit({[key]:field.value},'filter',{selector:`[data-agenda-field="${key}"]`});
  };
  const input=event=>{
    const field=event.target;if(field.dataset?.agendaField!=='query'||!host.contains(field))return;
    clearTimer();const query=field.value,start=field.selectionStart,end=field.selectionEnd;
    searchTimer=setTimeout(()=>{searchTimer=null;if(!disposed)void commit({query},'search',{selector:'[data-agenda-field="query"]',start,end});},180);
  };
  const keydown=event=>{
    const button=event.target.closest?.('.ag-month-day[data-date]');if(!button||!host.contains(button))return;
    const date=button.dataset.date,weekday=(dayObject(date).getDay()+6)%7;
    let target;try{if(event.key==='ArrowLeft')target=addAgendaDays(date,-1);else if(event.key==='ArrowRight')target=addAgendaDays(date,1);else if(event.key==='ArrowUp')target=addAgendaDays(date,-7);else if(event.key==='ArrowDown')target=addAgendaDays(date,7);else if(event.key==='Home')target=addAgendaDays(date,-weekday);else if(event.key==='End')target=addAgendaDays(date,6-weekday);else if(event.key==='PageUp')target=shiftAgendaDate(date,'month',-1);else if(event.key==='PageDown')target=shiftAgendaDate(date,'month',1);else return;}catch{return;}
    event.preventDefault();clearTimer();void commit({date:target},'keyboard',{selector:`.ag-month-day[data-date="${target}"]`});
  };
  host.addEventListener('click',click);host.addEventListener('change',change);host.addEventListener('input',input);host.addEventListener('keydown',keydown);
  return ()=>{disposed=true;clearTimer();host.removeEventListener('click',click);host.removeEventListener('change',change);host.removeEventListener('input',input);host.removeEventListener('keydown',keydown);};
}
