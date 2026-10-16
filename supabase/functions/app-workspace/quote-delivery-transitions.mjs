import {deliverQuoteProduct,reverseQuoteProductDelivery} from '../_shared/app-workspace-domain/operations-domain.mjs';

const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const equal=(a,b)=>stable(a)===stable(b);
const types=new Set(['quote-product-delivery','quote-product-delivery-reversal']);
const movementTypes=new Set(['entrega_produto','estorno_entrega_produto']);
const added=(old,next,key)=>(next[key]||[]).filter(x=>!(old[key]||[]).some(y=>y.id===x.id));

// Replay the same domain operation from the previous authoritative state. A
// matching stock balance alone is insufficient proof of a product delivery.
export function assertQuoteDeliveryTransitions(old,next,{today,now}){
 const operations=added(old,next,'operationHistory').filter(x=>types.has(x.type));
 const deliveries=added(old,next,'quoteProductDeliveries');
 const reversals=added(old,next,'quoteProductDeliveryReversals');
 const movements=added(old,next,'stockMovements').filter(x=>movementTypes.has(x.type));
 if(!operations.length&&!deliveries.length&&!reversals.length&&!movements.length)return;
 const replay=structuredClone(old),beforeMovements=new Set((old.stockMovements||[]).map(x=>x.id));
 for(const event of operations){
  if(typeof event.fingerprint!=='string'||!Number.isFinite(Date.parse(event.createdAt))||Date.parse(event.createdAt)>Date.parse(now)+300000)throw Error('Evento de entrega sem conteúdo ou data válida.');
  let payload;try{payload=JSON.parse(event.fingerprint);}catch{throw Error('Conteúdo da operação de entrega inválido.');}
  if(!payload||typeof payload!=='object'||Array.isArray(payload))throw Error('Conteúdo da operação de entrega inválido.');
  const input={...payload,operationId:event.id,now:event.createdAt,today};
  if(event.type==='quote-product-delivery')deliverQuoteProduct(replay,input);
  else reverseQuoteProductDelivery(replay,input);
  const computed=replay.operationHistory.find(x=>x.id===event.id);
  if(!equal(event,computed))throw Error('A operação de entrega difere do resultado conferido no servidor.');
 }
 for(const key of ['quoteProductDeliveries','quoteProductDeliveryReversals'])if(!equal(replay[key]||[],next[key]||[]))throw Error('A entrega e seu estorno precisam corresponder à operação original.');
 const expectedMovements=(replay.stockMovements||[]).filter(x=>!beforeMovements.has(x.id));
 if(!equal(expectedMovements,movements))throw Error('A baixa ou devolução precisa corresponder exatamente aos lotes da entrega.');
 for(const lotId of new Set(expectedMovements.map(x=>x.lotId))){
  if(!equal(replay.stockLots.find(x=>x.id===lotId),next.stockLots.find(x=>x.id===lotId)))throw Error('O saldo e a versão do lote diferem da entrega conferida.');
 }
 const quoteIds=new Set([...deliveries,...reversals].map(x=>x.quoteId));
 for(const quoteId of quoteIds){
  const expected=replay.bills.find(x=>x.quoteId===quoteId),actual=next.bills.find(x=>x.quoteId===quoteId);
  if(!expected||!actual||['cost','actualCost','costKind'].some(key=>expected[key]!==actual[key]))throw Error('O custo da proposta difere dos produtos entregues.');
 }
}
