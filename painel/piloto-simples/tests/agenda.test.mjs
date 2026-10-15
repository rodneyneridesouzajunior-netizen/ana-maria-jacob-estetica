import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeAgendaView,addAgendaDays,shiftAgendaDate,agendaCalendar,getAgendaData,renderAgenda,mountAgenda} from '../agenda.mjs';
import {defaultClinic,DEFAULT_PROFESSIONAL_ID} from '../clinic-domain.mjs';

const now=new Date('2026-10-15T12:00:00');
function fixture(){
  const clinic=defaultClinic();clinic.professionals.push({id:'staff-2',name:'Profissional B',active:true,role:'profissional'});
  return {clinic,patients:[{id:'p1',name:'Ana Lúcia'},{id:'p2',name:'Marina Silva'}],appointments:[
    {id:'a1',patientId:'p1',date:'2026-10-15',time:'09:00',duration:60,service:'Avaliação facial',status:'confirmado'},
    {id:'a2',patientId:'p2',date:'2026-10-15',time:'10:00',duration:30,service:'Retorno',status:'cancelado',professionalId:'staff-2',appointmentType:'Revisão',color:'purple'},
    {id:'a3',patientId:'p1',date:'2026-10-16',time:'11:00',duration:60,service:'Cuidados de pele',status:'agendado',professionalId:'staff-2',appointmentType:'Sessão',color:'green'},
    {id:'a4',patientId:'p2',date:'2026-10-31',time:'14:00',duration:45,service:'Avaliação',status:'concluido',professionalId:'old-professional'},
    {id:'a5',patientId:'p1',date:'2026-09-29',time:'08:00',duration:30,service:'Retorno',status:'agendado'},
    {id:'a6',patientId:'p1',date:'2026-11-01',time:'08:00',duration:30,service:'Retorno',status:'agendado'},
    {id:'invalid',patientId:'p1',date:'2026-02-30',time:'09:00',duration:30,service:'Data inválida',status:'agendado'}
  ]};
}

test('normaliza seleção inválida sem aceitar situação ou visualização desconhecidas',()=>{
  assert.deepEqual(normalizeAgendaView({date:'2026-02-30',view:'bad',status:'bad'},now),{date:'2026-10-15',view:'day',query:'',professionalId:'',status:''});
  assert.equal(normalizeAgendaView({date:'2024-02-29',view:'month',status:'cancelado',query:'A'.repeat(200)},now).query.length,120);
});

test('semana começa na segunda e cruza o ano preservando os sete dias',()=>{
  const value=agendaCalendar('2025-01-01','week');
  assert.equal(value.start,'2024-12-30');assert.equal(value.end,'2025-01-05');assert.equal(value.dates.length,7);
  assert.equal(agendaCalendar('2026-10-18','week').start,'2026-10-12');
});

test('mês tem 42 dias com vizinhos e não pula semana quando começa na segunda',()=>{
  const october=agendaCalendar('2026-10-15','month');
  assert.equal(october.start,'2026-09-28');assert.equal(october.end,'2026-11-08');assert.equal(october.dates.length,42);
  assert.equal(october.periodStart,'2026-10-01');assert.equal(october.periodEnd,'2026-10-31');
  assert.equal(agendaCalendar('2026-06-12','month').start,'2026-06-01');
  assert.equal(new Set(october.dates).size,42);
});

test('fevereiro bissexto e não bissexto têm limite correto',()=>{
  assert.equal(agendaCalendar('2024-02-29','month').periodEnd,'2024-02-29');
  assert.equal(agendaCalendar('2025-02-01','month').periodEnd,'2025-02-28');
  assert.equal(agendaCalendar('2000-02-20','month').periodEnd,'2000-02-29');
  assert.equal(agendaCalendar('2100-02-20','month').periodEnd,'2100-02-28');
});

test('navegação mensal limita o dia e navegação diária/semanal cruza mês e ano',()=>{
  assert.equal(shiftAgendaDate('2024-01-31','month',1),'2024-02-29');
  assert.equal(shiftAgendaDate('2025-01-31','month',1),'2025-02-28');
  assert.equal(shiftAgendaDate('2026-12-31','month',1),'2027-01-31');
  assert.equal(shiftAgendaDate('2026-01-31','month',-1),'2025-12-31');
  assert.equal(shiftAgendaDate('2026-12-31','day',1),'2027-01-01');
  assert.equal(shiftAgendaDate('2026-12-31','week',1),'2027-01-07');
  assert.equal(addAgendaDays('2018-11-03',1),'2018-11-04');
  assert.throws(()=>addAgendaDays('2026-02-30',1));assert.throws(()=>shiftAgendaDate('2026-10-15','month',2));
});

