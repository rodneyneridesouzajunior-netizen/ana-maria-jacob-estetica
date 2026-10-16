import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {printable} from '../feature-ui.mjs';
const require=createRequire(new URL('../../../../../skinpro-analise/test-tools/package.json',import.meta.url));
const {JSDOM,VirtualConsole}=require('jsdom');

test('print wrapper retains full document content and supplies mobile viewport, official mark and real print action',t=>{
 const errors=[],console=new VirtualConsole();console.on('jsdomError',error=>errors.push(error.message));
 const dom=new JSDOM('<!doctype html><body></body>',{url:'https://example.invalid/app/',virtualConsole:console});
 const previous=Object.getOwnPropertyDescriptor(globalThis,'window');let prints=0,opens=0;
 const popup={document:dom.window.document,print(){prints++;}};
 Object.defineProperty(globalThis,'window',{value:{open(url,target){opens++;assert.equal(url,'');assert.equal(target,'_blank');return popup;}},configurable:true,writable:true});
 t.after(()=>{if(previous)Object.defineProperty(globalThis,'window',previous);else delete globalThis.window;dom.window.close();});
 const content='<section><h3>Texto fictício preservado</h3><pre>Primeira linha\nSegunda linha &amp; valores &lt;originais&gt;</pre><p>Rascunho · versão 2</p><table><thead><tr><th>Valor</th></tr></thead><tbody><tr><td>R$ 100,00</td></tr></tbody></table><svg viewBox="0 0 1000 360" aria-label="Desenho fictício"><polyline points="1,2 3,4"></polyline></svg></section>';
 const result=printable('<Documento de teste>',content),d=popup.document;
 assert.equal(result,popup);assert.equal(opens,1);assert.equal(prints,0);
 assert.equal(d.querySelector('meta[name="viewport"]').content,'width=device-width,initial-scale=1,viewport-fit=cover');
 assert.equal(d.querySelector('h1').textContent,'<Documento de teste>');assert.equal(d.title,'<Documento de teste>');
 assert.equal(d.querySelector('.report-content').innerHTML,content);
 assert.equal(d.querySelector('pre').textContent,'Primeira linha\nSegunda linha & valores <originais>');
 assert.equal(d.querySelector('polyline').getAttribute('points'),'1,2 3,4');
 assert.match(d.querySelector('.note').textContent,/Demonstração local com dados fictícios/);
 const logo=d.querySelector('.report-brand img');assert.ok(logo);
 assert.equal(logo.getAttribute('src'),new URL('../assets/logo.png',import.meta.url).href);
 assert.ok(existsSync(fileURLToPath(logo.src)));assert.equal(logo.width,1672);assert.equal(logo.height,941);
 assert.equal(d.querySelector('script'),null);assert.equal(d.querySelector('link[href^="https:"]'),null);
 const css=d.querySelector('style').sheet;
 assert.ok([...css.cssRules].some(rule=>rule.conditionText==='(max-width:600px)'));
 const printRules=[...css.cssRules].find(rule=>rule.conditionText==='print');assert.ok(printRules);
 assert.ok([...printRules.cssRules].some(rule=>rule.selectorText==='.print-actions'&&rule.style.display==='none'));
 assert.equal(dom.window.getComputedStyle(d.getElementById('print')).minHeight,'48px');
 assert.equal(dom.window.getComputedStyle(d.querySelector('.report-brand')).backgroundColor,'rgba(0, 0, 0, 0)');
 assert.deepEqual(errors,[]);
 d.getElementById('print').click();assert.equal(prints,1);
 assert.equal(d.querySelector('.report-content').innerHTML,content);
});

test('blocked print popup reports the existing recovery instruction',t=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'window');
 Object.defineProperty(globalThis,'window',{value:{open:()=>null},configurable:true,writable:true});
 t.after(()=>{if(previous)Object.defineProperty(globalThis,'window',previous);else delete globalThis.window;});
 assert.throws(()=>printable('Documento fictício','<p>Preservado</p>'),/Permita a abertura da janela/);
});
