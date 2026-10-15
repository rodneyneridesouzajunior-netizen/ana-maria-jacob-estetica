// Portable local contract: no network, credentials, assets or storage side effects.
// Keep this registry tied to the exact v2 topology. Tests compare it with the legacy source.
export const FACIAL_MODEL_VERSION='amj-facial-20260906-v2';
export const FACIAL_MAX_BYTES=245760;
export const FACIAL_APPEARANCE_REGISTRY=Object.freeze({'makehuman-head-uv-study-2':Object.freeze({mode:'appearance',triangles:153672})});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const clone=value=>structuredClone(value);
const id=value=>typeof value==='string'&&value.length>0&&value.length<=160&&!/[\u0000-\u001f\u007f]/.test(value);
function text(value,max){if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))throw Error('Texto do estudo inválido ou muito longo.');return value.trim();}
const stamp=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
export function emptyFacialStudy(){return {schemaVersion:1,modelVersion:FACIAL_MODEL_VERSION,points:[],notes:''};}
export function validateFacialDocument(value){
  if(!plain(value)||value.schemaVersion!==1||value.modelVersion!==FACIAL_MODEL_VERSION||!Array.isArray(value.points)||value.points.length>200)throw Error('Estudo incompatível com este modelo genérico.');
  const ids=new Set();const points=value.points.map(point=>{
    if(!plain(point)||typeof point.id!=='string'||!uuid.test(point.id)||ids.has(point.id))throw Error('Identificador de ponto inválido ou repetido.');ids.add(point.id);
    const mesh=Object.hasOwn(FACIAL_APPEARANCE_REGISTRY,point.meshId)?FACIAL_APPEARANCE_REGISTRY[point.meshId]:null;
    if(point.mode!=='appearance'||!mesh||!Number.isInteger(point.triangle)||point.triangle<0||point.triangle>=mesh.triangles)throw Error('Este estudo aceita somente pontos na superfície do modelo externo.');
    if(!Array.isArray(point.barycentric)||point.barycentric.length!==3||!point.barycentric.every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=-1e-6&&n<=1.000001)||Math.abs(point.barycentric.reduce((a,b)=>a+b,0)-1)>1e-5)throw Error('Coordenadas do ponto inválidas.');
    const label=text(point.label,100);if(!label)throw Error('Escreva o nome do ponto.');
    return {id:point.id,mode:'appearance',meshId:point.meshId,triangle:point.triangle,barycentric:[...point.barycentric],label,notes:text(point.notes,2000)};
  });
  const document={schemaVersion:1,modelVersion:FACIAL_MODEL_VERSION,points,notes:text(value.notes,4000)};
  if(new TextEncoder().encode(JSON.stringify(document)).byteLength>FACIAL_MAX_BYTES)throw Error('O estudo excede o limite de 240 KiB. Reduza as observações antes de salvar.');
  return document;
}
export function ensureFacialStudies(state){if(!plain(state))throw Error('Estado local inválido.');state.facialStudies??=[];if(!Array.isArray(state.facialStudies))throw Error('Coleção de estudos 3D inválida.');return state;}
function context(state,{patientId,visitId}){
  if(!id(patientId)||!id(visitId))throw Error('Abra uma paciente e uma consulta para usar o estudo 3D.');
  const patients=(state.patients||[]).filter(p=>p.id===patientId),visits=(state.visits||[]).filter(v=>v.id===visitId);
  if(patients.length!==1||visits.length!==1||visits[0].patientId!==patientId)throw Error('O vínculo entre paciente e consulta mudou. Reabra a consulta.');
  const patient=patients[0],visit=visits[0];
  const readOnly=visit.status==='concluido'||visit.status==='cancelado'||Boolean(visit.lockedAt);
  return {patient,visit,patientId,visitId,readOnly};
}
export function validateFacialStudies(state){
  if(state.facialStudies===undefined)return true;
  if(!Array.isArray(state.facialStudies))throw Error('Coleção de estudos 3D inválida.');
  const seen=new Set(),operations=new Set(),versions=new Map();
  for(const record of state.facialStudies){
    if(!plain(record)||!id(record.id)||!uuid.test(record.id)||seen.has(record.id)||!id(record.operationId)||!uuid.test(record.operationId)||operations.has(record.operationId)||!Number.isSafeInteger(record.version)||record.version<1||!stamp(record.createdAt))throw Error('Histórico de estudos 3D inválido.');
    context(state,record);seen.add(record.id);operations.add(record.operationId);
    validateFacialDocument(record.document);
    const key=record.visitId,expected=(versions.get(key)||0)+1;
    if(record.version!==expected)throw Error('A sequência de versões do estudo 3D está incompleta.');versions.set(key,record.version);
  }
  return true;
}
export function facialStudyContext(state,selection){
  const current=context(state,selection);validateFacialStudies(state);
  const records=(state.facialStudies||[]).filter(r=>r.visitId===current.visitId);
  return {...current,version:records.at(-1)?.version||0,records:clone(records)};
}
export function latestFacialStudy(state,selection){return facialStudyContext(state,selection).records.at(-1)||null;}
export function saveFacialStudy(state,{patientId,visitId,expectedVersion,document,operationId},now=new Date()){
  const ctx=facialStudyContext(state,{patientId,visitId}),canonical=validateFacialDocument(document);
  if(!Number.isSafeInteger(expectedVersion)||expectedVersion<0||!uuid.test(operationId||''))throw Error('Operação ou versão de estudo inválida.');
  const replay=(state.facialStudies||[]).find(record=>record.operationId===operationId);
  if(replay){if(replay.patientId!==patientId||replay.visitId!==visitId||replay.version!==expectedVersion+1||JSON.stringify(replay.document)!==JSON.stringify(canonical))throw Error('Esta operação já foi usada com outro estudo.');return clone(replay);}
  if(ctx.readOnly)throw Error('Esta consulta está concluída ou bloqueada. O estudo pode ser consultado e exportado, sem alteração.');
  if(ctx.version!==expectedVersion)throw Error('Outra edição alterou este estudo. Exporte o rascunho e reabra a versão salva antes de continuar.');
  const createdAt=now instanceof Date&&Number.isFinite(+now)?now.toISOString():null;if(!createdAt)throw Error('Data da versão inválida.');
  const record={id:operationId,operationId,patientId,visitId,version:ctx.version+1,createdAt,document:canonical};
  ensureFacialStudies(state);state.facialStudies.push(record);return clone(record);
}
// Call at commit time, before persistence. Old versions cannot be rewritten or removed.
export function assertFacialHistoryPreserved(before,after){
  validateFacialStudies(after);const old=before.facialStudies||[],next=after.facialStudies||[];
  if(next.length<old.length||old.some((record,index)=>JSON.stringify(record)!==JSON.stringify(next[index])))throw Error('Versões anteriores do estudo 3D precisam ser preservadas.');
  for(const record of next.slice(old.length)){const prior=context(before,record);if(prior.readOnly)throw Error('Consulta concluída não aceita nova versão do estudo 3D.');}
  return true;
}
export function exportFacialStudyData(state,selection,{draft=null,now=new Date(),storageMode='local-browser'}={}){
  const ctx=facialStudyContext(state,selection),latest=ctx.records.at(-1);
  if(!latest&&!draft)throw Error('Ainda não há estudo salvo para exportar.');
  const output={format:'amj-generic-facial-study',schemaVersion:1,storage:storageMode==='clinic-server'?'clinic-server':'local-browser',modelKind:'generic-not-patient-reconstruction',modelVersion:FACIAL_MODEL_VERSION,patientId:ctx.patientId,visitId:ctx.visitId,exportedAt:now.toISOString(),savedVersion:ctx.version,records:ctx.records};
  if(draft)output.unsavedDraft=validateFacialDocument(draft);
  return {filename:`amj-estudo-3d-${String(ctx.visitId).replace(/[^a-z0-9_-]/gi,'_').slice(0,80)}-v${ctx.version}${draft?'-rascunho':''}.json`,data:output,json:JSON.stringify(output,null,2)};
}
