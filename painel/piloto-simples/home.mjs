import {dateKey} from './domain.mjs';
import {financeReport} from './finance-domain.mjs';
import {getClinicAlerts} from './clinic-domain.mjs';
import {renderGoalCard,renderClinicAlerts} from './clinic-ui.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const currency=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const money=cents=>currency.format(cents/100);
const shortDate=value=>new Date(value+'T12:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});
const patientName=(state,id)=>state.patients.find(patient=>patient.id===id)?.name||'Cadastro indisponível';
const icons={arrow:'<path d="M4 10h12M11 5l5 5-5 5"/>',calendar:'<rect x="3" y="5" width="14" height="12" rx="2"/><path d="M6 3v4m8-4v4M3 10h14"/>',plus:'<path d="M10 4v12M4 10h12"/>',target:'<circle cx="10" cy="10" r="7"/><circle cx="10" cy="10" r="3"/>',people:'<circle cx="7" cy="7" r="3"/><path d="M2 17c0-6 10-6 10 0m2-13a3 3 0 0 1 0 6m1 3c2 0 3 2 3 4"/>',wallet:'<rect x="2" y="5" width="16" height="12" rx="2"/><path d="M2 9h16m-5 4h2"/>'};
const icon=name=>`<svg viewBox="0 0 20 20" aria-hidden="true">${icons[name]||icons.arrow}</svg>`;

export function homeData(state,now=new Date()){
  const today=dateKey(now),month=today.slice(0,7),clock=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
  const financial=financeReport({...state},month);
  const series=Array.from({length:6},(_,i)=>{const day=new Date(now.getFullYear(),now.getMonth()-5+i,1),key=dateKey(day).slice(0,7),report=financeReport({...state},key);return{key,label:day.toLocaleDateString('pt-BR',{month:'short'}).replace('.',''),total:report.billed,received:report.received,grossReceived:report.grossReceived,reversed:report.reversed};});
  const groups=new Map();for(const visit of state.visits){const name=visit.service||'Atendimento sem nome';groups.set(name,(groups.get(name)||0)+1);}
  return{
    today,month,series,
    billedMonth:financial.billed,
    receivedMonth:financial.received,grossReceivedMonth:financial.grossReceived,reversedMonth:financial.reversed,
    outstanding:financial.outstanding,
    todayCount:state.appointments.filter(item=>item.date===today&&item.status!=='cancelado').length,
    patientCount:state.patients.length,
    upcoming:state.appointments.filter(item=>['agendado','confirmado'].includes(item.status)&&(item.date>today||item.date===today&&item.time>=clock)).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time)).slice(0,4),
    procedures:[...groups].map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,'pt-BR')).slice(0,5),
    recent:state.visits.slice().reverse().sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5)
  };
}

function revenueChart(series){
  const max=Math.max(...series.map(item=>item.total),100),top=Math.ceil(max/10000)*10000;
  const chart={left:46,right:330,top:20,bottom:158};
  const slot=(chart.right-chart.left)/series.length,barWidth=25;
  const amount=value=>value>=100000?'R$ '+(value/100000).toLocaleString('pt-BR',{maximumFractionDigits:1})+' mil':'R$ '+(value/100).toLocaleString('pt-BR',{maximumFractionDigits:0});
  return `<svg class="sp-revenue-chart" viewBox="0 0 350 194" role="img" aria-label="Gráfico de barras de cobranças mensais nos últimos seis meses"><title>Cobranças mensais do piloto</title><desc>${esc(series.map(item=>item.label+': '+money(item.total)).join('; '))}</desc>${[0,.5,1].map(fraction=>{const y=chart.bottom-fraction*(chart.bottom-chart.top);return `<line x1="46" y1="${y}" x2="330" y2="${y}" class="sp-chart-grid"/><text x="39" y="${y+4}" text-anchor="end" class="sp-chart-label">${esc(amount(top*fraction))}</text>`;}).join('')}${series.map((item,index)=>{const center=chart.left+(index+.5)*slot,x=center-barWidth/2,height=item.total/top*(chart.bottom-chart.top),y=chart.bottom-height,radius=Math.min(5,height/2);return `${height>0?`<path class="sp-chart-bar" d="M${x},${chart.bottom} V${y+radius} Q${x},${y} ${x+radius},${y} H${x+barWidth-radius} Q${x+barWidth},${y} ${x+barWidth},${y+radius} V${chart.bottom} Z"><title>${esc(item.label+': '+money(item.total))}</title></path>`:''}<text x="${center}" y="184" text-anchor="middle" class="sp-chart-label">${esc(item.label)}</text>`;}).join('')}</svg>`;
}

function upcomingRows(state,items){
  return items.length?items.map(item=>`<article class="sp-next-row"><div class="sp-next-time"><strong>${esc(item.time)}</strong><span>${shortDate(item.date)}</span></div><div class="sp-next-person"><strong>${esc(patientName(state,item.patientId))}</strong><span>${esc(item.service)}</span><small>${item.status==='confirmado'?'Confirmado':'A confirmar'} · ${item.duration} min</small></div><button type="button" class="sp-open-button" data-action="attend" data-id="${esc(item.id)}" aria-label="Abrir atendimento de ${esc(patientName(state,item.patientId))}">${icon('arrow')}</button></article>`).join(''):'<div class="sp-empty">Nenhum próximo horário agendado.<br><a href="#agenda">Abrir a agenda</a></div>';
}
function recentRows(state,items){
  const statuses={rascunho:'Rascunho local',concluido:'Concluído',cancelado:'Cancelado'};
  return items.map(visit=>{const bills=state.bills.filter(bill=>(bill.visitId===visit.id||bill.id===visit.billId)&&!bill.cancelledAt),total=bills.reduce((sum,bill)=>sum+bill.total,0),packageBill=bills.some(bill=>bill.quoteId);return `<tr><td><strong>${esc(patientName(state,visit.patientId))}</strong></td><td>${esc(visit.service)}</td><td>${shortDate(visit.date)}</td><td class="amount">${bills.length?money(total)+(packageBill?'<small>Total do orçamento vinculado</small>':''):'Sem cobrança vinculada'}</td><td><span class="sp-record-status">${esc(statuses[visit.status]||visit.status)}</span></td><td><a class="sp-table-open" href="#paciente/${encodeURIComponent(visit.patientId)}/${encodeURIComponent(visit.id)}/registro">Abrir ${icon('arrow')}</a></td></tr>`;}).join('');
}

