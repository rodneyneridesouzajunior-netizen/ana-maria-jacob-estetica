import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,validateTransition} from './rules.mjs';
import {assertQuoteDeliveryTransitions} from './quote-delivery-transitions.mjs';
import {saveProduct,receiveLot,saveQuote,approveQuote,deliverQuoteProduct,reverseQuoteProductDelivery} from '../_shared/app-workspace-domain/operations-domain.mjs';
const today='2026-10-15',now=today+'T18:00:00.000Z',settings={today,now};
const op=(operationId,data={})=>({operationId,data,...settings});
function fixture(){
 const s=emptyState();s.patients.push({id:'delivery-patient',name:'Paciente sintética da entrega'});
 saveProduct(s,op('synthetic-product',{id:'product',name:'Produto sintético',unit:'mL',unitCost:2000}));
 receiveLot(s,op('synthetic-lot',{id:'lot',productId:'product',code:'TESTE-ISOLADO',expiry:'2027-10-15',quantity:10,unitCost:3000}));
 saveQuote(s,op('synthetic-quote',{id:'quote',patientId:'delivery-patient',title:'Proposta sintética',validUntil:'2026-11-15',items:[{id:'item',type:'product',productId:'product',quantity:2,unitPrice:5000,unitCost:2000}]}));
 approveQuote(s,{...op('synthetic-approval'),quoteId:'quote',expectedVersion:1,note:'Aprovação em fixture isolada'});return s;
}
function input(s,id='synthetic-delivery'){return{...op(id),quoteId:'quote',itemId:'item',lotId:'lot',quantity:1,unit:'mL',expectedQuoteVersion:s.quotes[0].version,expectedLotVersion:s.stockLots[0].version,date:today,reason:'Entrega sintética para teste de replay'};}
function reverse(s){return{...op('synthetic-reversal'),deliveryId:'synthetic-delivery',expectedQuoteVersion:s.quotes[0].version,expectedLotVersion:s.stockLots[0].version,date:today,reason:'Correção sintética conferida em teste',confirmedStockReturn:true};}
const validate=(old,next)=>{assertQuoteDeliveryTransitions(old,next,settings);validateTransition(old,next,{now});};
test('server replay accepts a domain-generated partial delivery with exact stock and costs without mutating either state',()=>{
 const old=fixture(),next=structuredClone(old);deliverQuoteProduct(next,input(next));const before=structuredClone(old),candidate=structuredClone(next);assert.doesNotThrow(()=>validate(old,next));assert.deepEqual(old,before);assert.deepEqual(next,candidate);assert.equal(next.stockLots[0].balanceUnits,90000);assert.equal(next.bills[0].actualCost,3000);assert.equal(next.bills[0].cost,5000);assert.equal(next.bills[0].total,10000);assert.equal(next.payments.length,0);
});
test('idempotent delivery retry and server validation do not repeat inventory deduction or commercial entries',()=>{
 const old=fixture(),next=structuredClone(old),request=input(next);deliverQuoteProduct(next,request);const saved=structuredClone(next);deliverQuoteProduct(next,{...request,quantity:'1,0000'});assert.deepEqual(next,saved);assert.doesNotThrow(()=>validate(old,next));assert.doesNotThrow(()=>validate(next,structuredClone(next)));assert.equal(next.quoteProductDeliveries.length,1);assert.equal(next.stockMovements.filter(m=>m.type==='entrega_produto').length,1);assert.equal(next.bills.length,1);
});
test('server replay accepts explicit reversal preserving the delivery, same lot and existing payments',()=>{
 const old=fixture();deliverQuoteProduct(old,input(old));const next=structuredClone(old);reverseQuoteProductDelivery(next,reverse(next));assert.doesNotThrow(()=>validate(old,next));assert.deepEqual(next.quoteProductDeliveries,old.quoteProductDeliveries);assert.equal(next.stockLots[0].balanceUnits,100000);assert.equal(next.bills[0].actualCost,0);assert.equal(next.bills[0].costKind,'estimado');assert.deepEqual(next.payments,old.payments);
});
test('a plausible delivery ledger without its corresponding server-replayable operation is rejected',()=>{
 const old=fixture(),next=structuredClone(old);deliverQuoteProduct(next,input(next));next.operationHistory=structuredClone(old.operationHistory);assert.throws(()=>assertQuoteDeliveryTransitions(old,next,settings),/operação original|corresponder/);assert.throws(()=>validateTransition(old,next,{now}),{code:'product_delivery_invalid'});
});
test('forged replay payload, timestamp or resulting snapshot cannot pass as a legitimate delivery',()=>{
 const old=fixture(),saved=structuredClone(old);deliverQuoteProduct(saved,input(saved));
 for(const mutate of [s=>{const event=s.operationHistory.at(-1),payload=JSON.parse(event.fingerprint);payload.quantity=.5;event.fingerprint=JSON.stringify(payload);},s=>{s.operationHistory.at(-1).createdAt='2026-10-16T18:00:00.000Z';},s=>{s.quoteProductDeliveries[0].productName='Nome adulterado';}]){const next=structuredClone(saved);mutate(next);assert.throws(()=>assertQuoteDeliveryTransitions(old,next,settings));assert.throws(()=>validateTransition(old,next,{now}));}
});
test('stock, stock movement and commercial cost must all match the authoritative replay',()=>{
 const old=fixture(),saved=structuredClone(old);deliverQuoteProduct(saved,input(saved));
 for(const mutate of [s=>s.stockLots[0].balanceUnits++,s=>s.stockLots[0].version++,s=>s.stockMovements.at(-1).deltaUnits++,s=>s.bills[0].actualCost++,s=>s.bills[0].costKind='realizado']){const next=structuredClone(saved);mutate(next);assert.throws(()=>assertQuoteDeliveryTransitions(old,next,settings));assert.throws(()=>validateTransition(old,next,{now}));}
});
test('a reversal cannot omit the explicit physical-return confirmation even if its ledger restores inventory',()=>{
 const old=fixture();deliverQuoteProduct(old,input(old));const next=structuredClone(old);reverseQuoteProductDelivery(next,reverse(next));const event=next.operationHistory.at(-1),payload=JSON.parse(event.fingerprint);payload.confirmedStockReturn=false;event.fingerprint=JSON.stringify(payload);assert.throws(()=>assertQuoteDeliveryTransitions(old,next,settings),/Confirme/);assert.throws(()=>validateTransition(old,next,{now}),{code:'product_delivery_invalid'});
});
test('successive delivery commits replay the current lot version; an unsupported two-version batch is rejected',()=>{
 const old=fixture(),first=structuredClone(old);deliverQuoteProduct(first,input(first));assert.doesNotThrow(()=>validate(old,first));
 const next=structuredClone(first);deliverQuoteProduct(next,input(next,'synthetic-delivery-two'));assert.doesNotThrow(()=>validate(first,next));assert.equal(next.stockLots[0].balanceUnits,80000);assert.equal(next.bills[0].actualCost,6000);assert.equal(next.bills[0].costKind,'realizado');
 // Replay is capable of checking event order, but the generic CAS transition
 // deliberately permits only one entity-version increment per commit.
 assert.doesNotThrow(()=>assertQuoteDeliveryTransitions(old,next,settings));assert.throws(()=>validateTransition(old,next,{now}),{code:'entity_version_conflict'});
 const reordered=structuredClone(next);reordered.operationHistory.splice(-2,2,...reordered.operationHistory.slice(-2).reverse());assert.throws(()=>assertQuoteDeliveryTransitions(old,reordered,settings),/alterado/);
});
