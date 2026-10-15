const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const dateLabel=value=>String(value).split('-').reverse().join('/');
const keyFor=(visitId,photoId)=>JSON.stringify([visitId,photoId]);

export function comparisonPhotos(state,patientId){
  if(!state.patients.some(patient=>patient.id===patientId))throw Error('Paciente não encontrada.');
  return state.visits.filter(visit=>visit.patientId===patientId).flatMap(visit=>visit.photos.map(photo=>({key:keyFor(visit.id,photo.id),patientId,visitId:visit.id,date:visit.date,service:visit.service,photo}))).sort((a,b)=>a.date.localeCompare(b.date)||a.key.localeCompare(b.key));
}

export function resolveComparison(state,patientId,beforeKey,afterKey){
  const photos=comparisonPhotos(state,patientId);
  const before=photos.find(item=>item.key===beforeKey),after=photos.find(item=>item.key===afterKey);
  if(!before||!after)throw Error('Selecione duas fotografias desta paciente.');
  if(before.key===after.key||before.photo.id===after.photo.id)throw Error('Escolha fotografias diferentes para Antes e Depois.');
  if(before.photo.sha256&&String(before.photo.sha256).toLowerCase()===String(after.photo.sha256||'').toLowerCase())throw Error('As seleções contêm o mesmo arquivo original. Escolha duas fotografias diferentes.');
  for(const item of [before,after]){
    const parsed=new Date(item.date+'T12:00:00Z');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(item.date)||Number.isNaN(+parsed)||parsed.toISOString().slice(0,10)!==item.date)throw Error('A consulta precisa ter uma data válida para a comparação.');
  }
  if(before.date>after.date)throw Error('A consulta do Depois deve ser da mesma data ou posterior à consulta do Antes.');
  return {before,after};
}

export function comparisonSelection(state,patientId,selection){
  resolveComparison(state,patientId,selection.before,selection.after);
  if(!['side','slide'].includes(selection.mode??'side'))throw Error('Visualização da comparação inválida.');
  if(!['png','jpeg'].includes(selection.format??'png'))throw Error('Formato de exportação inválido.');
  const split=selection.split??50;
  if(!Number.isFinite(split)||split<0||split>100)throw Error('A posição do divisor deve estar entre 0 e 100.');
  return {schemaVersion:1,patientId,before:selection.before,after:selection.after,mode:selection.mode??'side',split,format:selection.format??'png'};
}

async function imageFromUrl(url){
  return new Promise((resolve,reject)=>{const image=new Image();image.decoding='async';image.onload=()=>resolve(image);image.onerror=()=>reject(Error('Não foi possível abrir uma das fotografias.'));image.src=url;});
}
async function bitmapFromSource(source){
  if(source instanceof Blob)return createImageBitmap(source,{imageOrientation:'from-image'});
  return createImageBitmap(await imageFromUrl(source));
}
function contain(ctx,image,x,y,width,height){
  const ratio=Math.min(width/image.width,height/image.height),w=image.width*ratio,h=image.height*ratio;
  ctx.drawImage(image,x+(width-w)/2,y+(height-h)/2,w,h);
}

