import test from 'node:test';
import assert from 'node:assert/strict';
import {seed} from '../domain.mjs';
import {ensureDocuments,saveTemplate,validateDocumentQuestions,validateDocumentVersion,documentSections,prepareDocument,saveDocumentAnswers,checkAnswers,visibleQuestions,signaturePayload,signDemoDocument} from '../documents-domain.mjs';
import {documentEditorDraft,changeDocumentStructure,renderDocumentEditorStructure,renderDocumentResponseFields,documentBody} from '../documents-editor.mjs';
import {backupHash,buildBackup,verifyBackup,validateBackupState} from '../backup.mjs';
function fresh(){const s=seed();ensureDocuments(s);return s;}
function template(s,changes={}){return saveTemplate(s,{id:'template',kind:'anamnese',title:'Modelo fictício',body:'Conteúdo de teste, sem indicação clínica.',questions:[],...changes});}
function prepare(s){return prepareDocument(s,{id:'document',templateId:'template',patientId:'demo-marina',visitId:'demo-consulta'});}
const q=(id,type='text',extra={})=>({id,type,label:'Pergunta '+id,required:false,...extra});
const steps=(...groups)=>groups.map((questionIds,i)=>({id:'step'+i,title:'Etapa '+(i+1),questionIds}));
async function sign(s,d){const expectedPayload=signaturePayload(d);signDemoDocument(s,{id:d.id,signerName:'Pessoa fictícia',strokes:[[{x:0,y:0},{x:1,y:1}]],contentHash:await backupHash(expectedPayload),expectedPayload,confirmed:true});}

