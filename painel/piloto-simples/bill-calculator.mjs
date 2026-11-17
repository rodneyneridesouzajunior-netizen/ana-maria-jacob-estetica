// Apoio de cálculo da janela "Nova cobrança": valor cheio, desconto em % ou em R$ e sobra.
// Só preenche os campos já existentes (total e cost); nada novo é gravado.
import {parseMoney,parsePercentBps,bpsText,decimalText,moneyText,marginOf} from './calc-helpers.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const field=(label,name,extra='')=>`<div class="field"><label for="d-${name}">${label}</label><input id="d-${name}" name="${name}" type="text" inputmode="decimal" autocomplete="off" ${extra}></div>`;

/** Campos de apoio colocados antes de "Valor cobrado". procedures: catálogo ativo (preço e custo em centavos). */
export function billCalculatorFields(procedures=[]){
  const active=procedures.filter(p=>p.active!==false);
  return `<div data-bill-calc>${active.length?`<div class="field"><label for="d-calcProcedure">Procedimento do catálogo (opcional)</label><select id="d-calcProcedure" name="calcProcedure"><option value="">Digitar o valor manualmente</option>${active.map(p=>`<option value="${esc(p.id)}" data-name="${esc(p.name)}" data-price="${p.price}" data-cost="${p.cost}">${esc(p.name)} · ${moneyText(p.price)}</option>`).join('')}</select></div>`:''}<div class="field-grid">${field('Valor cheio (R$)','calcFull')}${field('Desconto (%)','calcPercent')}${field('ou desconto em R$','calcDiscount')}</div><p class="small-label">Informe o valor cheio e o desconto em % ou em R$: o valor cobrado é calculado sozinho. Se preferir, digite direto o valor cobrado.</p></div>`;
}
export const BILL_PREVIEW='<output class="calc-preview" data-bill-preview aria-live="polite"></output>';

/** Liga os campos de apoio aos campos reais do formulário (total, cost, description). */
export function mountBillCalculator(form){
  const root=form.querySelector('[data-bill-calc]');if(!root)return;
  form.__billCalculator?.abort();const controller=new AbortController(),signal=controller.signal;form.__billCalculator=controller;
  const get=name=>form.elements.namedItem(name),set=(name,value,source)=>{const el=get(name);if(el&&el!==source)el.value=value;};
  const preview=()=>{
    const out=form.querySelector('[data-bill-preview]');if(!out)return;const full=parseMoney(get('calcFull').value),total=parseMoney(get('total').value),cost=parseMoney(get('cost').value);
    if(total===null){out.textContent='';return;}
    const parts=[];if(full!==null&&full>0&&full!==total)parts.push(full>total?`Valor cheio ${moneyText(full)} − desconto ${moneyText(full-total)} (${bpsText(Math.round((full-total)*10000/full))}%)`:`${moneyText(total-full)} acima do valor cheio`);
    parts.push(`<strong>Valor cobrado ${moneyText(total)}</strong>`);const margin=cost===null?null:marginOf(total,cost);
    if(margin)parts.push(`sobra ${moneyText(margin.result)}${margin.marginBps===null?'':` (${bpsText(margin.marginBps)}%)`}`);
    out.innerHTML=parts.join(' · ')+(margin?.loss?'<span class="calc-warning">O custo está maior que o valor cobrado.</span>':'');
  };
  const recalc=source=>{
    const full=parseMoney(get('calcFull').value);
    if(source===get('total')){const total=parseMoney(source.value);if(full&&total!==null&&total<=full){set('calcDiscount',decimalText(full-total));set('calcPercent',bpsText(Math.round((full-total)*10000/full)));}}
    else if(full&&source===get('calcDiscount')){const amount=parseMoney(source.value);if(amount!==null&&amount<=full){set('calcPercent',bpsText(Math.round(amount*10000/full)));set('total',decimalText(full-amount));}}
    else if(full&&(source===get('calcFull')||source===get('calcPercent'))){const bps=parsePercentBps(get('calcPercent').value)??0,amount=Math.round(full*bps/10000);set('calcDiscount',decimalText(amount));set('total',decimalText(full-amount));}
    preview();
  };
  form.addEventListener('input',event=>{if(!form.contains(root))return;if(event.target===get('description'))delete event.target.dataset.auto;recalc(event.target);},{signal});
  form.addEventListener('change',event=>{
    if(!form.contains(root))return;const select=get('calcProcedure');
    if(event.target===select&&select.value){const option=select.selectedOptions[0],price=Number(option.dataset.price),cost=Number(option.dataset.cost);set('calcFull',decimalText(price));if(Number.isSafeInteger(cost))set('cost',decimalText(cost));const description=get('description');if(description&&(!description.value.trim()||description.dataset.auto==='true')){description.value=option.dataset.name||'';description.dataset.auto='true';}}
    recalc(event.target===select?get('calcFull'):event.target);
  },{signal});
  preview();
}
