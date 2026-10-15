import {dateKey,billBalance,paymentCheck} from './domain.mjs';
export function ensureFinance(s){for(const key of ['installments','installmentHistory','expenses','expensePayments','expensePaymentReversals','paymentReversals','financeHistory']){s[key]??=[];if(!Array.isArray(s[key]))throw Error('Coleção financeira incompatível: '+key);}return s;}
const money=n=>Number.isSafeInteger(n)&&n>=0&&n<=100000000;
const validDate=d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&dateKey(new Date(d+'T12:00:00'))===d;
const live=p=>!p.reversedAt;
const validId=id=>typeof id==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,179}$/.test(id)&&!['constructor','prototype','__proto__'].includes(id);
const record=(s,action,id,reason='',extra={})=>{const value={id:crypto.randomUUID(),at:new Date().toISOString(),actor:'Operador local',action,entityId:id,reason,...extra};s.financeHistory.push(value);return value;};
const reasonText=value=>{if(typeof value!=='string'||value.trim().length<5||value.trim().length>300)throw Error('Informe um motivo entre 5 e 300 caracteres.');return value.trim();};
function operation(s,operationId,fingerprint){if(operationId===undefined)return null;if(!validId(operationId))throw Error('Identificador da operação inválido.');const prior=s.financeHistory.find(h=>h.operationId===operationId);if(prior&&prior.fingerprint!==fingerprint)throw Error('Esta operação já foi usada com outros dados.');return prior;}
const versionCheck=(item,expected)=>{if(expected!==undefined&&expected!==(item.version||1))throw Error('A despesa mudou. Reabra o formulário antes de continuar.');};
export function installmentBalance(s,item){return item.amount-s.payments.filter(p=>live(p)&&p.installmentId===item.id).reduce((n,p)=>n+p.amount,0);}
export function createInstallments(s,{billId,count,firstDueDate}){
 ensureFinance(s);const bill=s.bills.find(b=>b.id===billId&&!b.cancelledAt);if(!bill)throw Error('Cobrança indisponível.');
 if(!Number.isInteger(count)||count<1||count>36||count>bill.total||!validDate(firstDueDate))throw Error('Confira a quantidade de parcelas e o primeiro vencimento.');
 if(s.payments.some(p=>live(p)&&p.billId===billId))throw Error('Há recebimentos nesta cobrança. Estorne-os antes de refazer as parcelas.');
 const day=Number(firstDueDate.slice(8)),year=Number(firstDueDate.slice(0,4)),month=Number(firstDueDate.slice(5,7))-1;
 const base=Math.floor(bill.total/count),remainder=bill.total%count,plan=Array.from({length:count},(_,i)=>{const last=new Date(year,month+i+1,0).getDate(),due=dateKey(new Date(year,month+i,Math.min(day,last),12));return {id:crypto.randomUUID(),billId,number:i+1,count,amount:base+(i<remainder?1:0),dueDate:due};});
 s.installmentHistory.push(...s.installments.filter(p=>p.billId===billId).map(p=>({...p,archivedAt:new Date().toISOString()})));s.installments=s.installments.filter(p=>p.billId!==billId).concat(plan);record(s,'parcelamento',billId);return plan;
}
export function receivePayment(s,p){ensureFinance(s);const bill=s.bills.find(b=>b.id===p.billId&&!b.cancelledAt);if(!bill||!validDate(p.date))throw Error('Cobrança ou data inválida.');if(!validId(p.id)||!validId(p.operationId)||s.payments.some(x=>x.id===p.id))throw Error('Identificador de recebimento inválido ou repetido.');paymentCheck(p,s);const plan=s.installments.filter(i=>i.billId===bill.id);if(plan.length){const item=plan.find(i=>i.id===p.installmentId);if(!item||p.amount>installmentBalance(s,item))throw Error('Selecione a parcela e respeite seu saldo.');}else if(p.installmentId)throw Error('Parcela não pertence ao plano atual da cobrança.');s.payments.push({...p});record(s,'recebimento',p.id);return p;}
export function reversePayment(s,{paymentId,reason,date=dateKey()}){ensureFinance(s);const p=s.payments.find(p=>p.id===paymentId);if(!p||p.reversedAt)throw Error('Recebimento indisponível ou já estornado.');if(!reason?.trim()||reason.trim().length<5||!validDate(date)||date<p.date)throw Error('Informe a data e o motivo do estorno (ao menos 5 caracteres).');p.reversedAt=new Date().toISOString();s.paymentReversals.push({id:crypto.randomUUID(),paymentId,date,amount:p.amount,reason:reason.trim()});record(s,'estorno',paymentId,reason);}
export function cancelBill(s,{billId,reason}){ensureFinance(s);const b=s.bills.find(b=>b.id===billId);if(!b||b.cancelledAt)throw Error('Cobrança indisponível.');if(!reason?.trim()||reason.trim().length<5)throw Error('Informe o motivo do cancelamento.');if(s.payments.some(p=>p.billId===billId&&live(p)))throw Error('Estorne os recebimentos antes de cancelar a cobrança.');if(b.quoteId)throw Error('Cancele esta cobrança pelo orçamento para preservar o vínculo.');b.cancelledAt=new Date().toISOString();b.cancelReason=reason;record(s,'cancelamento_cobranca',billId,reason);}
export function saveExpense(s,item,{reason='',operationId,expectedVersion,date=dateKey()}={}){
 ensureFinance(s);if(!validId(item.id)||typeof item.description!=='string'||!item.description.trim()||item.description.length>200||!money(item.amount)||item.amount===0||!validDate(item.dueDate)||!validDate(date)||!['fixa','variavel','tributo','taxa','outro'].includes(item.category))throw Error('Confira descrição, categoria, valor e vencimento.');
 const value={id:item.id,description:item.description.trim(),amount:item.amount,dueDate:item.dueDate,category:item.category},fingerprint=JSON.stringify(['saveExpense',value,reason,expectedVersion??null,date]);
 const prior=operation(s,operationId,fingerprint);if(prior)return structuredClone(prior.snapshot);
 const old=s.expenses.find(x=>x.id===item.id);if(old?.cancelledAt)throw Error('Despesa cancelada não pode ser corrigida.');
 if(old&&s.expensePayments.some(x=>x.expenseId===old.id&&live(x)))throw Error('Despesa com pagamento ativo não pode ser reescrita. Estorne os pagamentos antes de corrigir.');
 const why=old?reasonText(reason):'';if(old)versionCheck(old,expectedVersion);else if(expectedVersion!==undefined)throw Error('Despesa não encontrada para correção.');
 const previous=old?structuredClone(old):null,now=new Date().toISOString();Object.assign(value,{version:old?(old.version||1)+1:1,createdAt:old?.createdAt||now,updatedAt:now});
 if(old)Object.assign(old,value);else s.expenses.push(value);
 record(s,old?'correcao_despesa':'despesa',value.id,why,{date,operationId,fingerprint,previous,snapshot:structuredClone(value)});return value;
}
export function expenseBalance(s,item){return item.cancelledAt?0:item.amount-(s.expensePayments||[]).filter(x=>x.expenseId===item.id&&live(x)).reduce((n,x)=>n+x.amount,0);}
export function payExpense(s,p){
 ensureFinance(s);if(!validId(p.id)||!validId(p.operationId)||!validId(p.expenseId)||!money(p.amount)||p.amount<=0||!validDate(p.date)||p.method!==undefined&&!['Pix','Dinheiro','Cartão','Transferência','Outro'].includes(p.method))throw Error('Confira a despesa, data e valor a pagar.');
 const fingerprint=JSON.stringify(['payExpense',p.id,p.expenseId,p.amount,p.date,p.method||'']),prior=operation(s,p.operationId,fingerprint);if(prior)return structuredClone(prior.snapshot);
 const existing=s.expensePayments.find(x=>x.operationId===p.operationId||x.id===p.id);if(existing){if(existing.operationId===p.operationId&&existing.id===p.id&&existing.expenseId===p.expenseId&&existing.amount===p.amount&&existing.date===p.date&&(existing.method||'')===(p.method||''))return structuredClone(existing);throw Error('Este pagamento já foi registrado com outros dados.');}
 const expense=s.expenses.find(x=>x.id===p.expenseId);if(!expense||expense.cancelledAt||p.amount>expenseBalance(s,expense))throw Error('Confira a despesa, data e valor a pagar.');
 const value={id:p.id,operationId:p.operationId,expenseId:p.expenseId,amount:p.amount,date:p.date,...(p.method?{method:p.method}:{})};s.expensePayments.push(value);
 record(s,'pagamento_despesa',value.id,'',{date:p.date,expenseId:p.expenseId,operationId:p.operationId,fingerprint,snapshot:structuredClone(value)});return value;
}
export function reverseExpensePayment(s,{paymentId,reason,date=dateKey(),operationId}){
 ensureFinance(s);const why=reasonText(reason);if(!validId(paymentId)||!validDate(date))throw Error('Informe o pagamento e a data do estorno.');
 const fingerprint=JSON.stringify(['reverseExpensePayment',paymentId,why,date]),prior=operation(s,operationId,fingerprint);if(prior)return structuredClone(prior.snapshot);
 const p=s.expensePayments.find(x=>x.id===paymentId);if(!p||p.reversedAt)throw Error('Pagamento indisponível ou já estornado.');if(date<p.date)throw Error('O estorno não pode ocorrer antes do pagamento.');
 const value={id:crypto.randomUUID(),paymentId,expenseId:p.expenseId,date,amount:p.amount,reason:why,...(operationId?{operationId}:{})};p.reversedAt=new Date().toISOString();s.expensePaymentReversals.push(value);
 record(s,'estorno_pagamento_despesa',paymentId,why,{date,expenseId:p.expenseId,operationId,fingerprint,snapshot:structuredClone(value)});return value;
}
export function cancelExpense(s,{expenseId,reason,date=dateKey(),operationId,expectedVersion}){
 ensureFinance(s);const why=reasonText(reason);if(!validId(expenseId)||!validDate(date))throw Error('Despesa ou data inválida.');const fingerprint=JSON.stringify(['cancelExpense',expenseId,why,date,expectedVersion??null]),prior=operation(s,operationId,fingerprint);if(prior)return structuredClone(prior.snapshot);
 const expense=s.expenses.find(x=>x.id===expenseId);if(!expense||expense.cancelledAt)throw Error('Despesa indisponível ou já cancelada.');versionCheck(expense,expectedVersion);
 if(s.expensePayments.some(p=>p.expenseId===expenseId&&live(p)))throw Error('Estorne os pagamentos antes de cancelar a despesa.');
 const previous=structuredClone(expense);Object.assign(expense,{cancelledAt:new Date().toISOString(),cancelledDate:date,cancelReason:why,version:(expense.version||1)+1});
 record(s,'cancelamento_despesa',expenseId,why,{date,operationId,fingerprint,previous,snapshot:structuredClone(expense)});return expense;
}
export function reconcilePayment(s,{paymentId,reference}){ensureFinance(s);const p=s.payments.find(p=>p.id===paymentId&&live(p));if(!p||!reference?.trim())throw Error('Informe o recebimento e a referência de conferência.');p.reconciledAt=new Date().toISOString();p.reconciliationReference=reference.trim().slice(0,160);record(s,'conciliacao_manual',p.id);}
export const FINANCE_PERIODS=Object.freeze([['today','Hoje'],['week','Semana'],['month','Mês'],['3months','3 Meses'],['6months','6 Meses']].map(Object.freeze));
/** String YYYY-MM keeps the full-month legacy contract used by home/goals.
 * Presets are calendar-to-date; date-only arithmetic uses local noon, avoiding UTC drift. */
