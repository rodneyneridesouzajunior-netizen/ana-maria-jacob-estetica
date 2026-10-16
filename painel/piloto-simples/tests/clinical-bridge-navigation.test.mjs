import fs from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {webcrypto} from 'node:crypto';
import * as rules from '../domain.mjs';
import {areas} from '../areas.mjs';
const require=createRequire(new URL('../../../../../skinpro-analise/test-tools/package.json',import.meta.url));
const {JSDOM}=require('jsdom');
const source=(await fs.readFile(new URL('../app.mjs',import.meta.url),'utf8')).replace(/^import .*$/gm,'').replace(/^try\{await setHash\(\);\}catch.*$/gm,'');
const html=await fs.readFile(new URL('../connected.html',import.meta.url),'utf8');
function setup(t,hash='#financeiro'){
 const dom=new JSDOM(html,{url:'https://example.invalid/connected.html'+hash}),w=dom.window;
 const workspace=rules.seed(),context=vm.createContext({...rules,areas,structuredClone,crypto:webcrypto,document:w.document,window:w,location:w.location,history:w.history,confirm:()=>false,setTimeout:()=>0,clearTimeout(){},isConnected:()=>true,load:async()=>structuredClone(workspace),renderIntegrationPage:()=>'',documentsSatisfied:()=>false});
 vm.runInContext(source,context);t.after(()=>w.close());return{context,dom,run:code=>vm.runInContext(code,context)};
}
test('inicialização preserva hash Financeiro; não há redirecionamento silencioso para Início',async t=>{
 const h=setup(t);h.run('let observedRoute;render=async()=>{observedRoute=route;};');await h.run('setHash()');assert.equal(h.run('observedRoute'),'financeiro');assert.equal(h.dom.window.location.hash,'#financeiro');
});
test('Todos os módulos mantém os oito percursos e a barra mobile marca só quatro atalhos',async t=>{
 const h=setup(t,'#areas');await h.run('setHash()');const doc=h.dom.window.document;
 assert.equal(doc.querySelectorAll('.area-directory-card').length,8);assert.equal(doc.querySelectorAll('#nav [data-mobile-primary="true"]').length,4);assert.equal(doc.querySelector('#nav .nav-mobile-menu').getAttribute('href'),'#areas');assert.equal(doc.querySelector('#nav .nav-mobile-menu').getAttribute('aria-current'),'page');
 for(const area of areas)assert.ok(doc.querySelector(`.area-directory a[href="#${area.id}"]`));
});
test('rascunho e gravação incerta do vínculo impedem abandonar a consulta',t=>{
 const h=setup(t);h.run('clinicalBridgeHandle={hasUncertain:()=>true,isDirty:()=>true,isBusy:()=>false};');assert.equal(h.run('clean()'),false);assert.match(h.dom.window.document.getElementById('toast').textContent,/gravação pendente/);
 h.run('clinicalBridgeHandle={hasUncertain:()=>false,isDirty:()=>true,isBusy:()=>false,discard:()=>{throw Error("não deve descartar sem confirmação");}};');assert.equal(h.run('clean()'),false);
});
