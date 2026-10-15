import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {seed} from '../domain.mjs';
import {openPatientEditor,mountPatientsPage} from '../patients-ui.mjs';
const require=createRequire(new URL('../../../../../skinpro-analise/test-tools/package.json',import.meta.url));
const {JSDOM}=require('jsdom');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness(t,{fail=false,defer=false}={}){
 const dom=new JSDOM('<!doctype html><body><main></main></body>',{url:'https://example.invalid/app/'}),w=dom.window,previous={document:globalThis.document,FormData:globalThis.FormData,confirm:globalThis.confirm};Object.assign(globalThis,{document:w.document,FormData:w.FormData,confirm:()=>false});
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 let state=seed(),failSave=fail,saves=0,resolveSave;const notices=[],handles=[];
 const mutate=async fn=>{if(defer)await new Promise(resolve=>resolveSave=resolve);if(failSave)throw Error('Falha de armazenamento de teste');const next=structuredClone(state);fn(next);state=next;saves++;};
 t.after(()=>{handles.forEach(h=>h.dispose());for(const [key,value]of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}w.close();});
 const event=(el,type)=>el.dispatchEvent(new w.Event(type,{bubbles:true,cancelable:true}));
 const set=(dialog,name,value)=>{const field=dialog.querySelector(`[name="${name}"]`);assert.ok(field,name);field.value=value;event(field,'input');return field;};
 const options={getState:()=>state,mutate,postalClient:{lookup:async()=>{throw Error('Serviço de CEP indisponível no ensaio');}},notify:message=>notices.push(message),today:'2026-10-15'};
 return{w,event,set,options,handles,notices,get state(){return state;},get saves(){return saves;},unfail(){failSave=false;},resolve(){resolveSave();}};
}

test('editor DOM salva endereço manual completo, notas, cor e reabre todos os campos',async t=>{
 const h=harness(t),handle=openPatientEditor(h.options);h.handles.push(handle);const dialog=handle.element;
 for(const [name,value]of Object.entries({name:'Paciente fictícia DOM',cpf:'529.982.247-25',postalCode:'32600-000',address:'Rua de teste',addressNumber:'12B',complement:'Sala teste',neighborhood:'Centro',city:'Betim',state:'MG',notes:'Não contatar: demonstração'}))h.set(dialog,name,value);
 const color=dialog.querySelector('[name=color][value=teal]');color.checked=true;h.event(color,'change');assert.equal(handle.isDirty(),true);h.event(dialog.querySelector('form'),'submit');await tick();assert.equal(h.saves,1);assert.equal(dialog.isConnected,false);const saved=h.state.patients.at(-1);assert.equal(saved.color,'teal');assert.equal(saved.postalCode,'32600000');assert.equal(saved.notes,'Não contatar: demonstração');const reopened=openPatientEditor({...h.options,patientId:saved.id});h.handles.push(reopened);assert.equal(reopened.element.querySelector('[name=addressNumber]').value,'12B');assert.equal(reopened.element.querySelector('[name=notes]').value,saved.notes);assert.equal(reopened.element.querySelector('[name=color]:checked').value,'teal');assert.match(reopened.element.querySelector('.patients-editor-history').textContent,/versão 1/);
});
test('editor DOM erro conserva rascunho, cancelamento não descarta sem confirmação e repetição salva uma vez',async t=>{
 const h=harness(t,{fail:true}),handle=openPatientEditor(h.options);h.handles.push(handle);const d=handle.element;h.set(d,'name','Teste de falha');h.set(d,'notes','Rascunho preservado');h.event(d.querySelector('form'),'submit');await tick();assert.match(d.querySelector('.error').textContent,/armazenamento/);assert.equal(handle.isDirty(),true);assert.equal(h.notices.length,0);d.querySelector('[data-close]').click();assert.equal(d.open,true);h.unfail();h.event(d.querySelector('form'),'submit');await tick();assert.equal(h.saves,1);assert.equal(h.state.patientHistory.length,1);assert.equal(h.state.patients.at(-1).notes,'Rascunho preservado');
});
test('editor DOM rejeita CPF/CEP inválidos sem perder endereço digitado',async t=>{
 const h=harness(t),handle=openPatientEditor(h.options);h.handles.push(handle);const d=handle.element;h.set(d,'name','Teste válido');h.set(d,'postalCode','123');h.set(d,'address','Endereço preservado');h.event(d.querySelector('form'),'submit');await tick();assert.match(d.querySelector('.error').textContent,/CEP inválido/);assert.equal(d.querySelector('[name=address]').value,'Endereço preservado');assert.equal(h.saves,0);h.set(d,'postalCode','32600-000');h.set(d,'cpf','000.000.000-00');h.event(d.querySelector('form'),'submit');await tick();assert.match(d.querySelector('.error').textContent,/CPF inválido/);assert.equal(h.saves,0);
});
test('editor DOM gravação pendente bloqueia descarte/duplo envio e não notifica tela desmontada',async t=>{
 const h=harness(t,{defer:true}),handle=openPatientEditor(h.options);h.handles.push(handle);const d=handle.element;h.set(d,'name','Teste pendente');h.event(d.querySelector('form'),'submit');assert.equal(handle.isBusy(),true);assert.equal(handle.discard(),false);h.event(d.querySelector('form'),'submit');handle.dispose();h.resolve();await tick();assert.equal(h.saves,1);assert.equal(h.notices.length,0);assert.equal(d.isConnected,false);
});
test('lista DOM combina filtros/busca/cor com regra visível e links vinculados à paciente',t=>{
 const h=harness(t),state=h.state;state.patients[0].color='purple';state.patients[0].city='Betim';state.visits[0].status='concluido';state.visits[0].date='2026-01-01';state.expectedReturns=[{id:'r',patientId:'demo-marina',sourceVisitId:'demo-consulta',date:'2026-10-30',status:'previsto'}];const routes=[],host=document.querySelector('main'),handle=mountPatientsPage(host,{...h.options,view:{today:'2026-10-15'},onNavigate:route=>routes.push(route)});h.handles.push(handle);host.querySelector('[data-patients-filter=over90]').click();assert.equal(host.querySelectorAll('.patients-expanded-row').length,1);assert.match(host.querySelector('[data-patients-explanation]').textContent,/91 ou mais/);const search=host.querySelector('[data-patients-search]');search.value='BETIM';h.event(search,'input');assert.equal(host.querySelectorAll('.patients-expanded-row').length,1);const color=host.querySelector('[name=patient-color-filter]');color.value='blue';h.event(color,'change');assert.equal(host.querySelectorAll('.patients-expanded-row').length,0);color.value='purple';h.event(color,'change');host.querySelector('[data-patients-open]').click();assert.deepEqual(routes,['paciente/demo-marina']);host.querySelector('[data-patients-filter=returns]').click();assert.equal(host.querySelectorAll('.patients-expanded-row').length,1);assert.match(host.querySelector('[data-patients-explanation]').textContent,/agendados/);
});
test('lista DOM expõe guarda ao shell e descarte explícito fecha editor sem confirmação duplicada',t=>{
 const h=harness(t),host=document.querySelector('main'),handle=mountPatientsPage(host,h.options);h.handles.push(handle);host.querySelector('[data-patients=new]').click();const dialog=document.querySelector('dialog');h.set(dialog,'name','Rascunho aberto');assert.equal(handle.isDirty(),true);let prompts=0;globalThis.confirm=()=>{prompts++;return false;};assert.equal(handle.discard(),true);assert.equal(prompts,0);assert.equal(handle.isDirty(),false);assert.equal(dialog.isConnected,false);
});
