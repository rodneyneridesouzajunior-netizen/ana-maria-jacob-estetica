// Contas automáticas da interface: funções puras e os formulários reais em jsdom.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {seed} from '../domain.mjs';
import {saveProcedure,saveProduct,receiveLot,quoteTotals,validateQuoteItem} from '../operations-domain.mjs';
import {createInstallments} from '../finance-domain.mjs';
import {parseMoney,parsePercentBps,parseUnits,unitsText,bpsText,decimalText,discountFromAmount,discountFromTotal,unitPriceForTotal,compareToTable,splitInstallments,marginOf,lineValue} from '../calc-helpers.mjs';
import {mountOperations,extractQuoteItems} from '../operations-ui.mjs';
import {installmentPreview,receiptPreview} from '../finance-ui.mjs';
import {billCalculatorFields,mountBillCalculator,BILL_PREVIEW} from '../bill-calculator.mjs';
const require=createRequire(new URL('../../../../../skinpro-analise/test-tools/package.json',import.meta.url));
const {JSDOM}=require('jsdom');
const today='2026-11-16',now=today+'T15:00:00Z',op=(operationId,data={})=>({operationId,data,today,now});

test('valores digitados: milhar, vírgula, percentuais e quantidades',()=>{
  assert.equal(parseMoney('1.234,56'),123456);assert.equal(parseMoney('1234,5'),123450);assert.equal(parseMoney('R$ 80'),8000);assert.equal(parseMoney('1.500'),150000);assert.equal(parseMoney('1.50'),150);
  for(const bad of ['','abc','1,234','-5','1.2.3',null,undefined])assert.equal(parseMoney(bad),null,String(bad));
  assert.equal(parsePercentBps('12,5'),1250);assert.equal(parsePercentBps('100%'),10000);assert.equal(parsePercentBps('100,01'),null);assert.equal(parsePercentBps('x'),null);
  assert.equal(parseUnits('2,5'),25000);assert.equal(parseUnits('0'),null);assert.equal(unitsText(25000),'2,5');assert.equal(unitsText(3000000),'300');
  assert.equal(bpsText(1250),'12,5');assert.equal(bpsText(2000),'20');assert.equal(bpsText(3333),'33,33');assert.equal(decimalText(123456),'1234,56');
});

test('desconto em R$ ou total desejado vira o percentual que o orçamento realmente aplica',()=>{
  assert.deepEqual(discountFromAmount(150000,30000),{bps:2000,discount:30000,total:120000,exact:true});
  assert.deepEqual(discountFromTotal(150000,120000),{bps:2000,discount:30000,total:120000,exact:true});
  const odd=discountFromTotal(100000,66667);assert.equal(odd.bps,3333);assert.equal(odd.total,66670);assert.equal(odd.exact,false);
  assert.equal(discountFromAmount(1000,1001),null);assert.equal(discountFromAmount(0,0),null);assert.equal(discountFromTotal(1000,2000),null);
  // O percentual escolhido reproduz exatamente a conta do domínio.
  for(const [subtotal,amount] of [[3003,376],[748,37],[250000,12345],[99999,1],[1,1]]){const found=discountFromAmount(subtotal,amount),line=validateQuoteItem({type:'procedure',sessions:1,unitPrice:subtotal,unitCost:0,discountBps:found.bps});assert.equal(line.discount,found.discount);assert.equal(line.total,found.total);assert.ok(Math.abs(found.discount-amount)<=Math.ceil(subtotal/20000)+1);}
});

test('preço por unidade a partir do total, comparação com a tabela, parcelas e margem',()=>{
  assert.deepEqual(unitPriceForTotal(120000,30000),{unitPrice:40000,total:120000,exact:true});
  const uneven=unitPriceForTotal(100000,30000);assert.equal(uneven.unitPrice,33333);assert.equal(uneven.total,99999);assert.equal(uneven.exact,false);
  assert.equal(unitPriceForTotal(1000,0),null);assert.equal(lineValue(299,25000),748);
  assert.deepEqual(compareToTable(50000,40000),{diff:10000,bps:2000,direction:'abaixo'});assert.equal(compareToTable(50000,60000).direction,'acima');assert.equal(compareToTable(50000,50000).direction,'igual');assert.equal(compareToTable(0,100),null);
  assert.deepEqual(splitInstallments(10001,3),[3334,3334,3333]);assert.equal(splitInstallments(100,0),null);
  assert.deepEqual(marginOf(120000,35000),{result:85000,marginBps:7083,loss:false});assert.equal(marginOf(100,200).loss,true);assert.equal(marginOf(null,1),null);assert.equal(marginOf(0,0).marginBps,null);
});