export async function buildComparisonImage(pair,readPhoto,{format='png',testImagesConfirmed=false,metadata=null}={}){
  if(!testImagesConfirmed)throw Error('Confirme que são imagens fictícias/de teste antes de exportar.');
  if(!['png','jpeg'].includes(format))throw Error('Formato de exportação inválido.');
  if(!pair?.before?.patientId||pair.before.patientId!==pair?.after?.patientId)throw Error('A composição deve conter fotos da mesma paciente.');
  const opened=[];
  try{
    const before=await bitmapFromSource(await readPhoto(pair.before,true));opened.push(before);
    const after=await bitmapFromSource(await readPhoto(pair.after,true));opened.push(after);
    const logo=await bitmapFromSource('assets/logo.png');opened.push(logo);
    const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;
    const ctx=canvas.getContext('2d');if(!ctx)throw Error('O navegador não conseguiu preparar a imagem.');
    ctx.fillStyle='#f8f3f5';ctx.fillRect(0,0,1920,1080);contain(ctx,logo,60,15,320,110);
    ctx.fillStyle='#28232b';ctx.font='600 36px sans-serif';ctx.fillText(metadata?.title||'Comparação fotográfica',450,65,1400);
    ctx.fillStyle='#9b405b';ctx.font='600 23px sans-serif';ctx.fillText('PILOTO — DADOS FICTÍCIOS',450,105);
    const panelWidth=884,photoY=235,photoHeight=720;
    for(const [index,item,image,label]of[[0,pair.before,before,'ANTES'],[1,pair.after,after,'DEPOIS']]){
      const x=60+index*916;ctx.fillStyle='#703046';ctx.font='600 30px sans-serif';ctx.fillText(label,x,163);
      const informed=index===0?metadata?.beforeDate:metadata?.afterDate;
      ctx.fillStyle='#28232b';ctx.font='22px sans-serif';ctx.fillText(informed?'Data informada: '+dateLabel(informed):'Data da consulta: '+dateLabel(item.date),x,195);
      ctx.font='18px sans-serif';ctx.fillText((informed?'Consulta '+dateLabel(item.date)+' · ':'')+item.service+(metadata?.area?' · '+metadata.area:''),x,222,panelWidth);
      ctx.fillStyle='#eee5e9';ctx.fillRect(x,photoY,panelWidth,photoHeight);contain(ctx,image,x,photoY,panelWidth,photoHeight);
      ctx.strokeStyle='#dfd1d8';ctx.lineWidth=2;ctx.strokeRect(x,photoY,panelWidth,photoHeight);
    }
    ctx.fillStyle='#703046';ctx.font='600 23px sans-serif';ctx.fillText('TESTE · SEM RESULTADO CLÍNICO',60,1005);
    ctx.fillStyle='#665e68';ctx.font='20px sans-serif';ctx.fillText(metadata?'Fotos sem retoque ou recorte. Datas informadas e consultas de origem identificadas acima.':'Fotos sem retoque ou recorte; dimensões ajustadas à composição. Datas referentes às consultas.',60,1045);
    const mime=format==='jpeg'?'image/jpeg':'image/png';
    return await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob&&blob.type===mime?resolve(blob):reject(Error('Não foi possível gerar o formato selecionado.')),mime,format==='jpeg'?0.95:undefined));
  }finally{for(const bitmap of opened)bitmap.close();}
}

