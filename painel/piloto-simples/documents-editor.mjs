import {DOCUMENT_QUESTION_TYPES,documentSections,saveTemplate,saveDocumentAnswers,visibleQuestions} from './documents-domain.mjs';
import {isConnected} from './runtime-store.mjs';
import {escapeHTML as e,input,textArea,select,featureDialog,printable} from './feature-ui.mjs';
const kindNames={anamnese:'Anamnese',termo:'Termo',imagem:'Uso de imagem'};
const questionOptions=q=>q?.type==='yesno'?['Sim','Não']:q?.type==='yesnona'?['Sim','Não','Não se aplica']:q?.type==='select'?q.options:null;

export function documentEditorDraft(version){
 const source=version||{questions:[]};return{steps:documentSections(source).map(step=>({id:step.id,title:step.title,questions:structuredClone(step.questions)})),blocks:structuredClone(source.blocks||[])};
}
function dependencyOrder(draft){const seen=new Set();for(const step of draft.steps)for(const q of step.questions){if(q.condition&&!seen.has(q.condition.questionId))throw Error('Ajuste a condição de “'+(q.label||'Pergunta sem título')+'” antes de remover ou mover a pergunta anterior.');seen.add(q.id);}}
/** Pure structural edits keep all typed values and refuse dangling/forward conditions. */
export function changeDocumentStructure(source,{action,id,stepId,direction,newId=crypto.randomUUID()}){
 const draft=structuredClone(source),move=(list,key)=>{const at=list.findIndex(x=>x.id===key),to=at+(direction==='up'?-1:1);if(at>=0&&to>=0&&to<list.length)[list[at],list[to]]=[list[to],list[at]];};
 const step=draft.steps.find(x=>x.id===stepId);
 if(action==='add-step'){if(draft.steps.length>=30)throw Error('Use até 30 etapas.');draft.steps.push({id:newId,title:'Nova etapa',questions:[]});}
 else if(action==='move-step')move(draft.steps,id);
 else if(action==='remove-step')draft.steps=draft.steps.filter(x=>x.id!==id);
 else if(action==='add-question'){if(!step)throw Error('Etapa não encontrada.');if(draft.steps.reduce((n,x)=>n+x.questions.length,0)>=100)throw Error('Use até 100 perguntas.');step.questions.push({id:newId,label:'',type:'text',required:false});}
 else if(action==='move-question'){if(!step)throw Error('Etapa não encontrada.');move(step.questions,id);}
 else if(action==='remove-question'){if(!step)throw Error('Etapa não encontrada.');step.questions=step.questions.filter(x=>x.id!==id);}
 else if(action==='add-block'){if(draft.blocks.length>=50)throw Error('Use até 50 blocos.');draft.blocks.push({id:newId,title:'Novo bloco',body:''});}
 else if(action==='move-block')move(draft.blocks,id);
 else if(action==='remove-block')draft.blocks=draft.blocks.filter(x=>x.id!==id);
 else throw Error('Ação de edição inválida.');
 dependencyOrder(draft);return draft;
}
const editButton=(action,label,{id='',stepId='',direction=''}={})=>`<button type="button" class="subtle" data-doc-edit="${action}" data-id="${e(id)}" data-step-id="${e(stepId)}" data-direction="${direction}">${label}</button>`;
function orderButtons(kind,id,stepId=''){return `<div class="toolbar">${editButton('move-'+kind,'↑ Subir',{id,stepId,direction:'up'})}${editButton('move-'+kind,'↓ Descer',{id,stepId,direction:'down'})}${editButton('remove-'+kind,kind==='step'?'Remover etapa e perguntas':kind==='block'?'Remover bloco':'Remover pergunta',{id,stepId})}</div>`;}
function questionRow(q,previous,stepId){
 const options=questionOptions(previous.find(p=>p.id===q.condition?.questionId));
 const typeConfig=q.type==='select'?textArea('Opções da lista — uma por linha','options-'+q.id,(q.options||[]).join('\n'),'required maxlength="10500"'):q.type==='scale'?`<div class="field-grid">${input('Mínimo da escala','min-'+q.id,q.min??0,'number','required step="1" min="-1000000" max="1000000"')}${input('Máximo da escala','max-'+q.id,q.max??10,'number','required step="1" min="-1000000" max="1000000"')}</div>`:'';
 return `<div class="question-editor" data-question="${e(q.id)}"><div class="field-grid">${input('Pergunta','label-'+q.id,q.label,'text','required maxlength="300"')}${select('Tipo de resposta','type-'+q.id,DOCUMENT_QUESTION_TYPES,q.type)}</div>${typeConfig}<label class="checkline"><input type="checkbox" name="required-${e(q.id)}" ${q.required?'checked':''}> Resposta obrigatória para assinar</label><div class="field-grid">${select('Mostrar esta pergunta quando','condition-'+q.id,[['','Sempre visível'],...previous.map(p=>[p.id,p.label||'Pergunta sem título'])],q.condition?.questionId||'')}${options?select('Resposta que ativa a pergunta','equals-'+q.id,[['','Selecione'],...options.map(v=>[v,v])],q.condition?.value||''):input('Resposta que ativa a pergunta','equals-'+q.id,q.condition?.value||'','text','maxlength="200"')}</div>${orderButtons('question',q.id,stepId)}</div>`;
}
export function renderDocumentEditorStructure(draft){
 const previous=[];return `<section class="docs-editor-section"><div class="card-header"><div><h3>Etapas e perguntas</h3><p>Organize a anamnese em etapas. Em termos, as perguntas são opcionais.</p></div>${editButton('add-step','Adicionar etapa')}</div><div data-doc-steps>${draft.steps.map((step,i)=>`<fieldset class="docs-step" data-doc-step="${e(step.id)}"><legend>Etapa ${i+1}</legend>${input('Título da etapa','step-title-'+step.id,step.title,'text','required maxlength="160"')}${orderButtons('step',step.id)}<div data-step-questions>${step.questions.map(q=>{const html=questionRow(q,previous,step.id);previous.push(q);return html;}).join('')}</div>${editButton('add-question','Adicionar pergunta',{stepId:step.id})}</fieldset>`).join('')||'<p>Sem etapas. Adicione uma para incluir perguntas.</p>'}</div></section><section class="docs-editor-section"><div class="card-header"><div><h3>Blocos de texto</h3><p>Títulos e textos revisados pela profissional, na ordem desejada.</p></div>${editButton('add-block','Adicionar bloco')}</div><div data-doc-blocks>${draft.blocks.map((block,i)=>`<fieldset class="docs-block" data-doc-block="${e(block.id)}"><legend>Bloco ${i+1}</legend>${input('Título do bloco','block-title-'+block.id,block.title,'text','required maxlength="160"')}${textArea('Texto do bloco','block-body-'+block.id,block.body,'maxlength="30000"')}${orderButtons('block',block.id)}</fieldset>`).join('')||'<p>Sem blocos adicionais. O texto introdutório será preservado.</p>'}</div></section>`;
}
function collectStructure(modal){
 const f=new FormData(modal.querySelector('form'));
 const steps=[...modal.querySelectorAll('[data-doc-step]')].map(step=>({id:step.dataset.docStep,title:f.get('step-title-'+step.dataset.docStep),questions:[...step.querySelectorAll('[data-question]')].map(row=>{const id=row.dataset.question,type=f.get('type-'+id),condition=f.get('condition-'+id);return{id,label:f.get('label-'+id),type,required:f.get('required-'+id)==='on',...(type==='select'?{options:String(f.get('options-'+id)||'').split(/\r?\n/).map(v=>v.trim()).filter(Boolean)}:{}),...(type==='scale'?{min:f.has('min-'+id)?Number(f.get('min-'+id)):0,max:f.has('max-'+id)?Number(f.get('max-'+id)):10}:{}),...(condition?{condition:{questionId:condition,value:f.get('equals-'+id)||''}}:{})};})}));
 const blocks=[...modal.querySelectorAll('[data-doc-block]')].map(row=>({id:row.dataset.docBlock,title:f.get('block-title-'+row.dataset.docBlock),body:f.get('block-body-'+row.dataset.docBlock)}));return{steps,blocks};
}
export function templateEditor(s,id,save,{preset}={}){
 const model=s.documentTemplates.find(t=>t.id===id),version=model?.versions.at(-1)||preset,modelId=model?.id||preset?.id||crypto.randomUUID(),expectedVersion=version?.version||0;
 const dialog=featureDialog({title:model?'Publicar nova versão':'Criar modelo',wide:true,html:input('Nome do modelo','title',model?.title||preset?.title||'','text','required maxlength="120"')+select('Tipo de documento','kind',Object.entries(kindNames),model?.kind||preset?.kind||'anamnese')+textArea('Introdução / texto existente revisado pela profissional','body',version?.body||'','maxlength="30000"')+'<p class="small-label">As versões e os documentos anteriores permanecem intactos. '+(isConnected()?'Revise o conteúdo com a profissional antes de usar o modelo.':'Este editor prepara modelos para demonstração local; o conteúdo deve ser revisado pela profissional.')+'</p><div data-doc-structure>'+renderDocumentEditorStructure(documentEditorDraft(version))+'</div>',onSubmit:(f,modal)=>{const draft=collectStructure(modal);return save(state=>saveTemplate(state,{id:modelId,expectedVersion,title:f.get('title'),kind:model?.kind||f.get('kind'),body:f.get('body'),questions:draft.steps.flatMap(step=>step.questions),steps:draft.steps.map(({id,title,questions})=>({id,title,questionIds:questions.map(q=>q.id)})),blocks:draft.blocks}));}});
 if(model)dialog.querySelector('[name=kind]').disabled=true;
 const showError=message=>dialog.querySelector('.error').textContent=message;
 const draw=draft=>{dialog.querySelector('[data-doc-structure]').innerHTML=renderDocumentEditorStructure(draft);dialog.querySelector('form').dataset.unsaved='true';};
 dialog.addEventListener('click',event=>{const b=event.target.closest('[data-doc-edit]');if(!b)return;try{draw(changeDocumentStructure(collectStructure(dialog),{action:b.dataset.docEdit,id:b.dataset.id,stepId:b.dataset.stepId,direction:b.dataset.direction}));showError('');}catch(error){showError(error.message);}});
 dialog.addEventListener('change',event=>{const name=event.target.name||'';if(name.startsWith('type-')||name.startsWith('condition-')){const draft=collectStructure(dialog);draw(draft);dialog.querySelector(`[name="${name}"]`)?.focus();}});
 return dialog;
}

