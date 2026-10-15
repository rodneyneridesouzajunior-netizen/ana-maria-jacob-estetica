import {facialStudyContext,saveFacialStudy,validateFacialDocument,exportFacialStudyData} from './facial-study-domain.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const selectionOf=({patientId,visitId})=>({patientId,visitId});
export function renderFacialStudy(state,selection){
  const ctx=facialStudyContext(state,selection),connected=selection.storageMode==='clinic-server';
  return `<section class="facial-study" aria-labelledby="facial-title"><div class="facial-heading"><div><span class="facial-kicker">Estudo visual · ${connected?'servidor da clínica':'somente neste navegador'}</span><h2 id="facial-title">Modelo 3D genérico</h2><p><strong>${esc(ctx.patient.name)}</strong> · consulta de ${esc(String(ctx.visit.date||'').split('-').reverse().join('/'))}</p></div><span class="facial-version" data-facial-version>${ctx.version?'Versão '+ctx.version:'Sem estudo salvo'}</span></div><p class="facial-explanation">Gire o modelo, aproxime e registre pontos na pele. Este rosto é genérico: não é uma reconstrução da paciente e não altera suas fotografias.</p>${ctx.readOnly?'<p class="facial-readonly">Consulta bloqueada. Você pode consultar e exportar as versões existentes.</p>':''}<div class="facial-toolbar"><button type="button" data-facial="open" class="primary">Abrir estudo 3D</button><button type="button" data-facial="saved" ${ctx.version?'':'disabled'}>Exportar versões salvas · JSON</button><button type="button" data-facial="draft" disabled>Exportar rascunho · JSON</button></div><p class="facial-state" role="status" aria-live="polite" data-facial-status>O modelo é carregado somente ao abrir. Aproximadamente 31 MB na primeira abertura.</p><div class="facial-frame-slot" data-facial-slot></div><details class="facial-help"><summary>Como usar e o que fica salvo</summary><ol><li>Abra o estudo. Arraste para girar e use a roda ou a pinça para aproximar.</li><li>Escolha <strong>Marcar ponto</strong> e toque na pele do modelo. Nomeie o ponto e escreva sua observação.</li><li>Use <strong>Mover ponto</strong> ou exclua a marcação selecionada quando necessário.</li><li>Escolha <strong>${connected?'Salvar no servidor':'Salvar neste navegador'}</strong>. Cada gravação cria uma versão vinculada a esta consulta.</li></ol><p>O arquivo JSON contém pontos, observações, vínculo e versões. Não é imagem, diagnóstico, previsão de resultado ou cópia das fotografias. A posição da câmera não fica salva. A exportação do rascunho permite preservar anotações antes de resolver um conflito.</p><p>Este modo utiliza apenas a superfície externa; não carrega o atlas anatômico. ${connected?'As versões confirmadas ficam no servidor da clínica.':'Os dados não são enviados à nuvem.'}</p></details></section>`;
}

