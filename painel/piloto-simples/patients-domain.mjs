import {dateKey} from './domain.mjs';

export const PATIENT_COLORS=['auto','blue','green','amber','orange','red','purple','teal','slate'];
export const PATIENT_COLOR_LABELS={auto:'Automática',blue:'Azul',green:'Verde',amber:'Amarelo',orange:'Laranja',red:'Vermelho',purple:'Roxo',teal:'Turquesa',slate:'Grafite'};
export const BRAZIL_STATES=['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
export const PATIENT_FILTERS=['all','returns','over90'];
const id=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,179}$/.test(value)&&!['constructor','prototype','__proto__'].includes(value);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const timestamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const civil=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(+new Date(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
const normalize=value=>String(value??'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().trim();
const digits=value=>String(value??'').replace(/\D/g,'');
const fields={name:140,phone:25,email:254,cpf:14,birthDate:10,notes:5000,postalCode:9,address:300,addressNumber:30,complement:120,neighborhood:120,city:120,state:2,color:10};
const versionOf=patient=>patient.version??1;

export function validCPF(value){const raw=String(value??'').trim();if(raw&&!/^[\d.\-\s]+$/.test(raw))return false;const cpf=digits(value);if(!cpf)return true;if(cpf.length!==11||/^(\d)\1+$/.test(cpf))return false;for(let n=9;n<11;n++){let sum=0;for(let i=0;i<n;i++)sum+=Number(cpf[i])*(n+1-i);const digit=(sum*10%11)%10;if(digit!==Number(cpf[n]))return false;}return true;}
export function patientColor(patient){return PATIENT_COLORS.includes(patient?.color)?patient.color:'auto';}

/** Read-only validator shared with backup. Missing additive fields remain valid for old records. */
export function validatePatientRecord(patient,{today=dateKey()}={}){
 if(!plain(patient)||!id(patient.id)||typeof patient.name!=='string'||patient.name.trim().length<2||patient.name.length>140)throw Error('Confira o identificador e o nome da paciente.');
 for(const [field,max]of Object.entries(fields))if(patient[field]!==undefined&&(typeof patient[field]!=='string'||patient[field].length>max))throw Error('Campo de cadastro inválido: '+field+'.');
 if(!civil(today))throw Error('Referência de data inválida.');
 const {phone='',email='',cpf='',birthDate='',postalCode='',state='',color='auto'}=patient;
 if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('E-mail inválido.');
 if(phone&&(!/^\+?[\d\s()\-]{8,25}$/.test(phone)||!/^\d{8,15}$/.test(digits(phone))))throw Error('Telefone inválido.');
 if(!validCPF(cpf))throw Error('CPF inválido.');
 if(birthDate&&(!civil(birthDate)||birthDate>today))throw Error('Data de nascimento inválida.');
 if(postalCode&&!/^(?:\d{8}|\d{5}-\d{3})$/.test(postalCode))throw Error('CEP inválido. Informe oito dígitos ou deixe em branco.');
 if(state&&!BRAZIL_STATES.includes(state))throw Error('Selecione uma UF válida.');
 if(!PATIENT_COLORS.includes(color))throw Error('Selecione uma cor válida.');
 if(patient.version!==undefined&&(!Number.isSafeInteger(patient.version)||patient.version<1))throw Error('Versão de cadastro inválida.');
 for(const key of ['createdAt','updatedAt'])if(patient[key]!==undefined&&!timestamp(patient[key]))throw Error('Data de cadastro inválida.');
 if(patient.createdAt&&patient.updatedAt&&Date.parse(patient.updatedAt)<Date.parse(patient.createdAt))throw Error('Datas de cadastro inconsistentes.');
 return patient;
}

/** Preserves old calls. The new editor always supplies expectedVersion and operationId. */
export function savePatient(s,item,{expectedVersion,operationId,now=new Date().toISOString(),today=dateKey()}={}){
 if(!Array.isArray(s.patients)||s.patientHistory!==undefined&&!Array.isArray(s.patientHistory))throw Error('Cadastro ou histórico de pacientes incompatível.');
 if(!plain(item)||!id(item.id)||!timestamp(now))throw Error('Identificador ou data do cadastro inválidos.');
 const old=s.patients.find(p=>p.id===item.id),value={...old,...item};
 for(const field of Object.keys(fields))value[field]=String(value[field]??'').trim();
 if(!validCPF(value.cpf))throw Error('CPF inválido.');value.email=value.email.toLowerCase();value.cpf=digits(value.cpf);value.postalCode=value.postalCode.replace('-','');value.state=value.state.toUpperCase();value.color=value.color||'auto';
 const wantedVersion=expectedVersion??item.version;
 const payload=JSON.stringify([item.id,wantedVersion??null,Object.fromEntries(Object.keys(fields).map(key=>[key,value[key]]))]);
 if(operationId!==undefined){if(!id(operationId))throw Error('Operação de cadastro inválida.');const previous=(s.patientHistory||[]).find(h=>h.operationId===operationId);if(previous){if(previous.fingerprint!==payload||previous.patientId!==item.id)throw Error('Esta operação já foi usada com outros dados.');const current=s.patients.find(p=>p.id===item.id);if(!current)throw Error('Cadastro salvo não encontrado.');return structuredClone(current);}}
 if(wantedVersion!==undefined&&wantedVersion!==(old?versionOf(old):0))throw Error('O cadastro mudou. Reabra a versão atual antes de salvar.');
 value.version=(old?versionOf(old):0)+1;value.createdAt=old?.createdAt||now;value.updatedAt=now;delete value.expectedVersion;delete value.operationId;
 validatePatientRecord(value,{today});
 if(value.cpf&&s.patients.some(p=>p.id!==item.id&&digits(p.cpf)===value.cpf))throw Error('Já existe uma paciente com este CPF. Abra o cadastro existente.');
 const previous=old?structuredClone(old):null,snapshot=structuredClone(value),entry={id:crypto.randomUUID(),schemaVersion:2,patientId:value.id,action:old?'cadastro_corrigido':'cadastro_criado',at:now,previous,snapshot,...(operationId?{operationId,fingerprint:payload}:{})};
 if(old)Object.assign(old,value);else s.patients.push(value);s.patientHistory??=[];s.patientHistory.push(entry);return structuredClone(value);
}

export function validatePatientHistory(state,{today=dateKey()}={}){
 if(state.patientHistory===undefined)return;const history=state.patientHistory;if(!Array.isArray(history))throw Error('Histórico de cadastro incompatível.');const ids=new Set(),operations=new Set();
 for(const entry of history){if(!plain(entry)||!id(entry.id)||ids.has(entry.id)||!state.patients.some(p=>p.id===entry.patientId)||!timestamp(entry.at)||!['cadastro_criado','cadastro_corrigido'].includes(entry.action)||!plain(entry.snapshot)||entry.snapshot.id!==entry.patientId)throw Error('Histórico de paciente inválido.');ids.add(entry.id);validatePatientRecord(entry.snapshot,{today});if(entry.previous!==null){if(!plain(entry.previous)||entry.previous.id!==entry.patientId)throw Error('Paciente divergente no histórico.');validatePatientRecord(entry.previous,{today});}if(entry.action==='cadastro_criado'&&entry.previous!==null||entry.action==='cadastro_corrigido'&&entry.previous===null)throw Error('Ação de cadastro incompatível com o histórico.');if(entry.schemaVersion===2&&entry.snapshot.version!==(entry.previous?versionOf(entry.previous)+1:1))throw Error('Sequência de versões de paciente inválida.');if(entry.operationId!==undefined){if(!id(entry.operationId)||operations.has(entry.operationId)||typeof entry.fingerprint!=='string'||!entry.fingerprint||entry.fingerprint.length>10000)throw Error('Operação de cadastro inválida no histórico.');operations.add(entry.operationId);}}
}

export function patientMatches(patient,query){const text=normalize(query),numeric=digits(query);return [patient.name,patient.email,patient.phone,patient.cpf,patient.city,patient.neighborhood,patient.address,patient.postalCode].some(value=>normalize(value).includes(text))||numeric.length>=3&&/^[\d\s()+.\-]+$/.test(String(query).trim())&&[patient.phone,patient.cpf,patient.postalCode].some(value=>digits(value).includes(numeric));}

/** Explicit local rule, not an assertion about SkinPRO's unpublished calculation. */
export function patientActivity(state,patientId,{today=dateKey()}={}){
 if(!civil(today))throw Error('Referência de data inválida.');
 const visits=(state.visits||[]).filter(v=>v.patientId===patientId),completed=visits.filter(v=>v.status==='concluido'&&civil(v.date)&&v.date<=today).sort((a,b)=>b.date.localeCompare(a.date)),lastCompletedDate=completed[0]?.date||null;
 const pendingReturns=(state.expectedReturns||[]).filter(r=>r.patientId===patientId&&r.status==='previsto'&&civil(r.date)&&visits.some(v=>v.id===(r.sourceVisitId||r.visitId))).sort((a,b)=>a.date.localeCompare(b.date));
 const daysSinceLastCompleted=lastCompletedDate?Math.round((Date.parse(today+'T12:00:00Z')-Date.parse(lastCompletedDate+'T12:00:00Z'))/86400000):null;
 return{visitsCount:visits.length,lastCompletedDate,daysSinceLastCompleted,over90:daysSinceLastCompleted!==null&&daysSinceLastCompleted>90,pendingReturns,nextReturn:pendingReturns[0]||null};
}
export function selectPatients(state,{query='',filter='all',color='all',today=dateKey()}={}){
 if(!PATIENT_FILTERS.includes(filter)||color!=='all'&&!PATIENT_COLORS.includes(color))throw Error('Filtro de pacientes inválido.');
 return(state.patients||[]).map(patient=>({patient,activity:patientActivity(state,patient.id,{today})})).filter(({patient,activity})=>patientMatches(patient,query)&&(color==='all'||patientColor(patient)===color)&&(filter==='all'||filter==='returns'&&activity.pendingReturns.length>0||filter==='over90'&&activity.over90)).sort((a,b)=>(b.patient.updatedAt||b.patient.createdAt||'').localeCompare(a.patient.updatedAt||a.patient.createdAt||'')||a.patient.name.localeCompare(b.patient.name,'pt-BR'));
}
