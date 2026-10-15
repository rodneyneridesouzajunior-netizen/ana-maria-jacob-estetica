import test from 'node:test';
import assert from 'node:assert/strict';
import {seed} from '../domain.mjs';
import {validateBackupState} from '../backup.mjs';
import {saveExpense,payExpense,reverseExpensePayment,cancelExpense} from '../finance-domain.mjs';

function expenseState(){
 const s=seed();
 saveExpense(s,{id:'expense-test',description:'Material fictício',amount:10000,dueDate:'2026-10-15',category:'variavel'});
 payExpense(s,{id:'payment-test',operationId:'pay-test',expenseId:'expense-test',amount:10000,date:'2026-10-15',method:'Pix'});
 reverseExpensePayment(s,{paymentId:'payment-test',operationId:'reverse-test',date:'2026-11-01',reason:'Correção do registro fictício'});
 return s;
}

test('backup permite pagar novamente após estorno sem somar pagamento anulado ao saldo',()=>{
 const s=expenseState();
 payExpense(s,{id:'payment-again',operationId:'pay-again',expenseId:'expense-test',amount:10000,date:'2026-11-02',method:'Transferência'});
 assert.doesNotThrow(()=>validateBackupState(s));
 assert.equal(s.expensePayments.length,2);
});

test('backup preserva cancelamento após estorno integral e rejeita pagamento ativo em cancelada',()=>{
 const s=expenseState();
 cancelExpense(s,{expenseId:'expense-test',operationId:'cancel-test',date:'2026-11-02',reason:'Compra fictícia cancelada'});
 assert.doesNotThrow(()=>validateBackupState(s));
 s.expensePayments.push({id:'illegal-pay',operationId:'illegal-op',expenseId:'expense-test',amount:100,date:'2026-11-03'});
 assert.throws(()=>validateBackupState(s),/cancelada/);
});

test('backup rejeita estorno ausente, duplicado, com vínculo trocado, valor ou data incorretos',()=>{
 for(const mutate of [
  s=>s.expensePaymentReversals=[],
  s=>s.expensePaymentReversals.push({...s.expensePaymentReversals[0],id:'duplicate'}),
  s=>s.expensePaymentReversals[0].expenseId='wrong-expense',
  s=>s.expensePaymentReversals[0].amount=9999,
  s=>s.expensePaymentReversals[0].date='2026-10-14',
  s=>s.expensePaymentReversals[0].operationId='pay-test',
 ]){const s=expenseState();mutate(s);assert.throws(()=>validateBackupState(s),/estorno|Estorno/);}
});

test('backup continua aceitando despesas legadas sem novas propriedades e exige coleção válida',()=>{
 const s=seed();s.expenses=[{id:'legacy',description:'Despesa antiga',amount:5000,dueDate:'2026-10-15',category:'fixa'}];
 s.expensePayments=[{id:'legacy-pay',expenseId:'legacy',operationId:'legacy-operation',amount:2500,date:'2026-10-15'}];
 assert.doesNotThrow(()=>validateBackupState(s));
 s.expensePaymentReversals={};
 assert.throws(()=>validateBackupState(s),/Coleção inválida/);
});
