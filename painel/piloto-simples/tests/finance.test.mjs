import test from 'node:test';
import assert from 'node:assert/strict';
import {seed} from '../domain.mjs';
import {ensureFinance,financePeriod,financeReport,financialCSV,saveExpense,payExpense,reverseExpensePayment,cancelExpense,expenseBalance,receivePayment,reversePayment} from '../finance-domain.mjs';
import {renderFinancePage,mountFinance} from '../finance-ui.mjs';

function fresh(){const s=seed();s.bills=[{id:'bill',patientId:'demo-marina',visitId:'demo-consulta',date:'2026-10-01',description:'Cobrança fictícia',total:20000,cost:2000}];s.payments=[];ensureFinance(s);return s;}
const expense=(s,change={})=>saveExpense(s,{id:'expense',description:'Despesa fictícia',amount:10001,dueDate:'2026-10-15',category:'fixa',...change});
const payment=(s,change={})=>payExpense(s,{id:'paid',expenseId:'expense',operationId:'pay-op',amount:6001,date:'2026-10-15',method:'Pix',...change});
const reverse=(s,change={})=>reverseExpensePayment(s,{paymentId:'paid',operationId:'reverse-op',reason:'Devolução fictícia',date:'2026-11-02',...change});
const interval=(period,today)=>{const {start,end}=financePeriod({period,today});return[start,end];};
function csvRows(csv){const rows=[];let row=[],text='',quoted=false;for(let i=1;i<csv.length;i++){const c=csv[i];if(c==='"'){if(quoted&&csv[i+1]==='"'){text+='"';i++;}else quoted=!quoted;}else if(!quoted&&c===';'){row.push(text);text='';}else if(!quoted&&c==='\r'&&csv[i+1]==='\n'){row.push(text);rows.push(row);row=[];text='';i++;}else text+=c;}row.push(text);rows.push(row);return rows;}

