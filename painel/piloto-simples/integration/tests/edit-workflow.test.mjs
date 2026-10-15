import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPrivateEdit,confirmPrivateEdit,localAppointmentTime,APPOINTMENT_TRANSITIONS} from '../edit-workflow.mjs';
import {renderPrivateEdit} from '../edit-workflow-ui.mjs';
const id=n=>`${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const patient={id:id(1),versao:3,nome:'Teste',cpf:'00000000000',telefone:'31999999999',email:'fixture@example.invalid',telefone_emergencia:'31888888888',data_nascimento:'1990-01-01',status:'inactive',arquivado_em:null};
const appointment={id:id(2),versao:2,nome:'Teste',telefone:'31999999999',email:null,data_hora:'2026-10-20T15:00:00Z',duracao_min:45,status:'confirmado',categoria:'avaliacao',procedimento:'Avaliação',observacoes:'Anotação',lembretes_autorizados:true,retorno_de_id:id(8),retorno_em:'2026-11-01'};
const record={id:id(3),version:7,status:'draft',patient_id:id(1),appointment_id:id(2),anamnesis:{allergy:{confirmed:true,notes:'Preservar'},future_key:{nested:[1,2]}},draft_products:[{lot:'L1',amount:1}],consentimentos_atuais:{clinical_photography:true}};
const recordValues={tipo_procedimento:'Avaliação',queixa:'Queixa manual',notas_tecnica:'Técnica manual',data_procedimento:'2026-10-15',data_retorno:'2026-11-01',orientacoes:'Orientações manuais'};
const appointmentValues={nome:'Teste alterado',telefone:appointment.telefone,email:'',categoria:'avaliacao',procedimento:'Avaliação',data_hora:'2026-10-20T12:00',duracao_min:'45',observacoes:'Texto'};
test('editing patient requires complete detail and preserves omitted CPF/emergency/status data',()=>{
 const payload=buildPrivateEdit('edit-patient',patient,{nome:'Nome alterado',motivo:'Correção cadastral'},id(9));assert.equal(payload.cpf,patient.cpf);assert.equal(payload.telefone_emergencia,patient.telefone_emergencia);assert.equal(payload.status,'inactive');assert.equal(payload.versao,3);
 const listOnly={...patient};delete listOnly.cpf;assert.throws(()=>buildPrivateEdit('edit-patient',listOnly,{nome:'Teste',motivo:'Correção'},id(9)),{code:'full_patient_required'});
});
test('IDs and versions are captured from server row, never overridden by editable input',()=>{
 const payload=buildPrivateEdit('edit-patient',patient,{nome:'Teste',motivo:'Correção',id:id(8),versao:999,operation_id:id(7)},id(9));assert.equal(payload.id,patient.id);assert.equal(payload.versao,3);assert.equal(payload.operation_id,id(9));
});
test('appointment time renders Brasília and unchanged edit preserves unexposed consent/return fields',()=>{
 assert.equal(localAppointmentTime(appointment.data_hora),'2026-10-20T12:00');const payload=buildPrivateEdit('edit-appointment',appointment,appointmentValues,id(9));assert.equal(Date.parse(payload.data_hora),Date.parse(appointment.data_hora));
 for(const field of ['lembretes_autorizados','lembrete_24h','retorno_de_id','retorno_em','origem','status','reagendar'])assert.equal(Object.hasOwn(payload,field),false);
});
test('changing appointment start needs explicit reschedule and rejects closed appointments',()=>{
 const values={...appointmentValues,data_hora:'2026-10-20T13:00'};assert.throws(()=>buildPrivateEdit('edit-appointment',appointment,values,id(9)),{code:'reschedule_confirmation_required'});
 assert.equal(buildPrivateEdit('edit-appointment',appointment,{...values,reagendar:'on'},id(9)).reagendar,true);
 assert.throws(()=>buildPrivateEdit('edit-appointment',{...appointment,status:'concluido'},{...values,reagendar:'on'},id(9)),{code:'reschedule_not_allowed'});
});
test('status workflow refuses terminal reopen and requires cancellation reason',()=>{
 assert.deepEqual(APPOINTMENT_TRANSITIONS.concluido,[]);assert.throws(()=>buildPrivateEdit('appointment-status',{...appointment,status:'concluido'},{status:'confirmado'},id(9)),{code:'invalid_status_transition'});
 assert.throws(()=>buildPrivateEdit('appointment-status',appointment,{status:'cancelado',motivo_cancelamento:''},id(9)));
 assert.deepEqual(buildPrivateEdit('appointment-status',appointment,{status:'cancelado',motivo_cancelamento:'Pedido da paciente'},id(9)),{id:appointment.id,versao:2,status:'cancelado',motivo_cancelamento:'Pedido da paciente'});
});
test('record edit preserves unknown anamnesis data and patient/appointment binding without replacing products or consents',()=>{
 const source=structuredClone(record),payload=buildPrivateEdit('edit-record',source,{...recordValues,paciente_id:id(8),produtos:[],consentimentos:{clinical_photography:false}},id(9));
 assert.deepEqual(payload.anamnese,record.anamnesis);assert.equal(payload.paciente_id,record.patient_id);assert.equal(payload.agendamento_id,record.appointment_id);assert.equal(payload.versao_esperada,7);
 assert.equal(Object.hasOwn(payload,'produtos'),false);assert.equal(Object.hasOwn(payload,'consentimentos'),false);source.anamnesis.future_key.nested.push(3);assert.deepEqual(payload.anamnese.future_key.nested,[1,2]);
});
test('record finalize needs explicit review and cannot manufacture missing consent or signature',()=>{
 assert.throws(()=>buildPrivateEdit('finalize-record',record,{},id(9)),{code:'confirmation_required'});
 const payload=buildPrivateEdit('finalize-record',record,{confirmar:'on'},id(9));assert.deepEqual(payload,{protocolo_id:record.id,versao_esperada:7,operation_id:id(9)});
 assert.throws(()=>buildPrivateEdit('finalize-record',{...record,status:'signed'},{confirmar:'on'},id(9)),{code:'record_locked'});
});
test('successful response must confirm same identity and later version',()=>{
 assert.throws(()=>confirmPrivateEdit('edit-patient',patient,{cliente:{id:id(8),versao:4}}),error=>error.code==='edit_unconfirmed'&&error.uncertain);
 assert.throws(()=>confirmPrivateEdit('edit-appointment',appointment,{agendamento:{id:appointment.id,versao:2}}),{code:'edit_unconfirmed'});
 assert.throws(()=>confirmPrivateEdit('finalize-record',record,{protocolo_id:record.id,versao:8,status:'draft',finalizado:false}),{code:'edit_unconfirmed'});
 assert.equal(confirmPrivateEdit('finalize-record',record,{protocolo_id:record.id,versao:8,status:'signed',finalizado:true}).finalizado,true);
});
test('edit rendering escapes record content and never marks consent/finalization checked',()=>{
 const html=renderPrivateEdit('edit-record',{...record,paciente:{nome:'<script>x</script>'},complaint:'<img src=x onerror=alert(1)>'},id(9));assert.doesNotMatch(html,/<script>|<img/);assert.match(html,/&lt;script&gt;/);
 const finish=renderPrivateEdit('finalize-record',record,id(9));assert.doesNotMatch(finish,/checked/);assert.match(finish,/name="confirmar" required/);
});
