import {PUBLIC_BACKEND} from './integration/public-backend.mjs';

const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const id=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(value);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const text=(value,max=300)=>typeof value==='string'?value.slice(0,max):'';
const kinds=new Set(['anamnese','documento_clinico']);
const requestStatus={pending:'Pendente de atendimento',accepted:'Recebida no CRM',archived:'Arquivada'};
const day=value=>{if(!value)return'Não informada';const d=new Date(String(value).length===10?value+'T12:00:00Z':value);return Number.isFinite(d.getTime())?d.toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'}):'Não informada';};
const official='https://anamariajacob.com.br';
export const OFFICIAL_CLINICAL_FORMS=Object.freeze([
  ['anamnese','Ficha de anamnese','/anamnese/'],
  ['toxina','Termo de toxina botulínica','/tcle-toxina/'],
  ['preenchimento','Termo de preenchimento facial','/tcle-preenchimento/'],
  ['intradermoterapia','Pré-avaliação: intradermoterapia','/tcle-intradermoterapia/'],
  ['bioestimulador','Pré-avaliação: bioestimulador','/tcle-bioestimulador/'],
  ['peeling','Pré-avaliação: peeling químico','/tcle-peeling-quimico/'],
  ['fios','Pré-avaliação: fios de PDO','/tcle-fios-pdo/'],
].map(([key,label,path])=>Object.freeze({key,label,url:official+path})));

function pagination(value,count){
  const p=value||{},limit=Number.isInteger(p.limit)&&p.limit>0&&p.limit<=100?p.limit:25,offset=Number.isInteger(p.offset)&&p.offset>=0?p.offset:0;
  return{limit,offset,hasMore:p.has_more===true,total:Number.isInteger(p.total)&&p.total>=count?p.total:null};
}
export function normalizeBridgeDocuments(result,{source='workspace'}={}){
  let rows;
  if(source==='legacy'){
    if(!Array.isArray(result?.fichas)||!Array.isArray(result?.documentos))throw Error('O serviço não confirmou a lista de documentos originais.');
    rows=[...result.fichas.map(d=>({...d,source_kind:'anamnese'})),...result.documentos.map(d=>({...d,source_kind:'documento_clinico'}))].map(d=>({
      source_kind:d.source_kind,source_id:d.id,title:d.tipo_label||(d.source_kind==='anamnese'?'Anamnese':'Documento clínico'),
      status:d.status||'recebido',received_at:d.recebido_em||d.criado_em,identity:{name:d.nome,phone_masked:d.telefone},
      archived:Boolean(d.arquivado_em),withdrawn:false,eligible_for_link:false,source_fingerprint:null,pdf:d.pdf,
      blockers:['Vínculo indisponível na consulta do serviço anterior.'],clinical_authorization:false,
    }));
  }else{if(!Array.isArray(result?.documents))throw Error('O serviço não confirmou a lista de documentos originais.');rows=result.documents;}
  if(rows.length>2000)throw Error('A lista excedeu o limite de leitura desta tela. Use o painel operacional.');
  const seen=new Set(),documents=rows.map(d=>{
    if(!d||!kinds.has(d.source_kind)||!id(d.source_id))throw Error('A lista contém uma referência de documento inválida.');
    const key=d.source_kind+':'+d.source_id;if(seen.has(key))throw Error('A lista contém uma referência repetida.');seen.add(key);
    return{key,source_kind:d.source_kind,source_id:d.source_id,title:text(d.title)||'Documento clínico',status:text(d.status,30),received_at:text(d.received_at,40),
      identity:{name:text(d.identity?.name,160)||'Nome não informado',cpf_masked:text(d.identity?.cpf_masked,30),phone_masked:text(d.identity?.phone_masked,40),birth_date:text(d.identity?.birth_date,10)},
      archived:d.archived===true,withdrawn:d.withdrawn===true,eligible_for_link:d.eligible_for_link===true,
      source_fingerprint:hash(d.source_fingerprint)?d.source_fingerprint:null,pdf_sha256:hash(d.pdf_sha256)?d.pdf_sha256:null,
      legacyPdf:source==='legacy'?text(d.pdf,6000):null,blockers:Array.isArray(d.blockers)?d.blockers.map(v=>text(v,160)).filter(Boolean).slice(0,15):[],clinical_authorization:false};
  });
  return{documents,pagination:source==='legacy'?{limit:2000,offset:0,hasMore:false,total:documents.length}:pagination(result.pagination,documents.length),source,
    capabilities:{link_received:source!=='legacy'&&result.capabilities?.link_received===true,clinical_authorization:false,professional_signature:false}};
}
export function normalizeBridgeRequests(result){
  if(!Array.isArray(result?.solicitacoes_site)||result.solicitacoes_site.length>100)throw Error('O serviço não confirmou a lista de solicitações do site.');
  const seen=new Set(),requests=result.solicitacoes_site.map(r=>{if(!r||!id(r.id)||seen.has(r.id))throw Error('A lista contém uma solicitação inválida ou repetida.');seen.add(r.id);return{
    id:r.id,name:text(r.nome,160)||'Nome não informado',phone:text(r.telefone,40),interest:text(r.interesse,300),preferredDate:text(r.data_preferida,20),period:text(r.periodo,80),receivedAt:text(r.recebido_em,40),
    status:Object.hasOwn(requestStatus,r.status)?r.status:'unknown',consent:r.consentimento_contato===true,leadId:id(r.lead_id)?r.lead_id:null,
  };});
  return{requests,pagination:pagination(result.paginacao,requests.length)};
}
export function trustedOriginalPDF(value,origin=PUBLIC_BACKEND.supabaseUrl){
  try{if(typeof value!=='string'||value.length>6000||/(?:^|\/)(?:\.|%2e){1,2}(?:\/|$|[?#])/i.test(value))return null;const u=new URL(value),base=new URL(origin);if(u.protocol!=='https:'||u.origin!==base.origin||u.username||u.password||u.hash)return null;
    const parts=u.pathname.split('/');if(parts.slice(0,5).join('/')!=='/storage/v1/object/sign'||!['fichas-pdf','documentos-clinicos'].includes(parts[5])||parts.length<7||!u.searchParams.get('token'))return null;
    if(parts.slice(6).some(p=>{const v=decodeURIComponent(p);return!v||v==='.'||v==='..'||/[\\/\0%]/.test(v);} ))return null;
    return u.href;
  }catch{return null;}
}
export function normalizeBridgeLinks(result,context){
  if(!Array.isArray(result?.links)||result.links.length>2000)throw Error('Não foi possível confirmar os vínculos desta consulta.');
  return result.links.map(l=>{
    if(!l||!kinds.has(l.source_kind)||!id(l.source_id)||l.patient_id!==context.patientId||l.visit_id!==context.visitId||l.status!=='vinculado_recebido'||l.clinical_authorization!==false)throw Error('O serviço retornou um vínculo de outro contexto ou incompatível.');
    return{source_kind:l.source_kind,source_id:l.source_id,patient_id:l.patient_id,visit_id:l.visit_id,status:l.status,
      current_identity_matches:l.current_identity_matches===true,available:l.available===true,clinical_authorization:false};
  });
}
export function validateOpenedOriginal(result,selected){
  const d=result?.document,pdf=result?.pdf;
  if(!d||d.source_kind!==selected.source_kind||d.source_id!==selected.source_id||d.source_fingerprint!==selected.source_fingerprint)throw Error('O documento mudou ou retornou outro vínculo. Atualize a lista antes de abrir.');
  if(!hash(pdf?.sha256)||selected.pdf_sha256&&pdf.sha256!==selected.pdf_sha256||!Number.isInteger(pdf.expires_in)||pdf.expires_in<1||pdf.expires_in>900)throw Error('O servidor não confirmou a integridade e o prazo do arquivo.');
  const url=trustedOriginalPDF(pdf.url);if(!url)throw Error('O endereço do PDF não pertence ao armazenamento autorizado.');return url;
}

function officialForms(){return`<details class="cb-official"><summary>Formulários oficiais para a paciente</summary><p>Abrem os formulários existentes. Nenhuma mensagem é enviada por esta tela.</p><div class="cb-form-links">${OFFICIAL_CLINICAL_FORMS.map(f=>`<a class="secondary" href="${f.url}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">${e(f.label)} ↗</a>`).join('')}</div></details>`;}
export function renderClinicalBridge({section='documents',context=null}={}){
  const documents=section!=='requests';
  return`<section class="clinical-bridge" aria-label="Documentos originais e solicitações do site"><header class="cb-heading"><div><p class="eyebrow">ÁREA PRIVADA</p><h2>${documents?'Documentos recebidos':'Solicitações do site'}</h2><p>Consulte os registros originais recebidos pela clínica.</p></div><a class="secondary" href="${official}/painel/" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">Painel operacional ↗</a></header>
    <nav class="cb-tabs" aria-label="Consultar origem"><button type="button" data-cb="section" data-section="documents" aria-pressed="${documents}">Documentos originais</button><button type="button" data-cb="section" data-section="requests" aria-pressed="${!documents}">Pedidos do site</button></nav>
    ${context?.visitId?`<p class="cb-context">Consulta selecionada: ${e(context.visitLabel||context.visitId)} · ${e(context.patientName||'Paciente do prontuário')}. A busca consulta originais da clínica; aparecer nesta lista não vincula o documento à paciente.</p>`:''}
    <div data-cb-controls></div><p class="cb-feedback" data-cb-feedback role="status" aria-live="polite"></p><div data-cb-link-editor></div><div data-cb-content></div><div data-cb-page></div>
    <div data-cb-forms ${documents?'':'hidden'}>${officialForms()}</div><p class="cb-limits" data-cb-limits>${documents?'Recebido, vinculado e revisado são situações diferentes. Receber ou vincular um documento não autoriza um procedimento. A assinatura de demonstração permanece indisponível no ambiente conectado.':'Uma solicitação recebida ou aceita no CRM não confirma horário. A confirmação operacional continua no painel da clínica.'}</p></section>`;
}

function documentCards(docs,links,linksKnown,context,capabilities){return docs.length?`<div class="cb-records">${docs.map(d=>{
  const link=linksKnown&&links.find(l=>l.source_kind===d.source_kind&&l.source_id===d.source_id&&l.patient_id===context?.patientId&&l.visit_id===context?.visitId&&l.status==='vinculado_recebido');
  const validLink=link?.available===true&&link.current_identity_matches===true;
  const received=d.status==='recebido'?'Recebido':d.status==='legado'?'Registro legado':'Estado de recebimento não confirmado';
  return`<article class="cb-record"><div class="cb-record-top"><div><span class="cb-kind">${d.source_kind==='anamnese'?'Anamnese':'Termo / documento'}</span><h3>${e(d.identity.name)}</h3><p>${e(d.title)}</p></div><span class="cb-date">${day(d.received_at)}</span></div><div class="cb-identifiers">${d.identity.cpf_masked?`<span>CPF: ${e(d.identity.cpf_masked)}</span>`:''}${d.identity.phone_masked?`<span>Telefone: ${e(d.identity.phone_masked)}</span>`:''}</div>
    <ul class="cb-state-list"><li>${e(received)}${d.archived?' · arquivado':''}${d.withdrawn?' · retirado':''}</li><li>${validLink?'Vinculado a esta consulta':link?'Vínculo histórico indisponível para a identidade atual':context?.visitId?(linksKnown?'Sem vínculo nesta consulta':'Vínculo ainda não consultado'):'Vínculo: abra uma consulta para conferir'}</li><li>A confirmação profissional é feita na conclusão do atendimento</li></ul>
    <div class="cb-record-actions"><button class="secondary" type="button" data-cb="pdf" data-key="${e(d.key)}" ${(!d.source_fingerprint&&!d.legacyPdf)?'disabled':''}>Abrir PDF original ↗</button>${!link&&context?.visitId&&d.eligible_for_link&&capabilities?.link_received&&!context.locked?`<button class="primary" type="button" data-cb="link" data-key="${e(d.key)}">Vincular original</button>`:''}${link?'<span class="cb-link-note">O vínculo preserva o original; não substitui revisão ou assinatura profissional.</span>':''}</div>${context?.visitId&&!link&&!d.eligible_for_link?'<p class="cb-link-note">Vínculo indisponível: confira identidade, recebimento e integridade do original no painel da clínica.</p>':''}</article>`;
  }).join('')}</div>`:'<div class="cb-empty"><h3>Nenhum documento retornado</h3><p>Confira a busca e os filtros. Os formulários oficiais continuam disponíveis abaixo.</p></div>';}
function requestCards(rows){return rows.length?`<div class="cb-records">${rows.map(r=>`<article class="cb-record"><div class="cb-record-top"><div><span class="cb-kind">Solicitação do site</span><h3>${e(r.name)}</h3><p>${e(r.interest||'Interesse não informado')}</p></div><span class="cb-date">${day(r.receivedAt)}</span></div><p>${e(r.phone||'Telefone não informado')}</p><dl class="cb-request-data"><div><dt>Data de preferência</dt><dd>${day(r.preferredDate)}</dd></div><div><dt>Período</dt><dd>${e(r.period||'Não informado')}</dd></div><div><dt>Situação no CRM</dt><dd>${e(requestStatus[r.status]||'Não informada')}</dd></div><div><dt>Consentimento de contato</dt><dd>${r.consent?'Registrado':'Não confirmado'}</dd></div></dl><p class="cb-link-note">Sem confirmação de agenda por esta tela.</p></article>`).join('')}</div>`:'<div class="cb-empty"><h3>Nenhuma solicitação neste filtro</h3><p>Pedidos de preferência de horário aparecem aqui após recebimento pelo site.</p></div>';}

export function mountClinicalBridge(host,{service,section='documents',getContext=()=>null,reloadContext,notify=()=>{},openWindow=(...args)=>window.open(...args),confirmDiscard=message=>host.ownerDocument.defaultView.confirm(message)}={}){
  let disposed=false,invalidated=false,generation=0,busy=false,opening=false,currentSection=section==='requests'?'requests':'documents',query='',status='pending',offset=0,
    documents=[],requests=[],links=[],linksKnown=false,capabilities={},draft=null,saving=false,page={limit:25,offset:0,hasMore:false,total:null};
  const openedWindows=new Set();
  const eventTarget=host.ownerDocument?.defaultView;
  const emit=(message,error=false)=>{const el=host.querySelector('[data-cb-feedback]');if(el){el.textContent=message;el.dataset.error=String(error);}notify(message,error);};
  const context=()=>{const c=getContext()||null;return c?.patientId&&c?.visitId?{patientId:String(c.patientId),visitId:String(c.visitId),patientName:c.patientName,visitLabel:c.visitLabel,revision:c.revision,locked:c.locked===true,cpfMasked:c.cpfMasked,birthDate:c.birthDate}:null;};
  const contextKey=()=>{const c=context();return c?c.patientId+'/'+c.visitId:'';};
  const fields=()=>{host.querySelector('[data-cb-controls]').innerHTML=currentSection==='documents'?`<form data-cb-search class="cb-controls"><label>Buscar documento ou paciente<input name="search" type="search" maxlength="120" value="${e(query)}" autocomplete="off"></label><button class="secondary" type="submit">Buscar</button><button class="subtle" type="button" data-cb="refresh">Atualizar</button></form>`:`<div class="cb-controls"><label>Situação da solicitação<select data-cb-status>${[['pending','Pendentes'],['accepted','Recebidas no CRM'],['archived','Arquivadas'],['all','Todas']].map(([value,label])=>`<option value="${value}" ${value===status?'selected':''}>${label}</option>`).join('')}</select></label><button class="subtle" type="button" data-cb="refresh">Atualizar</button></div>`;};
  function drawShell(){host.innerHTML=renderClinicalBridge({section:currentSection,context:context()});fields();}
  function draw(){if(disposed||invalidated)return;host.querySelector('[data-cb-content]').innerHTML=currentSection==='documents'?documentCards(documents,links,linksKnown,context(),capabilities):requestCards(requests);
    host.querySelector('[data-cb-page]').innerHTML=`<div class="cb-pagination"><span>${(currentSection==='documents'?documents:requests).length} registro(s) nesta página${page.total===null?'':' · '+page.total+' no filtro'}</span><div><button type="button" class="secondary" data-cb="previous" ${page.offset===0?'disabled':''}>Anterior</button><button type="button" class="secondary" data-cb="next" ${!page.hasMore?'disabled':''}>Próxima</button></div></div>`;
  }
  async function refresh(){
    if(disposed||invalidated||draft||saving)return;const rev=++generation,c=context(),binding=contextKey(),requestedSection=currentSection;busy=true;documents=[];requests=[];links=[];linksKnown=false;capabilities={};
    host.querySelector('[data-cb-content]').innerHTML='';host.querySelector('[data-cb-page]').innerHTML='';host.setAttribute('aria-busy','true');emit('Consultando os registros originais…');
    try{
      if(!service)throw Error('A consulta dos originais ainda não está conectada nesta sessão. Use o painel operacional.');
      if(requestedSection==='documents'){
        if(typeof service.listDocuments!=='function')throw Error('Consulta de documentos indisponível nesta sessão.');
        const result=await service.listDocuments({...(c?{patient_id:c.patientId,visit_id:c.visitId}:{}),search:query,limit:25,offset});
        if(disposed||invalidated||rev!==generation||binding!==contextKey())return;
        const loaded=normalizeBridgeDocuments(result,{source:service.source||'workspace'});documents=loaded.documents;page=loaded.pagination;capabilities=loaded.capabilities;
        if(service.source==='legacy'&&query){const needle=query.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();documents=documents.filter(d=>(d.identity.name+' '+d.title).normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().includes(needle));page.total=documents.length;}
        if(c&&typeof service.listLinks==='function'){
          const linked=await service.listLinks({patient_id:c.patientId,visit_id:c.visitId});
          if(disposed||invalidated||rev!==generation||binding!==contextKey())return;
          links=normalizeBridgeLinks(linked,c);linksKnown=true;
        }
      }else{
        if(typeof service.listSiteRequests!=='function')throw Error('Consulta das solicitações indisponível nesta sessão.');
        const result=await service.listSiteRequests({status,limit:25,offset});
        if(disposed||invalidated||rev!==generation||binding!==contextKey())return;
        const loaded=normalizeBridgeRequests(result);requests=loaded.requests;page=loaded.pagination;
      }
      draw();emit('Consulta concluída. Nenhum registro foi alterado.');
    }catch(error){if(!disposed&&!invalidated&&rev===generation){documents=[];requests=[];links=[];linksKnown=false;host.querySelector('[data-cb-content]').innerHTML='<div class="cb-empty"><h3>Consulta indisponível</h3><p>Tente atualizar ou abra o painel operacional da clínica.</p></div>';emit(error?.message||'Não foi possível consultar os registros.',true);}}
    finally{if(rev===generation){busy=false;if(!disposed)host.removeAttribute('aria-busy');}}
  }
  const uncertain=()=>{const p=service?.getPendingLink?.();return!!p&&!p.rejected;};
  function drawLinkEditor(){
    const container=host.querySelector('[data-cb-link-editor]');if(!container||disposed||invalidated)return;
    if(!draft){container.replaceChildren();return;}
    const p=service?.getPendingLink?.(),c=context();
    container.innerHTML=`<section class="cb-link-editor" aria-labelledby="cb-link-heading"><h3 id="cb-link-heading">Conferir e vincular original</h3><p><strong>${e(draft.document.title)}</strong> · ${e(draft.document.identity.name)} · CPF ${e(draft.document.identity.cpf_masked||'não informado')}</p><p>Consulta: ${e(c?.patientName||'Paciente indisponível')} · CPF ${e(c?.cpfMasked||'não informado')} · ${e(c?.visitLabel||'')}</p><p class="cb-link-note">Este vínculo registra o recebimento do original. Não é revisão profissional, assinatura ou autorização para procedimento.</p><form data-cb-link-form data-unsaved="true"><fieldset ${p?'disabled':''}><label class="cb-check"><input name="confirmed" type="checkbox" ${draft.confirmed?'checked':''} required>Conferi o original e confirmo que a identidade corresponde à paciente desta consulta.</label><label class="field">Motivo do vínculo<textarea name="reason" minlength="3" maxlength="500" rows="3" required>${e(draft.reason)}</textarea></label><button class="primary" type="submit">Confirmar vínculo de recebimento</button></fieldset></form><p data-cb-link-error class="error" role="status" aria-live="polite"></p><div class="cb-record-actions">${p&&!p.rejected?'<button class="secondary" type="button" data-cb="resolve-link">Conferir gravação</button><button class="secondary" type="button" data-cb="retry-link">Reenviar mesma operação</button>':p?.rejected?'<button class="secondary" type="button" data-cb="refresh-link">Atualizar consulta e conferir seleção</button>':''}<button class="subtle" type="button" data-cb="cancel-link" ${p&&!p.rejected?'disabled':''}>Cancelar seleção</button></div></section>`;
    container.querySelector('form').inert=saving;
    container.querySelectorAll('[data-cb]').forEach(b=>{if(saving)b.disabled=true;});
  }
  const linkError=message=>{const el=host.querySelector('[data-cb-link-error]');if(el)el.textContent=message;};
  function chooseLink(key){
    if(disposed||invalidated||busy||opening||saving||draft||service?.getPendingLink?.())return;
    const d=documents.find(d=>d.key===key),c=context();
    if(!d?.eligible_for_link||!capabilities.link_received||!c||c.locked||!Number.isSafeInteger(c.revision)||typeof service?.linkDocument!=='function'){emit('Selecione uma consulta aberta e um original elegível para vincular.',true);return;}
    draft={document:structuredClone(d),patientId:c.patientId,visitId:c.visitId,revision:c.revision,reason:'',confirmed:false};drawLinkEditor();host.querySelector('[data-cb-link-form] input')?.focus();
  }
  function captureDraft(form){if(draft){draft.reason=String(form.elements.reason.value);draft.confirmed=form.elements.confirmed.checked;}}
  async function saveLink(mode='new'){
    if(disposed||invalidated||saving||!draft)return;const c=context(),bound=contextKey(),rev=generation;
    if(!c||c.patientId!==draft.patientId||c.visitId!==draft.visitId){linkError('A paciente ou a consulta mudou. Confira a seleção.');return;}
    const form=host.querySelector('[data-cb-link-form]');captureDraft(form);
    if(mode==='new'&&(c.locked||c.revision!==draft.revision||!draft.confirmed||draft.reason.trim().length<3)){linkError('Confira a identidade, o motivo e a revisão atual da consulta.');return;}
    saving=true;drawLinkEditor();
    try{
      const result=mode==='resolve'?await service.resolveLink():mode==='retry'?await service.retryLink():await service.linkDocument({expected_revision:draft.revision,patient_id:draft.patientId,visit_id:draft.visitId,source_kind:draft.document.source_kind,source_id:draft.document.source_id,expected_source_fingerprint:draft.document.source_fingerprint,confirmed_identity:draft.confirmed,reason:draft.reason});
      if(disposed||invalidated||rev!==generation||bound!==contextKey())return;
      if(result?.pending){drawLinkEditor();linkError('O servidor ainda não confirmou esta operação. A seleção permanece protegida. Confira novamente ou reenvie a mesma operação.');return;}
      draft=null;saving=false;drawLinkEditor();await refresh();emit('Original vinculado como recebido. A revisão profissional continua pendente.');
    }catch(error){if(!disposed&&!invalidated&&rev===generation){drawLinkEditor();linkError(error?.message||'Não foi possível confirmar o vínculo.');}}
    finally{saving=false;if(!disposed&&!invalidated){const f=host.querySelector('[data-cb-link-form]');if(f)f.inert=false;host.querySelectorAll('[data-cb-link-editor] [data-cb]').forEach(b=>{b.disabled=b.dataset.cb==='cancel-link'&&uncertain();});}}
  }
  async function refreshDraft(){
    if(disposed||invalidated||saving||!draft||!service?.getPendingLink?.()?.rejected)return;
    const selected=draft,rev=generation;saving=true;drawLinkEditor();
    try{
      if(typeof reloadContext!=='function')throw Error('Atualize a consulta pelo aplicativo antes de iniciar outro vínculo.');
      await reloadContext();if(disposed||invalidated||rev!==generation)return;
      const c=context();if(!c||c.patientId!==selected.patientId||c.visitId!==selected.visitId||c.locked)throw Error('A consulta foi alterada ou encerrada. A seleção foi preservada para conferência.');
      const loaded=normalizeBridgeDocuments(await service.listDocuments({patient_id:c.patientId,visit_id:c.visitId,search:query,limit:25,offset}));
      if(disposed||invalidated||rev!==generation)return;
      const fresh=loaded.documents.find(d=>d.key===selected.document.key);
      if(!fresh?.eligible_for_link||fresh.source_fingerprint!==selected.document.source_fingerprint)throw Error('O original mudou ou deixou de ser elegível. Cancele esta seleção, reabra o original e confira os dados.');
      service.discardRejectedLink();draft={...selected,document:fresh,revision:c.revision,confirmed:false};documents=loaded.documents;capabilities=loaded.capabilities;draw();drawLinkEditor();linkError('Consulta atualizada. O motivo foi preservado; confira a identidade novamente antes de confirmar.');
    }catch(error){if(!disposed&&!invalidated){drawLinkEditor();linkError(error?.message||'Não foi possível atualizar a consulta.');}}
    finally{saving=false;if(!disposed&&!invalidated){host.querySelector('[data-cb-link-form]')?.removeAttribute('inert');const f=host.querySelector('[data-cb-link-form]');if(f)f.inert=false;host.querySelectorAll('[data-cb-link-editor] [data-cb]').forEach(b=>b.disabled=false);}}
  }
  function discard(){if(saving||uncertain()){emit('Confira a gravação do vínculo antes de sair desta seleção.',true);return false;}if(service?.getPendingLink?.()?.rejected)service.discardRejectedLink();draft=null;drawLinkEditor();return true;}
  async function openPDF(key){
    if(disposed||invalidated||opening||busy)return;let selected=documents.find(d=>d.key===key);if(!selected)return;const rev=generation,binding=contextKey();opening=true;
    let popup;
    try{
      popup=openWindow('about:blank','_blank');if(!popup)throw Error('Permita abrir a janela para consultar o PDF original.');popup.opener=null;openedWindows.add(popup);
      if(popup.document?.body)popup.document.body.textContent='Conferindo acesso ao documento original…';
      if(popup.document?.head&&popup.document?.createElement){const meta=popup.document.createElement('meta');meta.name='referrer';meta.content='no-referrer';popup.document.head.append(meta);}
      let url;
      if(service.source==='legacy'){
        const result=await service.listDocuments({limit:25,offset:0});const fresh=normalizeBridgeDocuments(result,{source:'legacy'}).documents.find(d=>d.key===key);
        if(!fresh)throw Error('O documento não está mais disponível. Atualize a lista.');url=trustedOriginalPDF(fresh.legacyPdf);if(!url)throw Error('O PDF original ainda não está disponível em endereço autorizado.');
      }else{
        if(typeof service.openDocument!=='function'||!selected.source_fingerprint)throw Error('A abertura do original ainda não está disponível nesta sessão.');
        const result=await service.openDocument({source_kind:selected.source_kind,source_id:selected.source_id,expected_source_fingerprint:selected.source_fingerprint});url=validateOpenedOriginal(result,selected);
      }
      if(disposed||invalidated||rev!==generation||binding!==contextKey())throw Error('A tela ou a sessão mudou. Reabra o documento no contexto atual.');
      popup.location.replace(url);emit('PDF original aberto com acesso temporário.');
    }catch(error){try{popup?.close();}catch{}openedWindows.delete(popup);if(!disposed&&!invalidated)emit(error?.message||'Não foi possível abrir o PDF.',true);}
    finally{opening=false;}
  }
  function invalidate(){if(disposed)return;invalidated=true;generation++;busy=false;opening=false;saving=false;draft=null;documents=[];requests=[];links=[];capabilities={};for(const w of openedWindows){try{w.close();}catch{}}openedWindows.clear();host.removeAttribute('aria-busy');host.innerHTML='<p class="cb-empty" role="status">Acesso encerrado. Os documentos e solicitações foram retirados desta tela.</p>';}
  const click=event=>{const b=event.target.closest('[data-cb]');if(!b||!host.contains(b)||disposed||invalidated||saving)return;const action=b.dataset.cb;if(action==='cancel-link'){if(draft&&confirmDiscard('Descartar a seleção e o motivo ainda não vinculados?'))discard();return;}if(action==='resolve-link'){void saveLink('resolve');return;}if(action==='retry-link'){void saveLink('retry');return;}if(action==='refresh-link'){void refreshDraft();return;}if(action==='pdf'){void openPDF(b.dataset.key);return;}if(draft){emit('Conclua ou cancele a seleção do original antes de alterar a busca.',true);return;}if(action==='link'){chooseLink(b.dataset.key);return;}if(action==='section'){if(opening)return;currentSection=b.dataset.section==='requests'?'requests':'documents';offset=0;drawShell();void refresh();}else if(action==='refresh'&&!opening)void refresh();else if(action==='previous'&&!busy&&!opening){offset=Math.max(0,page.offset-page.limit);void refresh();}else if(action==='next'&&!busy&&!opening&&page.hasMore){offset=page.offset+page.limit;void refresh();}};
  const submit=event=>{if(event.target.matches('[data-cb-link-form]')){event.preventDefault();void saveLink();return;}if(!event.target.matches('[data-cb-search]'))return;event.preventDefault();if(disposed||invalidated||opening||draft)return;query=String(new FormData(event.target).get('search')||'').trim().slice(0,120);offset=0;void refresh();};
  const change=event=>{if(event.target.closest('[data-cb-link-form]')){captureDraft(event.target.closest('form'));return;}if(!event.target.matches('[data-cb-status]')||disposed||invalidated||opening||draft)return;status=event.target.value;offset=0;void refresh();};
  host.addEventListener('click',click);host.addEventListener('submit',submit);host.addEventListener('change',change);host.addEventListener('input',change);eventTarget?.addEventListener('amj:connection-invalidated',invalidate);
  const unsubscribe=service?.session?.subscribe?.(invalidate);drawShell();
  const ready=refresh();
  return Object.freeze({ready,refresh,isDirty:()=>!!draft,isBusy:()=>saving||service?.isLinkBusy?.()===true,hasUncertain:uncertain,discard,setSection(value){if(disposed||invalidated||opening||draft||saving)return;currentSection=value==='requests'?'requests':'documents';offset=0;drawShell();return refresh();},invalidate,
    dispose(){if(disposed)return;invalidate();disposed=true;generation++;unsubscribe?.();eventTarget?.removeEventListener('amj:connection-invalidated',invalidate);host.removeEventListener('click',click);host.removeEventListener('submit',submit);host.removeEventListener('change',change);host.removeEventListener('input',change);host.replaceChildren();},
  });
}
