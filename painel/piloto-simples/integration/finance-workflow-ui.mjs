import { FINANCE_METHODS, reaisDecimal, centsToReais } from './finance-workflow.mjs';
import { errorMessage } from './errors.mjs';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value??0));
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const field=(label,name,value='',type='text',extra='')=>`<label>${escape(label)}<input name="${escape(name)}" value="${escape(value)}" type="${type}" ${extra}></label>`;
const button=(action,label,extra='')=>`<button type="button" data-fw-action="${action}" ${extra}>${escape(label)}</button>`;
const option=(value,label,selected='')=>`<option value="${escape(value)}" ${value===selected?'selected':''}>${escape(label)}</option>`;
const select=(label,name,options)=>`<label>${escape(label)}<select name="${name}">${options}</select></label>`;
const writeButton=(action,label,id,enabled)=>button(action,label,`data-id="${escape(id)}" ${enabled?'':'disabled'}`);
function paymentHistory(entry){
  return `<h5>Histórico de pagamentos e estornos</h5>${!(entry.pagamentos??[]).length?'<p>Nenhum movimento de caixa registrado.</p>':`<table><thead><tr><th>Movimento</th><th>Data</th><th>Valor</th><th>Forma</th></tr></thead><tbody>${entry.pagamentos.map(p=>`<tr><td>${escape(p.tipo)}</td><td>${escape(p.pago_em)}</td><td>${escape(money(p.valor))}</td><td>${escape(p.forma)}</td></tr>`).join('')}</tbody></table>`}`;
}
export function renderFinanceWorkflow({entries=[],writesEnabled=false}={}){
  return `<section class="finance-workflow" data-finance-workflow aria-label="Operações financeiras"><div class="fw-toolbar"><h3>Cobranças e despesas</h3>${button('create','Nova cobrança ou despesa',writesEnabled?'':'disabled')}</div><p class="fw-hint">Cobrança representa valor a receber. Recebimento registra dinheiro que entrou; pagamento de despesa registra dinheiro que saiu.</p><div data-fw-message role="status" aria-live="polite"></div><div data-fw-form></div><div data-fw-list>${entries.length?entries.map(e=>`<article class="fw-entry"><header><div><h4>${escape(e.descricao)}</h4><p>${escape(e.tipo)} · ${escape(e.status)} · ${escape(e.cliente?.nome??e.fornecedor?.nome??'Sem vínculo de pessoa')}</p></div><strong>${escape(money(e.valor_total))}</strong></header><p>${e.tipo==='despesa'?'Pago':'Recebido'}: ${escape(money(e.valor_pago))} · Saldo: ${escape(money(e.saldo))} · Vencimento: ${escape(e.vencimento)}</p><div class="fw-toolbar">${writeButton('payment',e.tipo==='despesa'?'Registrar pagamento':'Registrar recebimento',e.id,writesEnabled&&e.estado==='ativo'&&Number(e.saldo)>0)}${writeButton('installments','Programar parcelas',e.id,writesEnabled&&e.estado==='ativo'&&Number(e.saldo)>0)}${writeButton('reverse','Estornar movimento',e.id,writesEnabled&&e.estado==='ativo'&&(e.pagamentos??[]).some(p=>p.tipo==='pagamento'))}${writeButton('cancel','Cancelar lançamento',e.id,writesEnabled&&e.estado==='ativo'&&Number(e.valor_pago)===0&&e.origem!=='compra')}</div><details><summary>Parcelas e histórico</summary>${(e.parcelas_previstas??[]).map(p=>`<p>Parcela ${escape(p.numero)} · ${escape(p.vencimento)} · ${escape(money(p.valor))} · Saldo ${escape(money(p.saldo))}</p>`).join('')}${paymentHistory(e)}</details></article>`).join(''):'<p>Nenhum lançamento nesta página.</p>'}</div></section>`;
}

/** Mount after renderFinanceWorkflow. No fetch/local storage/credential handling.
 * onChanged(response,{operation}) is called ONLY after confirmed mutation.
 * onReload(operation) must return fresh server entries for that operation's entry
 * (caller may paginate; absence is not evidence of a failed write).
 * The shell must honor isDirty/isBusy before switching modules or remounting.
 * All methods are decimal reais. Forms survive rejected and uncertain writes.
 */
