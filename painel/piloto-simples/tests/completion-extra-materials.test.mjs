// Conclusão do atendimento com vários materiais adicionais (luva, seringa, soro...).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {mountOperations,renderVisitOperations} from '../operations-ui.mjs';
import {emptyState} from '../../../supabase/functions/app-workspace/rules.mjs';
import {saveProcedure,saveProduct,receiveLot,completeVisit} from '../operations-domain.mjs';

const require=createRequire(new URL('../../../../../skinpro-analise/test-tools/package.json',import.meta.url)),{JSDOM}=require('jsdom');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const html=await fs.readFile(new URL('../connected.html',import.meta.url),'utf8');
const options={now:'2026-10-15T18:00:00.000Z',today:'2026-10-15'};
function workspace(){
 const s=emptyState();s.revision=4;s.patients.push({id:'patient',name:'Paciente sintética'});
 saveProcedure(s,{...options,operationId:'proc-op',data:{id:'proc',name:'Avaliação sintética',price:10000,cost:1000,duration:30,recordMode:'simple'}});
 for(const [id,name,unit,unitCost] of [['luva','Luva sintética','un',150],['seringa','Seringa sintética','un',300],['soro','Soro sintético','mL',50]]){
  saveProduct(s,{...options,operationId:id+'-product-op',data:{id,name,unit,unitCost,usage:'material'}});
  receiveLot(s,{...options,operationId:id+'-lot-op',data:{id:'lot-'+id,productId:id,code:'L-'+id.toUpperCase(),expiry:'2027-10-15',quantity:100,unitCost}});
 }
 s.visits.push({id:'visit',patientId:'patient',professionalId:'amj-principal',date:'2026-10-15',status:'rascunho',notes:'Registro salvo',photos:[],maps:{},procedureId:'proc',procedureVersion:1,procedureSnapshot:structuredClone(s.procedures[0])});return s;
}
function review(t,completeClinical=async()=>true){
 const dom=new JSDOM(html,{url:'https://example.invalid/app/#paciente/patient/visit/consultas'}),w=dom.window,previous={};
 for(const name of ['document','FormData','AbortController','confirm']){previous[name]=globalThis[name];globalThis[name]=name==='confirm'?()=>false:w[name];}
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 t.after(()=>{w.close();for(const [name,value]of Object.entries(previous))if(value===undefined)delete globalThis[name];else globalThis[name]=value;});
 const host=w.document.getElementById('content'),state=workspace(),notices=[];host.innerHTML=renderVisitOperations(state,'visit');
 const dispose=mountOperations(host,{getState:()=>state,completeClinical,beforeOperation:()=>true,notify:(message,error)=>notices.push({message,error}),mutate(){throw Error('A conclusão clínica não usa a gravação genérica.');},render(){}});t.after(dispose);
 host.querySelector('[data-op=visit-review]').click();const form=host.querySelector('[data-op-form]');
 const rows=()=>[...form.querySelectorAll('[data-op-extra]')],click=action=>form.querySelector(`[data-op="${action}"]`).click();
 const fill=(index,lot,quantity,reason)=>{const row=rows()[index];row.querySelector('[name=extraLot]').value=lot;row.querySelector('[name=extraQuantity]').value=quantity;row.querySelector('[name=extraReason]').value=reason;row.querySelector('[name=extraQuantity]').dispatchEvent(new w.Event('input',{bubbles:true}));};
 const submit=()=>{form.elements.reviewed.checked=true;form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));};
 return{w,host,form,state,notices,rows,click,fill,submit};
}

test('a revisão começa com uma linha e aceita adicionar materiais um a um',t=>{
 const h=review(t);assert.equal(h.rows().length,1);assert.match(h.form.textContent,/Materiais adicionais \(opcional\)/);
 h.click('extra-add');h.click('extra-add');assert.equal(h.rows().length,3);
 for(const row of h.rows()){assert.equal(row.querySelector('[name=extraLot]').value,'');assert.equal(row.querySelector('[name=extraQuantity]').value,'');assert.equal(row.querySelectorAll('[name=extraLot] option').length,4);}
 assert.equal(h.form.dataset.unsaved,'true');
});

test('a linha nova nasce vazia mesmo quando a primeira já está preenchida',t=>{
 const h=review(t);h.fill(0,'lot-luva','2','Luvas de procedimento');h.click('extra-add');
 const [first,second]=h.rows();assert.equal(first.querySelector('[name=extraLot]').value,'lot-luva');assert.equal(first.querySelector('[name=extraQuantity]').value,'2');
 assert.equal(second.querySelector('[name=extraLot]').value,'');assert.equal(second.querySelector('[name=extraQuantity]').value,'');assert.equal(second.querySelector('[name=extraReason]').value,'');
});