test('períodos usam calendário e semana segunda-hoje, inclusive virada de ano e domingo',()=>{
 assert.deepEqual(interval('today','2026-10-15'),['2026-10-15','2026-10-15']);
 assert.deepEqual(interval('week','2026-10-15'),['2026-10-12','2026-10-15']);
 assert.deepEqual(interval('week','2027-01-01'),['2026-12-28','2027-01-01']);
 assert.deepEqual(interval('week','2026-10-18'),['2026-10-12','2026-10-18']);
 assert.deepEqual(interval('week','2026-10-19'),['2026-10-19','2026-10-19']);
 assert.deepEqual(interval('3months','2027-01-31'),['2026-11-01','2027-01-31']);
 assert.deepEqual(interval('6months','2027-01-31'),['2026-08-01','2027-01-31']);
});
test('mês legado permanece completo e presets terminam hoje; datas inexistentes são rejeitadas',()=>{
 assert.equal(financePeriod('2028-02').end,'2028-02-29');
 assert.equal(financePeriod('2026-02').end,'2026-02-28');
 assert.deepEqual(interval('month','2026-02-10'),['2026-02-01','2026-02-10']);
 for(const invalid of [{period:'week',today:'2026-02-30'},{period:'year',today:'2026-10-15'},'2026-13','2026-2'])assert.throws(()=>financePeriod(invalid),/inválid/);
 const s=fresh();receivePayment(s,{id:'future',operationId:'f-op',billId:'bill',amount:100,date:'2026-10-31',method:'Pix'});
 assert.equal(financeReport(s,'2026-10').received,100);assert.equal(financeReport(s,{period:'month',today:'2026-10-15'}).received,0);
});
test('intervalos inclusivos somam eventos reais e excluem fora do início/fim sem duplicar',()=>{
 const s=fresh();for(const [i,date] of ['2026-05-01','2026-08-01','2026-10-01','2026-10-12','2026-10-15','2026-10-16'].entries())receivePayment(s,{id:'p'+i,operationId:'op'+i,billId:'bill',amount:100+i,date,method:'Pix'});
 reversePayment(s,{paymentId:'p2',date:'2026-10-15',reason:'Estorno de teste'});
 const expected={today:2,week:105,month:207,'3months':308,'6months':408};
 for(const [period,received]of Object.entries(expected))assert.equal(financeReport(s,{period,today:'2026-10-15'}).received,received,period);
 assert.equal(financeReport(s,{period:'week',today:'2026-10-15'}).outstanding,20000-(100+101+103+104+105));
});
test('estorno de despesa preserva saída original e devolução na data do evento',()=>{
 const s=fresh();expense(s);payment(s);const original=structuredClone(s.expensePayments[0]);reverse(s);
 const october=financeReport(s,'2026-10'),november=financeReport(s,'2026-11'),both=financeReport(s,{period:'3months',today:'2026-11-03'});
 assert.equal(october.grossPaid,6001);assert.equal(october.paid,6001);assert.equal(october.cash,-6001);
 assert.equal(november.grossPaid,0);assert.equal(november.reversedExpenses,6001);assert.equal(november.paid,-6001);assert.equal(november.cash,6001);
 assert.equal(both.cash,0);assert.equal(expenseBalance(s,s.expenses[0]),10001);
 const {reversedAt,...preserved}=s.expensePayments[0];assert.ok(reversedAt);assert.deepEqual(preserved,original);
 assert.equal(s.expensePaymentReversals.length,1);
});
test('pagamento parcial, estorno e novo pagamento fecham o saldo exato em centavos',()=>{
 const s=fresh();expense(s);payment(s);assert.equal(expenseBalance(s,s.expenses[0]),4000);reverse(s);
 payment(s,{id:'paid2',operationId:'pay2',amount:10001,date:'2026-11-03'});assert.equal(expenseBalance(s,s.expenses[0]),0);
 assert.throws(()=>payment(s,{id:'paid3',operationId:'pay3',amount:1}),/valor a pagar/);
 assert.equal(financeReport(s,{period:'3months',today:'2026-11-03'}).cash,-10001);
});
test('retry de pagamento e estorno usa a mesma operação sem repetir efeito; chave alterada rejeita',()=>{
 const s=fresh();expense(s);const p=payment(s);assert.deepEqual(payment(s),p);assert.equal(s.expensePayments.length,1);
 assert.throws(()=>payment(s,{amount:5000}),/outros dados/);
 const r=reverse(s),count=s.financeHistory.length;assert.deepEqual(reverse(s),r);assert.equal(s.financeHistory.length,count);
 assert.throws(()=>reverse(s,{reason:'Outro motivo'}),/outros dados/);assert.throws(()=>reverse(s,{operationId:'another'}),/já estornado/);
 assert.equal(s.expensePaymentReversals.length,1);
});
test('estorno rejeita dia anterior, dia impossível, motivo vazio sem alterar estado',()=>{
 const s=fresh();expense(s);payment(s);const before=structuredClone(s);
 for(const data of [{date:'2026-10-14'},{date:'2026-02-30'},{reason:' '},{reason:'x'.repeat(301)}]){assert.throws(()=>reverse(s,data));assert.deepEqual(s,before);}
});
test('correção exige motivo e versão atual, preserva snapshots independentes e não aceita pagamentos ativos',()=>{
 const s=fresh();expense(s);const old=structuredClone(s.expenses[0]),newData={...old,amount:9000,description:'Descrição corrigida'},opts={operationId:'edit',expectedVersion:1,reason:'Correção de valor',date:'2026-10-16'};
 assert.throws(()=>saveExpense(s,newData),/motivo/);assert.throws(()=>saveExpense(s,newData,{...opts,expectedVersion:4}),/mudou/);assert.deepEqual(s.expenses[0],old);
 const value=saveExpense(s,newData,opts),history=s.financeHistory.at(-1);assert.deepEqual(history.previous,old);assert.equal(value.version,2);assert.equal(history.snapshot.amount,9000);
 const count=s.financeHistory.length;assert.deepEqual(saveExpense(s,newData,opts),value);assert.equal(s.financeHistory.length,count);
 saveExpense(s,{...newData,description:'Outra correção'},{...opts,operationId:'edit2',expectedVersion:2});assert.equal(history.snapshot.description,'Descrição corrigida');assert.equal(history.previous.description,'Despesa fictícia');
 payment(s);assert.throws(()=>saveExpense(s,{...newData,amount:10000},{...opts,operationId:'edit3',expectedVersion:3}),/Estorne/);
});
test('correção após estorno mantém pagamento anterior e aceita novo valor menor',()=>{
 const s=fresh();expense(s);payment(s);reverse(s);saveExpense(s,{...s.expenses[0],amount:100},{reason:'Correção após devolução',operationId:'correct',expectedVersion:1,date:'2026-11-03'});
 assert.equal(s.expensePayments[0].amount,6001);assert.equal(expenseBalance(s,s.expenses[0]),100);assert.equal(financeReport(s,'2026-10').cash,-6001);assert.equal(financeReport(s,'2026-11').cash,6001);
});
test('cancelamento exige estorno, preserva registro e impede pagamento/correção; retry não duplica',()=>{
 const s=fresh();expense(s);payment(s);const payload={expenseId:'expense',reason:'Cancelamento fictício',date:'2026-11-03',operationId:'cancel',expectedVersion:1};
 assert.throws(()=>cancelExpense(s,payload),/Estorne/);reverse(s);const cancelled=cancelExpense(s,payload),count=s.financeHistory.length;
 assert.ok(cancelled.cancelledAt);assert.equal(s.expenses.length,1);assert.equal(expenseBalance(s,cancelled),0);assert.equal(financeReport(s,'2026-10').expenses,0);
 assert.deepEqual(cancelExpense(s,payload),cancelled);assert.equal(s.financeHistory.length,count);
 assert.throws(()=>payment(s,{id:'new',operationId:'new'}),/valor a pagar/);assert.throws(()=>saveExpense(s,{...cancelled,amount:100}),/cancelada/);
 assert.equal(financeReport(s,{period:'3months',today:'2026-11-03'}).cash,0);
});
test('dados legados sem versões, método ou coleção de estornos continuam operáveis',()=>{
 const s=fresh();delete s.expensePaymentReversals;s.expenses=[{id:'expense',description:'Legada',amount:10001,dueDate:'2026-10-15',category:'outro'}];s.expensePayments=[{id:'paid',operationId:'old',expenseId:'expense',amount:6001,date:'2026-10-15'}];
 assert.equal(financeReport(s,'2026-10').paid,6001);reverse(s);cancelExpense(s,{expenseId:'expense',reason:'Encerramento legado',expectedVersion:1});assert.equal(s.expenses[0].version,2);assert.equal(s.expensePayments[0].method,undefined);
});
test('campos externos não fabricam cancelamento/estorno e valores fracionários são recusados',()=>{
 const s=fresh();expense(s,{cancelledAt:'2026-10-15',version:100});assert.equal(s.expenses[0].cancelledAt,undefined);assert.equal(s.expenses[0].version,1);
 payment(s,{reversedAt:'2026-10-15'});assert.equal(s.expensePayments[0].reversedAt,undefined);
 assert.throws(()=>payment(s,{id:'bad',operationId:'bad',amount:1.5}),/valor a pagar/);
});
test('CSV selecionado fecha o caixa com estornos e mantém textos externos neutralizados',()=>{
 const s=fresh();expense(s,{description:'=HYPERLINK("teste";"x")'});payment(s);reverse(s,{reason:'=Devolução fictícia'});
 const options={period:'month',today:'2026-11-03'},rows=csvRows(financialCSV(s,options)).slice(1);
 assert.ok(rows.every(row=>row[1]>='2026-11-01'&&row[1]<='2026-11-03'));assert.equal(rows.length,1);assert.equal(rows[0][0],'Estorno de despesa');assert.equal(rows[0][2],"'=Devolução fictícia");assert.equal(rows[0][3],'60,01');assert.equal(rows[0][10],'expense');
 const cashTypes=['Recebimento','Estorno','Pagamento de despesa','Estorno de despesa'];
 assert.equal(rows.filter(r=>cashTypes.includes(r[0])).reduce((n,r)=>n+Number(r[3].replace(',','')),0),financeReport(s,options).cash);
 const all=csvRows(financialCSV(s));assert.equal(all.find(r=>r[0]==='Pagamento de despesa')[3],'-60,01');assert.ok(all.find(r=>r[0]==='Despesa')[2].startsWith("'="));
});
test('UI filtra movimentos, expõe motivo do estorno e mantém acesso ao cadastro fora de seis meses',()=>{
 const s=fresh();expense(s,{description:'<img src=x onerror=alert(1)>'});payment(s);reverse(s);s.bills.push({id:'old',patientId:'demo-marina',date:'2025-01-01',description:'ANTIGA',total:100,cost:0});
 const html=renderFinancePage(s,{period:'today',today:'2026-11-02'});assert.match(html,/02\/11\/2026 a 02\/11\/2026/);assert.match(html,/Devolução fictícia/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img src=x/);assert.doesNotMatch(html,/data-fin="reverse-expense"/);assert.doesNotMatch(html,/ANTIGA/);
 const all=renderFinancePage(s,{period:'today',today:'2026-11-02',allRecords:true});assert.match(all,/ANTIGA/);assert.match(all,/data-fin="expense-history"/);assert.match(all,/data-fin="cancel-expense"/);assert.match(all,/data-fin="all-records"/);
});
test('seleção de período usa o handler montado, não muda dados, e persiste durante rerender',async()=>{
 const s=fresh(),before=structuredClone(s);let listener,rendered='',mutations=0;const host={addEventListener:(_event,fn)=>listener=fn,querySelector:()=>({dataset:{financePeriod:'month',financeToday:'2026-10-15'}})};
 mountFinance(host,{getState:()=>s,mutate:()=>mutations++,notify:message=>assert.fail(message),rerender:()=>{rendered=renderFinancePage(s);}});
 await listener({target:{closest:()=>({dataset:{fin:'period',period:'week'}})}});assert.match(rendered,/data-finance-period="week"/);assert.equal(mutations,0);assert.deepEqual(s,before);
 await listener({target:{closest:()=>({dataset:{fin:'period',period:'month'}})}});
});
