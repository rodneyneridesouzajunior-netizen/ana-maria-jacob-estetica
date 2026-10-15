import {isConnected} from './runtime-store.mjs';
import {dateKey} from './domain.mjs';
import {financeReport} from './finance-domain.mjs';
import {getClinicAlerts} from './clinic-domain.mjs';
import {renderGoalCard,renderClinicAlerts} from './clinic-ui.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const currency=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const money=cents=>currency.format(cents/100);
const shortDate=value=>new Date(value+'T12:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});
const patientName=(state,id)=>state.patients.find(patient=>patient.id===id)?.name||'Cadastro indisponível';
const icons={arrow:'<path d="M4 10h12M11 5l5 5-5 5"/>',calendar:'<rect x="3" y="5" width="14" height="12" rx="2"/><path d="M6 3v4m8-4v4M3 10h14m3 3h2"/>',plus:'<path d="M10 4v12M4 10h12"/>',target:'<circle cx="10" cy="10" r="7"/><circle cx="10" cy="10" r="3"/><path d="M10 10l6-6m-3 0h3v3"/>',people:'<circle cx="7" cy="7" r="3"/><path d="M2 17c0-6 10-6 10 0m2-13a3 3 0 0 1 0 6m1 3c2 0 3 2 3 4"/>',wallet:'<rect x="2" y="5" width="16" height="12" rx="2"/><path d="M2 9h16m-5 4h2"/>',check:'<path d="M4 10l4 4 8-8"/>',document:'<path d="M5 2h7l4 4v12H5zM12 2v5h4M8 10h5m-5 3h5"/>'};
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

// Alias compatível para consumidores que usam o nome descritivo do seletor.
export const getHomeData=homeData;

function revenueChart(series){
  const max=Math.max(...series.map(item=>item.total),100),top=Math.ceil(max/10000)*10000;
  const chart={left:66,right:424,top:24,bottom:173};
  const slot=(chart.right-chart.left)/series.length,barWidth=30;
  const amount=value=>value>=100000?'R$ '+(value/100000).toLocaleString('pt-BR',{maximumFractionDigits:1})+' mil':'R$ '+(value/100).toLocaleString('pt-BR',{maximumFractionDigits:0});
  return `<svg class="sp-revenue-chart" viewBox="0 0 448 211" role="img" aria-label="Gráfico de barras de cobranças mensais nos últimos seis meses"><title>Cobranças mensais do piloto</title><desc>${esc(series.map(item=>item.label+': '+money(item.total)).join('; '))}</desc><defs><linearGradient id="sp-revenue-fill" x1="0" x2="1"><stop offset="0" stop-color="#b85c7a"/><stop offset="1" stop-color="#86334e"/></linearGradient></defs>${[0,.5,1].map(fraction=>{const y=chart.bottom-fraction*(chart.bottom-chart.top);return `<line x1="66" y1="${y}" x2="427" y2="${y}" class="sp-chart-grid"/><text x="55" y="${y+4}" text-anchor="end" class="sp-chart-label">${esc(amount(top*fraction))}</text>`;}).join('')}${series.map((item,index)=>{const center=chart.left+(index+.5)*slot,x=center-barWidth/2,height=item.total/top*(chart.bottom-chart.top),y=chart.bottom-height,radius=Math.min(5,height/2),depth=Math.min(5,height/3);return `${height>0?`<g><path class="sp-chart-side" d="M${x+barWidth} ${y+radius}l${depth} -${depth}v${height-radius}l-${depth} ${depth}z"/><path class="sp-chart-bar" d="M${x},${chart.bottom} V${y+radius} Q${x},${y} ${x+radius},${y} H${x+barWidth-radius} Q${x+barWidth},${y} ${x+barWidth},${y+radius} V${chart.bottom} Z"><title>${esc(item.label+': '+money(item.total))}</title></path></g>`:''}<text x="${center}" y="202" text-anchor="middle" class="sp-chart-label">${esc(item.label)}</text>`;}).join('')}</svg>`;
}

function serviceTone(service){
  const text=String(service||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
  return /\bavalia/.test(text)?'avaliacao':/\bretorno\b/.test(text)?'retorno':'procedimento';
}
const statusText={rascunho:'Rascunho',concluido:'Concluído',cancelado:'Cancelado'};
const statusTone=status=>status==='concluido'?'complete':status==='cancelado'?'cancelled':'draft';

function upcomingRows(state,items){
  return items.length?items.map((item,index)=>`<article class="sp-next-row ${index===0?'sp-next-first':''}" data-service-tone="${serviceTone(item.service)}"><div class="sp-next-time"><strong>${esc(item.time)}</strong><span>${shortDate(item.date)}</span></div><div class="sp-next-person"><strong>${esc(patientName(state,item.patientId))}</strong><span>${esc(item.service)}</span><small><i aria-hidden="true"></i>${item.status==='confirmado'?'Confirmado':'A confirmar'} · ${esc(item.duration)} min</small></div><button type="button" class="sp-open-button" data-action="attend" data-id="${esc(item.id)}" aria-label="Abrir atendimento de ${esc(patientName(state,item.patientId))}">${icon('arrow')}</button></article>`).join(''):`<div class="sp-empty"><span class="sp-empty-symbol" aria-hidden="true">${icon('calendar')}</span><strong>Seu próximo horário começa aqui.</strong><p>Nenhum atendimento futuro agendado.</p><button type="button" data-action="new-appointment" class="sp-inline-action">Agendar atendimento ${icon('arrow')}</button></div>`;
}
function recentRows(state,items){
  return items.map(visit=>{const bills=state.bills.filter(bill=>(bill.visitId===visit.id||bill.id===visit.billId)&&!bill.cancelledAt),total=bills.reduce((sum,bill)=>sum+bill.total,0),packageBill=bills.some(bill=>bill.quoteId);return `<tr><td><strong>${esc(patientName(state,visit.patientId))}</strong></td><td><span class="sp-service-name" data-service-tone="${serviceTone(visit.service)}">${esc(visit.service)}</span></td><td>${shortDate(visit.date)}</td><td class="amount">${bills.length?money(total)+(packageBill?'<small>Total do orçamento vinculado</small>':''):'Sem cobrança vinculada'}</td><td><span class="sp-record-status" data-status-tone="${statusTone(visit.status)}">${esc(statusText[visit.status]||visit.status)}</span></td><td><a class="sp-table-open" href="#paciente/${encodeURIComponent(visit.patientId)}/${encodeURIComponent(visit.id)}/registro" aria-label="Abrir consulta de ${esc(patientName(state,visit.patientId))}, ${shortDate(visit.date)}">Abrir ${icon('arrow')}</a></td></tr>`;}).join('');
}

export function renderHome(state,now=new Date()){
  const data=homeData(state,now),hour=now.getHours(),greeting=hour<12?'Bom dia':hour<18?'Boa tarde':'Boa noite';
  const monthLabel=now.toLocaleDateString('pt-BR',{month:'long',year:'numeric'}),topProcedure=Math.max(...data.procedures.map(item=>item.count),1);
  const metrics=[{label:'Recebido líquido · mês',value:money(data.receivedMonth),icon:'wallet'},{label:'A receber · total',value:money(data.outstanding),icon:'wallet'},{label:'Na agenda hoje',value:data.todayCount,icon:'calendar'},{label:'Pacientes cadastradas',value:data.patientCount,icon:'people'}];
  const alerts=getClinicAlerts(state,now),alertPanel=alerts.length?`<details class="sp-home-card clinic-section" data-clinic-section="Avisos do início"><summary><span><strong>${alerts.length} aviso(s) interno(s)</strong><small>Retornos e horários próximos. Sem envio de mensagens.</small></span><span aria-hidden="true" class="clinic-disclosure">＋</span></summary><div class="clinic-section-body">${renderClinicAlerts(state,now)}</div></details>`:'';
  return `<div class="sp-home sp-home-depth">
    <div class="sp-overview">
      <section class="sp-hero" aria-labelledby="sp-home-title">
        <div class="sp-hero-heading"><div><p class="sp-hero-date">${icon('calendar')}${esc(now.toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'long'}))}</p><h1 id="sp-home-title">${greeting}, Ana Maria Jacob.</h1><p>Seu atendimento e sua gestão, no mesmo lugar.</p></div><div class="sp-hero-actions"><a class="sp-hero-primary" href="#agenda">${icon('calendar')} Abrir agenda</a><button type="button" class="sp-hero-secondary" data-action="new-appointment">${icon('plus')} Agendar atendimento</button></div></div>
        <div class="sp-hero-body"><div class="sp-billed"><span class="sp-hero-value-label">Faturamento de ${esc(monthLabel)}</span><strong class="sp-hero-value amount">${money(data.billedMonth)}</strong><small>Valor cobrado nos registros locais</small></div><div class="sp-hero-metrics">${metrics.map(metric=>`<div><span class="sp-mini-label">${icon(metric.icon)}${metric.label}</span><strong class="amount">${metric.value}</strong></div>`).join('')}</div></div>
      </section>
      <div class="sp-goal-wrap"><div class="sp-goal-art" aria-hidden="true"><span class="sp-goal-floor"></span><span class="sp-goal-orbit"></span><span class="sp-goal-medal">${icon('target')}</span></div>${renderGoalCard(state,{month:data.month})}</div>
    </div>
    <div class="sp-home-grid">
      <section class="sp-home-card sp-next"><div class="sp-card-title"><div><span class="sp-section-kicker">Sua agenda</span><h2>Próximos horários</h2></div><a href="#agenda" aria-label="Ver a agenda completa">Ver agenda ${icon('arrow')}</a></div><div class="sp-next-list">${upcomingRows(state,data.upcoming)}</div><a class="sp-card-footer" href="#agenda">Horários livres e retornos ${icon('arrow')}</a></section>
      <section class="sp-home-card sp-revenue"><div class="sp-card-title"><div><span class="sp-section-kicker">Visão financeira</span><h2>Faturamento</h2><p>Cobranças · últimos seis meses</p></div><span class="sp-card-icon" aria-hidden="true">${icon('wallet')}</span></div><div class="sp-revenue-total"><strong class="amount">${money(data.billedMonth)}</strong><span>neste mês</span></div>${revenueChart(data.series)}<a class="sp-card-footer" href="#financeiro">Recebimentos e despesas ${icon('arrow')}</a></section>
      <section class="sp-home-card sp-procedures"><div class="sp-card-title"><div><span class="sp-section-kicker">Visão dos registros</span><h2>Procedimentos</h2></div><span class="sp-card-icon sp-card-icon-gold" aria-hidden="true">${icon('document')}</span></div><ol class="sp-procedure-list">${data.procedures.map((item,index)=>`<li><div><span class="sp-procedure-rank">${index+1}</span><strong>${esc(item.name)}</strong><span class="sp-procedure-count">${item.count}</span></div><span class="sp-procedure-track" aria-hidden="true"><span style="width:${item.count/topProcedure*100}%"></span></span></li>`).join('')}</ol>${data.procedures.length?'':`<div class="sp-empty"><strong>Seus registros aparecerão aqui.</strong><p>Cadastre a paciente e abra sua primeira consulta.</p><a class="sp-inline-action" href="#pacientes">Abrir prontuários ${icon('arrow')}</a></div>`}<p class="sp-procedure-note">Inclui rascunhos de consulta. Não indica procedimentos concluídos.</p><a class="sp-card-footer" href="#catalogo">Consultar catálogo ${icon('arrow')}</a></section>
    </div>
    ${alertPanel}
    <section class="sp-home-card sp-recent"><div class="sp-card-title"><div><span class="sp-section-kicker">Continue de onde parou</span><h2>Últimos atendimentos</h2><p>Situação de cada consulta e sua cobrança vinculada</p></div><a href="#pacientes">Ver prontuários ${icon('arrow')}</a></div>${data.recent.length?`<div class="table-wrap" role="region" aria-label="Últimos atendimentos; role horizontalmente em telas pequenas" tabindex="0"><table><thead><tr><th scope="col">Paciente</th><th scope="col">Atendimento</th><th scope="col">Data</th><th scope="col">Valor cobrado</th><th scope="col">Situação</th><th scope="col"><span class="sp-sr-only">Abrir consulta</span></th></tr></thead><tbody>${recentRows(state,data.recent)}</tbody></table></div>`:`<div class="sp-empty"><strong>Nenhuma consulta cadastrada.</strong><p>Comece pelo cadastro da paciente para manter tudo no mesmo prontuário.</p><button type="button" data-action="new-patient" class="sp-inline-action">Cadastrar paciente ${icon('plus')}</button></div>`}</section>
    <p class="sp-home-footnote">${isConnected()?'Dados de homologação salvos no servidor.':'Dados locais de demonstração.'} Recebido líquido desconta estornos do mês. Cobranças canceladas ficam fora dos valores; nenhuma medida acima representa lucro.</p>
  </div>`;
}