export function renderHome(state,now=new Date()){
  const data=homeData(state,now),hour=now.getHours(),greeting=hour<12?'Bom dia':hour<18?'Boa tarde':'Boa noite';
  const monthLabel=now.toLocaleDateString('pt-BR',{month:'long',year:'numeric'}),topProcedure=Math.max(...data.procedures.map(item=>item.count),1);
  const metrics=[{label:'Recebido líquido · mês',value:money(data.receivedMonth),icon:'wallet'},{label:'A receber · total',value:money(data.outstanding),icon:'wallet'},{label:'Na agenda hoje',value:data.todayCount,icon:'calendar'},{label:'Pacientes cadastradas',value:data.patientCount,icon:'people'}];
  const alerts=getClinicAlerts(state,now),alertPanel=alerts.length?`<details class="sp-home-card clinic-section" data-clinic-section="Avisos do início"><summary><span><strong>${alerts.length} aviso(s) interno(s)</strong><small>Retornos e horários próximos. Sem envio de mensagens.</small></span><span aria-hidden="true" class="clinic-disclosure">＋</span></summary><div class="clinic-section-body">${renderClinicAlerts(state,now)}</div></details>`:'';
  return `<div class="sp-home"><div class="sp-overview"><section class="sp-hero"><div class="sp-hero-heading"><div><p class="sp-hero-date">${esc(now.toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'long'}))}</p><h1>${greeting}, Ana Maria Jacob.</h1><p>Seu atendimento e sua gestão, no mesmo lugar.</p></div><span class="sp-hero-symbol" aria-hidden="true">${icon('calendar')}</span></div><div class="sp-hero-body"><div><span class="sp-hero-value-label">Faturamento de ${esc(monthLabel)}</span><strong class="sp-hero-value amount">${money(data.billedMonth)}</strong><small>Valor cobrado nos registros locais do piloto</small></div><div class="sp-hero-actions"><a class="sp-hero-primary" href="#agenda">${icon('calendar')} Abrir agenda</a><button type="button" class="sp-hero-secondary" data-action="new-appointment" aria-label="Novo atendimento — agendar horário">${icon('plus')} Novo atendimento</button></div></div><div class="sp-hero-metrics">${metrics.map(metric=>`<div><span class="sp-mini-label">${icon(metric.icon)}${metric.label}</span><strong class="amount">${metric.value}</strong></div>`).join('')}</div></section>${renderGoalCard(state,{month:data.month})}</div><div class="sp-home-grid"><section class="sp-home-card sp-next"><div class="sp-card-title"><div><h2>Próximos horários</h2><p>Agenda registrada neste navegador</p></div><a href="#agenda">Ver agenda ${icon('arrow')}</a></div><div class="sp-next-list">${upcomingRows(state,data.upcoming)}</div></section><section class="sp-home-card sp-revenue"><div class="sp-card-title"><div><h2>Faturamento</h2><p>Cobranças · últimos seis meses</p></div><span class="sp-card-icon">${icon('wallet')}</span></div><div class="sp-revenue-total"><strong class="amount">${money(data.billedMonth)}</strong><span>neste mês</span></div>${revenueChart(data.series)}<a class="sp-card-footer" href="#financeiro">Abrir financeiro ${icon('arrow')}</a></section><section class="sp-home-card sp-procedures"><div class="sp-card-title"><div><h2>Procedimentos</h2><p>Registros por atendimento</p></div></div><ol class="sp-procedure-list">${data.procedures.map((item,index)=>`<li><div><span class="sp-procedure-rank">${index+1}</span><strong>${esc(item.name)}</strong><span class="sp-procedure-count">${item.count}</span></div><span class="sp-procedure-track"><span style="width:${item.count/topProcedure*100}%"></span></span></li>`).join('')}</ol>${data.procedures.length?'':'<div class="sp-empty">As consultas cadastradas aparecerão aqui.</div>'}<p class="sp-procedure-note">Inclui rascunhos de consulta. Não indica procedimentos concluídos.</p></section></div>${alertPanel}<section class="sp-home-card sp-recent"><div class="sp-card-title"><div><h2>Últimos atendimentos</h2><p>Consultas do piloto, com a situação de cada registro</p></div><a href="#pacientes">Ver prontuários ${icon('arrow')}</a></div><div class="table-wrap"><table><thead><tr><th>Paciente</th><th>Atendimento</th><th>Data</th><th>Valor cobrado</th><th>Situação</th><th></th></tr></thead><tbody>${recentRows(state,data.recent)}</tbody></table></div>${data.recent.length?'':'<div class="sp-empty">Nenhuma consulta cadastrada.</div>'}</section><p class="sp-home-footnote">Dados locais de demonstração. Recebido líquido desconta estornos do mês. Cobranças canceladas ficam fora dos valores; nenhuma medida acima representa lucro.</p></div>`;
}
