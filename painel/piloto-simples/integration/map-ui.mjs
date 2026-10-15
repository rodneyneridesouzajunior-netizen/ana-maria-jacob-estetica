import {validatePhotoAnnotation,toPilotMap} from './map-document.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp=value=>Math.max(0,Math.min(1,value));
export function newMapPoint(schema,kind,at,end){
  const point={id:crypto.randomUUID(),x:at.x,y:at.y};
  if(schema===1)return {...point,label:'',notes:''};
  return {...point,kind,...(kind==='ponto'?{}:{x2:end.x,y2:end.y}),region:'',product:'',quantity:null,unit:'sem quantidade',lot:'',notes:''};
}
export function moveMapPoint(point,dx,dy){
  const xs=[point.x,...(point.x2===undefined?[]:[point.x2])],ys=[point.y,...(point.y2===undefined?[]:[point.y2])];
  dx=Math.max(-Math.min(...xs),Math.min(1-Math.max(...xs),dx));dy=Math.max(-Math.min(...ys),Math.min(1-Math.max(...ys),dy));
  return {...point,x:point.x+dx,y:point.y+dy,...(point.x2===undefined?{}:{x2:point.x2+dx,y2:point.y2+dy})};
}

// Private, in-memory editor. No imports from demo store and no IndexedDB,
// localStorage, canvas export or external image generation.
export function mountPrivateMap(container,{api,opened,writesEnabled=false,onMessage=()=>{}}){
  const original=opened.annotation?.document??{schemaVersion:1,points:[],notes:''};
  let saved=validatePhotoAnnotation(original),draft=structuredClone(saved),binding=structuredClone(opened.binding),version=opened.annotation?.version??0;
  let selected=null,tool='ponto',pending=null,busy=false,disposed=false,expired=false,drag=null,skipClick=false,resize,saveBlocked=false;
  const canV2=opened.capabilities?.document_versions?.includes(2)===true;
  const imageUrl=new URL(opened.photo.signed_url);
  if(imageUrl.origin!==api.config.supabaseUrl||!imageUrl.pathname.startsWith('/storage/v1/object/sign/clinic-media/'))throw Error('Foto fora do armazenamento autorizado.');
  const dirty=()=>JSON.stringify(draft)!==JSON.stringify(saved);
  const note=(text,error=false)=>onMessage(text,error?'error':'info');
  const field=(label,key,value,type='text')=>`<label>${label}<input data-map-field="${key}" type="${type}" value="${esc(value)}" ${type==='number'?'step="any"':''} ${writesEnabled?'':'disabled'}></label>`;
  function markup(){
    const point=draft.points.find(p=>p.id===selected),v2=draft.schemaVersion===2;
    return `<div class="ci-map-head"><div><h3>Mapa manual da foto</h3><p>Versão salva ${version} · ${v2?'ponto, linha e leque':'pontos do formato existente'}. As marcações não alteram o original.</p></div><span data-map-dirty>${dirty()?'Alterações não salvas':'Sem alterações pendentes'}</span></div>
    ${!canV2?'<p class="ci-notice">O servidor desta sessão oferece pontos básicos. Linha, leque e campos de produto dependem da extensão v2 preparada localmente.</p>':''}
    <div class="ci-map-tools"><label>Marcação<select data-map-tool ${writesEnabled?'':'disabled'}>${['ponto',...(v2?['linha','leque']:[])].map(k=>`<option value="${k}" ${tool===k?'selected':''}>${k==='ponto'?'Ponto':k==='linha'?'Linha':'Leque'}</option>`).join('')}</select></label>${canV2&&!v2&&writesEnabled?'<button type="button" data-map-action="upgrade">Usar campos ampliados</button>':''}<button type="button" data-map-action="cancel-point">Cancelar traço</button></div>
    <p>${writesEnabled?'Toque na foto para marcar. Linha e leque usam dois toques. Arraste a marcação para ajustar; os campos abaixo registram informações manuais.':'Consulta em modo de leitura. Habilite gravações na área privada antes de editar.'}</p>
    <div class="ci-map-layout"><div class="ci-map-stage" data-map-stage><div class="ci-map-plane" data-map-plane><img data-map-image src="${esc(imageUrl.href)}" referrerpolicy="no-referrer" alt="Original clínico privado para marcação manual"><svg data-map-svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-label="Marcações manuais"></svg></div></div>
    <aside class="ci-map-details"><label>Marcação selecionada<select data-map-selected><option value="">Selecione</option>${draft.points.map((p,i)=>`<option value="${esc(p.id)}" ${p.id===selected?'selected':''}>${i+1} · ${esc((v2?p.region:p.label)||'Sem descrição')}</option>`).join('')}</select></label>
    ${point?field(v2?'Região / descrição':'Descrição',v2?'region':'label',v2?point.region:point.label)+field('X (0 a 1)','x',point.x,'number')+field('Y (0 a 1)','y',point.y,'number')+(point.x2===undefined?'':field('X final (0 a 1)','x2',point.x2,'number')+field('Y final (0 a 1)','y2',point.y2,'number'))+(v2?field('Produto informado','product',point.product)+field('Quantidade informada','quantity',point.quantity,'number')+`<label>Unidade<select data-map-field="unit" ${writesEnabled?'':'disabled'}>${['sem quantidade','mL','U','mg'].map(unit=>`<option ${point.unit===unit?'selected':''}>${unit}</option>`).join('')}</select></label>`+field('Lote informado','lot',point.lot):'')+`<label>Observação<textarea data-map-field="notes" ${writesEnabled?'':'disabled'}>${esc(point.notes)}</textarea></label><button type="button" data-map-action="remove" ${writesEnabled?'':'disabled'}>Remover marcação selecionada</button>`:'<p>Selecione uma marcação ou adicione na foto.</p>'}</aside></div>
    <div class="ci-map-bottom"><label>Observação geral<textarea data-map-document-notes ${writesEnabled?'':'disabled'}>${esc(draft.notes)}</textarea></label><label>Motivo desta versão<input data-map-reason maxlength="500" placeholder="Informe o motivo antes de salvar" ${writesEnabled?'':'disabled'}></label><div><button type="button" data-map-action="save" ${writesEnabled&&!saveBlocked?'':'disabled'}>Salvar nova versão no servidor</button>${saveBlocked?'<button type="button" data-map-action="verify">Conferir servidor mantendo rascunho</button>':''}<button type="button" data-map-action="discard">Descartar alterações locais</button></div></div>`;
  }
  function draw(){
    const svg=container.querySelector('[data-map-svg]');if(!svg)return;
    svg.innerHTML=draft.points.map((p,i)=>{
      const x=p.x*1000,y=p.y*1000,attr=`data-map-id="${esc(p.id)}"`,color=p.id===selected?'#603044':'#b2476a';
      const shape=p.x2===undefined?'':p.kind==='leque'?`<path d="M ${x} ${y} L ${p.x2*1000} ${p.y2*1000} M ${x} ${y} L ${(p.x+(p.x2-p.x)*.8-(p.y2-p.y)*.18)*1000} ${(p.y+(p.y2-p.y)*.8+(p.x2-p.x)*.18)*1000} M ${x} ${y} L ${(p.x+(p.x2-p.x)*.8+(p.y2-p.y)*.18)*1000} ${(p.y+(p.y2-p.y)*.8-(p.x2-p.x)*.18)*1000}" ${attr} fill="none" stroke="${color}" stroke-width="5"/>`:`<line x1="${x}" y1="${y}" x2="${p.x2*1000}" y2="${p.y2*1000}" ${attr} stroke="${color}" stroke-width="5"/>`;
      return shape+`<circle cx="${x}" cy="${y}" r="11" ${attr} fill="${color}" stroke="white" stroke-width="3"/><text x="${x+16}" y="${y-12}" fill="${color}" font-size="26">${i+1}</text>`;
    }).join('')+(pending?`<circle cx="${pending.x*1000}" cy="${pending.y*1000}" r="9" fill="#806229"/>`:'');
    const indicator=container.querySelector('[data-map-dirty]');if(indicator)indicator.textContent=dirty()?'Alterações não salvas':'Sem alterações pendentes';
  }
  function fit(){const image=container.querySelector('[data-map-image]'),stage=container.querySelector('[data-map-stage]'),plane=container.querySelector('[data-map-plane]');if(image?.naturalWidth&&stage&&plane)plane.style.width=Math.max(1,Math.min(stage.clientWidth-8,(stage.clientHeight-8)*image.naturalWidth/image.naturalHeight))+'px';}
  function render(){
    if(disposed)return;const reason=container.querySelector('[data-map-reason]')?.value??'';resize?.disconnect();container.innerHTML=markup();container.querySelector('[data-map-reason]').value=reason;
    const image=container.querySelector('[data-map-image]');image.addEventListener('load',fit,{once:true});if(expired){image.removeAttribute('src');image.alt='Acesso temporário expirado; salve ou descarte o rascunho antes de reabrir.';}
    if(typeof ResizeObserver==='function'){resize=new ResizeObserver(fit);resize.observe(container.querySelector('[data-map-stage]'));}fit();draw();
  }
  const position=event=>{const box=container.querySelector('[data-map-plane]').getBoundingClientRect();return {x:clamp((event.clientX-box.left)/box.width),y:clamp((event.clientY-box.top)/box.height)};};
  function editable(){return writesEnabled&&!busy&&!expired&&!disposed;}
  const click=async event=>{
    const action=event.target.closest('[data-map-action]')?.dataset.mapAction;
    if(busy||disposed)return;
    if(action==='discard'){draft=structuredClone(saved);selected=null;pending=null;render();return;}
    if(action==='cancel-point'){pending=null;draw();return;}
    if(action==='upgrade'&&writesEnabled&&canV2){draft={schemaVersion:2,points:toPilotMap(draft).points,notes:draft.notes};pending=null;render();return;}
    if(action==='remove'&&editable()){draft.points=draft.points.filter(p=>p.id!==selected);selected=null;render();return;}
    if(action==='verify'&&saveBlocked){
      busy=true;
      try{const result=await api.maps.open(binding.protocol_id,binding.photo_id);if(disposed)return;
        const server=result.annotation?.document;
        if(server&&Object.keys(binding).every(key=>result.binding[key]===binding[key])&&JSON.stringify(validatePhotoAnnotation(server))===JSON.stringify(draft)){saved=validatePhotoAnnotation(server);version=result.annotation.version;binding=structuredClone(result.binding);saveBlocked=false;note('O servidor confirmou exatamente o documento do rascunho.');}
        else note('O documento do servidor é diferente. Seu rascunho foi mantido, mas não substituirá outra versão automaticamente. Confira antes de descartar ou reabrir.',true);
      }catch(error){if(!disposed)note(error.message,true);}finally{busy=false;if(!disposed)render();}return;
    }
    if(action==='save'&&writesEnabled&&!saveBlocked){
      try{
        if(!dirty()){note('Nenhuma alteração para salvar.');return;}
        const document=validatePhotoAnnotation(draft),reason=container.querySelector('[data-map-reason]').value.trim();if(reason.length<3||reason.length>500)throw Error('Informe o motivo desta nova versão (3 a 500 caracteres).');
        const payload={protocolo_id:binding.protocol_id,foto_id:binding.photo_id,expected_patient_id:binding.patient_id,expected_protocol_version:binding.protocol_version,expected_photo_revision:binding.photo_revision,expected_version:version,operation_id:crypto.randomUUID(),document,motivo:reason};
        busy=true;container.setAttribute('aria-busy','true');container.querySelectorAll('input,select,textarea,button').forEach(el=>el.disabled=true);
        const result=await api.maps.save(payload);if(disposed)return;saved=validatePhotoAnnotation(result.annotation.document);draft=structuredClone(saved);version=result.annotation.version;binding=structuredClone(result.binding);note('Nova versão confirmada pelo servidor. O original da foto foi preservado.');
      }catch(error){if(!disposed){if(error.uncertain||error.status===409||['map_context_mismatch','map_open_required'].includes(error.code))saveBlocked=true;note(error.uncertain?'Gravação sem confirmação. O rascunho foi mantido. Confira o servidor antes de repetir.':error.message,true);}}
      finally{busy=false;if(!disposed){container.removeAttribute('aria-busy');render();}}return;
    }
    if(!event.target.closest('[data-map-plane]')||!editable())return;
    if(skipClick){skipClick=false;return;}
    const hit=event.target.closest('[data-map-id]');if(hit){selected=hit.dataset.mapId;render();return;}
    if(draft.points.length>=200){note('Limite de 200 marcações por versão.',true);return;}
    const at=position(event);if(tool!=='ponto'&&!pending){pending=at;draw();return;}
    const point=newMapPoint(draft.schemaVersion,tool,pending??at,at);draft.points.push(point);selected=point.id;pending=null;render();
  };
  const input=event=>{
    if(busy||!writesEnabled)return;const target=event.target,key=target.dataset.mapField;
    if(target.matches('[data-map-document-notes]')){draft.notes=target.value;draw();return;}
    if(!key)return;const point=draft.points.find(p=>p.id===selected);if(!point)return;
    point[key]=['x','y','x2','y2','quantity'].includes(key)?target.value===''&&key==='quantity'?null:Number(target.value):target.value;draw();
  };
  const change=event=>{if(event.target.matches('[data-map-tool]')){tool=event.target.value;pending=null;draw();}if(event.target.matches('[data-map-selected]')){selected=event.target.value||null;render();}};
  const down=event=>{const hit=event.target.closest('[data-map-id]');if(!hit||!editable())return;selected=hit.dataset.mapId;drag={id:selected,at:position(event),point:structuredClone(draft.points.find(p=>p.id===selected)),pointer:event.pointerId};container.setPointerCapture?.(event.pointerId);event.preventDefault();};
  const move=event=>{if(!drag||!editable())return;const at=position(event),i=draft.points.findIndex(p=>p.id===drag.id);draft.points[i]=moveMapPoint(drag.point,at.x-drag.at.x,at.y-drag.at.y);skipClick=true;draw();};
  const up=()=>{if(drag){drag=null;render();}};
  for(const [name,fn] of [['click',click],['input',input],['change',change],['pointerdown',down],['pointermove',move],['pointerup',up],['pointercancel',up]])container.addEventListener(name,fn);
  const timer=setTimeout(()=>{if(disposed)return;expired=true;const image=container.querySelector('[data-map-image]');image?.removeAttribute('src');note('Acesso temporário à foto expirou. Salve ou descarte o rascunho antes de reabrir.');},Math.min(120,Number(opened.photo.expires_in)||120)*1000);
  const unload=event=>{if(dirty()){event.preventDefault();event.returnValue='';}};
  globalThis.addEventListener?.('beforeunload',unload);
  render();
  return {isDirty:dirty,isBusy:()=>busy,dispose(){disposed=true;clearTimeout(timer);resize?.disconnect();globalThis.removeEventListener?.('beforeunload',unload);for(const [name,fn] of [['click',click],['input',input],['change',change],['pointerdown',down],['pointermove',move],['pointerup',up],['pointercancel',up]])container.removeEventListener(name,fn);draft=null;saved=null;binding=null;}};
}
