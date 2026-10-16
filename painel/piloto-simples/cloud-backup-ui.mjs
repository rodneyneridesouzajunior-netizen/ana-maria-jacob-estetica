import {buildCloudBackup,verifyCloudBackup,serializeCloudBackup,cloudBackupFilename,validateCloudBackupPassword,CLOUD_BACKUP_LIMITS} from './cloud-backup.mjs';

const cancelled=()=>Object.assign(new Error('Operação cancelada.'),{code:'backup_cancelled'});
function abortable(task,signal){
  if(signal.aborted)return Promise.reject(signal.reason||cancelled());
  return new Promise((resolve,reject)=>{
    const abort=()=>reject(signal.reason||cancelled());signal.addEventListener('abort',abort,{once:true});
    Promise.resolve(task).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
  });
}

/** Mount inside #ajustes. readSnapshot must be the authenticated cloud-store
 * method; dispose/invalidate must run when its session ends. No restore action. */
export function mountCloudBackup(host,{readSnapshot,clinicId,getClinicId=()=>clinicId,eventTarget=globalThis,timeoutMs=120000,download,notify=()=>{}}={}){
  if(!host?.ownerDocument||typeof readSnapshot!=='function')throw Error('Exportação conectada exige uma sessão e um destino válidos.');
  const doc=host.ownerDocument,id='cloud-backup-'+crypto.randomUUID();
  let disposed=false,invalidated=false,busy=false,generation=0,controller=null,timer=null;
  const urls=new Set(),urlTimers=new Set();
  host.innerHTML=`<section class="card card-body feature-section" aria-labelledby="${id}-title" data-cloud-backup>
    <h2 id="${id}-title">Cópia de segurança da clínica</h2>
    <p>Exporte os dados do aplicativo e as fotografias privadas em um arquivo protegido por senha.</p>
    <p class="small-label">Inclui pacientes, agenda, registros de atendimento, mapas de pontos, comparações, catálogo, estoque, financeiro e rascunhos presentes no workspace, além das fotos originais e prévias. Os PDFs oficiais de anamnese e consentimento e a auditoria do servidor ficam fora desta cópia. Este arquivo não os restaura.</p>
    <p class="small-label">Esta tela exporta e verifica arquivos; não substitui nem restaura dados no servidor. Limite atual: 80 MB de fotos, somando originais e prévias.</p>
    <form data-cloud-backup-export autocomplete="off">
      <h3>Exportar arquivo protegido</h3>
      <div class="field-grid">
        <label for="${id}-password">Senha do arquivo<input id="${id}-password" name="password" type="password" minlength="12" maxlength="128" autocomplete="new-password" required aria-describedby="${id}-password-help"></label>
        <label for="${id}-confirm">Confirme a senha<input id="${id}-confirm" name="confirmation" type="password" minlength="12" maxlength="128" autocomplete="new-password" required></label>
      </div>
      <p id="${id}-password-help" class="small-label">Use 12 a 128 caracteres; prefira uma frase longa e exclusiva. Guarde a senha separada do arquivo. Ela não é enviada nem salva pelo aplicativo e não pode ser recuperada por esta tela.</p>
      <button class="primary" type="submit">Exportar cópia criptografada</button>
    </form>
    <form data-cloud-backup-verify autocomplete="off">
      <h3>Verificar um arquivo salvo</h3>
      <div class="field-grid">
        <label for="${id}-file">Arquivo da clínica<input id="${id}-file" name="backup" type="file" accept=".amjbackup,application/json" required></label>
        <label for="${id}-verify-password">Senha do arquivo<input id="${id}-verify-password" name="password" type="password" minlength="12" maxlength="128" autocomplete="off" required></label>
      </div>
      <button class="secondary" type="submit">Abrir e verificar arquivo</button>
      <p class="small-label">A conferência acontece neste aparelho. O arquivo e a senha não são enviados ao servidor.</p>
    </form>
    <button class="secondary" type="button" data-cloud-backup-cancel hidden>Cancelar operação</button>
    <p data-cloud-backup-status role="status" aria-live="polite" aria-atomic="true"></p>
    <div data-cloud-backup-result hidden></div>
  </section>`;
  const exportForm=host.querySelector('[data-cloud-backup-export]'),verifyForm=host.querySelector('[data-cloud-backup-verify]'),status=host.querySelector('[data-cloud-backup-status]'),result=host.querySelector('[data-cloud-backup-result]'),cancel=host.querySelector('[data-cloud-backup-cancel]');
  const active=turn=>!disposed&&!invalidated&&generation===turn;
  const passwords=()=>host.querySelectorAll('input[type=password]');
  const clearPasswords=()=>passwords().forEach(field=>{field.value='';});
  function show(message,error=false){if(disposed||invalidated)return;status.textContent=message;status.className=error?'error':'';}
  function controls(){for(const field of host.querySelectorAll('input,button[type=submit]'))field.disabled=busy||invalidated;cancel.hidden=!busy;host.querySelector('[data-cloud-backup]')?.setAttribute('aria-busy',String(busy));}
  function clearResult(){result.replaceChildren();result.hidden=true;}
  function summary(value,matched){
    clearResult();result.hidden=false;
    const title=doc.createElement('strong');title.textContent='Arquivo íntegro e aberto com a senha informada.';result.append(title);
    const details=doc.createElement('p');details.className='small-label';const s=value.summary;
    details.textContent=`${s.patients} pacientes · ${s.visits} atendimentos · ${s.appointments} agendamentos · ${s.photos} fotografias · revisão ${s.revision}.`;result.append(details);
    const meta=doc.createElement('p');meta.className='small-label';meta.textContent=`Clínica: ${value.metadata.clinicId}. Criado em ${new Date(value.metadata.createdAt).toLocaleString('pt-BR')}. ${matched?'Clínica conferida com a sessão atual.':'Identificador do arquivo informado; não comparado com a sessão atual.'}`;result.append(meta);
    const hash=doc.createElement('p');hash.className='small-label';hash.style.overflowWrap='anywhere';hash.textContent='SHA-256 dos dados: '+value.metadata.dataHash;result.append(hash);
    const note=doc.createElement('p');note.className='small-label';note.textContent='Nenhum registro foi importado ou alterado. PDFs oficiais e auditoria do servidor não estão incluídos.';result.append(note);
  }
  function saveFile(blob,filename){
    if(download)return download(blob,filename);
    const url=URL.createObjectURL(blob);urls.add(url);const link=doc.createElement('a');link.href=url;link.download=filename;link.hidden=true;doc.body.append(link);link.click();link.remove();
    const t=setTimeout(()=>{URL.revokeObjectURL(url);urls.delete(url);urlTimers.delete(t);},30000);urlTimers.add(t);
  }
  async function run(kind){
    if(disposed||invalidated||busy)return;
    let password=(kind==='export'?exportForm:verifyForm).elements.password.value;
    let expectedClinicId,file;
    try{
      expectedClinicId=getClinicId?.();
      validateCloudBackupPassword(password);
      if(kind==='export'&&password!==exportForm.elements.confirmation.value)throw Error('As duas senhas precisam ser iguais.');
      if(kind==='verify'){
        file=verifyForm.elements.backup.files?.[0];
        if(!file)throw Error('Selecione o arquivo salvo para verificar.');
        if(file.size>CLOUD_BACKUP_LIMITS.fileBytes)throw Error('Arquivo acima do limite de 160 MB.');
      }
    }catch(error){show(error.message,true);return;}
    clearPasswords();clearResult();busy=true;controls();const turn=++generation;controller=new AbortController();const signal=controller.signal;
    timer=setTimeout(()=>controller?.abort(Object.assign(new Error('A operação excedeu o tempo disponível. Aguarde a leitura terminar e tente novamente.'),{code:'backup_timeout'})),timeoutMs);
    show(kind==='export'?'Lendo os dados e conferindo as fotografias do servidor…':'Abrindo e conferindo o arquivo neste aparelho…');
    try{
      if(kind==='export'){
        const snapshot=await abortable(readSnapshot(),signal);if(!active(turn)||signal.aborted)throw cancelled();
        show('Criptografando e verificando a cópia antes do download…');
        const envelope=await abortable(buildCloudBackup(snapshot,{password,expectedClinicId,signal}),signal);
        const serialized=serializeCloudBackup(envelope);
        const verified=await abortable(verifyCloudBackup(serialized,{password,expectedClinicId:snapshot.clinicId,signal}),signal);
        if(!active(turn)||signal.aborted)throw cancelled();
        const latestClinic=getClinicId?.();if(expectedClinicId!==latestClinic)throw Error('A clínica mudou durante a exportação. Entre novamente.');
        saveFile(new Blob([serialized],{type:'application/json'}),cloudBackupFilename(envelope));
        if(!active(turn))return;summary(verified,true);show('Arquivo conferido e enviado para download. Selecione a cópia salva abaixo para conferir o arquivo do seu aparelho.');
        notify('Cópia criptografada preparada para download.');
      }else{
        const text=await abortable(file.text(),signal);
        const verified=await abortable(verifyCloudBackup(text,{password,expectedClinicId,signal}),signal);
        if(!active(turn)||signal.aborted)throw cancelled();
        if(expectedClinicId!==getClinicId?.())throw Error('A clínica mudou durante a conferência. Entre novamente.');
        summary(verified,Boolean(expectedClinicId));verifyForm.reset();show('Verificação concluída. Os dados do servidor permanecem inalterados.');
      }
    }catch(error){if(active(turn)){const reason=signal.aborted?signal.reason:error;show(reason?.code==='backup_cancelled'?'Operação cancelada. Nenhum arquivo foi baixado.':reason?.message||'Não foi possível concluir a operação.',true);}}
    finally{password='';clearTimeout(timer);timer=null;if(active(turn)){busy=false;controller=null;clearPasswords();controls();}}
  }
  const submit=event=>{if(event.target!==exportForm&&event.target!==verifyForm)return;event.preventDefault();void run(event.target===exportForm?'export':'verify');};
  const click=event=>{if(event.target.closest('[data-cloud-backup-cancel]'))controller?.abort(cancelled());};
  function revoke(){for(const t of urlTimers)clearTimeout(t);urlTimers.clear();for(const url of urls)URL.revokeObjectURL(url);urls.clear();}
  function invalidate(){if(disposed||invalidated)return;invalidated=true;generation++;controller?.abort(cancelled());controller=null;clearTimeout(timer);timer=null;busy=false;clearPasswords();verifyForm.reset();clearResult();revoke();controls();status.textContent='Acesso encerrado. Entre novamente para exportar ou verificar arquivos.';}
  host.addEventListener('submit',submit);host.addEventListener('click',click);eventTarget?.addEventListener?.('amj:connection-invalidated',invalidate);
  return Object.freeze({isBusy:()=>busy,isDirty:()=>!disposed&&!invalidated&&(Array.from(passwords()).some(field=>field.value.length>0)||Boolean(verifyForm.elements.backup.files?.length)),discard(){if(busy)return false;clearPasswords();verifyForm.reset();clearResult();return true;},invalidate,dispose(){if(disposed)return;invalidate();disposed=true;host.removeEventListener('submit',submit);host.removeEventListener('click',click);eventTarget?.removeEventListener?.('amj:connection-invalidated',invalidate);host.replaceChildren();}});
}
