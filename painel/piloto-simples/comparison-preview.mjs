/** Read-only presentation of saved photos. It never writes a comparison or edits an image. */
export function mountSavedComparisonPreview(root,{before,after=null,readPhoto}){
 const doc=root.ownerDocument;let disposed=false;
 root.innerHTML='<div class="saved-comparison-stage" data-saved-mode="slide"><figure class="saved-comparison-before"><img alt="Antes — fotografia original" loading="lazy"><figcaption>Antes</figcaption></figure><figure class="saved-comparison-after" hidden><img alt="Depois — fotografia original" loading="lazy"><figcaption>Depois</figcaption></figure><span class="saved-comparison-divider" aria-hidden="true" hidden>↔</span></div><div class="saved-comparison-controls"><label hidden>Comparar antes e depois<input type="range" min="0" max="100" value="50" aria-label="Comparar antes e depois"></label><button type="button" class="secondary" hidden>Ver lado a lado</button></div><p class="saved-comparison-status" role="status">Carregando fotografias…</p>';
 const stage=root.querySelector('.saved-comparison-stage'),beforeImage=root.querySelector('.saved-comparison-before img'),afterFigure=root.querySelector('.saved-comparison-after'),afterImage=afterFigure.querySelector('img'),divider=root.querySelector('.saved-comparison-divider'),range=root.querySelector('input'),toggle=root.querySelector('button'),status=root.querySelector('[role="status"]');
 let sideBySide=false;
 const update=()=>{stage.dataset.savedMode=sideBySide?'side':'slide';stage.style.setProperty('--saved-split',range.value+'%');divider.hidden=!after||sideBySide;range.parentElement.hidden=!after||sideBySide;toggle.textContent=sideBySide?'Ver com divisor':'Ver lado a lado';};
 const onInput=()=>update(),onToggle=()=>{sideBySide=!sideBySide;update();};
 range.addEventListener('input',onInput);toggle.addEventListener('click',onToggle);
 const valid=()=>!disposed&&root.isConnected;
 const failed=()=>{if(valid())status.textContent='Não foi possível carregar a fotografia. Abra a comparação para conferir o arquivo.';};
 beforeImage.addEventListener('error',failed);afterImage.addEventListener('error',failed);
 const ready=(async()=>{
  try{
   if(!before)throw Error('Fotografia de Antes não encontrada.');
   const sources=await Promise.all([readPhoto(before,false),after?readPhoto(after,false):Promise.resolve(null)]);
   if(!valid())return;
   beforeImage.src=sources[0];if(after){afterImage.src=sources[1];afterFigure.hidden=false;toggle.hidden=false;}
   update();status.textContent=after?'Arraste o divisor ou veja as fotos lado a lado. Os originais são preservados.':'Depois pendente. A fotografia de Antes já está registrada.';
  }catch(error){if(valid())status.textContent=error.message||'Fotografia indisponível.';}
 })();
 return{ready,dispose(){disposed=true;range.removeEventListener('input',onInput);toggle.removeEventListener('click',onToggle);beforeImage.removeEventListener('error',failed);afterImage.removeEventListener('error',failed);beforeImage.removeAttribute('src');afterImage.removeAttribute('src');}};
}
