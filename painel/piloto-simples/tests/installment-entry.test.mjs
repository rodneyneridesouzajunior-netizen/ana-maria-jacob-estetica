import test from 'node:test';
import assert from 'node:assert/strict';
import {seed,billBalance} from '../domain.mjs';
import {createInstallments,receivePayment,reversePayment,installmentBalance,financeReport} from '../finance-domain.mjs';
import {validateBackupState} from '../backup.mjs';
import {renderFinancePage} from '../finance-ui.mjs';
const input={billId:'entry-test',count:3,firstDueDate:'2026-09-15',entryAmount:60000,entryDueDate:'2026-08-17'};
function fresh(){const s=seed();s.bills.push({id:'entry-test',patientId:s.patients[0].id,date:'2026-08-17',description:'Teste de entrada',total:228000,cost:0});return s;}
const pay=(s,p,i)=>receivePayment(s,{id:'pay-entry-'+i,operationId:'pay-entry-op-'+i,billId:'entry-test',installmentId:p.id,amount:p.amount,date:p.dueDate,method:'Pix'});
test('entrada e três parcelas fecham o total; plano não registra recebimentos',()=>{
 const s=fresh(),before=s.payments.length,plan=createInstallments(s,input);
 assert.deepEqual(plan.map(p=>[p.amount,p.dueDate,p.number,p.count]),[[60000,'2026-08-17',1,4],[56000,'2026-09-15',2,4],[56000,'2026-10-15',3,4],[56000,'2026-11-15',4,4]]);
 assert.equal(plan[0].kind,'entry');assert.equal(s.payments.length,before);assert.doesNotThrow(()=>validateBackupState(s));
 for(let i=0;i<3;i++)pay(s,plan[i],i);
 assert.deepEqual(plan.map(p=>installmentBalance(s,p)),[0,0,0,56000]);assert.equal(billBalance(s.bills.at(-1),s.payments),56000);assert.doesNotThrow(()=>validateBackupState(s));
 const html=renderFinancePage(s,{allRecords:true});assert.match(html,/Entrada · 17\/08\/2026/);assert.match(html,/1\/3 · 15\/09\/2026/);assert.match(html,/3\/3 · 15\/11\/2026/);assert.match(html,/Receber entrada/);
});
test('plano legado não ganha entrada; centavos e fim de mês são preservados',()=>{
 const s=fresh();s.bills.at(-1).total=10001;
 const plan=createInstallments(s,{billId:'entry-test',count:3,firstDueDate:'2026-01-31'});
 assert.deepEqual(plan.map(p=>[p.amount,p.dueDate]),[[3334,'2026-01-31'],[3334,'2026-02-28'],[3333,'2026-03-31']]);assert.ok(plan.every(p=>p.kind===undefined));
 const next=createInstallments(s,{...input,entryAmount:1,entryDueDate:'2026-01-01',firstDueDate:'2026-01-31'});
 assert.deepEqual(next.map(p=>p.amount),[1,3334,3333,3333]);assert.equal(s.installmentHistory.length,3);assert.doesNotThrow(()=>validateBackupState(s));
});
test('entrada inválida não substitui plano nem altera histórico',()=>{
 for(const change of [{entryAmount:-1},{entryAmount:0.5},{entryAmount:228000},{entryAmount:227999},{entryAmount:NaN},{entryDueDate:''},{entryDueDate:'2026-02-30'},{entryDueDate:'2026-10-01'}]){
  const s=fresh();createInstallments(s,{...input,entryAmount:0});const before=structuredClone(s);assert.throws(()=>createInstallments(s,{...input,...change}));assert.deepEqual(s,before);
 }
});
test('recebimento trava plano; excesso, duplicação e parcela alheia são recusados',()=>{
 const s=fresh(),plan=createInstallments(s,input);pay(s,plan[0],0);const before=structuredClone(s);
 assert.throws(()=>createInstallments(s,input),/Estorne/);assert.throws(()=>pay(s,plan[0],0));assert.throws(()=>pay(s,plan[0],1));assert.throws(()=>pay(s,{...plan[1],id:'wrong'},2));assert.deepEqual(s,before);
 reversePayment(s,{paymentId:'pay-entry-0',reason:'Correção de teste',date:'2026-08-18'});createInstallments(s,input);assert.equal(s.installmentHistory.length,4);assert.doesNotThrow(()=>validateBackupState(s));
});
test('backup rejeita marcação de entrada incorreta e datas anteriores à entrada',()=>{
 for(const change of [s=>s.installments[0].kind='wrong',s=>s.installments[1].kind='entry',s=>s.installments[0].dueDate='2026-10-01']){const s=fresh();createInstallments(s,input);change(s);assert.throws(()=>validateBackupState(s));}
});