function answerField(q,value){
 const label=q.label+(q.required?' · obrigatória':''),name='answer-'+q.id,options=questionOptions(q);let field;
 if(options)field=select(label,name,[['','Selecione'],...options.map(v=>[v,v])],value);
 else if(q.type==='long')field=textArea(label,name,value,'maxlength="10000"');
 else if(q.type==='scale')field=input(label,name,value,'number',`step="1" min="${q.min}" max="${q.max}"`)+`<small class="small-label">Inteiro entre ${q.min} e ${q.max}.</small>`;
 else field=input(label,name,value,q.type==='date'?'date':q.type==='phone'?'tel':'text',q.type==='number'?'inputmode="decimal" maxlength="100"':q.type==='phone'?'autocomplete="tel" maxlength="40"':'maxlength="10000"');
 return `<div data-answer="${e(q.id)}">${field}</div>`;
}
export function renderDocumentText(snapshot){return `${snapshot.body?`<pre class="model-preview">${e(snapshot.body)}</pre>`:''}${(snapshot.blocks||[]).map(block=>`<section class="docs-text-block"><h3>${e(block.title)}</h3><pre class="model-preview">${e(block.body)}</pre></section>`).join('')}`;}
export function renderDocumentResponseFields(d){return documentSections(d.snapshot).map((step,i)=>`<fieldset class="docs-response-step" data-response-step="${i}"><legend>${e(step.title)}</legend>${step.questions.map(q=>answerField(q,d.answers[q.id]??'')).join('')}<p class="small-label" data-empty-step hidden>Nenhuma pergunta visível nesta etapa.</p></fieldset>`).join('');}
export function documentBody(d,s){
 const visible=new Set(visibleQuestions(d.snapshot,d.answers).map(q=>q.id));
 return `<p><strong>${e(s.patients.find(p=>p.id===d.patientId)?.name)}</strong> · versão ${d.templateVersion}</p>${renderDocumentText(d.snapshot)}${documentSections(d.snapshot).map(step=>{const questions=step.questions.filter(q=>visible.has(q.id));return questions.length?`<section><h3>${e(step.title)}</h3>${questions.map(q=>`<p><strong>${e(q.label)}</strong><br>${e(d.answers[q.id]||'Não respondida')}</p>`).join('')}</section>`:'';}).join('')}${d.imageUse?`<p>Finalidade escolhida: ${e({tratamento:'Somente tratamento',publicacao:isConnected()&&d.status==='rascunho'?'Publicação solicitada em rascunho':'Publicação autorizada no teste',nao_autorizado:'Não autorizada'}[d.imageUse])}</p>`:''}${d.signature?`<svg viewBox="0 0 1000 360" role="img" aria-label="Traço da assinatura de demonstração" style="max-width:500px;border:1px solid #ddd">${d.signature.strokes.map(stroke=>`<polyline points="${stroke.map(p=>`${Number(p.x)*1000},${Number(p.y)*360}`).join(' ')}" fill="none" stroke="#28232b" stroke-width="3"/>`).join('')}</svg><p>Assinatura de demonstração: ${e(d.signature.signerName)} · ${e(d.signature.signedAt)}</p><p>SHA-256 do conteúdo: ${e(d.signature.contentHash)}</p>`:''}`;
}
export function responseEditor(d,s,save){
 if(d.status!=='rascunho')return printable(d.title,documentBody(d,s));const steps=documentSections(d.snapshot);let current=0;
 const modal=featureDialog({title:d.title,wide:true,html:renderDocumentText(d.snapshot)+`<nav class="docs-step-nav" aria-label="Etapas do documento">${steps.map((step,i)=>`<button type="button" class="secondary" data-response-go="${i}">${i+1}. ${e(step.title)}</button>`).join('')}</nav>`+renderDocumentResponseFields(d)+(steps.length>1?'<div class="docs-step-actions"><button type="button" class="secondary" data-response-prev>← Etapa anterior</button><p class="small-label" aria-live="polite" data-step-status></p><button type="button" class="secondary" data-response-next>Próxima etapa →</button></div>':'')+(d.kind==='imagem'?select('Uso da imagem','imageUse',[['tratamento','Somente tratamento'],['nao_autorizado','Não autorizo'],['publicacao',isConnected()?'Publicação (preferência em rascunho)':'Autorizo publicação — teste']],d.imageUse||'tratamento'):'')+'<p class="small-label">Você pode salvar o rascunho incompleto. '+(isConnected()?'A assinatura clínica é realizada pelo fluxo oficial.':'Perguntas obrigatórias serão conferidas antes da assinatura de demonstração.')+'</p>',onSubmit:f=>save(state=>saveDocumentAnswers(state,{id:d.id,answers:Object.fromEntries(d.snapshot.questions.map(q=>[q.id,f.get('answer-'+q.id)||''])),imageUse:f.get('imageUse')}))});
 // Hidden wizard pages must not trap native validation; domain errors name the question.
 modal.querySelector('form').noValidate=true;
 const update=()=>{
  const f=new FormData(modal.querySelector('form')),answers=Object.fromEntries(d.snapshot.questions.map(q=>[q.id,f.get('answer-'+q.id)||''])),visible=new Set(visibleQuestions(d.snapshot,answers).map(q=>q.id));
  modal.querySelectorAll('[data-answer]').forEach(row=>{const shown=visible.has(row.dataset.answer);row.hidden=!shown;row.querySelectorAll('input,select,textarea').forEach(field=>{field.disabled=!shown;if(!shown)field.value='';});});
  modal.querySelectorAll('[data-response-step]').forEach((row,i)=>{row.hidden=i!==current;row.querySelector('[data-empty-step]').hidden=[...row.querySelectorAll('[data-answer]')].some(q=>!q.hidden);});
  modal.querySelectorAll('[data-response-go]').forEach((b,i)=>b.setAttribute('aria-current',i===current?'step':'false'));
  const prev=modal.querySelector('[data-response-prev]'),next=modal.querySelector('[data-response-next]'),status=modal.querySelector('[data-step-status]');if(prev)prev.disabled=current===0;if(next)next.disabled=current>=steps.length-1;if(status)status.textContent=`Etapa ${current+1} de ${steps.length}`;
 };
 modal.addEventListener('click',event=>{const target=event.target.closest('[data-response-go],[data-response-prev],[data-response-next]');if(!target)return;if(target.hasAttribute('data-response-go'))current=Number(target.dataset.responseGo);else current+=target.hasAttribute('data-response-prev')?-1:1;current=Math.max(0,Math.min(steps.length-1,current));update();modal.querySelector(`[data-response-step="${current}"] input,[data-response-step="${current}"] select,[data-response-step="${current}"] textarea`)?.focus();});
 modal.addEventListener('input',update);modal.addEventListener('change',update);update();return modal;
}