function page(t){
  const dom=new JSDOM('<!doctype html><body><main id="host"></main></body>',{url:'https://anamariajacob.com.br/app/'}),w=dom.window;
  const previous={document:globalThis.document,FormData:globalThis.FormData,confirm:globalThis.confirm,AbortController:globalThis.AbortController};
  Object.assign(globalThis,{document:w.document,FormData:w.FormData,confirm:()=>true,AbortController:w.AbortController});
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  t.after(()=>{for(const [k,v] of Object.entries(previous)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}w.close();});
  const state=seed();state.bills=[];state.payments=[];
  saveProcedure(state,op('procedure',{id:'proc',name:'Toxina fictícia',price:50000,cost:12000,duration:30,returnDays:0}));
  saveProduct(state,op('product',{id:'prod',name:'Produto fictício',unit:'U',unitCost:1150,brand:'Marca',packageQuantity:'100'}));
  const host=w.document.getElementById('host'),saved=[];
  const cleanup=mountOperations(host,{getState:()=>state,mutate:async fn=>{saved.push(fn);fn(state);return state;},notify:()=>{},render:async()=>{}});t.after(cleanup);
  const click=async(action,data={})=>{const b=w.document.createElement('button');b.dataset.op=action;for(const [k,v] of Object.entries(data))b.dataset[k]=v;(host.querySelector('dialog form')||host).append(b);b.dispatchEvent(new w.Event('click',{bubbles:true,cancelable:true}));await new Promise(r=>setImmediate(r));b.remove();};
  const type=(el,value,event='input')=>{el.value=value;el.dispatchEvent(new w.Event(event,{bubbles:true}));};
  return{w,host,state,saved,click,type,get form(){return host.querySelector('dialog form');}};
}

test('orçamento: desconto em R$, total desejado, preço fora da tabela e desconto geral são calculados sozinhos',async t=>{
  const h=page(t);await h.click('quote-new');const form=h.form;await h.click('quote-item-add',{id:'proc',type:'procedure'});
  const row=form.querySelector('[data-op-row]'),field=name=>row.querySelector(`[name=${name}]`),hint=row.querySelector('[data-quote-table-hint]');
  assert.equal(row.dataset.tablePrice,'50000');assert.equal(field('itemTotal').value,'500,00');assert.equal(field('itemDiscountValue').value,'0,00');assert.match(hint.textContent,/Valor de tabela: R\$\s500,00 por sessão/);
  h.type(field('sessions'),'3');assert.equal(field('itemTotal').value,'1500,00');
  // Desconto em R$ → percentual.
  h.type(field('itemDiscountValue'),'300');assert.equal(field('itemDiscount').value,'20');assert.equal(field('itemTotal').value,'1200,00');assert.equal(field('itemDiscountValue').value,'300','campo em edição não é sobrescrito');
  assert.match(row.querySelector('[data-quote-line-total]').textContent,/Total do item: R\$\s1\.200,00$/);assert.match(hint.textContent,/economiza R\$\s300,00/);
  // Total desejado → percentual.
  h.type(field('itemTotal'),'1.050,00');assert.equal(field('itemDiscount').value,'30');assert.equal(field('itemDiscountValue').value,'450,00');
  // Total acima do preço × sessões → sobe o preço e zera o desconto.
  h.type(field('itemTotal'),'1800');assert.equal(field('unitPrice').value,'600,00');assert.equal(field('itemDiscount').value,'0');assert.match(hint.textContent,/R\$\s100,00 acima/);
  // Preço ofertado menor que a tabela: mostra a diferença e converte em desconto.
  h.type(field('unitPrice'),'400,00');assert.match(hint.textContent,/R\$\s100,00 abaixo.*20%.*economia de R\$\s300,00/);assert.ok(hint.querySelector('[data-op=quote-row-table-discount]'));
  hint.querySelector('[data-op=quote-row-table-discount]').dispatchEvent(new h.w.Event('click',{bubbles:true,cancelable:true}));await new Promise(r=>setImmediate(r));assert.equal(field('unitPrice').value,'500,00');assert.equal(field('itemDiscount').value,'20');assert.equal(field('itemTotal').value,'1200,00');
  // Desconto geral em R$ e total final.
  h.type(form.elements.discountValue,'120');assert.equal(form.elements.discount.value,'10');assert.equal(form.elements.finalTotal.value,'1080,00');
  h.type(form.elements.finalTotal,'1000');assert.equal(form.elements.discount.value,'16,67');assert.match(form.querySelector('[data-op-quote-total]').textContent,/valor mais próximo possível de R\$\s1\.000,00 é R\$\s999,96/);
  form.elements.finalTotal.dispatchEvent(new h.w.Event('change',{bubbles:true}));assert.equal(form.elements.finalTotal.value,'999,96','ao sair do campo, mostra o valor realmente aplicado');
  assert.match(form.querySelector('[data-op-quote-total]').textContent,/Pelo valor de tabela seriam R\$\s1\.500,00: a paciente economiza R\$\s500,04/);
  h.type(form.elements.finalTotal,'5000');assert.match(form.querySelector('[data-op-quote-total]').textContent,/não pode ser maior que a soma dos itens/);
  h.type(form.elements.discountValue,'120');
  // O que é gravado continua sendo só preço, sessões e percentuais.
  const items=extractQuoteItems(form);assert.deepEqual(items.map(i=>[i.unitPrice,i.sessions,i.discountBps]),[[50000,3,2000]]);assert.equal(quoteTotals(items,1000).total,108000);
  form.elements.patientId.value=h.state.patients[0].id;form.dispatchEvent(new h.w.Event('submit',{bubbles:true,cancelable:true}));await new Promise(r=>setImmediate(r));
  const quote=h.state.quotes.at(-1);assert.equal(quote.total,108000);assert.equal(quote.items[0].discountBps,2000);assert.equal(quote.discountBps,1000);
  for(const key of ['itemDiscountValue','itemTotal','discountValue','finalTotal'])assert.equal(Object.hasOwn(quote,key),false);
});

