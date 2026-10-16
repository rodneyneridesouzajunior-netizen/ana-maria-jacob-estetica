import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertActionCode,destructiveChanges,prepareWorkspaceChange,requestActionCode} from '../action-confirmation.mjs';
const require=createRequire(new URL('../../../../../skinpro-analise/test-tools/package.json',import.meta.url));
const {JSDOM}=require('jsdom');
test('PIN rejects missing, wrong and partial codes; ordinary additions and edits need no PIN',()=>{
  for(const code of [undefined,'','123','0000',' 1234','12345',1234])assert.throws(()=>assertActionCode(code));
  assert.doesNotThrow(()=>assertActionCode('1234'));
  const old={patients:[{id:'p',name:'Antes'}],appointments:[{id:'a',status:'agendado'}]};
  assert.deepEqual(destructiveChanges(old,{patients:[{id:'p',name:'Depois'},{id:'new'}],appointments:[{id:'a',status:'confirmado'}]}),[]);
});
test('guard covers removals, cancellation, reversal, deactivation, facial point removal and stock adjustment',()=>{
  const old={patients:[{id:'p'}],appointments:[{id:'a',status:'confirmado'}],payments:[{id:'pay'}],products:[{id:'prod',active:true}],visits:[{id:'v',photos:[],maps:{photo:{points:[{id:'point'}]}}}],stockMovements:[]};
  const next=structuredClone(old);next.patients=[];next.appointments[0].status='cancelado';next.payments[0].reversedAt='today';next.products[0].active=false;next.visits[0].maps.photo.points=[];next.stockMovements.push({id:'m',type:'ajuste',deltaUnits:-1});
  assert.deepEqual(destructiveChanges(old,next),['Remover paciente','Cancelar ou arquivar agendamento','Estornar recebimento','Desativar produto','Remover marcação do rosto','Reduzir estoque por ajuste manual']);
});
test('mutation is evaluated once and the original remains unchanged before confirmation',()=>{
  const before={revision:8,patients:[{id:'p'}]};let count=0;
  const plan=prepareWorkspaceChange(before,state=>{count++;state.patients=[];});
  assert.equal(count,1);assert.equal(before.patients.length,1);assert.equal(plan.next.revision,8);assert.deepEqual(plan.changes,['Remover paciente']);
});
test('wrong PIN never releases the operation, correct PIN releases once, cancellation and logout reject',async t=>{
  const dom=new JSDOM('<body><button>Origem</button></body>'),w=dom.window;
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
  t.after(()=>w.close());
  let approved=0;const pending=requestActionCode(['Remover marcação'],{document:w.document,window:w}).then(()=>approved++);
  const submit=code=>{w.document.querySelector('input').value=code;w.document.querySelector('form').dispatchEvent(new w.Event('submit',{cancelable:true}));};
  submit('0000');await Promise.resolve();assert.equal(approved,0);assert.match(w.document.querySelector('[role=alert]').textContent,/incorreto/);
  submit('1234');await pending;assert.equal(approved,1);assert.equal(w.document.querySelector('dialog'),null);
  const cancel=requestActionCode(['Cancelar'],{document:w.document,window:w});w.document.querySelector('[data-cancel]').click();await assert.rejects(cancel,/cancelada/);
  const logout=requestActionCode(['Cancelar'],{document:w.document,window:w});w.dispatchEvent(new w.Event('amj:connection-invalidated'));await assert.rejects(logout,/Acesso encerrado/);
});
