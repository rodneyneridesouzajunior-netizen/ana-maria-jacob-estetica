import test from 'node:test';
import assert from 'node:assert/strict';
import {cents,appointmentCheck,normalizedPoint,annotationCheck,translateAnnotation,quantityTotals,billBalance,paymentCheck,financialSummary,seed} from '../domain.mjs';
test('dinheiro é calculado em centavos e rejeita texto ambíguo',()=>{assert.equal(cents('159,90'),15990);assert.equal(cents('0.10'),10);assert.throws(()=>cents('1.234,00'));assert.throws(()=>cents('-1'));assert.throws(()=>cents('1.999'));});
test('agenda permite horários adjacentes mas recusa sobreposição e data impossível',()=>{const s=seed(),a={...s.appointments[0],id:'novo',time:'10:00',duration:60};assert.equal(appointmentCheck(a,s.appointments,s.patients),a);assert.throws(()=>appointmentCheck({...a,time:'09:30'},s.appointments,s.patients),/intervalo/);assert.throws(()=>appointmentCheck({...a,date:'2026-02-30'},[],s.patients),/Data/);});
test('cancelamento libera intervalo sem apagar o agendamento',()=>{const s=seed(),a={...s.appointments[0],id:'novo'};assert.doesNotThrow(()=>appointmentCheck(a,[{...s.appointments[0],status:'cancelado'}],s.patients));});
test('coordenadas acompanham a mesma foto mesmo em zoom e deslocamento',()=>{assert.deepEqual(normalizedPoint(150,250,{left:50,top:50,width:200,height:400}),{x:.5,y:.5});assert.deepEqual(normalizedPoint(300,600,{left:0,top:0,width:600,height:1200}),{x:.5,y:.5});assert.deepEqual(normalizedPoint(-4,500,{left:0,top:0,width:100,height:100}),{x:0,y:1});});
const point={id:'p1',kind:'ponto',x:.2,y:.4,region:'Teste',product:'',lot:'',notes:'',quantity:null,unit:'sem quantidade'};
test('anotações rejeitam coordenadas, quantidades e unidades inválidas',()=>{assert.equal(annotationCheck(point),point);assert.throws(()=>annotationCheck({...point,x:NaN}));assert.throws(()=>annotationCheck({...point,kind:'linha'}));assert.throws(()=>annotationCheck({...point,quantity:-1,unit:'mL'}));assert.throws(()=>annotationCheck({...point,quantity:1,unit:'sem quantidade'}));});
test('arraste de linha e leque preserva comprimento e direção nas bordas',()=>{
  for(const kind of ['linha','leque']){
    const original={...point,kind,x:.4,y:.4,x2:.8,y2:.8};
    const moved=translateAnnotation(original,{x:.9,y:.9});
    assert.equal(moved.x2,1);assert.equal(moved.y2,1);
    assert.ok(Math.abs((moved.x2-moved.x)-(original.x2-original.x))<1e-12);
    assert.ok(Math.abs((moved.y2-moved.y)-(original.y2-original.y))<1e-12);
    const back=translateAnnotation(moved,{x:.4,y:.4});
    assert.ok(Math.abs(back.x2-.8)<1e-12);assert.ok(Math.abs(back.y2-.8)<1e-12);
  }
});
test('totais não somam U, mL e mg como se fossem a mesma medida',()=>{assert.deepEqual(quantityTotals([{quantity:.1,unit:'mL'},{quantity:.2,unit:'mL'},{quantity:3,unit:'U'},{quantity:null,unit:'sem quantidade'}]),{mL:.3,U:3});});
test('recebimento parcial difere de cobrança e contribuição não se chama lucro',()=>{const s=seed(),sums=financialSummary(s);assert.equal(sums.received,20000);assert.equal(sums.billed,50000);assert.equal(sums.outstanding,30000);assert.equal(sums.contribution,38000);assert.equal(billBalance(s.bills[0],s.payments),30000);});
test('recebimento não admite duplicidade nem baixa acima do saldo',()=>{const s=seed(),p={id:'novo',operationId:'op-nova',billId:s.bills[0].id,amount:30000,method:'Pix'};assert.doesNotThrow(()=>paymentCheck(p,s));assert.throws(()=>paymentCheck({...p,amount:30001},s),/saldo/);assert.throws(()=>paymentCheck({...p,operationId:s.payments[0].operationId},s),/já foi/);});
