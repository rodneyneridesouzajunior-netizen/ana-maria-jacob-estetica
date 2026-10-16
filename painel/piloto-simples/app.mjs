import {load,commit,getPhoto,isConnected,readSnapshot,getClinicId} from './runtime-store.mjs';
import {renderFacialStudy,mountFacialStudy} from './facial-study-ui.mjs';
import {renderPatientRecordOverview} from './patient-record-ui.mjs';
import {renderVisitRecord,mountVisitRecord} from './visit-record-ui.mjs';
import {renderPatientsPage,mountPatientsPage,openPatientEditor} from './patients-ui.mjs';
import {renderComparisonLibrary,mountComparisonLibrary} from './comparison-library.mjs';
import {renderHome} from './home.mjs';
import {renderAgenda,mountAgenda} from './agenda.mjs';
import {createVisit,visitWorkflow,RECORD_MODE_LABELS,APPOINTMENT_TYPES,APPOINTMENT_COLORS,appointmentMetadata} from './visit-workflow.mjs';
import {fittedPhotoSize,MAP_ZOOM_LEVELS} from './map-fit.mjs';
import {areas} from './areas.mjs';
import {assertVisitEditable} from './operations-domain.mjs';
import {renderOperationsPage,renderVisitOperations,mountOperations} from './operations-ui.mjs';
import {scheduleClinicAppointment} from './clinic-domain.mjs';
import {renderClinicPage,renderAgendaSupport,professionalOptions,mountClinic} from './clinic-ui.mjs';
import {renderFinancePage,mountFinance} from './finance-ui.mjs';
import {documentsSatisfied} from './documents-domain.mjs';
import {renderDocumentsPage,mountDocuments} from './documents-ui.mjs';
import {renderClinicalBridge,mountClinicalBridge} from './clinical-bridge-ui.mjs';
import {getClinicalBridge} from './clinical-bridge-runtime.mjs';
import {createSiteBookingService} from './site-booking-service.mjs';
import {mountSiteBooking} from './site-booking-ui.mjs';
import {createClinicalCompletionService} from './clinical-completion-service.mjs';
import {mountClinicalSettings,mountClinicalCompletion} from './clinical-completion-ui.mjs';
import {mountCloudBackup} from './cloud-backup-ui.mjs';
import {savePatient,patientMatches} from './patients-domain.mjs';
import {renderRecoveryPage,mountRecovery} from './recovery-ui.mjs';
import {renderIntegrationPage,mountIntegration} from './integration/ui.mjs';
import {confirmSiteRequest} from './site-domain.mjs';
import {dateKey,cents,appointmentCheck,normalizedPoint,annotationCheck,translateAnnotation,fanRays,DEFAULT_FAN_SPREAD,quantityTotals,billBalance,paymentCheck,financialSummary} from './domain.mjs';
const $=id=>document.getElementById(id), uid=()=>crypto.randomUUID();
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(v/100);
const date=v=>new Date(v+'T12:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'short'});
const icons={hoje:'<path d="M3 10 10 3l7 7v8H3zM7 18v-6h6v6"/>',agenda:'<rect x="3" y="5" width="14" height="13" rx="2"/><path d="M6 2v5M14 2v5M3 10h14"/>',pacientes:'<circle cx="8" cy="7" r="3"/><path d="M2 18c0-7 12-7 12 0M15 4a3 3 0 0 1 0 6M16 12c2 1 2 3 2 5"/>',financeiro:'<rect x="2" y="5" width="16" height="12" rx="2"/><path d="M2 9h16M5 13h3"/>',ajustes:'<circle cx="10" cy="10" r="3"/><path d="M10 1v3M10 16v3M1 10h3M16 10h3M4 4l2 2M14 14l2 2M4 16l2-2M14 6l2-2"/>',plus:'<path d="M10 3v14M3 10h14"/>',arrow:'<path d="M3 10h14M12 5l5 5-5 5"/>',photo:'<rect x="2" y="3" width="16" height="14" rx="2"/><circle cx="7" cy="8" r="2"/><path d="m3 16 5-5 3 3 3-6 4 8"/>',check:'<path d="m3 10 5 5L18 4"/>'};
function serviceTone(service){const normalized=String(service).normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();return /\bavalia/.test(normalized)?'avaliacao':/\bretorno\b/.test(normalized)?'retorno':'procedimento';}
function serviceBadge(service){const tone=serviceTone(service),label={avaliacao:'Avaliação',procedimento:'Atendimento',retorno:'Retorno'}[tone];return `<span class="service-tone" data-service-tone="${tone}"><span class="service-type">${label}</span><span>${esc(service)}</span></span>`;}
const icon=n=>`<svg class="icon" viewBox="0 0 20 20" aria-hidden="true">${icons[n]||icons.arrow}</svg>`;
let state,route='hoje',patientId,visitId,tab='consultas',photoId,selectedId=null,pending=null,dirty=false,busy=false,zoom=1,tool='ponto',agendaDate=dateKey();
let toastTimer,dialogSubmit=null,objectUrls=new Map(),renderSeq=0,drag=null,acceptedHash=location.hash,importing=false,editGeneration=0;
let mapBatchMode=true,mapBatch=null;
const MAX_BATCH_MARKINGS=1000;
const MAP_FORM_FIELDS=['point-region','point-procedure','point-product','point-quantity','point-unit','point-lot','point-notes','map-x','map-y','map-x2','map-y2'];
const comparisonSelections=new Map();
let visitRecordDispose=null;
let comparisonHandle=null,facialHandle=null,patientsHandle=null,patientEditor=null;
let patientView={query:"",filter:"all",color:"all"};
let connectionEnded=false;
const auxiliaryHandles=new Set();
const auxiliaryBusy=()=>[...auxiliaryHandles].some(h=>h.isBusy?.());
const auxiliaryDirty=()=>[...auxiliaryHandles].some(h=>h.isDirty?.());
const auxiliaryUncertain=()=>[...auxiliaryHandles].some(h=>h.hasUncertain?.());
function disposeAuxiliary(){for(const handle of [...auxiliaryHandles])handle.dispose();auxiliaryHandles.clear();}
const editorsBusy=()=>auxiliaryBusy()||facialHandle?.isBusy()||patientsHandle?.isBusy()||patientEditor?.isBusy()||clinicalBridgeHandle?.isBusy();
const editorsDirty=()=>auxiliaryDirty()||facialHandle?.isDirty()||patientsHandle?.isDirty()||patientEditor?.isDirty()||clinicalBridgeHandle?.isDirty();
let mapFitObserver=null,integrationHandle=null,agendaDispose=null,clinicalBridgeHandle=null;
let agendaView={view:"day",query:"",professionalId:"",status:""};
function fitMapPlane(resetScroll=false){
  const stage=$('photo-stage'),plane=$('photo-plane'),image=$('map-photo');
  if(!stage||!plane||!image?.complete)return;
  const fit=fittedPhotoSize(stage.clientWidth,stage.clientHeight,image.naturalWidth,image.naturalHeight,zoom);
  if(!fit)return;
  plane.style.width=fit.width+'px';
  plane.style.height=fit.height+'px';
  if($('zoom-label'))$('zoom-label').textContent=fit.zoom+'×';
  document.querySelectorAll('[data-action="map-zoom"]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.id)===fit.zoom)));
  const zoomOut=document.querySelector('[data-action="zoom-out"]'),zoomIn=document.querySelector('[data-action="zoom-in"]');
  if(zoomOut)zoomOut.disabled=fit.zoom<=MAP_ZOOM_LEVELS[0];
  if(zoomIn)zoomIn.disabled=fit.zoom>=MAP_ZOOM_LEVELS.at(-1);
  if(resetScroll){stage.scrollLeft=0;stage.scrollTop=0;}
}
function setMapZoom(value){
  if(mapGestureActive())return;
  if(!Number.isFinite(value))return;
  const stage=$('photo-stage'),plane=$('photo-plane'),image=$('map-photo');
  if(!stage||!plane||!image?.complete||!image.naturalWidth){toast('Aguarde a fotografia carregar.');return;}
  const before=plane.getBoundingClientRect(),viewport=stage.getBoundingClientRect();
  if(!(before.width>0&&before.height>0))return;
  // Keep the same part of the photograph in view. Zoom never resamples the file
  // or changes its normalized annotations.
  const anchor=normalizedPoint((Math.max(before.left,viewport.left)+Math.min(before.right,viewport.left+stage.clientWidth))/2,(Math.max(before.top,viewport.top)+Math.min(before.bottom,viewport.top+stage.clientHeight))/2,before);
  const screenX=before.left+anchor.x*before.width,screenY=before.top+anchor.y*before.height;
  zoom=Math.max(MAP_ZOOM_LEVELS[0],Math.min(MAP_ZOOM_LEVELS.at(-1),value));fitMapPlane();
  const after=plane.getBoundingClientRect();stage.scrollLeft+=after.left+anchor.x*after.width-screenX;stage.scrollTop+=after.top+anchor.y*after.height-screenY;
}
function fitLoadedMapPhoto(image,url,seq){
  mapFitObserver?.disconnect();mapFitObserver=null;
  const stage=$('photo-stage');
  const current=()=>seq===renderSeq&&image.isConnected;
  image.addEventListener('load',()=>{if(current())fitMapPlane(true);},{once:true});
  image.src=url;
  if(image.complete&&image.naturalWidth&&current())fitMapPlane(true);
  if(typeof ResizeObserver!=='undefined'){
    const observer=new ResizeObserver(()=>{if(current())fitMapPlane();else{observer.disconnect();if(mapFitObserver===observer)mapFitObserver=null;}});
    mapFitObserver=observer;observer.observe(stage);
  }
}
function toast(message,error=false){if(connectionEnded)return;if(isConnected())message=message.replaceAll('no piloto local','no servidor da clínica').replaceAll('no piloto','no servidor').replaceAll('neste navegador','no servidor da clínica');$('toast').textContent=message;$('toast').className='toast visible'+(error?' failure':'');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').className='toast',4500);}
const patient=id=>state?.patients.find(p=>p.id===id);
const visit=()=>state?.visits.find(v=>v.id===visitId&&v.patientId===patientId);
const photo=()=>visit()?.photos.find(p=>p.id===photoId);
const map=()=>visit()?.maps[photoId]||{version:0,points:[],history:[]};
function clean(){if(mapGestureActive()){toast('Termine o ajuste da marcação antes de sair.');return false;}if(auxiliaryUncertain()||clinicalBridgeHandle?.hasUncertain()){toast("Confira a gravação pendente antes de sair desta seleção.",true);return false;}if(editorsBusy()){toast("Aguarde a gravação terminar.");return false;}if(integrationHandle?.isBusy()){toast('Aguarde a operação da área privada terminar.');return false;}if(comparisonHandle?.isBusy()){toast('Aguarde a gravação ou exportação da comparação terminar.');return false;}if(!dirty&&!pending&&!editorsDirty()&&!integrationHandle?.isDirty()&&!comparisonHandle?.isDirty()&&!document.querySelector('form[data-unsaved]'))return true;if(!confirm('Há uma marcação ou edição ainda não salva. Descartar essa edição?'))return false;for(const handle of auxiliaryHandles)if(handle.discard&&!handle.discard())return false;if(clinicalBridgeHandle&&!clinicalBridgeHandle.discard())return false;if(comparisonHandle&&!comparisonHandle.discard())return false;if(facialHandle&&!facialHandle.discard())return false;if(patientsHandle&&!patientsHandle.discard())return false;if(patientEditor&&!patientEditor.discard())return false;dirty=false;pending=null;mapBatch=null;document.querySelectorAll('form[data-unsaved]').forEach(f=>delete f.dataset.unsaved);document.querySelectorAll('dialog[open]').forEach(d=>d.close());return true;}
function navigate(hash){if(busy||importing){toast('Aguarde o registro em andamento.');return;}if(!clean())return;if(location.hash==='#'+hash)void setHash();else location.hash=hash;}
function lockInterface(value){$('content').inert=value;$('dialog-form').inert=value;$('close-dialog').disabled=value;$('cancel-dialog').disabled=value;}
async function persist(update,blob){if(connectionEnded)throw Error('Acesso encerrado. Entre novamente.');if(busy)throw Error('Aguarde o registro em andamento.');busy=true;lockInterface(true);try{const latest=await commit(state.revision,update,blob);if(connectionEnded)throw Error('Acesso encerrado.');state=latest;return state;}finally{busy=false;lockInterface(false);}}
async function setHash(){if(connectionEnded)return;const routeChanged=location.hash!==acceptedHash;if(routeChanged&&((busy||importing)||!clean())){history.replaceState(null,'',acceptedHash||'#hoje');return;}if(busy||importing)return;acceptedHash=location.hash;busy=true;lockInterface(true);try{const latest=await load();if(connectionEnded)return;state=latest;const parts=acceptedHash.replace(/^#/,'').split('/').map(part=>{try{return decodeURIComponent(part);}catch{return part;}});route=parts[0]||'hoje';patientId=parts[1];visitId=parts[2];tab=parts[3]||'resumo';if(tab==='3d'){tab='mapa';acceptedHash='#paciente/'+patientId+'/'+visitId+'/mapa';history.replaceState(null,'',acceptedHash);}selectedId=null;pending=null;mapBatch=null;dirty=false;zoom=1;await render();if(routeChanged&&!connectionEnded)window.scrollTo?.(0,0);}finally{busy=false;lockInterface(false);drawMap();}}
function heading(eyebrow,title,subtitle,action=''){return `<div class="page-heading"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p class="subtitle">${subtitle}</p></div>${action}</div>`;}
function badge(status){return `<span class="badge ${['confirmado','concluido'].includes(status)?'green':'gold'}">${esc({agendado:'A confirmar',confirmado:'Confirmado',em_atendimento:'Em atendimento',concluido:'Atendido',cancelado:'Cancelado',rascunho:(isConnected()?'Rascunho':'Rascunho local')}[status]||status)}</span>`;}
function metrics(){const s=financialSummary(state);return `<div class="metric-grid"><article class="metric featured"><div class="metric-label">Recebido no piloto ${icon('financeiro')}</div><strong class="metric-number amount">${money(s.received)}</strong><small>Valores fictícios já registrados</small></article><article class="metric"><div class="metric-label">A receber ${icon('financeiro')}</div><strong class="metric-number amount">${money(s.outstanding)}</strong><small>Saldo dos exemplos de cobrança</small></article><article class="metric"><div class="metric-label">Atendimentos de hoje ${icon('agenda')}</div><strong class="metric-number">${state.appointments.filter(a=>a.date===dateKey()&&a.status!=='cancelado').length.toString().padStart(2,'0')}</strong><small>Agenda de demonstração</small></article></div>`;}
function appointmentRow(a){return `<div class="appointment-row" data-service-tone="${serviceTone(a.service)}"><div class="time">${esc(a.time)}<small>${a.duration} min</small></div><div><div class="appointment-person">${esc(patient(a.patientId)?.name)}</div><div class="appointment-service">${serviceBadge(a.service)}</div></div><div class="row-actions">${badge(a.status)}<button class="subtle" data-action="attend" data-id="${a.id}">Abrir ${icon('arrow')}</button></div></div>`;}
function todayPage(){return renderHome(state);}
function requestCards(){if(isConnected())return '<div class="cb-entry-links"><a class="secondary" href="#solicitacoes">Consultar solicitações do site →</a></div>';const pending=(state.requests||[]).filter(r=>r.status==='pendente');return pending.length?`<section class="card" style="margin-bottom:22px"><header class="card-header"><div><h2>Solicitações pelo site <span class="badge gold">${pending.length}</span></h2><p>Preferências recebidas. Ainda sem horário reservado.</p></div></header>${pending.map(r=>`<article class="visit-item"><div><h3>${esc(r.name)}</h3><p>${esc(r.phone)} · ${date(r.date)} / ${esc(r.period)} · ${esc(r.interest)}</p></div><button class="secondary" data-action="schedule-request" data-id="${r.id}">Preparar agendamento →</button></article>`).join('')}</section>`:'';}
function originalDocumentsLink(contextVisitId){if(!isConnected())return '';const v=state.visits.find(v=>v.id===contextVisitId);return `<div class="cb-entry-links"><a class="secondary" href="#originais${v?'/'+encodeURIComponent(v.patientId)+'/'+encodeURIComponent(v.id):''}">Documentos originais recebidos →</a><a class="secondary" href="#solicitacoes">Solicitações do site →</a></div>`;}
function bridgeContext(){if(route!=='originais'||!patientId&&!visitId)return null;const p=patient(patientId),v=visit();if(!p||!v)throw Error('A paciente ou a consulta selecionada não foi encontrada.');return{patientId:p.id,visitId:v.id,patientName:p.name,visitLabel:date(v.date)+' · '+v.service,revision:state.revision,locked:['concluido','cancelado'].includes(v.status)||!!v.lockedAt,cpfMasked:p.cpf?'•••••••••'+String(p.cpf).replace(/\D/g,'').slice(-2):'',birthDate:p.birthDate};}
function bridgePage(section){if(!isConnected())return '<section class="card card-body"><h1>Originais da clínica</h1><p>Os documentos e solicitações reais exigem acesso individual à clínica.</p><a class="primary" href="connected.html#originais">Entrar na área conectada →</a></section>';try{return '<div id="clinical-bridge-panel">'+renderClinicalBridge({section,context:bridgeContext()})+'</div>';}catch(error){return '<section class="card card-body"><h1>Consulta indisponível</h1><p>'+esc(error.message)+'</p><a class="secondary" href="#pacientes">Voltar aos prontuários</a></section>';}}
const areaDescriptions={hoje:'Resumo do dia, indicadores e atalhos.',pacientes:'Cadastros, consultas, fotos e documentos.',agenda:'Calendário, horários e solicitações do site.',financeiro:'Cobranças, recebimentos e despesas.',orcamentos:'Propostas, sessões e acompanhamento.',clinica:'Horários, equipe, metas e documentos.',catalogo:'Procedimentos, produtos e estoque.',ajustes:'Acesso, configuração e suporte.'};
function areaDirectoryPage(){return heading('SEU APLICATIVO','Todos os módulos','Escolha a área da clínica que deseja abrir.')+'<nav class="area-directory" aria-label="Todos os módulos">'+areas.map(({id,label,icon:areaIcon})=>'<a class="area-directory-card" href="#'+id+'">'+icon(areaIcon)+'<span><strong>'+esc(label)+'</strong><small>'+esc(areaDescriptions[id]||'Abrir esta área da clínica.')+'</small></span><span aria-hidden="true">→</span></a>').join('')+'</nav>';}
function agendaPage(){return heading('AGENDA','Agenda','Organize os atendimentos por dia, semana ou mês.')+requestCards()+renderAgenda(state,{...agendaView,date:agendaDate});}
function patientsPage(){return renderPatientsPage(state,patientView);}
function initials(name){return name.split(' ').filter(Boolean).slice(0,2).map(n=>n[0]).join('');}
function patientCards(query){return state.patients.filter(p=>patientMatches(p,query)).map(p=>{const visits=state.visits.filter(v=>v.patientId===p.id).sort((a,b)=>b.date.localeCompare(a.date));return `<a class="patient-row" href="#paciente/${p.id}" aria-label="Abrir prontuário de ${esc(p.name)}"><span class="patient-row-person"><span class="avatar">${esc(initials(p.name))}</span><span><strong>${esc(p.name)}</strong><small>Cadastro de demonstração</small></span></span><span class="patient-row-contact">${esc(p.phone||'Sem telefone informado')}</span><span class="patient-row-date">${visits[0]?date(visits[0].date):'Sem consultas'}</span><span class="patient-history" aria-label="${visits.length} consultas">${visits.length}</span>${icon('arrow')}</a>`;}).join('')||'<p class="empty">Nenhuma paciente encontrada.</p>';}
function patientPage(){
 const p=patient(patientId);if(!p)return '<div class="empty">Paciente não encontrada.</div>';
 const v=visit(),patientPath='#paciente/'+encodeURIComponent(p.id);
 if(visitId==='comparacoes')return '<a class="back" href="'+patientPath+'">← Prontuário de '+esc(p.name)+'</a><div class="pr-record"><div id="comparison-panel">'+renderComparisonLibrary(state,{patientId:p.id})+'</div></div>';
 if(!visitId)return renderPatientRecordOverview(state,{patientId:p.id,connected:isConnected(),comparisonHtml:renderComparisonLibrary(state,{patientId:p.id})});
 if(!v)return '<div class="empty"><h1>Atendimento não encontrado</h1><a class="secondary" href="'+patientPath+'">Voltar ao prontuário</a></div>';
 const base=patientPath+'/'+encodeURIComponent(v.id);
 if(tab==='resumo'||tab==='consultas')return renderVisitRecord(state,{patientId:p.id,visitId:v.id,connected:isConnected(),photoId});
 const links=[['resumo','Visão geral'],['documentos','Documentos'],['mapa','Fotos e aplicações'],['fotos','Galeria e comparação'],['registro','Evolução e conclusão']];
 const body=tab==='mapa'?mapPage(v):tab==='fotos'?photosPage(v):tab==='documentos'?originalDocumentsLink(v.id)+renderDocumentsPage(state,{visitId:v.id}):recordPage(v)+renderVisitOperations(state,v.id);
 return '<section class="visit-workspace"><a class="back" href="'+patientPath+'">← '+esc(p.name)+'</a><header class="visit-workspace-heading"><div><p class="eyebrow">ATENDIMENTO</p><h1>'+esc(v.service)+'</h1><p class="subtitle">'+esc(p.name)+' · '+date(v.date)+'</p></div>'+badge(v.status)+'</header><nav class="tabs visit-workspace-tabs" aria-label="Áreas da consulta">'+links.map(([id,label])=>'<a class="tab '+(tab===id?'active':'')+'" '+(tab===id?'aria-current="page"':'')+' href="'+base+'/'+id+'">'+label+'</a>').join('')+'</nav>'+body+'</section>';
}
function recordPage(v){const flow=visitWorkflow(v);return '<div class="record-grid"><section class="card"><header class="card-header"><div><h2>Registro do atendimento</h2><p>'+esc(flow.label)+(v.procedureVersion?' · procedimento versão '+v.procedureVersion:'')+'</p></div></header><form class="card-body" id="record-form"><div class="field"><label for="visit-notes">Observações do atendimento</label><textarea id="visit-notes" rows="9" maxlength="4000">'+esc(v.notes)+'</textarea></div><p class="small-label">Ao concluir, o registro fica bloqueado; correções posteriores são feitas por adendo.</p><button class="primary">'+(isConnected()?'Salvar rascunho no servidor':'Salvar rascunho local')+'</button><span class="saved-at" id="record-saved"></span></form></section><section class="card"><header class="card-header"><h2>Etapas do atendimento</h2></header><div class="card-body"><p class="subtitle">'+esc(flow.description)+'</p>'+flow.steps.map((step,i)=>'<a class="readiness" href="#paciente/'+patientId+'/'+v.id+'/'+step.tab+'"><span class="mark">'+(i+1)+'</span>'+esc(step.label)+' →</a>').join('')+'<div class="note-box">'+(isConnected()?'A conclusão depende dos documentos exigidos e da validação da assinatura profissional.':'A conclusão confere os documentos exigidos pelo procedimento. Assinaturas deste ambiente são apenas de demonstração.')+'</div></div></section></div>';}
function fileControl(){return `<label class="secondary file-label">${icon('photo')} Adicionar foto<input class="hidden-file" type="file" id="photo-upload" accept="image/jpeg,image/png,image/webp" aria-label="Adicionar foto à consulta"></label>`;}
function mapPositionControls(){return `<details class="map-position-controls" id="map-position-controls"><summary>Posição e ajuste fino</summary><p class="small-label">Posições em porcentagem da foto. Ajustes ficam em rascunho até salvar.</p><div class="field-grid">${[['x','Horizontal'],['y','Vertical']].map(([key,label])=>`<div class="field"><label for="map-${key}">${label} (%)</label><input id="map-${key}" type="number" min="0" max="100" step="any" inputmode="decimal" data-map-coordinate="${key}" disabled></div>`).join('')}</div><div id="map-end-position" class="field-grid" hidden>${[['x2','Final horizontal'],['y2','Final vertical']].map(([key,label])=>`<div class="field"><label for="map-${key}">${label} (%)</label><input id="map-${key}" type="number" min="0" max="100" step="any" inputmode="decimal" data-map-coordinate="${key}" disabled></div>`).join('')}</div><div class="map-nudge-controls"><label for="map-move-step">Passo do ajuste<select id="map-move-step"><option value="0.01">1% da foto</option><option value="0.001">0,1% · ajuste fino</option></select></label><div class="map-nudge-buttons" role="group" aria-label="Mover a marcação inteira">${[['left','←','esquerda'],['up','↑','cima'],['down','↓','baixo'],['right','→','direita']].map(([id,arrow,label])=>`<button type="button" class="secondary" data-action="move-map-point" data-id="${id}" aria-label="Mover marcação para ${label}" disabled>${arrow}</button>`).join('')}</div></div><p class="small-label" id="map-position-status" role="status" aria-live="polite">Selecione ou adicione uma marcação.</p></details>`;}
function newMapBatch(){return{patientId,visitId,photoId,photoRevision:photo()?.revision,baseVersion:map().version,items:[],persistedIds:[]};}
function batchItem(id=pending?.id){return mapBatch?.items.find(item=>item.point.id===id);}
const MAP_PROCEDURE_KEYS=['procedureId','procedureVersion','procedureSnapshot'];
function mapProcedureValue(point){return !point?'':!Object.hasOwn(point,'procedureId')?'@legacy':point.procedureId===null?'':JSON.stringify(Object.fromEntries(MAP_PROCEDURE_KEYS.map(key=>[key,point[key]])));}
function mapProcedureFields(value,base){
 if(value==='@legacy'){if(MAP_PROCEDURE_KEYS.some(key=>Object.hasOwn(base,key)))throw Error('Selecione o procedimento desta marcação.');return{};}
 if(!value)return{procedureId:null,procedureVersion:null,procedureSnapshot:null};
 let binding;try{binding=JSON.parse(value);}catch{throw Error('Selecione um procedimento válido.');}
 if(!binding||typeof binding!=='object'||Array.isArray(binding)||Object.keys(binding).length!==3||MAP_PROCEDURE_KEYS.some(key=>!Object.hasOwn(binding,key)))throw Error('Selecione um procedimento válido.');
 return binding;
}
function mapVisitProcedureBinding(){const p=visit()?.procedureSnapshot;return p&&(state.procedures||[]).some(current=>current.id===p.id&&current.active!==false)?{procedureId:p.id,procedureVersion:p.version,procedureSnapshot:p}:null;}
function mapProcedureOptions(point,value=mapProcedureValue(point)){
 const options=[['','Nenhum procedimento definido']];
 if(point&&!MAP_PROCEDURE_KEYS.some(key=>Object.hasOwn(point,key)))options.push(['@legacy','Do atendimento: '+(visit()?.procedureSnapshot?.name||visit()?.service||'Não informado')+' · registro anterior']);
 const primary=mapVisitProcedureBinding();if(primary)options.push([mapProcedureValue(primary),'Versão deste atendimento: '+primary.procedureSnapshot.name+' · v'+primary.procedureVersion]);
 for(const p of state.procedures||[]){if(p.active===false)continue;const key=JSON.stringify({procedureId:p.id,procedureVersion:p.version,procedureSnapshot:p});if(!options.some(([value])=>value===key))options.push([key,p.name+' · v'+p.version]);}
 if(value&&!options.some(([key])=>key===value)&&value!=='@legacy'){try{const binding=mapProcedureFields(value,point||{});options.push([value,(binding.procedureSnapshot?.name||'Procedimento salvo')+' · v'+binding.procedureVersion+' · versão preservada']);}catch{options.push([value,'Seleção inválida · escolha novamente']);}}
 return options.map(([key,label])=>`<option value="${esc(key)}" ${key===value?'selected':''}>${esc(label)}</option>`).join('');
}
function fillMapProcedure(point,form=null){const select=$('point-procedure');if(!select)return;const value=form?.['point-procedure']?.value??mapProcedureValue(point);select.innerHTML=mapProcedureOptions(point,value);select.value=value;}
function mapProcedureLabel(point,form=null){
 const value=form?.['point-procedure']?.value??mapProcedureValue(point);
 try{return savedMapProcedureLabel(mapProcedureFields(value,point),visit());}catch{return'Confira o procedimento';}
}
function captureMapForm(){return Object.fromEntries(MAP_FORM_FIELDS.map(id=>[id,{value:$(id)?.value||'',initial:$(id)?.dataset.mapInitial,original:$(id)?.dataset.mapOriginal}]));}
function captureBatchForm(){const item=batchItem();if(item)item.form=captureMapForm();}
function restoreBatchForm(item){
 $('point-form').reset();fillMapGeometry(item.point);fillMapProcedure(item.point,item.form);
 if(item.form){for(const [id,field]of Object.entries(item.form)){if(!$(id))continue;$(id).value=field.value;if(field.initial!==undefined)$(id).dataset.mapInitial=field.initial;if(field.original!==undefined)$(id).dataset.mapOriginal=field.original;}}
 else for(const [id,key]of [['point-region','region'],['point-product','product'],['point-quantity','quantity'],['point-unit','unit'],['point-lot','lot'],['point-notes','notes']])$(id).value=item.point[key]??'';
}
function selectBatchPoint(id,{edit=true}={}){
 if(!mapCanEdit()||mapGestureActive())return false;const item=batchItem(id);if(!item)return false;
 captureBatchForm();selectedId=null;pending=item.point;restoreBatchForm(item);dirty=true;mapBatch.editing=edit;
 $('point-title').textContent='Marcação '+(mapDisplayPoints().findIndex(point=>point.id===id)+1)+' do conjunto';$('point-state').textContent='Dados ainda não salvos';$('point-error').textContent='';drawMap();return true;
}
function moveBatchSelection(direction){
 if(!mapBatch?.items.length||!mapCanEdit()||mapGestureActive())return;
 const index=mapBatch.items.findIndex(item=>item.point.id===pending?.id),next=index+(direction==='previous'?-1:1);
 if(index<0||next<0||next>=mapBatch.items.length)return;selectBatchPoint(mapBatch.items[next].point.id);
}
function continueMapBatch(){
 if(!mapBatch||!mapCanEdit()||mapGestureActive())return;captureBatchForm();mapBatch.editing=false;drawMap();$('photo-stage')?.focus({preventScroll:true});
}
function prepareMapBatch(){
 if(!mapBatchMode)return false;if(mapBatch)return true;
 if(!clean())return false;mapBatch=newMapBatch();clearPoint();return true;
}
function addBatchMark(geometry){
 if(!mapCanEdit()||!prepareMapBatch())return false;
 if(mapBatch.items.length>=MAX_BATCH_MARKINGS||map().points.length+mapBatch.items.length>=10000){toast('O conjunto chegou ao limite de 1000 marcações. Salve antes de continuar.',true);return false;}
 captureBatchForm();const number=mapDisplayPoints().filter(point=>point.id!=='pending').length+1,point={...geometry,...(geometry.kind==='leque'?{fanSpread:DEFAULT_FAN_SPREAD}:{}),id:uid(),region:'Marcação '+number,procedureId:null,procedureVersion:null,procedureSnapshot:null,product:'',quantity:null,unit:'sem quantidade',lot:'',notes:''};
 mapBatch.items.push({point,form:null});selectBatchPoint(point.id,{edit:false});captureBatchForm();editGeneration++;return true;
}
function batchPreview(item){try{return readMapGeometry(item.point,item.form);}catch{return item.point;}}
function batchPoints(){return mapBatch?.items.map(item=>item.point.id===pending?.id?mapGeometryPreview(item.point):batchPreview(item))||[];}
function syncMapBatch(){
 const active=!!mapBatch,count=mapBatch?.items.length||0,editable=mapCanEdit();document.querySelector('.map-layout')?.classList.toggle('is-batch',active);if(active)document.querySelector('.map-layout')?.classList.toggle('has-selection',!!mapBatch.editing&&!!batchItem());
 const toggle=document.querySelector('[data-action="toggle-map-batch"]');if(toggle){toggle.textContent=mapBatchMode?'Usar marcação individual':'Marcar em sequência';toggle.setAttribute('aria-pressed',String(mapBatchMode));toggle.disabled=!editable;}
 const status=$('map-batch-status');if(status)status.textContent=active?(count?`${count} ${count===1?'marcação pendente':'marcações pendentes'} · selecione um número para preencher`:'Marque vários pontos na foto; depois preencha cada número'):mapBatchMode?(selectedId?'Editando uma marcação já salva':'Sequência ativa · marque vários locais e preencha os dados depois'):'Uma marcação por vez';
 for(const action of ['save-map-batch','discard-map-batch','edit-map-batch']){const button=document.querySelector(`[data-action="${action}"]`);if(button){button.hidden=!active;button.disabled=!count||!editable;}}
 if($('save-point')){$('save-point').textContent=active?'Salvar conjunto':isConnected()?'Salvar marcação':'Salvar marcação local';if(active)$('save-point').disabled=!count||!editable;}
 const cancel=document.querySelector('[data-action="cancel-point"]');if(cancel){cancel.textContent=active?'Remover esta marcação':'Cancelar edição';cancel.disabled=active&&!batchItem();}
 const index=mapBatch?.items.findIndex(item=>item.point.id===pending?.id)??-1,editing=active&&!!mapBatch.editing&&index>=0;
 const navigation=$('map-batch-navigation');if(navigation)navigation.hidden=!editing;
 const position=$('map-batch-position');if(position)position.textContent=index>=0?(index+1)+' de '+count:'';
 for(const [action,disabled]of [['batch-previous-point',index<=0],['batch-next-point',index<0||index>=count-1]]){const button=document.querySelector('[data-action="'+action+'"]');if(button)button.disabled=!editable||!editing||disabled;}
 const resume=document.querySelector('[data-action="continue-map-batch"]');if(resume){resume.hidden=!editing;resume.disabled=!editable;}
 if(editing)$('point-title').textContent='Marcação '+(mapDisplayPoints().findIndex(point=>point.id===pending.id)+1)+' do conjunto';
 const guide=document.querySelector('[data-map-sequence-guide]');if(guide){guide.hidden=!mapBatchMode;guide.querySelectorAll('[data-map-step]').forEach(el=>el.setAttribute('aria-current',el.dataset.mapStep===String(busy&&count?3:editing?2:1)?'step':'false'));}
}
function discardMapBatch(){if(!mapBatch||mapGestureActive()||busy)return;if(mapBatch.items.length&&!confirm('Descartar todas as marcações ainda não salvas deste conjunto?'))return;mapBatch=newMapBatch();clearPoint();}
function removeBatchMark(){const item=batchItem();if(!item)return;mapBatch.items=mapBatch.items.filter(row=>row!==item);pending=null;selectedId=null;const next=mapBatch.items.at(-1);if(next)selectBatchPoint(next.point.id);else clearPoint();editGeneration++;}
function pointFromForm(base,form){
 const value=id=>form[id]?.value||'',q=value('point-quantity').trim().replace(',','.');
 if(q&&!/^\d+(\.\d{1,4})?$/.test(q))throw Error('Confira a quantidade informada.');
 const point={...base},binding=mapProcedureFields(value('point-procedure'),base);for(const key of MAP_PROCEDURE_KEYS)delete point[key];
 if(binding.procedureId){const persisted=map().points.find(p=>p.id===base.id),selected=mapProcedureValue(binding),preserved=selected===mapProcedureValue(base)||persisted&&selected===mapProcedureValue(persisted),primary=mapVisitProcedureBinding(),sameVisit=primary&&selected===mapProcedureValue(primary);if(!preserved&&!sameVisit&&!(state.procedures||[]).some(p=>p.active!==false&&p.id===binding.procedureId&&p.version===binding.procedureVersion&&JSON.stringify(p)===JSON.stringify(binding.procedureSnapshot)))throw Error('O procedimento mudou ou foi inativado. Selecione a versão atual antes de salvar.');}
 return annotationCheck({...point,...binding,region:value('point-region').trim(),product:value('point-product').trim(),quantity:base.kind==='traco'?null:q?Number(q):null,unit:base.kind==='traco'?'sem quantidade':value('point-unit'),lot:value('point-lot').trim(),notes:value('point-notes').trim()});
}
async function saveMapBatch(){
 if(!mapBatch||!mapBatch.items.length||!mapCanEdit()||mapGestureActive())return;
 captureBatchForm();const batch=mapBatch,points=[];
 for(const item of batch.items){try{const form=item.form;if(!form)throw Error('Confira os dados da marcação.');points.push(pointFromForm(readMapGeometry(item.point,form),form));}catch(error){selectBatchPoint(item.point.id);$('point-error').textContent='Marcação '+(batch.items.indexOf(item)+1)+': '+error.message;return;}}
 if(batch.patientId!==patientId||batch.visitId!==visitId||batch.photoId!==photoId||batch.photoRevision!==photo()?.revision){$('point-error').textContent='O conjunto pertence a outra foto. Preserve o rascunho e reabra o atendimento.';return;}
 const generation=editGeneration;
 try{await updateMap(doc=>{if(doc.version!==batch.baseVersion)throw Error('O mapa mudou. Preserve este conjunto e confira a versão atual antes de salvar.');const ids=new Set(batch.persistedIds),replacements=new Map(points.map(p=>[p.id,p]));return{...doc,points:[...doc.points.map(p=>ids.has(p.id)?replacements.get(p.id)||p:p),...points.filter(p=>!ids.has(p.id))]};});
  if(connectionEnded)return;
  if(editGeneration===generation){mapBatch=newMapBatch();clearPoint();toast('Conjunto salvo: '+points.length+' marcações confirmadas.');}
  else{captureBatchForm();batch.baseVersion=map().version;batch.persistedIds=points.map(p=>p.id);dirty=true;drawMap();toast('Conjunto salvo. Há alterações mais recentes ainda não salvas.');}
 }catch(error){if($('point-error'))$('point-error').textContent=error.message;drawMap();}
}
function mapPage(v){if(!v.photos.length)return `<div class="card card-body"><h2>Comece pela fotografia</h2><p class="subtitle">A marcação fica vinculada à foto original e a esta consulta.</p><div style="margin-top:20px">${fileControl()}</div><p class="file-info">Neste piloto, utilize imagens de teste. JPEG, PNG ou WebP, até 8 MB.</p></div>`;
  if(!v.photos.some(p=>p.id===photoId))photoId=v.photos[0].id;
  if(mapBatchMode&&!mapBatch?.items.length&&!v.lockedAt&&!['concluido','cancelado'].includes(v.status))mapBatch=newMapBatch();
  const doc=map();return `<div class="photo-picker"><select id="photo-select" aria-label="Foto da consulta">${v.photos.map(p=>`<option value="${p.id}" ${p.id===photoId?'selected':''}>${esc(p.label)}</option>`).join('')}</select>${fileControl()}<span class="small-label">Escolha a foto e a ferramenta · marque, preencha e salve</span></div><div class="map-layout"><section class="map-card"><ol class="map-sequence-guide" data-map-sequence-guide aria-label="Como marcar em sequência"><li data-map-step="1"><span>1</span> Marque na foto</li><li data-map-step="2"><span>2</span> Preencha cada ponto</li><li data-map-step="3"><span>3</span> Salve o conjunto</li></ol><div class="map-batch-toolbar"><button type="button" class="secondary" data-action="toggle-map-batch" aria-pressed="${mapBatchMode}">${mapBatchMode?'Usar marcação individual':'Marcar em sequência'}</button><p id="map-batch-status" role="status" aria-live="polite"></p><div class="toolbar"><button type="button" class="secondary" data-action="edit-map-batch" disabled>Preencher marcações</button><button type="button" class="primary" data-action="save-map-batch" disabled>Salvar conjunto</button><button type="button" class="subtle" data-action="discard-map-batch" disabled>Descartar conjunto</button></div></div><div class="map-toolbar"><div class="segmented" aria-label="Ferramenta de marcação">${[['ponto','Ponto'],['linha','Linha'],['leque','Leque'],['traco','Caneta']].map(([id,label])=>`<button class="segment ${tool===id?'active':''}" data-action="tool" data-id="${id}" aria-pressed="${tool===id}">${label}</button>`).join('')}</div><div class="toolbar map-zoom-controls" role="group" aria-label="Ampliação da fotografia"><button type="button" class="icon-button" data-action="zoom-out" aria-label="Diminuir zoom" disabled>−</button><div class="segmented" aria-label="Níveis de zoom">${MAP_ZOOM_LEVELS.map(level=>`<button type="button" class="segment" data-action="map-zoom" data-id="${level}" aria-pressed="${zoom===level}" aria-label="Zoom ${level} vezes">${level}×</button>`).join('')}</div><span id="zoom-label" class="small-label" role="status" aria-live="polite">${zoom}×</span><button type="button" class="icon-button" data-action="zoom-in" aria-label="Aumentar zoom">+</button></div></div><div class="map-access-toolbar"><button type="button" class="secondary" data-action="map-focus" aria-pressed="false">Ampliar editor</button><button type="button" class="secondary" data-action="new-map-point" data-map-edit>Adicionar sem arrastar</button><p id="map-access-help" class="small-label">Adicione no centro visível e ajuste a posição. Com um ponto em foco, use as setas; Shift + seta faz o ajuste fino. O zoom amplia a foto existente.</p></div><div class="map-status" id="map-instruction">${tool==='traco'?'Desenhe sobre a foto com o dedo ou mouse. Solte, identifique e salve.':tool==='ponto'?'Toque na foto para criar um ponto.':'Toque no início e no fim da marcação.'} Selecione um número para editar.</div><div class="photo-stage" id="photo-stage" tabindex="0" role="group" aria-label="Fotografia e marcações. Enter adiciona uma marcação no centro visível." aria-describedby="map-access-help"><div class="photo-plane" id="photo-plane"><img id="map-photo" alt="Fotografia da consulta; marcações manuais sobre a imagem" draggable="false"><svg class="map-svg" id="map-svg" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true"></svg><div id="map-markers"></div></div></div><div class="map-footer"><span>Registro manual · versão ${isConnected()?'no servidor':'local'} <span id="map-version">${doc.version}</span></span><div class="toolbar"><button class="subtle" data-action="toggle-markers">Ocultar marcações</button><button class="subtle" data-action="export-map">Exportar imagem</button></div></div></section><aside class="map-side"><section class="card map-inspector"><header class="card-header"><h2 id="point-title">Nova marcação</h2><span class="small-label" id="point-state">Toque na fotografia</span><button type="submit" class="primary" id="save-point" form="point-form" disabled>${isConnected()?'Salvar marcação':'Salvar marcação local'}</button></header><form class="card-body" id="point-form"><nav class="map-batch-navigation" id="map-batch-navigation" aria-label="Preencher as marcações do conjunto" hidden><div class="map-batch-navigation-row"><button type="button" class="secondary" data-action="batch-previous-point" aria-label="Marcação anterior">← Anterior</button><span id="map-batch-position" role="status" aria-live="polite"></span><button type="button" class="secondary" data-action="batch-next-point" aria-label="Próxima marcação">Próxima →</button></div><button type="button" class="subtle" data-action="continue-map-batch">Continuar marcando na foto</button><p>Trocar de número mantém seus dados. Use Salvar conjunto para gravar todos.</p></nav><p class="map-procedure-context">Procedimento do atendimento: <strong>${esc(v.procedureSnapshot?.name||v.service||'Não informado')}</strong></p><div class="field"><label for="point-procedure">Procedimento desta marcação (opcional)</label><select id="point-procedure">${mapProcedureOptions(null)}</select></div><div class="field"><label for="point-region">Região / identificação</label><input id="point-region" maxlength="100" required placeholder="Nome que você deseja registrar"></div><div class="field-grid map-quantity-grid"><div class="field"><label for="point-quantity">Quantidade</label><input id="point-quantity" inputmode="decimal" placeholder="Opcional"></div><div class="field"><label for="point-unit">Unidade</label><select id="point-unit"><option>sem quantidade</option><option>mL</option><option>U</option><option>mg</option><option>g</option><option>un</option><option>fios</option></select></div></div><details class="map-extra-details"><summary>Produto, lote e observações</summary><div class="field"><label for="point-product">Produto</label><input id="point-product" maxlength="120" placeholder="Informe o produto utilizado"></div><div class="field"><label for="point-lot">Lote</label><input id="point-lot" maxlength="80" placeholder="Opcional no rascunho"></div><div class="field"><label for="point-notes">Observação</label><textarea id="point-notes" maxlength="2000" placeholder="Anotação manual da profissional"></textarea></div></details>${mapPositionControls()}<p id="point-error" role="alert" class="error"></p><div class="toolbar" style="justify-content:space-between;margin-top:6px"><button class="subtle" type="button" data-action="cancel-point">Cancelar edição</button><button class="subtle" type="button" id="delete-point" data-action="delete-point" hidden>Excluir ponto</button></div></form></section><section class="card" style="margin-top:16px"><header class="card-header"><h2>Legenda <span id="point-count" class="badge">${doc.points.length}</span></h2><button class="subtle" data-action="undo-map" ${doc.history.length?'':'disabled'}>Desfazer</button></header><div id="point-list"></div><div class="legend-total" id="quantity-totals"></div></section><p class="map-tip" style="margin-top:14px">Selecione um número para ajustar a posição por teclado, pelos controles ou arrastando. As quantidades são informadas por você; o sistema não recomenda locais, produtos ou doses.</p></aside></div>`;}
function photosPage(v){return `<div class="page-heading"><p class="subtitle">Fotografias da mesma consulta. Cada foto tem sua própria camada de marcação.</p>${fileControl()}</div><div class="photos-grid">${v.photos.map(p=>`<article class="card photo-thumb"><img data-photo-src="${p.id}" alt="${esc(p.label)}"><h3>${esc(p.label)}</h3><p>${p.phase==='depois'?'Depois':p.phase==='antes'?'Antes':'Registro'} · ${p.width} × ${p.height} px</p><div class="toolbar"><button class="subtle" data-action="open-photo-map" data-id="${p.id}">Marcar nesta foto →</button><button class="subtle" data-action="photo-phase" data-id="${p.id}">Classificar</button></div></article>`).join('')||'<p class="empty">Nenhuma foto nesta consulta.</p>'}</div><section class="card" style="margin-top:24px"><header class="card-header"><div><h2>Antes e depois</h2><p>Selecione fotografias desta paciente, inclusive entre consultas diferentes.</p></div></header><div class="card-body" id="comparison-panel"></div></section><div class="note-box">Adicionar uma foto não autoriza sua divulgação. ${isConnected()?'As imagens desta homologação ficam no servidor privado da clínica, separadas do painel atual.':'O piloto guarda a imagem somente neste navegador e não conecta ao prontuário real.'}</div>`;}
async function comparisonSource(item,original=false){if(!original)return photoUrl(item.photo);const stored=await getPhoto(item.photo.id);if(stored?.original)return stored.original;if(item.photo.src)return item.photo.src;throw Error('O arquivo original não está disponível. Confira a conexão ou o armazenamento.');}
function financePage(){const s=financialSummary(state);return heading('FINANCEIRO','Financeiro','Recebimentos e saldos, sem misturar promessa com dinheiro recebido.',`<button class="primary" data-action="new-bill">${icon('plus')} Nova cobrança</button>`)+metrics()+`<section class="card"><header class="card-header"><div><h2>Cobranças do piloto</h2><p>Recebimentos parciais são permitidos. Saldo zerado não aceita nova baixa.</p></div></header><div class="table-wrap"><table><thead><tr><th>Paciente / descrição</th><th>Total</th><th>Recebido</th><th>Saldo</th><th></th></tr></thead><tbody>${state.bills.map(b=>{const bal=billBalance(b,state.payments);return `<tr><td><strong>${esc(patient(b.patientId)?.name)}</strong><small>${esc(b.description)}</small></td><td>${money(b.total)}</td><td>${money(b.total-bal)}</td><td>${money(bal)}</td><td><button class="subtle" data-action="receive" data-id="${b.id}" ${bal===0?'disabled':''}>${bal===0?'Recebido':'Registrar recebimento'}</button></td></tr>`;}).join('')}</tbody></table></div></section><div class="dashboard-grid" style="margin-top:22px"><section class="card"><header class="card-header"><h2>Livro de recebimentos de teste</h2></header><div class="table-wrap"><table><thead><tr><th>Data</th><th>Forma</th><th>Valor</th></tr></thead><tbody>${state.payments.map(p=>`<tr><td>${date(p.date)}</td><td>${esc(p.method)}</td><td>${money(p.amount)}</td></tr>`).join('')}</tbody></table></div></section><section class="card card-body"><p class="eyebrow">SIMULAÇÃO DE RESULTADO</p><h2>Contribuição estimada</h2><strong class="metric-number">${money(s.contribution)}</strong><p class="details-text">Total cobrado ${money(s.billed)} menos custos variáveis informados ${money(s.variableCosts)}. Não representa lucro líquido: impostos, taxas e custos fixos ainda não foram informados.</p></section></div>`;}
function settingsPage(){if(isConnected())return heading('CONEXÃO DA CLÍNICA','Dados no servidor','Este ambiente está em homologação com dados fictícios.')+'<section class="card card-body"><h2>Salvamento entre aparelhos</h2><p>As gravações confirmadas ficam no servidor da clínica. Abra este mesmo endereço no notebook e no celular e use uma das contas autorizadas.</p><p>A agenda recebe os pedidos do site. A conclusão verifica os originais e exige a confirmação pessoal da profissional vinculada. Configure esses vínculos antes do uso clínico.</p><div class="cb-entry-links"><a class="primary" href="#configuracao-clinica">Configurar contas e documentos clínicos</a><a class="secondary" href="#originais">Documentos originais recebidos</a><a class="secondary" href="#solicitacoes">Solicitações do site</a><a class="secondary" href="https://anamariajacob.com.br/painel/">Painel atual e documentos oficiais</a></div></section><div id="cloud-backup-panel"></div>';return heading('CONTA E SUPORTE','Configuração e recuperação','Seu ambiente de testes e as opções para proteger seus exemplos.')+`<div class="record-grid"><section class="card card-body"><h2>Seu espaço de trabalho</h2><p class="details-text">Cadastro, agenda, documentos, fotos, mapas, estoque, orçamentos e financeiro estão vinculados neste navegador. Exporte cópias completas para proteger os testes.</p><div class="toolbar"><a class="secondary" href="https://anamariajacob.com.br/" target="_blank" rel="noopener">Abrir site da Ana</a><a class="secondary" href="#documentos">Modelos de documentos</a><a class="secondary" href="https://anamariajacob.com.br/app/guia/" target="_blank" rel="noopener noreferrer">Assistir ao guia do aplicativo</a></div></section><section class="card card-body"><h2>Base real da clínica</h2><p class="details-text">Este aplicativo está em testes e salva somente neste navegador. O painel atual da clínica continua disponível com seu acesso individual.</p><a class="primary" href="https://anamariajacob.com.br/painel/" target="_blank" rel="noopener noreferrer">Abrir painel da clínica →</a><p class="small-label">O mapa facial ampliado ainda precisa de validação do contrato no servidor antes do uso operacional.</p></section></div>`+renderRecoveryPage(state);}
function trackAuxiliary(handle,service,dialog){
 const tracked={...handle,dispose(){auxiliaryHandles.delete(tracked);handle.dispose();service?.dispose();if(dialog?.open)dialog.close();dialog?.remove();}};
 auxiliaryHandles.add(tracked);return tracked;
}
async function bindClinicalProcedure({visitId:targetVisitId,procedureId,procedureVersion,professionalId}){
 if(connectionEnded||!isConnected())throw Error('Entre na clínica para vincular o procedimento.');
 return persist(next=>{
  const selected=next.visits.find(v=>v.id===targetVisitId);if(!selected)throw Error('Consulta não encontrada.');assertVisitEditable(selected);
  const fixed=selected.procedureSnapshot;if(fixed&&(fixed.id!==procedureId||fixed.version!==procedureVersion))throw Error('A consulta já preserva outra versão de procedimento. Atualize a revisão.');
  const procedure=fixed||next.procedures.find(p=>p.id===procedureId&&p.version===procedureVersion&&p.active!==false);if(!procedure)throw Error('O procedimento mudou ou foi inativado. Atualize antes de vincular.');
  if(!selected.professionalId){const person=next.clinic.professionals.find(p=>p.id===professionalId&&p.active!==false&&p.role!=='secretaria'&&p.canAttend!==false);if(!person)throw Error('Selecione uma profissional ativa para esta consulta.');selected.professionalId=person.id;}
  if(!fixed)Object.assign(selected,{procedureId:procedure.id,procedureVersion:procedure.version,procedureSnapshot:structuredClone(procedure),recordMode:procedure.recordMode||'injectable',service:procedure.name});
 });
}
async function openClinicalCompletion(data){
 if(connectionEnded||!isConnected())throw Error('Entre na clínica para concluir.');
 const v=state.visits.find(v=>v.id===data.visitId);if(!v)throw Error('Consulta indisponível.');
 const input={patient_id:v.patientId,visit_id:v.id,procedure_id:data.procedureId,expected_revision:state.revision,consumptions:data.consumptions||[],sessions:data.sessions||1,...(data.quoteId?{quote_id:data.quoteId,...(data.quoteItems!==undefined?{quoteItems:structuredClone(data.quoteItems)}:{item_id:data.itemId})}: {})};
 const dialog=document.createElement('dialog');dialog.className='op-dialog cc-modal';dialog.setAttribute('aria-label','Revisão e confirmação pessoal do atendimento');dialog.innerHTML='<div class="card-body" data-clinical-completion></div>';document.body.append(dialog);
 const service=createClinicalCompletionService({session:getClinicalBridge().session});
 return new Promise(resolve=>{
  let tracked,settled=false,needsReload=false,reloading=false;
  const settle=value=>{if(!settled){settled=true;resolve(value);}};
  const close=()=>{if(tracked?.isBusy?.()||tracked?.hasUncertain?.())return false;tracked?.dispose();return true;};
  const host=dialog.querySelector('[data-clinical-completion]');
  async function reloadConfirmed(){
   if(reloading||connectionEnded)return;reloading=true;host.innerHTML='<h2>Atendimento concluído no servidor</h2><p role="status">Carregando o registro confirmado…</p>';
   try{const latest=await load();if(connectionEnded)return;state=latest;needsReload=false;settle(true);tracked.dispose();}
   catch(error){if(!connectionEnded){host.innerHTML='<h2>Atendimento concluído no servidor</h2><p>A confirmação foi recebida. A releitura da consulta falhou; não conclua novamente.</p><p role="status"></p><button class="primary" type="button">Carregar consulta confirmada</button>';host.querySelector('[role="status"]').textContent=error.message;host.querySelector('button').onclick=()=>void reloadConfirmed();}}
   finally{reloading=false;}
  }
  const handle=mountClinicalCompletion(host,{service,input,notify:toast,onCancel:close,onComplete:async()=>{needsReload=true;await reloadConfirmed();}});
  const guarded={...handle,isBusy:()=>reloading||handle.isBusy(),isDirty:()=>needsReload||handle.isDirty(),hasUncertain:()=>needsReload||handle.hasUncertain(),discard:()=>!needsReload&&handle.discard(),dispose(){handle.dispose();settle(false);}};
  tracked=trackAuxiliary(guarded,service,dialog);dialog.addEventListener('cancel',event=>{event.preventDefault();close();});dialog.showModal();
 });
}
async function photoUrl(p){if(!p)throw Error('Fotografia não encontrada.');if(connectionEnded)throw Error('Acesso encerrado.');if(objectUrls.has(p.id))return objectUrls.get(p.id);const generation=renderSeq,blob=await getPhoto(p.id);if(connectionEnded||generation!==renderSeq)throw Error('A visualização da fotografia foi encerrada.');if(blob?.preview){if(objectUrls.has(p.id))return objectUrls.get(p.id);const url=URL.createObjectURL(blob.preview);objectUrls.set(p.id,url);return url;}if(p.src)return p.src;throw Error('A foto não está disponível. Confira a conexão ou o armazenamento.');}
async function render(){
 if(connectionEnded||!state)return;visitRecordDispose?.();visitRecordDispose=null;disposeAuxiliary();clinicalBridgeHandle?.dispose();clinicalBridgeHandle=null;facialHandle?.dispose();facialHandle=null;patientsHandle?.dispose();patientsHandle=null;patientEditor?.dispose();patientEditor=null;comparisonHandle?.dispose();comparisonHandle=null;agendaDispose?.();agendaDispose=null;integrationHandle?.dispose();integrationHandle=null;const seq=++renderSeq;
 const active=route==='paciente'||route==='documento'||route==='originais'&&patientId?'pacientes':route==='documentos'||route==='originais'?'clinica':route==='solicitacoes'?'agenda':['integracao','configuracao-clinica'].includes(route)?'ajustes':route;
 $('crumb').textContent=active==='areas'?'Todos os módulos':areas.find(a=>a.id===active)?.label||'Início';
 $('nav').innerHTML=areas.map(({id,label,icon:areaIcon})=>`<a class="nav-item ${active===id?'active':''} ${id==='clinica'?'section-start':''}" href="#${id}" data-mobile-primary="${['hoje','pacientes','agenda','financeiro'].includes(id)}" ${active===id?'aria-current="page"':''}>${icon(areaIcon)}<span>${label}</span></a>`).join('')+`<a class="nav-item nav-mobile-menu ${!['hoje','pacientes','agenda','financeiro'].includes(active)?'active':''}" href="#areas" ${active==='areas'?'aria-current="page"':''}>${icon('ajustes')}<span>Menu</span></a>`;
 $('area-switch').innerHTML=(active==='areas'?'<option value="areas" selected>Todos os módulos</option>':'')+areas.map(({id,label})=>`<option value="${id}" ${active===id?'selected':''}>${label}</option>`).join('');
 const documentVisit=route==='documento'?state.documentResponses.find(d=>d.id===patientId)?.visitId:undefined;
 const pages={areas:areaDirectoryPage,hoje:todayPage,agenda:()=>agendaPage()+renderAgendaSupport(state,{date:agendaDate}),pacientes:patientsPage,paciente:patientPage,financeiro:()=>renderFinancePage(state),ajustes:settingsPage,orcamentos:()=>renderOperationsPage('orcamentos',state),catalogo:()=>renderOperationsPage('catalogo',state),clinica:()=>renderClinicPage(state)+'<div class="toolbar"><a class="secondary" href="#documentos">Anamneses e termos →</a></div>'+originalDocumentsLink(),documentos:()=>originalDocumentsLink()+renderDocumentsPage(state),documento:()=>documentVisit?originalDocumentsLink(documentVisit)+renderDocumentsPage(state,{visitId:documentVisit}):'<p class="empty">Documento não encontrado neste ambiente.</p>',originais:()=>bridgePage('documents'),solicitacoes:()=>bridgePage('requests'),'configuracao-clinica':()=>isConnected()?'<div id="clinical-settings-panel"></div>':'<p>Abra a área conectada para configurar a clínica.</p>',integracao:renderIntegrationPage};
 $('content').innerHTML='<div id="page-body">'+(pages[route]||todayPage)()+'</div>';
 const host=$('page-body'),context={getState:()=>state,mutate:persist,notify:toast,render,rerender:render,route,documentTemplates:()=>state.documentTemplates,documentCheck:documentsSatisfied,completeClinical:isConnected()?openClinicalCompletion:null,bindClinicalProcedure:isConnected()?bindClinicalProcedure:null,beforeOperation:()=>{if(dirty||pending||busy||importing||editorsBusy()||editorsDirty()){toast('Salve o rascunho da consulta antes de continuar.',true);return false;}return true;},refreshCatalog:async()=>{if(busy||importing||!clean())throw Error('Conclua a edição antes de atualizar.');const latest=await load();if(connectionEnded)throw Error('Acesso encerrado.');state=latest;}};
 if(['agenda','clinica','hoje'].includes(route))mountClinic(host,context);
 if(route==='pacientes')patientsHandle=mountPatientsPage(host,{...context,view:patientView,onViewChange:v=>{patientView=v;},onSaved:render});
 if(route==='paciente'&&visit()&&tab==='3d')facialHandle=mountFacialStudy($('facial-panel'),{...context,patientId,visitId,storageMode:isConnected()?'clinic-server':'local-browser'});
 if(route==='agenda')agendaDispose=mountAgenda(host,{getView:()=>({...agendaView,date:agendaDate}),setView:async(next,{focus}={})=>{if(busy||importing||!clean())return false;agendaDate=next.date;agendaView=next;await render();if(focus){const el=$('page-body').querySelector(focus.selector);el?.focus({preventScroll:true});if(focus.start!=null&&el?.setSelectionRange)el.setSelectionRange(focus.start,focus.end);}return true;}});
 if(['catalogo','orcamentos'].includes(route)||route==='paciente')mountOperations(host,context);
 if(route==='financeiro')mountFinance(host,context);
 if(route==='documentos'||route==='documento'||route==='paciente'&&tab==='documentos')mountDocuments(host,{...context,visitId:documentVisit||visitId});
 if(isConnected()&&route==='originais'&&$('clinical-bridge-panel'))clinicalBridgeHandle=mountClinicalBridge($('clinical-bridge-panel'),{service:getClinicalBridge(),section:'documents',getContext:bridgeContext,reloadContext:async()=>{if(busy||importing)throw Error('Aguarde a operação em andamento.');const latest=await load();if(connectionEnded)throw Error('Acesso encerrado.');state=latest;},notify:toast});
 if(isConnected()&&route==='solicitacoes'&&$('clinical-bridge-panel'))clinicalBridgeHandle=mountSiteBooking($('clinical-bridge-panel'),{service:createSiteBookingService({session:getClinicalBridge().session}),getState:()=>state,reloadState:async()=>{const latest=await load();if(connectionEnded)throw Error('Acesso encerrado.');state=latest;},notify:toast});
 if(route==='ajustes'&&isConnected())trackAuxiliary(mountCloudBackup($('cloud-backup-panel'),{readSnapshot,getClinicId,eventTarget:window,notify:toast}));
 if(route==='ajustes'&&!isConnected())mountRecovery(host,{...context,onRestored:async()=>{for(const url of objectUrls.values())URL.revokeObjectURL(url);objectUrls.clear();state=await load();await render();}});
 if(route==='configuracao-clinica'&&isConnected()){const service=createClinicalCompletionService({session:getClinicalBridge().session});const handle=mountClinicalSettings($('clinical-settings-panel'),{service,getState:()=>state,notify:toast});trackAuxiliary(handle,service);}
 if(route==='integracao')integrationHandle=mountIntegration(host,{config:{enabled:false}});
 try{if(route==='paciente'&&visit()){
  if(tab==='mapa'&&photo()){const url=await photoUrl(photo());if(seq!==renderSeq)return;fitLoadedMapPhoto($('map-photo'),url,seq);drawMap();}
  if(['resumo','consultas'].includes(tab))visitRecordDispose=mountVisitRecord(host,{onPhotoSelect:id=>{photoId=id;}});
  if(['fotos','resumo','consultas'].includes(tab)){for(const el of host.querySelectorAll('[data-photo-src]')){try{const p=visit().photos.find(p=>p.id===el.dataset.photoSrc);const url=await photoUrl(p);if(seq!==renderSeq||connectionEnded)return;el.src=url;}catch(error){if(seq!==renderSeq||connectionEnded)return;el.alt+=' — fotografia indisponível';toast(error.message,true);}}if(seq!==renderSeq)return;}
  lockCompletedVisit();
 }
 if(route==='paciente'&&patient(patientId)&&(!visitId||visitId==='comparacoes'||visit()&&tab==='fotos')){const comparisonPatient=patientId;comparisonHandle=mountComparisonLibrary($('comparison-panel'),{getState:()=>state,patientId:comparisonPatient,storageMode:isConnected()?'clinic-server':'local-browser',readPhoto:comparisonSource,mutate:persist,notify:toast,selection:comparisonSelections.get(comparisonPatient),onSaved:record=>comparisonSelections.set(comparisonPatient,record.id)});}
 }catch(e){toast(e.message,true);}
}
function lockCompletedVisit(){if(!visit()||!['concluido'].includes(visit().status)&&!visit().lockedAt)return;document.querySelectorAll('#record-form input,#record-form textarea,#record-form button,#point-form input,#point-form select,#point-form textarea,#point-form button,#save-point,#photo-upload,[data-action="photo-phase"],[data-action="undo-map"],[data-action="tool"],[data-map-edit]').forEach(el=>el.disabled=true);if($('map-instruction'))$('map-instruction').textContent='Consulta concluída. Marcações preservadas; correções por adendo na aba Registro.';}

function shapeSvg(p,color='#a58237'){
 if(p.kind==='traco')return `<polyline points="${p.vertices.map(v=>`${v.x*1000},${v.y*1000}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
 if(p.kind==='ponto'||!Number.isFinite(p.x2)||!Number.isFinite(p.y2))return '';
 const rays=p.kind==='leque'?fanRays(p,(photo()?.width||1)/(photo()?.height||1)):[{x1:p.x,y1:p.y,x2:p.x2,y2:p.y2}];
 return rays.map(ray=>`<line x1="${ray.x1*1000}" y1="${ray.y1*1000}" x2="${ray.x2*1000}" y2="${ray.y2*1000}" stroke="${color}" stroke-width="${p.kind==='leque'?1.5:1.75}" vector-effect="non-scaling-stroke"/>`).join('');
}
function mapCanEdit(){return !!visit()&&!busy&&!importing&&!visit().lockedAt&&!['concluido','cancelado'].includes(visit().status);}
function mapFormBase(){return selectedId?map().points.find(point=>point.id===selectedId):pending;}
function fillMapGeometry(point){
 for(const key of ['x','y','x2','y2']){const field=$('map-'+key);if(!field)continue;
  const value=point?.[key];field.value=Number.isFinite(value)?String(Number((value*100).toFixed(3))):'';
  // Display a readable percentage without rounding stored geometry when only
  // the label/product changes. Deliberate numeric edits use the typed value.
  field.dataset.mapInitial=field.value;field.dataset.mapOriginal=Number.isFinite(value)?String(value):'';
 }
}
function readMapGeometry(base,form=null){
 if(!base)return null;const result={...base};
 for(const key of ['x','y',...(['ponto','traco'].includes(base.kind)?[]:['x2','y2'])]){const field=$('map-'+key);
  const snapshot=form?.['map-'+key],raw=snapshot?snapshot.value:field?.value,initial=snapshot?snapshot.initial:field?.dataset.mapInitial,original=snapshot?snapshot.original:field?.dataset.mapOriginal,value=!snapshot&&!field?base[key]:raw===initial&&original!==''&&original!==undefined?Number(original):raw?.trim()?Number(raw)/100:NaN;
  if(!Number.isFinite(value)||value<0||value>1)throw Error('Informe posições entre 0% e 100% para todos os pontos da marcação.');result[key]=value;
 }return base.kind==='traco'?translateMapDraft(base,result):result;
}
function translateMapDraft(base,target){return translateAnnotation({...base,region:base.region||'Rascunho',quantity:base.quantity??null,unit:base.unit||'sem quantidade'},target);}
function mapGeometryPreview(base){try{return readMapGeometry(base);}catch{return base;}}
function syncMapPositionControls(){
 const base=mapFormBase(),editable=mapCanEdit();
 for(const field of document.querySelectorAll('[data-map-coordinate]'))field.disabled=!base||!editable||['ponto','traco'].includes(base.kind)&&['x2','y2'].includes(field.dataset.mapCoordinate);
 if($('map-end-position'))$('map-end-position').hidden=!base||['ponto','traco'].includes(base.kind);
 for(const button of document.querySelectorAll('[data-action="move-map-point"]'))button.disabled=!base||!editable;
 for(const button of document.querySelectorAll('[data-map-edit]'))button.disabled=!editable;
 if($('map-move-step'))$('map-move-step').disabled=!base||!editable;
 if($('point-procedure'))$('point-procedure').disabled=!base||!editable;
 const status=$('map-position-status');if(!status)return;
 if(!base){status.textContent='Selecione ou adicione uma marcação.';return;}
 try{const p=readMapGeometry(base),percent=n=>(n*100).toLocaleString('pt-BR',{maximumFractionDigits:3});status.textContent=`Horizontal ${percent(p.x)}%; vertical ${percent(p.y)}%.${['ponto','traco'].includes(p.kind)?'':` Final: ${percent(p.x2)}%; ${percent(p.y2)}%.`} ${dirty?'Ajuste ainda não salvo.':'Posição registrada.'}`;}catch{status.textContent='Complete as posições entre 0% e 100% antes de salvar.';}
}
function createMapDraft(){
 if(!mapCanEdit())return;const image=$('map-photo'),plane=$('photo-plane'),stage=$('photo-stage');
 if(!image?.complete||!image.naturalWidth||!plane||!stage){toast('Aguarde a fotografia carregar.');return;}
 if(mapBatchMode){if(!prepareMapBatch())return;}else{if(!clean())return;clearPoint();}
 const rect=plane.getBoundingClientRect(),viewport=stage.getBoundingClientRect();if(!(rect.width>0&&rect.height>0))return;
 const at=normalizedPoint((Math.max(rect.left,viewport.left)+Math.min(rect.right,viewport.left+stage.clientWidth))/2,(Math.max(rect.top,viewport.top)+Math.min(rect.bottom,viewport.top+stage.clientHeight))/2,rect);
 const geometry={id:'pending',kind:tool,...at,...(tool==='leque'?{fanSpread:DEFAULT_FAN_SPREAD}:{}),...(tool==='traco'?{vertices:[at,{x:at.x<=.9?at.x+.1:at.x-.1,y:at.y}],quantity:null,unit:'sem quantidade'}:tool==='ponto'?{}:{x2:at.x<=.9?at.x+.1:at.x-.1,y2:at.y})};
 if(mapBatchMode){if(!addBatchMark(geometry))return;}else{pending=geometry;dirty=true;editGeneration++;$('point-region').value=(tool==='traco'?'Desenho ':'Marcação ')+(map().points.length+1);fillMapGeometry(pending);drawMap();}$('map-position-controls').open=true;$('map-x').focus();
 $('point-state').textContent='Ainda não salva';$('map-instruction').textContent='Posição inicial no centro visível. Ajuste e identifique a marcação antes de salvar.';
}
function moveMapPoint(direction,fine=false){
 if(!mapCanEdit())return;const base=mapFormBase();if(!base)return;
 const p=readMapGeometry(base),step=fine?.001:Number($('map-move-step')?.value||.01),amount=step===.001?.001:.01;
 const offsets={left:[-amount,0],right:[amount,0],up:[0,-amount],down:[0,amount]},offset=offsets[direction];if(!offset)return;
 const next=translateMapDraft(p,{x:p.x+offset[0],y:p.y+offset[1]});
 if(next.x===p.x&&next.y===p.y)return;
 fillMapGeometry(next);dirty=true;editGeneration++;$('point-state').textContent='Ajuste ainda não salvo';drawMap();
}
function mapDisplayPoints(){const drafts=new Map(batchPoints().map(p=>[p.id,p])),saved=map().points.map(p=>{const draft=drafts.get(p.id);drafts.delete(p.id);return draft||(p.id===selectedId?mapGeometryPreview(p):p);});return [...saved,...drafts.values(),...(!mapBatch&&pending?[{...mapGeometryPreview(pending),id:'pending'}]:[])];}
function mapLegendForm(point){if(point.id==='pending'&&pending&&!mapBatch)return captureMapForm();const item=batchItem(point.id);return item?(point.id===pending?.id?captureMapForm():item.form):point.id===selectedId?captureMapForm():null;}
function mapQuantityPreview(point,form=null){
 if(point.kind==='traco')return {quantity:null,unit:'sem quantidade',valid:true,label:'Desenho livre · sem quantidade'};
 const raw=String(form?form['point-quantity']?.value??'':point.quantity??'').trim().replace(',','.'),unit=form?form['point-unit']?.value:point.unit;
 if(!raw)return {quantity:null,unit:'sem quantidade',valid:true,label:'Quantidade não informada'};
 const quantity=Number(raw);if(!/^\d+(\.\d{1,4})?$/.test(raw)||!Number.isFinite(quantity)||quantity<=0||quantity>100000)return {quantity:null,unit,valid:false,label:'Confira a quantidade informada'};
 if(!['mL','U','mg','g','un','fios'].includes(unit))return {quantity:null,unit,valid:false,label:'Escolha a unidade da quantidade'};
 return {quantity,unit,valid:true,label:quantity.toLocaleString('pt-BR',{maximumFractionDigits:4})+' '+unit};
}
function drawMapLegend(points){
 const doc=map(),listed=points.filter(point=>point.id!=='pending');$('point-count').textContent=listed.length;
 $('point-list').innerHTML=listed.length?listed.map((point,index)=>{const item=batchItem(point.id),form=mapLegendForm(point),quantity=mapQuantityPreview(point,form),editing=!!item||point.id===selectedId&&dirty,region=form?.['point-region']?.value??point.region,product=form?.['point-product']?.value??point.product;
 return `<button type="button" class="point-entry ${item?'pending ':''}${item?mapBatch.editing&&point.id===pending?.id?'active':'':point.id===selectedId?'active':''}" data-action="${item?'select-batch-point':'select-point'}" data-id="${point.id}"><span class="number">${index+1}</span><span><strong>${esc(region||'Identificação não informada')}</strong><small>${esc(mapProcedureLabel(point,form))}</small><small class="map-point-quantity${quantity.valid?'':' is-invalid'}" data-map-quantity>${esc(quantity.label)}</small>${product?`<small>${esc(product)}</small>`:''}${editing?`<small class="map-point-draft">${doc.points.some(saved=>saved.id===point.id)?'Alterações não salvas':'Ainda não salva'}</small>`:''}</span></button>`;
 }).join(''):'<div class="empty" style="padding:22px 17px;font-size:10px">Ainda sem marcações.<br>Toque nos locais que deseja registrar na foto.</div>';
 const formatted=totals=>Object.entries(totals).map(([unit,n])=>n.toLocaleString('pt-BR',{maximumFractionDigits:4})+' '+unit).join(' · '),saved=formatted(quantityTotals(doc.points));
 let summary='<div><strong>Salvo:</strong> '+esc(saved||'quantidades não informadas')+'.</div>';
 if(mapBatch?.items.length||pending||selectedId&&dirty){const previews=points.map(point=>mapQuantityPreview(point,mapLegendForm(point))),invalid=previews.filter(point=>!point.valid).length,totals=formatted(quantityTotals(previews.filter(point=>point.valid)));
 summary+='<div class="map-total-preview"><strong>Prévia não salva:</strong> '+esc(invalid?'confira '+invalid+' quantidade(s) ou unidade(s) antes de totalizar':totals||'quantidades não informadas')+'.</div>';
 }
 $('quantity-totals').innerHTML=summary;
}
function drawMap(){if(!$('map-svg'))return;const focusedMarker=document.activeElement?.dataset?.marker,doc=map(),points=mapDisplayPoints();$('map-svg').innerHTML=points.map(p=>shapeSvg(p,p.id==='pending'||batchItem(p.id)?'#ddad50':'#aa8537')).join('');$('map-markers').innerHTML=points.map((p,i)=>`<button type="button" class="map-marker ${p.id===selectedId||mapBatch?.editing&&pending?.id===p.id?'selected':''} ${p.id==='pending'||batchItem(p.id)?'pending':''}" data-marker="${p.id}" ${batchItem(p.id)?'data-batch-marker="true"':''} aria-pressed="${p.id===selectedId||p.id==='pending'||mapBatch?.editing&&pending?.id===p.id}" aria-describedby="map-access-help" style="left:${p.x*100}%;top:${p.y*100}%" aria-label="Marcação ${i+1}${p.region?': '+esc(p.region):''}">${p.id==='pending'?'+':i+1}</button>`).join('');$('map-version').textContent=doc.version;drawMapLegend(points);
  $('delete-point').hidden=!selectedId;let geometryReady=false;try{geometryReady=!!readMapGeometry(mapFormBase());}catch{}$('save-point').disabled=busy||!mapCanEdit()||!geometryReady;
  const base=mapFormBase(),tracing=base?.kind==='traco';$('photo-plane').dataset.tool=tool;document.querySelector('.map-layout')?.classList.toggle('has-selection',!!base);document.querySelector('.map-quantity-grid').hidden=tracing;for(const id of ['point-quantity','point-unit'])$(id).disabled=tracing||!mapCanEdit();if(tracing){$('point-quantity').value='';$('point-unit').value='sem quantidade';}const undo=document.querySelector('[data-action="undo-map"]');if(undo)undo.disabled=!doc.history.length;syncMapPositionControls();lockCompletedVisit();syncMapBatch();if(focusedMarker){const marker=[...document.querySelectorAll('[data-marker]')].find(node=>node.dataset.marker===focusedMarker);marker?.focus({preventScroll:true});}
}
function selectPoint(id){if(busy||importing||mapGestureActive())return false;if(batchItem(id))return selectBatchPoint(id);if(mapBatch?.items.length){toast('Salve ou descarte o conjunto antes de editar uma marcação já registrada.');return false;}mapBatch=null;if(selectedId===id)return true;if(!clean())return false;const p=map().points.find(p=>p.id===id);if(!p)return false;selectedId=id;pending=null;for(const [id,key]of[['point-region','region'],['point-product','product'],['point-quantity','quantity'],['point-unit','unit'],['point-lot','lot'],['point-notes','notes']])$(id).value=p[key]??'';$('point-title').textContent='Editar marcação';$('point-state').textContent='Alteração manual';fillMapGeometry(p);fillMapProcedure(p);drawMap();return true;}
function clearPoint(){selectedId=null;pending=null;if(mapBatch&&!mapBatch.items.length)mapBatch=newMapBatch();dirty=!!mapBatch?.items.length;if($('point-form')){$('point-form').reset();fillMapGeometry(null);fillMapProcedure(null);$('point-title').textContent='Nova marcação';$('point-state').textContent='Toque na fotografia';$('point-error').textContent='';$('map-instruction').textContent=tool==='traco'?'Desenhe sobre a foto com o dedo ou mouse. Solte, identifique e salve.':tool==='ponto'?'Toque na foto para criar um ponto.':'Toque no início e no fim da marcação.';drawMap();}}
async function updateMap(mutator){const vId=visitId,pId=patientId,fId=photoId,rev=photo().revision;await persist(s=>{const v=s.visits.find(v=>v.id===vId&&v.patientId===pId),ph=v?.photos.find(p=>p.id===fId);assertVisitEditable(v);if(!ph||ph.revision!==rev)throw Error('A foto ou consulta foi alterada. Reabra o registro.');const old=v.maps[fId]||{version:0,points:[],history:[]};const next=mutator(structuredClone(old));v.maps[fId]={...next,version:old.version+1,history:[...old.history,old.points].slice(-20)};});}
function openDialog(title,fields,submit){if(busy||importing)return false;const hadDraft=dirty||pending;if(!clean())return false;if(hadDraft)void render();$('dialog-title').textContent=title;$('dialog-fields').innerHTML=fields;$('dialog-error').textContent='';dialogSubmit=submit;$('dialog-form').reset();delete $('dialog-form').dataset.unsaved;$('dialog').showModal();return true;}
const field=(label,name,value='',type='text',extra='')=>`<div class="field"><label for="d-${name}">${label}</label><input id="d-${name}" name="${name}" type="${type}" value="${esc(value)}" ${extra}></div>`;
function patientOptions(value){return `<div class="field"><label for="d-patient">Paciente</label><select id="d-patient" name="patientId">${state.patients.map(p=>`<option value="${p.id}" ${p.id===value?'selected':''}>${esc(p.name)}</option>`).join('')}</select></div>`;}
function appointmentDialog(id){
 const a=state.appointments.find(a=>a.id===id);if(!state.patients.length){toast('Cadastre uma paciente primeiro.');return;}
 const colors={auto:'Automática',rose:'Rosé',purple:'Violeta',blue:'Azul',teal:'Petróleo',green:'Verde',amber:'Dourado',orange:'Coral',slate:'Grafite'};
 const opened=openDialog(a?'Editar agendamento':'Novo agendamento',patientOptions(a?.patientId)+'<div class="field"><label for="d-professional">Profissional</label><select name="professionalId" id="d-professional">'+professionalOptions(state,a?.professionalId)+'</select></div>'+procedureOptions(a?.procedureId,true)+'<div class="field-grid">'+field('Data','date',a?.date||agendaDate,'date','required')+field('Horário','time',a?.time||'09:00','time','required')+field('Duração (minutos)','duration',a?.duration||60,'number','min="5" max="480" required')+field('Atendimento','service',a?.service||'','text','maxlength="120" required')+'</div><div class="field-grid"><div class="field"><label for="d-appointmentType">Tipo de atendimento</label><select name="appointmentType" id="d-appointmentType">'+APPOINTMENT_TYPES.map(t=>'<option '+(t===(a?.appointmentType||'Procedimento')?'selected':'')+'>'+esc(t)+'</option>').join('')+'</select></div><div class="field"><label for="d-color">Cor na agenda</label><select name="color" id="d-color">'+APPOINTMENT_COLORS.map(c=>'<option value="'+c+'" '+(c===(a?.color||'auto')?'selected':'')+'>'+colors[c]+'</option>').join('')+'</select></div></div><div class="field"><label for="d-status">Situação</label><select id="d-status" name="status">'+['agendado','confirmado','em_atendimento','concluido','cancelado'].map(s=>'<option value="'+s+'" '+(a?.status===s?'selected':'')+'>'+({agendado:'A confirmar',confirmado:'Confirmado',em_atendimento:'Em atendimento',concluido:'Atendido',cancelado:'Cancelado'}[s])+'</option>').join('')+'</select></div>',async f=>{const value={...a,id:a?.id||uid(),patientId:f.get('patientId'),professionalId:f.get('professionalId'),date:f.get('date'),time:f.get('time'),duration:Number(f.get('duration')),service:String(f.get('service')).trim(),status:f.get('status')};await persist(s=>scheduleClinicAppointment(s,{...value,...appointmentMetadata(s,Object.fromEntries(f))}));});
 if(!opened)return;
 $('d-procedure').addEventListener('change',()=>{const p=state.procedures.find(p=>p.id===$('d-procedure').value);if(p){$('d-service').value=p.name;$('d-duration').value=p.duration;}});
}
function newPatient(id){if(!clean())return;patientEditor?.dispose();patientEditor=openPatientEditor({getState:()=>state,patientId:id,mutate:persist,notify:toast,onSaved:render});}
function scheduleRequest(id){const r=state.requests.find(r=>r.id===id&&r.status==='pendente');if(!r)throw Error('Solicitação indisponível.');openDialog('Confirmar solicitação de teste',`<p class="subtitle">${esc(r.name)} · ${esc(r.phone)}</p><div class="field"><label for="d-match">Paciente — confira a identidade</label><select id="d-match" name="match"><option value="new">Novo cadastro com dados do pedido</option>${state.patients.map(p=>`<option value="${p.id}">${esc(p.name)} · ${esc(p.phone)}</option>`).join('')}</select></div><div class="field"><label for="d-professional">Profissional</label><select id="d-professional" name="professionalId">${professionalOptions(state)}</select></div><div class="field-grid">${field('Dia confirmado','date',r.date,'date','required')}${field('Horário confirmado','time','14:00','time','required')}${field('Duração (minutos)','duration',60,'number','required min="5" max="480"')}${field('Atendimento','service',r.interest,'text','required maxlength="120"')}</div>`,async f=>{const match=f.get('match'),appointment={id:uid(),professionalId:f.get('professionalId'),date:f.get('date'),time:f.get('time'),duration:Number(f.get('duration')),service:String(f.get('service')).trim(),status:'confirmado'};await persist(s=>confirmSiteRequest(s,{requestId:id,patientId:match==='new'?undefined:match,newPatient:match==='new'?{id:uid(),name:r.name,phone:r.phone}:undefined,appointment}));agendaDate=appointment.date;});}
async function attend(id){const a=state.appointments.find(a=>a.id===id);if(!a||a.status==='cancelado')throw Error('Agendamento indisponível.');let v=state.visits.find(v=>v.appointmentId===id);if(!v){const newId=uid();await persist(s=>createVisit(s,{id:newId,patientId:a.patientId,appointmentId:a.id}));v=state.visits.find(v=>v.id===newId);}navigate(`paciente/${v.patientId}/${v.id}/registro`);}
function procedureOptions(value='',optional=false){return `<div class="field"><label for="d-procedure">Procedimento${optional?' (opcional)':''}</label><select id="d-procedure" name="procedureId" ${optional?'':'required'}><option value="">${optional?'Sem vínculo ao catálogo':'Selecione o procedimento'}</option>${state.procedures.filter(p=>p.active!==false||p.id===value).map(p=>`<option value="${esc(p.id)}" ${p.id===value?'selected':''} ${p.active===false?'disabled':''}>${esc(p.name)}${p.active===false?' · inativo':''} · ${esc(RECORD_MODE_LABELS[p.recordMode||'injectable'])}</option>`).join('')}</select></div>`;}
function newVisit(){if(!clean())return;if(!(state.procedures||[]).some(p=>p.active!==false)){toast('Cadastre um procedimento ativo no Catálogo antes de abrir uma consulta.',true);return;}const pid=patientId;openDialog('Nova consulta de teste',procedureOptions()+`<div class="field"><label for="d-professional">Profissional</label><select id="d-professional" name="professionalId">${professionalOptions(state)}</select></div>`+field('Data','date',dateKey(),'date','required')+'<div class="field"><label for="d-notes">Observações iniciais</label><textarea id="d-notes" name="notes" maxlength="4000" rows="3"></textarea></div><p class="small-label">O tipo de registro e a versão do procedimento serão preservados nesta consulta.</p>',async f=>{const id=uid();await persist(s=>createVisit(s,{id,patientId:pid,procedureId:f.get('procedureId'),professionalId:f.get('professionalId'),date:f.get('date'),notes:f.get('notes')}));setTimeout(()=>navigate(`paciente/${pid}/${id}/documentos`),0);});}
function billDialog(){openDialog('Nova cobrança de teste',patientOptions(patientId)+field('Descrição','description','','text','required maxlength="120"')+`<div class="field-grid">${field('Valor cobrado (R$)','total','','text','inputmode="decimal" required')}${field('Custo variável (R$)','cost','0,00','text','inputmode="decimal" required')}</div>`,async f=>{const b={id:uid(),patientId:f.get('patientId'),description:String(f.get('description')).trim(),date:dateKey(),total:cents(f.get('total')),cost:cents(f.get('cost'))};if(!b.total)throw Error('Informe um valor maior que zero.');await persist(s=>{if(!s.patients.some(p=>p.id===b.patientId)||!b.description)throw Error('Confira a paciente e a descrição.');s.bills.push(b);});});}
function receiveDialog(id){const b=state.bills.find(b=>b.id===id),balance=billBalance(b,state.payments),operationId=uid();openDialog('Registrar recebimento',`<p class="subtitle" style="margin-bottom:18px">${esc(patient(b.patientId)?.name)} · Saldo ${money(balance)}</p>`+field('Valor recebido (R$)','amount',(balance/100).toFixed(2).replace('.',','),'text','inputmode="decimal" required')+'<div class="field"><label for="d-method">Forma de recebimento</label><select id="d-method" name="method"><option>Pix</option><option>Dinheiro</option><option>Cartão</option></select></div>',async f=>{const p={id:uid(),operationId,billId:id,amount:cents(f.get('amount')),date:dateKey(),method:f.get('method')};await persist(s=>{paymentCheck(p,s);s.payments.push(p);});});}
async function ingest(file){if(!file)return;if(!visit())throw Error('Abra uma consulta antes de adicionar fotos.');assertVisitEditable(visit());if(!clean())return;if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>8*1024*1024)throw Error('Use uma foto JPEG, PNG ou WebP de até 8 MB.');const vId=visitId,pId=patientId,photoNumber=visit().photos.length+1;if(importing)throw Error('Aguarde a foto anterior.');importing=true;let bitmap;try{bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});if(bitmap.width*bitmap.height>40000000)throw Error('Imagem grande demais. Utilize uma foto com até 40 megapixels.');const scale=Math.min(1,1800/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);const ctx=canvas.getContext('2d',{alpha:false});ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);const preview=await new Promise(r=>canvas.toBlob(r,'image/webp',.92));if(!preview)throw Error('Não foi possível preparar a foto.');const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join('');const meta={id:uid(),label:'Foto '+photoNumber+' · teste',phase:'registro',revision:hash,width:canvas.width,height:canvas.height,sha256:hash};await persist(s=>{const v=s.visits.find(v=>v.id===vId&&v.patientId===pId);assertVisitEditable(v);if(v.photos.some(p=>p.sha256===hash))throw Error('Esta mesma fotografia já está na consulta. Abra a foto existente.');v.photos.push(meta);v.maps[meta.id]={version:0,points:[],history:[]};},{id:meta.id,original:file,preview});photoId=meta.id;toast(isConnected()?'Foto salva no servidor. O original foi preservado.':'Foto salva neste navegador. O original foi preservado.');await render();}finally{bitmap?.close();importing=false;}}
function drawExportAnnotations(ctx,points,width,height){
 // Validate traces before painting; a malformed stroke must not silently vanish
 // from an otherwise successful export or acquire a fabricated quantity.
 for(const point of points)if(point.kind==='traco')annotationCheck(point);
 // Clip the drawing, not the clinical coordinates: a fan at an image edge
 // must not paint into the legend, and its stored endpoints stay unchanged.
 const scale=width/1000;
 ctx.save();ctx.beginPath();ctx.rect(0,0,width,height);ctx.clip();
 for(const [index,point] of points.entries()){
  const x=point.x*width,y=point.y*height;
  ctx.strokeStyle='#754859';ctx.fillStyle='#a3657b0d';ctx.lineWidth=(point.kind==='leque'?1.5:1.75)*scale;
  if(point.kind==='traco'){
   ctx.save();ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();ctx.moveTo(x,y);
   for(const vertex of point.vertices.slice(1))ctx.lineTo(vertex.x*width,vertex.y*height);
   ctx.stroke();ctx.restore();
  }
  if(point.kind==='linha'){ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(point.x2*width,point.y2*height);ctx.stroke();}
  if(point.kind==='leque'){
   for(const ray of fanRays(point,width/height)){ctx.beginPath();ctx.moveTo(ray.x1*width,ray.y1*height);ctx.lineTo(ray.x2*width,ray.y2*height);ctx.stroke();}
  }
  ctx.beginPath();ctx.arc(x,y,11*scale,0,Math.PI*2);ctx.fillStyle='#754859';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=1.5*scale;ctx.stroke();
  ctx.fillStyle='#fff';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=`600 ${11*scale}px sans-serif`;ctx.fillText(index+1,x,y);
 }
 ctx.restore();
}
function savedMapProcedureLabel(point,v){
 if(Object.hasOwn(point,'procedureId'))return point.procedureId===null?'Nenhum procedimento definido':point.procedureSnapshot?.name||'Procedimento não informado';
 return v?.procedureSnapshot?.name||v?.service||'Procedimento não informado';
}
async function exportMap(){
 if(dirty||pending||drag?.moved)throw Error('Salve ou cancele a edição antes de exportar.');
 const p=photo(),doc=map(),img=$('map-photo');if(!p||!img.complete||!img.naturalWidth||!img.naturalHeight)throw Error('Aguarde a fotografia.');
 const w=img.naturalWidth,h=img.naturalHeight,footer=110+doc.points.length*38,canvas=document.createElement('canvas');canvas.width=w;canvas.height=h+footer;
 const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h+footer);ctx.drawImage(img,0,0,w,h);drawExportAnnotations(ctx,doc.points,w,h);
 ctx.textAlign='left';ctx.textBaseline='alphabetic';ctx.fillStyle='#30262c';ctx.font=`600 ${w*.021}px sans-serif`;
 ctx.fillText('Ana Maria Jacob · '+(isConnected()?'HOMOLOGAÇÃO':'PILOTO LOCAL')+' / SEM VALIDADE DE PRONTUÁRIO',25,h+34);ctx.font=`${w*.017}px sans-serif`;
 ctx.fillText(`Registro manual · ${visit().date} · versão ${doc.version} · ${p.label}`,25,h+65);
 doc.points.forEach((point,index)=>ctx.fillText((point.kind==='traco'?`${index+1}. ${point.region} · Desenho livre${point.product?' · '+point.product:''}${point.lot?' · lote '+point.lot:''}`:`${index+1}. ${point.region} · ${point.product||'produto não informado'}${point.quantity!==null?' · '+point.quantity+' '+point.unit:''}${point.lot?' · lote '+point.lot:''}`)+' · procedimento: '+savedMapProcedureLabel(point,visit()),25,h+100+index*38,w-50));
 const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('Não foi possível exportar a imagem. Tente novamente.');
 download(blob,'mapa-teste-ana-maria-jacob.png');toast('Imagem de teste exportada com a legenda.');
}
function download(blob,name){const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);}
document.addEventListener('click',async e=>{const a=e.target.closest('a[href^="#"]');if(a){e.preventDefault();if(a.getAttribute('href')==='#content'){document.getElementById('content').focus();return;}navigate(a.getAttribute('href').slice(1));return;}if(busy||importing){toast('Aguarde o registro em andamento.');return;}const marker=e.target.closest('[data-marker]');if(marker){if(marker.dataset.marker!=='pending'&&!drag?.moved)selectPoint(marker.dataset.marker);return;}const button=e.target.closest('[data-action]');if(!button)return;const {action,id}=button.dataset;try{if(action==='new-appointment')appointmentDialog();else if(action==='edit-appointment')appointmentDialog(id);else if(action==='new-patient')newPatient();else if(action==='edit-patient')newPatient(id);else if(action==='attend')await attend(id);else if(action==='new-visit')newVisit();else if(action==='print-visit'){if(!clean())return;window.print();}else if(action==='new-bill')billDialog();else if(action==='receive')receiveDialog(id);else if(action==='today'){if(!clean())return;agendaDate=dateKey();await render();}else if(action==='select-point')selectPoint(id);else if(action==='toggle-map-batch'){if(!mapCanEdit()||!clean())return;mapBatchMode=!mapBatchMode;mapBatch=mapBatchMode?newMapBatch():null;clearPoint();}else if(action==='select-batch-point')selectBatchPoint(id);else if(action==='edit-map-batch'){if(mapBatch?.items.length)selectBatchPoint(batchItem()?.point.id||mapBatch.items[0].point.id);}else if(action==='batch-previous-point')moveBatchSelection('previous');else if(action==='batch-next-point')moveBatchSelection('next');else if(action==='continue-map-batch')continueMapBatch();else if(action==='save-map-batch')await saveMapBatch();else if(action==='discard-map-batch')discardMapBatch();else if(action==='cancel-point'){if(mapBatch)removeBatchMark();else clearPoint();}else if(action==='tool'){if(mapBatch){captureBatchForm();}else{if(!clean())return;clearPoint();}tool=id;document.querySelectorAll('[data-action="tool"]').forEach(b=>{b.classList.toggle('active',b.dataset.id===tool);b.setAttribute('aria-pressed',b.dataset.id===tool);});$('map-instruction').textContent=tool==='traco'?'Desenhe sobre a foto com o dedo ou mouse. Solte, identifique e salve.':tool==='ponto'?'Toque na foto para criar um ponto.':'Toque no início e no fim da marcação.';drawMap();}else if(action==='map-focus'){const layout=document.querySelector('.map-layout'),focused=layout.classList.toggle('is-focused');button.textContent=focused?'Voltar ao prontuário':'Ampliar editor';button.setAttribute('aria-pressed',String(focused));fitMapPlane();}else if(action==='new-map-point')createMapDraft();else if(action==='move-map-point')moveMapPoint(id);else if(action==='map-zoom')setMapZoom(Number(id));else if(action==='zoom-in'||action==='zoom-out'){const next=action==='zoom-in'?MAP_ZOOM_LEVELS.find(level=>level>zoom):[...MAP_ZOOM_LEVELS].reverse().find(level=>level<zoom);if(next!==undefined)setMapZoom(next);}else if(action==='toggle-markers'){const hidden=$('photo-stage').classList.toggle('no-markers');button.textContent=hidden?'Mostrar marcações':'Ocultar marcações';}else if(action==='delete-point'){const deletedId=selectedId;if(!deletedId)return;await updateMap(doc=>({...doc,points:doc.points.filter(p=>p.id!==deletedId)}));clearPoint();toast('Marcação removida do piloto. Você pode desfazer.');}else if(action==='undo-map'){if(!clean())return;const vId=visitId,fId=photoId;await persist(s=>{const v=s.visits.find(v=>v.id===vId);assertVisitEditable(v);const doc=v.maps[fId];if(!doc.history.length)throw Error('Nada para desfazer.');doc.points=doc.history.pop();doc.version++;});clearPoint();toast('Última alteração desfeita no piloto.');}else if(action==='open-photo-map'){photoId=id;navigate(`paciente/${patientId}/${visitId}/mapa`);}else if(action==='photo-phase'){const p=visit().photos.find(p=>p.id===id),vId=visitId;openDialog('Classificar fotografia',field('Nome da foto','label',p.label,'text','required maxlength="100"')+`<div class="field"><label for="d-phase">Momento</label><select id="d-phase" name="phase">${['registro','antes','depois'].map(x=>`<option value="${x}" ${p.phase===x?'selected':''}>${x}</option>`).join('')}</select></div>`,async f=>{await persist(s=>{const v=s.visits.find(v=>v.id===vId);assertVisitEditable(v);const ph=v.photos.find(p=>p.id===id);ph.label=String(f.get('label')).trim();ph.phase=f.get('phase');});});}else if(action==='export-map')await exportMap();}catch(error){toast(error.message,true);}});
document.addEventListener('click',e=>{const plane=e.target.closest('#photo-plane');if(tool==='traco'||!mapCanEdit()||!plane||e.target.closest('[data-marker]')||drag?.moved)return;if(mapBatchMode){if(!prepareMapBatch())return;const image=$('map-photo');if(!image?.complete||!image.naturalWidth)return;const at=normalizedPoint(e.clientX,e.clientY,plane.getBoundingClientRect()),item=batchItem();if(item&&tool!=='ponto'&&item.point.kind===tool&&item.point.x2===undefined){captureBatchForm();item.point={...item.point,x2:at.x,y2:at.y};pending=item.point;fillMapGeometry(item.point);captureBatchForm();dirty=true;editGeneration++;drawMap();}else addBatchMark({kind:tool,...at});return;}if(selectedId||dirty){if(!clean())return;clearPoint();}if(!$('map-photo')?.complete||!$('map-photo').naturalWidth)return;const rect=plane.getBoundingClientRect(),at=normalizedPoint(e.clientX,e.clientY,rect);if(tool!=='ponto'&&!pending){pending={id:'pending',kind:tool,...at,...(tool==='leque'?{fanSpread:DEFAULT_FAN_SPREAD}:{})};fillMapGeometry(pending);$('map-instruction').textContent='Agora toque no ponto final da linha ou leque.';drawMap();$('save-point').disabled=true;return;}if(tool!=='ponto'&&pending&&pending.x2===undefined){pending={...pending,x2:at.x,y2:at.y};}else pending={id:'pending',kind:tool,...at,...(tool==='leque'?{fanSpread:DEFAULT_FAN_SPREAD}:{})};dirty=true;editGeneration++;$('point-region').value='Marcação '+(map().points.length+1);fillMapGeometry(pending);drawMap();$('point-state').textContent='Ainda não salva';if(e.detail===0||!window.matchMedia('(max-width: 620px), (pointer: coarse)').matches)$('point-region').focus();});
document.addEventListener('pointerdown',e=>{
 const marker=e.target.closest('[data-marker]');
 if(tool==='traco'&&!marker&&e.target.closest('#photo-plane')){startMapTrace(e);return;}
 if(['linha','leque'].includes(tool)&&!marker&&e.target.closest('#photo-plane')){startMapShape(e);return;}
 if(drag||!mapCanEdit()||e.button!==0||!marker||marker.dataset.marker==='pending'||pending&&!mapBatch||dirty&&!mapBatch&&selectedId!==marker.dataset.marker)return;
 const item=batchItem(marker.dataset.marker),point=item?.point||map().points.find(p=>p.id===marker.dataset.marker);if(!point||mapBatch?.items.length&&!item)return;
 let original;try{original=item?(pending?.id===point.id?readMapGeometry(point):batchPreview(item)):selectedId===point.id?readMapGeometry(point):point;}catch(error){toast(error.message,true);return;}
 drag={id:point.id,pointerId:e.pointerId,startX:e.clientX,startY:e.clientY,moved:false,marker,original:structuredClone(original)};
 try{marker.setPointerCapture(e.pointerId);}catch{drag=null;return;}
 setMapGestureControls(true);
});
document.addEventListener('pointermove',e=>{
 if(!drag||e.pointerId!==drag.pointerId)return;
 if(drag.trace){extendMapTrace(e);return;}
 if(drag.shape){extendMapShape(e);return;}
 if(Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)<5&&!drag.moved)return;
 drag.moved=true;drag.preview=translateAnnotation(drag.original,normalizedPoint(e.clientX,e.clientY,$('photo-plane').getBoundingClientRect()));
 drag.marker.style.left=drag.preview.x*100+'%';drag.marker.style.top=drag.preview.y*100+'%';
 // Keep the captured button in the DOM, while previewing the entire line/fan.
 $('map-svg').innerHTML=mapDisplayPoints().map(point=>shapeSvg(point.id===drag.id?drag.preview:point,batchItem(point.id)?'#ddad50':'#aa8537')).join('');
});
document.addEventListener('pointerup',e=>{
 if(!drag||e.pointerId!==drag.pointerId)return;
 const current=drag;if(current.trace)extendMapTrace(e,true);if(current.shape)extendMapShape(e);current.finishing=true;setMapGestureControls(false);
 if(current.trace){finishMapTrace(current);setTimeout(()=>{if(drag===current)drag=null;},0);return;}
 if(current.shape){finishMapShape(current);setTimeout(()=>{if(drag===current)drag=null;},0);return;}
 if(current.moved){
  if(selectPoint(current.id)&&(selectedId===current.id||batchItem(current.id)&&pending?.id===current.id)){
   fillMapGeometry(current.preview);dirty=true;editGeneration++;drawMap();
   $('point-state').textContent='Posição ainda não salva';toast('Posição ajustada. Toque em Salvar marcação para confirmar.');
  }else drawMap();
 }
 // Suppress the synthetic click after releasing a moved marker.
 setTimeout(()=>{if(drag===current)drag=null;},0);
});

