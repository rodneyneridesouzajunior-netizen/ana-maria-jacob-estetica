import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {seed} from '../domain.mjs';
import {mountCloudBackup} from '../cloud-backup-ui.mjs';
import {verifyCloudBackup} from '../cloud-backup.mjs';
const require=createRequire(new URL('../../../../../skinpro-analise/test-tools/package.json',import.meta.url));
const {JSDOM}=require('jsdom');
const CLINIC='00000000-0000-4000-8000-000000000001',password='Frase exclusiva de teste 2026';
function snapshot(){const state=seed();state.visits[0].photos=[];state.visits[0].maps={};return{scope:'clinica-servidor',clinicId:CLINIC,state,photos:[]};}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
async function idle(handle){const until=Date.now()+15000;while(handle.isBusy()&&Date.now()<until)await tick();assert.equal(handle.isBusy(),false,'operation did not settle');}
function harness(t,options={}){
 const dom=new JSDOM('<main></main>',{url:'https://example.invalid/'}),host=dom.window.document.querySelector('main');
 const downloads=[],notices=[];let calls=0;
 const handle=mountCloudBackup(host,{readSnapshot:async()=>{calls++;return snapshot();},clinicId:CLINIC,eventTarget:dom.window,download:(blob,name)=>downloads.push({blob,name}),notify:value=>notices.push(value),...options});
 t.after(()=>{handle.dispose();dom.window.close();});
 const form=type=>host.querySelector('[data-cloud-backup-'+type+']');
 const set=(type,name,value)=>{form(type).elements[name].value=value;};
 const submit=type=>form(type).dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
 const credentials=()=>{set('export','password',password);set('export','confirmation',password);};
 return{dom,host,handle,downloads,notices,form,set,submit,credentials,get calls(){return calls;},status:()=>host.querySelector('[data-cloud-backup-status]').textContent};
}

test('connected backup UI requires confirmation and downloads only verified encrypted data',async t=>{
 const h=harness(t);h.set('export','password',password);h.set('export','confirmation','Outra frase longa');h.submit('export');assert.match(h.status(),/senhas precisam ser iguais/);assert.equal(h.calls,0);assert.equal(h.handle.isDirty(),true);
 h.credentials();h.submit('export');h.submit('export');assert.equal(h.handle.isBusy(),true);assert.equal(h.form('export').elements.password.value,'');assert.equal(h.handle.discard(),false);await idle(h.handle);
 assert.equal(h.calls,1);assert.equal(h.downloads.length,1);assert.match(h.downloads[0].name,/\.amjbackup$/);assert.match(h.status(),/enviado para download/);
 const saved=await h.downloads[0].blob.text(),reopened=await verifyCloudBackup(saved,{password,expectedClinicId:CLINIC});assert.equal(reopened.metadata.clinicId,CLINIC);assert.equal(reopened.summary.patients,seed().patients.length);
 assert.match(h.host.textContent,/PDFs oficiais/);assert.match(h.host.textContent,/auditoria do servidor/);assert.match(h.host.textContent,/não substitui nem restaura dados/);assert.equal(h.host.querySelectorAll('[data-cloud-backup-restore]').length,0);
});

test('UI reopens downloaded file locally, rejects bad password and displays verified counts',async t=>{
 const h=harness(t);h.credentials();h.submit('export');await idle(h.handle);const file=h.downloads[0].blob;
 Object.defineProperty(h.form('verify').elements.backup,'files',{value:[file],configurable:true});h.set('verify','password','Outra frase longa incorreta');h.submit('verify');await idle(h.handle);assert.match(h.status(),/Senha incorreta/);assert.equal(h.calls,1);assert.equal(h.host.querySelector('[data-cloud-backup-result]').hidden,true);
 h.set('verify','password',password);h.submit('verify');await idle(h.handle);assert.match(h.status(),/Verificação concluída/);assert.match(h.host.textContent,/Clínica conferida com a sessão atual/);assert.match(h.host.textContent,/0 fotografias/);assert.equal(h.calls,1);assert.equal(h.downloads.length,1);
});

test('dispose during server snapshot cancels late download and clears password fields',async t=>{
 let release;const pending=new Promise(resolve=>{release=resolve;});const h=harness(t,{readSnapshot:()=>pending});h.credentials();h.submit('export');const form=h.form('export');h.handle.dispose();assert.equal(form.elements.password.value,'');assert.equal(h.host.textContent,'');release(snapshot());await tick();await tick();assert.equal(h.downloads.length,0);assert.equal(h.notices.length,0);
});

test('logout during encryption invalidates result before download',async t=>{
 const h=harness(t);h.credentials();h.submit('export');await tick();h.dom.window.dispatchEvent(new h.dom.window.Event('amj:connection-invalidated'));await new Promise(resolve=>setTimeout(resolve,400));assert.equal(h.downloads.length,0);assert.equal(h.handle.isBusy(),false);assert.equal(h.handle.isDirty(),false);assert.match(h.status(),/Acesso encerrado/);assert.equal(h.form('export').elements.password.disabled,true);
});

test('timeout and explicit cancel discard late snapshots without calling download',async t=>{
 for(const mode of ['timeout','cancel']){
  let release;const pending=new Promise(resolve=>{release=resolve;});const h=harness(t,{readSnapshot:()=>pending,timeoutMs:mode==='timeout'?10:1000});h.credentials();h.submit('export');
  if(mode==='cancel')h.host.querySelector('[data-cloud-backup-cancel]').click();await idle(h.handle);assert.match(h.status(),mode==='timeout'?/excedeu o tempo/:/Operação cancelada/);release(snapshot());await tick();assert.equal(h.downloads.length,0);
 }
});

test('clinic change, oversized file and discard do not read or overwrite server data',async t=>{
 let clinic=CLINIC;const h=harness(t,{getClinicId:()=>clinic});h.credentials();h.submit('export');await tick();clinic='00000000-0000-4000-8000-000000000002';await idle(h.handle);assert.equal(h.downloads.length,0);assert.match(h.status(),/clínica mudou/);
 const huge={size:161*1024*1024,text:()=>{throw Error('Must not read oversized file');}};Object.defineProperty(h.form('verify').elements.backup,'files',{value:[huge],configurable:true});h.set('verify','password',password);h.submit('verify');assert.match(h.status(),/160 MB/);assert.equal(h.handle.isBusy(),false);
 h.handle.discard();assert.equal(h.form('verify').elements.password.value,'');
});
