import {patientColor} from './patients-domain.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// The existing hash router keeps colons in legacy identifiers. Other URL syntax
// must remain encoded so stored text cannot introduce a new route or attribute.
const routePart=value=>encodeURIComponent(String(value??'')).replace(/%3A/gi,':');
const list=value=>Array.isArray(value)?value:[];
const finiteDate=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const civilDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')&&finiteDate(value+'T12:00:00Z')&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
const dateLabel=value=>civilDate(value)?value.split('-').reverse().join('/'):'Data não informada';
const money=value=>Number.isSafeInteger(value)&&value>=0?new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(value/100):null;
const timestampLabel=value=>new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}).format(new Date(value));
const visitLink=(patientId,visitId,tab='registro')=>`#paciente/${routePart(patientId)}/${routePart(visitId)}/${tab}`;
const initials=name=>String(name||'').trim().split(/\s+/).filter(Boolean).filter(word=>!['·','—','-'].includes(word)).slice(0,2).map(word=>[...word][0]||'').join('').toLocaleUpperCase('pt-BR')||'?';
const visitDateSort=(a,b)=>String(b.date||'').localeCompare(String(a.date||''))||String(b.createdAt||'').localeCompare(String(a.createdAt||''))||String(a.id).localeCompare(String(b.id));
const visitStatus=visit=>visit.cancelledAt||visit.status==='cancelado'?'cancelado':visit.status==='concluido'?'concluido':visit.lockedAt?'bloqueado':['rascunho','em_atendimento'].includes(visit.status)?'em_atendimento':'desconhecido';
const labels={em_atendimento:'Em andamento',concluido:'Concluído',cancelado:'Cancelado',agendado:'Agendado',confirmado:'Confirmado',bloqueado:'Registro bloqueado',desconhecido:'Situação não informada'};
const badge=status=>`<span class="pr-badge" data-status="${esc(status)}">${esc(labels[status]||labels.desconhecido)}</span>`;
const actionLink=(href,label,primary=false)=>`<a class="pr-button ${primary?'pr-button-primary':'pr-button-secondary'}" href="${esc(href)}">${esc(label)}</a>`;