test('orçamento: produto sem preço recebe o preço por unidade a partir do total do item',async t=>{
  const h=page(t);await h.click('quote-new');await h.click('quote-item-add',{id:'prod',type:'product'});
  const row=h.form.querySelector('[data-op-row]'),field=name=>row.querySelector(`[name=${name}]`);
  assert.equal(field('unitPrice').value,'');assert.equal(row.querySelector('[data-quote-table-hint]').hidden,true);
  h.type(field('quantity'),'3');h.type(field('itemTotal'),'90');assert.equal(field('unitPrice').value,'30,00');assert.equal(field('itemDiscount').value,'0');
  assert.match(row.querySelector('[data-quote-line-total]').textContent,/R\$\s90,00/);
});

test('catálogo: lote, produto e procedimento calculam quantidade, custo por unidade, total e sobra',async t=>{
  const h=page(t);
  await h.click('lot-new');let form=h.form;form.elements.productId.value='prod';form.elements.productId.dispatchEvent(new h.w.Event('change',{bubbles:true}));
  assert.equal(form.elements.unitCost.value,'11,50');assert.match(form.querySelector('[data-lot-preview]').textContent,/Cada embalagem de Produto fictício tem 100 U/);
  h.type(form.elements.lotPackages,'3');assert.equal(form.elements.quantity.value,'300');assert.match(form.querySelector('[data-lot-preview]').textContent,/Entram 300 U · R\$\s11,50 por U · total do lote R\$\s3\.450,00/);
  h.type(form.elements.lotPaid,'3.600,00');assert.equal(form.elements.unitCost.value,'12,00');assert.match(form.querySelector('[data-lot-preview]').textContent,/total do lote R\$\s3\.600,00/);
  h.type(form.elements.lotPaid,'1000');assert.equal(form.elements.unitCost.value,'3,33');assert.match(form.querySelector('[data-lot-preview]').textContent,/Diferença de R\$\s1,00 para o valor pago/);
  form.elements.code.value='L-1';form.elements.expiry.value='2027-12-31';form.dispatchEvent(new h.w.Event('submit',{bubbles:true,cancelable:true}));await new Promise(r=>setImmediate(r));
  const lot=h.state.stockLots.at(-1);assert.equal(lot.balanceUnits,3000000);assert.equal(lot.unitCost,333);assert.equal(Object.hasOwn(lot,'lotPaid'),false);
  await h.click('product-new');form=h.form;assert.equal(form.querySelector('details.catalog-calculator').open,true);
  h.type(form.elements.packageQuantity,'2');h.type(form.elements.packageCost,'900');assert.equal(form.elements.unitCost.value,'450,00');assert.match(form.querySelector('[data-product-preview]').textContent,/R\$\s900,00 ÷ 2 mL = R\$\s450,00 por mL/);
  h.type(form.elements.unitCost,'500,00');h.type(form.elements.packageCost,'1000');assert.equal(form.elements.unitCost.value,'500,00','custo digitado à mão não é trocado sozinho');
  h.type(form.elements.packageCost,'');assert.match(form.querySelector('[data-product-preview]').textContent,/Equivale a R\$\s1\.000,00 por embalagem de 2 mL/);
  await h.click('modal-close');await h.click('procedure-new');form=h.form;h.type(form.elements.price,'1.200,00');h.type(form.elements.cost,'350');
  assert.match(form.querySelector('[data-procedure-preview]').textContent,/Sobra por sessão: R\$\s850,00 \(70,83%\)/);h.type(form.elements.cost,'1300');assert.match(form.querySelector('[data-procedure-preview]').textContent,/custo está maior que o preço/);
});

