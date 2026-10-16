import {buildBackup, verifyBackup, backupHash} from './backup.mjs';

export const CLOUD_BACKUP_FORMAT = 'amj-clinic-backup-encrypted';
export const CLOUD_BACKUP_VERSION = 1;
export const CLOUD_BACKUP_SCOPE = 'clinica-servidor';
export const CLOUD_BACKUP_LIMITS = Object.freeze({passwordMin:12,passwordMax:128,photoBytes:80*1024*1024,payloadBytes:120*1024*1024,fileBytes:160*1024*1024,pbkdf2Iterations:600000});
const encoder=new TextEncoder(), decoder=new TextDecoder('utf-8',{fatal:true});
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const fail=(code,message)=>Object.assign(new Error(message),{code});
const check=signal=>{if(signal?.aborted)throw fail('backup_cancelled','Operação cancelada.');};
const exactKeys=(value,keys)=>plain(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
function bytes64(bytes){let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(binary);}
function unbase64(value,max,exact){
  if(typeof value!=='string'||!value.length||value.length>Math.ceil(max/3)*4||value.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))throw fail('backup_format','Arquivo criptografado inválido.');
  const bytes=Uint8Array.from(atob(value),c=>c.charCodeAt(0));
  if(bytes.length>max||(exact!==undefined&&bytes.length!==exact)||bytes64(bytes)!==value)throw fail('backup_format','Arquivo criptografado inválido.');
  return bytes;
}
export function validateCloudBackupPassword(password){
  if(typeof password!=='string'||Array.from(password).length<CLOUD_BACKUP_LIMITS.passwordMin||Array.from(password).length>CLOUD_BACKUP_LIMITS.passwordMax||!password.trim())throw fail('backup_password','Use uma senha de 12 a 128 caracteres. Prefira uma frase longa e exclusiva.');
  return password;
}
function validDate(value){if(typeof value!=='string')return false;const date=new Date(value);return Number.isFinite(+date)&&date.toISOString()===value;}
function metadata(value){
  if(value.format!==CLOUD_BACKUP_FORMAT||value.version!==CLOUD_BACKUP_VERSION||value.scope!==CLOUD_BACKUP_SCOPE||!uuid(value.clinicId)||!validDate(value.createdAt)||value.cipher!=='AES-256-GCM'||!exactKeys(value.kdf,['name','hash','iterations','salt'])||value.kdf.name!=='PBKDF2'||value.kdf.hash!=='SHA-256'||value.kdf.iterations!==CLOUD_BACKUP_LIMITS.pbkdf2Iterations)throw fail('backup_format','Este arquivo não é uma cópia criptografada compatível da clínica.');
  unbase64(value.kdf.salt,16,16);unbase64(value.iv,12,12);
  // Fixed ordering authenticates the complete public header with AES-GCM AAD.
  return {format:value.format,version:value.version,scope:value.scope,clinicId:value.clinicId,createdAt:value.createdAt,cipher:value.cipher,kdf:{name:value.kdf.name,hash:value.kdf.hash,iterations:value.kdf.iterations,salt:value.kdf.salt},iv:value.iv};
}
async function derive(password,salt,signal){
  check(signal);validateCloudBackupPassword(password);
  if(!globalThis.crypto?.subtle)throw fail('backup_crypto','A criptografia exige um navegador atualizado com acesso seguro por HTTPS.');
  const passwordBytes=encoder.encode(password);
  let source;
  try{source=await crypto.subtle.importKey('raw',passwordBytes,'PBKDF2',false,['deriveKey']);}finally{passwordBytes.fill(0);}
  check(signal);
  const key=await crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations:CLOUD_BACKUP_LIMITS.pbkdf2Iterations},source,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  check(signal);return key;
}
function clinicMatch(clinicId,expectedClinicId){if(expectedClinicId!==undefined&&(!uuid(expectedClinicId)||clinicId.toLowerCase()!==expectedClinicId.toLowerCase()))throw fail('backup_clinic','O arquivo pertence a outra clínica. Nenhum dado foi alterado.');}
export function cloudBackupSummary({state,photos}){return Object.freeze({revision:state.revision,patients:state.patients.length,visits:state.visits.length,appointments:state.appointments.length,photos:photos.length,photoBytes:photos.reduce((total,p)=>total+p.original.size+p.preview.size,0)});}

/** Uses the established state/photo validators internally; the serialized clinic
 * envelope never adopts the legacy local-demo format or scope. No storage writes. */
