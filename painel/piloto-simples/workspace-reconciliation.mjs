/** Reconciliation is deliberately narrower than the operational schema.
 * It transports whole, independently edited records onto a newer workspace.
 * It never authorizes a write; the server validates the resulting transition. */
const editable=new Set(['patients','visits','appointments']);
const history='patientHistory';
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const clone=value=>structuredClone(value);
const stable=value=>JSON.stringify(value,(_key,item)=>plain(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const same=(a,b)=>stable(a)===stable(b);
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,179}$/.test(value)&&!['constructor','prototype','__proto__'].includes(value);

export class WorkspaceReconciliationError extends Error {
 constructor(code,message,conflicts=[]){super(message);this.name='WorkspaceReconciliationError';this.code=code;this.conflicts=conflicts;}
}
const fail=(code,message,conflicts)=>{throw new WorkspaceReconciliationError(code,message,conflicts);};
const unsupported=message=>fail('reconciliation_unsupported',message);
function records(value,key){
 if(!Array.isArray(value))unsupported('A coleção '+key+' não possui estrutura compatível.');
 const result=new Map();for(const row of value){if(!plain(row)||!validId(row.id)||result.has(row.id))unsupported('Há identificadores incompatíveis em '+key+'.');result.set(row.id,row);}return result;
}
function plan(base,candidate){
 if(!plain(base)||!plain(candidate)||base.schema!==1||candidate.schema!==base.schema||!Number.isSafeInteger(base.revision)||base.revision<0||candidate.revision!==base.revision)unsupported('A revisão original do rascunho não foi preservada.');
 const changes=[];
 for(const key of new Set([...Object.keys(base),...Object.keys(candidate)])){
  if(same(base[key],candidate[key]))continue;
  if(!editable.has(key)&&key!==history)unsupported('Esta alteração inclui '+key+'. Confira o rascunho; esta coleção ainda não aceita reconciliação automática.');
  if(key===history)continue;
  const before=records(base[key],key),after=records(candidate[key],key);
  if([...before.keys()].some(id=>!after.has(id)))unsupported('Remoções de registros não aceitam reconciliação automática.');
  if(!same([...before.keys()],[...after.keys()].filter(id=>before.has(id))))unsupported('Reordenação de registros não aceita reconciliação automática.');
  for(const [id,row]of after){if(same(before.get(id),row))continue;
   if(key==='visits'){
    const previous=before.get(id);if([previous,row].some(v=>v&&(v.lockedAt||v.completedAt||v.cancelledAt||['concluido','cancelado'].includes(v.status))))unsupported('Conclusões, cancelamentos e adendos clínicos precisam de revisão própria; este rascunho foi preservado.');
    if(!same(previous?.photos||[],row.photos||[]))unsupported('Envio ou alteração de fotografias precisa de conferência própria; o rascunho foi preservado.');
   }
   changes.push({collection:key,id,before:before.get(id),after:row});
  }
 }
 if(!changes.length)unsupported('Não há alteração independente de paciente, consulta em rascunho ou agenda para reaplicar.');
 const prior=base[history]||[],next=candidate[history]||[];records(prior,history);records(next,history);
 if(next.length<prior.length||!prior.every((row,i)=>same(row,next[i])))unsupported('O histórico do cadastro anterior deve permanecer integralmente preservado.');
 const additions=next.slice(prior.length),patients=new Set(changes.filter(c=>c.collection==='patients').map(c=>c.id));
 if(additions.some(row=>!patients.has(row.patientId)))unsupported('O histórico novo não corresponde aos cadastros alterados neste rascunho.');
 return {changes,additions};
}

/** Cheap capability check: no server version or clinical content is exposed. */
export function reconciliationAvailability(base,candidate){
 try{plan(base,candidate);return{canReconcile:true,reason:null};}
 catch(error){if(error instanceof WorkspaceReconciliationError)return{canReconcile:false,reason:error.message};throw error;}
}

export function reconcileWorkspaceRecords(base,candidate,latest){
 const prepared=plan(base,candidate);
 if(!plain(latest)||latest.schema!==base.schema||!Number.isSafeInteger(latest.revision)||latest.revision<=base.revision)fail('reconciliation_revision','O servidor ainda não confirmou uma revisão posterior à do rascunho.');
 const conflicts=[],seen=new Set(),recordConflict=(collection,id)=>{const key=collection+'\0'+id;if(!seen.has(key)){seen.add(key);conflicts.push({collection,id});}};
 for(const change of prepared.changes){
  const current=records(latest[change.collection],change.collection).get(change.id);
  // Even identical final values do not prove who saved the pending intention.
  if(!same(current,change.before))recordConflict(change.collection,change.id);
  if(change.collection==='visits'||change.collection==='appointments'){
   for(const [collection,id]of [['patients',change.after.patientId],['appointments',change.collection==='visits'?change.after.appointmentId:null],['procedures',change.after.procedureId]]){
    if(!id)continue;const original=records(base[collection],collection).get(id),server=records(latest[collection],collection).get(id);
    if(!same(original,server))recordConflict(collection,id);
   }
   if(!same(base.clinic,latest.clinic))recordConflict('clinic','configuration');
  }
 }
 const oldHistory=base[history]||[],serverHistory=latest[history]||[],serverIds=records(serverHistory,history);
 if(serverHistory.length<oldHistory.length||!oldHistory.every((row,i)=>same(row,serverHistory[i])))recordConflict(history,'history');
 for(const row of prepared.additions)if(serverIds.has(row.id))recordConflict(history,row.id);
 if(conflicts.length)fail('reconciliation_conflict','O servidor também alterou um registro ou vínculo deste rascunho. Os campos não foram combinados; preserve a edição e confira as duas versões.',conflicts);
 const merged=clone(latest);
 for(const change of prepared.changes){const rows=merged[change.collection],index=rows.findIndex(row=>row.id===change.id);if(index<0)rows.push(clone(change.after));else rows[index]=clone(change.after);}
 if(prepared.additions.length)merged[history]=[...clone(serverHistory),...clone(prepared.additions)];
 // Independent IDs still share uniqueness rules. Do not combine two new
 // identities with one CPF, or two independently opened visits for one slot.
 const cpfs=new Map(),appointments=new Map();
 for(const patient of merged.patients){const cpf=String(patient.cpf||'').replace(/\D/g,'');if(!cpf)continue;if(cpfs.has(cpf)){recordConflict('patients',patient.id);recordConflict('patients',cpfs.get(cpf));}else cpfs.set(cpf,patient.id);}
 for(const visit of merged.visits){if(!visit.appointmentId)continue;if(appointments.has(visit.appointmentId)){recordConflict('visits',visit.id);recordConflict('visits',appointments.get(visit.appointmentId));}else appointments.set(visit.appointmentId,visit.id);}
 if(conflicts.length)fail('reconciliation_conflict','As alterações independentes colidem em um CPF ou vínculo de agendamento. Nenhuma nova gravação foi enviada; o rascunho foi preservado.',conflicts);
 return{state:merged,changes:prepared.changes.map(({collection,id})=>({collection,id})),baseRevision:base.revision,latestRevision:latest.revision};
}