test('conclusão da consulta soma as marcações por lote, avisa saldo insuficiente e mostra a cobrança',async t=>{
  const h=page(t);
  receiveLot(h.state,op('lot',{id:'lot',productId:'prod',code:'L9',expiry:'2027-12-31',quantity:'30',unitCost:1150,reason:'Entrada de teste'}));
  const visit=h.state.visits[0];visit.date=today;const photo=visit.photos?.[0]?.id||'foto';visit.maps={[photo]:{points:[{id:'a',x:.2,y:.2,region:'Glabela',quantity:12,unit:'U'},{id:'b',x:.4,y:.4,region:'Frontal',quantity:8,unit:'U'},{id:'c',x:.5,y:.5,region:'Periocular',quantity:20,unit:'U'}]}};
  await h.click('visit-review',{id:visit.id});const form=h.form;if(!form)return t.skip('revisão indisponível para a consulta de demonstração');
  const out=form.querySelector('[data-completion-preview]'),rows=[...form.querySelectorAll('[data-op-consumption]')];assert.equal(rows.length,3,form.textContent.slice(0,400));
  assert.match(out.textContent,/Total marcado nesta consulta: 40 U · falta escolher o lote de 3 marcação/);
  for(const row of rows.slice(0,2)){const select=row.querySelector('select');select.value='lot';select.dispatchEvent(new h.w.Event('change',{bubbles:true}));}
  assert.match(out.textContent,/lote L9: usando 20 U \(R\$\s230,00\) · sobram 10 U/);assert.match(out.textContent,/falta escolher o lote de 1 marcação/);
  const last=rows[2].querySelector('select');last.value='lot';last.dispatchEvent(new h.w.Event('change',{bubbles:true}));
  assert.match(out.textContent,/usando 40 U \(R\$\s460,00\) · faltam 10 U neste lote \(saldo 30 U\)/);
});

