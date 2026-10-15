import { createClinicIntegration } from './adapter.mjs';
import { DEFAULT_CONFIG, validateConfig, assertNetworkAllowed } from './config.mjs';
import { IntegrationError, errorMessage } from './errors.mjs';
import {mountPrivateMap} from './map-ui.mjs';
import {buildPrivateEdit,confirmPrivateEdit,APPOINTMENT_TRANSITIONS} from './edit-workflow.mjs';
import {renderPrivateEdit} from './edit-workflow-ui.mjs';
import {createFinanceWorkflow} from './finance-workflow.mjs';
import {renderFinanceWorkflow,mountFinanceWorkflow} from './finance-workflow-ui.mjs';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = value => value == null ? '—' : new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value));
const date = value => !value ? '—' : new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeZone:'America/Sao_Paulo'}).format(new Date(String(value).length === 10 ? `${value}T12:00:00Z` : value));
const timestamp = value => !value ? '—' : new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'}).format(new Date(value));
const MODULES = [['patients','Pacientes'],['appointments','Agenda'],['records','Prontuários e fotos'],['finance','Financeiro'],['catalog','Catálogo'],['inventory','Estoque'],['operations','Atendimentos'],['documents','Documentos'],['site','Site']];
const field = (label,name,{type='text',value='',required=false,max=160,min='',step=''}={}) => `<label>${escape(label)}<input name="${name}" type="${type}" value="${escape(value)}" maxlength="${max}" ${required?'required':''} ${min?`min="${min}"`:''} ${step?`step="${step}"`:''}></label>`;

export function renderIntegrationPage() {
  return `<section class="clinic-integration" data-clinic-integration aria-label="Área privada da clínica">
    <header class="ci-heading"><div><span class="ci-eyebrow">Ana Maria Jacob · Área privada</span><h2>Conexão com a clínica</h2><p>Dados do servidor em uma área separada dos exemplos locais.</p></div><span class="ci-state" data-ci-status>Não conectado</span></header>
    <div data-ci-message role="status" aria-live="polite"></div><div data-ci-body></div>
  </section>`;
}

function loadScript(url) {
  return new Promise((resolve,reject) => {
    const script = document.createElement('script');
    script.src = url.href;
    script.onload = resolve;
    script.onerror = () => { script.remove(); reject(new IntegrationError('sdk_load_failed','Não foi possível carregar a autenticação local.')); };
    document.head.append(script);
  });
}
let authScripts;
async function defaultAuth(config) {
  if (!globalThis.supabase?.createClient || !globalThis.AMJAuth?.createController) {
    authScripts ||= (async () => {
      if (!globalThis.supabase?.createClient) await loadScript(new URL('./vendor/supabase-js-2.112.3.min.js',import.meta.url));
      if (!globalThis.AMJAuth?.createController) await loadScript(new URL('./vendor/auth-mfa.js',import.meta.url));
    })().catch(error => { authScripts=null; throw error; });
    await authScripts;
  }
  return globalThis.AMJAuth.createController({ supabaseGlobal:globalThis.supabase, storage:globalThis.sessionStorage,
    windowLike:globalThis, supabaseUrl:config.supabaseUrl, publishableKey:config.publishableKey });
}

function table(columns, rows, actions = null) {
  if (!rows.length) return '<p class="ci-empty">Nenhum registro retornado para este filtro.</p>';
  return `<div class="ci-table-wrap"><table><thead><tr>${columns.map(([label])=>`<th scope="col">${escape(label)}</th>`).join('')}${actions?'<th scope="col">Ações</th>':''}</tr></thead><tbody>${rows.map(row=>`<tr>${columns.map(([,key,format])=>`<td>${escape(format ? format(row[key],row) : row[key] ?? '—')}</td>`).join('')}${actions?`<td class="ci-actions">${actions(row)}</td>`:''}</tr>`).join('')}</tbody></table></div>`;
}
const button = (action,label,id='',disabled=false) => `<button type="button" data-ci-action="${action}" data-id="${escape(id)}" ${disabled?'disabled':''}>${escape(label)}</button>`;

