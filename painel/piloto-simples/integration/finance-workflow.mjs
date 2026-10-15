import { IntegrationError } from './errors.mjs';

/** Contract verified against financeiro-fichas v8 and the five deployed RPC
 * definitions on 2026-10-15 (metadata/source only; no clinical rows or writes).
 * All wire monetary values are decimal REAIS, never prototype integer cents.
 * request(endpoint,action,payload) must be the existing authenticated Edge client.
 * session must implement requireReady/assertCurrent/subscribe (session.mjs).
 * Operations live in memory; never persist financial data in local/sessionStorage.
 *
 * Legacy limits: versao is returned but mutations have no expected-version CAS;
 * no get-entry endpoint or ID filter exists; callers reload their paginated list.
 * Installment retries are based on the current plan/balance, NOT a unique durable
 * plan-key replay. After uncertainty, reconcile with a fresh server entry first.
 * registrar_atendimento is deliberately not composed: it uses multiple RPCs and
 * can partially succeed. Clinic completion belongs to operacao-clinica-fichas.
 * Recurring expenses, fees/tax decomposition and editing an entry are not exposed
 * by this contract. Expenses here are individual payable entries, not recurrence.
 */
export const FINANCE_CONTRACT = Object.freeze({
  endpoint:'financeiro-fichas', verifiedVersion:8,
  actions:Object.freeze(['criar_lancamento','programar_parcelas','registrar_pagamento','estornar_pagamento','cancelar_lancamento']),
  moneyUnit:'BRL decimal reais', serverVersionCAS:false, durableInstallmentRetry:false,
  recurringExpenses:false, combinedCreatePaymentAtomic:false,
});
export const FINANCE_METHODS = Object.freeze(['pix','dinheiro','cartao_debito','cartao_credito','boleto','transferencia','outro']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail=(code,message)=>{throw new IntegrationError(code,message);};
const clone=value=>structuredClone(value);
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function id(value,name){if(!UUID.test(value??''))fail('invalid_id',`Identificador inválido: ${name}.`);return value;}
function text(value,name,min,max){if(typeof value!=='string'||value.trim().length<min||value.trim().length>max)fail('invalid_field',`Confira ${name}.`);return value.trim();}
function choice(value,values,name){if(!values.includes(value))fail('invalid_field',`Confira ${name}.`);return value;}
function integer(value,min,max,name){if(!Number.isInteger(value)||value<min||value>max)fail('invalid_field',`Confira ${name}.`);return value;}
function record(value){if(!value||typeof value!=='object'||Array.isArray(value))fail('invalid_payload','Dados financeiros inválidos.');return value;}
function allowed(value,keys){record(value);if(Object.keys(value).some(key=>!keys.includes(key)))fail('unsupported_field','O envio contém um campo fora do contrato financeiro.');}
export function reaisDecimal(value,{allowZero=false}={}){
  // No thousands separators or floating-point rounding. 100 means R$100.00.
  const source=typeof value==='number'&&Number.isFinite(value)?String(value):typeof value==='string'?value.trim():'';
  const match=/^(\d{1,12})(?:[.,](\d{1,2}))?$/.exec(source);
  if(!match)fail('invalid_money','Informe um valor em reais com até duas casas decimais, sem separador de milhar.');
  const canonical=String(BigInt(match[1]))+'.'+(match[2]??'').padEnd(2,'0');
  if(!allowZero&&canonical==='0.00')fail('invalid_money','O valor deve ser maior que zero.');
  return canonical;
}
export function centsToReais(cents){
  if(!Number.isSafeInteger(cents)||cents<0||cents>99_999_999_999_999)fail('invalid_money','Valor em centavos inválido.');
  return `${Math.floor(cents/100)}.${String(cents%100).padStart(2,'0')}`;
}
const cent=value=>BigInt(reaisDecimal(value,{allowZero:true}).replace('.',''));
function date(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))fail('invalid_date','Confira a data.');
  const time=Date.parse(value+'T12:00:00Z');
  if(!Number.isFinite(time)||new Date(time).toISOString().slice(0,10)!==value||value<'2000-01-01'||value>'2100-12-31')fail('invalid_date','Confira a data.');
  return value;
}
function timestamp(value,now){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value))fail('invalid_date','Informe data e hora com fuso horário.');
  date(value.slice(0,10));const ms=Date.parse(value);
  if(!Number.isFinite(ms)||ms>now()+300000)fail('invalid_date','O pagamento não pode ter data futura.');
  return new Date(ms).toISOString();
}
function reference(value){
  if(value==null||value==='')return null;
  const result=text(value,'referência',1,120),digits=result.replace(/\D/g,'');
  if(!/^[\p{L}\p{N} ._\-/#:]+$/u.test(result)||/\d{9,}/.test(result)||/(^|[^a-z])(cvv|cvc)([^a-z]|$)/i.test(result)||digits.length>=13)fail('invalid_reference','Use uma referência curta, sem dados de cartão.');
  return result;
}
function entrySnapshot(entry,{active=true}={}){
  record(entry);id(entry.id,'lancamento_id');integer(entry.versao,1,Number.MAX_SAFE_INTEGER,'versão retornada pelo servidor');
  choice(entry.tipo,['receita','despesa'],'tipo');if(active&&entry.estado!=='ativo')fail('entry_inactive','Este lançamento não está ativo.');
  return freeze({id:entry.id,version:entry.versao,type:entry.tipo,balance:reaisDecimal(entry.saldo,{allowZero:true})});
}
function planRows(rows,minimumDate,balance){
  if(!Array.isArray(rows)||rows.length<1||rows.length>120)fail('invalid_installments','Informe de 1 a 120 parcelas.');
  const result=rows.map((row,index)=>{allowed(row,['numero','vencimento','valor','forma_pagamento']);const due=date(row.vencimento);
    if(due<minimumDate)fail('invalid_installments','A parcela não pode vencer antes da competência.');
    return {numero:integer(row.numero??index+1,1,120,'número da parcela'),vencimento:due,valor:reaisDecimal(row.valor),forma_pagamento:choice(row.forma_pagamento,FINANCE_METHODS,'forma de pagamento')};
  }).sort((a,b)=>a.numero-b.numero);
  if(result.some((row,index)=>row.numero!==index+1))fail('invalid_installments','As parcelas precisam estar em sequência, sem repetição.');
  if(result.reduce((sum,row)=>sum+cent(row.valor),0n)!==cent(balance))fail('installment_total_mismatch','A soma das parcelas deve ser exatamente igual ao saldo.');
  return result;
}
const planComparable=rows=>rows.map(row=>({numero:row.numero,vencimento:row.vencimento,valor:reaisDecimal(row.valor),forma_pagamento:row.forma_pagamento})).sort((a,b)=>a.numero-b.numero);
function checkResponse(action,payload,result){
  record(result);
  if(result.ok===false||result.erro)fail('finance_unconfirmed','O serviço não confirmou a operação.');
  if(['criar_lancamento','programar_parcelas'].includes(action)){
    const e=result.lancamento;entrySnapshot(e,{active:false});
    if(action==='criar_lancamento'){
      if(e.tipo!==payload.tipo||e.origem!==payload.origem||cent(e.valor_total)!==cent(payload.valor_total)||e.descricao!==payload.descricao||e.categoria!==payload.categoria||e.competencia!==payload.competencia||e.vencimento!==payload.vencimento||(e.cliente?.id??null)!==payload.cliente_id||(e.fornecedor?.id??null)!==payload.fornecedor_id)fail('finance_unconfirmed','A resposta não corresponde à cobrança enviada.');
    }else if(e.id!==payload.lancamento_id||JSON.stringify(planComparable(e.parcelas_previstas??[]))!==JSON.stringify(payload.parcelas))fail('finance_unconfirmed','A resposta não confirmou o plano de parcelas.');
  }else if(action==='cancelar_lancamento'){
    if(result.cancelado!==true)fail('finance_unconfirmed','O cancelamento não foi confirmado.');
  }else{
    const p=record(result.pagamento);id(p.id,'pagamento_id');
    if(p.lancamento_id!==payload.lancamento_id||p.tipo!==(action==='estornar_pagamento'?'estorno':'pagamento')||cent(p.valor)!==cent(payload.valor)||p.forma!==payload.forma||(p.parcela_id??null)!==(payload.parcela_id??null)||(p.pagamento_estornado_id??null)!==(payload.pagamento_id??null)||Date.parse(p.pago_em)!==Date.parse(payload.pago_em)||p.parcelas!==payload.parcelas||(p.referencia??null)!==payload.referencia)fail('finance_unconfirmed','A resposta não confirmou o movimento financeiro enviado.');
  }
}

export function createFinanceWorkflow({request,session,uuid=()=>crypto.randomUUID(),now=Date.now}={}){
  if(typeof request!=='function'||!session?.requireReady||!session?.assertCurrent||!session?.subscribe)fail('finance_dependencies','Conecte o cliente autenticado e o controle de sessão.');
  const operations=new Map();let disposed=false;
  const unsubscribe=session.subscribe(()=>operations.clear());
  const newId=value=>id(value??uuid(),'identificador da operação');
  function state(op){if(disposed)fail('client_closed','O fluxo financeiro foi fechado.');const found=operations.get(op?.id);if(!found||found.op!==op)fail('operation_expired','Reabra o financeiro nesta sessão.');return found;}
  function prepare(action,payload,context=null){
    if(disposed)fail('client_closed','O fluxo financeiro foi fechado.');
    const operationId=payload.idempotency_key??payload.operation_id;
    const signature=JSON.stringify({...payload,idempotency_key:undefined,operation_id:undefined});
    for(const existing of operations.values()){
      if(existing.op.id===operationId){if(existing.op.action!==action||JSON.stringify(existing.op.payload)!==JSON.stringify(payload))fail('idempotency_key_reused','Não reutilize uma chave com dados diferentes.');return existing.op;}
      if(['sending','uncertain'].includes(existing.status)&&((context&&existing.op.context?.id===context.id)||(!context&&existing.signature===signature)))fail('finance_pending','Há um envio pendente ou sem confirmação. Confira-o antes de criar outra operação.');
    }
    const op=freeze({id:operationId,action,payload:clone(payload),context});operations.set(op.id,{op,signature,status:'prepared',response:null,promise:null,identity:null});return op;
  }
  function prepareCreate(input){
    allowed(input,['idempotency_key','tipo','origem','cliente_id','fornecedor_id','descricao','categoria','competencia','vencimento','valor_total','condicao_pagamento','parcelas','observacoes']);
    const type=choice(input.tipo,['receita','despesa'],'tipo'),origin=choice(input.origem,['atendimento','produto','operacional','ajuste'],'origem');
    const patient=input.cliente_id?id(input.cliente_id,'cliente_id'):null,supplier=input.fornecedor_id?id(input.fornecedor_id,'fornecedor_id'):null;
    if(type==='receita'&&!patient&&origin!=='ajuste')fail('client_required','Selecione a paciente desta cobrança.');
    const competence=date(input.competencia),due=date(input.vencimento);
    if(due<competence)fail('invalid_date','O vencimento não pode ser anterior à competência.');
    return prepare('criar_lancamento',{idempotency_key:newId(input.idempotency_key),tipo:type,origem:origin,cliente_id:patient,fornecedor_id:supplier,descricao:text(input.descricao,'descrição',2,200),categoria:text(input.categoria,'categoria',2,100),competencia:competence,vencimento:due,valor_total:reaisDecimal(input.valor_total),condicao_pagamento:choice(input.condicao_pagamento??'avista',['avista','parcelado','entrada_saldo'],'condição'),parcelas:integer(input.parcelas??1,1,120,'parcelas'),observacoes:input.observacoes?text(input.observacoes,'observações',1,1000):null});
  }
  function prepareInstallments(entry,rows,{idempotencyKey}={}){
    const context=entrySnapshot(entry);if(cent(context.balance)<=0n)fail('entry_has_no_balance','Este lançamento já está quitado.');
    return prepare('programar_parcelas',{idempotency_key:newId(idempotencyKey),lancamento_id:entry.id,parcelas:planRows(rows,date(entry.competencia),context.balance)},context);
  }
  function prepareMovement(entry,input,refund){
    allowed(input,['idempotency_key','operation_id','pagamento_id','parcela_id','forma','valor','pago_em','parcelas','referencia']);const context=entrySnapshot(entry);
    const amount=reaisDecimal(input.valor),installments=entry.parcelas_previstas??[],payments=entry.pagamentos??[];
    let method=input.forma,installmentId=input.parcela_id||null,originalId=null;
    if(refund){
      originalId=id(input.pagamento_id,'pagamento_id');const original=payments.find(p=>p.id===originalId&&p.tipo==='pagamento');
      if(!original)fail('payment_not_found','Recarregue o lançamento que contém o pagamento original.');
      method=original.forma;
      if(installmentId&&installmentId!==original.parcela_id)fail('payment_installment_mismatch','O pagamento pertence a outra parcela.');
      installmentId=original.parcela_id??null;
      const reversed=payments.filter(p=>p.tipo==='estorno'&&p.pagamento_estornado_id===originalId).reduce((sum,p)=>sum+cent(p.valor),0n);
      if(cent(amount)>cent(original.valor)-reversed)fail('refund_exceeds_payment','O valor supera o saldo estornável deste pagamento.');
    }else{
      if(input.pagamento_id||input.operation_id)fail('unsupported_field','Recebimento não usa os campos de estorno.');
      if(cent(amount)>cent(context.balance))fail('payment_exceeds_balance','O valor supera o saldo do lançamento.');
      if(installments.length&&!installmentId)fail('installment_required','Selecione a parcela que será recebida ou paga.');
      if(installmentId){const selected=installments.find(p=>p.id===installmentId&&p.estado==='ativa');if(!selected)fail('invalid_installment','A parcela não pertence a este lançamento ou não está ativa.');if(cent(amount)>cent(selected.saldo))fail('payment_exceeds_installment','O valor supera o saldo da parcela.');}
    }
    choice(method,FINANCE_METHODS,'forma de pagamento');if(installmentId)id(installmentId,'parcela_id');
    const count=integer(input.parcelas??1,1,120,'parcelas da transação');if(method!=='cartao_credito'&&count!==1)fail('invalid_transaction_installments','Parcelas da transação só se aplicam ao cartão de crédito.');
    const key=newId(input.idempotency_key);
    const payload={idempotency_key:key,lancamento_id:entry.id,parcela_id:installmentId,forma:method,valor:amount,pago_em:timestamp(input.pago_em??new Date(now()).toISOString(),now),parcelas:count,referencia:reference(input.referencia)};
    if(refund){payload.pagamento_id=originalId;payload.operation_id=newId(input.operation_id??key);}
    return prepare(refund?'estornar_pagamento':'registrar_pagamento',payload,context);
  }
  function prepareCancel(entry,reason,{operationId}={}){
    const context=entrySnapshot(entry);
    if(entry.origem==='compra')fail('purchase_cancel_requires_full_workflow','Cancele a compra pelo fluxo completo de compra e estoque.');
    if(cent(entry.valor_pago)!==0n)fail('entry_has_payment','Estorne os pagamentos antes de cancelar o lançamento.');
    return prepare('cancelar_lancamento',{operation_id:newId(operationId),lancamento_id:entry.id,motivo:text(reason,'motivo',3,500)},context);
  }
  async function send(op,retry){
    const current=state(op);const auth=await session.requireReady();await session.assertCurrent(auth);state(op);
    if(current.identity&&current.identity!==auth.userId)fail('session_changed','A conta mudou. Reabra o financeiro.');current.identity=auth.userId;
    if(current.status==='confirmed')return clone(current.response);
    if(current.status==='sending')return current.promise;
    if(current.status==='rejected')fail('operation_rejected','Corrija os dados após recarregar o lançamento e prepare uma nova operação.');
    if(current.status==='uncertain'&&(!retry||op.action==='programar_parcelas'))fail('finance_reconciliation_required','Confira o lançamento antes de repetir. Parcelas precisam ser reconciliadas com um plano recarregado.');
    for(const other of operations.values())if(other!==current&&['sending','uncertain'].includes(other.status)&&((op.context&&other.op.context?.id===op.context.id)||(!op.context&&other.signature===current.signature)))fail('finance_pending','Existe outra operação pendente para este lançamento.');
    const wasUncertain=current.status==='uncertain';current.status='sending';
    current.promise=(async()=>{
      let sent=false;
      try{
        await session.assertCurrent(auth);state(op);sent=true;
        const response=await request(FINANCE_CONTRACT.endpoint,op.action,clone(op.payload));
        await session.assertCurrent(auth);state(op);
        try{checkResponse(op.action,op.payload,response);}catch{throw new IntegrationError('finance_response_unconfirmed','A resposta não confirmou os valores e vínculos. Recarregue antes de repetir.',{uncertain:true});}
        current.status='confirmed';current.response=clone(response);return clone(response);
      }catch(error){
        const unknown=wasUncertain||sent&&(error.uncertain===true||error.status>=500||!(error instanceof IntegrationError)||['session_changed','session_expired','operation_expired','unexpected_auth_context'].includes(error.code));
        current.status=unknown?'uncertain':'rejected';
        if(!(error instanceof IntegrationError))throw new IntegrationError('finance_connection_failed','O envio não foi confirmado. Recarregue o lançamento antes de repetir.',{uncertain:unknown});
        if(unknown&&!error.uncertain)throw new IntegrationError(error.code,error.message,{status:error.status,uncertain:true});
        throw error;
      }finally{current.promise=null;}
    })();return current.promise;
  }
  async function reconcileInstallments(op,freshEntry){
    const current=state(op);if(op.action!=='programar_parcelas'||current.status!=='uncertain')fail('reconciliation_unavailable','Não há parcelamento incerto para conferir.');
    const auth=await session.requireReady();await session.assertCurrent(auth);state(op);
    if(current.identity!==auth.userId)fail('session_changed','A conta mudou.');
    const entry=entrySnapshot(freshEntry,{active:false});if(entry.id!==op.context.id)fail('invalid_id','O lançamento recarregado é diferente.');
    if(entry.version<op.context.version)fail('stale_finance_context','A resposta contém uma versão anterior. Recarregue o lançamento.');
    if(freshEntry.estado==='ativo'&&JSON.stringify(planComparable(freshEntry.parcelas_previstas??[]))===JSON.stringify(op.payload.parcelas)){
      current.status='confirmed';current.response={lancamento:clone(freshEntry),reconciliado:true};return {matched:true};
    }
    // Do not replay the previous plan over a newer plan. Caller explicitly
    // reviews the refreshed entry and prepares a NEW plan if still desired.
    current.status='rejected';return {matched:false,requiresNewReview:true};
  }
  return Object.freeze({prepareCreate,prepareInstallments,preparePayment:(e,p)=>prepareMovement(e,p,false),prepareReversal:(e,p)=>prepareMovement(e,p,true),prepareCancel,
    execute:op=>send(op,false),retry:op=>send(op,true),reconcileInstallments,status:op=>state(op).status,
    dispose(){disposed=true;operations.clear();unsubscribe();},
  });
}
