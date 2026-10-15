export function ensureDocuments(s){for(const key of ['documentTemplates','documentResponses','documentHistory']){s[key]??=[];if(!Array.isArray(s[key]))throw Error('Coleção de documentos incompatível: '+key);}return s;}
const text=(v,max)=>typeof v==='string'&&v.trim()&&v.length<=max;
const validId=id=>typeof id==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,179}$/.test(id)&&!['constructor','prototype','__proto__'].includes(id);
const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(+new Date(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export const DOCUMENT_QUESTION_TYPES=Object.freeze([['yesno','Sim / não'],['yesnona','Sim / não / não se aplica'],['text','Resposta curta'],['long','Resposta livre'],['select','Escolha da lista'],['number','Número'],['date','Data'],['scale','Escala'],['phone','Telefone']].map(Object.freeze));
const choices=q=>q.type==='yesno'?['Sim','Não']:q.type==='yesnona'?['Sim','Não','Não se aplica']:q.type==='select'?q.options:null;
function answerValue(q,raw){
 if(raw!==undefined&&raw!==null&&!['string','number'].includes(typeof raw))throw Error('Resposta inválida: '+q.label);
 let value=String(raw??'').trim();if(value.length>10000)throw Error('Resposta muito longa: '+q.label);if(!value)return '';
 const options=choices(q);if(options&&!options.includes(value))throw Error('Escolha uma resposta válida: '+q.label);
 if(q.type==='date'&&!validDate(value))throw Error('Data inválida na resposta: '+q.label);
 if(q.type==='number'||q.type==='scale'){
  if(!/^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(value)||!Number.isFinite(Number(value.replace(',','.')))||Math.abs(Number(value.replace(',','.')))>Number.MAX_SAFE_INTEGER)throw Error('Número inválido: '+q.label);
  const number=Number(value.replace(',','.'));if(q.type==='scale'&&(!Number.isInteger(number)||number<q.min||number>q.max))throw Error(`Responda ${q.label} com um inteiro entre ${q.min} e ${q.max}.`);value=String(number);
 }
 if(q.type==='phone'&&(!/^\+?[\d\s().-]+$/.test(value)||value.length>40||value.replace(/\D/g,'').length<7||value.replace(/\D/g,'').length>15))throw Error('Telefone inválido: '+q.label);
 return value;
}
/** Shared read-only validators: the backup importer must use these same rules. */
export function validateDocumentQuestions(questions,{legacy=false}={}){
 if(!Array.isArray(questions)||questions.length>100)throw Error('Use até 100 perguntas por modelo.');const seen=new Map();
 for(const q of questions){
  if(!plain(q)||!validId(q.id)||q.id.length>80||seen.has(q.id)||!text(q.label,300)||!DOCUMENT_QUESTION_TYPES.some(([type])=>type===q.type)||!legacy&&q.required!==undefined&&typeof q.required!=='boolean')throw Error('Confira as perguntas do modelo.');
  if(q.type==='select'&&(!Array.isArray(q.options)||q.options.length<1||q.options.length>50||q.options.some(v=>!text(v,200)||v!==v.trim())||new Set(q.options).size!==q.options.length))throw Error('A lista precisa de 1 a 50 opções diferentes, sem espaços nas pontas.');
  if(q.type==='scale'&&(!Number.isSafeInteger(q.min)||!Number.isSafeInteger(q.max)||Math.abs(q.min)>1000000||Math.abs(q.max)>1000000||q.min>=q.max))throw Error('Informe mínimo e máximo inteiros para a escala, com mínimo menor que máximo.');
  if(q.condition){if(!plain(q.condition)||!seen.has(q.condition.questionId)||!text(q.condition.value,200)||q.condition.value!==q.condition.value.trim())throw Error('A condição deve usar uma pergunta anterior e uma resposta sem espaços nas pontas.');if(!legacy)answerValue(seen.get(q.condition.questionId),q.condition.value);}
  seen.set(q.id,q);
 }
 return questions;
}
export function validateDocumentVersion(version,{metadata=true}={}){
 if(!plain(version)||!text(version.title,120)||typeof version.body!=='string'||version.body.length>30000)throw Error('Confira nome e conteúdo do modelo.');
 if(metadata&&(!Number.isSafeInteger(version.version)||version.version<1||typeof version.publishedAt!=='string'||!Number.isFinite(Date.parse(version.publishedAt))))throw Error('Versão de documento inválida.');
 if(version.editorVersion!==undefined&&version.editorVersion!==2)throw Error('Formato do editor de documentos incompatível.');
 validateDocumentQuestions(version.questions,{legacy:version.editorVersion===undefined});
 if(version.steps!==undefined){
  if(!Array.isArray(version.steps)||version.steps.length>30)throw Error('Use até 30 etapas no modelo.');const ids=new Set(),questionIds=[];
  for(const step of version.steps){if(!plain(step)||!validId(step.id)||ids.has(step.id)||!text(step.title,160)||!Array.isArray(step.questionIds))throw Error('Confira os títulos e identificadores das etapas.');ids.add(step.id);questionIds.push(...step.questionIds);}
  if(questionIds.length!==version.questions.length||questionIds.some((id,i)=>id!==version.questions[i].id))throw Error('As etapas precisam conter cada pergunta uma vez, na mesma ordem do modelo.');
 }
 if(version.blocks!==undefined){
  if(!Array.isArray(version.blocks)||version.blocks.length>50)throw Error('Use até 50 blocos no modelo.');const ids=new Set();let total=version.body.length;
  for(const block of version.blocks){if(!plain(block)||!validId(block.id)||ids.has(block.id)||!text(block.title,160)||typeof block.body!=='string'||block.body.length>30000)throw Error('Confira o título e texto dos blocos.');ids.add(block.id);total+=block.body.length;}
  if(total>100000)throw Error('O conteúdo dos blocos excede 100 mil caracteres.');
 }
 return version;
}
export function documentSections(snapshot){
 return snapshot.steps?snapshot.steps.map(step=>({...step,questions:step.questionIds.map(id=>snapshot.questions.find(q=>q.id===id))})): [{id:'legacy-questions',title:'Perguntas',questionIds:snapshot.questions.map(q=>q.id),questions:snapshot.questions}];
}
export function saveTemplate(s,template){
 ensureDocuments(s);if(!validId(template.id)||!['anamnese','termo','imagem'].includes(template.kind))throw Error('Confira nome, tipo e conteúdo do modelo.');
 const current=s.documentTemplates.find(t=>t.id===template.id);if(current&&current.kind!==template.kind)throw Error('O tipo do modelo não pode mudar; crie outro modelo.');
 if(template.expectedVersion!==undefined&&template.expectedVersion!==(current?.versions.at(-1)?.version||0))throw Error('O modelo mudou. Reabra a versão atual antes de publicar.');
 const version={version:(current?.versions.at(-1)?.version||0)+1,editorVersion:2,title:typeof template.title==='string'?template.title.trim():template.title,body:template.body,questions:structuredClone(template.questions||[]),...(template.steps!==undefined?{steps:structuredClone(template.steps)}:{}),...(template.blocks!==undefined?{blocks:structuredClone(template.blocks)}:{}),publishedAt:new Date().toISOString()};validateDocumentVersion(version);
 if(current){current.title=version.title;current.versions.push(version);}else s.documentTemplates.push({id:template.id,kind:template.kind,title:version.title,versions:[version]});s.documentHistory.push({id:crypto.randomUUID(),at:version.publishedAt,action:'modelo_publicado',templateId:template.id,version:version.version});return version;
}
export function prepareDocument(s,{id,templateId,patientId,visitId}){ensureDocuments(s);const template=s.documentTemplates.find(t=>t.id===templateId),visit=s.visits.find(v=>v.id===visitId&&v.patientId===patientId);if(!validId(id)||s.documentResponses.some(r=>r.id===id))throw Error('Identificador de documento inválido ou repetido.');if(!template||!visit||!s.patients.some(p=>p.id===patientId))throw Error('Selecione modelo, paciente e consulta válidos.');if(visit.status==='concluido'||visit.lockedAt||visit.status==='cancelado')throw Error('A consulta foi concluída ou cancelada. Preserve os documentos e use um novo atendimento.');if(s.documentResponses.some(r=>r.visitId===visitId&&r.templateId===templateId&&r.status==='rascunho'))throw Error('Já existe um rascunho deste modelo na consulta.');const snapshot=structuredClone(template.versions.at(-1)),record={id,templateId,templateVersion:snapshot.version,patientId,visitId,kind:template.kind,title:snapshot.title,snapshot,answers:{},status:'rascunho',createdAt:new Date().toISOString()};s.documentResponses.push(record);return record;}
export function visibleQuestions(snapshot,answers){const visible=[];for(const q of snapshot.questions){let matches=!q.condition;if(q.condition){const parent=visible.find(p=>p.id===q.condition.questionId);if(parent){try{matches=answerValue(parent,answers[q.condition.questionId])===answerValue(parent,q.condition.value);}catch{matches=false;}}}if(matches)visible.push(q);}return visible;}
export function checkAnswers(record,answers,complete=false){if(!plain(answers))throw Error('Respostas inválidas.');const clean={};for(const q of visibleQuestions(record.snapshot,answers)){const value=answerValue(q,answers[q.id]);if(complete&&q.required&&!value)throw Error('Responda: '+q.label);clean[q.id]=value;}return clean;}
function editableDocumentVisit(s,d){const visit=s.visits.find(v=>v.id===d.visitId&&v.patientId===d.patientId);if(!visit)throw Error('Vínculo do documento com a consulta está inválido.');if(visit.status==='concluido'||visit.lockedAt||visit.status==='cancelado')throw Error('Consulta concluída ou cancelada não permite reescrever documento.');return visit;}
export function saveDocumentAnswers(s,{id,answers,imageUse}){ensureDocuments(s);const d=s.documentResponses.find(x=>x.id===id);if(!d||d.status!=='rascunho')throw Error('O documento está indisponível ou já foi assinado.');editableDocumentVisit(s,d);const clean=checkAnswers(d,answers);if(d.kind==='imagem'&&!['tratamento','publicacao','nao_autorizado'].includes(imageUse))throw Error('Escolha a finalidade de imagem.');d.answers=clean;if(d.kind==='imagem')d.imageUse=imageUse;d.updatedAt=new Date().toISOString();return d;}
export function signaturePayload(record){return JSON.stringify({id:record.id,patientId:record.patientId,visitId:record.visitId,templateId:record.templateId,templateVersion:record.templateVersion,snapshot:record.snapshot,answers:record.answers,imageUse:record.imageUse||null});}
export function signDemoDocument(s,{id,signerName,strokes,contentHash,confirmed,expectedPayload}){ensureDocuments(s);const d=s.documentResponses.find(x=>x.id===id);if(!d||d.status!=='rascunho')throw Error('Documento indisponível ou já assinado.');editableDocumentVisit(s,d);checkAnswers(d,d.answers,true);if(expectedPayload!==undefined&&signaturePayload(d)!==expectedPayload)throw Error('O documento mudou. Confira a versão antes de assinar.');if(!confirmed||!text(signerName,160)||!Array.isArray(strokes)||!strokes.some(line=>Array.isArray(line)&&line.length>=2)||strokes.length>200||!strokes.every(line=>Array.isArray(line)&&line.length<=5000&&line.every(p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1)))throw Error('Confirme o teste, informe o nome e desenhe a assinatura.');if(!/^[a-f0-9]{64}$/.test(contentHash))throw Error('Não foi possível verificar o conteúdo.');if(d.kind==='imagem'&&!['tratamento','publicacao','nao_autorizado'].includes(d.imageUse))throw Error('Escolha a finalidade de uso da imagem.');d.status='assinado_demo';d.signature={signerName:signerName.trim(),strokes:structuredClone(strokes),contentHash,signedAt:new Date().toISOString(),mode:'demonstracao_sem_validade'};s.documentHistory.push({id:crypto.randomUUID(),at:d.signature.signedAt,action:'assinatura_demo',documentId:d.id,contentHash});return d;}
export function documentsSatisfied(s,visit,requiredIds){return requiredIds.every(id=>(s.documentResponses||[]).some(d=>d.templateId===id&&d.visitId===visit.id&&d.patientId===visit.patientId&&d.status==='assinado_demo'));}
// Declarações de demonstração nunca autorizam publicação operacional de imagens.
export function imagePublicationAllowed(){return false;}
