import test from 'node:test';
import assert from 'node:assert/strict';
import {homeData,getHomeData,renderHome} from '../home.mjs';
import {financeReport} from '../finance-domain.mjs';
import {saveMonthlyGoal,getMonthlyGoal,dismissClinicAlert} from '../clinic-domain.mjs';

const now=new Date('2026-10-15T12:00:00');
function fixture(){return{patients:[{id:'p1',name:'Paciente de teste'}],appointments:[
  {id:'a1',patientId:'p1',date:'2026-10-15',time:'09:00',duration:60,service:'Avaliação',status:'confirmado'},
  {id:'a2',patientId:'p1',date:'2026-10-15',time:'14:00',duration:60,service:'Retorno',status:'confirmado'},
  {id:'a3',patientId:'p1',date:'2026-10-15',time:'16:00',duration:60,service:'Cancelado',status:'cancelado'},
  {id:'a4',patientId:'p1',date:'2026-10-16',time:'10:00',duration:60,service:'Avaliação',status:'agendado'}
],visits:[{id:'v1',patientId:'p1',date:'2026-09-10',service:'Avaliação',status:'rascunho'},{id:'v2',patientId:'p1',date:'2026-10-15',service:'Retorno',status:'rascunho'}],bills:[{id:'b1',visitId:'v1',date:'2026-09-10',total:5000,cost:1000},{id:'b2',date:'2026-10-15',total:10000,cost:2000}],payments:[{billId:'b1',date:'2026-09-12',amount:1000},{billId:'b2',date:'2026-10-15',amount:3000}]};}

test('início separa cobrança e recebimento do mês de saldo total sem alterar os registros',()=>{
  const state=fixture(),snapshot=structuredClone(state),data=homeData(state,now);
  assert.equal(data.billedMonth,10000);assert.equal(data.receivedMonth,3000);assert.equal(data.outstanding,11000);
  assert.equal(data.series.at(-1).total,10000);assert.equal(data.series.at(-2).total,5000);
  assert.equal(data.todayCount,2);assert.equal(data.patientCount,1);assert.deepEqual(state,snapshot);
});
test('próximos horários excluem cancelados e horários anteriores e ordenam data e hora',()=>{
  const data=homeData(fixture(),now);assert.deepEqual(data.upcoming.map(item=>item.id),['a2','a4']);
  assert.deepEqual(data.recent.map(item=>item.id),['v2','v1']);assert.equal(data.procedures.reduce((sum,item)=>sum+item.count,0),2);
});
test('consulta de pacote mostra a cobrança vinculada sem duplicar faturamento nem atribuir o pacote inteiro à sessão',()=>{
  const state=fixture();state.visits[1].billId='b2';state.visits[1].quoteId='q1';state.bills[1].quoteId='q1';
  const html=renderHome(state,now);assert.match(html,/Total do orçamento vinculado/);assert.doesNotMatch(html,/Sem cobrança vinculada/);
  assert.equal(homeData(state,now).billedMonth,10000);
  state.bills[1].cancelledAt='2026-10-15T12:00:00Z';
  assert.doesNotMatch(renderHome(state,now),/Total do orçamento vinculado/);assert.equal(homeData(state,now).billedMonth,0);
});
test('início não inventa meta ou cobrança vinculada e escapa o texto dos registros',()=>{
  const state=fixture();state.patients[0].name='<img src=x onerror=alert(1)>';
  const html=renderHome(state,now);
  assert.match(html,/Ainda não configurada/);assert.match(html,/Sem cobrança vinculada/);assert.match(html,/Inclui rascunhos de consulta/);
  assert.doesNotMatch(html,/<img src=x/);assert.match(html,/&lt;img src=x/);
  for(const name of ['sp-home','sp-overview','sp-hero','clinic-home-goal','sp-home-grid','sp-revenue','sp-procedures','sp-recent'])assert.ok(html.includes(name));
});

test('início e Financeiro usam os mesmos valores com cancelamento e estorno posterior',()=>{
  const state=fixture();state.bills.push({id:'cancelled',visitId:'v2',date:'2026-10-15',total:900000,cost:0,cancelledAt:'2026-10-15T12:00:00Z'});
  state.payments[0].id='payment-old';state.payments[0].reversedAt='2026-10-15T12:00:00Z';state.paymentReversals=[{id:'rev',paymentId:'payment-old',date:'2026-10-15',amount:1000}];
  const snapshot=structuredClone(state),data=homeData(state,now),report=financeReport({...state},'2026-10');
  assert.equal(data.billedMonth,10000);assert.equal(data.receivedMonth,2000);assert.equal(data.grossReceivedMonth,3000);assert.equal(data.reversedMonth,1000);assert.equal(data.series.at(-2).received,1000);
  assert.equal(data.receivedMonth,report.received);assert.equal(data.outstanding,report.outstanding);assert.equal(data.series.at(-1).total,report.billed);assert.deepEqual(state,snapshot);
  const html=renderHome(state,now);assert(!html.includes('9.000,00'));assert.match(html,/Recebido líquido/);assert.match(html,/estornos do mês/);
});

