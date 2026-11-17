// Contas de apoio da interface (orçamento, financeiro, catálogo e conclusão da consulta).
// Módulo puro: nada aqui muda regra de domínio nem o formato gravado; só preenche ou explica campos.
export const moneyText=cents=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(cents/100);
export const decimalText=cents=>(cents/100).toFixed(2).replace('.',',');
/** "1.234,56", "1234,5", "R$ 80" → centavos. Devolve null quando vazio ou inválido (nunca lança). */
export function parseMoney(value){
  let text=String(value??'').replace(/R\$|\s/g,'');if(!text)return null;
  if(/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(text))text=text.replace(/\./g,'');
  text=text.replace(',','.');if(!/^\d+(\.\d{1,2})?$/.test(text))return null;
  const [whole,fraction='']=text.split('.'),result=Number(whole)*100+Number(fraction.padEnd(2,'0'));
  return Number.isSafeInteger(result)&&result<=100000000?result:null;
}
/** "12,5" → 1250 (centésimos de %). null quando vazio, inválido ou acima de 100%. */
export function parsePercentBps(value){
  const text=String(value??'').replace(/%|\s/g,'').replace(',','.');if(!/^\d+(\.\d{1,2})?$/.test(text))return null;
  const bps=Math.round(Number(text)*100);return bps>=0&&bps<=10000?bps:null;
}
export const bpsText=bps=>String(Number((bps/100).toFixed(2))).replace('.',',');
/** Quantidade com até 4 casas ("1,5") → décimos de milésimo (15000). null quando inválida ou zero. */
export function parseUnits(value){
  const text=String(value??'').trim().replace(',','.');if(!/^\d+(\.\d{1,4})?$/.test(text))return null;
  const [whole,fraction='']=text.split('.'),units=Number(whole)*10000+Number(fraction.padEnd(4,'0'));
  return Number.isSafeInteger(units)&&units>0?units:null;
}
export const unitsText=units=>String(units/10000).replace('.',',');
const applied=(subtotal,bps)=>Math.round(subtotal*bps/10000);
/** Percentual (em centésimos de %) cujo desconto fica mais perto do valor em R$ pedido. */
export function discountFromAmount(subtotal,amount){
  if(!Number.isSafeInteger(subtotal)||subtotal<=0||!Number.isSafeInteger(amount)||amount<0||amount>subtotal)return null;
  const guess=Math.round(amount*10000/subtotal);let best=null;
  for(const bps of [guess,guess-1,guess+1]){if(bps<0||bps>10000)continue;const discount=applied(subtotal,bps),gap=Math.abs(discount-amount);if(!best||gap<best.gap)best={bps,discount,gap};}
  return{bps:best.bps,discount:best.discount,total:subtotal-best.discount,exact:best.gap===0};
}
export const discountFromTotal=(subtotal,total)=>Number.isSafeInteger(total)?discountFromAmount(subtotal,subtotal-total):null;
/** Preço por unidade/sessão que leva ao total pedido. units em décimos de milésimo (1 sessão = 10000). */
export function unitPriceForTotal(total,units){
  if(!Number.isSafeInteger(total)||total<0||!Number.isSafeInteger(units)||units<=0)return null;
  const unitPrice=Math.round(total*10000/units),achieved=Math.round(unitPrice*units/10000);
  return unitPrice>100000000?null:{unitPrice,total:achieved,exact:achieved===total};
}
/** Valor de uma linha: preço por unidade × quantidade (mesmo arredondamento do domínio). */
export const lineValue=(unitPrice,units)=>Math.round(unitPrice*units/10000);
/** Diferença entre o valor de tabela e o ofertado. */
export function compareToTable(table,offered){
  if(!Number.isSafeInteger(table)||table<=0||!Number.isSafeInteger(offered)||offered<0)return null;
  const diff=table-offered;return{diff:Math.abs(diff),bps:Math.round(Math.abs(diff)*10000/table),direction:diff>0?'abaixo':diff<0?'acima':'igual'};
}
/** Divide um valor em parcelas; os centavos que sobram vão para as primeiras (mesma regra do financeiro). */
export function splitInstallments(amount,count){
  if(!Number.isSafeInteger(amount)||amount<=0||!Number.isSafeInteger(count)||count<1||count>360)return null;
  const base=Math.floor(amount/count),extra=amount-base*count;return Array.from({length:count},(_,i)=>base+(i<extra?1:0));
}
/** Sobra e margem: result em centavos, marginBps em centésimos de % (null sem preço). */
export function marginOf(price,cost){
  if(!Number.isSafeInteger(price)||price<0||!Number.isSafeInteger(cost)||cost<0)return null;
  return{result:price-cost,marginBps:price>0?Math.round((price-cost)*10000/price):null,loss:cost>price};
}