function latestUpdate(state,patient,visits){
  const visitIds=new Set(visits.map(v=>v.id)),values=[patient.updatedAt,patient.createdAt];
  for(const visit of visits)values.push(visit.updatedAt,visit.createdAt,visit.completedAt,visit.cancelledAt,...list(visit.addenda).map(a=>a.createdAt));
  for(const entry of list(state.patientHistory))if(entry.patientId===patient.id)values.push(entry.at);
  for(const doc of list(state.documentResponses))if(doc.patientId===patient.id&&visitIds.has(doc.visitId))values.push(doc.updatedAt,doc.createdAt,doc.signature?.signedAt);
  return values.filter(finiteDate).sort((a,b)=>Date.parse(b)-Date.parse(a))[0]||null;
}
function addressLabel(patient){
  const street=[patient.address,patient.addressNumber].filter(Boolean).join(', '),city=[patient.city,patient.state].filter(Boolean).join(' / '),postal=patient.postalCode?`CEP ${patient.postalCode}`:'';
  return [street,patient.complement,patient.neighborhood,city,postal].filter(Boolean).join(' · ')||'Não informado';
}
function informationCard(patient){
  const cpf=String(patient.cpf||'').replace(/\D/g,''),cpfLabel=cpf.length===11?cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,'$1.$2.$3-$4'):patient.cpf||'Não informado';
  const fields=[['CPF',cpfLabel],['Telefone',patient.phone||'Não informado'],['E-mail',patient.email||'Não informado'],['Nascimento',patient.birthDate?dateLabel(patient.birthDate):'Não informado'],['Endereço',addressLabel(patient)],['Observações',patient.notes||'Nenhuma observação cadastrada.']];
  return `<section class="pr-card pr-info" aria-labelledby="pr-info-title"><h2 id="pr-info-title">Informações</h2><dl class="pr-info-list">${fields.map(([label,value])=>`<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl></section>`;
}
function anamnesisCard(state,patient,latestVisit,connected){
  // The workspace contains prepared drafts and demonstration signatures only.
  // Official links are read by the clinical-document service, outside this state.
  // Never turn a local response or visit completion into an official signature.
  const responses=latestVisit?list(state.documentResponses).filter(d=>d.patientId===patient.id&&d.visitId===latestVisit.id&&d.kind==='anamnese'):[];
  const drafts=responses.filter(d=>d.status==='rascunho').length,demos=responses.filter(d=>d.status==='assinado_demo').length;
  let status='Sem ficha preparada',detail=latestVisit?'Nenhuma ficha de anamnese preparada neste atendimento.':'Abra um atendimento para preparar a ficha de anamnese.',tone='pending';
  if(drafts){status=drafts===1?'Ficha em rascunho':`${drafts} fichas em rascunho`;detail='Preenchimento registrado; assinatura oficial não confirmada por este resumo.';}
  else if(demos){status='Registro de demonstração';detail=`${demos} ficha(s) com assinatura de demonstração. Não indica assinatura oficial.`;tone='demo';}
  else if(responses.length){status='Conferir documento';detail='O documento requer conferência no atendimento.';}
  if(connected)detail+=' Consulte o recebimento e a assinatura dos originais na área de documentos do atendimento.';
  const href=latestVisit?visitLink(patient.id,latestVisit.id,'documentos'):connected?'#originais':'#documentos';
  return `<section class="pr-card pr-anamnesis" aria-labelledby="pr-anamnesis-title"><h2 id="pr-anamnesis-title">Anamnese</h2><span class="pr-badge" data-status="${tone}">${esc(status)}</span><p class="pr-note">${esc(detail)}</p>${latestVisit?`<p class="pr-note">Atendimento: ${esc(latestVisit.service||latestVisit.procedureSnapshot?.name||'Sem título')} · ${dateLabel(latestVisit.date)}</p>`:''}<div class="pr-actions">${actionLink(href,latestVisit?'Documentos do atendimento':'Abrir documentos')}</div></section>`;
}
function returnsSection(state,patientId,visits){
  const returns=list(state.expectedReturns).filter(r=>r.patientId===patientId&&['previsto','agendado'].includes(r.status)&&civilDate(r.date)&&visits.some(v=>v.id===(r.sourceVisitId||r.visitId))).slice().sort((a,b)=>a.date.localeCompare(b.date));
  return `<section class="pr-returns" aria-labelledby="pr-returns-title"><h2 id="pr-returns-title">Retornos previstos</h2>${returns.map(item=>{const visit=visits.find(v=>v.id===(item.sourceVisitId||item.visitId)),appointment=list(state.appointments).find(a=>a.id===item.appointmentId&&a.patientId===patientId),scheduled=item.status==='agendado'&&appointment&&appointment.status!=='cancelado';return `<article class="pr-card pr-return-card"><h3>Retorno em ${dateLabel(item.date)}</h3><span class="pr-badge" data-status="${scheduled?'agendado':'previsto'}">${scheduled?'Agendado':'Previsto'}</span><p>${esc(visit.service||visit.procedureSnapshot?.name||'Atendimento')} · ${dateLabel(visit.date)}</p>${scheduled?`<p>Horário: ${esc(appointment.time||'Não informado')}</p>`:''}<div class="pr-actions">${actionLink('#agenda','Ver na agenda')}</div></article>`;}).join('')||'<div class="pr-card"><p class="pr-empty">Nenhum retorno previsto registrado.</p></div>'}</section>`;
}
function financialDetail(state,visit){
  const bills=list(state.bills).filter(b=>b.patientId===visit.patientId&&!b.cancelledAt&&(b.id===visit.billId||b.visitId===visit.id));
  if(bills.length!==1)return bills.length>1?'<p class="pr-note">Mais de uma cobrança vinculada. Confira o Financeiro.</p>':'';
  const bill=bills[0],formatted=money(bill.total);if(formatted===null)return '';
  return `<p class="pr-visit-value"><span>${bill.quoteId?'Total do orçamento vinculado':'Valor da cobrança'}</span><strong>${esc(formatted)}</strong></p>`;
}
function visitCard(state,patient,visit){
  const status=visitStatus(visit),ongoing=status==='em_atendimento',photos=list(visit.photos),documents=list(state.documentResponses).filter(d=>d.patientId===patient.id&&d.visitId===visit.id),professional=list(state.clinic?.professionals).find(p=>p.id===visit.professionalId);
  const metadata=[dateLabel(visit.date),`${photos.length} fotografia(s)`,`${documents.length} documento(s) preparado(s)`];if(professional?.name)metadata.push(professional.name);
  return `<article class="pr-card pr-visit-card ${ongoing?'pr-visit-active':''}" data-visit-id="${esc(visit.id)}"><header class="pr-visit-heading"><div><p class="pr-eyebrow">Atendimento</p><h3>${esc(visit.service||visit.procedureSnapshot?.name||'Atendimento sem título')}</h3></div>${badge(status)}</header><p class="pr-visit-meta">${metadata.map(esc).join(' · ')}</p>${financialDetail(state,visit)}<div class="pr-actions">${ongoing?actionLink(visitLink(patient.id,visit.id),'Continuar atendimento',true)+actionLink(visitLink(patient.id,visit.id,'mapa'),'Marcar rosto'):''}${actionLink(visitLink(patient.id,visit.id,'documentos'),'Documentos')}${actionLink(visitLink(patient.id,visit.id,'resumo'),'Ver prontuário')}</div></article>`;
}
function appointmentsSection(state,patient,visits){
  const linkedIds=new Set(visits.map(v=>v.appointmentId).filter(Boolean)),appointments=list(state.appointments).filter(a=>a.patientId===patient.id&&!linkedIds.has(a.id)).slice().sort(visitDateSort);
  if(!appointments.length)return '';
  return `<section class="pr-visit-group" aria-labelledby="pr-scheduled-title"><h3 id="pr-scheduled-title">Agendamentos</h3><div class="pr-visit-list">${appointments.map(a=>{const status=a.cancelledAt?'cancelado':Object.hasOwn(labels,a.status)?a.status:'desconhecido';return `<article class="pr-card pr-visit-card pr-visit-scheduled" data-appointment-id="${esc(a.id)}"><header class="pr-visit-heading"><div><p class="pr-eyebrow">Agenda</p><h3>${esc(a.service||'Agendamento sem título')}</h3></div>${badge(status)}</header><p class="pr-visit-meta">${dateLabel(a.date)}${a.time?' · '+esc(a.time):''}${Number.isInteger(a.duration)?' · '+a.duration+' minutos':''}</p><p class="pr-note">Sem prontuário de atendimento vinculado.</p><div class="pr-actions">${actionLink('#agenda','Ver na agenda')}</div></article>`;}).join('')}</div></section>`;
}

/** Pure presentation: no state writes, persistence or inferred clinical approval.
 * comparisonHtml must be trusted HTML returned by renderComparisonLibrary(),
 * never a field or HTML supplied by a patient. The caller mounts its controller
 * inside #comparison-panel and handles the existing data-action buttons.
 */
export function renderPatientRecordOverview(state,{patientId,connected=false,comparisonHtml=''}={}){
  const patient=list(state.patients).find(p=>p.id===patientId);
  if(!patient)return '<section class="pr-page"><a class="pr-back" href="#pacientes">← Prontuários</a><p class="pr-empty" role="status">Paciente não encontrada.</p></section>';
  const visits=list(state.visits).filter(v=>v.patientId===patientId).slice().sort(visitDateSort),ongoing=visits.filter(v=>visitStatus(v)==='em_atendimento'),others=visits.filter(v=>visitStatus(v)!=='em_atendimento'),latestVisit=visits.find(v=>visitStatus(v)!=='cancelado')||visits[0],updated=latestUpdate(state,patient,visits);
  const profile=`<section class="pr-card pr-profile" data-patient-color="${patientColor(patient)}"><div class="pr-profile-header"><span class="pr-avatar" data-patient-color="${patientColor(patient)}" aria-hidden="true">${esc(initials(patient.name))}</span><div class="pr-identity"><p class="pr-eyebrow">Prontuário</p><h1 class="pr-name">${esc(patient.name)}</h1></div></div><p class="pr-last-procedure"><span>Último atendimento</span><strong>${esc(latestVisit?.service||latestVisit?.procedureSnapshot?.name||'Nenhum atendimento registrado')}</strong></p><p class="pr-updated">${updated?'Atualizado em '+esc(timestampLabel(updated)):'Data de atualização não registrada'}</p><div class="pr-stats" aria-label="Resumo de atendimentos"><div class="pr-stat"><strong>${visits.length}</strong><span>atendimento(s)</span></div><div class="pr-stat"><strong>${ongoing.length}</strong><span>em andamento</span></div></div><div class="pr-actions">${actionLink('#orcamentos','Orçamentos')}<button class="pr-button pr-button-secondary" type="button" data-action="edit-patient" data-id="${esc(patient.id)}">Editar paciente</button></div><p class="pr-note">Orçamentos abre a lista geral da clínica.</p></section>`;
  return `<section class="pr-page" aria-label="Resumo do prontuário"><a class="pr-back" href="#pacientes">← Prontuários</a><div class="pr-layout"><aside class="pr-sidebar" aria-label="Informações da paciente">${profile}${returnsSection(state,patient.id,visits)}${anamnesisCard(state,patient,latestVisit,connected)}${informationCard(patient)}</aside><div class="pr-main"><section class="pr-card pr-comparison" aria-labelledby="pr-comparison-title"><header class="pr-section-heading"><div><h2 id="pr-comparison-title">Antes e depois</h2><p>Compare as fotografias registradas e acompanhe o histórico visual.</p></div>${actionLink('#paciente/'+routePart(patient.id)+'/comparacoes','Abrir comparações')}</header><div id="comparison-panel">${comparisonHtml||'<p class="pr-empty">Abra as comparações para selecionar as fotografias desta paciente.</p>'}</div></section><section class="pr-visits" aria-labelledby="pr-visits-title"><header class="pr-section-heading"><div><h2 id="pr-visits-title">Atendimentos</h2><p>Registros e documentos organizados por atendimento.</p></div><button class="pr-button pr-button-primary" type="button" data-action="new-visit" data-patient-id="${esc(patient.id)}">Novo atendimento</button></header><section class="pr-visit-group" aria-labelledby="pr-ongoing-title"><h3 id="pr-ongoing-title">Em andamento <span>${ongoing.length}</span></h3><div class="pr-visit-list">${ongoing.map(v=>visitCard(state,patient,v)).join('')||'<div class="pr-card"><p class="pr-empty">Nenhum atendimento em andamento.</p></div>'}</div></section>${others.length?`<section class="pr-visit-group" aria-labelledby="pr-history-title"><h3 id="pr-history-title">Histórico de atendimentos <span>${others.length}</span></h3><div class="pr-visit-list">${others.map(v=>visitCard(state,patient,v)).join('')}</div></section>`:''}${appointmentsSection(state,patient,visits)}</section></div></div></section>`;
}
