import test from 'node:test';
import assert from 'node:assert/strict';
import {createFinanceWorkflow,reaisDecimal,centsToReais,FINANCE_CONTRACT} from '../finance-workflow.mjs';
import {renderFinanceWorkflow} from '../finance-workflow-ui.mjs';
import {IntegrationError} from '../errors.mjs';

const uid=n=>`11111111-1111-4111-8111-${String(n).padStart(12,'0')}`;
const entryId=uid(1),patientId=uid(2),paymentId=uid(3),installmentId=uid(4),supplierId=uid(5);
const now=()=>Date.parse('2026-10-15T15:00:00Z');
const charge=()=>({tipo:'receita',origem:'atendimento',cliente_id:patientId,descricao:'Atendimento de teste',categoria:'Serviço de teste',competencia:'2026-10-15',vencimento:'2026-10-30',valor_total:'100.01',condicao_pagamento:'avista',parcelas:1});
const entry=(overrides={})=>({id:entryId,versao:3,tipo:'receita',origem:'atendimento',estado:'ativo',status:'pendente',valor_total:100.01,valor_pago:0,saldo:100.01,competencia:'2026-10-15',vencimento:'2026-10-30',descricao:'Atendimento de teste',categoria:'Serviço de teste',cliente:{id:patientId,nome:'Paciente fictícia'},pagamentos:[],parcelas_previstas:[],...overrides});
const payment=(overrides={})=>({id:paymentId,tipo:'pagamento',forma:'pix',valor:40,parcela_id:null,pago_em:'2026-10-15T12:00:00Z',pagamento_estornado_id:null,parcelas:1,referencia:null,...overrides});
const plan=()=>[{numero:1,vencimento:'2026-10-30',valor:'50.01',forma_pagamento:'pix'},{numero:2,vencimento:'2026-11-30',valor:'50.00',forma_pagamento:'pix'}];
function response(action,p){
  if(action==='criar_lancamento')return {lancamento:entry({tipo:p.tipo,origem:p.origem,descricao:p.descricao,categoria:p.categoria,competencia:p.competencia,vencimento:p.vencimento,valor_total:p.valor_total,saldo:p.valor_total,cliente:p.cliente_id?{id:p.cliente_id}:null,fornecedor:p.fornecedor_id?{id:p.fornecedor_id}:null})};
  if(action==='programar_parcelas')return {lancamento:entry({id:p.lancamento_id,versao:4,parcelas_previstas:p.parcelas})};
  if(action==='cancelar_lancamento')return {cancelado:true,idempotente:false};
  return {pagamento:{id:paymentId,lancamento_id:p.lancamento_id,tipo:action==='estornar_pagamento'?'estorno':'pagamento',forma:p.forma,valor:p.valor,parcela_id:p.parcela_id,pago_em:p.pago_em,parcelas:p.parcelas,referencia:p.referencia,pagamento_estornado_id:p.pagamento_id??null}};
}
function harness(handler=response){
  let count=100,revision=0,userId=uid(90),blocked=false;const calls=[],listeners=new Set();
  const session={async requireReady(){if(blocked)throw new IntegrationError('mfa_required','MFA necessário');return {revision,userId};},async assertCurrent(s){if(s.revision!==revision||s.userId!==userId)throw new IntegrationError('session_changed','Sessão mudou');},subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);}};
  const workflow=createFinanceWorkflow({request:async(endpoint,action,payload)=>{calls.push({endpoint,action,payload:structuredClone(payload)});return handler(action,payload);},session,now,uuid:()=>uid(++count)});
  return {workflow,calls,session,block(){blocked=true;},invalidate(){revision++;for(const fn of listeners)fn();},changeIdentity(){userId=uid(91);}};
}

