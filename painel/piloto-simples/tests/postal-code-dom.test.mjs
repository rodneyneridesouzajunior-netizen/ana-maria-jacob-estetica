import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {seed} from '../domain.mjs';
import {openPatientEditor} from '../patients-ui.mjs';
import {createPostalCodeClient} from '../postal-code.mjs';
const require=createRequire(new URL('../../../../../skinpro-analise/test-tools/package.json',import.meta.url));
const {JSDOM}=require('jsdom'),tick=()=>new Promise(resolve=>setImmediate(resolve));
const response=(cep='32600-000',extra={})=>({ok:true,json:async()=>({cep,logradouro:'Rua obtida pelo CEP',bairro:'Centro',localidade:'Betim',uf:'MG',...extra})});
function harness(t,{fetchImpl}={}){
 const dom=new JSDOM('<!doctype html><body></body>',{url:'https://example.invalid/app/'}),w=dom.window,previous={document:globalThis.document,FormData:globalThis.FormData,confirm:globalThis.confirm};Object.assign(globalThis,{document:w.document,FormData:w.FormData,confirm:()=>true});
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 const calls=[];let state=seed(),saves=0;const handles=[];
 const client=createPostalCodeClient({fetchImpl:async(...args)=>{calls.push(args);return fetchImpl?fetchImpl(...args):response();}});
 const open=(patientId=null)=>{const handle=openPatientEditor({getState:()=>state,patientId,postalClient:client,today:'2026-10-15',mutate:async fn=>{const next=structuredClone(state);fn(next);state=next;saves++;}});handles.push(handle);return handle;};
 const h=open(),d=h.element,field=name=>d.querySelector(`[name="${name}"]`),event=(el,type)=>el.dispatchEvent(new w.Event(type,{bubbles:true,cancelable:true})),set=(name,value)=>{field(name).value=value;event(field(name),'input');};
 t.after(()=>{handles.forEach(x=>x.dispose());for(const [key,value]of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}w.close();});
 return {h,d,field,event,set,open,calls,status:()=>d.querySelector('[data-postal-status]').textContent,get state(){return state;},get saves(){return saves;}};
}
test('editor real preenche por CEP, preserva número/complemento e salva/reabre o cadastro',async t=>{
 const x=harness(t);x.set('name','Paciente fictícia CEP');x.set('cpf','529.982.247-25');x.set('addressNumber','12B');x.set('complement','Sala 2');x.set('postalCode','32600-000');await tick();
 assert.equal(x.field('address').value,'Rua obtida pelo CEP');assert.equal(x.field('neighborhood').value,'Centro');assert.equal(x.field('city').value,'Betim');assert.equal(x.field('state').value,'MG');assert.equal(x.field('addressNumber').value,'12B');assert.equal(x.field('complement').value,'Sala 2');assert.match(x.status(),/Confira/);
 assert.equal(x.d.querySelector('[data-postal-status]').getAttribute('role'),'status');assert.equal(x.d.querySelector('[data-postal-section]').getAttribute('aria-busy'),'false');
 x.event(x.d.querySelector('form'),'submit');await tick();assert.equal(x.saves,1);const saved=x.state.patients.at(-1),reopened=x.open(saved.id);assert.equal(saved.postalCode,'32600000');assert.equal(reopened.element.querySelector('[name=address]').value,saved.address);assert.equal(x.calls.length,1);assert.equal(x.calls[0][0],'https://viacep.com.br/ws/32600000/json/');
});
test('dois CEPs fora de ordem: somente a resposta do CEP atual preenche',async t=>{
 const pending=[];const x=harness(t,{fetchImpl:(_,options)=>new Promise(resolve=>pending.push({resolve,signal:options.signal}))});x.set('postalCode','32600000');x.set('postalCode','30100000');assert.equal(pending[0].signal.aborted,true);
 pending[1].resolve(response('30100-000',{localidade:'Belo Horizonte',logradouro:'Rua atual'}));await tick();pending[0].resolve(response());await tick();assert.equal(x.field('city').value,'Belo Horizonte');assert.equal(x.field('address').value,'Rua atual');assert.equal(x.calls.length,2);
});
test('edições manuais durante consulta, até editar e voltar ao valor anterior, não são sobrescritas',async t=>{
 let release;const x=harness(t,{fetchImpl:()=>new Promise(resolve=>release=resolve)});x.set('address','Rua escolhida');x.set('postalCode','32600000');x.set('address','Outra');x.set('address','Rua escolhida');x.set('city','Cidade manual');x.field('state').value='SP';x.event(x.field('state'),'change');release(response());await tick();
 assert.equal(x.field('address').value,'Rua escolhida');assert.equal(x.field('city').value,'Cidade manual');assert.equal(x.field('state').value,'SP');assert.equal(x.field('neighborhood').value,'Centro');assert.match(x.status(),/alterações manuais foram preservadas/);
});
test('fechar editor aborta busca e nenhum retorno tardio altera campo ou estado',async t=>{
 let release;const x=harness(t,{fetchImpl:()=>new Promise(resolve=>release=resolve)});x.set('postalCode','32600000');const before=x.field('address').value;assert.equal(x.h.discard(),true);assert.equal(x.calls[0][1].signal.aborted,true);release(response());await tick();assert.equal(x.field('address').value,before);assert.equal(x.saves,0);assert.equal(x.h.isDirty(),false);
});
test('salvar durante busca cancela consulta antes do snapshot e não modifica cadastro depois',async t=>{
 let release;const x=harness(t,{fetchImpl:()=>new Promise(resolve=>release=resolve)});x.set('name','Paciente teste pendente');x.set('address','Rua manual');x.set('postalCode','32600000');x.event(x.d.querySelector('form'),'submit');assert.equal(x.calls[0][1].signal.aborted,true);await tick();assert.equal(x.saves,1);release(response());await tick();assert.equal(x.state.patients.at(-1).address,'Rua manual');assert.equal(x.state.patients.at(-1).city,'');
});
test('CEP inválido/inexistente deixa endereço editável, e botão permite repetir após falha',async t=>{
 let calls=0;const x=harness(t,{fetchImpl:async()=>++calls===1?{ok:true,json:async()=>({erro:true})}:response()});x.set('postalCode','123');x.d.querySelector('[data-postal-search]').click();await tick();assert.equal(x.calls.length,0);assert.match(x.status(),/8 dígitos/);
 x.set('postalCode','32600000');await tick();assert.match(x.status(),/não encontrado/);assert.equal(x.d.querySelector('[data-postal-search]').disabled,false);x.set('address','Rua manual');assert.equal(x.field('address').disabled,false);x.d.querySelector('[data-postal-search]').click();await tick();assert.equal(x.field('address').value,'Rua obtida pelo CEP');assert.equal(x.calls.length,2);
});
test('blur consulta CEP preenchido sem evento input e CEP municipal pede complemento manual',async t=>{
 const x=harness(t,{fetchImpl:async()=>response(undefined,{logradouro:'',bairro:''})});x.field('postalCode').value='32600000';x.field('address').value='Rua manual conservada';x.event(x.field('postalCode'),'blur');await tick();assert.equal(x.field('address').value,'Rua manual conservada');assert.equal(x.field('city').value,'Betim');assert.match(x.status(),/complete rua e bairro manualmente/);
});
test('voltar ao mesmo CEP e sair não sobrescreve correção manual feita após o preenchimento',async t=>{
 const x=harness(t);x.set('postalCode','32600000');await tick();x.set('address','Rua corrigida pela profissional');x.event(x.field('postalCode'),'blur');await tick();assert.equal(x.field('address').value,'Rua corrigida pela profissional');assert.equal(x.calls.length,1);
});
