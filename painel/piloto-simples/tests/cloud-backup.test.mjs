import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {seed} from '../domain.mjs';
import {backupHash} from '../backup.mjs';
import {buildCloudBackup,verifyCloudBackup,serializeCloudBackup,cloudBackupFilename,validateCloudBackupPassword,CLOUD_BACKUP_FORMAT,CLOUD_BACKUP_SCOPE} from '../cloud-backup.mjs';

const CLINIC='00000000-0000-4000-8000-000000000001',OTHER='00000000-0000-4000-8000-000000000002',password='Frase exclusiva de teste 2026';
const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT8sAAAAASUVORK5CYII='),c=>c.charCodeAt(0));
const now='2026-10-15T23:00:00.000Z';
function snapshot(){const state=seed();const photo=state.visits[0].photos[0];delete photo.src;photo.width=1;photo.height=1;state.patients[0].name='TESTE Nome privado para criptografia';return{scope:CLOUD_BACKUP_SCOPE,clinicId:CLINIC,state,photos:[{id:photo.id,original:new Blob([png],{type:'image/png'}),preview:new Blob([png],{type:'image/png'})}]};}
const build=s=>buildCloudBackup(s||snapshot(),{password,createdAt:now,expectedClinicId:CLINIC});

async function editPlaintext(envelope,edit){
 const {ciphertext,ciphertextHash,...header}=structuredClone(envelope);
 const bytes=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
 const base=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);
 const key=await crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt:bytes(header.kdf.salt),iterations:header.kdf.iterations},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
 const parameters={name:'AES-GCM',iv:bytes(header.iv),tagLength:128,additionalData:new TextEncoder().encode(JSON.stringify(header))};
 const plain=JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt(parameters,key,bytes(ciphertext))));
 await edit(plain);
 const encrypted=new Uint8Array(await crypto.subtle.encrypt(parameters,key,new TextEncoder().encode(JSON.stringify(plain))));
 return{...header,ciphertext:Buffer.from(encrypted).toString('base64'),ciphertextHash:await backupHash(encrypted)};
}

test('cloud backup encrypts clinic data and reopens actual saved file with byte-identical photos',async t=>{
 const source=snapshot(),before=structuredClone(source.state),envelope=await build(source),serialized=serializeCloudBackup(envelope);
 assert.equal(envelope.format,CLOUD_BACKUP_FORMAT);assert.equal(envelope.scope,'clinica-servidor');assert.equal(envelope.clinicId,CLINIC);
 assert(!serialized.includes(source.state.patients[0].name));assert(!serialized.includes('demonstracao-local'));assert(!serialized.includes(password));assert(!Object.hasOwn(envelope,'state'));
 const directory=await mkdtemp(join(tmpdir(),'amj-cloud-backup-')),file=join(directory,cloudBackupFilename(envelope));
 t.after(async()=>{await unlink(file);await rmdir(directory);});
 await writeFile(file,serialized,{encoding:'utf8',flag:'wx'});
 const reopened=await verifyCloudBackup(await readFile(file,'utf8'),{password,expectedClinicId:CLINIC});
 assert.deepEqual(reopened.state,source.state);assert.deepEqual(source.state,before);
 assert.equal(reopened.metadata.scope,'clinica-servidor');assert.equal(reopened.summary.photos,1);assert.equal(reopened.summary.photoBytes,png.length*2);
 for(const kind of ['original','preview'])assert.deepEqual(new Uint8Array(await reopened.photos[0][kind].arrayBuffer()),png);
 assert.equal(reopened.metadata.createdAt,now);assert.match(reopened.metadata.dataHash,/^[a-f0-9]{64}$/);
});

test('fresh salt and IV make each export distinct even for identical inputs',async()=>{
 const a=await build(),b=await build();assert.notEqual(a.iv,b.iv);assert.notEqual(a.kdf.salt,b.kdf.salt);assert.notEqual(a.ciphertext,b.ciphertext);
});

