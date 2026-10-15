import test from 'node:test';
import assert from 'node:assert/strict';
import {seed} from '../domain.mjs';
import {savePatient,validCPF,patientMatches,patientActivity,selectPatients,validatePatientRecord,validatePatientHistory} from '../patients-domain.mjs';
const now='2026-10-15T12:00:00Z',today='2026-10-15';
const input=(overrides={})=>({id:'patient-test',name:'Ana Fictícia',cpf:'529.982.247-25',phone:'(31) 99999-0000',email:'TESTE@EXAMPLE.INVALID',birthDate:'1995-01-10',postalCode:'32600-000',address:'Rua de Teste',addressNumber:'10A',complement:'Sala fictícia',neighborhood:'Centro',city:'Betim',state:'mg',notes:'Não contatar; teste local.',color:'purple',...overrides});
const save=(s,data=input(),options={})=>savePatient(s,data,{expectedVersion:0,operationId:'create',now,today,...options});

test('cadastro completo preserva endereço manual, notas e cor; normaliza CPF/CEP/UF e não altera outros módulos',()=>{
 const s=seed(),before=structuredClone(s);const patient=save(s);assert.equal(patient.cpf,'52998224725');assert.equal(patient.postalCode,'32600000');assert.equal(patient.state,'MG');assert.equal(patient.email,'teste@example.invalid');assert.equal(patient.color,'purple');assert.equal(patient.addressNumber,'10A');assert.equal(patient.version,1);assert.deepEqual(s.visits,before.visits);assert.deepEqual(s.bills,before.bills);assert.deepEqual(s.appointments,before.appointments);assert.equal(s.patientHistory.length,1);assert.doesNotThrow(()=>validatePatientHistory(s,{today}));
});
test('edição legada aditiva preserva campos antigos desconhecidos e cria versão/histórico sem trocar vínculo',()=>{
 const s=seed(),patient=s.patients[0];patient.custom={preserved:true};patient.address='Endereço anterior';patient.notes='Nota anterior';const old=structuredClone(patient);savePatient(s,{id:patient.id,name:'Nome corrigido'},{expectedVersion:1,operationId:'edit',now,today});assert.equal(patient.address,'Endereço anterior');assert.equal(patient.notes,'Nota anterior');assert.deepEqual(patient.custom,{preserved:true});assert.equal(patient.version,2);assert.deepEqual(s.patientHistory[0].previous,old);assert.equal(s.visits[0].patientId,patient.id);patient.name='Mudança posterior';assert.equal(s.patientHistory[0].snapshot.name,'Nome corrigido');assert.equal(old.version,undefined);
});
test('repetição idempotente não duplica cadastro/histórico e mesma chave com conteúdo diferente é recusada',()=>{
 const s=seed(),first=save(s);save(s);assert.equal(s.patientHistory.length,1);assert.equal(s.patients.filter(p=>p.id===first.id).length,1);assert.throws(()=>save(s,input({name:'Dados diferentes'})),/outros dados/);assert.equal(s.patientHistory.length,1);
});
test('edição obsoleta é recusada sem perder versão nem histórico',()=>{
 const s=seed();save(s);save(s,input({notes:'Nova nota'}),{expectedVersion:1,operationId:'edit'});const before=structuredClone(s);assert.throws(()=>save(s,input({notes:'Aba antiga'}),{expectedVersion:1,operationId:'stale'}),/mudou/);assert.deepEqual(s,before);save(s);assert.equal(s.patientHistory.length,2);assert.equal(s.patients.at(-1).notes,'Nova nota');
});
test('campos inválidos e CPF duplicado não produzem atualização parcial',()=>{
 for(const override of [{cpf:'00000000000'},{cpf:'abc'},{cpf:'52998224724'},{postalCode:'3260a000'},{postalCode:'123'},{state:'ZZ'},{color:'url(evil)'},{birthDate:'2026-02-30'},{birthDate:'2027-01-01'},{email:'inválido'},{phone:'123'},{notes:'x'.repeat(5001)}]){const s=seed(),before=structuredClone(s);assert.throws(()=>save(s,input(override)));assert.deepEqual(s,before);}
 const s=seed();save(s);const before=structuredClone(s);assert.throws(()=>save(s,input({id:'another'}),{operationId:'duplicate'}),/Já existe/);assert.deepEqual(s,before);assert.equal(validCPF('529.982.247-25'),true);assert.equal(validCPF('000.000.000-00'),false);assert.equal(validCPF('abc'),false);
});
test('campos opcionais podem ser limpos explicitamente e chamadas antigas continuam válidas',()=>{
 const s=seed();const created=save(s);savePatient(s,{...created,phone:'',email:'',cpf:'',birthDate:'',postalCode:'',address:'',state:'',notes:''});const p=s.patients.at(-1);assert.equal(p.version,2);assert.equal(p.postalCode,'');assert.equal(p.phone,'');assert.doesNotThrow(()=>validatePatientRecord({id:'legacy',name:'Registro legado'},{today}));
});
test('busca normaliza acentos, formatação de telefone/CPF/CEP e inclui endereço sem expor notas',()=>{
 const p=input();for(const q of ['ANA FICTICIA','31999990000','529982247','32600000','centro','BETIM','Rua de Teste'])assert.equal(patientMatches(p,q),true,q);assert.equal(patientMatches(p,'Não contatar'),false);assert.equal(patientMatches(p,'nome99999'),false);
});
test('mais de 90 dias usa atendimento concluído e datas civis; 90 exatos, ausência, rascunho e futuro não entram',()=>{
 const s={patients:[{id:'p90',name:'Noventa'},{id:'p91',name:'Noventa e um'},{id:'none',name:'Sem consulta'}],visits:[{id:'a',patientId:'p90',date:'2026-07-17',status:'concluido'},{id:'b',patientId:'p91',date:'2026-07-16',status:'concluido'},{id:'draft',patientId:'p91',date:today,status:'rascunho'},{id:'cancel',patientId:'p91',date:today,status:'cancelado'},{id:'future',patientId:'p91',date:'2027-01-01',status:'concluido'},{id:'invalid',patientId:'p91',date:'2026-02-30',status:'concluido'}]};assert.equal(patientActivity(s,'p90',{today}).daysSinceLastCompleted,90);assert.equal(patientActivity(s,'p91',{today}).daysSinceLastCompleted,91);assert.deepEqual(selectPatients(s,{filter:'over90',today}).map(x=>x.patient.id),['p91']);assert.equal(patientActivity(s,'none',{today}).over90,false);assert.equal(patientActivity({visits:[{patientId:'p',id:'v',date:'2028-02-28',status:'concluido'}]},'p',{today:'2028-03-01'}).daysSinceLastCompleted,2);
});
test('retornos usa apenas previsão em aberto com consulta da mesma paciente e combina busca/cor',()=>{
 const s={patients:[{id:'p',name:'Ana Teste',color:'purple'},{id:'other',name:'Outra Teste'}],visits:[{id:'v',patientId:'p',date:today,status:'concluido'}],expectedReturns:[{id:'pending',patientId:'p',sourceVisitId:'v',date:'2026-10-30',status:'previsto'},{id:'scheduled',patientId:'p',sourceVisitId:'v',date:'2026-10-31',status:'agendado'},{id:'cancel',patientId:'p',sourceVisitId:'v',date:'2026-10-30',status:'cancelado'},{id:'wrong',patientId:'other',sourceVisitId:'v',date:'2026-10-30',status:'previsto'}]};assert.equal(patientActivity(s,'p',{today}).pendingReturns.length,1);assert.deepEqual(selectPatients(s,{filter:'returns',color:'purple',query:'ANA',today}).map(x=>x.patient.id),['p']);assert.equal(selectPatients(s,{filter:'returns',color:'blue',today}).length,0);assert.equal(selectPatients(s,{filter:'returns',query:'Outra',today}).length,0);
});
test('validação histórica verifica paciente, versões, operação e valores em snapshots sem mutar dados',()=>{
 const s=seed();save(s);save(s,input({notes:'Correção'}),{expectedVersion:1,operationId:'edit'});const before=structuredClone(s);validatePatientHistory(s,{today});assert.deepEqual(s,before);for(const patch of [x=>x.patientHistory[1].previous.id='outra',x=>x.patientHistory[1].snapshot.version=9,x=>x.patientHistory[1].snapshot.color='invalida',x=>x.patientHistory[1].operationId='create',x=>x.patientHistory[1].previous=null]){const altered=structuredClone(s);patch(altered);assert.throws(()=>validatePatientHistory(altered,{today}));}
});
