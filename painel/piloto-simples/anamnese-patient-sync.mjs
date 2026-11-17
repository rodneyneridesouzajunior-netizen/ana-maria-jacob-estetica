// Liga a anamnese recebida pelo site ao cadastro da paciente: cria o cadastro que falta e completa
// CPF, data de nascimento e WhatsApp que estiverem em branco. Nunca troca um dado já preenchido.
import {savePatient,validCPF} from './patients-domain.mjs';

const digits=value=>String(value??'').replace(/\D/g,'');
const fold=value=>String(value??'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').trim().replace(/\s+/g,' ');
const civil=(value,today)=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value&&value<=today;
export const SYNC_STORAGE_KEY='amj.anamnese-cadastro.v1';

/** Identidade vinda do servidor → campos do cadastro, só com o que é válido. */
export function identityFields(identity,{today}){
  const name=String(identity?.name??'').trim().replace(/\s+/g,' '),cpf=digits(identity?.cpf),phone=digits(identity?.phone);
  return{name:name.length>=2&&name.length<=140?name:'',cpf:cpf.length===11&&validCPF(cpf)?cpf:'',birthDate:civil(identity?.birth_date,today)?identity.birth_date:'',phone:phone.length>=10&&phone.length<=13?phone:''};
}
/** Cadastro que corresponde à anamnese: primeiro pelo CPF; sem CPF no cadastro, por nome igual e nascimento compatível. */
export function findPatientForIdentity(patients,fields){
  if(fields.cpf){const byCpf=patients.find(p=>digits(p.cpf)===fields.cpf);if(byCpf)return{patient:byCpf,by:'cpf'};}
  const name=fold(fields.name),same=patients.filter(p=>!digits(p.cpf)&&fold(p.name)===name&&(!p.birthDate||!fields.birthDate||p.birthDate===fields.birthDate));
  return same.length===1?{patient:same[0],by:'name'}:null;
}
/** Decide o que fazer com uma anamnese: criar cadastro, completar campos vazios ou nada. */
export function planPatientFromIdentity(patients,identity,{today}){
  const fields=identityFields(identity,{today});if(!fields.name||!fields.cpf)return{action:'skip',reason:'A anamnese não tem nome e CPF válidos.'};
  const found=findPatientForIdentity(patients,fields);if(!found)return{action:'create',data:fields,name:fields.name};
  const patient=found.patient,patch={},conflicts=[];
  if(!digits(patient.cpf))patch.cpf=fields.cpf;
  if(!patient.birthDate&&fields.birthDate)patch.birthDate=fields.birthDate;else if(patient.birthDate&&fields.birthDate&&patient.birthDate!==fields.birthDate)conflicts.push('data de nascimento');
  if(!digits(patient.phone)&&fields.phone)patch.phone=fields.phone;
  if(found.by==='cpf'&&fold(patient.name)!==fold(fields.name))conflicts.push('nome');
  return{action:Object.keys(patch).length?'update':'none',patient,patch,conflicts,name:patient.name};
}
/** Aplica o plano no estado (dentro de um salvamento do app). */
export function applyPatientPlan(state,plan,{today,operationId=crypto.randomUUID(),patientId=crypto.randomUUID()}={}){
  if(plan.action==='create')return savePatient(state,{id:patientId,...plan.data},{expectedVersion:0,operationId,today});
  if(plan.action==='update'){const current=state.patients.find(p=>p.id===plan.patient.id);if(!current)throw Error('Cadastro não encontrado.');const patch={};for(const [key,value] of Object.entries(plan.patch))if(!String(current[key]??'').trim())patch[key]=value;if(!Object.keys(patch).length)return current;return savePatient(state,{...current,...patch},{expectedVersion:current.version??1,operationId,today});}
  return null;
}
/** Pela lista (com CPF e telefone mascarados), diz se ainda falta trazer os dados desta anamnese. */
export function needsPatientData(patients,document){
  const identity=document?.identity||{},name=fold(identity.name),tail=digits(identity.cpf_masked);if(!name||tail.length<2)return false;
  const match=patients.find(p=>fold(p.name)===name&&digits(p.cpf).length===11&&digits(p.cpf).endsWith(tail));
  if(!match)return true;if(!match.birthDate&&identity.birth_date)return true;return !digits(match.phone)&&digits(identity.phone_masked).length>0;
}
function readDone(storage){try{const list=JSON.parse(storage?.getItem(SYNC_STORAGE_KEY)||'[]');return new Set(Array.isArray(list)?list.filter(x=>typeof x==='string'):[]);}catch{return new Set();}}
function writeDone(storage,done){try{storage?.setItem(SYNC_STORAGE_KEY,JSON.stringify([...done].slice(-500)));}catch{/* armazenamento indisponível: apenas repete a conferência depois */}}

/**
 * Confere as anamneses recebidas e alimenta os cadastros. Devolve o que foi criado, completado e divergente.
 * service: ponte clínica (listDocuments + documentIdentity). persist(update): salvamento do app.
 */
export async function syncAnamnesePatients({service,getState,persist,storage,today,limit=50}){
  const result={created:[],updated:[],conflicts:[],checked:0,failed:''};
  if(typeof service?.listDocuments!=='function'||typeof service?.documentIdentity!=='function')return{...result,failed:'unsupported'};
  const listing=await service.listDocuments({limit});const done=readDone(storage);
  const pending=(listing?.documents||[]).filter(d=>d&&d.source_kind==='anamnese'&&d.type==='anamnese'&&d.status==='recebido'&&!d.archived&&!d.withdrawn&&!done.has(d.source_id)&&needsPatientData(getState().patients||[],d));
  for(const document of pending){
    let answer;try{answer=await service.documentIdentity({source_kind:document.source_kind,source_id:document.source_id,expected_source_fingerprint:document.source_fingerprint});}
    catch(error){result.failed=error?.code||'failed';break;}
    result.checked++;const plan=planPatientFromIdentity(getState().patients||[],answer?.identity,{today});
    if(plan.action==='create'||plan.action==='update'){
      try{await persist(state=>{applyPatientPlan(state,planPatientFromIdentity(state.patients||[],answer.identity,{today}),{today});});}
      catch(error){result.failed=error?.message||'failed';break;}
      (plan.action==='create'?result.created:result.updated).push(plan.name);
    }
    if(plan.conflicts?.length)result.conflicts.push(`${plan.name}: ${plan.conflicts.join(' e ')} diferente(s) da anamnese`);
    done.add(document.source_id);writeDone(storage,done);
  }
  return result;
}
/** Texto curto para avisar o que mudou. '' quando nada mudou. */
export function describeSync(result){
  const parts=[];if(result.created.length)parts.push(`${result.created.length===1?'Cadastro criado':'Cadastros criados'} pela anamnese: ${result.created.join(', ')}`);
  if(result.updated.length)parts.push(`${result.updated.length===1?'Cadastro completado':'Cadastros completados'} pela anamnese: ${result.updated.join(', ')}`);
  if(result.conflicts.length)parts.push(`Confira: ${result.conflicts.join('; ')}`);
  return parts.join('. ')+(parts.length?'.':'');
}
