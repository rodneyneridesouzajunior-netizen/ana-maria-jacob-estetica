import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {renderVisitRecord,renderVisitMarkings,visitRecordFinancials,mountVisitRecord} from '../visit-record-ui.mjs';
const require=createRequire(new URL('../../../../../skinpro-analise/test-tools/package.json',import.meta.url));
const {JSDOM}=require('jsdom');
const options={patientId:'patient',visitId:'visit',connected:true};
function fixture(){
 const procedure={id:'proc',name:'Procedimento preservado',category:'Categoria registrada',price:10000,cost:2000,version:1};
 return{patients:[{id:'patient',name:'Paciente sintética'}],clinic:{professionals:[{id:'professional',name:'Profissional cadastrada'}]},procedures:[{...procedure,price:999900,name:'Catálogo alterado'}],appointments:[{id:'appointment',patientId:'patient',time:'14:30',professionalId:'professional'}],visits:[{id:'visit',patientId:'patient',professionalId:'professional',appointmentId:'appointment',date:'2026-10-15',service:'Atendimento',status:'rascunho',procedureSnapshot:procedure,notes:'Evolução salva\nSegunda linha',photos:[{id:'front',label:'Frontal',width:1000,height:1250,phase:'antes'},{id:'side',label:'Perfil',width:1000,height:1250,phase:'depois'}],maps:{front:{points:[{id:'p1',kind:'ponto',x:.3,y:.4,region:'Região 1',product:'Produto registrado',quantity:2,unit:'U'},{id:'p2',kind:'linha',x:.6,y:.4,x2:.7,y2:.5,region:'Região 2',quantity:.2,unit:'mL'}]},side:{points:[{id:'p3',kind:'leque',x:.3,y:.5,x2:.4,y2:.6,region:'Região 3',quantity:3,unit:'U'}]}},consumptions:[]}],bills:[],payments:[]};
}
function document(html){return new JSDOM('<!doctype html><body>'+html).window.document;}
const render=s=>renderVisitRecord(s,options);
test('summary is read-only and preserves every source field and array',()=>{
 const s=fixture(),before=structuredClone(s);Object.freeze(s.visits[0].procedureSnapshot);const html=render(s);assert.deepEqual(s,before);assert.match(html,/ATENDIMENTO/);assert.match(html,/15 de outubro de 2026/);assert.match(html,/14:30/);assert.match(html,/Profissional cadastrada/);assert.match(html,/Procedimento preservado/);assert.doesNotMatch(html,/Catálogo alterado/);assert.doesNotMatch(html,/<form|<textarea|<input/);
});
test('summary links preserve every existing edit destination and printing is a real host action',()=>{
 const doc=document(render(fixture())),links=[...doc.querySelectorAll('a')].map(a=>a.getAttribute('href'));
 for(const path of ['#paciente/patient','#paciente/patient/visit/registro','#paciente/patient/visit/mapa','#paciente/patient/visit/fotos','#paciente/patient/visit/documentos','#financeiro'])assert.ok(links.includes(path),path);
 assert.equal(doc.querySelector('[data-action="print-visit"]').textContent,'Imprimir / salvar PDF');assert.equal(doc.querySelector('[data-action="print-visit"]').type,'button');assert.match(doc.body.textContent,/Continuar atendimento/);assert.doesNotMatch(doc.body.textContent,/Exportar PDF/);
});
test('concluded or cancelled visits have no misleading continue action; historical notes and procedure remain authoritative',()=>{
 for(const status of ['concluido','cancelado']){const s=fixture();s.visits[0].status=status;s.visits[0].completionSnapshot={notes:'Evolução histórica',procedure:{name:'Versão concluída',price:8000,category:'Histórica'},consumptions:[]};s.visits[0].notes='Notas posteriores';s.visits[0].addenda=[{text:'Adendo separado',createdAt:'2026-10-15T18:00:00Z'}];const doc=document(render(s));assert.doesNotMatch(doc.body.textContent,/Continuar atendimento|Notas posteriores/);assert.match(doc.body.textContent,/Ver registro completo|Evolução histórica|Adendo separado|Versão concluída/);}
});
test('each photo owns its numbered legend and totals do not combine different photos or units',()=>{
 const doc=document(render(fixture())),first=doc.querySelector('[data-vr-legend-panel="0"]'),second=doc.querySelector('[data-vr-legend-panel="1"]');
 assert.equal(first.hidden,false);assert.equal(second.hidden,true);assert.match(first.querySelector('.vr-totals').textContent,/2 U · 0,2 mL/);assert.equal(second.querySelector('.vr-totals').textContent,'Total registrado nesta foto3 U');assert.match(doc.body.textContent,/A mesma aplicação pode aparecer em vistas diferentes/);assert.equal(doc.querySelectorAll('img[data-photo-src]').length,2);assert.equal(doc.querySelector('img').hasAttribute('src'),false);assert.equal(doc.querySelectorAll('.vr-map-number').length,3);
});
test('normalized points, lines and fans render without inferred positions, malicious coordinates or deformation',()=>{
 const html=renderVisitMarkings([{kind:'ponto',x:.25,y:.75},{kind:'linha',x:0,y:0,x2:1,y2:1},{kind:'leque',x:.5,y:.5,x2:.75,y2:.5},{kind:'linha',x:0,y:0,x2:'1" onload="bad()',y2:1},{kind:'ponto',x:Infinity,y:0}]);
 const doc=document(html);assert.equal(doc.querySelectorAll('.vr-map-number').length,3);assert.equal(doc.querySelectorAll('line').length,1);assert.equal(doc.querySelectorAll('path').length,1);assert.equal(doc.querySelector('line').getAttribute('x2'),'1000');assert.equal(doc.querySelector('.vr-map-number').getAttribute('style'),'left:25%;top:75%');assert.equal(doc.querySelector('svg').getAttribute('preserveAspectRatio'),'none');assert.doesNotMatch(html,/onload|Infinity|NaN/);
});
test('all content and attributes are escaped, sources are not embedded and patient/visit ownership is checked',()=>{
 const s=fixture(),attack='<img src=x onerror="alert(1)">';s.patients[0].name=attack;s.visits[0].notes=attack;s.visits[0].photos[0].id='photo" onload="bad';s.visits[0].photos[0].src='javascript:bad()';s.visits[0].photos[0].label=attack;s.visits[0].maps={};s.visits[0].procedureSnapshot.name=attack;
 const doc=document(render(s));assert.equal(doc.querySelectorAll('[onerror],[onload],script').length,0);assert.equal(doc.querySelectorAll('img').length,2);assert.equal(doc.querySelector('img').dataset.photoSrc,'photo" onload="bad');assert.doesNotMatch(render(s),/javascript:/);assert.ok(doc.body.textContent.includes(attack));assert.match(renderVisitRecord(s,{patientId:'other',visitId:'visit'}),/não encontrado/);
});
test('real billed values, active receipts and recorded costs are shown without inventing net profit',()=>{
 const s=fixture(),v=s.visits[0];Object.assign(v,{billId:'bill',actualCost:3000,status:'concluido'});s.bills=[{id:'bill',patientId:'patient',visitId:'visit',total:10000,cost:9999}];s.payments=[{billId:'bill',amount:4000},{billId:'bill',amount:1000,reversedAt:'2026-10-15'}];
 assert.deepEqual(visitRecordFinancials(s,v),{quoteLinked:false,cancelled:false,ambiguous:false,billed:10000,received:4000,outstanding:6000,cost:3000,revenue:10000,result:7000,margin:70});const text=document(render(s)).body.textContent;assert.match(text,/RecebidoR\$\s40,00/);assert.match(text,/Resultado de contribuiçãoR\$\s70,00/);assert.match(text,/não representa lucro líquido/);
});
test('quote totals and receipts are explicitly shared and never become individual visit revenue or margin',()=>{
 const s=fixture(),v=s.visits[0];Object.assign(v,{billId:'bill',quoteId:'q',actualCost:3000});s.bills=[{id:'bill',patientId:'patient',quoteId:'q',total:50000}];s.payments=[{billId:'bill',amount:15000}];const f=visitRecordFinancials(s,v);assert.equal(f.revenue,null);assert.equal(f.result,null);assert.equal(f.margin,null);assert.equal(f.received,15000);assert.equal(f.cost,3000);const text=document(render(s)).body.textContent;assert.match(text,/Recebido no orçamento/);assert.match(text,/não foram rateados/);assert.match(text,/Resultado de contribuiçãoNão informado/);
});
test('completed product snapshots remain stable after catalog and stock edits; materials are not invented from points',()=>{
 const s=fixture();s.visits[0].status='concluido';s.visits[0].consumptions=[{productName:'Produto atual errado',quantity:99}];s.visits[0].completionSnapshot={consumptions:[{productName:'Produto histórico',quantity:.1,unit:'mL',lotCode:'LOT-01',expiry:'2027-10-15',region:'Registro da aplicação'}],actualCost:0};const doc=document(render(s)),text=doc.querySelector('.vr-products').textContent;assert.match(text,/Produto histórico|0,1 mL|LOT-01|15\/10\/2027/);assert.doesNotMatch(text,/Produto atual errado|Produto registrado/);assert.equal(visitRecordFinancials(s,s.visits[0]).cost,0);
});
test('unknown and zero values stay distinct, cancelled charges do not claim revenue, invalid dates do not normalize silently',()=>{
 const s=fixture(),v=s.visits[0];v.date='2026-02-30';v.photos=[];v.maps={};delete v.procedureSnapshot;delete v.professionalId;s.appointments=[];const html=render(s);assert.match(html,/Data não informada|Profissional não informada|Nenhuma fotografia registrada|Não informado/);assert.doesNotMatch(html,/undefined|NaN|R\$\s0,00/);Object.assign(v,{billId:'bill',actualCost:0});s.bills=[{id:'bill',patientId:'patient',visitId:'visit',total:0,costKind:'realizado',cost:0}];assert.equal(visitRecordFinancials(s,v).result,0);assert.equal(visitRecordFinancials(s,v).margin,null);s.bills[0].cancelledAt='2026-10-15';assert.equal(visitRecordFinancials(s,v).billed,null);
});
test('photo selection updates only the visible photo, legend and counter; cleanup removes listener',()=>{
 const s=fixture(),before=structuredClone(s),doc=document(render(s)),selected=[],dispose=mountVisitRecord(doc.body,{onPhotoSelect:id=>selected.push(id)}),select=doc.querySelector('[data-vr-photo-select]');assert.deepEqual(selected,['front']);select.value='1';select.dispatchEvent(new doc.defaultView.Event('change',{bubbles:true}));assert.deepEqual(selected,['front','side']);assert.equal(doc.querySelector('[data-vr-photo-panel="0"]').hidden,true);assert.equal(doc.querySelector('[data-vr-photo-panel="1"]').hidden,false);assert.equal(doc.querySelector('[data-vr-legend-panel="1"]').hidden,false);assert.equal(doc.querySelector('[data-vr-photo-count]').textContent,'2 de 2');assert.deepEqual(s,before);dispose();select.value='0';select.dispatchEvent(new doc.defaultView.Event('change'));assert.equal(doc.querySelector('[data-vr-photo-panel="1"]').hidden,false);assert.deepEqual(selected,['front','side']);
});
test('caller selected photo is respected and missing selection falls back to first real photo',()=>{
 for(const [id,index]of [['side',1],['missing',0]]){const doc=document(renderVisitRecord(fixture(),{...options,photoId:id}));assert.equal(doc.querySelector('[data-vr-photo-select]').value,String(index));assert.equal(doc.querySelector(`[data-vr-photo-panel="${index}"]`).hidden,false);}
});
test('legacy identifiers retain router-compatible colons and a locked draft is never labelled concluded',()=>{
 const s=fixture();s.patients[0].id='legacy:patient';Object.assign(s.visits[0],{id:'legacy:visit',patientId:'legacy:patient',lockedAt:'2026-10-15T12:00:00Z'});const doc=document(renderVisitRecord(s,{...options,patientId:'legacy:patient',visitId:'legacy:visit'}));assert.equal(doc.querySelector('.vr-back').getAttribute('href'),'#paciente/legacy:patient');assert.ok(doc.querySelector('a[href="#paciente/legacy:patient/legacy:visit/registro"]'));assert.match(doc.querySelector('.vr-status').textContent,/Registro bloqueado/);assert.doesNotMatch(doc.body.textContent,/Continuar atendimento|Concluído/);
});
test('multiple linked bills and an unrelated bill never invent a financial total for the visit',()=>{
 const s=fixture(),v=s.visits[0];v.billId='first';s.bills=[{id:'first',patientId:'patient',visitId:'visit',total:10000},{id:'second',patientId:'patient',visitId:'visit',total:20000}];let f=visitRecordFinancials(s,v);assert.equal(f.ambiguous,true);assert.equal(f.revenue,null);assert.equal(f.received,null);assert.match(render(s),/mais de uma cobrança vinculada/);s.bills=[{id:'first',patientId:'patient',visitId:'unrelated',total:10000}];f=visitRecordFinancials(s,v);assert.equal(f.billed,null);assert.equal(f.revenue,null);
});