test('contagem mensal exclui vizinhos do total e preserva seus registros nas células',()=>{
  const state=fixture(),before=structuredClone(state),data=getAgendaData(state,{date:'2026-10-15',view:'month'},now);
  assert.deepEqual(data.counts,{total:4,active:3,cancelled:1,completed:1,inProgress:0});assert.equal(data.visibleItems.length,6);
  assert.equal(data.days.find(day=>day.date==='2026-09-29').counts.total,1);
  assert.equal(data.days.find(day=>day.date==='2026-11-01').inMonth,false);
  assert.equal(data.days.filter(day=>day.selected).length,1);assert.equal(data.invalidDateCount,1);
  assert.deepEqual(state,before);
});

test('busca ignora acentos, combina paciente e procedimento e filtra profissional/situação',()=>{
  const state=fixture(),options={date:'2026-10-15',view:'month'};
  assert.deepEqual(getAgendaData(state,{...options,query:'lucia AVALIACAO'},now).items.map(a=>a.id),['a1']);
  assert.deepEqual(getAgendaData(state,{...options,query:'sessao'},now).items.map(a=>a.id),['a3']);
  assert.deepEqual(getAgendaData(state,{...options,professionalId:'staff-2'},now).items.map(a=>a.id),['a2','a3']);
  assert.deepEqual(getAgendaData(state,{...options,professionalId:'staff-2',status:'agendado'},now).items.map(a=>a.id),['a3']);
  assert.equal(getAgendaData(state,{...options,query:'inexistente'},now).counts.total,0);
});

test('profissional padrão dos registros antigos e inativo com histórico permanecem acessíveis',()=>{
  const data=getAgendaData(fixture(),{date:'2026-10-15',view:'month',professionalId:DEFAULT_PROFESSIONAL_ID},now);
  assert.deepEqual(data.items.map(a=>a.id),['a1']);
  assert.ok(data.professionals.some(p=>p.id==='old-professional'&&p.active===false));
  assert.equal(getAgendaData(fixture(),{date:'2026-10-15',view:'month',professionalId:'old-professional'},now).counts.completed,1);
});

test('tipos e cores do cadastro prevalecem sem mudar serviço nem situação',()=>{
  const data=getAgendaData(fixture(),{date:'2026-10-15',view:'day'},now),revision=data.items[1];
  assert.equal(revision.service,'Retorno');assert.equal(revision.typeLabel,'Revisão');assert.equal(revision.tone,'procedimento');assert.equal(revision.color,'purple');
  assert.equal(data.items[0].color,'auto');assert.equal(data.items[0].typeLabel,'Avaliação');
  const state=fixture();state.appointments[0].color='url(javascript:bad)';assert.equal(getAgendaData(state,{date:'2026-10-15'},now).items[0].color,'auto');
});

test('cancelado aparece e não pode abrir atendimento; concluído pode consultar mas não editar',()=>{
  let html=renderAgenda(fixture(),{date:'2026-10-15'});
  assert.match(html,/data-action="attend" data-id="a2" disabled/);assert.match(html,/data-action="edit-appointment" data-id="a2"\s+aria-label/);
  assert.match(html,/data-appointment-color="purple"/);assert.match(html,/>Revisão<\/span>/);assert.match(html,/>Cancelado<\/span>/);
  html=renderAgenda(fixture(),{date:'2026-10-31'});
  assert.match(html,/data-action="edit-appointment" data-id="a4" disabled/);assert.match(html,/>Consultar <svg/);
});

test('em atendimento mantém filtro, contagem ativa e ação Continuar sem mutar o estado',()=>{
  const state=fixture();state.appointments[0].status='em_atendimento';const before=structuredClone(state);
  const options={date:'2026-10-15',view:'day',status:'em_atendimento'};
  assert.equal(normalizeAgendaView(options,now).status,'em_atendimento');
  const data=getAgendaData(state,options,now);assert.deepEqual(data.items.map(a=>a.id),['a1']);
  assert.deepEqual(data.counts,{total:1,active:1,cancelled:0,completed:0,inProgress:1});
  const html=renderAgenda(state,options);
  assert.match(html,/<option value="em_atendimento" selected>Em atendimento/);
  assert.match(html,/data-status="em_atendimento">Em atendimento/);
  assert.match(html,/data-action="attend" data-id="a1"\s+aria-label="Continuar atendimento de Ana Lúcia">Continuar/);
  assert.match(html,/data-action="edit-appointment" data-id="a1"\s+aria-label/);
  assert.match(html,/1 em atendimento/);assert.deepEqual(state,before);
});