test('todos os materiais preenchidos seguem para a conclusão, na ordem das linhas',async t=>{
 const received=[],h=review(t,async data=>{received.push(data);return true;});
 h.click('extra-add');h.click('extra-add');h.click('extra-add');
 h.fill(0,'lot-luva','2','Luvas de procedimento');h.fill(1,'lot-seringa','3','Seringas');h.fill(3,'lot-soro','4,5','Diluição');
 h.submit();await tick();
 assert.equal(received.length,1);
 assert.deepEqual(received[0].consumptions,[{lotId:'lot-luva',quantity:'2',reason:'Luvas de procedimento'},{lotId:'lot-seringa',quantity:'3',reason:'Seringas'},{lotId:'lot-soro',quantity:'4,5',reason:'Diluição'}],'A linha vazia do meio é ignorada');
});

test('quantidade sem lote em qualquer linha impede a conclusão e preserva o formulário',async t=>{
 const received=[],h=review(t,async data=>{received.push(data);return true;});
 h.click('extra-add');h.fill(0,'lot-luva','2','Luvas');h.fill(1,'','3','Sem lote escolhido');h.submit();await tick();
 assert.equal(received.length,0);assert.equal(h.form.isConnected,true);assert.equal(h.rows().length,2);
 assert.match(h.form.textContent+h.notices.map(n=>n.message).join(' '),/Selecione o lote do material adicional/);
});

test('remover tira só a linha escolhida; a última linha é apenas limpa',t=>{
 const h=review(t);h.click('extra-add');h.fill(0,'lot-luva','2','Luvas');h.fill(1,'lot-seringa','3','Seringas');
 h.rows()[0].querySelector('[data-op="extra-remove"]').click();
 assert.equal(h.rows().length,1);assert.equal(h.rows()[0].querySelector('[name=extraLot]').value,'lot-seringa');
 h.rows()[0].querySelector('[data-op="extra-remove"]').click();
 assert.equal(h.rows().length,1);assert.equal(h.rows()[0].querySelector('[name=extraLot]').value,'');assert.equal(h.rows()[0].querySelector('[name=extraQuantity]').value,'');
});

test('a prévia soma o custo de todos os materiais e atualiza ao remover',t=>{
 const h=review(t),preview=()=>h.form.querySelector('[data-completion-preview]').textContent;
 h.click('extra-add');h.fill(0,'lot-luva','2','Luvas');h.fill(1,'lot-seringa','3','Seringas');
 assert.match(preview(),/Luva sintética/);assert.match(preview(),/Seringa sintética/);assert.match(preview(),/materiais R\$\s*12,00/,'2 × 1,50 + 3 × 3,00');
 h.rows()[1].querySelector('[data-op="extra-remove"]').click();
 assert.doesNotMatch(preview(),/Seringa sintética/);assert.match(preview(),/materiais R\$\s*3,00/);
});

test('há um limite de linhas para não travar a tela',t=>{
 const h=review(t);for(let i=0;i<40;i++)h.click('extra-add');
 assert.equal(h.rows().length,30);assert.ok(h.notices.some(n=>/Limite de 30 materiais adicionais/.test(n.message)));
});

test('o registro concluído baixa cada lote e soma os materiais ao custo do atendimento',()=>{
 const state=workspace(),before=Object.fromEntries(state.stockLots.map(l=>[l.id,l.balanceUnits])),perUnit=before['lot-luva']/100;
 const result=completeVisit(state,{...options,operationId:'done-op',visitId:'visit',procedureId:'proc',sessions:1,consumptions:[{lotId:'lot-luva',quantity:'2',reason:'Luvas'},{lotId:'lot-seringa',quantity:'3',reason:'Seringas'},{lotId:'lot-soro',quantity:'4,5',reason:'Diluição'}]},{documentCheck:()=>true});
 const after=result?.state||state,done=after.visits.find(v=>v.id==='visit'),used=id=>before[id]-after.stockLots.find(l=>l.id===id).balanceUnits;
 assert.equal(done.status,'concluido');assert.equal(done.consumptions.length,3);
 assert.deepEqual(done.consumptions.map(c=>c.productName),['Luva sintética','Seringa sintética','Soro sintético']);
 assert.equal(done.actualCost,1000+2*150+3*300+Math.round(4.5*50),'custo base + luvas + seringas + soro, em centavos');
 assert.equal(used('lot-luva'),2*perUnit);assert.equal(used('lot-seringa'),3*perUnit);assert.equal(used('lot-soro'),4.5*perUnit);
});