export function mountComparison(root,{state,patientId,readPhoto,selection={},onSelection=()=>{},onSave=null,allowedBeforeKeys=null,allowedAfterKeys=null,allowIncomplete=false,hideSelection=false,hideSave=false,metadata=null,onBusyChange=()=>{}}){
  const photos=comparisonPhotos(state,patientId);
  let beforeKey=photos.some(photo=>photo.key===selection.before)?selection.before:'',afterKey=photos.some(photo=>photo.key===selection.after)?selection.after:'',pair=null,sequence=0,exporting=false,saving=false,disposed=false;
  let mode=selection.mode==='slide'?'slide':'side',split=Number.isFinite(selection.split)&&selection.split>=0&&selection.split<=100?selection.split:50,format=selection.format==='jpeg'?'jpeg':'png';
  const options=(value,allowed)=>'<option value="">Escolha uma fotografia</option>'+photos.filter(item=>!allowed||allowed.includes(item.key)).map(item=>`<option value="${escapeHtml(item.key)}" ${item.key===value?'selected':''}>${escapeHtml(dateLabel(item.date)+' · '+item.service+' · '+item.photo.label)}</option>`).join('');
  root.innerHTML=`<div class="compare-selection"><div class="field"><label for="compare-before">Antes · fotografia e consulta</label><select id="compare-before">${options(beforeKey,allowedBeforeKeys)}</select></div><div class="field"><label for="compare-after">Depois · fotografia e consulta</label><select id="compare-after">${options(afterKey,allowedAfterKeys)}</select></div></div><p class="compare-help">Escolha fotos da mesma paciente, inclusive de consultas diferentes. As datas identificam as consultas; não comprovam o momento de captura.</p><div class="compare-controls"><div class="segmented" aria-label="Visualização da comparação"><button type="button" class="segment active" data-compare-mode="side" aria-pressed="true">Lado a lado</button><button type="button" class="segment" data-compare-mode="slide" aria-pressed="false">Deslizante</button></div><button class="secondary" type="button" data-compare-expand disabled>Ampliar</button></div><div class="compare-host"><div class="compare-stage"><div class="compare-empty">${photos.length<2?'Adicione duas fotografias de teste às consultas desta paciente.':'Selecione as duas fotografias para comparar.'}</div><div class="compare-images" hidden><figure class="compare-photo before"><div class="compare-image-title"><strong>Antes</strong><span data-compare-date="before"></span></div><img data-compare-image="before" alt="Fotografia selecionada para Antes"><figcaption data-compare-caption="before"></figcaption></figure><figure class="compare-photo after"><div class="compare-image-title"><strong>Depois</strong><span data-compare-date="after"></span></div><img data-compare-image="after" alt="Fotografia selecionada para Depois"><figcaption data-compare-caption="after"></figcaption></figure></div><div class="compare-slider" hidden><label for="compare-position">Posição do divisor: <output>50%</output></label><input id="compare-position" type="range" min="0" max="100" value="50" aria-label="Posição do divisor Antes e Depois"></div></div></div><p class="compare-help">A visualização mantém a imagem inteira. Iluminação, posição e enquadramento diferentes podem dificultar a comparação. O divisor não faz alinhamento facial.</p><div class="compare-export"><label class="compare-confirm"><input type="checkbox" data-compare-confirm>Estas são imagens fictícias/de teste, sem resultado clínico.</label><button type="button" class="secondary" data-compare-save disabled>Salvar composição</button><label class="field">Formato de exportação<select data-compare-format><option value="png">PNG</option><option value="jpeg">JPEG</option></select></label><button type="button" class="primary" data-compare-export disabled>Gerar imagem lado a lado</button></div><p class="compare-status" role="status" aria-live="polite"></p><dialog class="compare-lightbox"><button type="button" class="secondary" data-compare-close>Fechar ampliação</button><div class="compare-expanded-content"></div></dialog>`;
  const find=selector=>root.querySelector(selector),all=selector=>root.querySelectorAll(selector);
  const beforeSelect=find('#compare-before'),afterSelect=find('#compare-after'),stage=find('.compare-stage'),images=find('.compare-images'),empty=find('.compare-empty'),status=find('.compare-status'),confirmation=find('[data-compare-confirm]'),exportButton=find('[data-compare-export]'),expandButton=find('[data-compare-expand]'),dialog=find('.compare-lightbox');
  const saveButton=find('[data-compare-save]'),formatSelect=find('[data-compare-format]'),position=find('#compare-position');
  const currentSelection=()=>({before:beforeKey,after:afterKey,mode,split,format});
  const publishSelection=()=>onSelection(currentSelection());
  const refreshExport=()=>{exportButton.disabled=!pair||!confirmation.checked||exporting||saving;saveButton.disabled=!pair||typeof onSave!=='function'||exporting||saving;exportButton.textContent='Gerar '+format.toUpperCase()+' lado a lado';};
  const setLocked=value=>{beforeSelect.disabled=value;afterSelect.disabled=value;formatSelect.disabled=value;position.disabled=value;all('[data-compare-mode]').forEach(button=>button.disabled=value);onBusyChange(value);};
  function applyView(){stage.classList.toggle('is-sliding',mode==='slide'&&Boolean(pair));find('.compare-slider').hidden=mode!=='slide'||!pair;stage.style.setProperty('--compare-split',split+'%');position.value=String(split);find('output').textContent=split+'%';formatSelect.value=format;all('[data-compare-mode]').forEach(button=>{const active=button.dataset.compareMode===mode;button.classList.toggle('active',active);button.setAttribute('aria-pressed',active);});}
  async function showPair(){
    const seq=++sequence;pair=null;images.hidden=true;empty.hidden=false;empty.textContent='Preparando comparação…';expandButton.disabled=true;confirmation.checked=false;refreshExport();status.textContent='';
    stage.classList.toggle('is-incomplete',allowIncomplete&&!afterKey);
    if(!beforeKey||!afterKey){
      if(allowIncomplete&&beforeKey&&!afterKey){try{const selected=photos.find(p=>p.key===beforeKey),url=await readPhoto(selected,false);await imageFromUrl(url);if(disposed||seq!==sequence||!root.isConnected)return;find('[data-compare-image="before"]').src=url;find('[data-compare-date="before"]').textContent='Consulta: '+dateLabel(selected.date);find('[data-compare-caption="before"]').textContent=selected.service+' · '+selected.photo.label;find('.compare-photo.after').hidden=true;images.hidden=false;empty.hidden=true;expandButton.disabled=false;status.textContent='Depois pendente. Você pode salvar o registro de Antes e completar no retorno. A exportação está desativada.';applyView();refreshExport();}catch(error){if(!disposed&&seq===sequence){empty.textContent=error.message;status.textContent=error.message;}}return;}
      empty.textContent=allowIncomplete?'Selecione ao menos uma fotografia de Antes.':photos.length<2?'Adicione duas fotografias de teste às consultas desta paciente.':'Selecione as duas fotografias para comparar.';return;
    }
    try{
      const selected=resolveComparison(state,patientId,beforeKey,afterKey);
      const urls=await Promise.all([readPhoto(selected.before,false),readPhoto(selected.after,false)]);
      await Promise.all(urls.map(imageFromUrl));
      if(disposed||seq!==sequence||!root.isConnected)return;
      for(const [side,item,url]of[['before',selected.before,urls[0]],['after',selected.after,urls[1]]]){
        find(`[data-compare-image="${side}"]`).src=url;find(`[data-compare-date="${side}"]`).textContent='Consulta: '+dateLabel(item.date);find(`[data-compare-caption="${side}"]`).textContent=item.service+' · '+item.photo.label;
      }
      pair=selected;find('.compare-photo.after').hidden=false;images.hidden=false;empty.hidden=true;expandButton.disabled=false;applyView();refreshExport();
    }catch(error){if(seq!==sequence)return;empty.textContent=error.message;status.textContent=error.message;}
  }
  for(const select of[beforeSelect,afterSelect])select.addEventListener('change',()=>{if(exporting||saving||disposed)return;beforeKey=beforeSelect.value;afterKey=afterSelect.value;publishSelection();void showPair();});
  all('[data-compare-mode]').forEach(button=>button.addEventListener('click',()=>{if(exporting||saving)return;mode=button.dataset.compareMode;applyView();publishSelection();}));
  position.addEventListener('input',event=>{if(exporting||saving)return;split=Math.max(0,Math.min(100,Number(event.target.value)||0));applyView();publishSelection();});
  formatSelect.addEventListener('change',()=>{if(exporting||saving)return;format=formatSelect.value==='jpeg'?'jpeg':'png';publishSelection();refreshExport();});
  expandButton.addEventListener('click',()=>{find('.compare-expanded-content').append(stage);dialog.showModal();});
  find('[data-compare-close]').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>find('.compare-host').append(stage));
  confirmation.addEventListener('change',refreshExport);
  saveButton.addEventListener('click',async()=>{
    if(disposed||exporting||saving||typeof onSave!=='function')return;
    try{
      const value=comparisonSelection(state,patientId,currentSelection());saving=true;setLocked(true);refreshExport();status.textContent='Salvando as escolhas da composição…';
      await onSave({...value});
      if(!disposed&&root.isConnected)status.textContent='Composição salva: fotografias selecionadas, visualização, divisor e formato. Os arquivos originais foram preservados.';
    }catch(error){if(!disposed&&root.isConnected)status.textContent=error.message;}finally{saving=false;setLocked(false);refreshExport();}
  });
  exportButton.addEventListener('click',async()=>{
    if(disposed||exporting||saving||!confirmation.checked)return;
    try{
      const selected=resolveComparison(state,patientId,beforeKey,afterKey);exporting=true;refreshExport();setLocked(true);status.textContent='Gerando imagem Full HD de teste a partir dos arquivos originais…';
      const blob=await buildComparisonImage(selected,readPhoto,{format,testImagesConfirmed:true,metadata});if(disposed||!root.isConnected)return;
      const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`comparacao-teste-${selected.before.date}-${selected.after.date}.${format==='jpeg'?'jpg':'png'}`;link.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
      status.textContent=format.toUpperCase()+' de teste gerado em 1920 × 1080. Os arquivos originais e as marcações foram preservados.';
    }catch(error){status.textContent=error.message;}finally{exporting=false;setLocked(false);refreshExport();}
  });
  find('.compare-selection').hidden=hideSelection;saveButton.hidden=hideSave;
  applyView();void showPair();
  return {isBusy:()=>exporting||saving,dispose(){disposed=true;sequence++;pair=null;if(dialog.open)dialog.close();}};
}
