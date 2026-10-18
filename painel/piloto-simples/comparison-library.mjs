import {openRecycleConfirmation} from './recycle-ui.mjs';
import {comparisonPhotos,comparisonSelection,resolveComparison,mountComparison} from './compare.mjs';
import {escapeHTML as e,input,textArea,featureDialog} from './feature-ui.mjs';

const validId=id=>typeof id==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,179}$/.test(id)&&!['constructor','prototype','__proto__'].includes(id);
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(+new Date(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
const timestamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const dateLabel=value=>value?String(value).split('-').reverse().join('/'):'Pendente';
const text=(value,max,required=false)=>typeof value==='string'&&value.length<=max&&(!required||value.trim().length>0);
const snapshotOf=record=>{const {history,...snapshot}=structuredClone(record);return snapshot;};
const versionOf=record=>record.schemaVersion===1?1:record.version;
function ensure(s){s.comparisons??=[];if(!Array.isArray(s.comparisons))throw Error('Biblioteca de comparações inválida.');return s.comparisons;}

function validateSelectionData(state,record){
 if(!validId(record.id)||!validId(record.patientId)||!text(record.title,120,true)||!text(record.area,120)||!text(record.notes,5000)||!validDate(record.beforeDate)||record.afterDate!==''&&!validDate(record.afterDate)||record.afterDate&&record.afterDate<record.beforeDate)throw Error('Confira título, área, observações e datas da comparação.');
 const photos=comparisonPhotos(state,record.patientId),refs=new Map(photos.map(p=>[p.key,p])),all=[];
 for(const side of ['beforePhotos','afterPhotos']){const list=record[side];if(!Array.isArray(list)||list.length>10||side==='beforePhotos'&&list.length===0||list.some(key=>typeof key!=='string'||!refs.has(key)))throw Error('Selecione de 1 a 10 fotos de Antes e até 10 de Depois, todas desta paciente.');all.push(...list.map(key=>refs.get(key)));}
 const keys=new Set(),photoIds=new Set(),hashes=new Set();for(const ref of all){const hash=typeof ref.photo.sha256==='string'?ref.photo.sha256.toLowerCase():'';if(keys.has(ref.key)||photoIds.has(ref.photo.id)||hash&&hashes.has(hash))throw Error('Não repita a mesma fotografia ou o mesmo arquivo original na comparação.');keys.add(ref.key);photoIds.add(ref.photo.id);if(hash)hashes.add(hash);}
 if(!record.beforePhotos.includes(record.before)||record.afterPhotos.length&&!record.afterPhotos.includes(record.after)||!record.afterPhotos.length&&record.after!=='')throw Error('Escolha uma foto principal de cada grupo.');
 if(!['side','slide'].includes(record.mode)||!['png','jpeg'].includes(record.format)||!Number.isFinite(record.split)||record.split<0||record.split>100)throw Error('Confira modo, divisor e formato da comparação.');
 for(const ref of all)if(!validDate(ref.date))throw Error('A consulta da fotografia precisa ter data válida.');
 if(record.after){resolveComparison(state,record.patientId,record.before,record.after);const latestBefore=record.beforePhotos.map(key=>refs.get(key).date).sort().at(-1),firstAfter=record.afterPhotos.map(key=>refs.get(key).date).sort()[0];if(latestBefore>firstAfter)throw Error('As consultas do Depois devem ser da mesma data ou posteriores às consultas do Antes.');}
 return record;
}
function validateSnapshot(state,record){
 if(!plain(record)||!validId(record.id)||!timestamp(record.savedAt))throw Error('Registro de comparação inválido.');
 if(record.schemaVersion===1){if(Object.hasOwn(record,'history'))throw Error('Histórico não permitido na versão legada.');comparisonSelection(state,record.patientId,record);return record;}
 if(record.schemaVersion!==2||Date.parse(record.updatedAt)<Date.parse(record.savedAt)||!Number.isSafeInteger(record.version)||record.version<1||record.version>501||!timestamp(record.updatedAt)||!['ativo','excluido'].includes(record.status))throw Error('Versão da comparação inválida.');
 validateSelectionData(state,record);
 if(record.operationId!==undefined&&(!validId(record.operationId)||!text(record.operationFingerprint,30000,true)))throw Error('Operação da comparação inválida.');
 if(record.status==='excluido'&&(!timestamp(record.deletedAt)||!text(record.deleteReason,300,true)||record.deleteReason.trim().length<5))throw Error('Exclusão de comparação sem motivo ou data.');
 return record;
}
/** Shared, read-only backup validator, including every historical photo reference. */
export function validateComparisonRecord(state,record){
 validateSnapshot(state,record);if(record.schemaVersion===1)return record;
 if(!Array.isArray(record.history)||record.history.length!==record.version-1||record.history.length>500)throw Error('Histórico de versões da comparação incompleto.');
 const operations=new Set(record.operationId?[record.operationId]:[]);
 record.history.forEach((entry,i)=>{if(!plain(entry)||entry.version!==i+1||!timestamp(entry.at)||!['editado','excluido'].includes(entry.action)||!text(entry.reason||'',300)||!plain(entry.snapshot)||Object.hasOwn(entry.snapshot,'history')||entry.snapshot.id!==record.id||entry.snapshot.patientId!==record.patientId||entry.snapshot.savedAt!==record.savedAt||entry.snapshot.status==='excluido'||Date.parse(entry.at)>Date.parse(record.updatedAt)||Date.parse(entry.at)<Date.parse(entry.snapshot.updatedAt||entry.snapshot.savedAt)||versionOf(entry.snapshot)!==entry.version)throw Error('Histórico de comparação incompatível.');validateSnapshot(state,entry.snapshot);if(entry.snapshot.operationId){if(operations.has(entry.snapshot.operationId))throw Error('Operação repetida no histórico da comparação.');operations.add(entry.snapshot.operationId);}});
 return record;
}

export function comparisonRecordDraft(state,patientId,record){
 if(!record)return{id:crypto.randomUUID(),patientId,title:'',area:'',notes:'',beforeDate:'',afterDate:'',beforePhotos:[],afterPhotos:[],before:'',after:'',mode:'side',split:50,format:'png'};
 if(record.patientId!==patientId)throw Error('Esta comparação pertence a outra paciente.');
 if(record.schemaVersion===1){const pair=resolveComparison(state,patientId,record.before,record.after);return{id:record.id,patientId,title:'Comparação de '+dateLabel(pair.before.date)+' a '+dateLabel(pair.after.date),area:'',notes:'',beforeDate:pair.before.date,afterDate:pair.after.date,beforePhotos:[record.before],afterPhotos:[record.after],before:record.before,after:record.after,mode:record.mode||'side',split:record.split??50,format:record.format||'png'};}
 const {id,title,area,notes,beforeDate,afterDate,beforePhotos,afterPhotos,before,after,mode,split,format}=record;return structuredClone({id,patientId,title,area,notes,beforeDate,afterDate,beforePhotos,afterPhotos,before,after,mode,split,format});
}
function operation(records,operationId,fingerprint){
 if(!validId(operationId))throw Error('Identificador da operação inválido.');
 for(const record of records)for(const snapshot of [record,...(record.history||[]).map(h=>h.snapshot)])if(snapshot.operationId===operationId){if(snapshot.operationFingerprint!==fingerprint)throw Error('Esta operação já foi usada com outros dados.');return record;}return null;
}
export function saveComparisonRecord(state,input,{expectedVersion=0,operationId,now=new Date().toISOString()}={}){
 const records=ensure(state),value=comparisonRecordDraft(state,input.patientId,{...input,schemaVersion:2});validateSelectionData(state,value);if(!timestamp(now))throw Error('Data de gravação inválida.');
 const fingerprint=JSON.stringify(['save',expectedVersion,value]),repeated=operation(records,operationId,fingerprint);if(repeated)return repeated;
 const current=records.find(c=>c.id===value.id);if(current?.patientId!==undefined&&current.patientId!==value.patientId)throw Error('A comparação pertence a outra paciente.');if(current&&current.status==='excluido')throw Error('Comparação excluída não pode ser reescrita.');if(expectedVersion!==(current?versionOf(current):0))throw Error('A comparação mudou. Reabra a versão atual antes de salvar.');if(current)validateComparisonRecord(state,current);
 const history=current?[...(current.history||[]),{version:versionOf(current),at:now,action:'editado',reason:'Nova versão salva',snapshot:snapshotOf(current)}]:[];
 const record={...value,schemaVersion:2,version:(current?versionOf(current):0)+1,status:'ativo',savedAt:current?.savedAt||now,updatedAt:now,operationId,operationFingerprint:fingerprint,history};validateComparisonRecord(state,record);
 if(current)records[records.indexOf(current)]=record;else records.push(record);return record;
}
export function deleteComparisonRecord(state,{id,patientId,expectedVersion,reason,operationId,now=new Date().toISOString()}){
 const records=ensure(state);if(!text(reason,300,true)||reason.trim().length<5||!timestamp(now))throw Error('Informe o motivo da exclusão (5 a 300 caracteres).');
 const why=reason.trim(),fingerprint=JSON.stringify(['delete',id,patientId,expectedVersion,why]),repeated=operation(records,operationId,fingerprint);if(repeated)return repeated;
 const current=records.find(c=>c.id===id&&c.patientId===patientId);if(!current||current.status==='excluido')throw Error('Comparação indisponível ou já excluída.');validateComparisonRecord(state,current);if(expectedVersion!==versionOf(current))throw Error('A comparação mudou. Reabra a versão atual antes de excluir.');
 const record={...comparisonRecordDraft(state,patientId,current),schemaVersion:2,version:versionOf(current)+1,status:'excluido',savedAt:current.savedAt,updatedAt:now,deletedAt:now,deleteReason:why,operationId,operationFingerprint:fingerprint,history:[...(current.history||[]),{version:versionOf(current),at:now,action:'excluido',reason:why,snapshot:snapshotOf(current)}]};validateComparisonRecord(state,record);records[records.indexOf(current)]=record;return record;
}

import {mountSavedComparisonPreview} from './comparison-preview.mjs';

export function renderComparisonLibrary(state,{patientId,readonly=false,includeDeleted=false}={}){
 const records=(state.comparisons||[]).filter(c=>c.patientId===patientId&&(includeDeleted||c.status!=='excluido')).sort((a,b)=>(b.updatedAt||b.savedAt).localeCompare(a.updatedAt||a.savedAt));
 return `<section class="comparison-library"><div class="comparison-library-heading"><div><h2>Comparações registradas</h2><p>Comparações visuais manuais com fotos já existentes no prontuário desta paciente.</p></div><button class="primary" type="button" data-library="new" ${readonly?'disabled':''}>Nova comparação</button></div><label class="comparison-library-archive"><input type="checkbox" data-library-archive ${includeDeleted?'checked':''}> Mostrar comparações excluídas do uso atual</label><div class="comparison-library-list">${records.map(record=>{const draft=comparisonRecordDraft(state,patientId,record),deleted=record.status==='excluido';return `<article class="comparison-library-card"><div><span class="badge ${deleted?'':draft.after?'rose':'gold'}">${deleted?'Excluída':draft.after?'Par completo':'Aguardando Depois'}</span><h3>${e(draft.title)}</h3><p>${e(draft.area||'Área não informada')} · versão ${versionOf(record)}</p><p>Antes: ${e(dateLabel(draft.beforeDate))} · Depois: ${e(dateLabel(draft.afterDate))}</p><small>${draft.beforePhotos.length} foto(s) antes · ${draft.afterPhotos.length} foto(s) depois</small>${!deleted?`<div class="saved-comparison" data-saved-comparison="${e(record.id)}"></div>`:""}${deleted?`<p>${e(record.deleteReason)}</p>`:''}</div><div class="toolbar"><button class="secondary" type="button" data-library="open" data-id="${e(record.id)}">${readonly||deleted?'Ver':'Abrir / editar'}</button>${!readonly&&!deleted?`<button class="subtle" type="button" data-library="delete" data-id="${e(record.id)}">Excluir do uso atual</button>`:''}</div>${record.history?.length?`<details><summary>Versões preservadas (${record.history.length})</summary>${[...record.history].reverse().map(h=>`<p>v${h.version} · ${e(h.at)} <button type="button" class="subtle" data-library="version" data-id="${e(record.id)}" data-version="${h.version}">Ver versão</button></p>`).join('')}</details>`:''}</article>`;}).join('')||'<p class="empty">Nenhuma comparação salva. Você pode começar apenas com as fotos de Antes.</p>'}</div><div data-library-editor></div><p class="compare-status" data-library-status role="status" aria-live="polite"></p></section>`;
}

/** Mount only inside root. mutate must commit a clone atomically and refresh getState.
 * No own persistence, upload or remote calls. Caller guards route changes via isDirty/isBusy.
 * selection accepts a record id or {id}; readonly permits viewing/export, never saving.
 */
export function mountComparisonLibrary(root,{getState,patientId,readPhoto,mutate,notify=()=>{},onSaved=null,readonly=false,selection=null,storageMode='local-browser'}={}){
 let draft=null,expectedVersion=0,operationId='',dirty=false,busy=false,disposed=false,includeDeleted=false,editorReadonly=false,previewVersion=null,comparator=null,deleteDialog=null;
 const win=root.ownerDocument.defaultView;
 const savedPreviews=[];
 const disposePreviews=()=>{for(const preview of savedPreviews.splice(0))preview.dispose();};
 function showSavedPreviews(){
  const state=getState(),photos=comparisonPhotos(state,patientId);
  for(const host of root.querySelectorAll("[data-saved-comparison]")){
   const record=(state.comparisons||[]).find(c=>c.id===host.dataset.savedComparison&&c.patientId===patientId&&c.status!=="excluido");
   if(!record)continue;const value=comparisonRecordDraft(state,patientId,record);
   savedPreviews.push(mountSavedComparisonPreview(host,{before:photos.find(p=>p.key===value.before),after:photos.find(p=>p.key===value.after)||null,readPhoto}));
  }
 }
 const isBusy=()=>busy||Boolean(comparator?.isBusy());
 const isDirty=()=>dirty||Boolean(deleteDialog?.isConnected&&deleteDialog.querySelector('form[data-unsaved]'));
 const tell=message=>{if(disposed)return;const out=root.querySelector('[data-library-status]');if(out)out.textContent=message;notify(message);};
 const markDirty=()=>{if(editorReadonly||disposed)return;dirty=true;const form=root.querySelector('[data-library-form]');if(form)form.dataset.unsaved='true';};
 const canLeave=()=>{if(isBusy()){tell('Aguarde a gravação ou a geração da imagem.');return false;}return !isDirty()||confirm('Há alterações não salvas nesta comparação. Descartar?');};
 const disposeComparator=()=>{comparator?.dispose();comparator=null;};
 function collect(){const form=root.querySelector('[data-library-form]');if(!form||!draft)return;for(const name of ['title','area','beforeDate','afterDate','notes'])draft[name]=form.elements.namedItem(name).value;}
 function error(message){if(disposed)return;const out=root.querySelector('[data-library-error]');if(out)out.textContent=message;else tell(message);}
 function refresh(){if(disposed)return;disposeComparator();disposePreviews();root.innerHTML=renderComparisonLibrary(getState(),{patientId,readonly,includeDeleted});showSavedPreviews();if(draft)drawEditor();}
 function begin(record=null,{historical=false}={}){
  disposeComparator();draft=comparisonRecordDraft(getState(),patientId,record);expectedVersion=record?versionOf(record):0;operationId=crypto.randomUUID();dirty=false;previewVersion=historical?versionOf(record):null;editorReadonly=readonly||historical||record?.status==='excluido';drawEditor();
 }
 function drawEditor(){
  if(disposed||!draft)return;disposeComparator();const host=root.querySelector('[data-library-editor]'),photos=comparisonPhotos(getState(),patientId);
  const choices=(side,label)=>{const keys=draft[side+'Photos'];return `<fieldset class="comparison-photo-group" ${editorReadonly?'disabled':''}><legend>${label} · ${keys.length}/10 fotos</legend><div class="comparison-photo-options">${photos.map(p=>`<label><input type="checkbox" data-library-photo="${side}" value="${e(p.key)}" ${keys.includes(p.key)?'checked':''}><span>${e(p.photo.label||'Fotografia')}<small>${e(dateLabel(p.date))} · ${e(p.service)}</small></span></label>`).join('')||'<p>Adicione fotografias à consulta desta paciente para usá-las aqui.</p>'}</div><label class="field">Foto principal de ${label}<select data-library-primary="${side}" ${keys.length?'':'disabled'}><option value="">${keys.length?'Escolha a principal':'Nenhuma selecionada'}</option>${photos.filter(p=>keys.includes(p.key)).map(p=>`<option value="${e(p.key)}" ${draft[side]===p.key?'selected':''}>${e(dateLabel(p.date)+' · '+(p.photo.label||p.service))}</option>`).join('')}</select></label></fieldset>`;};
  host.innerHTML=`<section class="comparison-library-editor"><div class="comparison-library-heading"><h3>${previewVersion?'Versão '+previewVersion+' preservada':editorReadonly?'Comparação preservada':expectedVersion?'Editar comparação · versão '+expectedVersion:'Nova comparação'}</h3><button class="secondary" type="button" data-library="close">Fechar comparação</button></div><p class="note">${storageMode==='clinic-server'?'Homologação conectada.':'Demonstração local.'} As fotos são referências aos originais do prontuário. ${editorReadonly?'Esta versão está em consulta.':'Salvar uma edição preserva a versão anterior.'}</p><form data-library-form ${dirty?'data-unsaved="true"':''} novalidate><fieldset class="comparison-metadata" ${editorReadonly?'disabled':''}><div class="form-grid">${input('Título','title',draft.title,'text','maxlength="120" required')}${input('Área','area',draft.area,'text','maxlength="120"')}${input('Data informada do Antes','beforeDate',draft.beforeDate,'date','required')}${input('Data informada do Depois (opcional)','afterDate',draft.afterDate,'date')}</div>${textArea('Observações','notes',draft.notes,'maxlength="5000"')}<p class="compare-help">As datas acima são informadas por quem registra. A consulta de origem continua identificada em cada fotografia.</p></fieldset><div class="comparison-photo-groups">${choices('before','Antes')}${choices('after','Depois')}</div><p class="note" data-library-pending ${draft.after?'hidden':''}>Depois pendente. Salve as fotos de Antes agora e acrescente as de Depois no retorno. A exportação precisa de duas fotos principais diferentes.</p><div data-library-comparator></div><p class="error" role="alert" data-library-error></p>${editorReadonly?'':`<div class="dialog-actions"><button class="primary" type="submit">${expectedVersion?'Salvar nova versão':'Salvar comparação'}</button></div>`}</form></section>`;
  const form=host.querySelector('form');
  comparator=mountComparison(host.querySelector('[data-library-comparator]'),{state:getState(),patientId,readPhoto,selection:draft,allowedBeforeKeys:draft.beforePhotos,allowedAfterKeys:draft.afterPhotos,allowIncomplete:true,hideSelection:true,hideSave:true,metadata:draft,onSelection:value=>{if(disposed)return;Object.assign(draft,value);markDirty();},onBusyChange:value=>{if(!disposed&&form.isConnected)form.inert=value;}});
 }
 function onInput(event){if(!event.target.closest('[data-library-form]')||editorReadonly||isBusy()||disposed)return;if(['title','area','beforeDate','afterDate','notes'].includes(event.target.name)){collect();markDirty();}}
 function onChange(event){
  if(disposed)return;const target=event.target;
  if(target.matches('[data-library-archive]')){if(!canLeave()){target.checked=includeDeleted;return;}includeDeleted=target.checked;draft=null;dirty=false;refresh();return;}
  if(editorReadonly||isBusy()||!draft)return;
  if(target.matches('[data-library-photo]')){
   collect();const side=target.dataset.libraryPhoto,field=side+'Photos',keys=[...draft[field]],other=side==='before'?'after':'before';
   if(target.checked){if(keys.length>=10){target.checked=false;error('Cada grupo permite no máximo 10 fotografias.');return;}const photos=comparisonPhotos(getState(),patientId),candidate=photos.find(p=>p.key===target.value),selected=photos.filter(p=>[...keys,...draft[other+'Photos']].includes(p.key));if(!candidate||selected.some(p=>p.key===candidate.key||p.photo.id===candidate.photo.id||p.photo.sha256&&candidate.photo.sha256&&p.photo.sha256.toLowerCase()===candidate.photo.sha256.toLowerCase())){target.checked=false;error('Esta fotografia ou o mesmo arquivo original já está selecionado.');return;}keys.push(target.value);}else keys.splice(keys.indexOf(target.value),1);
   draft[field]=keys;if(!keys.includes(draft[side]))draft[side]=keys[0]||'';if(!draft[side+'Date']&&keys.length)draft[side+'Date']=comparisonPhotos(getState(),patientId).find(p=>p.key===draft[side]).date;if(!keys.length&&side==='after')draft.afterDate='';markDirty();drawEditor();return;
  }
  if(target.matches('[data-library-primary]')){collect();draft[target.dataset.libraryPrimary]=target.value;markDirty();drawEditor();return;}
  onInput(event);
 }
 async function onSubmit(event){
  if(!event.target.matches('[data-library-form]'))return;event.preventDefault();if(disposed||editorReadonly||isBusy()||!draft)return;collect();const value=structuredClone(draft),options={expectedVersion,operationId};const form=event.target;busy=true;form.inert=true;
  try{await mutate(s=>saveComparisonRecord(s,value,options));if(disposed)return;const saved=getState().comparisons.find(c=>c.id===value.id&&c.patientId===patientId);if(!saved)throw Error('Não foi possível reler a comparação salva. Mantenha este rascunho e confira o armazenamento.');dirty=false;draft=null;refresh();begin(saved);tell((storageMode==='clinic-server'?'Comparação confirmada no servidor.':'Comparação salva no armazenamento local.')+' Os originais e as versões anteriores foram preservados.');if(onSaved){root.querySelector('[data-library-form]').inert=true;await onSaved(saved);}}catch(err){if(!disposed)error(err.message);}finally{busy=false;if(!disposed){const activeForm=root.querySelector('[data-library-form]');if(activeForm)activeForm.inert=false;}}
 }
 function remove(record){deleteDialog=openRecycleConfirmation({getState,mutate,notify:tell,rerender:async()=>{draft=null;dirty=false;refresh();},target:{type:'comparisons',id:record.id}});}

 function onClick(event){
  const button=event.target.closest('[data-library]');if(!button||!root.contains(button)||disposed)return;const action=button.dataset.library;
  if(!canLeave())return;
  try{if(action==='close'){draft=null;dirty=false;disposeComparator();root.querySelector('[data-library-editor]').innerHTML='';return;}if(action==='new'){if(!readonly)begin();return;}const record=(getState().comparisons||[]).find(c=>c.id===button.dataset.id&&c.patientId===patientId);if(!record)throw Error('Comparação não encontrada.');if(action==='open'){begin(record);return;}if(action==='version'){const previous=record.history?.find(h=>h.version===Number(button.dataset.version));if(!previous)throw Error('Versão não encontrada.');begin(previous.snapshot,{historical:true});return;}if(action==='delete'&&!readonly&&record.status!=='excluido'){dirty=false;draft=null;refresh();remove(record);}}catch(err){tell(err.message);}
 }
 const beforeUnload=event=>{if(isDirty()||isBusy()){event.preventDefault();event.returnValue='';}};
 root.addEventListener('input',onInput);root.addEventListener('change',onChange);root.addEventListener('click',onClick);root.addEventListener('submit',onSubmit);win.addEventListener('beforeunload',beforeUnload);refresh();
 const selectedId=typeof selection==='string'?selection:selection?.id;
 if(selectedId){const record=(getState().comparisons||[]).find(c=>c.id===selectedId&&c.patientId===patientId);if(record)begin(record);}
 return {isDirty,isBusy,discard(){if(isBusy())return false;dirty=false;draft=null;disposeComparator();deleteDialog?.remove();deleteDialog=null;const editor=root.querySelector('[data-library-editor]');if(editor)editor.innerHTML='';return true;},dispose(){disposed=true;disposePreviews();disposeComparator();deleteDialog?.remove();root.removeEventListener('input',onInput);root.removeEventListener('change',onChange);root.removeEventListener('click',onClick);root.removeEventListener('submit',onSubmit);win.removeEventListener('beforeunload',beforeUnload);}};
}