// Pointer samples stay in memory until explicit save. Bound each trace to 256
// normalized vertices, retaining the start/end when a long gesture is reduced.
function startMapShape(event){
 if(drag||!mapCanEdit()||event.button!==0)return;
 const plane=$('photo-plane'),image=$('map-photo');if(!image?.complete||!image.naturalWidth)return;
 if(mapBatchMode){if(!prepareMapBatch())return;captureBatchForm();if(mapBatch.items.length>=MAX_BATCH_MARKINGS&&!batchItem())return;}
 const incomplete=pending?.kind===tool&&pending.x2===undefined?pending:null;
 if(!mapBatchMode&&!incomplete){if(!clean())return;clearPoint();}
 const at=incomplete?{x:incomplete.x,y:incomplete.y}:normalizedPoint(event.clientX,event.clientY,plane.getBoundingClientRect());
 drag={shape:true,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,moved:false,marker:plane,itemId:incomplete?.id,geometry:{kind:tool,...at,...(tool==='leque'?{fanSpread:DEFAULT_FAN_SPREAD}:{})}};
 try{plane.setPointerCapture(event.pointerId);}catch{drag=null;return;}setMapGestureControls(true);
}
function extendMapShape(event){
 if(!drag?.shape||drag.finishing||drag.pointerId!==event.pointerId)return;
 if(!drag.moved&&Math.hypot(event.clientX-drag.startX,event.clientY-drag.startY)<5)return;
 const at=normalizedPoint(event.clientX,event.clientY,$('photo-plane').getBoundingClientRect());drag.moved=true;drag.preview={...drag.geometry,x2:at.x,y2:at.y};
 $('map-svg').innerHTML=mapDisplayPoints().filter(point=>point.id!==drag.itemId).map(point=>shapeSvg(point,batchItem(point.id)?'#ddad50':'#aa8537')).join('')+shapeSvg(drag.preview,'#ddad50');
}
function finishMapShape(gesture){
 if(!gesture.moved){drawMap();return;}if(mapBatchMode){const item=batchItem(gesture.itemId);if(item){item.point={...item.point,...gesture.preview};pending=item.point;fillMapGeometry(item.point);captureBatchForm();dirty=true;editGeneration++;drawMap();}else addBatchMark(gesture.preview);return;}
 pending={id:'pending',...gesture.preview};dirty=true;editGeneration++;$('point-region').value='Marcação '+(map().points.length+1);fillMapGeometry(pending);drawMap();$('point-state').textContent='Ainda não salva';
}
function startMapTrace(event){
 if(drag||!mapCanEdit()||event.button!==0)return;
 const plane=$('photo-plane'),image=$('map-photo');if(!image?.complete||!image.naturalWidth)return;
 if(mapBatchMode){if(!prepareMapBatch())return;captureBatchForm();if(mapBatch.items.length>=MAX_BATCH_MARKINGS){toast('Salve o conjunto antes de adicionar mais marcações.',true);return;}}else{if(!clean())return;clearPoint();}
 const at=normalizedPoint(event.clientX,event.clientY,plane.getBoundingClientRect());
 drag={trace:true,pointerId:event.pointerId,vertices:[at],moved:false,marker:plane};
 try{plane.setPointerCapture(event.pointerId);}catch{drag=null;return;}
 event.preventDefault();setMapGestureControls(true);
}
function extendMapTrace(event,force=false){
 const gesture=drag;if(!gesture?.trace||gesture.finishing||gesture.pointerId!==event.pointerId)return;
 const at=normalizedPoint(event.clientX,event.clientY,$('photo-plane').getBoundingClientRect()),last=gesture.vertices.at(-1);
 if(Math.hypot(at.x-last.x,at.y-last.y)<(force?.00001:.0015))return;
 gesture.vertices.push(at);gesture.moved=true;
 if(gesture.vertices.length>256)gesture.vertices=gesture.vertices.filter((_,i,a)=>i%2===0||i===a.length-1);
 const draft={kind:'traco',vertices:gesture.vertices};
 $('map-svg').innerHTML=mapDisplayPoints().map(p=>shapeSvg(p,batchItem(p.id)?'#ddad50':'#aa8537')).join('')+shapeSvg(draft,'#ddad50');
}
function finishMapTrace(gesture){
 if(gesture.vertices.length<2){drawMap();toast('Deslize sobre a foto para desenhar um traço.');return;}
 if(mapBatchMode){addBatchMark({kind:'traco',...gesture.vertices[0],vertices:gesture.vertices});return;}
 pending={id:'pending',kind:'traco',...gesture.vertices[0],vertices:gesture.vertices,quantity:null,unit:'sem quantidade'};
 dirty=true;editGeneration++;fillMapGeometry(pending);$('point-region').value='Desenho '+(map().points.length+1);
 $('point-state').textContent='Desenho ainda não salvo';drawMap();
}

