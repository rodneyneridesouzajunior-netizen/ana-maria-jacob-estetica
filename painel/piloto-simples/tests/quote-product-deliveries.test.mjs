import test from 'node:test';
import assert from 'node:assert/strict';
import {seed} from '../domain.mjs';
import {ensureOperations,saveProduct,saveProcedure,receiveLot,saveQuote,approveQuote,cancelQuote,completeVisit,deliverQuoteProduct,reverseQuoteProductDelivery,quoteProductDeliveryBalance,quoteExecutionCosts,validateQuoteProductDeliveries} from '../operations-domain.mjs';

const today='2026-10-15',now=today+'T15:00:00.000Z';
const op=(operationId,data={})=>({operationId,today,now,data});
function fresh({quantity=2,unitCost=2000,lotCost=3000,mixed=false,approve=true,operationNow=now}={}){
  const operation=(id,data={})=>({...op(id,data),now:operationNow});
  const state=seed();state.bills=[];state.payments=[];state.visits[0].date=today;ensureOperations(state);
  saveProduct(state,operation('product',{id:'p',name:'Produto fictício',unit:'mL',unitCost}));
  saveProcedure(state,operation('procedure',{id:'proc',name:'Procedimento fictício',price:10000,cost:1000,duration:30,returnDays:0}));
  receiveLot(state,operation('entry',{id:'lot',productId:'p',code:'TESTE',expiry:'2027-10-15',quantity:10,unitCost:lotCost}));
  const items=[{id:'product-item',type:'product',productId:'p',quantity,unitPrice:5000,unitCost}];
  if(mixed)items.push({id:'procedure-item',procedureId:'proc',sessions:1,unitPrice:10000,unitCost:1000});
  saveQuote(state,operation('quote',{id:'q',patientId:'demo-marina',title:'Proposta fictícia',validUntil:'2026-11-15',items}));
  if(approve)approveQuote(state,{...operation('approval'),quoteId:'q',expectedVersion:1,note:'Teste fictício'});
  return state;
}
function delivery(state,overrides={}){const lot=state.stockLots.find(l=>l.id===(overrides.lotId||'lot'));return{...op('delivery'),quoteId:'q',itemId:'product-item',lotId:'lot',quantity:1,unit:'mL',expectedQuoteVersion:state.quotes[0].version,expectedLotVersion:lot?.version,date:today,reason:'Entrega fictícia conferida',...overrides};}
function reversal(state,overrides={}){return{...op('reversal'),deliveryId:'delivery',expectedQuoteVersion:state.quotes[0].version,expectedLotVersion:state.stockLots[0].version,date:today,reason:'Baixa fictícia registrada indevidamente',confirmedStockReturn:true,...overrides};}
function unchangedOnFailure(state,fn,pattern){const before=structuredClone(state);assert.throws(fn,pattern);assert.deepEqual(state,before);}

