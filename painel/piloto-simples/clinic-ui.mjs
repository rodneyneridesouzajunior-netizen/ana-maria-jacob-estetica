import {cents,dateKey} from './domain.mjs';
import {isConnected} from './runtime-store.mjs';
const modeText=(local,connected)=>isConnected()?connected:local;
import {WEEKDAYS,CLINIC_ROLES,DEFAULT_PROFESSIONAL_ID,clinicConfig,attendingProfessionals,professionalName,effectiveProfessional,parseBreaks,saveClinicSettings,saveProfessional,saveHoliday,saveBlock,getAvailableSlots,scheduleClinicAppointment,pendingReturns,cancelExpectedReturn,saveMonthlyGoal,getMonthlyGoal,saveClinicPreferences,getClinicAlerts,dismissClinicAlert,ensureClinic,clinicScheduleWarnings} from './clinic-domain.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(value/100);
const prettyDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')?value.split('-').reverse().join('/'):'Data indisponível';
const option=(value,label,selected)=>`<option value="${esc(value)}" ${value===selected?'selected':''}>${esc(label)}</option>`;
const input=(label,name,value='',type='text',attrs='')=>`<label class="clinic-field"><span>${esc(label)}</span><input type="${type}" name="${name}" value="${esc(value)}" ${attrs}></label>`;
const check=(label,name,checked)=>`<label class="clinic-check"><input type="checkbox" name="${name}" ${checked?'checked':''}><span>${esc(label)}</span></label>`;
const feedback=()=>'<p class="clinic-feedback" data-clinic-feedback role="alert" hidden></p>';
const submit=label=>`<div class="clinic-form-actions"><button class="primary" type="submit">${label}</button></div>`;
const form=(name,content)=>`<form data-clinic-form="${name}">${content}${feedback()}</form>`;
const section=(title,description,content,open=false)=>`<details class="card clinic-section" data-clinic-section="${esc(title)}" ${open?'open':''}><summary><span><strong>${title}</strong><small>${description}</small></span><span aria-hidden="true" class="clinic-disclosure">＋</span></summary><div class="clinic-section-body">${content}</div></details>`;
const personOptions=(state,selected)=>`<option value="">Selecione a paciente</option>${(state.patients||[]).map(p=>option(p.id,p.name,selected)).join('')}`;
export function professionalOptions(state,selected=DEFAULT_PROFESSIONAL_ID,{includeAll=false,includeInactive=false}={}){
  const people=includeInactive?clinicConfig(state).professionals:attendingProfessionals(state);
  return(includeAll?option('','Toda a clínica',selected):'')+people.map(p=>option(p.id,p.name+(!p.active?' · inativo':''),selected)).join('');
}
function professionalSelect(state,selected,all=false,name='professionalId'){
  const options=professionalOptions(state,selected,{includeAll:all});
  return `<label class="clinic-field"><span>${all?'Abrangência':'Profissional'}</span><select name="${name}" ${all?'':'required'}>${options||'<option value="">Nenhum profissional ativo</option>'}</select></label>`;
}
function weeklyForm(state){
  const c=clinicConfig(state);
  const days=[1,2,3,4,5,6,0].map(index=>{const d=c.weekly.find(day=>day.day===index)||{day:index,enabled:false,start:'08:00',end:'18:00',breaks:[]};return`<fieldset class="clinic-day"><legend>${WEEKDAYS[index]}</legend>${check('Aberto','enabled-'+index,d.enabled)}${input('Abre','start-'+index,d.start,'time')}${input('Fecha','end-'+index,d.end,'time')}${input('Intervalos','breaks-'+index,d.breaks.map(b=>b.start+'-'+b.end).join(', '),'text','placeholder="12:00-13:00" maxlength="100"')}</fieldset>`;}).join('');
  return form('settings',input('Nome da clínica','name',c.name,'text','required maxlength="120"')+`<p class="clinic-note">${c.hoursConfirmed?modeText('Horários salvos neste navegador.','Horários confirmados no servidor da clínica.'):modeText('Os horários abaixo são exemplos locais. Ajuste e salve antes de usá-los como referência.','Os horários iniciais são exemplos. Ajuste e confirme a gravação antes de usá-los como referência.')} Um dia fechado não aceita novos agendamentos.</p><div class="clinic-week">${days}</div><p class="clinic-help">Mais de um intervalo: 12:00-13:00, 15:00-15:15. A configuração não cancela compromissos já cadastrados. Horários são os informados pela clínica; este aplicativo não converte fusos entre aparelhos.</p>`+submit('Salvar clínica e horários'));
}
function teamPanel(state){
  const c=clinicConfig(state),rows=c.professionals.map(p=>`<li class="clinic-list-row"><div><strong>${esc(p.name)}</strong><span>${esc(CLINIC_ROLES[p.role]||p.role)} · ${p.active?'Ativo':'Inativo'} · ${p.role==='secretaria'?'Não recebe agendamentos':'Realiza atendimentos'}</span></div><button type="button" class="secondary" data-clinic-action="edit-professional" data-id="${esc(p.id)}">Editar</button></li>`).join('');
  return `<p class="clinic-note">${modeText('Equipe de demonstração local. Estes papéis organizam os registros; não criam usuários, senhas ou permissões de acesso reais.','Equipe cadastrada no servidor em homologação. Estes papéis organizam os registros; não criam contas, senhas ou permissões de acesso. O acesso privado continua restrito às contas autorizadas.')}</p><ul class="clinic-list">${rows}</ul>`+form('professional',`<input type="hidden" name="id" value=""><h3>Adicionar ou editar integrante</h3><div class="clinic-fields">${input('Nome','name','','text','required maxlength="120"')}<label class="clinic-field"><span>${modeText('Papel de demonstração','Papel no cadastro da equipe')}</span><select name="role">${Object.entries(CLINIC_ROLES).map(([value,label])=>option(value,label,'profissional')).join('')}</select></label></div>${check('Ativo','active',true)}<div class="clinic-form-actions"><button class="primary" type="submit">Salvar integrante</button><button class="secondary" type="button" data-clinic-action="clear-professional">Novo integrante</button></div>`);
}
function blocksPanel(state){
  const c=clinicConfig(state),today=dateKey(),rows=c.blocks.filter(b=>b.active!==false).map(b=>`<li class="clinic-list-row"><div><strong>${esc(b.reason)}</strong><span>${b.professionalId?esc(professionalName(state,b.professionalId)):'Toda a clínica'} · ${prettyDate(b.date)}${b.endDate&&b.endDate!==b.date?' a '+prettyDate(b.endDate):''} · ${esc(b.start)}–${esc(b.end)}</span><small>${b.repeat==='weekly'?'Toda semana no mesmo dia'+(!b.endDate?' · sem data final':''):'Sem repetição semanal'}</small></div><button class="secondary" type="button" data-clinic-action="remove-block" data-id="${esc(b.id)}">Desativar</button></li>`).join('');
  const holidays=c.holidays.slice().sort((a,b)=>a.date.localeCompare(b.date)).map(h=>`<li class="clinic-list-row"><div><strong>${prettyDate(h.date)}</strong><span>${esc(h.reason)}</span></div><button class="secondary" type="button" data-clinic-action="remove-holiday" data-id="${esc(h.id)}">Remover fechamento</button></li>`).join('');
  return `<h3>Bloqueios de horário</h3><p class="clinic-help">A agenda respeita bloqueios gerais e do profissional. Compromissos existentes são preservados; revise-os se houver mudança de disponibilidade.</p><ul class="clinic-list">${rows||'<li class="clinic-empty">Nenhum bloqueio ativo.</li>'}</ul>`+form('block',`<div class="clinic-fields">${professionalSelect(state,'',true)}${input('Motivo','reason','','text','required maxlength="160"')}${input('Data inicial','date',today,'date','required')}${input('Data final (opcional)','endDate','','date')}${input('Início','start','12:00','time','required')}${input('Fim','end','13:00','time','required')}<label class="clinic-field"><span>Repetição</span><select name="repeat"><option value="none">Sem repetição semanal</option><option value="weekly">Semanal, no mesmo dia</option></select></label></div><p class="clinic-help">Sem repetição: aplica o período horário em cada dia entre as datas. Sem data final, bloqueia apenas a data inicial. Semanal: final vazio repete sem término definido.</p>`+submit('Adicionar bloqueio'))+`<hr><h3>Fechamentos e feriados</h3><p class="clinic-help">Cadastre apenas as datas em que a clínica ficará fechada. Nenhum calendário nacional foi aplicado automaticamente.</p><ul class="clinic-list">${holidays||'<li class="clinic-empty">Nenhum fechamento cadastrado.</li>'}</ul>`+form('holiday',`<div class="clinic-fields">${input('Data fechada','date',today,'date','required')}${input('Motivo','reason','','text','required maxlength="160"')}</div>`+submit('Adicionar fechamento'));
}
function goalPanel(state){
  const c=clinicConfig(state),month=dateKey().slice(0,7),goal=getMonthlyGoal(state,month);
  const saved=c.goals.slice().sort((a,b)=>b.month.localeCompare(a.month)).map(g=>{const status=getMonthlyGoal(state,g.month);return`<li class="clinic-list-row"><div><strong>${g.month.split('-').reverse().join('/')} · ${g.basis==='billed'?'Cobrado':'Recebido'}</strong><span>${money(status.actual)} de ${money(g.target)} · ${status.percent.toLocaleString('pt-BR')}%</span></div><button class="secondary" type="button" data-clinic-action="edit-goal" data-month="${esc(g.month)}">Editar meta</button></li>`;}).join('');
  return `<p class="clinic-note">Cobrado considera cobranças ativas; recebido considera entradas menos estornos registrados no mês. Nenhuma dessas metas representa lucro.</p><ul class="clinic-list">${saved||'<li class="clinic-empty">Nenhuma meta cadastrada.</li>'}</ul>`+form('goal',`<div class="clinic-fields">${input('Mês','month',month,'month','required')}<label class="clinic-field"><span>Medir por</span><select name="basis">${option('received','Valor recebido',goal.basis)}${option('billed','Valor cobrado',goal.basis)}</select></label>${input('Meta (R$)','target',goal.configured?(goal.target/100).toFixed(2).replace('.',','):'','text','required inputmode="decimal" placeholder="5000,00"')}</div>`+submit('Salvar meta do mês'));
}
export function renderClinicAlerts(state,now=new Date()){
  const alerts=getClinicAlerts(state,now);
  return `<div class="clinic-alert-list" aria-live="polite">${alerts.length?alerts.map(a=>`<article class="clinic-alert"><div><strong>${esc(a.title)}</strong><p>${esc(a.detail)} · ${prettyDate(a.date)}</p></div><button type="button" class="secondary" data-clinic-action="dismiss-alert" data-id="${esc(a.id)}">Marcar como lido</button></article>`).join(''):'<p class="clinic-empty">Nenhum alerta interno pendente no momento.</p>'}</div>`;
}
function preferencesPanel(state){
  const p=clinicConfig(state).preferences;
  return `<p class="clinic-note">Avisos internos aparecem quando o aplicativo é aberto ou atualizado. Não há envio de WhatsApp, e-mail, push, lembrete em segundo plano ou mensagem à paciente.</p>`+form('preferences',`${check('Exibir alertas internos','internalAlerts',p.internalAlerts)}${check('Avisar sobre retornos previstos','returnAlerts',p.returnAlerts)}${check('Avisar sobre próximos horários','appointmentAlerts',p.appointmentAlerts)}<label class="clinic-field"><span>Antecedência dos horários</span><select name="reminderMinutes">${[15,30,60,1440].map(n=>option(String(n),n===1440?'1 dia':n+' minutos',String(p.reminderMinutes))).join('')}</select></label>`+submit('Salvar preferências'))+renderClinicAlerts(state);
}
export function renderClinicPage(state){
  const c=clinicConfig(state),warnings=clinicScheduleWarnings(state);
  return `<div class="page-heading"><div><h1>Clínica</h1><p class="subtitle">Horários, equipe e metas de ${esc(c.name)}.</p></div><span class="badge rose">${modeText('Configuração local','Configuração no servidor')}</span></div><div class="clinic-module">${warnings.length?`<div class="clinic-note"><strong>Revise ${warnings.length} compromisso(s) existente(s)</strong><p>As configurações atuais não acomodam estes horários; nenhum agendamento foi cancelado ou movido.</p><ul>${warnings.map(w=>`<li>${prettyDate(w.date)} às ${esc(w.time)} · ${esc((state.patients||[]).find(p=>p.id===w.patientId)?.name||'Paciente')} — ${esc(w.reason)}</li>`).join('')}</ul><a href="#agenda" class="secondary">Abrir agenda</a></div>`:''}${section('Clínica e horários','Expediente semanal e intervalos',weeklyForm(state),true)}${section('Equipe',modeText('Integrantes e papéis de demonstração','Integrantes e papéis organizacionais'),teamPanel(state))}${section('Disponibilidade','Bloqueios, repetição semanal e fechamentos',blocksPanel(state))}${section('Metas mensais','Valores cobrados e recebidos, separados',goalPanel(state))}${section('Avisos e preferências','Alertas internos, sem envio de mensagens',preferencesPanel(state))}<p class="clinic-help">${modeText('Dados deste navegador. Configurações e equipe não autenticam usuários nem substituem acesso individual em produção.','Gravações confirmadas ficam no servidor da clínica. Cadastrar integrantes não concede acesso; contas e permissões exigem configuração própria.')}</p></div>`;
}
export function renderGoalCard(state,{month=dateKey().slice(0,7)}={}){
  const goal=getMonthlyGoal(state,month);
  return `<section class="sp-home-card clinic-home-goal"><h2>Meta do mês</h2><p>${month.split('-').reverse().join('/')}${goal.configured?' · '+(goal.basis==='billed'?'Valor cobrado':'Valor recebido'):''}</p>${goal.configured?`<strong class="clinic-goal-value">${money(goal.actual)}</strong><span>de ${money(goal.target)} · ${goal.percent.toLocaleString('pt-BR')}%</span><progress max="100" value="${Math.min(100,Math.max(0,goal.percent))}" aria-label="Progresso da meta mensal"></progress><small>${goal.remaining?'Faltam '+money(goal.remaining):modeText('Meta atingida nos registros locais','Meta atingida nos registros do servidor')}</small>`:'<strong>Ainda não configurada</strong><p>Defina uma meta por valor cobrado ou recebido.</p>'}<a class="clinic-goal-link" href="#clinica">${goal.configured?'Editar meta':'Configurar meta'} →</a></section>`;
}
function slotsMarkup(state,query){
  const slots=getAvailableSlots(state,query);
  return `<p class="clinic-slot-summary">${slots.length} horário(s) livre(s) para ${query.duration} minutos · ${prettyDate(query.date)}</p><div class="clinic-slots">${slots.map(time=>`<button type="button" class="secondary clinic-slot" data-clinic-action="choose-slot" data-time="${time}" data-date="${query.date}" data-professional="${esc(query.professionalId)}" data-duration="${query.duration}">${time}</button>`).join('')}</div>${slots.length?'':'<p class="clinic-empty">Nenhum horário livre nessas condições. Confira duração, profissional, expediente e bloqueios.</p>'}`;
}
function returnsMarkup(state){
  const items=pendingReturns(state);
  return `<h3>Retornos previstos</h3><p class="clinic-help">A previsão é um lembrete interno. Agendar cria um novo horário, com verificação de disponibilidade.</p><ul class="clinic-list">${items.map(r=>`<li class="clinic-list-row"><div><strong>${esc((state.patients||[]).find(p=>p.id===r.patientId)?.name||'Paciente indisponível')}</strong><span>${prettyDate(r.date)} · ${r.overdue?'Data prevista já passou':r.dueToday?'Previsto para hoje':'Previsto'}</span></div><div class="clinic-row-actions"><button class="secondary" type="button" data-clinic-action="schedule-return" data-id="${esc(r.id)}">Agendar retorno</button><button class="subtle" type="button" data-clinic-action="cancel-return" data-id="${esc(r.id)}">Cancelar previsão</button></div></li>`).join('')||'<li class="clinic-empty">Nenhum retorno previsto pendente.</li>'}</ul>`;
}
export function renderAgendaSupport(state,{date=dateKey(),professionalId,duration=30}={}){
  const selected=professionalId||attendingProfessionals(state)[0]?.id||DEFAULT_PROFESSIONAL_ID;
  const query={date,professionalId:selected,duration,step:15};let slots='';try{slots=slotsMarkup(state,query);}catch(e){slots=`<p class="clinic-feedback">${esc(e.message)}</p>`;}
  const booking=form('booking',`<input type="hidden" name="expectedReturnId" value=""><p class="clinic-return-context" data-return-context hidden></p><div class="clinic-fields"><label class="clinic-field"><span>Paciente</span><select name="patientId" required>${personOptions(state)}</select></label>${professionalSelect(state,selected)}${input('Data','date',date,'date','required')}${input('Horário','time','','time','required')}${input('Duração (min)','duration',duration,'number','required min="5" max="480"')}${input('Atendimento','service','','text','required maxlength="120"')}</div>`+submit('Salvar agendamento'));
  return `<div class="clinic-module clinic-agenda-support" data-agenda-support>${section('Disponibilidade e retornos','Consulte horários livres e reserve um retorno',form('slots',`<div class="clinic-fields">${input('Consultar dia','date',date,'date','required')}${professionalSelect(state,selected)}${input('Duração (min)','duration',duration,'number','required min="5" max="480"')}</div>`+submit('Consultar horários'))+`<div data-clinic-slots>${slots}</div><details class="clinic-booking-panel"><summary>Agendar horário selecionado</summary>${booking}</details><hr>${returnsMarkup(state)}`)}<div class="clinic-feedback" data-clinic-action-feedback role="alert" hidden></div></div>`;
}
const mounts=new WeakMap();
/** mutate(fn) must commit the application state transactionally. No network or credentials are used. */
export function mountClinic(host,{getState,mutate,notify=()=>{},rerender=()=>{}}){
  mounts.get(host)?.();let saving=false;
  const showError=(error,scope=host)=>{const target=scope.querySelector('[data-clinic-feedback]')||host.querySelector('[data-clinic-action-feedback]');if(target){target.hidden=false;target.textContent=error.message||String(error);}notify(error.message||String(error),true);};
  const save=async(fn,scope=host)=>{
    if(saving)return;saving=true;
    const savedForm=scope.matches?.('form[data-clinic-form]')?scope:null;
    const otherDrafts=[...host.querySelectorAll('form[data-clinic-form][data-unsaved]')].filter(f=>f!==savedForm).map(f=>({kind:f.dataset.clinicForm,controls:[...f.elements].filter(el=>el.name).map(el=>({name:el.name,value:el.value,checked:el.checked,type:el.type}))}));
    const buttons=[...scope.querySelectorAll('button')],opened=new Set([...host.querySelectorAll('[data-clinic-section][open]')].map(el=>el.dataset.clinicSection));
    buttons.forEach(b=>b.disabled=true);if(savedForm)savedForm.inert=true;
    try{
      await mutate(s=>{ensureClinic(s);fn(s);});if(savedForm)delete savedForm.dataset.unsaved;
      notify(modeText('Registro salvo neste navegador.','Registro confirmado no servidor da clínica.'));await rerender();
      const currentHost=host.isConnected?host:(host.ownerDocument?.getElementById(host.id)||host);
      for(const el of currentHost.querySelectorAll('[data-clinic-section]'))el.open=opened.has(el.dataset.clinicSection);
      for(const draft of otherDrafts){const form=currentHost.querySelector(`form[data-clinic-form="${draft.kind}"]`);if(!form)continue;for(const control of draft.controls){const el=form.elements.namedItem(control.name);if(!el)continue;if(control.type==='checkbox'||control.type==='radio')el.checked=control.checked;else el.value=control.value;}form.dataset.unsaved='true';}
    }catch(e){showError(e,scope);}finally{saving=false;if(savedForm)savedForm.inert=false;buttons.forEach(b=>b.disabled=false);}
  };
  const onEdit=event=>{const form=event.target.closest?.('form[data-clinic-form]');if(form&&host.contains(form)&&form.dataset.clinicForm!=='slots')form.dataset.unsaved='true';};
  const onSubmit=async event=>{
    const formEl=event.target.closest?.('form[data-clinic-form]');if(!formEl||!host.contains(formEl))return;event.preventDefault();event.stopPropagation();if(saving)return;
    const f=new FormData(formEl),type=formEl.dataset.clinicForm,read=name=>String(f.get(name)||'');
    const feedbackEl=formEl.querySelector('[data-clinic-feedback]');if(feedbackEl)feedbackEl.hidden=true;
    try{
      if(type==='slots'){
        const query={date:read('date'),professionalId:read('professionalId'),duration:Number(f.get('duration')),step:15};
        formEl.closest('[data-agenda-support]').querySelector('[data-clinic-slots]').innerHTML=slotsMarkup(getState(),query);return;
      }
      if(type==='settings'){
        const weekly=WEEKDAYS.map((_,day)=>({day,enabled:f.has('enabled-'+day),start:read('start-'+day),end:read('end-'+day),breaks:parseBreaks(read('breaks-'+day))}));
        await save(s=>saveClinicSettings(s,{name:read('name'),weekly}),formEl);
      }else if(type==='professional')await save(s=>saveProfessional(s,{id:read('id')||undefined,name:read('name'),role:read('role'),active:f.has('active')}),formEl);
      else if(type==='block')await save(s=>saveBlock(s,{professionalId:read('professionalId'),reason:read('reason'),date:read('date'),endDate:read('endDate'),start:read('start'),end:read('end'),repeat:read('repeat')}),formEl);
      else if(type==='holiday')await save(s=>saveHoliday(s,{date:read('date'),reason:read('reason')}),formEl);
      else if(type==='goal'){const target=cents(read('target'));await save(s=>saveMonthlyGoal(s,{month:read('month'),basis:read('basis'),target}),formEl);}
      else if(type==='preferences')await save(s=>saveClinicPreferences(s,{internalAlerts:f.has('internalAlerts'),returnAlerts:f.has('returnAlerts'),appointmentAlerts:f.has('appointmentAlerts'),reminderMinutes:Number(f.get('reminderMinutes'))}),formEl);
      else if(type==='booking')await save(s=>scheduleClinicAppointment(s,{patientId:read('patientId'),professionalId:read('professionalId'),date:read('date'),time:read('time'),duration:Number(f.get('duration')),service:read('service').trim(),status:'agendado',...(read('expectedReturnId')?{expectedReturnId:read('expectedReturnId')}:{})}),formEl);
    }catch(e){showError(e,formEl);}
  };
  const onClick=async event=>{
    const button=event.target.closest?.('[data-clinic-action]');if(!button||!host.contains(button))return;event.preventDefault();event.stopPropagation();if(saving)return;
    const action=button.dataset.clinicAction,id=button.dataset.id;
    try{
      if(action==='edit-professional'){
        const p=clinicConfig(getState()).professionals.find(p=>p.id===id);if(!p)throw Error('Integrante indisponível.');
        const f=host.querySelector('[data-clinic-form="professional"]');for(const key of ['id','name','role'])f.elements.namedItem(key).value=p[key];f.elements.namedItem('active').checked=p.active;f.elements.namedItem('name').focus();
      }else if(action==='clear-professional'){const f=host.querySelector('[data-clinic-form="professional"]');f.reset();delete f.dataset.unsaved;f.elements.namedItem('id').value='';f.elements.namedItem('name').focus();}
      else if(action==='remove-block')await save(s=>{const b=s.clinic.blocks.find(b=>b.id===id);if(!b)throw Error('Bloqueio indisponível.');b.active=false;});
      else if(action==='remove-holiday')await save(s=>{s.clinic.holidays=s.clinic.holidays.filter(h=>h.id!==id);});
      else if(action==='edit-goal'){
        const goal=getMonthlyGoal(getState(),button.dataset.month),f=host.querySelector('[data-clinic-form="goal"]');f.elements.namedItem('month').value=goal.month;f.elements.namedItem('basis').value=goal.basis;f.elements.namedItem('target').value=(goal.target/100).toFixed(2).replace('.',',');f.elements.namedItem('target').focus();
      }else if(action==='dismiss-alert')await save(s=>dismissClinicAlert(s,id));
      else if(action==='cancel-return')await save(s=>cancelExpectedReturn(s,id));
      else if(action==='choose-slot'){
        const panel=button.closest('[data-agenda-support]'),f=panel.querySelector('[data-clinic-form="booking"]');for(const [key,value]of Object.entries({date:button.dataset.date,time:button.dataset.time,duration:button.dataset.duration,professionalId:button.dataset.professional}))f.elements.namedItem(key).value=value;
        f.dataset.unsaved='true';
        panel.querySelector('.clinic-booking-panel').open=true;f.elements.namedItem(f.elements.namedItem('patientId').value?'service':'patientId').focus();
      }else if(action==='schedule-return'){
        const state=getState(),r=pendingReturns(state).find(r=>r.id===id);if(!r)throw Error('Retorno indisponível.');
        const panel=button.closest('[data-agenda-support]'),f=panel.querySelector('[data-clinic-form="booking"]');
        const visit=(state.visits||[]).find(v=>v.id===(r.sourceVisitId||r.visitId)),appointment=(state.appointments||[]).find(a=>a.id===visit?.appointmentId),professional=effectiveProfessional(appointment||{}),date=r.date<dateKey()?dateKey():r.date;
        f.elements.namedItem('expectedReturnId').value=r.id;f.elements.namedItem('patientId').value=r.patientId;f.elements.namedItem('date').value=date;f.elements.namedItem('service').value='Retorno';f.elements.namedItem('time').value='';
        f.dataset.unsaved='true';
        if(attendingProfessionals(state).some(p=>p.id===professional))f.elements.namedItem('professionalId').value=professional;
        const note=f.querySelector('[data-return-context]');note.hidden=false;note.textContent='Vinculado ao retorno previsto para '+prettyDate(r.date)+'.';
        const q=panel.querySelector('[data-clinic-form="slots"]');q.elements.namedItem('date').value=date;q.elements.namedItem('professionalId').value=f.elements.namedItem('professionalId').value;
        panel.querySelector('[data-clinic-slots]').innerHTML=slotsMarkup(state,{date,professionalId:f.elements.namedItem('professionalId').value,duration:Number(f.elements.namedItem('duration').value)});
        panel.querySelector('.clinic-booking-panel').open=true;f.elements.namedItem('time').focus();
      }
    }catch(e){showError(e);}
  };
  host.addEventListener('submit',onSubmit);host.addEventListener('click',onClick);host.addEventListener('input',onEdit);host.addEventListener('change',onEdit);
  const cleanup=()=>{host.removeEventListener('submit',onSubmit);host.removeEventListener('click',onClick);host.removeEventListener('input',onEdit);host.removeEventListener('change',onEdit);};mounts.set(host,cleanup);return cleanup;
}
