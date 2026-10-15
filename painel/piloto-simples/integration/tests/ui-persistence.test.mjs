import test from 'node:test';
import assert from 'node:assert/strict';
import {mountIntegration} from '../ui.mjs';
import {DEFAULT_CONFIG} from '../config.mjs';

const patientId='11111111-1111-4111-8111-111111111111';
const ok=extra=>new Response(JSON.stringify({auth_method:'supabase_auth',role:'owner',identity:{role:'owner'},...extra}),{status:200});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function node(){const events=new Map();return {events,innerHTML:'',textContent:'',className:'',matches:()=>true,contains:()=>true,querySelectorAll:()=>[],querySelector:()=>null,replaceChildren(){this.innerHTML='';},setAttribute(){},removeAttribute(){},addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name)};}
function fixture(t,fetchImpl){
  const root=node(),body=node(),message=node(),status=node(),finance=node(),formHost=node(),financeMessage=node();
  root.querySelector=key=>({'[data-ci-body]':body,'[data-ci-message]':message,'[data-ci-status]':status}[key]);
  body.querySelector=key=>key==='[data-ci-finance]'?finance:null;
  finance.querySelector=key=>({'[data-fw-form]':formHost,'[data-fw-message]':financeMessage}[key]);
  const session={access_token:'fixture-not-a-credential',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:patientId}};
  const auth={initialize:async()=>({session}),getSession:async()=>session,getNextStep:async()=>({step:'ready',session,aal:{currentLevel:'aal2'}}),client:{auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}}};
  const mounted=mountIntegration(root,{authController:auth,config:{...DEFAULT_CONFIG,writesEnabled:true},origin:'http://127.0.0.1:8765',fetchImpl});
  t.after(()=>mounted.dispose());
  t.mock.method(globalThis,'FormData',function(form){return Object.entries(form.values);});
  const click=(target,dataset)=>target.events.get('click')({target:{closest:()=>({dataset})}});
  const submit=(target,form)=>target.events.get('submit')({target:{closest:()=>form},preventDefault(){}});
  return {root,body,message,finance,formHost,mounted,click,submit};
}

test('published demonstration cannot start auth or enable server writes when integration is disabled',async t=>{
  const root=node(),body=node(),message=node(),status=node();let authCalls=0,networkCalls=0;
  root.querySelector=key=>({'[data-ci-body]':body,'[data-ci-message]':message,'[data-ci-status]':status}[key]);
  const deniedAuth=async()=>{authCalls++;throw new Error('Authentication must remain unused in this demonstration.');};
  const auth={initialize:deniedAuth,getSession:deniedAuth,getNextStep:deniedAuth,signIn:deniedAuth,verifyChallenge:deniedAuth,client:{auth:{onAuthStateChange(){authCalls++;return {data:{subscription:{unsubscribe(){}}}};}}}};
  const mounted=mountIntegration(root,{config:{enabled:false},origin:'https://anamariajacob.com.br',authController:auth,fetchImpl:async()=>{networkCalls++;throw new Error('Network must remain unused.');}});
  t.after(()=>mounted.dispose());
  const initial=body.innerHTML;
  assert.match(initial,/https:\/\/anamariajacob\.com\.br\/painel\//);
  assert.match(status.textContent,/testes/);
  // Invoke the real delegated listener, including controls that are not
  // rendered in demo mode: neither start nor write enablement may reach auth.
  for(const action of ['start','enable-writes','confirm-writes','confirm-agenda','start']){
    root.events.get('click')({target:{closest:()=>({dataset:{ciAction:action}})}});
    await tick();
    assert.equal(body.innerHTML,initial);
    assert.doesNotMatch(body.innerHTML,/data-ci-form="(?:login|mfa)"|name="password"|Gravações habilitadas/);
    assert.equal(authCalls,0);assert.equal(networkCalls,0);
  }
  assert.equal(mounted.isBusy(),false);assert.equal(mounted.isDirty(),false);
});

test('uncertain clinical write retains its form and key when discard or navigation is attempted',async t=>{
  let writes=0;
  const h=fixture(t,async(_url,request)=>{const p=JSON.parse(request.body);if(p.acao==='criar_cliente'){writes++;throw new TypeError('connection lost');}return ok({clientes:[],paginacao:{tem_mais:false}});});
  h.click(h.root,{ciAction:'start'});await tick();h.click(h.root,{ciAction:'new-patient'});await tick();
  const key=h.body.innerHTML.match(/data-key="([^"]+)"/)[1],cancel={disabled:false,textContent:''};
  const form={dataset:{ciForm:'new-patient',key},values:{nome:'TESTE paciente',telefone:'31900000000',email:'fixture@example.invalid',data_nascimento:''},reportValidity:()=>true,querySelectorAll:()=>[],querySelector:()=>cancel};
  h.submit(h.root,form);await tick();assert.equal(writes,1);assert.equal(cancel.disabled,true);assert.equal(h.mounted.isDirty(),true);
  const saved=h.body.innerHTML;
  h.click(h.root,{ciAction:'cancel-edit'});await tick();h.click(h.root,{ciModule:'patients'});await tick();
  assert.equal(h.body.innerHTML,saved);assert.ok(saved.includes(key));assert.match(h.message.textContent,/chave foram preservados/);
  h.submit(h.root,form);await tick();assert.equal(writes,1);
});

for(const mode of ['summary','patient-search'])test(`late finance ${mode} response cannot replace a form or an in-flight payment creation`,async t=>{
  let finishRead,finishWrite;
  const h=fixture(t,async(_url,request)=>{
    const p=JSON.parse(request.body);
    if(p.acao==='resumo'||p.acao==='listar_clientes'&&p.busca)return new Promise(resolve=>{finishRead=()=>resolve(ok(p.acao==='resumo'?{resumo:{}}:{clientes:[],paginacao:{tem_mais:false}}));});
    if(p.acao==='criar_lancamento')return new Promise(resolve=>{finishWrite=()=>resolve(ok({lancamento:{id:'22222222-2222-4222-8222-222222222222'}}));});
    if(p.acao==='listar_lancamentos')return ok({lancamentos:[],paginacao:{tem_mais:false}});
    if(p.acao==='listar_catalogos')return ok({produtos:[],produtos_rascunho:[],fornecedores:[],formas_pagamento:[]});
    return ok({clientes:[{id:patientId,nome:'TESTE'}],paginacao:{tem_mais:false}});
  });
  h.click(h.root,{ciAction:'start'});await tick();h.click(h.root,{ciModule:'finance'});await tick();
  if(mode==='summary')h.click(h.root,{ciAction:'finance-summary'});
  else h.submit(h.root,{dataset:{ciForm:'finance-patient-search'},values:{search:'TESTE'},reportValidity:()=>true});
  await tick();assert.equal(typeof finishRead,'function');
  h.click(h.finance,{fwAction:'create'});assert.equal(h.mounted.isDirty(),true);
  const before=h.formHost.innerHTML;
  const form={values:{tipo:'receita',cliente_id:patientId,fornecedor_id:'',descricao:'TESTE cobrança',categoria:'Teste',competencia:'2026-10-15',vencimento:'2026-10-15',valor_total:'100,00'}};
  h.submit(h.finance,form);await tick();assert.equal(typeof finishWrite,'function');
  finishRead();await tick();assert.equal(h.formHost.innerHTML,before);assert.equal(h.mounted.isDirty(),true);assert.equal(h.mounted.isBusy(),true);assert.match(h.message.textContent,/formulário financeiro foi preservado/);
  h.mounted.dispose();finishWrite();await tick();
});
