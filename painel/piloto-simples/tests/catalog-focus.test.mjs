import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {seed} from '../domain.mjs';
import {catalogPage,mountOperations} from '../operations-ui.mjs';
const require=createRequire(new URL('../../../../../skinpro-analise/test-tools/package.json',import.meta.url));
const {JSDOM}=require('jsdom');
const tick=()=>new Promise(resolve=>setImmediate(resolve));

function harness(t,options={}){
 const dom=new JSDOM('<body><nav><a href="#hoje">Início</a></nav><main></main></body>',{url:'https://example.invalid/app/'}),w=dom.window;
 const previous=new Map(['document','AbortController'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 Object.assign(globalThis,{document:w.document,AbortController:w.AbortController});
 const state=seed(),host=w.document.querySelector('main'),notices=[];
 host.innerHTML=catalogPage(state,{section:'overview'});
 const dispose=mountOperations(host,{getState:()=>state,notify:(...message)=>notices.push(message),...options});
 t.after(()=>{dispose();for(const[key,descriptor]of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}w.close();});
 const click=selector=>{const button=host.querySelector(selector);assert.ok(button,selector);button.focus();button.click();return button;};
 return {w,host,state,notices,click};
}

test('catalog section replacement transfers keyboard focus to the new heading',t=>{
 const h=harness(t);
 for(const[section,title]of [['procedures','Procedimentos'],['products','Produtos'],['stock','Estoque'],['overview','Catálogo']]){
  const oldButton=h.click(`[data-op="catalog-open"][data-id="${section}"]`),heading=h.host.querySelector('h1');
  assert.equal(oldButton.isConnected,false);assert.equal(heading.textContent,title);
  assert.equal(heading.tabIndex,-1);assert.equal(h.w.document.activeElement,heading);
 }
});

test('confirmed catalog refresh restores focus and retains the current search and filter',async t=>{
 let finish;const h=harness(t,{refreshCatalog:()=>new Promise(resolve=>finish=resolve)});
 h.click('[data-op="catalog-open"][data-id="products"]');
 const search=h.host.querySelector('[data-catalog-search]'),filter=h.host.querySelector('[data-catalog-filter]');
 search.value='fictício';search.dispatchEvent(new h.w.Event('input',{bubbles:true}));
 filter.value='active';filter.dispatchEvent(new h.w.Event('change',{bubbles:true}));
 const refresh=h.click('[data-op="catalog-refresh"]');assert.equal(refresh.disabled,true);
 finish();await tick();
 assert.equal(h.w.document.activeElement,h.host.querySelector('h1'));
 assert.equal(h.host.querySelector('[data-catalog-search]').value,'fictício');
 assert.equal(h.host.querySelector('[data-catalog-filter]').value,'active');
 assert.match(h.notices.at(-1)[0],/Lista atualizada/);
});

test('failed catalog refresh keeps the existing controls and their focus available for retry',async t=>{
 const h=harness(t,{refreshCatalog:async()=>{throw Error('Servidor indisponível para este teste');}});
 h.click('[data-op="catalog-open"][data-id="procedures"]');
 const heading=h.host.querySelector('h1'),refresh=h.click('[data-op="catalog-refresh"]');await tick();
 assert.equal(h.host.querySelector('h1'),heading);assert.equal(refresh.disabled,false);
 assert.equal(h.w.document.activeElement,refresh);assert.equal(h.notices.at(-1)[1],true);
 assert.match(h.notices.at(-1)[0],/Servidor indisponível/);
});