// Framework-free host protocol. The viewer only trusts its exact same-origin parent/frame.
export function createFacialStudyBridge({patientId,visitId,getState,mutate,getFrameWindow,getViewer,isActive=()=>true,onState=()=>{},notify=()=>{},storageMode='local-browser',operationId=()=>crypto.randomUUID()}){
  const selection={patientId,visitId};let disposed=false,pending=false,bound=false,lastOperation=null;
  const attached=source=>!disposed&&Boolean(source)&&source===getFrameWindow();
  const allowed=source=>attached(source)&&isActive();
  const emit=()=>{if(!disposed)onState();};
  function requireFrame(source){if(!allowed(source))throw Error('O estudo não está ativo nesta consulta.');}
  function load(source){
    requireFrame(source);const ctx=facialStudyContext(getState(),selection),viewer=getViewer();
    if(!viewer?.ready()||viewer.capabilities?.().storage!==storageMode||!viewer.capabilities?.().appearanceOnly)throw Error('Abra a versão local compatível do visualizador 3D.');
    const record=ctx.records.at(-1)||null;
    viewer.loadStudy(record,`${ctx.patient.name} · ${ctx.visit.date||'Consulta'} · ${storageMode==='clinic-server'?'servidor da clínica':'dados locais'}`,{readOnly:ctx.readOnly});bound=true;lastOperation=null;emit();return record;
  }
  const bridge={
    frameAttached:attached,frameAllowed:allowed,
    frameReady(source){try{requireFrame(source);if(bound)return;return load(source);}catch(error){notify(error.message,true);throw error;}},
    activity(source){if(attached(source))emit();},
    editorState(source){if(attached(source))emit();},
    async saveStudy(source,document,expectedVersion){
      requireFrame(source);if(!bound||pending)throw Error('Aguarde o carregamento ou a gravação do estudo.');
      const canonical=validateFacialDocument(document);facialStudyContext(getState(),selection);
      const signature=JSON.stringify({expectedVersion,document:canonical});
      if(lastOperation?.signature!==signature)lastOperation={signature,id:operationId()};
      const op=lastOperation.id;let saved;pending=true;emit();
      try{
        await mutate(state=>{if(disposed)throw Error('A consulta foi fechada antes da gravação.');saved=saveFacialStudy(state,{...selection,document:canonical,expectedVersion,operationId:op});});
        if(!saved)throw Error('O armazenamento não confirmou a versão do estudo.');
        if(!disposed){lastOperation=null;notify(`Estudo 3D salvo ${storageMode==='clinic-server'?'no servidor':'neste navegador'} · versão ${saved.version}.`);}
        return saved;
      }finally{pending=false;emit();}
    },
    isBusy:()=>pending||Boolean(getViewer()?.isBusy?.()),
    isDirty:()=>Boolean(getViewer()?.hasChanges?.()),
    reload(){if(bridge.isBusy())throw Error('Aguarde a gravação do estudo.');return load(getFrameWindow());},
    discard(){if(bridge.isBusy())return false;getViewer()?.unbind?.();bound=false;lastOperation=null;emit();return true;},
    dispose(){disposed=true;bound=false;}
  };return bridge;
}