export function mountFinanceWorkflow(host,{workflow,entries=[],patients=[],suppliers=[],paymentForms=[],writesEnabled=false,onChanged=async()=>{},onReload=null,notify=()=>{}}={}){
  const root=host.matches?.('[data-finance-workflow]')?host:host.querySelector('[data-finance-workflow]');
  if(!root||!workflow)throw new Error('Renderize o fluxo financeiro e conecte o workflow.');
  const formHost=root.querySelector('[data-fw-form]'),message=root.querySelector('[data-fw-message]');
  let disposed=false,busy=false,dirty=false,operation=null,selected=null,mode=null,verifiedUncertain=false;
  const methods=paymentForms.filter(p=>p.ativo!==false&&FINANCE_METHODS.includes(p.codigo));
  const methodsOptions=selected=>methods.map(p=>option(p.codigo,p.nome,selected)).join('');
  const announce=(text,kind='info')=>{if(disposed)return;message.textContent=text;message.className=`fw-notice fw-${kind}`;notify(text,kind);};
  const find=id=>entries.find(e=>e.id===id);
  const form=(kind,content)=>`<form data-fw-form-kind="${kind}"><h4>${{create:'Novo lançamento',payment:'Registrar movimento',installments:'Parcelas do saldo',reverse:'Estornar pagamento',cancel:'Cancelar lançamento'}[kind]}</h4>${content}<div class="fw-toolbar"><button type="submit">${kind==='installments'?'Salvar parcelas':'Salvar no servidor'}</button>${button('close','Fechar')}</div></form>`;
  function show(kind,entry){
    if(busy||dirty){announce('Conclua ou feche o formulário atual antes de abrir outro.','error');return;}
    if(!writesEnabled){announce('Habilite as gravações nesta sessão para continuar.','error');return;}
    selected=entry;mode=kind;operation=null;verifiedUncertain=false;
    const valueField=(label,value='')=>field(label,'valor',value,'text','inputmode="decimal" required maxlength="16"');
    if(kind==='create')formHost.innerHTML=form(kind,`${select('Tipo','tipo',option('receita','Cobrança a receber')+option('despesa','Despesa a pagar'))}${select('Paciente (obrigatório para cobrança)','cliente_id',option('','Selecione')+patients.map(p=>option(p.id,p.nome)).join(''))}${select('Fornecedor (opcional)','fornecedor_id',option('','Sem fornecedor')+suppliers.map(p=>option(p.id,p.nome)).join(''))}${field('Descrição','descricao','','text','required minlength="2" maxlength="200"')}${field('Categoria','categoria','','text','required minlength="2" maxlength="100"')}${field('Competência','competencia',today(),'date','required')}${field('Vencimento','vencimento',today(),'date','required')}${field('Total em reais','valor_total','','text','required inputmode="decimal" maxlength="16"')}<p class="fw-hint">Salvar cria apenas a cobrança ou despesa. Depois você pode programar parcelas e registrar os movimentos de caixa.</p>`);
    if(kind==='payment')formHost.innerHTML=form(kind,`<p>${escape(entry.descricao)} · Saldo ${escape(money(entry.saldo))}</p>${(entry.parcelas_previstas??[]).length?select('Parcela','parcela_id',entry.parcelas_previstas.filter(p=>p.estado==='ativa'&&Number(p.saldo)>0).map(p=>option(p.id,`${p.numero} — ${p.vencimento} — saldo ${money(p.saldo)}`)).join('')):''}${valueField('Valor realmente recebido ou pago em reais')}${select('Forma','forma',methodsOptions())}${field('Data do movimento','data',today(),'date','required')}${field('Parcelas da transação (somente crédito)','parcelas',1,'number','required min="1" max="120"')}${field('Referência curta (sem dados de cartão)','referencia','','text','maxlength="120"')}`);
    if(kind==='reverse')formHost.innerHTML=form(kind,`<p>O estorno será um novo registro no histórico. O pagamento original será preservado.</p>${select('Pagamento original','pagamento_id',(entry.pagamentos??[]).filter(p=>p.tipo==='pagamento').map(p=>option(p.id,`${p.pago_em} — ${money(p.valor)} — ${p.forma}`)).join(''))}${valueField('Valor a estornar em reais')}${field('Data do estorno','data',today(),'date','required')}${field('Referência do estorno','referencia','','text','maxlength="120"')}`);
    if(kind==='cancel')formHost.innerHTML=form(kind,`<p>${escape(entry.descricao)} · ${escape(money(entry.valor_total))}</p>${field('Motivo do cancelamento','motivo','','text','required minlength="3" maxlength="500"')}<p>O lançamento cancelado permanecerá no histórico.</p>`);
    if(kind==='installments')formHost.innerHTML=form(kind,`<p>Saldo a programar: ${escape(money(entry.saldo))}. Cada linha pode ser ajustada antes de salvar.</p><div class="fw-plan-controls">${field('Quantidade de parcelas','quantidade',2,'number','min="1" max="120" required')}${field('Primeiro vencimento','primeiro',entry.vencimento||today(),'date','required')}${select('Forma prevista','forma_prevista',methodsOptions())}${button('build-plan','Gerar divisão mensal')}</div><div data-fw-rows></div><p class="fw-hint">Um novo plano substitui as parcelas ativas sem movimentos. Planos com pagamentos vinculados dependem das regras do servidor.</p>`);
    dirty=true;
  }
  function setDisabled(disabled){for(const control of formHost.querySelectorAll('input,select,textarea,button'))control.disabled=disabled;}
  function uncertainty(){
    setDisabled(true);
    const actions=root.ownerDocument.createElement('div');actions.className='fw-toolbar';actions.dataset.fwRecovery='';
    actions.innerHTML=`${onReload?button('reload','Conferir no servidor'):''}${mode==='installments'?'':button('retry','Repetir o mesmo envio',verifiedUncertain?'':'disabled')}<p>A chave e os valores originais foram preservados. Não crie um novo movimento para substituir este envio sem conferência.</p>`;formHost.append(actions);
  }
  async function save(retry=false){
    busy=true;setDisabled(true);
    try{
      const response=await workflow[retry?'retry':'execute'](operation);
      if(disposed)return;dirty=false;formHost.replaceChildren();announce('Operação confirmada pelo servidor.');
      try{await onChanged(response,{operation});}catch{announce('Operação confirmada. A releitura falhou; atualize a lista antes de continuar.','error');}
    }catch(error){if(disposed)return;announce(errorMessage(error),'error');if(error.uncertain||workflow.status(operation)==='uncertain')uncertainty();else{setDisabled(false);operation=null;}}
    finally{busy=false;}
  }
  async function onSubmit(event){
    const formEl=event.target.closest?.('form[data-fw-form-kind]');if(!formEl||!root.contains(formEl))return;event.preventDefault();if(busy)return;
    try{
      const data=Object.fromEntries(new FormData(formEl));
      if(mode==='create')operation=workflow.prepareCreate({tipo:data.tipo,origem:'operacional',cliente_id:data.tipo==='receita'?data.cliente_id:undefined,fornecedor_id:data.fornecedor_id||undefined,descricao:data.descricao,categoria:data.categoria,competencia:data.competencia,vencimento:data.vencimento,valor_total:data.valor_total,condicao_pagamento:'avista',parcelas:1});
      if(mode==='payment')operation=workflow.preparePayment(selected,{valor:data.valor,forma:data.forma,parcela_id:data.parcela_id||undefined,pago_em:`${data.data}T00:00:00-03:00`,parcelas:Number(data.parcelas),referencia:data.referencia});
      if(mode==='reverse')operation=workflow.prepareReversal(selected,{pagamento_id:data.pagamento_id,valor:data.valor,pago_em:`${data.data}T00:00:00-03:00`,referencia:data.referencia});
      if(mode==='cancel')operation=workflow.prepareCancel(selected,data.motivo);
      if(mode==='installments'){
        const rows=[...formEl.querySelectorAll('[data-fw-row]')].map((row,index)=>({numero:index+1,vencimento:row.querySelector('[data-fw-due]').value,valor:row.querySelector('[data-fw-value]').value,forma_pagamento:row.querySelector('[data-fw-method]').value}));
        operation=workflow.prepareInstallments(selected,rows);
      }
      await save();
    }catch(error){announce(errorMessage(error),'error');}
  }
  async function onClick(event){
    const control=event.target.closest?.('[data-fw-action]');if(!control||!root.contains(control)||control.disabled)return;
    const action=control.dataset.fwAction;if(busy)return;
    try{
      if(action==='close'){formHost.replaceChildren();dirty=false;operation=null;return;}
      if(action==='retry'){if(verifiedUncertain)await save(true);return;}
      if(action==='reload'){
        if(!onReload||!operation)return;busy=true;
        const fresh=await onReload(operation);if(disposed)return;
        if(!Array.isArray(fresh))throw Error('Invalid entries');entries=fresh;
        formHost.querySelector('[data-fw-verification]')?.remove();
        const verification=root.ownerDocument.createElement('div');verification.dataset.fwVerification='';
        const related=operation.context?fresh.filter(e=>e.id===operation.context.id):fresh;
        verification.innerHTML=`<h4>Dados recarregados para conferência</h4><p>Ausência nesta página não prova falha no envio.</p>${related.length?related.map(e=>`<article class="fw-entry"><h5>${escape(e.descricao)}</h5><p>${escape(e.estado)} · Total ${escape(money(e.valor_total))} · Saldo ${escape(money(e.saldo))}</p>${paymentHistory(e)}</article>`).join(''):'<p>Nenhum lançamento correspondente nesta página.</p>'}`;
        formHost.append(verification);
        if(mode==='installments'){
          const entry=find(operation.context.id);if(!entry){announce('O lançamento não foi encontrado nesta consulta. Isso não confirma falha no envio.','error');return;}
          const result=await workflow.reconcileInstallments(operation,entry);
          if(result.matched){dirty=false;formHost.replaceChildren();announce('O servidor contém o plano de parcelas enviado.');await onChanged({lancamento:entry,reconciliado:true},{operation});}
          else{dirty=false;formHost.replaceChildren();announce('O plano atual é diferente. Revise os dados recarregados antes de preparar outro plano.','error');}
        }else{
          verifiedUncertain=true;formHost.querySelector('[data-fw-recovery]')?.remove();uncertainty();announce('Lista recarregada para conferência. Se necessário, repita o mesmo envio: a chave original será mantida.');
        }return;
      }
      if(action==='build-plan'){
        const formEl=formHost.querySelector('form'),data=Object.fromEntries(new FormData(formEl)),count=Number(data.quantidade),initial=data.primeiro;
        if(!Number.isInteger(count)||count<1||count>120||!/^\d{4}-\d{2}-\d{2}$/.test(initial))throw Error('Invalid installments');
        const total=BigInt(reaisDecimal(selected.saldo).replace('.',''));if(total<BigInt(count))throw Error('Invalid installments');
        const [year,month,day]=initial.split('-').map(Number);const per=total/BigInt(count),remainder=total%BigInt(count);
        formEl.querySelector('[data-fw-rows]').innerHTML=Array.from({length:count},(_,i)=>{const base=new Date(Date.UTC(year,month-1+i,1)),last=new Date(Date.UTC(base.getUTCFullYear(),base.getUTCMonth()+1,0)).getUTCDate(),due=new Date(Date.UTC(base.getUTCFullYear(),base.getUTCMonth(),Math.min(day,last))).toISOString().slice(0,10);return `<div class="fw-plan-row" data-fw-row><span>Parcela ${i+1}</span>${field('Vencimento',`due_${i}`,due,'date','data-fw-due required')}${field('Valor em reais',`value_${i}`,centsToReais(Number(per+(BigInt(i)<remainder?1n:0n))),'text','data-fw-value required inputmode="decimal"')}<label>Forma<select name="method_${i}" data-fw-method>${methodsOptions(data.forma_prevista)}</select></label></div>`;}).join('');return;
      }
      if(['create','payment','installments','reverse','cancel'].includes(action)){const entry=action==='create'?null:find(control.dataset.id);if(action!=='create'&&!entry)throw Error('Entry unavailable');show(action,entry);}
    }catch(error){announce(errorMessage(error),'error');}finally{if(action==='reload')busy=false;}
  }
  const onInput=()=>{dirty=true;};root.addEventListener('click',onClick);root.addEventListener('submit',onSubmit);root.addEventListener('input',onInput);
  return {isDirty:()=>dirty,isBusy:()=>busy,dispose(){disposed=true;root.removeEventListener('click',onClick);root.removeEventListener('submit',onSubmit);root.removeEventListener('input',onInput);formHost.replaceChildren();entries=[];patients=[];suppliers=[];selected=null;operation=null;}};
}