test('financeiro: parcelas, saldo restante e troco aparecem antes de salvar',()=>{
  const s={bills:[{id:'b',patientId:'p',total:228000}],payments:[],installments:[]};
  const text=installmentPreview(s,s.bills[0],{entryAmount:'600,00',entryDueDate:'2026-11-17',count:'3',firstDueDate:'2026-12-15'}).replace(/<[^>]+>/g,' ');
  assert.match(text,/Total da cobrança\s+R\$\s2\.280,00/);assert.match(text,/entrada R\$\s600,00 em 17\/11\/2026 · restante R\$\s1\.680,00/);assert.match(text,/3x de R\$\s560,00/);assert.match(text,/15\/12\/2026, 15\/01\/2027, 15\/02\/2027/);
  assert.match(installmentPreview({bills:[{id:'c',total:10001}],payments:[]},{id:'c',total:10001},{entryAmount:'',entryDueDate:'',count:'3',firstDueDate:'2026-12-31'}).replace(/<[^>]+>/g,' '),/2x de R\$\s33,34 \+ 1x de R\$\s33,33.*31\/12\/2026, 31\/01\/2027, 28\/02\/2027/);
  assert.throws(()=>installmentPreview(s,s.bills[0],{entryAmount:'600',entryDueDate:'',count:'3',firstDueDate:'2026-12-15'}),/entrada/);
  assert.equal(s.installments.length,0,'a prévia não grava nada');assert.deepEqual(createInstallments(structuredClone(s),{billId:'b',count:3,firstDueDate:'2026-12-15',entryAmount:60000,entryDueDate:'2026-11-17'}).map(p=>p.amount),[60000,56000,56000,56000]);
  const strip=html=>html.replace(/<[^>]+>/g,' ');
  assert.match(strip(receiptPreview({balance:56000,amount:'300',method:'Pix'})),/ficam faltando\s+R\$\s260,00/);
  assert.match(strip(receiptPreview({balance:56000,amount:'560,00',method:'Dinheiro',handed:'600',label:'esta parcela'})),/quita esta parcela.*Troco:\s+R\$\s40,00/);
  assert.match(strip(receiptPreview({balance:56000,amount:'600',method:'Pix'})),/Acima do saldo: o máximo é R\$\s560,00/);
  assert.match(strip(receiptPreview({balance:56000,amount:'560',method:'Dinheiro',handed:'500'})),/menor que o valor recebido \(faltam R\$\s60,00\)/);
  assert.match(strip(receiptPreview({balance:56000,amount:'',method:'Pix'})),/Informe o valor recebido/);
});

test('nova cobrança: valor cheio com desconto em % ou em R$ preenche o valor cobrado',t=>{
  const dom=new JSDOM('<!doctype html><body></body>'),w=dom.window,nativeAbort=globalThis.AbortController;globalThis.AbortController=w.AbortController;t.after(()=>{globalThis.AbortController=nativeAbort;w.close();});
  const form=w.document.createElement('form');form.innerHTML='<input name="description">'+billCalculatorFields([{id:'p1',name:'Toxina',price:120000,cost:35000,active:true},{id:'p2',name:'Inativo',price:1,cost:1,active:false}])+'<input name="total"><input name="cost" value="0,00">'+BILL_PREVIEW;w.document.body.append(form);
  mountBillCalculator(form);mountBillCalculator(form);
  const el=name=>form.elements.namedItem(name),type=(name,value,event='input')=>{el(name).value=value;el(name).dispatchEvent(new w.Event(event,{bubbles:true}));},out=()=>form.querySelector('[data-bill-preview]').textContent;
  assert.equal(el('calcProcedure').options.length,2,'só procedimentos ativos');
  type('calcProcedure','p1','change');assert.equal(el('calcFull').value,'1200,00');assert.equal(el('total').value,'1200,00');assert.equal(el('cost').value,'350,00');assert.equal(el('description').value,'Toxina');
  type('calcPercent','10');assert.equal(el('total').value,'1080,00');assert.equal(el('calcDiscount').value,'120,00');assert.match(out(),/Valor cheio R\$\s1\.200,00 − desconto R\$\s120,00 \(10%\) · Valor cobrado R\$\s1\.080,00 · sobra R\$\s730,00 \(67,59%\)/);
  type('calcDiscount','150');assert.equal(el('total').value,'1050,00');assert.equal(el('calcPercent').value,'12,5');
  type('total','900');assert.equal(el('calcDiscount').value,'300,00');assert.equal(el('calcPercent').value,'25');
  type('total','300');assert.match(out(),/custo está maior que o valor cobrado/);
});

// Regressões apontadas na revisão independente de 16/11/2026.
test('revisão: empate no percentual escolhe o valor redondo e recebimento zero é avisado',()=>{
  assert.equal(discountFromAmount(5000,500).bps,1000);assert.equal(discountFromAmount(3000,3000).bps,10000);assert.equal(discountFromAmount(2000,1000).bps,5000);
  assert.match(receiptPreview({balance:30000,amount:'0,00',method:'Dinheiro',handed:'50'}),/Informe o valor recebido/);
});

