// Read-only presentation. Rendering and photo selection never change the workspace.
import {annotationCheck,fanRays} from './domain.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rows=value=>Array.isArray(value)?value:[];
const informed=value=>typeof value==='string'&&value.trim()?value:'Não informado';
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const currency=value=>integer(value)?(value/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}):'Não informado';
const signedCurrency=value=>Number.isSafeInteger(value)?(value/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}):'Não informado';
const number=value=>Number.isFinite(value)?value.toLocaleString('pt-BR',{maximumFractionDigits:4}):'Não informado';
const amount=(value,unit)=>Number.isFinite(value)&&value>=0?`${number(value)}${unit?' '+esc(unit):''}`:'Não informada';
// ':' is an allowed legacy ID character; the existing router reads literal segments.
const route=(patientId,visitId,tab)=>'#paciente/'+[patientId,visitId,tab].filter(x=>x!==undefined).map(x=>encodeURIComponent(String(x)).replace(/%3A/g,':')).join('/');
const actionLink=(href,label,primary=false)=>`<a class="vr-button${primary?' vr-button-primary':''}" href="${esc(href)}">${esc(label)}</a>`;
const icon=name=>({photo:'<rect x="3" y="5" width="18" height="15" rx="3"/><circle cx="9" cy="10" r="1.5"/><path d="m4 18 5-5 4 4 3-3 5 5"/>',points:'<circle cx="6" cy="7" r="2"/><circle cx="18" cy="9" r="2"/><circle cx="11" cy="18" r="2"/><path d="m8 7 8 2m-9 0 3 7m7-5-5 5"/>',procedure:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>',product:'<path d="M8 7h8l2 4v9H6v-9Zm1-4h6v4H9Z"/>',notes:'<rect x="5" y="3" width="14" height="18" rx="3"/><path d="M9 8h6M9 12h6M9 16h4"/>',finance:'<rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 9h18m-5 5h2"/>'}[name]||'');
const sectionHeading=(name,title,extra='')=>`<header class="vr-card-heading"><h2><span class="vr-section-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">${icon(name)}</svg></span>${esc(title)}</h2>${extra}</header>`;
function parsedDay(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;const date=new Date(value+'T12:00:00Z');return Number.isFinite(+date)&&date.toISOString().slice(0,10)===value?date:null;}
const day=value=>parsedDay(value)?.toLocaleDateString('pt-BR',{timeZone:'UTC'})||'Não informada';
const longDay=value=>parsedDay(value)?.toLocaleDateString('pt-BR',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'})||'Data não informada';
const instant=value=>{const date=typeof value==='string'?new Date(value):null;return date&&Number.isFinite(+date)?date.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}):'Data não informada';};
function visitStatus(visit){
 if(visit.cancelledAt||visit.status==='cancelado')return{label:'Cancelado',tone:'cancelled',editable:false};
 if(visit.status==='concluido')return{label:'Concluído',tone:'complete',editable:false};
 if(visit.completedAt||visit.lockedAt)return{label:'Registro bloqueado',tone:'unknown',editable:false};
 if(['rascunho','aberto','em_atendimento'].includes(visit.status))return{label:'Em atendimento',tone:'open',editable:true};
 return{label:'Situação não informada',tone:'unknown',editable:false};
}
const coordinate=value=>Number.isFinite(value)&&value>=0&&value<=1;
const geometry=(point,aspectRatio=1)=>{
 if(point?.kind==='traco'){try{annotationCheck(point);return true;}catch{return false;}}
 if(point?.kind==='leque'){try{fanRays(point,aspectRatio);return true;}catch{return false;}}
 return point&&['ponto','linha','leque'].includes(point.kind)&&coordinate(point.x)&&coordinate(point.y)&&(point.kind==='ponto'||coordinate(point.x2)&&coordinate(point.y2));
};

/** The editor uses normalized photo coordinates. This read-only overlay preserves
 * that same geometry, including line/fan endpoints and freehand vertices; it does not infer anatomy. */
export function renderVisitMarkings(points,aspectRatio=1){
 const entries=rows(points).map((point,index)=>({point,index})).filter(({point})=>geometry(point,aspectRatio));
 const shapes=entries.map(({point:p})=>{
  if(p.kind==='ponto')return'';
  if(p.kind==='traco')return`<polyline points="${p.vertices.map(vertex=>`${vertex.x*1000},${vertex.y*1000}`).join(' ')}" fill="none" vector-effect="non-scaling-stroke"/>`;
  if(p.kind==='linha')return`<line x1="${p.x*1000}" y1="${p.y*1000}" x2="${p.x2*1000}" y2="${p.y2*1000}" vector-effect="non-scaling-stroke"/>`;
  return fanRays(p,aspectRatio).map(ray=>`<line class="vr-fan-ray" x1="${ray.x1*1000}" y1="${ray.y1*1000}" x2="${ray.x2*1000}" y2="${ray.y2*1000}" fill="none" vector-effect="non-scaling-stroke"/>`).join('');
 }).join('');
 return`<svg class="vr-map-shapes" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">${shapes}</svg><div class="vr-map-numbers" aria-hidden="true">${entries.map(({point,index})=>`<span class="vr-map-number" style="left:${point.x*100}%;top:${point.y*100}%">${index+1}</span>`).join('')}</div>`;
}

/** No total from a shared quote is attributed to an individual visit. Payment
 * amounts remain explicitly scoped to their bill; costs use recorded snapshots. */
export function visitRecordFinancials(state,visit){
 const direct=rows(state.bills).filter(b=>b.visitId===visit.id&&b.patientId===visit.patientId&&!b.cancelledAt);
 const linked=rows(state.bills).find(b=>b.id===visit.billId&&b.patientId===visit.patientId&&(b.visitId===visit.id||visit.quoteId&&b.quoteId===visit.quoteId));
 const ambiguous=direct.length>1||Boolean(linked&&direct.some(b=>b.id!==linked.id));
 const bill=ambiguous?null:linked||direct[0];
 const quoteLinked=Boolean(visit.quoteId||bill?.quoteId),cancelled=Boolean(bill?.cancelledAt);
 const billed=!cancelled&&integer(bill?.total)?bill.total:null;
 const payments=bill?rows(state.payments).filter(p=>p.billId===bill.id&&!p.reversedAt):[];
 const received=billed!==null&&payments.every(p=>integer(p.amount))?payments.reduce((sum,p)=>sum+p.amount,0):null;
 const snapshot=visit.completionSnapshot;
 const cost=integer(snapshot?.actualCost)?snapshot.actualCost:integer(visit.actualCost)?visit.actualCost:!quoteLinked&&bill?.costKind==='realizado'&&integer(bill.actualCost??bill.cost)?bill.actualCost??bill.cost:null;
 const revenue=quoteLinked?null:billed,result=revenue!==null&&cost!==null?revenue-cost:null;
 return{quoteLinked,cancelled,ambiguous,billed,received,outstanding:billed!==null&&received!==null?billed-received:null,cost,revenue,result,margin:revenue>0&&result!==null?result/revenue*100:null};
}
function moneyRow(label,value,{signed=false,emphasis=false}={}){return`<div class="vr-money-row${emphasis?' vr-money-emphasis':''}"><dt>${esc(label)}</dt><dd>${signed?signedCurrency(value):currency(value)}</dd></div>`;}
function financialCard(state,visit){
 const f=visitRecordFinancials(state,visit);
 return`<section class="vr-card">${sectionHeading('finance','Financeiro')}<div class="vr-card-content"><dl class="vr-money-list">${moneyRow(f.quoteLinked?'Cobrança do orçamento':'Receita do atendimento',f.billed)}${moneyRow(f.quoteLinked?'Recebido no orçamento':'Recebido',f.received)}${moneyRow(f.quoteLinked?'Saldo do orçamento':'A receber',f.outstanding,{signed:true})}${moneyRow('Custo registrado do atendimento',f.cost)}${moneyRow('Resultado de contribuição',f.result,{signed:true,emphasis:true})}<div class="vr-money-row"><dt>Margem de contribuição</dt><dd>${f.margin===null?'Não informada':number(f.margin)+'%'}</dd></div></dl>${f.cancelled?'<p class="vr-footnote">A cobrança vinculada foi cancelada.</p>':''}${f.ambiguous?'<p class="vr-footnote">Há mais de uma cobrança vinculada. Confira os vínculos no Financeiro; os valores não foram somados ou escolhidos automaticamente.</p>':''}<p class="vr-footnote">${f.quoteLinked?'O orçamento pode cobrir outros itens ou sessões. Receita e recebimentos não foram rateados para este atendimento.':'A receita representa o valor cobrado. O recebido mostra apenas pagamentos registrados e não estornados.'}</p><p class="vr-footnote">A contribuição desconta os custos registrados. Impostos, taxas e despesas fixas não estão incluídos; este valor não representa lucro líquido.</p><a class="vr-text-link" href="#financeiro">Ver financeiro →</a></div></section>`;
}
function legend(points,photo,procedure){
 const totals=new Map();for(const point of points)if(point.kind!=='traco'&&Number.isFinite(point.quantity)&&point.quantity>0&&['mL','U','mg','g','un','fios'].includes(point.unit))totals.set(point.unit,Math.round(((totals.get(point.unit)||0)+point.quantity)*10000)/10000);
 return`<p class="vr-legend-context">${esc(informed(photo.label))}<span>${esc(informed(procedure?.name))}</span></p>${points.length?`<ol class="vr-point-list">${points.map((point,index)=>`<li><span class="vr-point-number" aria-hidden="true">${index+1}</span><div><strong>${esc(informed(point.region))}</strong><p>${point.kind==='traco'?`<span class="vr-point-kind">Desenho livre</span>${point.product?' · '+esc(point.product):''}`:esc(informed(point.product))}</p>${point.lot?`<small>Lote ${esc(point.lot)}</small>`:''}${point.notes?`<p class="vr-point-note">${esc(point.notes)}</p>`:''}${!geometry(point)?'<small>Posição da marcação não informada.</small>':''}</div><span class="vr-point-amount">${point.kind==='traco'?'Sem quantidade':amount(point.quantity,point.unit==='sem quantidade'?'':point.unit)}</span></li>`).join('')}</ol>`:'<p class="vr-empty">Nenhuma marcação registrada nesta fotografia.</p>'}<div class="vr-totals"><span>Total registrado nesta foto</span><strong>${totals.size?[...totals].map(([unit,total])=>`${number(total)} ${esc(unit)}`).join(' · '):points.length&&points.every(point=>point.kind==='traco')?'Desenhos livres sem quantidade':'Quantidade não informada'}</strong></div>`;
}
function photosAndPoints(visit,procedure,selected,base){
 const photos=rows(visit.photos),selectedIndex=Math.max(0,photos.findIndex(p=>p.id===selected)),mapFor=photo=>rows(visit.maps?.[photo.id]?.points);
 const controls=photos.length?`<div class="vr-photo-control"><label class="vr-sr-only" for="vr-photo-select">Fotografia do atendimento</label><select id="vr-photo-select" data-vr-photo-select>${photos.map((p,index)=>`<option value="${index}"${index===selectedIndex?' selected':''}>${index+1}. ${esc(informed(p.label))}</option>`).join('')}</select><span class="vr-photo-count" data-vr-photo-count aria-live="polite">${selectedIndex+1} de ${photos.length}</span></div>`:'';
 const figures=photos.map((photo,index)=>{const points=mapFor(photo),hasDimensions=Number.isFinite(photo.width)&&Number.isFinite(photo.height)&&photo.width>0&&photo.height>0,ratio=hasDimensions?` style="aspect-ratio:${photo.width} / ${photo.height}"`:'';return`<figure class="vr-photo-panel" data-vr-photo-panel="${index}"${index!==selectedIndex?' hidden':''}><div class="vr-photo-frame"><div class="vr-photo-plane"${ratio}><img data-photo-src="${esc(photo.id)}" alt="${esc(informed(photo.label))} — fotografia clínica do atendimento" decoding="async">${renderVisitMarkings(points,hasDimensions?photo.width/photo.height:1)}</div></div><figcaption><strong>${esc(informed(photo.label))}</strong><span>${photo.phase==='antes'?'Antes':photo.phase==='depois'?'Depois':'Registro clínico'} · ${points.length} ${points.length===1?'marcação':'marcações'}</span></figcaption></figure>`;}).join('');
 return`<section class="vr-card vr-photos">${sectionHeading('photo','Fotos clínicas',controls)}${photos.length?figures:'<div class="vr-empty vr-empty-photo"><span aria-hidden="true">◈</span><strong>Nenhuma fotografia registrada</strong><p>As fotografias deste atendimento aparecerão aqui.</p></div>'}<footer class="vr-card-footer">${actionLink(base+'/fotos','Fotos e comparação')}${actionLink(base+'/mapa','Abrir mapa facial')}</footer></section><section class="vr-card vr-markings">${sectionHeading('points','Pontos de aplicação')}<div class="vr-card-content">${photos.length?photos.map((photo,index)=>`<div data-vr-legend-panel="${index}"${index!==selectedIndex?' hidden':''}>${legend(mapFor(photo),photo,procedure)}</div>`).join(''):'<p class="vr-empty">Nenhuma marcação registrada.</p>'}<p class="vr-footnote">Quantidades informadas em cada fotografia. A mesma aplicação pode aparecer em vistas diferentes; o consumo confirmado está em Produtos utilizados.</p></div></section>`;
}
function procedureCard(visit,procedure,status,financial){
 const quoteLinked=financial.quoteLinked,value=quoteLinked?procedure?.price:financial.revenue??procedure?.price;
 const label=quoteLinked?'Preço de referência preservado':financial.revenue!==null?'Valor cobrado':'Preço previsto';
 return`<section class="vr-card">${sectionHeading('procedure',status.tone==='complete'?'Procedimentos realizados':'Procedimento do atendimento')}<div class="vr-card-content"><div class="vr-procedure"><span class="vr-procedure-symbol" aria-hidden="true">✦</span><div><h3>${esc(informed(procedure?.name||visit.service))}</h3><p>${esc(procedure?.category||'Categoria não informada')}</p></div></div><dl class="vr-money-list">${moneyRow(label,value)}</dl>${!procedure?'<p class="vr-footnote">A versão do procedimento não está informada neste registro.</p>':''}${quoteLinked?'<p class="vr-footnote">O valor cobrado segue o orçamento vinculado.</p>':''}</div></section>`;
}
function productsCard(visit){
 const usage=rows(visit.completionSnapshot?.consumptions??visit.consumptions);
 return`<section class="vr-card">${sectionHeading('product','Produtos utilizados')}<div class="vr-card-content">${usage.length?`<ul class="vr-products">${usage.map(item=>`<li><div><strong>${esc(informed(item.productName))}</strong><span class="vr-product-quantity">${amount(item.quantity,item.unit)}</span></div><p>Lote ${esc(informed(item.lotCode))} · Validade ${day(item.expiry)}</p>${item.region?`<small>${esc(item.region)}</small>`:''}</li>`).join('')}</ul>`:`<p class="vr-empty">${visitStatus(visit).tone==='complete'?'Nenhum consumo registrado.':'Os consumos ainda não foram confirmados.'}</p>`}</div></section>`;
}
function notesCard(visit){return`<section class="vr-card">${sectionHeading('notes','Descrição e evolução')}<div class="vr-card-content"><p class="vr-notes">${esc(informed(visit.completionSnapshot?.notes??visit.notes))}</p>${rows(visit.addenda).length?`<div class="vr-addenda"><h3>Adendos do atendimento</h3>${visit.addenda.map(item=>`<article><time>${esc(instant(item.createdAt))}</time><p class="vr-notes">${esc(informed(item.text))}</p></article>`).join('')}</div>`:''}</div></section>`;}

export function renderVisitRecord(state,{patientId,visitId,connected=false,photoId}={}){
 const patient=rows(state?.patients).find(p=>p.id===patientId),visit=rows(state?.visits).find(v=>v.id===visitId&&v.patientId===patientId);
 if(!patient||!visit)return'<section class="vr-page"><p class="vr-empty" role="status">Atendimento não encontrado para esta paciente.</p><a class="vr-text-link" href="#pacientes">Voltar para pacientes</a></section>';
 const status=visitStatus(visit),procedure=visit.completionSnapshot?.procedure||visit.procedureSnapshot,financial=visitRecordFinancials(state,visit),base=route(patient.id,visit.id),appointment=rows(state.appointments).find(a=>a.id===visit.appointmentId&&a.patientId===patient.id),professional=rows(state.clinic?.professionals).find(p=>p.id===(visit.professionalId||appointment?.professionalId)),time=/^([01]\d|2[0-3]):[0-5]\d$/.test(visit.time||appointment?.time||'')?visit.time||appointment.time:'Horário não informado';
 return`<article class="vr-page" data-vr-record data-vr-visit="${esc(visit.id)}"><a class="vr-back" href="${esc(route(patient.id))}">← ${esc(informed(patient.name))}</a><header class="vr-heading"><div><p class="vr-eyebrow">ATENDIMENTO</p><h1>${esc(informed(procedure?.name||visit.service))}</h1><p class="vr-date">${esc(longDay(visit.date))} <span aria-hidden="true">·</span> ${esc(time)}</p><div class="vr-meta"><span class="vr-status vr-status-${status.tone}">${status.label}</span><span>${esc(professional?.name||'Profissional não informada')}</span>${!connected?'<span>Ambiente local</span>':''}</div></div><div class="vr-toolbar">${actionLink(base+'/documentos','Consentimentos e anamnese')}<button type="button" class="vr-button" data-action="print-visit">Imprimir / salvar PDF</button>${status.editable?actionLink(base+'/registro','Continuar atendimento',true):actionLink(base+'/registro','Ver registro completo')}</div></header><div class="vr-layout"><div class="vr-main">${photosAndPoints(visit,procedure,photoId,base)}</div><aside class="vr-side" aria-label="Resumo do atendimento">${procedureCard(visit,procedure,status,financial)}${productsCard(visit)}${notesCard(visit)}${financialCard(state,visit)}</aside></div><footer class="vr-record-footer"><span>Ana Maria Jacob · Registro de atendimento</span><span>Informações privadas da paciente</span></footer></article>`;
}

/** Selects an already rendered photograph and its legend. No network, persistence,
 * navigation or medical operation occurs here. The host loads data-photo-src. */
export function mountVisitRecord(root,{onPhotoSelect}={}){
 const record=root?.matches?.('[data-vr-record]')?root:root?.querySelector?.('[data-vr-record]');
 if(!record)return()=>{};
 const select=record.querySelector('[data-vr-photo-select]');
 const change=()=>{const value=select.value;if(!/^\d+$/.test(value))return;const selected=record.querySelector(`[data-vr-photo-panel="${value}"]`);if(!selected)return;record.querySelectorAll('[data-vr-photo-panel]').forEach(panel=>{panel.hidden=panel.dataset.vrPhotoPanel!==value;});record.querySelectorAll('[data-vr-legend-panel]').forEach(panel=>{panel.hidden=panel.dataset.vrLegendPanel!==value;});const counter=record.querySelector('[data-vr-photo-count]');if(counter)counter.textContent=(Number(value)+1)+' de '+select.options.length;const photoId=selected.querySelector('[data-photo-src]')?.dataset.photoSrc;if(photoId&&typeof onPhotoSelect==='function')onPhotoSelect(photoId);};
 select?.addEventListener('change',change);if(select)change();return()=>select?.removeEventListener('change',change);
}
