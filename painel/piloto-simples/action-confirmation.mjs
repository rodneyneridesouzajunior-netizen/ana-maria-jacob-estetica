// Deliberate-click guard requested by the clinic. This is NOT authentication:
// server permissions, MFA, version checks and clinical signatures still apply.
export function assertActionCode(value) {
  if (value !== '1234') throw Error('Código de confirmação incorreto. Nenhuma alteração foi feita.');
}

const collections = {
  patients:'paciente', visits:'consulta', appointments:'agendamento', bills:'cobrança',
  payments:'recebimento', expenses:'despesa', expensePayments:'pagamento de despesa',
  quotes:'orçamento', products:'produto', procedures:'procedimento', stockLots:'lote',
  documentTemplates:'modelo de documento', documentResponses:'documento', comparisons:'comparação',
};
export function destructiveChanges(before, after) {
  const changes = new Set();
  const entries=new Set((before.recycleBin||[]).map(x=>x.id));
  for(const entry of after.recycleBin||[])if(!entries.has(entry.id))changes.add('Mover para a lixeira: '+entry.label+' · '+entry.targets.length+' registro(s) vinculado(s) preservados');
  function compare(oldRows, newRows, label) {
    const next = new Map((newRows || []).map(row => [row.id, row]));
    for (const old of oldRows || []) {
      const row = next.get(old.id);
      if (!row) { changes.add('Remover '+label); continue; }
      if (old.active !== false && row.active === false) changes.add('Desativar '+label);
      if (['cancelado','cancelada','cancelled','revogado','revoked','arquivado','archived'].includes(row.status) && row.status !== old.status) changes.add('Cancelar ou arquivar '+label);
      for (const key of ['cancelledAt','canceledAt','reversedAt','deletedAt','archivedAt']) {
        if (!old[key] && row[key]) changes.add(key === 'reversedAt' ? 'Estornar '+label : 'Cancelar ou arquivar '+label);
      }
    }
  }
  for (const [key,label] of Object.entries(collections)) compare(before[key],after[key],label);
  for (const [key,label] of Object.entries({professionals:'integrante da equipe',blocks:'bloqueio de horário',holidays:'fechamento da clínica'})) compare(before.clinic?.[key],after.clinic?.[key],label);
  for (const old of before.visits || []) {
    const visit = (after.visits || []).find(row => row.id === old.id);
    if (!visit) continue;
    compare(old.photos,visit.photos,'fotografia');
    for (const [photoId,map] of Object.entries(old.maps || {})) compare(map.points,visit.maps?.[photoId]?.points,'marcação do rosto');
  }
  const movements = new Set((before.stockMovements || []).map(row=>row.id));
  if ((after.stockMovements || []).some(row=>!movements.has(row.id)&&row.type==='ajuste'&&row.deltaUnits<0)) changes.add('Reduzir estoque por ajuste manual');
  return [...changes];
}

// Evaluate the operation once (including its generated IDs), before prompting.
// The storage provider still checks the original revision atomically at commit.
export function prepareWorkspaceChange(state, update) {
  const next = structuredClone(state);
  if (update(next)?.then) throw Error('A alteração precisa ser transacional e síncrona.');
  return {base:JSON.stringify(state),next, changes:destructiveChanges(state,next)};
}

export function applyPreparedWorkspaceChange(draft,base,next){
  if(JSON.stringify(draft)!==base)throw Error('O registro mudou ou a consulta foi concluída. Reabra antes de alterar; nenhum dado foi substituído.');
  for(const key of Object.keys(draft))delete draft[key];
  Object.assign(draft,structuredClone(next));
}

export function requestActionCode(actions, {document:doc=globalThis.document, window:win=globalThis.window}={}) {
  if (!actions.length) return Promise.resolve();
  return new Promise((resolve,reject)=>{
    const previous=doc.activeElement, dialog=doc.createElement('dialog');
    dialog.className='feature-dialog';dialog.setAttribute('aria-label','Confirmar ação importante');
    dialog.innerHTML='<div class="dialog-top"><h2>Confirmar ação importante</h2></div><p data-action-summary></p><p>Digite o código de 4 dígitos para evitar uma alteração por engano. Este código não substitui seu login nem a assinatura profissional.</p><form><label class="field">Código de confirmação<input name="actionCode" type="password" inputmode="numeric" autocomplete="off" maxlength="4" pattern="[0-9]{4}" required></label><p class="error" role="alert"></p><div class="dialog-actions"><button class="secondary" type="button" data-cancel>Voltar sem alterar</button><button class="primary" type="submit">Confirmar ação</button></div></form>';
    dialog.querySelector('[data-action-summary]').textContent=actions.join(' · ');
    let settled=false;
    const finish=error=>{if(settled)return;settled=true;win?.removeEventListener('amj:connection-invalidated',expired);dialog.close();dialog.remove();if(previous?.isConnected)previous.focus();error?reject(error):resolve();};
    const cancelled=()=>finish(Error('Ação cancelada. Nenhuma alteração foi feita.'));
    const expired=()=>finish(Error('Acesso encerrado. Entre novamente antes de continuar.'));
    dialog.addEventListener('cancel',event=>{event.preventDefault();cancelled();});
    dialog.addEventListener('close',()=>{if(!settled)cancelled();});
    dialog.querySelector('[data-cancel]').addEventListener('click',cancelled);
    dialog.querySelector('form').addEventListener('submit',event=>{event.preventDefault();const input=dialog.querySelector('input');try{assertActionCode(input.value);input.value='';finish();}catch(error){dialog.querySelector('[role=alert]').textContent=error.message;input.value='';input.focus();}});
    win?.addEventListener('amj:connection-invalidated',expired);
    doc.body.append(dialog);dialog.showModal();dialog.querySelector('input').focus();
  });
}
