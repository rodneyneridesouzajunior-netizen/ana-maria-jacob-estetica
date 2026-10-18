import test from 'node:test';
import assert from 'node:assert/strict';
import {RECYCLE_TYPES,recycleRecords,recycleScope,moveToRecycleBin,restoreRecycleEntry,activeWorkspace,mergeActiveWorkspace,validateRecycleTransition} from '../recycle-bin.mjs';
import {recycleRecordBelongs} from '../recycle-ui.mjs';
const now='2026-10-18T15:00:00.000Z';
function fixture(){return {schema:1,revision:0,patients:[{id:'p',name:'Paciente isolada'},{id:'other',name:'Outra paciente'}],visits:[{id:'v',patientId:'p',photos:[{id:'photo',label:'Foto'}],maps:{photo:{version:0,history:[],points:[{id:'point',label:'Ponto'}]}},addenda:[{id:'addendum',text:'Adendo'}]}],appointments:[{id:'a',patientId:'p',date:'2026-10-19',time:'09:00',duration:30,status:'agendado'}],bills:[{id:'bill',patientId:'p',description:'Cobrança'}],payments:[{id:'pay',billId:'bill',amount:5000}],paymentReversals:[{id:'rev',paymentId:'pay'}],expenses:[{id:'expense',description:'Despesa'}],expensePayments:[{id:'out',expenseId:'expense'}],expensePaymentReversals:[{id:'out-rev',paymentId:'out',expenseId:'expense'}],quoteProductDeliveryReversals:[{id:'delivery-rev',deliveryId:'delivery',quoteId:'quote'}],quotes:[{id:'quote',patientId:'p',title:'Orçamento'}],quoteProductDeliveries:[{id:'delivery',quoteId:'quote'}],products:[{id:'product',name:'Produto'}],procedures:[{id:'procedure',name:'Procedimento'}],stockLots:[{id:'lot',productId:'product'}],stockMovements:[{id:'movement',lotId:'lot',productId:'product',visitId:'v'}],documentTemplates:[{id:'template',title:'Modelo'}],documentResponses:[{id:'doc',templateId:'template',patientId:'p',visitId:'v'}],comparisons:[{id:'comparison',patientId:'p',before:JSON.stringify(['v','photo']),beforePhotos:[{visitId:'v',photoId:'photo'}]}],expectedReturns:[{id:'return',patientId:'p',visitId:'v'}],facialStudies:[{id:'study',patientId:'p',visitId:'v'}],installments:[{id:'part',billId:'bill'}],clinic:{professionals:[{id:'professional',name:'Profissional'}],blocks:[{id:'block',reason:'Bloqueio'}],holidays:[{id:'holiday',reason:'Fechamento'}],goals:[{month:'2026-10',billed:100}]},auditLog:[]};}
for(const type of Object.keys(RECYCLE_TYPES))test(type+': exclusion, reload and recovery keep original data byte-for-byte',()=>{
 const original=fixture(),next=structuredClone(original),row=recycleRecords(next,type)[0];assert.ok(row,'Creatable entity has a selector');
 moveToRecycleBin(next,{type,id:row.id,parentId:row.parentId,photoId:row.photoId},{operationId:'delete-'+type,now});assert.doesNotThrow(()=>validateRecycleTransition(original,next));
 const persisted=JSON.parse(JSON.stringify(next));assert.equal(recycleRecords(activeWorkspace(persisted),type).some(x=>x.id===row.id),false);
 const restored=activeWorkspace(persisted);restoreRecycleEntry(restored,'delete-'+type,{now});mergeActiveWorkspace(persisted,restored);assert.doesNotThrow(()=>validateRecycleTransition(next,persisted));
 const {recycleBin,...recovered}=persisted;assert.deepEqual(recovered,original);assert.ok(recycleRecords(activeWorkspace(persisted),type).some(x=>x.id===row.id));
});
test('patient ownership closure hides drafts, agenda, finance, forms and comparisons; other patient and consumed inventory remain',()=>{
 const s=fixture();moveToRecycleBin(s,{type:'patients',id:'p'},{operationId:'delete-p',now});const active=activeWorkspace(s);
 for(const type of ['visits','appointments','bills','payments','paymentReversals','quotes','documentResponses','comparisons','expectedReturns','facialStudies','installments'])assert.equal(active[type].length,0,type);
 assert.equal(active.patients[0].id,'other');assert.equal(active.stockMovements.length,1);assert.equal(s.visits[0].photos.length,1);
});
test('child deleted separately stays hidden after the patient is recovered',()=>{
 const s=fixture();moveToRecycleBin(s,{type:'photos',id:'photo',parentId:'v'},{operationId:'photo-event',now});moveToRecycleBin(s,{type:'patients',id:'p'},{operationId:'patient-event',now});
 restoreRecycleEntry(s,'patient-event',{now});assert.equal(activeWorkspace(s).visits[0].photos.length,0);restoreRecycleEntry(s,'photo-event',{now});assert.equal(activeWorkspace(s).visits[0].photos.length,1);
});
test('active edit after exclusion cannot erase hidden originals, or mutate a hidden record',()=>{
 const s=fixture();moveToRecycleBin(s,{type:'patients',id:'p'},{operationId:'delete-p',now});const before=structuredClone(s),edited=activeWorkspace(s);edited.patients[0].name='Outro cadastro corrigido';mergeActiveWorkspace(s,edited);
 assert.equal(s.patients.find(p=>p.id==='p').name,'Paciente isolada');assert.doesNotThrow(()=>validateRecycleTransition(before,s));s.patients.find(p=>p.id==='p').name='Ataque';assert.throws(()=>validateRecycleTransition(before,s),/Recupere/);
});
test('forged targets, lost history and combined deletion/edit are rejected',()=>{
 const old=fixture(),next=structuredClone(old);moveToRecycleBin(next,{type:'patients',id:'p'},{operationId:'delete-p',now});
 const forged=structuredClone(next);forged.recycleBin[0].targets=[];assert.throws(()=>validateRecycleTransition(old,forged));
 const combined=structuredClone(next);combined.patients[1].name='Alteração oculta';assert.throws(()=>validateRecycleTransition(old,combined),/preservar/);
 const lost=structuredClone(next);lost.recycleBin=[];assert.throws(()=>validateRecycleTransition(next,lost),/preservados/);
});
test('restoring an appointment into a newly occupied slot is blocked without data loss',()=>{
 const s=fixture();moveToRecycleBin(s,{type:'appointments',id:'a'},{operationId:'delete-a',now});s.appointments.push({...s.appointments[0],id:'another',patientId:'other'});const next=structuredClone(s);restoreRecycleEntry(next,'delete-a',{now});assert.throws(()=>validateRecycleTransition(s,next),/horário foi ocupado/);assert.equal(s.recycleBin[0].restoredAt,null);
});
test('patient manager never includes photographs, markings or addenda of another patient',()=>{const s=fixture();s.visits.push({id:'foreign',patientId:'other',photos:[{id:'foreign-photo'}],maps:{'foreign-photo':{points:[{id:'foreign-point'}]}},addenda:[{id:'foreign-note'}]});for(const visitId of [undefined,'comparacoes','v'])for(const type of ['photos','points','addenda']){const rows=recycleRecords(s,type).filter(row=>recycleRecordBelongs(s,row,{patientId:'p',visitId}));assert.ok(rows.length);assert.ok(rows.every(row=>row.parentId==='v'));}});
test('projecting and merging legacy visits never adds empty fields during deletion',()=>{const old=fixture();delete old.visits[0].addenda;const edited=activeWorkspace(old);moveToRecycleBin(edited,{type:'patients',id:'other'},{operationId:'delete-other',now});const next=structuredClone(old);mergeActiveWorkspace(next,edited);assert.doesNotThrow(()=>validateRecycleTransition(old,next));assert.equal(Object.hasOwn(next.visits[0],'addenda'),false);});
test('restoring a patient cannot introduce a duplicate active CPF',()=>{const old=fixture();old.patients[0].cpf='52998224725';moveToRecycleBin(old,{type:'patients',id:'p'},{operationId:'delete-cpf',now});old.patients[1].cpf='52998224725';const next=structuredClone(old);restoreRecycleEntry(next,'delete-cpf',{now});assert.throws(()=>validateRecycleTransition(old,next),/cadastro ativo com este CPF/);});

test('an identifier or monthly goal in the trash cannot be recreated as an invisible duplicate',()=>{for(const type of ['documentTemplates','goals']){const s=fixture(),r=recycleRecords(s,type)[0];moveToRecycleBin(s,{type,id:r.id},{operationId:'delete-'+type,now});const view=activeWorkspace(s);if(type==='goals')view.clinic.goals.push(structuredClone(r.record));else view[type].push(structuredClone(r.record));assert.throws(()=>mergeActiveWorkspace(s,view),/já existe na lixeira/);}});
