import test from 'node:test';
import assert from 'node:assert/strict';
import {mountOperations} from '../operations-ui.mjs';
import {seed} from '../domain.mjs';

// Exercise the real event handlers with a minimal DOM and delayed persistence.
// Browser rendering/focus remains a separate end-to-end check.
function harness(t,options={}){
  const previous={document:globalThis.document,confirm:globalThis.confirm,FormData:globalThis.FormData};
  const dialogs=[],queue=[];let answer=false,confirmations=0,renders=0;
  const state=seed();
  class Events {
    constructor(){this.listeners=new Map();}
    addEventListener(type,handler){const list=this.listeners.get(type)||[];list.push(handler);this.listeners.set(type,list);}
    async emit(type,target=this){const event={target,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};for(const handler of this.listeners.get(type)||[])await handler(event);return event;}
  }
  class Dialog extends Events {
    constructor(){super();this.attributes={};this.isConnected=false;this.open=false;}
    setAttribute(key,value){this.attributes[key]=value;}
    set innerHTML(html){
      this.html=html;
      const error={textContent:'',isConnected:true};
      this.form={dataset:{opForm:html.match(/data-op-form="([^"]+)/)[1]},inert:false,error,
        values:{id:'product-test',operationId:'operation-test',name:'Produto fictício',unit:'mL',unitCost:'1,00',active:'on',expectedVersion:'0'},
        closest:selector=>selector.includes('form')?this.form:null,
        querySelector:selector=>selector==='.op-form-error'?error:null};
    }
    querySelector(selector){return selector==='form'?this.form:null;}
    showModal(){this.open=true;}
    close(){this.open=false;}
    remove(){this.isConnected=false;this.form.error.isConnected=false;}
  }
  const host=new Events();host.contains=()=>true;host.append=dialog=>{dialog.isConnected=true;dialogs.push(dialog);};host.querySelector=()=>null;
  globalThis.document={createElement:tag=>{assert.equal(tag,'dialog');return new Dialog();}};
  globalThis.confirm=()=>{confirmations++;return answer;};
  globalThis.FormData=class{constructor(form){this.values=form.values;}[Symbol.iterator](){return Object.entries(this.values)[Symbol.iterator]();}has(key){return key in this.values;}getAll(key){return this.has(key)?Array.isArray(this.values[key])?this.values[key]:[this.values[key]]:[];}};
  const cleanup=mountOperations(host,{...options,getState:()=>state,mutate:fn=>new Promise((resolve,reject)=>queue.push({fn,resolve,reject})),render:()=>{renders++;}});
  t.after(()=>{cleanup();for(const [key,value]of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
  const click=(action,data={})=>{const button={dataset:{op:action,...data},closest:selector=>selector==='[data-op]'?button:null};return host.emit('click',button);};
  return {host,dialogs,queue,state,click,get dialog(){return dialogs.at(-1);},set answer(value){answer=value;},get confirmations(){return confirmations;},get renders(){return renders;}};
}

test('modal de operações tem nome acessível; Esc e Cancelar preservam rascunho recusado',async t=>{
  const h=harness(t);await h.click('product-new');const d=h.dialog;
  assert.ok(d.attributes['aria-labelledby']);assert.ok(d.html.includes('id="'+d.attributes['aria-labelledby']+'"'));
  await h.host.emit('input',d.form);assert.equal(d.form.dataset.unsaved,'true');
  assert.equal((await d.emit('cancel')).defaultPrevented,true);assert.equal(d.open,true);
  await h.click('modal-close');assert.equal(d.isConnected,true);assert.equal(h.confirmations,2);
  h.answer=true;await h.click('modal-close');assert.equal(d.isConnected,false);assert.equal(d.open,false);
});

test('abrir outro modal não substitui formulário alterado sem descarte confirmado',async t=>{
  const h=harness(t);await h.click('product-new');const d=h.dialog;
  await h.host.emit('change',d.form);await h.click('procedure-new');
  assert.equal(h.dialog,d);assert.equal(h.dialogs.length,1);assert.equal(d.form.dataset.unsaved,'true');
  h.answer=true;await h.click('procedure-new');assert.equal(h.dialogs.length,2);assert.equal(d.isConnected,false);
});

test('commit pendente bloqueia fechamento e sucesso limpa rascunho sem confirmar descarte',async t=>{
  const h=harness(t);await h.click('product-new');const d=h.dialog;
  await h.host.emit('input',d.form);const saving=h.host.emit('submit',d.form);
  assert.equal(d.form.inert,true);assert.equal(h.queue.length,1);
  await d.emit('cancel');await h.click('modal-close');assert.equal(d.open,true);assert.equal(h.confirmations,0);
  h.queue[0].fn(h.state);h.queue[0].resolve();await saving;
  assert.equal(d.form.dataset.unsaved,undefined);assert.equal(d.isConnected,false);assert.equal(h.confirmations,0);assert.equal(h.renders,1);
});

test('falha de commit conserva rascunho e reabilita formulário para correção',async t=>{
  const h=harness(t);await h.click('product-new');const d=h.dialog;
  await h.host.emit('input',d.form);const saving=h.host.emit('submit',d.form);
  h.queue[0].reject(Error('Armazenamento indisponível'));await saving;
  assert.equal(d.open,true);assert.equal(d.form.inert,false);assert.equal(d.form.dataset.unsaved,'true');assert.equal(d.form.values.name,'Produto fictício');assert.equal(d.form.error.textContent,'Armazenamento indisponível');assert.equal(h.renders,0);
});

test('troca de seção do catálogo não descarta modal editado sem confirmação',async t=>{
  const h=harness(t);await h.click('product-new');const d=h.dialog;
  await h.host.emit('input',d.form);await h.click('catalog-open',{id:'stock'});
  assert.equal(d.isConnected,true);assert.equal(h.host.innerHTML,undefined);assert.equal(h.confirmations,1);
  h.answer=true;await h.click('catalog-open',{id:'stock'});
  assert.equal(d.isConnected,false);assert.ok(h.host.innerHTML.includes('Novo lote'));
  await h.click('catalog-open',{id:'overview'});
});

test('envio real do formulário converte preço e intervalo sem perder categoria, modo ou vínculo',async t=>{
  const h=harness(t);h.state.documentTemplates=[{id:'termo',kind:'termo',title:'Termo fictício'}];
  await h.click('procedure-new');const d=h.dialog;
  d.form.values={id:'procedure-test',operationId:'procedure-save',expectedVersion:'0',name:'Procedimento fictício',category:'Categoria de teste',emoji:'✦',price:'300,00',cost:'40,00',duration:'45',returnInterval:'2',returnUnit:'months',recordMode:'non_injectable',consentTemplateId:'termo',requiredDocumentIds:['termo'],active:'on'};
  const saving=h.host.emit('submit',d.form);assert.equal(h.queue.length,1);h.queue[0].fn(h.state);h.queue[0].resolve();await saving;
  const p=h.state.procedures[0];assert.equal(p.price,30000);assert.equal(p.cost,4000);assert.equal(p.duration,45);assert.equal(p.returnInterval,2);assert.equal(p.returnUnit,'months');assert.equal(p.category,'Categoria de teste');assert.equal(p.recordMode,'non_injectable');assert.equal(p.consentTemplateId,'termo');assert.deepEqual(p.requiredDocumentIds,['termo']);assert.equal(d.isConnected,false);
});

test('busca do catálogo atualiza somente a lista e mantém campo/foco disponível',async t=>{
  const h=harness(t);h.state.products=[{id:'p1',name:'Sérum de teste',unit:'mL',unitCost:100,version:1},{id:'p2',name:'Outro produto',unit:'un',unitCost:200,version:1}];
  await h.click('catalog-open',{id:'products'});const shell=h.host.innerHTML,list={innerHTML:''};h.host.querySelector=selector=>selector==='[data-catalog-list]'?list:null;
  const input={dataset:{catalogSearch:''},value:'serum'};await h.host.emit('input',input);
  assert.equal(h.host.innerHTML,shell);assert.ok(list.innerHTML.includes('Sérum de teste'));assert.ok(!list.innerHTML.includes('Outro produto'));assert.equal(input.value,'serum');assert.equal(h.queue.length,0);
  await h.click('catalog-open',{id:'overview'});
});

// Parses the editor's emitted inputs; the real controller owns add/remove/submit.
function quoteEditorDOM(form){
  const rows=[],output={innerHTML:'',textContent:''},placeholder={hidden:false},results={innerHTML:''};
  const list={insertAdjacentHTML(_where,html){const fields={};for(const match of html.matchAll(/<input\b[^>]*>/g)){const name=match[0].match(/name="([^"]+)"/)?.[1],value=match[0].match(/value="([^"]*)"/)?.[1];if(name)fields[name]={value:value||'',name,closest:()=>form};}const line={textContent:''},row={fields,querySelector(selector){if(selector==='[data-quote-line-total]')return line;const name=selector.match(/\[name=([^\]]+)\]/)?.[1];return fields[name]||null;},remove(){rows.splice(rows.indexOf(row),1);}};rows.push(row);}};
  const error=form.error;form.elements={discount:{value:'10'},quoteSearch:{value:''},quoteType:{value:'all'}};
  form.querySelector=selector=>({'.op-form-error':error,'[data-op-quote-total]':output,'[data-quote-empty]':placeholder,'[data-op-items]':list,'[data-quote-results]':results}[selector]||null);
  form.querySelectorAll=selector=>selector==='[data-op-row]'?rows:[];
  return{rows,output,placeholder,results,button(action,{id,type,row}={}){const b={dataset:{op:action,id,type},closest:selector=>selector==='[data-op]'?b:selector==='[data-op-row]'?row:selector==='form'?form:null};return b;}};
}

test('editor real adiciona procedimento/produto, recalcula descontos, remove item e salva sem sessões no produto',async t=>{
  const h=harness(t);h.state.procedures=[{id:'proc',name:'Procedimento fictício',price:1001,cost:300,version:1,active:true}];h.state.products=[{id:'prod',name:'Produto fictício',unit:'mL',unitCost:199,version:1,active:true}];
  await h.click('quote-new');const d=h.dialog,form=d.form,editor=quoteEditorDOM(form);
  form.values={id:'quote-ui',operationId:'quote-op',expectedVersion:'0',patientId:'demo-marina',title:'',validUntil:'',discount:'10',conditions:'Teste',notes:'Observação',paymentMethods:['pix','boleto']};
  await h.host.emit('click',editor.button('quote-item-add',{id:'proc',type:'procedure'}));await h.host.emit('click',editor.button('quote-item-add',{id:'prod',type:'product'}));
  assert.equal(editor.rows.length,2);assert.equal(editor.placeholder.hidden,true);const first=editor.rows[0].fields,second=editor.rows[1].fields;
  first.sessions.value='3';first.itemDiscount.value='12,5';second.quantity.value='2,5';second.unitPrice.value='2,99';second.itemDiscount.value='5';await h.host.emit('input',second.unitPrice);
  assert.ok(editor.output.innerHTML.includes('30,05'));assert.equal(form.dataset.unsaved,'true');
  await h.host.emit('click',editor.button('quote-row-remove',{row:editor.rows[0]}));assert.equal(editor.rows.length,1);assert.ok(editor.output.innerHTML.includes('6,40'));
  const saving=h.host.emit('submit',form);assert.equal(h.queue.length,1);h.queue[0].fn(h.state);h.queue[0].resolve();await saving;
  const q=h.state.quotes[0];assert.equal(q.items.length,1);assert.equal(q.items[0].type,'product');assert.equal(q.items[0].quantity,2.5);assert.equal(q.items[0].discountBps,500);assert.equal(q.items[0].sessions,undefined);assert.equal(q.total,640);assert.deepEqual(q.paymentMethods,['pix','boleto']);assert.equal(q.notes,'Observação');assert.equal(d.isConnected,false);
});

test('pesquisar itens não altera o rascunho nem descarta linhas; mudar filtro só atualiza resultados',async t=>{
  const h=harness(t);h.state.procedures=[{id:'proc',name:'Procedimento fictício',price:1001,cost:300,version:1,active:true}];h.state.products=[{id:'prod',name:'Produto fictício',unit:'mL',unitCost:199,version:1,active:true}];
  await h.click('quote-new');const form=h.dialog.form,editor=quoteEditorDOM(form);editor.results.innerHTML='anterior';form.elements.quoteSearch.value='produto';
  const search={dataset:{quoteSearch:''},closest:()=>form};await h.host.emit('input',search);assert.ok(editor.results.innerHTML.includes('Produto fictício'));assert.ok(!editor.results.innerHTML.includes('Procedimento fictício'));assert.equal(form.dataset.unsaved,undefined);assert.equal(editor.rows.length,0);
  form.elements.quoteType.value='procedure';const type={dataset:{quoteType:''},closest:()=>form};await h.host.emit('change',type);assert.ok(editor.results.innerHTML.includes('Nenhum item ativo'));assert.equal(form.dataset.unsaved,undefined);assert.equal(h.queue.length,0);
});

test('rascunho externo impede abrir revisão da consulta sem descarte ou persistência',async t=>{
  let checks=0;const h=harness(t,{beforeOperation:()=>{checks++;return false;}}),notes=h.state.visits[0].notes;
  await h.click('visit-review',{id:'demo-consulta'});
  assert.equal(checks,1);assert.equal(h.dialogs.length,0);assert.equal(h.queue.length,0);assert.equal(h.renders,0);assert.equal(h.confirmations,0);assert.equal(h.state.visits[0].notes,notes);
});

test('conclusão reavalia rascunho externo após abertura e conserva o formulário sem commit',async t=>{
  let ready=true,checks=0;const h=harness(t,{beforeOperation:()=>{checks++;return ready;}});
  await h.click('visit-review',{id:'demo-consulta'});const d=h.dialog;assert.ok(d.open);ready=false;
  await h.host.emit('submit',d.form);
  assert.equal(checks,2);assert.equal(h.queue.length,0);assert.equal(d.isConnected,true);assert.equal(d.open,true);assert.equal(h.renders,0);assert.equal(h.confirmations,0);
});
