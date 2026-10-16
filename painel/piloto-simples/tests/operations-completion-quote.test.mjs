import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {seed} from '../domain.mjs';
import {saveProcedure,saveQuote,approveQuote} from '../operations-domain.mjs';
import {completionForm} from '../operations-ui.mjs';
import {multipleQuoteHTML,updateMultipleQuote,extractMultipleQuote} from '../operations-completion-quote.mjs';
const require=createRequire(new URL('../../../../../skinpro-analise/test-tools/package.json',import.meta.url)),{JSDOM}=require('jsdom');
function scenario(){const s=seed();s.visits[0].maps={};s.quotes=[];s.bills=[];s.payments=[];s.procedures=[];const now='2026-10-16T15:00:00Z',today='2026-10-16';for(const id of ['a','b'])saveProcedure(s,{operationId:'save-'+id,now,today,data:{id,name:'Procedimento '+id,price:10000,cost:1000,duration:30,returnDays:0,active:true}});const v=s.visits[0];Object.assign(v,{procedureId:'a',procedureVersion:1,procedureSnapshot:structuredClone(s.procedures[0])});v.maps={'demo-foto':{version:1,points:[{id:'point-b',procedureId:'b',procedureVersion:1,procedureSnapshot:structuredClone(s.procedures[1])}]}};saveQuote(s,{operationId:'quote',now,today,data:{id:'quote',patientId:v.patientId,title:'Pacote',validUntil:'2026-11-16',items:s.procedures.map(p=>({id:'item-'+p.id,type:'procedure',procedureId:p.id,sessions:3,unitPrice:10000,unitCost:1000,discountBps:0})),discountBps:0,conditions:'Teste'}});approveQuote(s,{operationId:'approve',now,today,quoteId:'quote',expectedVersion:1,approved:true,note:'Teste'});return {s,v:s.visits.find(x=>x.id===v.id)};}
test('multiple procedure completion offers only explicit quote items and preserves sessions',()=>{
 const {s,v}=scenario(),dom=new JSDOM('<form>'+multipleQuoteHTML(s,v)+'</form>'),form=dom.window.document.querySelector('form');
 assert.equal(form.elements.multiQuoteId.value,'');assert.equal(form.querySelectorAll('input:checked').length,0);assert.deepEqual(extractMultipleQuote(form),{});
 form.elements.multiQuoteId.value='quote';updateMultipleQuote(form);assert.equal(form.querySelector('[data-multi-quote]').hidden,false);assert.throws(()=>extractMultipleQuote(form),/Selecione/);
 form.querySelectorAll('input[type=checkbox]').forEach(c=>c.checked=true);form.querySelector('[name=multi-sessions-item-b]').value='2';assert.deepEqual(extractMultipleQuote(form),{quoteId:'quote',quoteItems:[{itemId:'item-a',sessions:1},{itemId:'item-b',sessions:2}]});
 form.elements.multiQuoteId.value='';updateMultipleQuote(form);assert.deepEqual(extractMultipleQuote(form),{});assert.equal(form.querySelectorAll('input:not(:disabled)').length,0);dom.window.close();
});
test('completion form switches to multi-item mode only for different procedures',()=>{const {s,v}=scenario();assert.match(completionForm(s,v.id).body,/name="multiQuoteId"/);assert.doesNotMatch(completionForm(s,v.id).body,/name="quoteSelection"/);v.maps={};assert.match(completionForm(s,v.id).body,/name="quoteSelection"/);});