test('revisão: total do item digitado aos poucos parte sempre dos valores iniciais da linha',async t=>{
  const h=page(t);await h.click('quote-new');await h.click('quote-item-add',{id:'proc',type:'procedure'});await h.click('quote-item-add',{id:'prod',type:'product'});
  const [procedure,product]=h.form.querySelectorAll('[data-op-row]'),field=(row,name)=>row.querySelector(`[name=${name}]`);
  // Procedimento de R$ 500,00: digitar 6000 por engano e corrigir para 600 não deixa preço inflado com desconto.
  for(const typed of ['6','60','600','6000','600'])h.type(field(procedure,'itemTotal'),typed);
  assert.equal(field(procedure,'unitPrice').value,'600,00');assert.equal(field(procedure,'itemDiscount').value,'0');
  field(procedure,'itemTotal').dispatchEvent(new h.w.Event('change',{bubbles:true}));
  h.type(field(procedure,'itemTotal'),'450');assert.equal(field(procedure,'unitPrice').value,'600,00');assert.equal(field(procedure,'itemDiscount').value,'25');
  h.type(field(procedure,'itemTotal'),'');assert.equal(field(procedure,'itemDiscount').value,'0','apagar o campo devolve a linha ao que era');
  // Produto sem preço: 5000 → 500 termina em preço 500,00 sem desconto.
  for(const typed of ['5000','500'])h.type(field(product,'itemTotal'),typed);
  assert.equal(field(product,'unitPrice').value,'500,00');assert.equal(field(product,'itemDiscount').value,'0');
  // "R$ 50" no preço não é aceito pelo salvamento; o campo de apoio também não calcula em cima dele.
  h.type(field(product,'unitPrice'),'R$ 50');h.type(field(product,'itemDiscountValue'),'10');assert.equal(field(product,'itemDiscount').value,'0');
});

test('revisão: orçamento só com produtos não fala em valor de tabela',async t=>{
  const h=page(t);await h.click('quote-new');await h.click('quote-item-add',{id:'prod',type:'product'});
  const row=h.form.querySelector('[data-op-row]');h.type(row.querySelector('[name=unitPrice]'),'30,00');h.type(row.querySelector('[name=itemDiscount]'),'10');
  assert.doesNotMatch(h.form.querySelector('[data-op-quote-total]').textContent,/valor de tabela/);assert.match(h.form.querySelector('[data-op-quote-total]').textContent,/Total para a paciente R\$\s27,00/);
});

test('revisão: nova cobrança só recalcula o valor cobrado a partir do valor cheio e do desconto',t=>{
  const dom=new JSDOM('<!doctype html><body></body>'),w=dom.window,nativeAbort=globalThis.AbortController;globalThis.AbortController=w.AbortController;t.after(()=>{globalThis.AbortController=nativeAbort;w.close();});
  const form=w.document.createElement('form');form.innerHTML='<select name="patientId"><option value="a">A</option><option value="b">B</option></select><input name="description">'+billCalculatorFields([{id:'p1',name:'Toxina · facial',price:100000,cost:35000,active:true},{id:'p2',name:'Peeling',price:40000,cost:5000,active:true}])+'<input name="total"><input name="cost" value="0,00">'+BILL_PREVIEW;w.document.body.append(form);mountBillCalculator(form);
  const el=name=>form.elements.namedItem(name),type=(name,value,event='input')=>{el(name).value=value;el(name).dispatchEvent(new w.Event(event,{bubbles:true}));};
  type('calcFull','1000');type('calcDiscount','333,33');assert.equal(el('total').value,'666,67');
  type('cost','100');type('description','Cobrança avulsa');type('patientId','b','change');assert.equal(el('total').value,'666,67','custo, descrição e paciente não mexem no valor cobrado');assert.equal(el('calcDiscount').value,'333,33');
  type('total','1200');type('cost','150');type('description','Outra');assert.equal(el('total').value,'1200');
  // Trocar de procedimento atualiza a descrição automática, mas respeita a que foi digitada.
  type('description','');type('calcProcedure','p1','change');assert.equal(el('description').value,'Toxina · facial');type('calcProcedure','p2','change');assert.equal(el('description').value,'Peeling');assert.equal(el('calcFull').value,'400,00');assert.equal(el('cost').value,'50,00');
  type('description','Texto meu');type('calcProcedure','p1','change');assert.equal(el('description').value,'Texto meu');
});
