import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {renderPatientRecordOverview} from '../patient-record-ui.mjs';

const require=createRequire(new URL('../../../../../skinpro-analise/test-tools/package.json',import.meta.url));
const {JSDOM}=require('jsdom');
function fixture(){return{
 patients:[{id:'p',name:'Marina Fictícia',cpf:'12345678909',phone:'(31) 90000-0000',email:'teste@example.invalid',birthDate:'1990-02-15',postalCode:'32600000',address:'Rua de teste',addressNumber:'10',complement:'Sala 2',neighborhood:'Centro',city:'Betim',state:'MG',notes:'Observação administrativa',color:'purple',updatedAt:'2026-10-15T14:00:00.000Z'},{id:'other',name:'Outra paciente'}],
 visits:[{id:'open',patientId:'p',appointmentId:'apt',service:'Avaliação em andamento',date:'2026-10-15',status:'rascunho',photos:[{id:'photo'}],professionalId:'professional'},{id:'done',patientId:'p',service:'Atendimento concluído',date:'2026-10-10',status:'concluido',completedAt:'2026-10-10T16:00:00.000Z',photos:[],billId:'bill'},{id:'cancelled',patientId:'p',service:'Atendimento cancelado',date:'2026-10-09',status:'cancelado',photos:[]},{id:'other-visit',patientId:'other',service:'Não pertence à paciente',date:'2026-10-16',status:'em_atendimento',photos:[]}],
 appointments:[{id:'apt',patientId:'p',service:'Agendamento vinculado',date:'2026-10-15',time:'10:00',duration:60,status:'em_atendimento'},{id:'next',patientId:'p',service:'Retorno agendado',date:'2026-10-30',time:'11:00',duration:30,status:'confirmado'},{id:'other-apt',patientId:'other',service:'Agenda de outra paciente',date:'2026-10-30',status:'agendado'}],
 expectedReturns:[{id:'return',patientId:'p',sourceVisitId:'done',date:'2026-10-30',status:'previsto'},{id:'return-cancelled',patientId:'p',sourceVisitId:'done',date:'2026-10-20',status:'cancelado'},{id:'other-return',patientId:'other',sourceVisitId:'other-visit',date:'2026-11-01',status:'previsto'}],
 documentResponses:[{id:'draft',patientId:'p',visitId:'open',kind:'anamnese',status:'rascunho',createdAt:'2026-10-15T15:00:00.000Z'}],
 bills:[{id:'bill',patientId:'p',visitId:'done',total:50000}],clinic:{professionals:[{id:'professional',name:'Profissional de teste'}]}
};}
function render(t,state=fixture(),options={}){const dom=new JSDOM('<body>'+renderPatientRecordOverview(state,{patientId:'p',connected:true,...options})+'</body>');t.after(()=>dom.window.close());return dom.window.document;}
const text=el=>el.textContent.replace(/\s+/g,' ').trim();
function deepFreeze(value){if(value&&typeof value==='object'){for(const v of Object.values(value))deepFreeze(v);Object.freeze(value);}return value;}