test('nove tipos são validados e respostas numéricas normalizadas sem confundir zero com vazio',()=>{
 const s=fresh();template(s,{questions:[q('yn','yesno'),q('yna','yesnona'),q('short'),q('free','long'),q('one','select',{options:['Primeira','Segunda']}),q('num','number'),q('day','date'),q('scale','scale',{min:0,max:10,required:true}),q('phone','phone')],steps:steps(['yn','yna'],['short','free','one'],['num','day','scale','phone'])});const d=prepare(s);
 const clean=checkAnswers(d,{yn:' Sim ',yna:'Não se aplica',short:' Texto ',free:'Linha 1\nLinha 2',one:'Segunda',num:'-1,50',day:'2028-02-29',scale:'0',phone:'+55 (31) 99999-0000'},true);
 assert.equal(clean.num,'-1.5');assert.equal(clean.scale,'0');assert.equal(clean.yna,'Não se aplica');assert.equal(clean.short,'Texto');assert.equal(clean.free,'Linha 1\nLinha 2');assert.equal(clean.phone,'+55 (31) 99999-0000');
});
test('tipos rejeitam respostas fora das escolhas, número não finito, data impossível, telefone e escala inválidos',()=>{
 const s=fresh();template(s,{questions:[q('yn','yesno'),q('yna','yesnona'),q('one','select',{options:['Um','Dois']}),q('num','number'),q('day','date'),q('scale','scale',{min:-2,max:2}),q('phone','phone')]});const d=prepare(s);
 for(const answer of [{yn:'Talvez'},{yna:'N/A'},{one:'Três'},{num:'Infinity'},{num:'1.234,56'},{num:'1e5'},{day:'2026-02-29'},{scale:'3'},{scale:'0.5'},{phone:'31ABC99999'},{phone:'123'},{num:{value:1}}])assert.throws(()=>checkAnswers(d,answer),undefined,JSON.stringify(answer));
});
test('opções e limites de escala são validados antes de publicar sem deixar versão parcial',()=>{
 const s=fresh();template(s);const before=structuredClone(s);
 for(const questions of [[q('a','select',{options:[]})],[q('a','select',{options:['igual','igual']})],[q('a','select',{options:[' espaço ']})],[q('a','scale',{min:5,max:5})],[q('a','scale',{min:0.5,max:5})],[q('a','scale',{min:0,max:Infinity})]]){assert.throws(()=>template(s,{questions}));assert.deepEqual(s,before);}
});
test('condições encadeadas atravessam etapas e removem respostas ocultas sem exigir campo invisível',()=>{
 const s=fresh();template(s,{questions:[q('parent','yesno',{required:true}),q('child','yesnona',{required:true,condition:{questionId:'parent',value:'Sim'}}),q('detail','long',{required:true,condition:{questionId:'child',value:'Não se aplica'}})],steps:steps(['parent'],['child'],['detail'])});const d=prepare(s);
 saveDocumentAnswers(s,{id:d.id,answers:{parent:'Sim',child:'Não se aplica',detail:'Resposta fictícia'}});assert.equal(visibleQuestions(d.snapshot,d.answers).length,3);
 saveDocumentAnswers(s,{id:d.id,answers:{parent:'Não',child:'Não se aplica',detail:'Não deve continuar salvo'}});assert.deepEqual(d.answers,{parent:'Não'});assert.doesNotThrow(()=>checkAnswers(d,d.answers,true));
 assert.throws(()=>checkAnswers(d,{parent:'Sim',child:'Não se aplica'},true),/detail/);
});
test('condição numérica compara resposta normalizada e rejeita condição impossível em nova versão',()=>{
 const s=fresh();template(s,{questions:[q('number','number'),q('detail','text',{condition:{questionId:'number',value:'1,5'}})]});const d=prepare(s);assert.deepEqual(checkAnswers(d,{number:'1.50',detail:'Visível'}),{number:'1.5',detail:'Visível'});
 assert.throws(()=>template(s,{questions:[q('parent','yesno'),q('detail','text',{condition:{questionId:'parent',value:'Talvez'}})]}),/resposta válida/);
});
test('etapas exigem cobertura exata e ordenada; duplicações, referências ausentes e ciclo não entram',()=>{
 const s=fresh(),questions=[q('a'),q('b')];
 for(const value of [steps(['a']),steps(['a','a']),steps(['b','a']),[{id:'same',title:'Um',questionIds:['a']},{id:'same',title:'Dois',questionIds:['b']}],steps(['a','missing'])])assert.throws(()=>template(s,{questions,steps:value}));
 assert.throws(()=>template(s,{questions:[q('a','text',{condition:{questionId:'b',value:'Sim'}}),q('b','text',{condition:{questionId:'a',value:'Sim'}})]}),/anterior/);
 const version=template(s,{questions,steps:steps(['a'],[],['b'])});assert.equal(documentSections(version).length,3);assert.deepEqual(documentSections(version)[2].questions.map(x=>x.id),['b']);
});
test('validador compartilhado é somente leitura e verifica metadados e blocos do mesmo contrato',()=>{
 const s=fresh(),v=template(s,{questions:[q('a')],steps:steps(['a']),blocks:[{id:'b',title:'Bloco fictício',body:'Texto sem conteúdo clínico.'}]}),before=structuredClone(v);
 assert.equal(validateDocumentVersion(v),v);assert.equal(validateDocumentQuestions(v.questions),v.questions);assert.deepEqual(v,before);
 for(const change of [{version:0},{publishedAt:'inexistente'},{editorVersion:3},{blocks:[{id:'b',title:'',body:'Texto'}]},{blocks:[{id:'b',title:'Um',body:''},{id:'b',title:'Dois',body:''}]}])assert.throws(()=>validateDocumentVersion({...v,...change}));
 assert.doesNotThrow(()=>validateDocumentVersion({title:'Rascunho',body:'',questions:[]},{metadata:false}));
});
test('modelo legado mantém shape e hash de documento assinado ao publicar etapas e blocos novos',async()=>{
 const s=fresh(),legacy={version:1,title:'Modelo antigo',body:'Texto legado',questions:[q('old')],publishedAt:'2026-01-01T12:00:00Z'};s.documentTemplates.push({id:'template',kind:'anamnese',title:legacy.title,versions:[structuredClone(legacy)]});const d=prepare(s);saveDocumentAnswers(s,{id:d.id,answers:{old:'Resposta antiga'}});await sign(s,d);const before=structuredClone(d),payload=signaturePayload(d);
 template(s,{expectedVersion:1,questions:[q('new','number')],steps:steps(['new']),blocks:[{id:'new-block',title:'Título novo',body:'Texto novo'}]});
 assert.deepEqual(d,before);assert.equal(signaturePayload(d),payload);assert.deepEqual(s.documentTemplates[0].versions[0],legacy);assert.equal(d.snapshot.editorVersion,undefined);assert.equal(d.snapshot.steps,undefined);assert.equal(d.signature.contentHash,await backupHash(payload));
});
test('nova assinatura inclui blocos/etapas e edição posterior preserva seu snapshot',async()=>{
 const s=fresh();template(s,{questions:[q('a','scale',{min:0,max:5,required:true})],steps:steps(['a']),blocks:[{id:'b',title:'Texto fictício',body:'Versão primeira'}]});const d=prepare(s);saveDocumentAnswers(s,{id:d.id,answers:{a:'2'}});await sign(s,d);const before=structuredClone(d);
 template(s,{expectedVersion:1,questions:[],steps:[],blocks:[{id:'b',title:'Texto fictício',body:'Versão seguinte'}]});assert.deepEqual(d,before);assert.throws(()=>saveDocumentAnswers(s,{id:d.id,answers:{a:'3'}}),/assinado/);
});
test('versão obsoleta não sobrescreve alterações publicadas por outro formulário',()=>{
 const s=fresh();template(s);template(s,{expectedVersion:1,title:'Título revisto'});const before=structuredClone(s);assert.throws(()=>template(s,{expectedVersion:1,title:'Formulário desatualizado'}),/mudou/);assert.deepEqual(s,before);
});
test('edição estrutural preserva campos, reordena perguntas/etapas/blocos e não altera origem',()=>{
 const source={steps:[{id:'s1',title:'Primeira',questions:[q('a'),q('b')]},{id:'s2',title:'Segunda',questions:[q('c')]}],blocks:[{id:'b1',title:'Um',body:'Corpo um'},{id:'b2',title:'Dois',body:'Corpo dois'}]},original=structuredClone(source);
 const questions=changeDocumentStructure(source,{action:'move-question',stepId:'s1',id:'b',direction:'up'});assert.deepEqual(questions.steps[0].questions.map(x=>x.id),['b','a']);
 const moved=changeDocumentStructure(source,{action:'move-step',id:'s2',direction:'up'});assert.equal(moved.steps[0].title,'Segunda');
 const blocks=changeDocumentStructure(source,{action:'move-block',id:'b2',direction:'up'});assert.equal(blocks.blocks[0].body,'Corpo dois');assert.deepEqual(source,original);
});
test('mover ou remover origem de condição é recusado; remover dependente e adicionar itens funciona',()=>{
 const source={steps:[{id:'s1',title:'Primeira',questions:[q('a','yesno')]},{id:'s2',title:'Segunda',questions:[q('b','text',{condition:{questionId:'a',value:'Sim'}})]}],blocks:[]};
 assert.throws(()=>changeDocumentStructure(source,{action:'remove-question',stepId:'s1',id:'a'}),/condição/);assert.throws(()=>changeDocumentStructure(source,{action:'remove-step',id:'s1'}),/condição/);assert.throws(()=>changeDocumentStructure(source,{action:'move-step',id:'s2',direction:'up'}),/condição/);
 const removed=changeDocumentStructure(source,{action:'remove-question',stepId:'s2',id:'b'});assert.equal(removed.steps[1].questions.length,0);const added=changeDocumentStructure(removed,{action:'add-question',stepId:'s2',newId:'new'});assert.equal(added.steps[1].questions[0].id,'new');assert.equal(added.steps[1].questions[0].label,'');
 const step=changeDocumentStructure(added,{action:'add-step',newId:'third'});assert.equal(step.steps[2].questions.length,0);assert.equal(changeDocumentStructure(step,{action:'add-block',newId:'block'}).blocks[0].body,'');
});
test('abrir modelo legado no editor cria agrupamento apenas no rascunho sem alterar o original',()=>{
 const version={title:'Legado',body:'Texto',questions:[q('a')]},before=structuredClone(version),draft=documentEditorDraft(version);assert.equal(draft.steps.length,1);draft.steps[0].questions[0].label='Alterado no editor';assert.deepEqual(version,before);assert.equal(version.steps,undefined);
});
test('HTML dos editores e impressão escapa conteúdo e preserva ordem dos blocos e etapas',()=>{
 const s=fresh();template(s,{body:'<script>alert(1)</script>',questions:[q('a','select',{label:'<img src=x>',options:['<primeira>','Segunda']})],steps:[{id:'s',title:'<Etapa>',questionIds:['a']}],blocks:[{id:'b2',title:'Segundo primeiro',body:'<texto>'},{id:'b1',title:'Primeiro depois',body:'Texto final'}]});const d=prepare(s);saveDocumentAnswers(s,{id:d.id,answers:{a:'<primeira>'}});
 const editor=renderDocumentEditorStructure(documentEditorDraft(d.snapshot)),fields=renderDocumentResponseFields(d),body=documentBody(d,s);
 for(const html of [editor,fields,body]){assert.doesNotMatch(html,/<img src=x>|<script>/);assert.match(html,/&lt;/);}
 assert.ok(body.indexOf('Segundo primeiro')<body.indexOf('Primeiro depois'));assert.match(fields,/data-response-step="0"/);assert.match(editor,/data-doc-edit="add-step"/);assert.match(editor,/Não se aplica|não se aplica/);assert.match(editor,/Telefone/);assert.match(body,/&lt;primeira&gt;/);
});
test('perguntas obrigatórias de todos os novos tipos permitem rascunho e bloqueiam assinatura incompleta',()=>{
 const s=fresh();template(s,{questions:[q('phone','phone',{required:true}),q('select','select',{options:['Um'],required:true}),q('scale','scale',{min:0,max:10,required:true})]});const d=prepare(s);assert.doesNotThrow(()=>saveDocumentAnswers(s,{id:d.id,answers:{}}));assert.throws(()=>checkAnswers(d,d.answers,true),/phone/);assert.throws(()=>checkAnswers(d,{phone:'31999990000',select:'Um'},true),/scale/);
});
test('legado usa regras anteriores de required/condição sem mutar; publicações novas são estritas',()=>{
 const legacy={version:1,title:'Antigo',body:'',publishedAt:'2026-01-01T12:00:00Z',questions:[q('a','yesno',{required:'sim'}),q('b','text',{condition:{questionId:'a',value:'Talvez'}})]};assert.doesNotThrow(()=>validateDocumentVersion(legacy));assert.throws(()=>validateDocumentVersion({...legacy,editorVersion:2}),/perguntas/);
});
test('backup restaura documento assinado com novos tipos, etapas e blocos e rejeita alteração estrutural',async()=>{
 const s=fresh();s.visits.forEach(v=>{v.photos=[];v.maps={};});
 template(s,{questions:[q('yes','yesnona'),q('choice','select',{options:['Um','Dois']}),q('number','number'),q('scale','scale',{min:0,max:10}),q('phone','phone')],steps:steps(['yes','choice'],['number','scale','phone']),blocks:[{id:'block',title:'Bloco de teste',body:'Linha 1\nLinha 2'}]});
 const d=prepare(s);saveDocumentAnswers(s,{id:d.id,answers:{yes:'Não se aplica',choice:'Um',number:'1,5',scale:'0',phone:'31999990000'}});await sign(s,d);
 const backup=await buildBackup({state:s,photos:[]}),restored=await verifyBackup(backup);assert.deepEqual(restored.state.documentResponses[0],d);assert.equal(restored.state.documentTemplates[0].versions[0].blocks[0].body,'Linha 1\nLinha 2');
 const broken=structuredClone(s);broken.documentTemplates[0].versions[0].steps[0].questionIds=['phone'];assert.throws(()=>validateBackupState(broken),/etapas/);
 const altered=structuredClone(backup);altered.state.documentResponses[0].snapshot.blocks[0].body='Texto alterado';altered.stateHash=await backupHash(JSON.stringify(altered.state));await assert.rejects(()=>verifyBackup(altered),/vínculo ou versão/);
});
test('conteúdo de blocos alterado durante coleta de assinatura invalida o payload esperado',async()=>{
 const s=fresh();template(s,{blocks:[{id:'b',title:'Texto fictício',body:'Texto anterior'}]});const d=prepare(s),expectedPayload=signaturePayload(d),contentHash=await backupHash(expectedPayload);d.snapshot.blocks[0].body='Conteúdo posterior';assert.throws(()=>signDemoDocument(s,{id:d.id,signerName:'Teste',strokes:[[{x:0,y:0},{x:1,y:1}]],expectedPayload,contentHash,confirmed:true}),/mudou/);assert.equal(d.status,'rascunho');
});