export async function buildCloudBackup(snapshot,{password,signal,createdAt=new Date().toISOString(),expectedClinicId}={}){
  check(signal);validateCloudBackupPassword(password);
  if(!plain(snapshot)||snapshot.scope!==CLOUD_BACKUP_SCOPE||!uuid(snapshot.clinicId)||!validDate(createdAt))throw fail('backup_scope','O servidor não confirmou a clínica e o escopo desta cópia.');
  clinicMatch(snapshot.clinicId,expectedClinicId);
  const legacy=await buildBackup({state:snapshot.state,photos:snapshot.photos});check(signal);
  if(snapshot.photos.length!==legacy.photoCount)throw fail('backup_photos','A lista de fotos não corresponde ao workspace da clínica.');
  const data={state:legacy.state,stateHash:legacy.stateHash,photos:legacy.photos,photoCount:legacy.photoCount};
  const payload={format:'amj-clinic-workspace',version:1,scope:CLOUD_BACKUP_SCOPE,clinicId:snapshot.clinicId,createdAt,data,dataHash:await backupHash(JSON.stringify(data))};check(signal);
  const plaintext=encoder.encode(JSON.stringify(payload));
  if(plaintext.length>CLOUD_BACKUP_LIMITS.payloadBytes){plaintext.fill(0);throw fail('backup_limit','A cópia excede o limite desta exportação. Separe os arquivos com suporte técnico.');}
  const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
  const header=metadata({format:CLOUD_BACKUP_FORMAT,version:CLOUD_BACKUP_VERSION,scope:CLOUD_BACKUP_SCOPE,clinicId:snapshot.clinicId,createdAt,cipher:'AES-256-GCM',kdf:{name:'PBKDF2',hash:'SHA-256',iterations:CLOUD_BACKUP_LIMITS.pbkdf2Iterations,salt:bytes64(salt)},iv:bytes64(iv)});
  try{
    const key=await derive(password,salt,signal);
    const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,tagLength:128,additionalData:encoder.encode(JSON.stringify(header))},key,plaintext));check(signal);
    const envelope={...header,ciphertext:bytes64(encrypted),ciphertextHash:await backupHash(encrypted)};check(signal);
    return envelope;
  }finally{plaintext.fill(0);}
}

export function serializeCloudBackup(envelope){
  const serialized=JSON.stringify(envelope);
  if(encoder.encode(serialized).byteLength>CLOUD_BACKUP_LIMITS.fileBytes)throw fail('backup_limit','Arquivo acima do limite de 160 MB.');
  return serialized;
}
export function cloudBackupFilename(envelope){const h=metadata(envelope);return 'Ana-Maria-clinica-'+h.clinicId.slice(0,8)+'-'+h.createdAt.replace(/[:.]/g,'-')+'.amjbackup';}

/** Verifies and reopens bytes in memory only. It intentionally has no restore API. */
export async function verifyCloudBackup(input,{password,expectedClinicId,signal}={}){
  check(signal);validateCloudBackupPassword(password);
  let envelope=input;
  if(typeof input==='string'){
    if(input.length>CLOUD_BACKUP_LIMITS.fileBytes||encoder.encode(input).length>CLOUD_BACKUP_LIMITS.fileBytes)throw fail('backup_limit','Arquivo acima do limite de 160 MB.');
    try{envelope=JSON.parse(input);}catch{throw fail('backup_format','Não foi possível ler este arquivo de cópia.');}
  }
  if(!exactKeys(envelope,['format','version','scope','clinicId','createdAt','cipher','kdf','iv','ciphertext','ciphertextHash']))throw fail('backup_format','Arquivo criptografado inválido.');
  const header=metadata(envelope);clinicMatch(header.clinicId,expectedClinicId);
  const encrypted=unbase64(envelope.ciphertext,CLOUD_BACKUP_LIMITS.payloadBytes+16);
  if(encrypted.length<17||!hash(envelope.ciphertextHash)||await backupHash(encrypted)!==envelope.ciphertextHash)throw fail('backup_integrity','O arquivo foi alterado ou está incompleto.');check(signal);
  const key=await derive(password,unbase64(header.kdf.salt,16,16),signal);
  let plaintext;
  try{plaintext=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:unbase64(header.iv,12,12),tagLength:128,additionalData:encoder.encode(JSON.stringify(header))},key,encrypted));}
  catch(error){check(signal);throw fail('backup_decrypt','Senha incorreta ou arquivo alterado. Nenhum dado foi modificado.');}
  let payload;
  try{check(signal);payload=JSON.parse(decoder.decode(plaintext));}catch(error){if(error.code==='backup_cancelled')throw error;throw fail('backup_format','O conteúdo da cópia não pôde ser lido.');}finally{plaintext.fill(0);}
  if(!exactKeys(payload,['format','version','scope','clinicId','createdAt','data','dataHash'])||payload.format!=='amj-clinic-workspace'||payload.version!==1||payload.scope!==header.scope||payload.clinicId!==header.clinicId||payload.createdAt!==header.createdAt||!exactKeys(payload.data,['state','stateHash','photos','photoCount'])||!hash(payload.dataHash)||await backupHash(JSON.stringify(payload.data))!==payload.dataHash)throw fail('backup_integrity','O conteúdo da cópia não passou na conferência de integridade.');check(signal);
  // Compatibility adapter is confined to the existing validator, never exported.
  const snapshot=await verifyBackup({format:'amj-backup-autossuficiente',version:1,scope:'demonstracao-local',...payload.data});check(signal);
  return {metadata:{clinicId:header.clinicId,scope:header.scope,version:header.version,createdAt:header.createdAt,dataHash:payload.dataHash},summary:cloudBackupSummary(snapshot),state:snapshot.state,photos:snapshot.photos};
}