export function mountFacialStudy(host,{patientId,visitId,getState,mutate,notify=()=>{},storageMode='local-browser',viewerUrl='/painel/rosto3d/v2/index.html?mode=local-pilot',window:ownerWindow=globalThis.window}){
  const root=host.querySelector('.facial-study');if(!root)return null;
  const selection=selectionOf({patientId,visitId});facialStudyContext(getState(),selection);
  let frame=null,disposed=false,active=true,timeout=null,externalBusy=false,loaded=false,frameObserver=null;
  const find=name=>root.querySelector(`[data-facial="${name}"]`),status=root.querySelector('[data-facial-status]');
  const viewer=()=>{try{return frame?.contentWindow?.AMJRostoViewer||null;}catch{return null;}};
  const message=value=>{if(!disposed)status.textContent=value;};
  function sync(){if(disposed)return;const current=facialStudyContext(getState(),selection);root.querySelector('[data-facial-version]').textContent=current.version?'Versão '+current.version:'Sem estudo salvo';find('saved').disabled=!current.version||bridge.isBusy()||externalBusy;find('draft').disabled=!loaded||!bridge.isDirty()||bridge.isBusy()||externalBusy;find('open').disabled=bridge.isBusy()||externalBusy;}
  const bridge=createFacialStudyBridge({...selection,storageMode,getState,mutate,getFrameWindow:()=>frame?.contentWindow,getViewer:viewer,isActive:()=>active&&!disposed,onState:()=>{try{sync();}catch(error){message(error.message);}},notify:(text,error)=>{message(text);notify(text,error);}});
  const originalReady=bridge.frameReady;
  bridge.frameReady=source=>{const result=originalReady(source);if(loaded)return result;loaded=true;clearTimeout(timeout);find('open').textContent='Reabrir versão salva';message(facialStudyContext(getState(),selection).readOnly?'Consulta bloqueada. Modelo disponível para leitura e exportação.':'Modelo pronto. Use Marcar ponto e '+(storageMode==='clinic-server'?'Salvar no servidor.':'Salvar neste navegador.'));
    const fit=()=>{if(frame&&!disposed){const height=frame.contentDocument?.body?.getBoundingClientRect().height;if(height)frame.style.height=Math.min(3000,Math.max(640,Math.ceil(height)+4))+'px';}};
    if(ownerWindow.ResizeObserver&&frame.contentDocument?.body){frameObserver=new ownerWindow.ResizeObserver(fit);frameObserver.observe(frame.contentDocument.body);}fit();sync();return result;};
  function closeFrame(){clearTimeout(timeout);frameObserver?.disconnect();frameObserver=null;try{viewer()?.setActive(false);viewer()?.unbind();viewer()?.dispose();}catch{}frame?.remove();frame=null;loaded=false;}
  function open(){
    if(bridge.isBusy())return;
    if(bridge.isDirty()&&!ownerWindow.confirm('Descartar o rascunho e reabrir a versão salva? Você pode exportar o rascunho antes.'))return;
    if(ownerWindow.AMJRosto3D&&ownerWindow.AMJRosto3D!==bridge)throw Error('Outro estudo 3D já está aberto. Feche-o antes de continuar.');
    const url=new URL(viewerUrl,ownerWindow.location.href);if(url.origin!==ownerWindow.location.origin)throw Error('O visualizador precisa estar na mesma origem do aplicativo.');url.searchParams.set('mode',storageMode==='clinic-server'?'connected-app':'local-pilot');
    if(!bridge.discard())return;closeFrame();ownerWindow.AMJRosto3D=bridge;frame=ownerWindow.document.createElement('iframe');frame.className='facial-frame';frame.title='Modelo 3D genérico e editor de pontos desta consulta';frame.referrerPolicy='no-referrer';
    root.querySelector('[data-facial-slot]').append(frame);frame.src=url.href;
    message('Carregando o modelo externo. Na primeira abertura, aguarde a transferência dos arquivos.');
    timeout=setTimeout(()=>{if(!disposed&&!loaded)message('O visualizador ainda não ficou pronto. Verifique a conexão ou use Abrir estudo 3D para tentar novamente.');},45000);sync();
  }
  async function download(draft){
    if(bridge.isBusy()||externalBusy)throw Error('Aguarde a gravação do estudo.');
    try{externalBusy=true;sync();const doc=draft?viewer()?.getStudy():null;if(draft&&!doc)throw Error('Abra o estudo para exportar o rascunho.');
      const output=exportFacialStudyData(getState(),selection,{draft:doc,storageMode}),blob=new Blob([output.json],{type:'application/json'}),url=ownerWindow.URL.createObjectURL(blob),anchor=ownerWindow.document.createElement('a');
      anchor.href=url;anchor.download=output.filename;anchor.hidden=true;root.append(anchor);anchor.click();anchor.remove();setTimeout(()=>ownerWindow.URL.revokeObjectURL(url),30000);
      message(draft?'Exportação do rascunho iniciada. Ele ainda não foi salvo na consulta.':'Exportação das versões salvas iniciada. Confira o arquivo na pasta de downloads.');
    }finally{externalBusy=false;try{sync();}catch(error){message(error.message);}}
  }
  const click=async event=>{const button=event.target.closest?.('[data-facial]');if(!button||!root.contains(button))return;event.preventDefault();try{if(button.dataset.facial==='open')open();if(button.dataset.facial==='saved')await download(false);if(button.dataset.facial==='draft')await download(true);}catch(error){message(error.message);notify(error.message,true);}};
  root.addEventListener('click',click);sync();
  return {isDirty:()=>bridge.isDirty(),isBusy:()=>externalBusy||bridge.isBusy(),discard:()=>bridge.discard(),setActive(value){active=Boolean(value);viewer()?.setActive(active);},dispose(){if(disposed)return;disposed=true;root.removeEventListener('click',click);bridge.dispose();closeFrame();if(ownerWindow.AMJRosto3D===bridge)delete ownerWindow.AMJRosto3D;}};
}