function mapGestureActive(){return !!drag&&!drag.finishing;}
function setMapGestureControls(value){document.querySelectorAll('.map-toolbar,.map-batch-toolbar,.map-access-toolbar,.photo-picker,.map-footer,.map-side,#point-form').forEach(element=>element.inert=value);}
function cancelMapGesture(event){if(!mapGestureActive()||event.pointerId!==drag.pointerId)return;drag=null;setMapGestureControls(false);drawMap();}
document.addEventListener('pointercancel',cancelMapGesture);
document.addEventListener('lostpointercapture',cancelMapGesture);
document.addEventListener('click',event=>{if(mapGestureActive()){event.preventDefault();event.stopImmediatePropagation();}},{capture:true});
document.addEventListener('keydown',event=>{
 if(mapGestureActive()){event.preventDefault();return;}
 const marker=event.target.closest('[data-marker]'),control=event.target.closest('[data-action="move-map-point"]');
 if(event.target.id==='photo-stage'&&event.key==='Enter'){event.preventDefault();createMapDraft();return;}
 if(!marker&&!control)return;
 const direction={ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down'}[event.key];if(!direction||!mapCanEdit())return;
 event.preventDefault();try{
  if(marker&&marker.dataset.marker!=='pending'&&selectedId!==marker.dataset.marker&&pending?.id!==marker.dataset.marker){if(!selectPoint(marker.dataset.marker))return;}
  moveMapPoint(direction,event.shiftKey);
 }catch(error){toast(error.message,true);}
});
document.addEventListener('input',e=>{if(e.target.closest('#dialog-form'))$('dialog-form').dataset.unsaved='true';if(e.target.closest('#point-form')&&e.target.id!=='map-move-step'){editGeneration++;dirty=true;$('point-state').textContent='Edição não salva';if(e.target.matches('[data-map-coordinate]')||e.target.id==='point-procedure')drawMap();else drawMapLegend(mapDisplayPoints());}if(e.target.id==='visit-notes'){editGeneration++;dirty=true;}});
document.addEventListener('change',async e=>{try{if(mapGestureActive()){if(e.target.id==='photo-select')e.target.value=photoId;return;}if(busy||importing){if(e.target.id==='photo-select')e.target.value=photoId;if(e.target.id==='agenda-date')e.target.value=agendaDate;toast('Aguarde o registro em andamento.');return;}if(e.target.closest('#point-form')&&['point-procedure','point-unit'].includes(e.target.id)){dirty=true;editGeneration++;$('point-state').textContent='Edição não salva';drawMap();return;}if(e.target.id==='agenda-date'){if(!clean()){e.target.value=agendaDate;return;}agendaDate=e.target.value;await render();}if(e.target.id==='photo-select'){if(!clean()){e.target.value=photoId;return;}photoId=e.target.value;selectedId=null;pending=null;mapBatch=null;zoom=1;await render();}if(e.target.id==='photo-upload')await ingest(e.target.files[0]);}catch(error){toast(error.message,true);}});
document.addEventListener('submit',async e=>{
  if(!['point-form','record-form'].includes(e.target.id))return;
  e.preventDefault();if(mapGestureActive())return;if(busy||importing){toast('Aguarde o registro em andamento.');return;}
  if(e.target.id==='point-form'){
    if(mapBatch){await saveMapBatch();return;}
    try{
      const editingId=selectedId, generation=editGeneration;
      const base=readMapGeometry(editingId?map().points.find(p=>p.id===editingId):pending);
      if(!base||!['ponto','traco'].includes(base.kind)&&base.x2===undefined)throw Error('Marque a posição na foto primeiro.');
      const savedPoint=pointFromForm({...base,id:editingId||uid()},captureMapForm());
      $('save-point').disabled=true;
      await updateMap(doc=>({...doc,points:editingId?doc.points.map(x=>x.id===editingId?savedPoint:x):[...doc.points,savedPoint]}));
      if(editGeneration===generation){clearPoint();toast(isConnected()?'Marcação salva no servidor.':'Marcação salva neste navegador.');}
      else{selectedId=savedPoint.id;pending=null;dirty=true;drawMap();$('point-title').textContent='Editar marcação';$('point-state').textContent='Há alterações ainda não salvas';toast('Versão anterior salva. Salve as alterações mais recentes.');}
    }catch(error){$('point-error').textContent=error.message;$('save-point').disabled=false;}
  }else{
    try{
      const id=visitId,notes=$('visit-notes').value.trim(),generation=editGeneration;
      await persist(s=>{const v=s.visits.find(v=>v.id===id);assertVisitEditable(v);v.notes=notes;});
      dirty=editGeneration!==generation||$('visit-notes').value.trim()!==notes;
      $('record-saved').textContent=dirty?' Versão anterior salva. Há alterações pendentes.':(isConnected()?' Rascunho salvo no servidor.':' Rascunho local salvo.');
      toast(dirty?'Versão anterior salva. Salve as alterações mais recentes.':'Rascunho salvo no piloto.');
    }catch(error){toast(error.message,true);}
  }
});
$('dialog-form').addEventListener('submit',async e=>{e.preventDefault();if(busy||importing)return;const b=e.target.querySelector('[type=submit]');b.disabled=true;try{await dialogSubmit(new FormData(e.target));delete e.target.dataset.unsaved;$('dialog').close();toast('Registro salvo no piloto local.');await render();}catch(error){$('dialog-error').textContent=error.message;}finally{b.disabled=false;}});
function discardNativeDialog(){if(busy||importing)return false;if($('dialog-form').dataset.unsaved&&!confirm('Há alterações não salvas no formulário. Descartar?'))return false;delete $('dialog-form').dataset.unsaved;return true;}
$('close-dialog').onclick=$('cancel-dialog').onclick=()=>{if(discardNativeDialog())$('dialog').close();};
$('dialog').addEventListener('cancel',e=>{if(!discardNativeDialog())e.preventDefault();});
window.addEventListener('hashchange',()=>{void setHash().catch(error=>toast(error.message,true));});window.addEventListener('beforeunload',e=>{if(dirty||pending||busy||importing||editorsDirty()||editorsBusy()||integrationHandle?.isDirty()||integrationHandle?.isBusy()||comparisonHandle?.isDirty()||comparisonHandle?.isBusy()||document.querySelector('form[data-unsaved]')){e.preventDefault();e.returnValue='';}});
document.addEventListener('click',e=>{const b=e.target.closest('[data-action="schedule-request"]');if(b)try{scheduleRequest(b.dataset.id);}catch(error){toast(error.message,true);}});
document.addEventListener('visibilitychange',async()=>{if(connectionEnded||document.visibilityState!=='visible'||editorsDirty()||editorsBusy()||integrationHandle?.isDirty()||integrationHandle?.isBusy()||comparisonHandle?.isDirty()||comparisonHandle?.isBusy()||dirty||pending||document.querySelector('form[data-unsaved]')||busy||importing||document.querySelector('dialog[open]')||!state)return;const previousRevision=state.revision,previousRender=renderSeq;try{const latest=await load();if(connectionEnded||!state||editorsDirty()||editorsBusy()||integrationHandle?.isDirty()||integrationHandle?.isBusy()||comparisonHandle?.isDirty()||comparisonHandle?.isBusy()||dirty||pending||document.querySelector('form[data-unsaved]')||busy||importing||document.querySelector('dialog[open]')||state.revision!==previousRevision||renderSeq!==previousRender)return;if(latest.revision!==state.revision){state=latest;await render();}}catch(error){toast(error.message,true);}});
$('area-switch').addEventListener('change',e=>{navigate(e.target.value);e.target.value=route==='paciente'?'pacientes':route;});
$('date-label').textContent=new Date().toLocaleDateString('pt-BR',{day:'numeric',month:'long',year:'numeric'});
window.addEventListener('resize',()=>fitMapPlane());
window.addEventListener('amj:connection-invalidated',()=>{
 connectionEnded=true;visitRecordDispose?.();visitRecordDispose=null;state=null;renderSeq++;editGeneration++;dirty=false;pending=null;mapBatch=null;drag=null;selectedId=null;dialogSubmit=null;
 patientId=visitId=photoId=undefined;patientView={query:'',filter:'all',color:'all'};comparisonSelections.clear();
 disposeAuxiliary();clinicalBridgeHandle?.dispose();facialHandle?.dispose();patientsHandle?.dispose();patientEditor?.dispose();comparisonHandle?.dispose();integrationHandle?.dispose();agendaDispose?.();mapFitObserver?.disconnect();
 clinicalBridgeHandle=facialHandle=patientsHandle=patientEditor=comparisonHandle=integrationHandle=agendaDispose=mapFitObserver=null;
 for(const url of objectUrls.values())URL.revokeObjectURL(url);objectUrls.clear();
 $('content').replaceChildren();$('nav').replaceChildren();$('area-switch').replaceChildren();$('crumb').textContent='Acesso encerrado';
 document.querySelectorAll('dialog').forEach(d=>{d.close();d.removeAttribute('open');if(d.id==='dialog'){$('dialog-form').reset();delete $('dialog-form').dataset.unsaved;$('dialog-fields').replaceChildren();$('dialog-title').textContent='';$('dialog-error').textContent='';d.inert=true;}else{d.replaceChildren();d.remove();}});
 clearTimeout(toastTimer);$('toast').textContent='';$('toast').className='toast';
});
window.addEventListener('amj:cloud-refresh',()=>{if(!connectionEnded&&!busy&&!importing&&clean())void setHash().catch(e=>toast(e.message,true));});
window.addEventListener('amj:before-sign-out',event=>{if(busy||importing||editorsBusy()||auxiliaryUncertain()||clinicalBridgeHandle?.hasUncertain()){event.preventDefault();toast('Confira a gravação em andamento antes de sair da conta.',true);}});
window.addEventListener('amj:cloud-reload-request',async event=>{if(connectionEnded||busy||importing||!clean())return;busy=true;lockInterface(true);try{const latest=await event.detail.refresh();if(connectionEnded)return;state=latest;await render();}catch(error){toast(error.message,true);}finally{busy=false;lockInterface(false);}});
window.addEventListener('amj:cloud-reconcile-request',async event=>{
 if(connectionEnded||busy||importing||editorsBusy()||comparisonHandle?.isBusy()||auxiliaryUncertain()||clinicalBridgeHandle?.hasUncertain())return;
 if(typeof event.detail?.reconcile!=='function')return;
 const hasEdits=dirty||pending||editorsDirty()||comparisonHandle?.isDirty()||document.querySelector('form[data-unsaved]');
 if(hasEdits&&!confirm('Recuperar a última gravação recusada? Se ela for confirmada, a tela mostrará essa versão. Alterações digitadas depois da tentativa não fazem parte da recuperação. Se falhar, a edição atual será mantida.'))return;
 const dialogs=[...document.querySelectorAll('dialog')].map(element=>({element,inert:element.inert}));
 busy=true;lockInterface(true);dialogs.forEach(({element})=>element.inert=true);
 try{
  const latest=await event.detail.reconcile();if(connectionEnded)return;
  state=latest;dirty=false;pending=null;mapBatch=null;selectedId=null;editGeneration++;
  document.querySelectorAll('form[data-unsaved]').forEach(form=>delete form.dataset.unsaved);
  document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());
  await render();toast('Gravação recuperada e confirmada no servidor.');
 }catch(error){toast(error.message,true);}
 finally{busy=false;if(!connectionEnded){lockInterface(false);dialogs.forEach(({element,inert})=>{if(element.isConnected)element.inert=inert;});}}
});
try{await setHash();}catch(e){$('content').innerHTML='<div class="card card-body"><h1>Não foi possível abrir os dados.</h1><p>Confira a conexão ou o armazenamento do navegador. Nenhuma gravação foi confirmada nesta tela.</p></div>';toast(e.message,true);}
