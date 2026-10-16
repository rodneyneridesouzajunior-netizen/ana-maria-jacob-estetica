import test from 'node:test';
import assert from 'node:assert/strict';
import {CLINIC_DOCUMENT_MODELS} from '../document-library.mjs';
import {saveTemplate,prepareDocument,validateDocumentVersion,visibleQuestions} from '../documents-domain.mjs';
import {seed} from '../domain.mjs';
test('clinic models are separate, versioned and never rewrite an issued snapshot',()=>{
 const s=seed();s.documentTemplates=[];s.documentResponses=[];s.documentHistory=[];
 assert.equal(CLINIC_DOCUMENT_MODELS.filter(t=>t.kind==='anamnese').length,1);
 assert.equal(CLINIC_DOCUMENT_MODELS.filter(t=>t.kind==='termo').length,10);
 assert.equal(CLINIC_DOCUMENT_MODELS.filter(t=>t.kind==='imagem').length,1);
 for(const model of CLINIC_DOCUMENT_MODELS){const v=saveTemplate(s,structuredClone(model));validateDocumentVersion(v);const record=prepareDocument(s,{id:'issued-'+model.id,templateId:model.id,patientId:'demo-marina',visitId:'demo-consulta'}),original=structuredClone(record);saveTemplate(s,{...structuredClone(model),title:'Versão revisada',expectedVersion:1});assert.deepEqual(record,original);assert.equal(s.documentTemplates.at(-1).versions.length,2);}
});
test('procedure models exclude repeated general data and image sections',()=>{
 for(const model of CLINIC_DOCUMENT_MODELS.filter(t=>t.kind==='termo')){
  const content=[model.body,...(model.blocks||[]).flatMap(block=>[block.title,block.body])].join('\n');
  assert.doesNotMatch(content,/PROTEÇÃO DE DADOS PESSOAIS|AUTORIZAÇÃO DE USO DE IMAGEM|Autorizo o tratamento dos meus dados/);
  assert.match(content,/riscos/i);assert.match(content,/anamnese obrigatória/);
 }
});
test('anamnese conditional questions and independent image decisions start unanswered',()=>{
 const anam=CLINIC_DOCUMENT_MODELS.find(t=>t.kind==='anamnese');assert.equal(anam.questions.length,68);assert.equal(visibleQuestions(anam,{}).filter(q=>q.id==='laser-0').length,0);assert.equal(visibleQuestions(anam,{'laser-interesse':'Sim'}).filter(q=>q.id==='laser-0').length,1);
 const image=CLINIC_DOCUMENT_MODELS.find(t=>t.kind==='imagem');assert.ok(image.questions.every(q=>!Object.hasOwn(q,'default')));assert.ok(image.questions.some(q=>q.id==='antes-depois'));
});