test('money explicitly separates decimal reais from prototype cents, without rounding',()=>{
  assert.equal(reaisDecimal('00100,01'),'100.01');assert.equal(reaisDecimal(100),'100.00');assert.equal(centsToReais(10001),'100.01');assert.equal(reaisDecimal('999999999999.99'),'999999999999.99');
  for(const value of ['1.001','1.000,00','1e3',NaN,Infinity,-1,0,'R$ 10',0.1+0.2])assert.throws(()=>reaisDecimal(value),{code:'invalid_money'});
  assert.throws(()=>centsToReais(1.2),{code:'invalid_money'});
});
test('create charge uses real Edge contract and canonical decimal strings',async()=>{
  const h=harness(),input=charge(),op=h.workflow.prepareCreate(input);input.valor_total='999';assert.equal(op.payload.valor_total,'100.01');assert.ok(Object.isFrozen(op.payload));
  const result=await h.workflow.execute(op);assert.equal(result.lancamento.valor_total,'100.01');assert.equal(h.calls.length,1);
  assert.equal(h.calls[0].endpoint,'financeiro-fichas');assert.equal(h.calls[0].action,'criar_lancamento');assert.equal(h.calls[0].payload.cliente_id,patientId);assert.equal(h.calls[0].payload.fornecedor_id,null);
  assert.equal(h.calls[0].payload.versao_esperada,undefined);assert.equal(h.workflow.status(op),'confirmed');
});
test('expense creates only payable entry and never implies payment',async()=>{
  const h=harness(),op=h.workflow.prepareCreate({...charge(),tipo:'despesa',origem:'operacional',cliente_id:undefined,fornecedor_id:supplierId,valor_total:'30'});
  const result=await h.workflow.execute(op);assert.equal(result.lancamento.tipo,'despesa');assert.equal(result.lancamento.valor_pago,0);assert.equal(h.calls.length,1);
  assert.equal(h.calls[0].payload.valor_total,'30.00');assert.equal(h.calls[0].payload.fornecedor_id,supplierId);
});
test('unknown fields, fake version CAS and purchase origins fail before request',()=>{
  const h=harness();for(const extra of [{valor_total_centavos:10001},{expected_version:3},{acao:'outro'},{password:'never send'}])assert.throws(()=>h.workflow.prepareCreate({...charge(),...extra}),{code:'unsupported_field'});
  assert.throws(()=>h.workflow.prepareCreate({...charge(),origem:'compra'}));assert.throws(()=>h.workflow.prepareCreate({...charge(),cliente_id:undefined}),{code:'client_required'});assert.equal(h.calls.length,0);
});
test('invalid calendar dates and missing server version are refused',()=>{
  const h=harness();assert.throws(()=>h.workflow.prepareCreate({...charge(),vencimento:'2026-02-30'}),{code:'invalid_date'});
  assert.throws(()=>h.workflow.preparePayment(entry({versao:undefined}),{valor:10,forma:'pix'}),{code:'invalid_field'});
  assert.throws(()=>h.workflow.preparePayment(entry(),{valor:10,forma:'pix',pago_em:'2026-10-15T12:00:00'}),{code:'invalid_date'});
  assert.throws(()=>h.workflow.preparePayment(entry(),{valor:10,forma:'pix',pago_em:'2026-10-20T12:00:00Z'}),{code:'invalid_date'});
});
test('MFA/session guard rejects before any financial network call',async()=>{
  const h=harness(),op=h.workflow.prepareCreate(charge());h.block();await assert.rejects(h.workflow.execute(op),{code:'mfa_required'});assert.equal(h.calls.length,0);
});
test('simultaneous submit of same immutable operation sends only once',async()=>{
  let release,started;const waiting=new Promise(r=>started=r),h=harness((action,payload)=>new Promise(r=>{release=()=>r(response(action,payload));started();}));
  const op=h.workflow.prepareCreate(charge()),first=h.workflow.execute(op),second=h.workflow.execute(op);await waiting;release();const [a,b]=await Promise.all([first,second]);assert.deepEqual(a,b);assert.equal(h.calls.length,1);
  await h.workflow.execute(op);assert.equal(h.calls.length,1);
});
test('operation key cannot be reused for a changed payload',()=>{
  const h=harness(),op=h.workflow.prepareCreate({...charge(),idempotency_key:uid(99)});assert.equal(h.workflow.prepareCreate({...charge(),idempotency_key:uid(99)}),op);
  assert.throws(()=>h.workflow.prepareCreate({...charge(),idempotency_key:uid(99),valor_total:200}),{code:'idempotency_key_reused'});
});
test('partial payment captures stable date, entry, amount and no automatic installments',async()=>{
  const h=harness(),op=h.workflow.preparePayment(entry(),{valor:'20,50',forma:'pix'});assert.equal(op.context.version,3);await h.workflow.execute(op);
  assert.deepEqual(h.calls[0].payload,{idempotency_key:op.id,lancamento_id:entryId,parcela_id:null,forma:'pix',valor:'20.50',pago_em:'2026-10-15T15:00:00.000Z',parcelas:1,referencia:null});
  assert.equal(h.calls[0].action,'registrar_pagamento');
});
test('expense payment uses same ledger contract without changing the payable kind',async()=>{
  const h=harness(),op=h.workflow.preparePayment(entry({tipo:'despesa'}),{valor:15,forma:'transferencia'});await h.workflow.execute(op);assert.equal(op.context.type,'despesa');assert.equal(h.calls[0].action,'registrar_pagamento');
});
test('installment selection and balance are required when a plan exists',async()=>{
  const h=harness(),e=entry({parcelas_previstas:[{id:installmentId,estado:'ativa',saldo:50.01}]});
  assert.throws(()=>h.workflow.preparePayment(e,{valor:10,forma:'pix'}),{code:'installment_required'});
  assert.throws(()=>h.workflow.preparePayment(e,{valor:50.02,forma:'pix',parcela_id:installmentId}),{code:'payment_exceeds_installment'});
  assert.throws(()=>h.workflow.preparePayment(e,{valor:10,forma:'pix',parcela_id:uid(55)}),{code:'invalid_installment'});
  await h.workflow.execute(h.workflow.preparePayment(e,{valor:10,forma:'pix',parcela_id:installmentId}));assert.equal(h.calls[0].payload.parcela_id,installmentId);
});
test('overpayment, non-credit transaction installments and card data are rejected',()=>{
  const h=harness();assert.throws(()=>h.workflow.preparePayment(entry(),{valor:100.02,forma:'pix'}),{code:'payment_exceeds_balance'});
  assert.throws(()=>h.workflow.preparePayment(entry(),{valor:10,forma:'pix',parcelas:2}),{code:'invalid_transaction_installments'});
  for(const referencia of ['4111 1111 1111 1111','cvv 123','123456789'])assert.throws(()=>h.workflow.preparePayment(entry(),{valor:10,forma:'pix',referencia}),{code:'invalid_reference'});
});
test('reversal preserves original method, installment, payment and date event',async()=>{
  const h=harness(),e=entry({saldo:60.01,valor_pago:40,pagamentos:[payment({parcela_id:installmentId})]});
  const op=h.workflow.prepareReversal(e,{pagamento_id:paymentId,valor:10,forma:'dinheiro',pago_em:'2026-10-15T09:00:00-03:00'});await h.workflow.execute(op);
  const p=h.calls[0].payload;assert.equal(p.forma,'pix');assert.equal(p.parcela_id,installmentId);assert.equal(p.pagamento_id,paymentId);assert.equal(p.operation_id,op.id);assert.equal(p.idempotency_key,op.id);assert.equal(p.pago_em,'2026-10-15T12:00:00.000Z');assert.equal(e.pagamentos.length,1);
});
test('reversal maximum accounts for prior reversal events and refuses mismatched installment',()=>{
  const h=harness(),e=entry({pagamentos:[payment(),payment({id:uid(20),tipo:'estorno',valor:30,pagamento_estornado_id:paymentId})]});
  assert.throws(()=>h.workflow.prepareReversal(e,{pagamento_id:paymentId,valor:10.01}),{code:'refund_exceeds_payment'});
  assert.throws(()=>h.workflow.prepareReversal(e,{pagamento_id:paymentId,valor:10,parcela_id:installmentId}),{code:'payment_installment_mismatch'});
  assert.throws(()=>h.workflow.prepareReversal(e,{pagamento_id:uid(44),valor:10}),{code:'payment_not_found'});
});
test('installment totals use exact cents and returned version is only local context',async()=>{
  const h=harness(),rows=plan(),op=h.workflow.prepareInstallments(entry(),rows);rows[0].valor='999';await h.workflow.execute(op);
  assert.deepEqual(h.calls[0].payload.parcelas,plan());assert.equal(op.context.version,3);assert.equal(h.calls[0].payload.versao,undefined);
  assert.equal(FINANCE_CONTRACT.serverVersionCAS,false);assert.equal(FINANCE_CONTRACT.durableInstallmentRetry,false);
  assert.throws(()=>h.workflow.prepareInstallments(entry(),[{...plan()[0],valor:'100.00'}]),{code:'installment_total_mismatch'});
  assert.throws(()=>h.workflow.prepareInstallments(entry(),[{...plan()[0],numero:2,valor:'100.01'}]),{code:'invalid_installments'});
});
test('network uncertainty never retries automatically and retains exact key and payload',async()=>{
  let count=0;const h=harness((action,payload)=>{if(++count===1)throw new IntegrationError('timeout','Sem confirmação',{uncertain:true});return response(action,payload);});
  const op=h.workflow.preparePayment(entry(),{valor:15,forma:'pix'});await assert.rejects(h.workflow.execute(op),e=>e.uncertain);assert.equal(h.calls.length,1);assert.equal(h.workflow.status(op),'uncertain');
  await assert.rejects(h.workflow.execute(op),{code:'finance_reconciliation_required'});
  assert.throws(()=>h.workflow.preparePayment(entry(),{valor:15,forma:'pix'}),{code:'finance_pending'});
  await h.workflow.retry(op);assert.equal(h.calls.length,2);assert.deepEqual(h.calls[1],h.calls[0]);
});
test('retry rejection after uncertainty does not turn an unknown original result into failure',async()=>{
  let count=0;const h=harness(()=>{throw ++count===1?new IntegrationError('timeout','Sem confirmação',{uncertain:true}):new IntegrationError('conflict','Conflito',{status:409});});
  const op=h.workflow.prepareCreate(charge());await assert.rejects(h.workflow.execute(op));await assert.rejects(h.workflow.retry(op),e=>e.uncertain&&e.status===409);assert.equal(h.workflow.status(op),'uncertain');
  assert.throws(()=>h.workflow.prepareCreate(charge()),{code:'finance_pending'});
});
test('HTTP 409 on first send is surfaced without automatic retry',async()=>{
  const h=harness(()=>{throw new IntegrationError('installments_changed','Conflito',{status:409});}),op=h.workflow.prepareInstallments(entry(),plan());
  await assert.rejects(h.workflow.execute(op),{status:409});assert.equal(h.calls.length,1);assert.equal(h.workflow.status(op),'rejected');await assert.rejects(h.workflow.retry(op),{code:'operation_rejected'});
});
test('uncertain installment plan cannot be replayed and only matching fresh plan reconciles',async()=>{
  const h=harness(()=>{throw new TypeError('connection lost');}),op=h.workflow.prepareInstallments(entry(),plan());
  await assert.rejects(h.workflow.execute(op),e=>e.uncertain);await assert.rejects(h.workflow.retry(op),{code:'finance_reconciliation_required'});assert.equal(h.calls.length,1);
  const matched=await h.workflow.reconcileInstallments(op,entry({versao:4,parcelas_previstas:plan()}));assert.equal(matched.matched,true);assert.equal(h.workflow.status(op),'confirmed');assert.equal(h.calls.length,1);
});
test('different refreshed plan requires review instead of overwriting with old uncertain plan',async()=>{
  const h=harness(()=>{throw new TypeError('connection lost');}),op=h.workflow.prepareInstallments(entry(),plan());await assert.rejects(h.workflow.execute(op));
  const match=await h.workflow.reconcileInstallments(op,entry({versao:5,parcelas_previstas:[{numero:1,vencimento:'2026-12-01',valor:'100.01',forma_pagamento:'pix'}]}));
  assert.equal(match.matched,false);assert.equal(match.requiresNewReview,true);assert.equal(h.workflow.status(op),'rejected');assert.equal(h.calls.length,1);
});
test('wrong entry, amount or payment binding in successful response remains uncertain',async()=>{
  for(const change of [{lancamento_id:uid(999)},{valor:999},{forma:'dinheiro'},{pagamento_estornado_id:uid(9)}]){
    const h=harness((a,p)=>({pagamento:{...response(a,p).pagamento,...change}})),op=h.workflow.preparePayment(entry(),{valor:15,forma:'pix'});
    await assert.rejects(h.workflow.execute(op),e=>e.code==='finance_response_unconfirmed'&&e.uncertain);assert.equal(h.workflow.status(op),'uncertain');
  }
});
test('session invalidation discards in-flight successful financial result and operation data',async()=>{
  let release,started;const waiting=new Promise(r=>started=r),h=harness((a,p)=>new Promise(r=>{release=()=>r(response(a,p));started();}));
  const op=h.workflow.prepareCreate(charge()),pending=h.workflow.execute(op);await waiting;h.invalidate();release();await assert.rejects(pending,e=>e.code==='session_changed'&&e.uncertain);assert.throws(()=>h.workflow.status(op),{code:'operation_expired'});
});
test('missing auth context after a write and server failures remain uncertain even from a minimal requester',async()=>{
  for(const error of [new IntegrationError('unexpected_auth_context','Contexto inválido'),new IntegrationError('http_503','Indisponível',{status:503})]){
    const h=harness(()=>{throw error;}),op=h.workflow.prepareCreate(charge());await assert.rejects(h.workflow.execute(op),e=>e.uncertain===true);assert.equal(h.workflow.status(op),'uncertain');assert.equal(h.calls.length,1);
  }
});
test('account change cannot replay a successful or uncertain operation',async()=>{
  const h=harness(),op=h.workflow.prepareCreate(charge());await h.workflow.execute(op);h.changeIdentity();await assert.rejects(h.workflow.execute(op),{code:'session_changed'});assert.equal(h.calls.length,1);
});
test('cancel uses protected operation ID and preserves ledger instead of delete',async()=>{
  const h=harness(),op=h.workflow.prepareCancel(entry(),'Cadastro duplicado');await h.workflow.execute(op);assert.equal(h.calls[0].action,'cancelar_lancamento');assert.equal(h.calls[0].payload.operation_id,op.id);assert.equal(h.calls[0].payload.motivo,'Cadastro duplicado');
  assert.throws(()=>h.workflow.prepareCancel(entry({valor_pago:1}),'Teste'),{code:'entry_has_payment'});
  assert.throws(()=>h.workflow.prepareCancel(entry({origem:'compra'}),'Teste'),{code:'purchase_cancel_requires_full_workflow'});
});
test('dispose rejects operations and removes session subscription',async()=>{
  const h=harness(),op=h.workflow.prepareCreate(charge());h.workflow.dispose();await assert.rejects(h.workflow.execute(op),{code:'client_closed'});assert.equal(h.calls.length,0);
});
test('UI escapes stored descriptions, labels cash separately and exposes protected actions',()=>{
  const html=renderFinanceWorkflow({entries:[entry({descricao:'<img src=x onerror=alert(1)>',pagamentos:[payment()]})],writesEnabled:true});
  assert.ok(!html.includes('<img'));assert.match(html,/&lt;img/);assert.match(html,/Recebido:/);assert.match(html,/data-fw-action="reverse"/);assert.match(html,/Histórico de pagamentos e estornos/);
  assert.match(renderFinanceWorkflow({entries:[entry()]}),/data-fw-action="payment"[^>]*disabled/);
});
