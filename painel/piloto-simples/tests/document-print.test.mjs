import test from 'node:test';
import assert from 'node:assert/strict';
import {CLINIC_DOCUMENT_MODELS} from '../document-library.mjs';
import {blankAnswer,blankDocumentBody,blankDocumentTitle,printFileName} from '../document-print.mjs';
import {saveTemplate} from '../documents-domain.mjs';

const strip=html=>html.replace(/<style>[\s\S]*?<\/style>/g,'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');

test('blank form keeps every text, question and option of every library model, with identification and signature areas',()=>{
 const names=new Set();
 for(const model of CLINIC_DOCUMENT_MODELS){
  const html=blankDocumentBody(model,{footer:'rodapé de teste'}),text=strip(html);
  for(const block of model.blocks||[])assert.ok(text.includes(block.title)&&text.includes(block.body.split('\n')[0].slice(0,60)),model.id+' block '+block.id);
  if(model.body)assert.ok(text.includes(model.body.split('\n')[0].slice(0,60)),model.id+' body');
  for(const q of model.questions){
   assert.ok(text.includes(q.label),model.id+' question '+q.id);
   for(const option of q.options||[])assert.ok(text.includes(option),model.id+' option '+option);
   if(q.required)assert.match(html,new RegExp(q.label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+' <span class="pb-req">\\(obrigatória\\)'));
  }
  for(const step of model.steps||[])assert.ok(text.includes(step.title),model.id+' step '+step.title);
  for(const expected of ['Identificação','Nome completo','Data de nascimento','CPF','WhatsApp','Declaração e assinatura','Assinatura da paciente','Assinatura e carimbo da profissional','rodapé de teste'])assert.ok(text.includes(expected),model.id+' '+expected);
  assert.doesNotMatch(html,/<script/i);
  const name=printFileName(model);assert.match(name,/^[a-z0-9-]+\.pdf$/);assert.ok(!names.has(name),'PDF name must be unique: '+name);names.add(name);
 }
});

test('blank answers follow the question type and conditional questions explain when to answer',()=>{
 assert.equal((blankAnswer({type:'yesno'}).match(/pb-box/g)||[]).length,2);
 assert.equal((blankAnswer({type:'yesnona'}).match(/pb-box/g)||[]).length,3);
 assert.equal((blankAnswer({type:'select',options:['A','B','C']}).match(/pb-box/g)||[]).length,3);
 assert.match(blankAnswer({type:'date'}),/____ \/ ____ \/ ________/);
 assert.match(blankAnswer({type:'scale',min:0,max:10}),/Nota de 0 a 10/);
 assert.equal((blankAnswer({type:'long'}).match(/pb-line/g)||[]).length,3);
 assert.equal((blankAnswer({type:'text'}).match(/pb-line/g)||[]).length,1);
 const anamnese=CLINIC_DOCUMENT_MODELS.find(m=>m.kind==='anamnese'),html=blankDocumentBody(anamnese);
 assert.match(html,/Responda apenas se “Já realizou Toxina botulínica\?” = Sim\./);
 assert.ok(blankDocumentBody({title:'X',body:'Texto <b>escapado</b>',questions:[{id:'a',label:'Pergunta <i>',type:'text'}]}).includes('&lt;b&gt;'));
});

test('intramuscular model bundles the anamnesis with the specific questions the clinic asked for',()=>{
 const model=CLINIC_DOCUMENT_MODELS.find(m=>m.id==='amj-termo-intramuscular-20261116');
 assert.ok(model);assert.equal(model.kind,'termo');assert.ok(!CLINIC_DOCUMENT_MODELS.some(m=>m.id==='amj-termo-intramuscular-20261112'));
 const anamnese=CLINIC_DOCUMENT_MODELS.find(m=>m.kind==='anamnese');
 for(const q of anamnese.questions.filter(q=>q.id!=='alergia-med'))assert.deepEqual(model.questions.find(x=>x.id===q.id),q,'anamnese question preserved: '+q.id);
 const byId=Object.fromEntries(model.questions.map(q=>[q.id,q]));
 assert.equal(byId.alergia_medicamento.type,'yesno');assert.equal(byId.alergia_medicamento.required,true);assert.match(byId.alergia_medicamento.label,/alergia a algum medicamento/i);
 assert.deepEqual(byId.alergia_medicamento_quais.condition,{questionId:'alergia_medicamento',value:'Sim'});
 assert.match(byId.gluteo_pmma.label,/PMMA.*silicone.*glúteos/i);assert.equal(byId.gluteo_pmma.required,true);
 assert.deepEqual(byId.gluteo_pmma_detalhe.condition,{questionId:'gluteo_pmma',value:'Sim'});
 assert.ok(model.blocks.some(b=>b.id==='local'&&/PMMA/.test(b.body)));
 assert.ok(model.blocks.some(b=>b.id==='dados'&&/13\.709\/2018/.test(b.body)));
 assert.equal(model.questions.length,74);assert.equal(model.steps.length,7);
 const s={documentTemplates:[],documentResponses:[],documentHistory:[]};
 const version=saveTemplate(s,structuredClone(model));assert.equal(version.questions.length,74);assert.equal(version.steps.length,7);
 const title=blankDocumentTitle(model);assert.match(title,/para preenchimento em papel/);
});