test('home mostra a meta salva e conserva entrada histórica no mês original',()=>{
  const state=fixture();state.payments[0].id='old';state.payments[0].reversedAt='2026-10-15T12:00:00Z';state.paymentReversals=[{paymentId:'old',date:'2026-10-15',amount:1000}];
  saveMonthlyGoal(state,{month:'2026-10',basis:'received',target:4000});saveMonthlyGoal(state,{month:'2026-09',basis:'received',target:2000});
  const html=renderHome(state,now);assert.match(html,/Progresso da meta mensal/);assert.match(html,/50%/);assert.doesNotMatch(html,/Ainda não configurada/);
  assert.equal(getMonthlyGoal(state,'2026-09').actual,1000);assert.equal(getMonthlyGoal(state,'2026-10').actual,homeData(state,now).receivedMonth);
});

test('alertas do início são reais, podem ser lidos e não afirmam envio externo',()=>{
  const state=fixture();state.expectedReturns=[{id:'expected',patientId:'p1',date:'2026-10-14',status:'previsto'}];
  let html=renderHome(state,now);assert.match(html,/1 aviso\(s\) interno\(s\)/);assert.match(html,/Retorno previsto em atraso/);assert.match(html,/Sem envio de mensagens/);assert.match(html,/dismiss-alert/);
  dismissClinicAlert(state,'return:expected:2026-10-14');html=renderHome(state,now);assert.doesNotMatch(html,/Retorno previsto em atraso/);
});

test('início vazio oferece caminhos reais sem inventar agenda, procedimento ou progresso',()=>{
  const state={patients:[],appointments:[],visits:[],bills:[],payments:[]};
  const data=getHomeData(state,now),html=renderHome(state,now);
  assert.equal(getHomeData,homeData);assert.equal(data.billedMonth,0);assert.equal(data.receivedMonth,0);
  assert.equal(data.upcoming.length,0);assert.equal(data.procedures.length,0);assert.equal(data.recent.length,0);
  assert.ok(data.series.every(item=>item.total===0));
  assert.match(html,/Nenhum atendimento futuro agendado/);assert.match(html,/Nenhuma consulta cadastrada/);
  assert.match(html,/data-action="new-appointment"/);assert.match(html,/data-action="new-patient"/);
  for(const route of ['agenda','financeiro','pacientes','catalogo','clinica'])assert.ok(html.includes(`href="#${route}"`));
  assert.doesNotMatch(html,/<progress|class="sp-chart-bar"/);
  assert.match(html,/nenhuma medida acima representa lucro/);
});

test('situações e tipos mantêm texto legível, além das cores, e abertura vinculada à consulta',()=>{
  const state=fixture();state.visits[0].status='concluido';state.visits[1].status='cancelado';
  const html=renderHome(state,now);
  assert.match(html,/data-status-tone="complete">Concluído/);assert.match(html,/data-status-tone="cancelled">Cancelado/);
  assert.match(html,/data-service-tone="avaliacao"/);assert.match(html,/data-service-tone="retorno"/);
  assert.match(html,/Confirmado · 60 min/);assert.match(html,/A confirmar · 60 min/);
  assert.match(html,/href="#paciente\/p1\/v1\/registro"/);
  assert.match(html,/aria-label="Abrir consulta de Paciente de teste, 10\/09"/);
  assert.match(html,/<th scope="col">Paciente/);
});

test('gráfico oferece os seis valores acessíveis e nomes de serviços não injetam marcação',()=>{
  const state=fixture();state.visits[0].service='<script>unsafe</script>';
  const html=renderHome(state,now),desc=html.match(/<desc>(.*?)<\/desc>/)?.[1];
  assert.equal(desc?.split('; ').length,6);assert.match(desc,/set: R\$\s50,00/);assert.match(desc,/out: R\$\s100,00/);
  assert.match(html,/&lt;script&gt;unsafe&lt;\/script&gt;/);assert.doesNotMatch(html,/<script>unsafe/);
  assert.match(html,/Inclui rascunhos de consulta. Não indica procedimentos concluídos/);
});
