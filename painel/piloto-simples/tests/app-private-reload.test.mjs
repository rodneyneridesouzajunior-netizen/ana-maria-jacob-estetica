import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {webcrypto} from 'node:crypto';
import * as rules from '../domain.mjs';
import {assertVisitEditable} from '../operations-domain.mjs';

const require=createRequire(new URL('../../../../../skinpro-analise/test-tools/package.json',import.meta.url));
const {JSDOM}=require('jsdom');
const source=(await fs.readFile(new URL('../app.mjs',import.meta.url),'utf8'))
 .replace(/^import .*$/gm,'').replace(/^try\{await setHash\(\);\}catch.*$/gm,'');
const tick=()=>new Promise(resolve=>setImmediate(resolve));

// Exercise the actual application event handlers. Keep a deferred server read
// outside the fake session so even a transport that ignores cancellation cannot
// put private state back after the app has cleared it.
function harness(t){
 const dom=new JSDOM('<!doctype html><body><nav id="nav"></nav><select id="area-switch"></select><span id="crumb"></span><span id="date-label"></span><main id="content"></main><div id="toast"></div><dialog id="dialog"><h2 id="dialog-title"></h2><form id="dialog-form"><div id="dialog-fields"></div><p id="dialog-error"></p><button id="cancel-dialog"></button></form><button id="close-dialog"></button></dialog></body>',{url:'https://anamariajacob.com.br/app/connected.html#hoje'});
 const w=dom.window,events=new Map(),add=w.addEventListener.bind(w);
 w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.addEventListener=(type,fn,...rest)=>{events.set(type,[...(events.get(type)||[]),fn]);add(type,fn,...rest);};
 const context=vm.createContext({...rules,assertVisitEditable,isConnected:()=>true,structuredClone,crypto:webcrypto,console,document:w.document,window:w,location:w.location,history:w.history,FormData:w.FormData,URL:{revokeObjectURL(){}},confirm:()=>true,setTimeout:()=>0,clearTimeout(){},load:async()=>rules.seed(),commit:async()=>{throw Error('No writes expected');},getPhoto:async()=>null});
 vm.runInContext(source,context);
 const run=code=>vm.runInContext(code,context);
 run('state=seed();');
 t.after(()=>w.close());
 return {run,document:w.document,emit:async(type,event={})=>{for(const fn of events.get(type)||[])await fn(event);}};
}

test('private cloud reload ignores events started after logout',async t=>{
 const h=harness(t);let reads=0;
 await h.emit('amj:connection-invalidated');
 await h.emit('amj:cloud-reload-request',{detail:{refresh:async()=>{reads++;return rules.seed();}}});
 assert.equal(reads,0);
 assert.equal(h.run('state'),null);
 assert.equal(h.run('connectionEnded'),true);
});

test('private cloud reload cannot repopulate state when logout precedes a late successful response',async t=>{
 const h=harness(t);let resolve,reads=0;
 const response=new Promise(done=>{resolve=done;});
 const reload=h.emit('amj:cloud-reload-request',{detail:{refresh:()=>{reads++;return response;}}});
 await tick();assert.equal(reads,1);
 await h.emit('amj:connection-invalidated');
 assert.equal(h.run('state'),null);
 resolve(rules.seed());await reload;
 assert.equal(h.run('connectionEnded'),true);
 assert.equal(h.run('state'),null);
 assert.equal(h.run('busy'),false);
 assert.equal(h.document.getElementById('toast').textContent,'');
 assert.doesNotMatch(h.document.body.textContent,/Marina|Camila|Beatriz/);
});

test('a late failed cloud reload does not reveal its error or restore private context after logout',async t=>{
 const h=harness(t);let reject;
 const response=new Promise((_,fail)=>{reject=fail;});
 const reload=h.emit('amj:cloud-reload-request',{detail:{refresh:()=>response}});
 await tick();await h.emit('amj:connection-invalidated');
 reject(Error('PRIVATE patient transport detail'));await reload;
 assert.equal(h.run('state'),null);
 assert.equal(h.run('busy'),false);
 assert.equal(h.document.getElementById('toast').textContent,'');
 assert.doesNotMatch(h.document.body.textContent,/PRIVATE/);
});