test('entrega parcial baixa apenas o lote e mantém cobrança, pagamentos e prontuário',()=>{
  const s=fresh(),q=structuredClone(s.quotes[0]),visits=structuredClone(s.visits),payments=structuredClone(s.payments);
  const d=deliverQuoteProduct(s,delivery(s));assert.equal(d.quantityUnits,10000);assert.equal(s.stockLots[0].balanceUnits,90000);
  assert.deepEqual(quoteProductDeliveryBalance(s,'q','product-item'),{orderedUnits:20000,deliveredUnits:10000,remainingUnits:10000,ordered:2,delivered:1,remaining:1,unit:'mL'});
  assert.deepEqual(quoteExecutionCosts(s,'q'),{actualCost:3000,remainingCost:2000,cost:5000,costKind:'realizado + estimado'});
  assert.deepEqual(s.quotes[0],q);assert.deepEqual(s.visits,visits);assert.deepEqual(s.payments,payments);assert.equal(s.bills.length,1);assert.equal(s.bills[0].total,10000);assert.equal(s.quoteSessionUses.length,0);assert.equal(validateQuoteProductDeliveries(s),true);
});
test('entrega pode usar dois lotes e custo final reflete seus custos originais',()=>{
  const s=fresh();receiveLot(s,op('entry2',{id:'lot2',productId:'p',code:'TESTE-2',expiry:'2027-10-15',quantity:5,unitCost:4000}));
  deliverQuoteProduct(s,delivery(s));deliverQuoteProduct(s,delivery(s,{operationId:'delivery2',lotId:'lot2'}));
  assert.equal(quoteProductDeliveryBalance(s,'q','product-item').remainingUnits,0);assert.equal(s.bills[0].actualCost,7000);assert.equal(s.bills[0].cost,7000);assert.equal(s.bills[0].costKind,'realizado');assert.equal(validateQuoteProductDeliveries(s),true);
});
test('repetição de entrega é idempotente mesmo após mudança da versão do lote',()=>{
  const s=fresh(),input=delivery(s);const d=deliverQuoteProduct(s,input),before=structuredClone(s);assert.deepEqual(deliverQuoteProduct(s,{...input,quantity:'1,0000'}),d);assert.deepEqual(s,before);
  unchangedOnFailure(s,()=>deliverQuoteProduct(s,{...input,quantity:2}),/outros dados/);
});
test('saldo do item, saldo do lote e versões protegem entregas concorrentes',()=>{
  const s=fresh();unchangedOnFailure(s,()=>deliverQuoteProduct(s,delivery(s,{quantity:3})),/saldo a entregar/);
  unchangedOnFailure(s,()=>deliverQuoteProduct(s,delivery(s,{expectedQuoteVersion:0})),/alterado/);
  unchangedOnFailure(s,()=>deliverQuoteProduct(s,delivery(s,{expectedLotVersion:0})),/alterado/);
  s.stockLots[0].balanceUnits=100;unchangedOnFailure(s,()=>deliverQuoteProduct(s,delivery(s)),/Saldo insuficiente/);
});
test('lote vencido, produto inativo, unidade ou produto errado abortam sem baixa',()=>{
  for(const mutate of [s=>s.stockLots[0].expiry='2026-10-14',s=>s.products[0].active=false,s=>s.stockLots[0].active=false,s=>s.stockLots[0].unit='U',s=>s.stockLots[0].productId='outro']){
    const s=fresh();mutate(s);unchangedOnFailure(s,()=>deliverQuoteProduct(s,delivery(s)),/vencido|inativo|unidade|mesmo produto/);
  }
  const s=fresh();unchangedOnFailure(s,()=>deliverQuoteProduct(s,delivery(s,{unit:'U'})),/unidade/);
});
test('aprovação, item de produto, datas e motivo são obrigatórios',()=>{
  const draft=fresh({approve:false});unchangedOnFailure(draft,()=>deliverQuoteProduct(draft,delivery(draft)),/aprovado/);
  const s=fresh({mixed:true});unchangedOnFailure(s,()=>deliverQuoteProduct(s,delivery(s,{itemId:'procedure-item'})),/Procedimentos/);
  for(const date of ['2026-10-14','2026-10-16','2026-02-31'])unchangedOnFailure(s,()=>deliverQuoteProduct(s,delivery(s,{date})),/data|Data/);
  unchangedOnFailure(s,()=>deliverQuoteProduct(s,delivery(s,{reason:' '})),/motivo/);
});
test('quantidade de quatro casas é exata e precisão excedente é rejeitada',()=>{
  const s=fresh();deliverQuoteProduct(s,delivery(s,{quantity:'0,0001'}));assert.equal(s.stockLots[0].balanceUnits,99999);assert.equal(quoteProductDeliveryBalance(s,'q','product-item').remainingUnits,19999);
  unchangedOnFailure(s,()=>deliverQuoteProduct(s,delivery(s,{operationId:'overprecision',quantity:'0.00001'})),/quatro casas/);
});
test('fracionar entrega no mesmo lote não duplica arredondamento de custo',()=>{
  const s=fresh({quantity:1,unitCost:1,lotCost:1});deliverQuoteProduct(s,delivery(s,{quantity:.5}));deliverQuoteProduct(s,delivery(s,{operationId:'delivery2',quantity:.5}));
  assert.equal(s.bills[0].actualCost,1);assert.equal(s.bills[0].cost,1);assert.equal(s.bills[0].costKind,'realizado');
  reverseQuoteProductDelivery(s,reversal(s));assert.equal(s.bills[0].actualCost,1);assert.equal(s.bills[0].cost,2);assert.equal(quoteProductDeliveryBalance(s,'q','product-item').delivered,.5);assert.equal(validateQuoteProductDeliveries(s),true);
});
test('estorno conserva evento original, devolve ao mesmo lote e não estorna recebimento',()=>{
  const s=fresh();deliverQuoteProduct(s,delivery(s));const original=structuredClone(s.quoteProductDeliveries[0]);s.payments.push({id:'test-payment',billId:s.bills[0].id,amount:100});const payments=structuredClone(s.payments),input=reversal(s),result=reverseQuoteProductDelivery(s,input);
  assert.deepEqual(s.quoteProductDeliveries[0],original);assert.equal(s.stockLots[0].balanceUnits,100000);assert.deepEqual(s.payments,payments);assert.equal(s.bills[0].costKind,'estimado');assert.equal(s.bills[0].cost,4000);assert.equal(s.bills[0].actualCost,0);
  const before=structuredClone(s);assert.deepEqual(reverseQuoteProductDelivery(s,input),result);assert.deepEqual(s,before);unchangedOnFailure(s,()=>reverseQuoteProductDelivery(s,reversal(s,{operationId:'second-reversal'})),/já foi estornada/);assert.equal(validateQuoteProductDeliveries(s),true);
});
test('estorno exige conferência explícita, motivo e versões atuais',()=>{
  const s=fresh();deliverQuoteProduct(s,delivery(s));
  for(const overrides of [{confirmedStockReturn:false},{confirmedStockReturn:'true'},{reason:'erro'},{expectedLotVersion:1},{expectedQuoteVersion:0},{date:'2026-10-14'}])unchangedOnFailure(s,()=>reverseQuoteProductDelivery(s,reversal(s,overrides)),/Confirme|motivo|alterado|data/);
});
test('estorno posterior ao vencimento preserva lote vencido sem liberar nova entrega',()=>{
  const s=fresh();deliverQuoteProduct(s,delivery(s));reverseQuoteProductDelivery(s,reversal(s,{today:'2028-10-15',date:'2028-10-15',now:'2028-10-15T15:00:00.000Z'}));assert.equal(s.stockLots[0].expiry,'2027-10-15');
  unchangedOnFailure(s,()=>deliverQuoteProduct(s,delivery(s,{operationId:'again',today:'2028-10-15',date:'2028-10-15',now:'2028-10-15T15:00:00.000Z'})),/vencido/);assert.equal(validateQuoteProductDeliveries(s),true);
});
test('cancelamento bloqueado por entrega ativa e liberado depois do estorno',()=>{
  const s=fresh();deliverQuoteProduct(s,delivery(s));const input={...op('cancel'),quoteId:'q',expectedVersion:1,reason:'Proposta cancelada no teste',date:today};unchangedOnFailure(s,()=>cancelQuote(s,input),/produtos entregues/);
  reverseQuoteProductDelivery(s,reversal(s));cancelQuote(s,input);assert.equal(s.quotes[0].status,'cancelado');assert.equal(validateQuoteProductDeliveries(s),true);
});
test('sessão concluída após entrega recompõe custos sem duplicar produto ou cobrança',()=>{
  const s=fresh({mixed:true});deliverQuoteProduct(s,delivery(s,{quantity:2}));
  completeVisit(s,{...op('complete'),visitId:'demo-consulta',procedureId:'proc',consumptions:[],quoteId:'q',itemId:'procedure-item',sessions:1});
  assert.equal(s.bills.length,1);assert.equal(s.bills[0].actualCost,7000);assert.equal(s.bills[0].cost,7000);assert.equal(s.bills[0].costKind,'realizado');assert.equal(s.quoteSessionUses.length,1);assert.equal(validateQuoteProductDeliveries(s),true);
});
test('entrega após sessão recompõe custos e estorno preserva custo realizado da sessão',()=>{
  const s=fresh({mixed:true});completeVisit(s,{...op('complete'),visitId:'demo-consulta',procedureId:'proc',consumptions:[],quoteId:'q',itemId:'procedure-item',sessions:1});deliverQuoteProduct(s,delivery(s,{quantity:2}));reverseQuoteProductDelivery(s,reversal(s));
  assert.deepEqual(quoteExecutionCosts(s,'q'),{actualCost:1000,remainingCost:4000,cost:5000,costKind:'realizado + estimado'});assert.equal(validateQuoteProductDeliveries(s),true);
});
test('coleções ausentes em legado não inventam entregas nem mudam custo estimado',()=>{
  const s=fresh();delete s.quoteProductDeliveries;delete s.quoteProductDeliveryReversals;const before=structuredClone(s);assert.equal(validateQuoteProductDeliveries(s),true);assert.deepEqual(quoteExecutionCosts(s,'q'),{actualCost:0,remainingCost:4000,cost:4000,costKind:'estimado'});assert.deepEqual(s,before);
});
test('validador rejeita histórico órfão, unidades adulteradas, custo ou estorno duplicado',()=>{
  const base=fresh();deliverQuoteProduct(base,delivery(base));reverseQuoteProductDelivery(base,reversal(base));
  for(const mutate of [s=>s.quoteProductDeliveries[0].unit='U',s=>s.quoteProductDeliveries[0].itemId='ausente',s=>s.quoteProductDeliveries[0].quantity=2,s=>s.stockMovements.pop(),s=>s.bills[0].cost++,s=>s.quoteProductDeliveryReversals.push({...s.quoteProductDeliveryReversals[0],id:'other',operationId:'other'}),s=>s.quoteProductDeliveries=[]]){
    const s=structuredClone(base);mutate(s);assert.throws(()=>validateQuoteProductDeliveries(s));
  }
});
test('entrega às 22h30 de São Paulo aceita aprovação e lote do mesmo dia após a virada UTC',()=>{
  const stamp='2026-10-16T01:00:00.000Z',s=fresh({operationNow:stamp});
  const record=deliverQuoteProduct(s,delivery(s,{now:'2026-10-16T01:30:00.000Z',today:'2026-10-15',date:'2026-10-15'}));
  assert.equal(record.date,'2026-10-15');assert.equal(record.createdAt,'2026-10-16T01:30:00.000Z');assert.equal(s.quotes[0].approvedAt,stamp);assert.equal(s.stockLots[0].createdAt,stamp);assert.equal(s.stockLots[0].balanceUnits,90000);assert.equal(validateQuoteProductDeliveries(s),true);
  const invalid=structuredClone(s);invalid.quoteProductDeliveries[0].date='2026-10-14';assert.throws(()=>validateQuoteProductDeliveries(invalid),/Data histórica/);
});
test('dia civil de São Paulo continua bloqueando entrega anterior à aprovação ou entrada',()=>{
  const future='2026-10-16T03:00:00.000Z';
  const approvedTomorrow=fresh({operationNow:future});unchangedOnFailure(approvedTomorrow,()=>deliverQuoteProduct(approvedTomorrow,delivery(approvedTomorrow,{now:'2026-10-16T03:30:00.000Z',today:'2026-10-16',date:'2026-10-15'})),/entre a aprovação/);
  const lotTomorrow=fresh();lotTomorrow.stockLots[0].createdAt=future;unchangedOnFailure(lotTomorrow,()=>deliverQuoteProduct(lotTomorrow,delivery(lotTomorrow,{now:'2026-10-16T03:30:00.000Z',today:'2026-10-16',date:'2026-10-15'})),/anterior à entrada/);
});