export function mountIntegration(container, { config:input=DEFAULT_CONFIG, authController:injected, fetchImpl, origin } = {}) {
  const root = container.matches?.('[data-clinic-integration]') ? container : container.querySelector('[data-clinic-integration]');
  if (!root) throw new Error('renderIntegrationPage() must be mounted first.');
  const body = root.querySelector('[data-ci-body]');
  const message = root.querySelector('[data-ci-message]');
  const status = root.querySelector('[data-ci-status]');
  let config, auth = injected, api, disposed=false, busy=false, requestRevision=0, module='patients', page=1, photoPage=1, search='', data=null, mediaTimer=null,mapView=null,editState=null,financeView=null,financeWorkflow=null;
  const clearMedia = () => { clearTimeout(mediaTimer); mediaTimer=null;mapView?.dispose();mapView=null;financeView?.dispose();financeView=null;financeWorkflow?.dispose();financeWorkflow=null; };
  const notify = (text,kind='info') => { message.textContent=text; message.className=`ci-notice ci-${kind}`; };
  const clearPrivate = (reason) => {
    requestRevision++; data=null; editState=null;clearMedia();
    if(reason!=='destroyed'&&config) config=validateConfig({...config,writesEnabled:false,agendaSyncApproved:false},config.origin);
    if (!disposed && reason !== 'destroyed') { status.textContent='Sessão encerrada'; body.innerHTML='<p>Os dados privados foram retirados desta tela.</p>'+button('start','Entrar novamente'); }
  };
  const pagination = result => result?.paginacao ? `<div class="ci-pagination">${button('previous','Anterior','',page<=1)}<span>Página ${page}</span>${button('next','Próxima','',!result.paginacao.tem_mais)}</div>` : '';
  function privateShell(content) {
    return `<div class="ci-private-tools"><span>${config.writesEnabled?'Gravações habilitadas nesta sessão':'Consultas reais · gravações desativadas'}</span><div>${button(config.writesEnabled?'disable-writes':'enable-writes',config.writesEnabled?'Desativar gravações':'Habilitar gravações')}${button('logout','Sair da conta')}</div></div><nav class="ci-tabs" aria-label="Módulos privados">${MODULES.map(([key,label])=>`<button type="button" data-ci-module="${key}" aria-current="${key===module?'page':'false'}">${label}</button>`).join('')}</nav><div class="ci-content">${content}</div>`;
  }
  function showSetup() {
    try { config=validateConfig(input,origin); assertNetworkAllowed(config); }
    catch(error) { if(error.code==='integration_disabled'){status.textContent='Aplicativo em testes';notify('Esta demonstração usa dados fictícios salvos somente neste navegador.');body.innerHTML='<div class="ci-login"><h3>Seu acesso à clínica</h3><p>A integração do novo aplicativo ainda está em validação. Para acessar o painel atual, use sua conta da clínica.</p><a href="https://anamariajacob.com.br/painel/" target="_blank" rel="noopener noreferrer">Abrir painel da clínica →</a></div>';return;} notify(errorMessage(error),'error'); body.innerHTML='<p>O piloto local continua disponível. A área privada depende de uma origem aceita pelo backend e de política de rede compatível.</p><p>A versão preparada para homologação usa <strong>http://127.0.0.1:8765</strong>. Nenhuma chave de serviço é utilizada.</p>'; return; }
    body.innerHTML=`<div class="ci-login"><h3>Acesso individual</h3><p>Use a conta administradora e o autenticador já configurados na clínica.</p>${button('start','Abrir acesso seguro')}<p class="ci-muted">O acesso só será confirmado após resposta autenticada do servidor. Consultas podem gerar registros de auditoria.</p></div>`;
  }
  async function showAuth() {
    const next=await auth.getNextStep();
    if(disposed) return;
    data=null;editState=null;clearMedia();
    if(next.step==='ready') {
      if(api?.config!==config) replaceApi();
      status.textContent='MFA confirmado · acesso clínico a verificar';
      body.innerHTML=privateShell('<h3>Área privada pronta para consulta</h3><p>Escolha um módulo. Os resultados serão solicitados diretamente ao servidor; nenhum cadastro de exemplo será enviado.</p>');
      return;
    }
    status.textContent=next.step==='challenge'?'Autenticador necessário':'Não conectado';
    if(next.step==='challenge') body.innerHTML=`<form data-ci-form="mfa" class="ci-login"><h3>Confirme o autenticador</h3><label>Código de 6 dígitos<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label><button type="submit">Confirmar código</button>${button('logout','Sair')}</form>`;
    else if(next.step==='enroll'||next.step==='password') body.innerHTML=`<div class="ci-login"><h3>${next.step==='enroll'?'Configure o autenticador':'Defina sua senha'}</h3><p>Conclua esta etapa na área oficial, que mantém o fluxo existente de convite, recuperação e cadastro do autenticador.</p><a href="https://anamariajacob.com.br/painel/" target="_blank" rel="noopener noreferrer">Abrir acesso oficial</a>${button('logout','Sair desta sessão')}</div>`;
    else body.innerHTML=`<form data-ci-form="login" class="ci-login"><h3>Entrar na clínica</h3><p>Use o e-mail e a senha definidos no convite para o painel da clínica. Depois da senha, confirme o código do seu aplicativo autenticador.</p><label>E-mail<input name="email" type="email" autocomplete="username" required></label><label>Senha da clínica<input name="password" type="password" autocomplete="current-password" required></label><button type="submit">Entrar</button><a href="https://anamariajacob.com.br/painel/" target="_blank" rel="noopener noreferrer">Abrir o painel oficial da clínica</a></form>`;
  }
  async function start() {
    assertNetworkAllowed(config);
    if(!auth) auth=await defaultAuth(config);
    if(disposed) { if(!injected) auth?.destroy(); return; }
    if(!api||api.config!==config) replaceApi();
    await auth.initialize?.();
    await showAuth();
  }
  function replaceApi() {
    api?.dispose();
    api=createClinicIntegration({config,authController:auth,fetchImpl,origin:config.origin,onInvalidated:clearPrivate});
    config=api.config;
  }
  function success(result) {
    status.textContent=`Acesso confirmado pelo servidor${result.identity?.display_name?' · '+result.identity.display_name:''}`;
    notify('Consulta autenticada concluída. Dados privados mantidos apenas nesta tela.');
  }
  async function loadModule() {
    const revision=++requestRevision;
    data=null;editState=null;clearMedia();
    let result, content='';
    body.innerHTML=privateShell('<p role="status">Consultando o servidor…</p>');
    if(module==='appointments'&&!config.agendaSyncApproved) {
      body.innerHTML=privateShell('<h3>Abrir a agenda real</h3><p>A API existente consulta os horários e também reconcilia os lembretes no servidor. Ela não envia mensagens automaticamente por esta tela.</p>'+button('confirm-agenda','Consultar agenda e sincronizar lembretes'));
      return;
    }
    if(module==='site') {
      body.innerHTML=privateShell('<h3>Site e formulários existentes</h3><p>O pedido de agendamento do site entra como solicitação privada. A confirmação do horário continua na agenda da clínica.</p><div class="ci-links"><a href="https://anamariajacob.com.br/agendar/" target="_blank" rel="noopener noreferrer">Solicitar agendamento</a><a href="https://anamariajacob.com.br/anamnese/" target="_blank" rel="noopener noreferrer">Anamnese</a><a href="https://anamariajacob.com.br/termos/" target="_blank" rel="noopener noreferrer">Termos existentes</a></div><p>Formulários oficiais abrem em outra aba. Nenhum formulário local foi enviado automaticamente.</p>'); return;
    }
    if(module==='patients') result=await api.patients.list({pagina:page,por_pagina:25,...(search?{busca:search}:{})});
    else if(module==='appointments') result=await api.appointments.list({limite:100});
    else if(module==='records') result=await api.records.list({pagina:page,por_pagina:25});
    else if(module==='finance') {
      const [entries,catalog,patients]=await Promise.all([api.finance.list({pagina:page,por_pagina:25}),api.catalog.list(),api.patients.list({pagina:1,por_pagina:100})]);
      result={...entries,financeCatalog:catalog,financePatients:patients};
    }
    else if(module==='catalog') result=await api.catalog.list();
    else if(module==='inventory') result=await api.inventory.list({limite:100});
    else if(module==='operations') result=await api.operations.list({limite:100});
    else if(module==='documents') result=await api.documents.list();
    if(disposed||revision!==requestRevision) return;
    data=result; success(result);
    if(module==='patients') content=`<div class="ci-list-heading"><h3>Pacientes</h3>${button('new-patient','Novo paciente','',!config.writesEnabled)}</div><form data-ci-form="search" class="ci-search"><label>Buscar por nome ou telefone<input name="search" value="${escape(search)}" minlength="2" maxlength="80"></label><button type="submit">Buscar</button></form>`+table([['Nome','nome'],['Telefone','telefone'],['CPF','cpf_mascarado'],['Status','status']],result.clientes,row=>button('patient','Abrir',row.id))+pagination(result);
    if(module==='appointments') content=`<div class="ci-list-heading"><h3>Agenda</h3>${button('new-appointment','Novo horário','',!config.writesEnabled)}</div><p class="ci-muted">Até 100 horários retornados. Fuso: America/Sao_Paulo. A consulta do backend pode reconciliar lembretes.</p>`+table([['Data','data_hora',timestamp],['Paciente','nome'],['Categoria','categoria'],['Procedimento','procedimento'],['Status','status']],result.agendamentos,row=>button('edit-appointment','Editar',row.id,!config.writesEnabled)+button('appointment-status','Atualizar situação',row.id,!config.writesEnabled||!(APPOINTMENT_TRANSITIONS[row.status]??[]).length));
    if(module==='records') content='<h3>Prontuários e fotos privadas</h3>'+table([['Paciente','paciente',v=>v?.nome||'—'],['Procedimento','procedure_kind'],['Data','procedure_date',date],['Estado','status'],['Fotos','fotos_resumo',v=>v?.ativas??0]],result.protocolos,row=>button('record','Abrir',row.id)+button('photos','Fotos',row.id))+pagination(result);
    if(module==='finance') content='<div class="ci-list-heading"><h3>Financeiro real</h3>'+button('finance-summary','Resumo financeiro')+'</div><p class="ci-muted">Pacientes disponíveis para cobrança: página 1 carregada (até 100). '+(result.financePatients.paginacao?.tem_mais?'Há mais pacientes; use a busca abaixo para localizar o cadastro.':'Selecione o cadastro correto no formulário.')+'</p><form data-ci-form="finance-patient-search" class="ci-search"><label>Carregar pacientes por nome/telefone<input name="search" minlength="2" maxlength="80"></label><button type="submit">Buscar pacientes</button></form><div data-ci-finance>'+renderFinanceWorkflow({entries:result.lancamentos,writesEnabled:config.writesEnabled})+'</div>'+pagination(result);
    if(module==='catalog') content='<h3>Catálogo</h3><p class="ci-muted">Produtos completos e rascunhos retornados pelo catálogo existente.</p>'+table([['Produto','nome'],['Tipo','tipo'],['Unidade','unidade'],['Preço de venda','preco_venda',money],['Custo informado','custo_referencia',money],['Cadastro','status_cadastro']], [...result.produtos,...result.produtos_rascunho]);
    if(module==='inventory') content='<h3>Estoque por lote</h3><p class="ci-muted">Até 100 saldos retornados. Identificadores de produto são preservados; não há associação por nome.</p>'+table([['Produto (ID)','produto_id'],['Lote','lote'],['Validade','validade',date],['Unidade','unidade'],['Saldo','saldo'],['Valor efetivo','valor_efetivo',money]],result.estoque);
    if(module==='operations') content='<h3>Atendimentos realizados</h3>'+table([['Paciente','patient_id',v=>result.clientes.find(p=>p.id===v)?.full_name||v],['Procedimento','procedure_kind'],['Realizado em','attended_at',timestamp],['Situação','status']],result.atendimentos)+(result.paginacao?.possivelmente_truncado?'<p>Há mais dados do que o limite desta consulta. A lista não representa o total da clínica.</p>':'');
    if(module==='documents') {
      const docRows=[...result.fichas.map(row=>({...row,tipo_label:'Anamnese'})),...result.documentos];
      content='<h3>Anamneses e termos</h3><p class="ci-muted">Os PDFs têm acesso temporário. A lista inclui o estado de arquivo retornado pelo serviço.</p>'+table([['Paciente','nome'],['Documento','tipo_label'],['Recebido','recebido_em',date],['Arquivo','arquivado_em',v=>v?'Arquivado':'Ativo']],docRows,row=>safeUrl(row.pdf)?`<a href="${escape(row.pdf)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">Abrir PDF</a>`:'Sem PDF disponível');
      expireMedia(900);
    }
    body.innerHTML=privateShell(content);
    if(module==='finance')mountFinancial();
  }
  function mountFinancial(){
    const host=body.querySelector('[data-ci-finance]');
    financeWorkflow=createFinanceWorkflow({request:api.request,session:api.session});
    financeView=mountFinanceWorkflow(host,{workflow:financeWorkflow,entries:data.lancamentos,patients:data.financePatients.clientes,suppliers:data.financeCatalog.fornecedores,paymentForms:data.financeCatalog.formas_pagamento,writesEnabled:config.writesEnabled,notify,onChanged:async()=>{await loadModule();},onReload:async operation=>{
      const old=data.lancamentos.find(entry=>entry.id===operation.context?.id),competence=old?.competencia??operation.payload.competencia,type=old?.tipo??operation.payload.tipo;
      if(!competence||!type)throw new IntegrationError('finance_context_missing','Reabra o financeiro para conferir o lançamento.');
      const rows=[];let more=false;
      for(let currentPage=1;currentPage<=5;currentPage++){
        const fresh=await api.finance.list({de:competence,ate:competence,tipo:type,pagina:currentPage,por_pagina:200});
        rows.push(...fresh.lancamentos);more=fresh.paginacao?.tem_mais===true;
        if(!more||operation.context?.id&&rows.some(row=>row.id===operation.context.id))break;
      }
      if(more&&!rows.some(row=>row.id===operation.context?.id))notify('Conferência limitada a 1.000 lançamentos nesta data. A ausência de um registro não confirma que a gravação falhou.','error');
      return rows;
    }});
  }
  function safeUrl(value) {
    try { const u=new URL(value); return u.origin===config.supabaseUrl && u.protocol==='https:' && u.pathname.startsWith('/storage/v1/'); } catch { return false; }
  }
  function expireMedia(seconds) {
    clearMedia(); mediaTimer=setTimeout(()=>{
      root.querySelectorAll('.ci-content img').forEach(img=>img.removeAttribute('src'));
      root.querySelectorAll('.ci-content a[href]').forEach(a=>{if(safeUrl(a.href)){a.removeAttribute('href');a.textContent='Acesso expirado — consulte novamente';}});
      if(!disposed) notify('O acesso temporário às imagens ou PDFs expirou. Consulte novamente para renovar.');
    },seconds*1000);
  }
  async function photos(id,nextPage=1) {
    const record=data?.protocolos?.find(p=>p.id===id);
    if(!record) throw new IntegrationError('missing_context','Reabra a lista de prontuários para selecionar as fotos.');
    const revision=++requestRevision;
    const result=await api.photos.list(id,{pagina:nextPage,por_pagina:24});
    const checked=await api.records.list({protocolo_id:id,por_pagina:1}),current=checked.protocolos?.find(row=>row.id===id);
    if(disposed||revision!==requestRevision) return;
    if(!current||current.patient_id!==record.patient_id||current.version!==record.version)throw new IntegrationError('photo_context_changed','A consulta ou seu vínculo foi alterado. Reabra os prontuários antes de exibir as fotos.');
    success(result); photoPage=nextPage;
    body.innerHTML=privateShell(`<h3>Fotos · ${escape(record.paciente?.nome||'Paciente')}</h3><p>Prontuário: ${escape(record.procedure_kind||'Sem procedimento informado')}. Imagens originais privadas; consentimento de marketing é separado.</p>${button('reload','Voltar aos prontuários')}${button('upload-photo','Adicionar foto',id,!config.writesEnabled)}<div class="ci-photo-grid">${result.fotos.map(photo=>`<figure>${safeUrl(photo.miniatura_url)?`<img src="${escape(photo.miniatura_url)}" referrerpolicy="no-referrer" loading="lazy" alt="Foto clínica: ${escape(photo.phase)}">`:'<p>Imagem indisponível</p>'}<figcaption>${escape(photo.phase)} · ${escape(date(photo.taken_at))}${safeUrl(photo.url_assinada)?`<a href="${escape(photo.url_assinada)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">Abrir original</a>`:''}${['before','during','after'].includes(photo.phase)?`<button type="button" data-ci-action="photo-map" data-id="${escape(photo.id)}" data-protocol="${escape(id)}">Abrir mapa manual</button>`:''}</figcaption></figure>`).join('')}</div><div class="ci-pagination">${button('photos-previous','Anterior',id,photoPage<=1)}<span>Página ${photoPage}</span>${button('photos-next','Próxima',id,!result.paginacao.tem_mais)}</div>`);
    expireMedia(300);
  }
  async function photoMap(protocolId,photoId){
    const record=data?.protocolos?.find(row=>row.id===protocolId);
    if(!record)throw new IntegrationError('missing_context','Reabra a consulta para selecionar a foto.');
    const revision=++requestRevision,opened=await api.maps.open(protocolId,photoId);
    if(disposed||revision!==requestRevision)return;
    if(opened.binding.patient_id!==record.patient_id||opened.binding.protocol_version!==record.version)throw new IntegrationError('photo_context_changed','A consulta ou seu vínculo foi alterado. Reabra os prontuários antes de marcar a foto.');
    if(!safeUrl(opened.photo?.signed_url))throw new IntegrationError('invalid_photo','O servidor não retornou um original autorizado.');
    clearMedia();success(opened);
    body.innerHTML=privateShell(`<h3>${escape(record.paciente?.nome||'Paciente')}</h3>${button('photos','Voltar às fotos',protocolId)}<div data-ci-map></div>`);
    mapView=mountPrivateMap(body.querySelector('[data-ci-map]'),{api,opened,writesEnabled:config.writesEnabled,onMessage:notify});
  }
  async function patient(id) {
    const revision=++requestRevision, result=await api.patients.get(id);
    if(disposed||revision!==requestRevision) return;
    const row=result.cliente; data={cliente:row}; success(result);
    body.innerHTML=privateShell(`<h3>${escape(row.nome)}</h3><dl><dt>Telefone</dt><dd>${escape(row.telefone||'—')}</dd><dt>E-mail</dt><dd>${escape(row.email||'—')}</dd><dt>CPF</dt><dd>${escape(row.cpf_mascarado||'—')}</dd><dt>Nascimento</dt><dd>${escape(date(row.data_nascimento))}</dd></dl>${button('edit-patient','Editar cadastro',row.id,!config.writesEnabled||Boolean(row.arquivado_em))}${button('draft','Novo prontuário',row.id,!config.writesEnabled)}${button('reload','Voltar aos pacientes')}`);
  }
  function record(id) {
    const row=data?.protocolos?.find(p=>p.id===id);
    if(!row) throw new IntegrationError('missing_context','Reabra a lista de prontuários.');
    body.innerHTML=privateShell(`<h3>${escape(row.paciente?.nome||'Prontuário')}</h3><dl>${[['Procedimento',row.procedure_kind],['Estado',row.status],['Queixa',row.complaint],['Técnica',row.technique_notes],['Orientações',row.care_notes]].map(([k,v])=>`<dt>${escape(k)}</dt><dd>${escape(v||'—')}</dd>`).join('')}</dl>${button('edit-record','Editar rascunho',id,!config.writesEnabled||row.status!=='draft'||Boolean(row.archived_at))}${button('finalize-record','Revisar e finalizar',id,!config.writesEnabled||row.status!=='draft'||Boolean(row.archived_at))}${button('photos','Fotos',id)}${button('reload','Voltar à lista')}`);
  }
  async function openEdit(kind,id){
    if(!config.writesEnabled)throw new IntegrationError('writes_disabled','Habilite gravações antes de editar.');
    let row;
    if(kind==='edit-patient')row=data?.cliente?.id===id?data.cliente:null;
    else if(kind==='edit-appointment'||kind==='appointment-status')row=data?.agendamentos?.find(item=>item.id===id);
    else {
      const revision=requestRevision,result=await api.records.list({protocolo_id:id,por_pagina:1});
      if(disposed||revision!==requestRevision)return;
      row=result.protocolos?.find(item=>item.id===id);
      if(row?.status!=='draft'||row?.archived_at)throw new IntegrationError('record_locked','O prontuário já foi finalizado ou arquivado. Reabra a lista para conferir.');
      success(result);
    }
    if(!row)throw new IntegrationError('missing_context','Reabra o registro antes de editar.');
    editState={kind,row:structuredClone(row),key:crypto.randomUUID(),dirty:false,blocked:false};clearMedia();
    body.innerHTML=privateShell(renderPrivateEdit(kind,editState.row,editState.key));
  }
  function mutationForm(kind,id='') {
    if(!config.writesEnabled) throw new IntegrationError('writes_disabled','A gravação real está desativada nesta configuração.');
    const key=crypto.randomUUID();
    let fields='',title='';
    if(kind==='new-patient') { title='Novo paciente real'; fields=field('Nome','nome',{required:true})+field('Telefone','telefone',{type:'tel'})+field('E-mail','email',{type:'email'})+field('Data de nascimento','data_nascimento',{type:'date'}); }
    if(kind==='new-appointment') { title='Novo horário real'; fields=field('Nome','nome',{required:true})+field('Telefone','telefone',{type:'tel',required:true})+'<label>Categoria<select name="categoria"><option value="avaliacao">Avaliação</option><option value="procedimento">Procedimento</option><option value="retorno">Retorno</option><option value="acompanhamento">Acompanhamento</option></select></label>'+field('Procedimento','procedimento',{required:true})+field('Data e hora em Brasília','data_hora',{type:'datetime-local',required:true})+field('Duração em minutos','duracao_min',{type:'number',value:60,min:15,required:true}); }
    if(kind==='draft') { if(data?.cliente?.id!==id) throw new IntegrationError('missing_context','Reabra a paciente antes de criar um prontuário.'); title=`Novo prontuário · ${data.cliente.nome}`; fields=`<input type="hidden" name="paciente_id" value="${escape(id)}">`+field('Procedimento','tipo_procedimento')+'<label>Queixa<textarea name="queixa" maxlength="2000"></textarea></label>'+field('Data do procedimento','data_procedimento',{type:'date'}); }
    if(kind==='upload-photo') {
      const selected=data?.protocolos?.find(row=>row.id===id);
      if(!selected) throw new IntegrationError('missing_context','Reabra o prontuário antes de adicionar uma foto.');
      title=`Foto privada · ${selected.paciente?.nome||'Paciente'}`;
      fields=`<input type="hidden" name="protocolo_id" value="${escape(id)}"><label>Foto original<input type="file" name="arquivo" accept="image/jpeg,image/png,image/webp" required></label><label>Fase<select name="fase"><option value="before">Antes</option><option value="during">Durante</option><option value="after">Depois</option></select></label>`+field('Data e hora da foto em Brasília','tirada_em',{type:'datetime-local',required:true})+`<p class="ci-muted">O original será preservado, sem alterações. A autorização para publicação não é concedida por este envio.</p>`;
    }
    editState={kind,key,row:kind==='draft'?structuredClone(data.cliente):kind==='upload-photo'?{id}:null,dirty:false,blocked:false};
    body.innerHTML=privateShell(`<h3>${escape(title)}</h3><p>Os dados serão enviados à clínica real. Confira antes de salvar.</p><form data-ci-form="${kind}" data-key="${key}" class="ci-edit">${fields}<button type="submit">Salvar no servidor</button>${button('cancel-edit','Descartar e voltar')}</form>`);
  }
  async function saveForm(form,values) {
    const kind=form.dataset.ciForm;
    if(!editState||editState.kind!==kind||editState.key!==form.dataset.key)throw new IntegrationError('missing_context','Reabra o formulário antes de salvar.');
    if(editState.blocked)throw new IntegrationError('edit_unconfirmed','O envio anterior precisa ser conferido no servidor antes de repetir.');
    const snapshot=structuredClone(editState),revision=requestRevision,isEdit=['edit-patient','edit-appointment','appointment-status','edit-record','finalize-record'].includes(kind);
    let payload=isEdit?buildPrivateEdit(kind,snapshot.row,values,snapshot.key):{...values,idempotency_key:snapshot.key};
    if(kind==='draft')payload.paciente_id=snapshot.row.id;
    if(kind==='upload-photo')payload.protocolo_id=snapshot.row.id;
    if(kind==='new-appointment') { payload={...payload,data_hora:`${values.data_hora}:00-03:00`,duracao_min:Number(values.duracao_min),fuso_horario:'America/Sao_Paulo',origem:'painel',lembretes_autorizados:false}; }
    if(kind==='upload-photo') payload.tirada_em=`${values.tirada_em}:00-03:00`;
    // Freeze the submitted form. Unknown outcomes never cause automatic retry
    // or a new idempotency key; the user must inspect the server record first.
    form.querySelectorAll('input,select,textarea,button[type=submit]').forEach(el=>el.disabled=true);
    try{
      let result;
      if(kind==='new-patient') result=await api.patients.create(payload);
      else if(kind==='edit-patient')result=await api.patients.update(payload);
      else if(kind==='new-appointment') result=await api.appointments.create(payload);
      else if(kind==='edit-appointment')result=await api.appointments.update(payload);
      else if(kind==='appointment-status')result=await api.appointments.changeStatus(payload);
      else if(kind==='finalize-record')result=await api.records.finalize(payload);
      else if(kind==='upload-photo') result=await api.photos.upload(payload);
      else result=await api.records.saveDraft(payload);
      if(disposed||revision!==requestRevision)return;
      if(isEdit)confirmPrivateEdit(kind,snapshot.row,result);
      success(result);data=null;editState=null;
      const feedback=kind==='finalize-record'?'Prontuário finalizado e protegido contra edição comum.':kind==='draft'||kind==='edit-record'?'Rascunho salvo. A finalização clínica é uma ação separada.':result.reagendado?'Horário reagendado; a confirmação foi reiniciada.':'Registro salvo. Reabra a lista para conferir.';
      body.innerHTML=privateShell(`<h3>Operação confirmada pelo servidor</h3><p>${feedback}</p>${result.lembretes_sincronizados===false?'<p>O registro foi salvo, mas a sincronização de lembretes não foi confirmada. Reabra a agenda para conferir.</p>':''}${button('reload','Reabrir lista')}`);
    }catch(error){
      if(!disposed&&revision===requestRevision&&editState?.key===snapshot.key){
        editState.dirty=true;editState.blocked=error.uncertain||error.status===409;
        editState.uncertain=Boolean(error.uncertain);
        if(editState.uncertain){
          editState.submittedPayload=payload;
          const cancel=form.querySelector('[data-ci-action="cancel-edit"]');
          if(cancel){cancel.disabled=true;cancel.textContent='Envio a conferir · rascunho preservado';}
        }
        if(!editState.blocked)form.querySelectorAll('input,select,textarea,button[type=submit]').forEach(el=>el.disabled=false);
      }
      throw error;
    }
  }
  async function run(fn) {
    if(busy||disposed) return;
    busy=true; root.setAttribute('aria-busy','true');
    try { await fn(); }
    catch(error) { if(!disposed) notify(`${errorMessage(error)}${error.uncertain?' Não repita a gravação antes de conferir o servidor.':''}`,'error'); }
    finally { busy=false; root.removeAttribute('aria-busy'); }
  }
  const click=event=>{
    const target=event.target.closest('button'); if(!target||!root.contains(target)) return;
    const action=target.dataset.ciAction;
    if(action==='logout') {
      requestRevision++; api?.session.invalidate('SIGNED_OUT');
      // Logout must work even while a clinical request is awaiting the network.
      Promise.resolve(api?api.session.signOut():auth?.signOut()).then(()=>showAuth()).catch(error=>{if(!disposed)notify(errorMessage(error),'error');});
      return;
    }
    if(!action&&!target.dataset.ciModule)return;
    if(mapView?.isBusy()||financeView?.isBusy()){notify('Aguarde a confirmação da operação em andamento.');return;}
    if(editState?.uncertain){notify('O resultado do envio ainda é desconhecido. O formulário e a chave foram preservados. Confira o registro na área oficial antes de encerrar esta sessão; não crie outro envio.','error');return;}
    if(mapView?.isDirty()){notify('Há alterações no mapa. Salve a nova versão ou use Descartar alterações locais antes de sair.','error');return;}
    if(editState?.dirty&&action!=='cancel-edit'){notify('O formulário tem alterações pendentes. Salve ou use Descartar e voltar antes de sair.','error');return;}
    if(financeView?.isDirty()){notify('Conclua ou feche o formulário financeiro antes de sair. Um envio incerto precisa ser conferido.','error');return;}
    if(target.dataset.ciModule) { run(async()=>{module=target.dataset.ciModule;page=1;search='';await loadModule();});return; }
    run(async()=>{
      if(action==='start') await start();
      else if(action==='enable-writes') {
        const revision=requestRevision;
        await api.session.requireReady();
        if(disposed||revision!==requestRevision)return;
        body.innerHTML=privateShell('<h3>Habilitar gravações na base real</h3><p>Cadastros, horários, prontuários e fotos enviados pelos formulários desta área serão gravados na clínica real. Os exemplos locais permanecem separados.</p><p>Esta escolha vale apenas para a sessão atual. Habilitar não envia nenhum cadastro; cada envio exige Salvar no servidor.</p>'+button('confirm-writes','Habilitar gravações nesta sessão')+button('reload','Voltar sem habilitar'));
      }
      else if(action==='confirm-writes'||action==='disable-writes'||action==='confirm-agenda') {
        const revision=requestRevision;
        await api.session.requireReady();
        if(disposed||revision!==requestRevision)return;
        config=validateConfig({...config,...(action==='confirm-agenda'?{agendaSyncApproved:true}:{writesEnabled:action==='confirm-writes'})},config.origin);
        replaceApi();
        if(action==='confirm-agenda') await loadModule();
        else body.innerHTML=privateShell('<h3>'+ (config.writesEnabled?'Gravações habilitadas':'Gravações desativadas')+'</h3><p>Escolha o módulo para continuar. Nenhum cadastro foi enviado por esta ação.</p>');
      }
      else if(action==='reload') await loadModule();
      else if(action==='cancel-edit'){editState=null;await loadModule();}
      else if(action==='next'||action==='previous') {page+=action==='next'?1:-1;await loadModule();}
      else if(action==='patient') await patient(target.dataset.id);
      else if(action==='record') record(target.dataset.id);
      else if(action==='photos') await photos(target.dataset.id);
      else if(action==='photo-map') await photoMap(target.dataset.protocol,target.dataset.id);
      else if(['edit-patient','edit-appointment','appointment-status','edit-record','finalize-record'].includes(action))await openEdit(action,target.dataset.id);
      else if(action==='photos-next'||action==='photos-previous') await photos(target.dataset.id,photoPage+(action==='photos-next'?1:-1));
      else if(action==='finance-summary') {
        const revision=requestRevision,result=await api.finance.summary(); if(disposed||revision!==requestRevision)return;
        if(financeView?.isDirty()||financeView?.isBusy()){notify('O resumo foi recebido, mas o formulário financeiro foi preservado. Conclua a operação antes de abrir o resumo.');return;}
        clearMedia();success(result);
        body.innerHTML=privateShell('<h3>Resumo financeiro do servidor</h3><dl>'+[['Receita faturada','receita_faturada'],['Receita recebida','receita_recebida'],['Despesas incorridas','despesa_incorrida'],['Despesas pagas','despesa_paga'],['Fluxo líquido','fluxo_liquido'],['Contas a receber','contas_receber'],['Contas a pagar','contas_pagar']].map(([label,key])=>`<dt>${label}</dt><dd>${escape(money(result.resumo[key]))}</dd>`).join('')+'</dl><p class="ci-muted">Fluxo líquido não é lucro contábil. O resumo não recebeu filtro de período.</p>'+button('reload','Voltar aos lançamentos'));
      }
      else if(['new-patient','new-appointment','draft','upload-photo'].includes(action)) mutationForm(action,target.dataset.id);
    });
  };
  const submit=event=>{
    const form=event.target.closest('form[data-ci-form]'); if(!form||!root.contains(form)) return;
    event.preventDefault(); if(!form.reportValidity()) return;
    const values=Object.fromEntries(new FormData(form));
    run(async()=>{
      if(form.dataset.ciForm==='login') { const password=values.password; form.elements.password.value=''; delete values.password; await auth.signIn(values.email,password); await showAuth(); }
      else if(form.dataset.ciForm==='mfa') { const code=values.code; form.elements.code.value=''; await auth.verifyChallenge(code); await showAuth(); }
      else if(form.dataset.ciForm==='search') {search=values.search.trim();page=1;await loadModule();}
      else if(form.dataset.ciForm==='finance-patient-search') {
        if(financeView?.isDirty()||financeView?.isBusy())throw new IntegrationError('finance_pending','Feche ou conclua o formulário financeiro antes de mudar a lista de pacientes.');
        const revision=requestRevision,result=await api.patients.list({pagina:1,por_pagina:100,...(values.search.trim()?{busca:values.search.trim()}:{})});
        if(disposed||revision!==requestRevision)return;
        if(financeView?.isDirty()||financeView?.isBusy()){notify('A busca terminou, mas o formulário financeiro foi preservado. Conclua a operação antes de mudar a lista de pacientes.');return;}
        financeView?.dispose();financeWorkflow?.dispose();data.financePatients=result;
        body.querySelector('[data-ci-finance]').innerHTML=renderFinanceWorkflow({entries:data.lancamentos,writesEnabled:config.writesEnabled});mountFinancial();
        notify(`${result.clientes.length} pacientes na página de busca carregada.${result.paginacao?.tem_mais?' Há mais resultados; refine o nome ou telefone.':''}`);
      }
      else await saveForm(form,values);
    });
  };
  const changed=event=>{if(editState&&event.target.closest?.('form[data-ci-form]'))editState.dirty=true;};
  const unload=event=>{if(editState?.dirty||mapView?.isDirty()||financeView?.isDirty()){event.preventDefault();event.returnValue='';}};
  globalThis.addEventListener?.('beforeunload',unload);
  root.addEventListener('click',click); root.addEventListener('submit',submit);root.addEventListener('input',changed);root.addEventListener('change',changed);
  showSetup();
  return Object.freeze({isDirty:()=>Boolean(editState?.dirty)||(mapView?.isDirty()??false)||(financeView?.isDirty()??false),isBusy:()=>busy||(mapView?.isBusy()??false)||(financeView?.isBusy()??false),dispose(){disposed=true;requestRevision++;data=null;editState=null;clearMedia();api?.dispose();if(!injected){auth?.client?.auth?.stopAutoRefresh?.();auth?.destroy();}globalThis.removeEventListener?.('beforeunload',unload);root.removeEventListener('click',click);root.removeEventListener('submit',submit);root.removeEventListener('input',changed);root.removeEventListener('change',changed);body.replaceChildren();}});
}
