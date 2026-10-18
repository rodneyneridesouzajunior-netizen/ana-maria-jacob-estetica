import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,validateTransition} from './rules.mjs';
import {createInstallments,receivePayment} from '../_shared/app-workspace-domain/finance-domain.mjs';
test('servidor aceita entrada e recebimentos sucessivos e preserva o plano pago',()=>{
 let previous=emptyState();previous.patients.push({id:'patient-entry',name:'Paciente fictícia'});previous.bills.push({id:'bill-entry',patientId:'patient-entry',date:'2026-08-17',total:228000,cost:0,description:'Teste'});
 let next=structuredClone(previous);const plan=createInstallments(next,{billId:'bill-entry',count:3,firstDueDate:'2026-09-15',entryAmount:60000,entryDueDate:'2026-08-17'});assert.doesNotThrow(()=>validateTransition(previous,next));
 for(let i=0;i<3;i++){previous=structuredClone(next);receivePayment(next,{id:'entry-pay-'+i,operationId:'entry-op-'+i,billId:'bill-entry',installmentId:plan[i].id,amount:plan[i].amount,date:plan[i].dueDate,method:'Pix'});assert.doesNotThrow(()=>validateTransition(previous,next));}
 previous=structuredClone(next);next.installments[0].amount=59999;next.installments[3].amount++;assert.throws(()=>validateTransition(previous,next));
});