test('em atendimento é identificado também na semana e no mês, sem classificação de cancelado',()=>{
  const state=fixture();state.appointments[0].status='em_atendimento';
  const week=renderAgenda(state,{date:'2026-10-15',view:'week',status:'em_atendimento'});
  const month=renderAgenda(state,{date:'2026-10-15',view:'month',status:'em_atendimento'});
  assert.match(week,/>Continuar <svg/);assert.match(week,/data-status="em_atendimento">Em atendimento/);
  assert.match(month,/ag-month-progress">Em atendimento<\/em>/);
  assert.doesNotMatch(month,/class="ag-month-event ag-cancelled"/);
});

test('mês oferece 42 células, seleção por teclado e totais sem falsa disponibilidade',()=>{
  const html=renderAgenda(fixture(),{date:'2026-10-15',view:'month'});
  assert.equal((html.match(/role="gridcell"/g)||[]).length,42);assert.equal((html.match(/tabindex="0"/g)||[]).length,1);
  assert.match(html,/4 registros no mês/);assert.match(html,/Dias sem registros não significam horários disponíveis/);
  assert.match(html,/data-date="2026-09-29"/);assert.match(html,/data-date="2026-11-01"/);
  assert.match(html,/data-appointment-color="purple"/);assert.match(html,/1 registro com data inválida/);
});

test('texto e atributos dos registros são escapados em dia, semana e mês',()=>{
  const state=fixture();state.patients[0].name='<img src=x onerror=alert(1)>';
  state.appointments[0].service='<script>unsafe</script>';state.appointments[0].id='" onclick="unsafe';state.appointments[0].appointmentType='" onmouseover="unsafe';
  for(const view of ['day','week','month']){
    const html=renderAgenda(state,{date:'2026-10-15',view,query:'"'});
    assert.doesNotMatch(html,/<img src=x|<script>| onclick="unsafe| onmouseover="unsafe/);assert.match(html,/value="&quot;"/);
    const all=renderAgenda(state,{date:'2026-10-15',view});
    assert.match(all,/&lt;img src=x/);assert.doesNotMatch(all,/<script>unsafe| onclick="unsafe/);
  }
});

test('sem registros permite agendar e estado filtrado permite limpar sem inventar bloqueio',()=>{
  const state={patients:[],appointments:[]};let html=renderAgenda(state,{date:'2026-10-15'});
  assert.match(html,/data-action="new-appointment"/);assert.match(html,/Nenhum agendamento neste dia/);assert.doesNotMatch(html,/Horário livre às/);
  html=renderAgenda(state,{date:'2026-10-15',query:'Ana'});assert.match(html,/Nenhum registro para estes filtros/);assert.match(html,/data-agenda-action="clear"/);
});

function fakeHost(){
  const listeners=new Map(),fields=new Map();
  return {listeners,fields,contains:()=>true,addEventListener:(event,handler)=>listeners.set(event,handler),removeEventListener:event=>listeners.delete(event),querySelector:selector=>fields.get(selector)||null};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('mount repassa seleção completa, preserva busca ainda digitada e não intercepta ação clínica',async()=>{
  const host=fakeHost();let current={date:'2026-10-15',view:'day',query:'',professionalId:'staff-2',status:''},changes=0,notifications=0;
  host.fields.set('[data-agenda-field="query"]',{value:'Ana',focus(){},setSelectionRange(){}});
  const cleanup=mountAgenda(host,{getView:()=>current,setView:next=>{current=next;changes++;},onViewChange:()=>notifications++});
  host.listeners.get('click')({target:{closest:()=>({dataset:{agendaAction:'view',view:'month'}})}});await tick();
  assert.equal(current.view,'month');assert.equal(current.query,'Ana');assert.equal(current.professionalId,'staff-2');assert.equal(changes,1);assert.equal(notifications,1);
  host.listeners.get('click')({target:{closest:()=>null}});await tick();assert.equal(changes,1);
  cleanup();assert.equal(host.listeners.size,0);
});

test('setView pode rejeitar navegação e erro fica visível sem rejeição de promessa solta',async()=>{
  const host=fakeHost(),current={date:'2026-10-15',view:'day',query:'anterior',professionalId:'',status:''};
  const field={value:'nova'};host.fields.set('[data-agenda-field="query"]',field);
  const feedback={hidden:true,textContent:''};host.fields.set('[data-agenda-feedback]',feedback);
  let notification=0,fail=false;
  const cleanup=mountAgenda(host,{getView:()=>current,setView:()=>{if(fail)throw Error('Falha simulada');return false;},onViewChange:()=>notification++});
  const event={target:{closest:()=>({dataset:{agendaAction:'next'}})}};
  host.listeners.get('click')(event);await tick();assert.equal(field.value,'anterior');assert.equal(notification,0);
  fail=true;host.listeners.get('click')(event);await tick();assert.equal(feedback.textContent,'Falha simulada');assert.equal(feedback.hidden,false);
  cleanup();
});

test('teclado do mês percorre semana e mês mantendo foco no dia selecionado',async()=>{
  const host=fakeHost();let current={date:'2026-10-31',view:'month'},context;
  const cleanup=mountAgenda(host,{getView:()=>current,setView:(next,meta)=>{current=next;context=meta;}});
  let prevented=false;
  host.listeners.get('keydown')({key:'ArrowRight',preventDefault(){prevented=true;},target:{closest:()=>({dataset:{date:'2026-10-31'}})}});await tick();
  assert.equal(current.date,'2026-11-01');assert.equal(current.view,'month');assert.equal(prevented,true);assert.match(context.focus.selector,/2026-11-01/);
  host.listeners.get('keydown')({key:'Home',preventDefault(){},target:{closest:()=>({dataset:{date:'2026-11-01'}})}});await tick();assert.equal(current.date,'2026-10-26');
  cleanup();
});