test('visão geral organiza dados completos reais da paciente sem mutar estado',t=>{
 const state=deepFreeze(fixture()),before=structuredClone(state),d=render(t,state);
 assert.equal(d.querySelector('h1').textContent,'Marina Fictícia');assert.equal(d.querySelector('.pr-avatar').textContent,'MF');assert.equal(d.querySelector('.pr-profile').dataset.patientColor,'purple');
 assert.deepEqual([...d.querySelectorAll('.pr-stat strong')].map(e=>e.textContent),['3','1']);
 const info=text(d.querySelector('.pr-info'));for(const expected of ['123.456.789-09','(31) 90000-0000','teste@example.invalid','15/02/1990','Rua de teste, 10','Sala 2','Centro','Betim / MG','32600000','Observação administrativa'])assert.ok(info.includes(expected),expected);
 assert.match(text(d.querySelector('.pr-updated')),/15\/10\/2026.*12:00/);assert.equal(d.querySelectorAll('.pr-sidebar').length,1);assert.equal(d.querySelectorAll('.pr-main').length,1);assert.deepEqual(state,before);
});
test('ações e links preservam rotas funcionais de registro, documentos, cadastro e novo atendimento',t=>{
 const d=render(t),open=d.querySelector('[data-visit-id="open"]');
 assert.equal(d.querySelector('.pr-back').getAttribute('href'),'#pacientes');assert.equal(d.querySelector('[data-action="edit-patient"]').dataset.id,'p');assert.ok(d.querySelector('[data-action="new-visit"]'));
 assert.deepEqual([...open.querySelectorAll('a')].map(a=>[a.textContent,a.getAttribute('href')]),[['Continuar atendimento','#paciente/p/open/registro'],['Documentos','#paciente/p/open/documentos'],['Ver prontuário','#paciente/p/open/resumo']]);
 assert.equal(d.querySelector('.pr-anamnesis a').getAttribute('href'),'#paciente/p/open/documentos');assert.ok(d.querySelector('a[href="#orcamentos"]'));assert.match(text(d.querySelector('.pr-profile')),/lista geral/);
 assert.ok(d.querySelector('a[href="#paciente/p/comparacoes"]'));assert.ok(d.querySelector('.pr-returns a[href="#agenda"]'));
});
test('status em andamento, concluído, cancelado e agendamento são distintos sem contar agenda duas vezes',t=>{
 const d=render(t);assert.equal(d.querySelector('[data-visit-id="open"] .pr-badge').textContent,'Em andamento');assert.equal(d.querySelector('[data-visit-id="done"] .pr-badge').textContent,'Concluído');assert.equal(d.querySelector('[data-visit-id="cancelled"] .pr-badge').textContent,'Cancelado');
 assert.equal(d.querySelectorAll('.pr-visit-active').length,1);assert.equal(d.querySelectorAll('.pr-visit-scheduled').length,1);assert.equal(d.querySelector('[data-appointment-id="next"] .pr-badge').textContent,'Confirmado');assert.ok(!d.querySelector('[data-appointment-id="apt"]'));
 assert.ok(!text(d.body).includes('Não pertence à paciente'));assert.ok(!text(d.body).includes('Agenda de outra paciente'));assert.equal(d.querySelectorAll('.pr-return-card').length,1);
 assert.ok(![...d.querySelector('[data-visit-id="done"]').querySelectorAll('a')].some(a=>a.textContent==='Continuar atendimento'));
});
test('registro bloqueado ou cancelamento explícito nunca oferece continuar',t=>{
 const s=fixture();s.visits[0].lockedAt='2026-10-15T15:00:00Z';const d=render(t,s);assert.equal(d.querySelector('[data-visit-id="open"] .pr-badge').textContent,'Registro bloqueado');assert.equal(d.querySelectorAll('.pr-visit-active').length,0);assert.equal(d.querySelectorAll('.pr-stat strong')[1].textContent,'0');
 s.visits[0].cancelledAt='2026-10-15T16:00:00Z';const cancelled=render(t,s);assert.equal(cancelled.querySelector('[data-visit-id="open"] .pr-badge').textContent,'Cancelado');
});
test('anamnese não infere assinatura oficial de rascunho ou demonstração',t=>{
 const s=fixture(),draft=render(t,s);assert.equal(draft.querySelector('.pr-anamnesis .pr-badge').textContent,'Ficha em rascunho');assert.match(text(draft.querySelector('.pr-anamnesis')),/assinatura oficial não confirmada/);
 s.documentResponses[0].status='assinado_demo';s.documentResponses[0].signature={signedAt:'2026-10-15T17:00:00.000Z'};const demo=render(t,s);assert.equal(demo.querySelector('.pr-anamnesis .pr-badge').textContent,'Registro de demonstração');assert.match(text(demo.querySelector('.pr-anamnesis')),/Não indica assinatura oficial/);
 s.documentResponses=[];const empty=render(t,s);assert.equal(empty.querySelector('.pr-anamnesis .pr-badge').textContent,'Sem ficha preparada');assert.match(text(empty.querySelector('.pr-anamnesis')),/Consulte o recebimento/);
});
test('anamnese se refere ao último atendimento, sem reutilizar assinatura de outro registro',t=>{
 const s=fixture();s.documentResponses=[{id:'old',patientId:'p',visitId:'done',kind:'anamnese',status:'assinado_demo'},{id:'other-doc',patientId:'other',visitId:'open',kind:'anamnese',status:'rascunho'}];const d=render(t,s);assert.equal(d.querySelector('.pr-anamnesis .pr-badge').textContent,'Sem ficha preparada');assert.equal(d.querySelector('.pr-anamnesis a').getAttribute('href'),'#paciente/p/open/documentos');
});
test('comparação renderizada pelo módulo existente é embutida uma vez sem trocar seus controles',t=>{
 const comparisonHtml='<section class="comparison-library"><button type="button" data-library="new">Nova comparação</button><div data-library-editor></div></section>',d=render(t,fixture(),{comparisonHtml}),template=d.createElement('template');template.innerHTML=comparisonHtml;assert.equal(d.querySelectorAll('#comparison-panel').length,1);assert.equal(d.querySelector('#comparison-panel').innerHTML,template.innerHTML);assert.ok(d.querySelector('#comparison-panel [data-library="new"]'));
});
test('textos e atributos de paciente, atendimento, informação e profissionais escapam HTML',t=>{
 const s=fixture(),bad='<img src=x onerror="alert(1)"> & "teste"';s.patients[0].name=bad;s.patients[0].notes=bad;s.patients[0].address=bad;s.patients[0].phone=bad;s.patients[0].email=bad;s.visits[0].service=bad;s.clinic.professionals[0].name=bad;s.appointments[1].service=bad;const d=render(t,s);
 assert.equal(d.querySelectorAll('img,script,[onerror]').length,0);assert.equal(d.querySelector('h1').textContent,bad);assert.ok(text(d.querySelector('.pr-info')).includes(bad));assert.equal(d.querySelector('[data-visit-id="open"] h3').textContent,bad);
});
test('IDs maliciosos não injetam atributos; IDs legados com dois pontos mantêm a rota',t=>{
 const s=fixture();s.patients[0].id='p:legacy';s.visits=s.visits.filter(v=>v.patientId==='p').map(v=>({...v,patientId:'p:legacy'}));s.visits[0].id='v:legacy';const d=render(t,s,{patientId:'p:legacy'});assert.equal(d.querySelector('[data-visit-id="v:legacy"] a').getAttribute('href'),'#paciente/p:legacy/v:legacy/registro');
 s.patients[0].id='p" onclick="evil()';const bad=render(t,s,{patientId:s.patients[0].id});assert.equal(bad.querySelectorAll('[onclick]').length,0);assert.equal(bad.querySelector('[data-action="edit-patient"]').dataset.id,s.patients[0].id);
});
test('cobrança exibida é valor de cobrança, orçamento compartilhado fica explicitamente identificado',t=>{
 const s=fixture();let d=render(t,s);const value=text(d.querySelector('[data-visit-id="done"] .pr-visit-value'));assert.match(value,/Valor da cobrança.*500,00/);assert.ok(!value.includes('recebido'));
 s.bills[0].quoteId='quote';d=render(t,s);assert.match(text(d.querySelector('[data-visit-id="done"] .pr-visit-value')),/Total do orçamento vinculado/);
 s.bills[0].cancelledAt='2026-10-15T17:00:00Z';d=render(t,s);assert.equal(d.querySelector('[data-visit-id="done"] .pr-visit-value'),null);
});
test('zero campos opcionais e nenhum atendimento geram vazios honestos e acessos existentes',t=>{
 const state={patients:[{id:'p',name:'Paciente mínima'}]},d=render(t,state);assert.deepEqual([...d.querySelectorAll('.pr-stat strong')].map(e=>e.textContent),['0','0']);assert.match(text(d.body),/Nenhum atendimento registrado/);assert.match(text(d.body),/Data de atualização não registrada/);assert.match(text(d.body),/Nenhum retorno previsto/);assert.ok(d.querySelector('.pr-anamnesis a[href="#originais"]'));assert.ok(d.querySelector('[data-action="new-visit"]'));
 const local=render(t,state,{connected:false});assert.ok(local.querySelector('.pr-anamnesis a[href="#documentos"]'));assert.ok(!text(local.querySelector('.pr-anamnesis')).includes('Consulte o recebimento'));
});
test('paciente inexistente não expõe dados de outra paciente e permite voltar',t=>{
 const d=render(t,fixture(),{patientId:'missing'});assert.match(text(d.body),/Paciente não encontrada/);assert.ok(d.querySelector('a[href="#pacientes"]'));assert.equal(d.querySelector('.pr-profile'),null);assert.ok(!text(d.body).includes('Marina'));
});