test('wrong password, changed ciphertext and authenticated header tampering are rejected',async()=>{
 const envelope=await build();await assert.rejects(()=>verifyCloudBackup(envelope,{password:'Outra frase longa incorreta'}),/Senha incorreta/);
 const altered=structuredClone(envelope);altered.ciphertext=(altered.ciphertext[0]==='A'?'B':'A')+altered.ciphertext.slice(1);
 await assert.rejects(()=>verifyCloudBackup(altered,{password}),/alterado ou está incompleto/);
 altered.ciphertextHash=await backupHash(Buffer.from(altered.ciphertext,'base64'));
 await assert.rejects(()=>verifyCloudBackup(altered,{password}),/Senha incorreta ou arquivo alterado/);
 for(const change of [{clinicId:OTHER},{createdAt:'2026-10-16T23:00:00.000Z'}])await assert.rejects(()=>verifyCloudBackup({...envelope,...change},{password}),/Senha incorreta ou arquivo alterado/);
});

test('inner data, state and photo hashes are checked after valid decryption',async()=>{
 const envelope=await build();
 const badData=await editPlaintext(envelope,p=>{p.data.state.patients[0].name='Alterado';});
 await assert.rejects(()=>verifyCloudBackup(badData,{password}),/integridade/);
 const badState=await editPlaintext(envelope,async p=>{p.data.state.patients[0].name='Alterado';p.dataHash=await backupHash(JSON.stringify(p.data));});
 await assert.rejects(()=>verifyCloudBackup(badState,{password}),/alterado ou está corrompido/);
 const badPhoto=await editPlaintext(envelope,async p=>{p.data.photos[0].original.sha256='0'.repeat(64);p.dataHash=await backupHash(JSON.stringify(p.data));});
 await assert.rejects(()=>verifyCloudBackup(badPhoto,{password}),/Fotografia incompleta/);
});

test('clinic scope, version, KDF and size encodings fail closed before reopening',async()=>{
 const envelope=await build();
 await assert.rejects(()=>verifyCloudBackup(envelope,{password,expectedClinicId:OTHER}),/outra clínica/);
 for(const altered of [{...envelope,version:2},{...envelope,scope:'demonstracao-local'},{...envelope,kdf:{...envelope.kdf,iterations:2**31}},{...envelope,iv:'invalid'},{...envelope,extra:'unbound metadata'}])await assert.rejects(()=>verifyCloudBackup(altered,{password}),/compatível|inválido/);
 await assert.rejects(()=>verifyCloudBackup('not-json',{password}),/Não foi possível ler/);
});

test('export refuses demo scope, foreign clinic, incomplete photos and invalid state',async()=>{
 await assert.rejects(()=>build({...snapshot(),scope:'demonstracao-local'}),/escopo/);
 await assert.rejects(()=>build({...snapshot(),clinicId:OTHER}),/outra clínica/);
 await assert.rejects(()=>build({...snapshot(),photos:[]}),/Falta o original/);
 const extra=snapshot();extra.photos.push({...extra.photos[0],id:'orphan'});await assert.rejects(()=>build(extra),/lista de fotos/);
 const corrupt=snapshot();corrupt.state.visits[0].photos[0].sha256='0'.repeat(64);await assert.rejects(()=>build(corrupt),/hash da foto/);
 const invalid=snapshot();invalid.state.bills[0].patientId='missing';await assert.rejects(()=>build(invalid),/vínculo/);
});

test('password policy and abort signals are enforced without a partial result',async()=>{
 for(const value of ['', 'short', ' '.repeat(20), 'x'.repeat(129), null])assert.throws(()=>validateCloudBackupPassword(value),/12 a 128/);
 assert.equal(validateCloudBackupPassword(password),password);
 const cancelled=new AbortController();cancelled.abort();
 await assert.rejects(()=>buildCloudBackup(snapshot(),{password,signal:cancelled.signal}),{code:'backup_cancelled'});
 const envelope=await build();await assert.rejects(()=>verifyCloudBackup(envelope,{password,signal:cancelled.signal}),{code:'backup_cancelled'});
 const during=new AbortController(),pending=buildCloudBackup(snapshot(),{password,signal:during.signal});during.abort();
 await assert.rejects(()=>pending,{code:'backup_cancelled'});
});