export function financePeriod(options={}){
 if(typeof options==='string'){if(!/^\d{4}-\d{2}$/.test(options)||!validDate(options+'-01'))throw Error('Mês inválido.');const first=new Date(options+'-01T12:00:00');return{period:'custom-month',label:options,month:options,start:options+'-01',end:dateKey(new Date(first.getFullYear(),first.getMonth()+1,0,12)),today:dateKey()};}
 const {period='month',today=dateKey()}=options;if(!validDate(today)||!FINANCE_PERIODS.some(([key])=>key===period))throw Error('Período financeiro inválido.');const end=today,day=new Date(today+'T12:00:00');let start=today;
 if(period==='week'){day.setDate(day.getDate()-((day.getDay()+6)%7));start=dateKey(day);}else if(period!=='today'){const months=period==='3months'?3:period==='6months'?6:1;start=dateKey(new Date(day.getFullYear(),day.getMonth()-months+1,1,12));}
 return{period,label:FINANCE_PERIODS.find(([key])=>key===period)[1],month:today.slice(0,7),start,end,today};
}
const inPeriod=(date,range)=>typeof date==='string'&&date>=range.start&&date<=range.end;
export function financeReport(s,options=dateKey().slice(0,7)){
 ensureFinance(s);const range=financePeriod(options),included=date=>inPeriod(date,range),sum=(rows,key)=>rows.reduce((n,r)=>n+(r[key]||0),0);
 const bills=s.bills.filter(b=>!b.cancelledAt&&included(b.date)),receipts=s.payments.filter(p=>included(p.date)),reversals=s.paymentReversals.filter(p=>included(p.date)),expenses=s.expenses.filter(e=>!e.cancelledAt&&included(e.dueDate)),paidEvents=s.expensePayments.filter(p=>included(p.date)),expenseReversals=s.expensePaymentReversals.filter(p=>included(p.date));
 const grossReceived=sum(receipts,'amount'),reversed=sum(reversals,'amount'),received=grossReceived-reversed,grossPaid=sum(paidEvents,'amount'),reversedExpenses=sum(expenseReversals,'amount'),paid=grossPaid-reversedExpenses;
 return{...range,billed:sum(bills,'total'),grossReceived,reversed,received,variableCost:sum(bills,'cost'),expenses:sum(expenses,'amount'),grossPaid,reversedExpenses,paid,cash:received-paid,outstanding:s.bills.filter(b=>!b.cancelledAt).reduce((n,b)=>n+billBalance(b,s.payments),0),expenseOutstanding:s.expenses.filter(e=>!e.cancelledAt).reduce((n,e)=>n+expenseBalance(s,e),0),overdue:s.installments.filter(i=>i.dueDate<range.today&&s.bills.some(b=>b.id===i.billId&&!b.cancelledAt)).reduce((n,i)=>n+installmentBalance(s,i),0)};
}
export function financialCSV(s,options){
 // Keep the original first five columns; append context for reconciliation.
 // Only the derived, checked integer-cent amount is emitted as a bare pt-BR
 // number. External text remains quoted and protected from spreadsheet formulas.
 const cell=v=>'"'+String(v??'').replace(/^\s*[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';
 const amount=cents=>{if(!Number.isSafeInteger(cents))throw Error('Valor financeiro inválido para exportação.');const n=Math.abs(cents);return `${cents<0?'-':''}${Math.floor(n/100)},${String(n%100).padStart(2,'0')}`;};
 const bills=new Map(s.bills.map(b=>[b.id,b])),payments=new Map(s.payments.map(p=>[p.id,p])),patients=new Map((s.patients||[]).map(p=>[p.id,p])),expenses=new Map((s.expenses||[]).map(e=>[e.id,e]));
 const context=(billId,method='',installmentId='',expenseId='')=>{const bill=bills.get(billId),patient=patients.get(bill?.patientId);return [patient?.name||'',bill?.patientId||'',billId||'',method||'',installmentId||'',expenseId||''];};
 const rows=[['Tipo','Data','Descrição','Valor (R$)','Situação','Paciente','ID paciente','ID cobrança','Forma de pagamento','ID parcela','ID despesa'],
  ...s.bills.map(b=>['Cobrança',b.date,b.description,b.total,b.cancelledAt?'Cancelada':'Ativa',...context(b.id)]),
  ...s.payments.map(p=>['Recebimento',p.date,bills.get(p.billId)?.description||'Recebimento sem cobrança localizada',p.amount,p.reversedAt?'Estornado posteriormente':p.reconciledAt?'Conferido':'A conferir',...context(p.billId,p.method,p.installmentId)]),
  ...(s.paymentReversals||[]).map(p=>{const original=payments.get(p.paymentId);return ['Estorno',p.date,p.reason,-p.amount,'Registrado',...context(original?.billId,original?.method,original?.installmentId)];}),
  ...(s.expenses||[]).map(e=>['Despesa',e.dueDate,e.description,e.amount,e.cancelledAt?'Cancelada':'Registrada',...context(null,'','',e.id)]),
  ...(s.expensePayments||[]).map(p=>['Pagamento de despesa',p.date,expenses.get(p.expenseId)?.description||p.expenseId,-p.amount,p.reversedAt?'Estornado posteriormente':'Registrado',...context(null,p.method,'',p.expenseId)]),
  ...(s.expensePaymentReversals||[]).map(p=>['Estorno de despesa',p.date,p.reason,p.amount,'Registrado',...context(null,s.expensePayments.find(x=>x.id===p.paymentId)?.method,'',p.expenseId)])];
 const range=options===undefined?null:financePeriod(options),filtered=range?rows.filter((r,i)=>i===0||inPeriod(r[1],range)):rows;
 return '\uFEFF'+filtered.map((r,row)=>r.map((v,column)=>row>0&&column===3?amount(v):cell(v)).join(';')).join('\r\n');
}
