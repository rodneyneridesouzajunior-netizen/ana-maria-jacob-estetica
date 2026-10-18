import {validateBackupState} from '../_shared/app-workspace-domain/backup.mjs';
import {defaultClinic,validateClinicAppointment} from '../_shared/app-workspace-domain/clinic-domain.mjs';
import {allocateLotCosts,quoteTotals,validateQuoteItem,stockUnits,visitMarkings,quoteExecutionCosts,completeVisit} from '../_shared/app-workspace-domain/operations-domain.mjs';
import {assertQuoteDeliveryTransitions} from './quote-delivery-transitions.mjs';
import {assertFacialHistoryPreserved} from '../_shared/app-workspace-domain/facial-study-domain.mjs';
import {activeWorkspace,mergeActiveWorkspace,validateRecycleTransition,isRecycled} from '../_shared/app-workspace-domain/recycle-bin.mjs';

export class WorkspaceError extends Error{constructor(code,message,status=422){super(message);this.code=code;this.status=status;}}
export const fail=(code,message,status=422)=>{throw new WorkspaceError(code,message,status);};
export const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const validId=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,179}$/.test(value)&&!['constructor','prototype','__proto__'].includes(value);
export const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof value==='string'?new TextEncoder().encode(value):value)),b=>b.toString(16).padStart(2,'0')).join('');
const same=(a,b)=>stable(a)===stable(b),omit=(v,keys)=>Object.fromEntries(Object.entries(v).filter(([k])=>!keys.includes(k)));
export const COLLECTIONS=['patients','appointments','visits','bills','payments','requests','products','procedures','stockLots','stockMovements','quotes','quoteSessionUses','quoteProductDeliveries','quoteProductDeliveryReversals','expectedReturns','operationHistory','patientHistory','installments','installmentHistory','expenses','expensePayments','expensePaymentReversals','paymentReversals','financeHistory','documentTemplates','documentResponses','documentHistory','comparisons','auditLog','facialStudies'];
const TOP_KEYS=new Set(['schema','revision','clinic','operationsSchema','recycleBin',...COLLECTIONS]);
export function emptyState(){return {schema:1,revision:0,operationsSchema:1,...Object.fromEntries(COLLECTIONS.map(k=>[k,[]])),clinic:defaultClinic()};}
function preserve(old,rows,label,allowed=[]){const index=new Map(rows.map(x=>[x.id,x]));for(const previous of old){const next=index.get(previous.id);if(!next||!same(omit(previous,allowed),omit(next,allowed)))fail('immutable_history',`${label}: registro anterior precisa ser preservado.`);}}
function prefix(old,next,label){if(!Array.isArray(next)||next.length<old.length||old.some((x,i)=>!same(x,next[i])))fail('immutable_history',`${label}: histórico anterior precisa ser preservado.`);}
const get=(s,key,id)=>s[key].find(x=>x.id===id);
const timestamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const newly=(old,next,key)=>next[key].filter(x=>!get(old,key,x.id));
function validateShape(s){
 if(!s||typeof s!=='object'||Array.isArray(s)||Object.keys(s).some(k=>!TOP_KEYS.has(k)))fail('unknown_state_field','Estrutura operacional não reconhecida.');
 // Additive schema-1 fields: accept pre-release records, but preserve() below
 // still rejects an old client attempting to erase existing delivery history.
 for(const key of ['quoteProductDeliveries','quoteProductDeliveryReversals'])if(s[key]===undefined)s[key]=[];
 if(new TextEncoder().encode(stable(s)).length>4*1024*1024)fail('state_too_large','O estado excede o limite operacional de 4 MB.',413);
 for(const key of COLLECTIONS)if(!Array.isArray(s[key])||s[key].length>10000)fail('invalid_collection','Coleção operacional incompatível: '+key);
 try{validateBackupState(s);}catch(error){fail('invalid_state',error.message);}
 // A demo signature is never promoted to clinical consent by moving it to a server.
 if(s.documentResponses.some(d=>d.status!=='rascunho'||d.signature))fail('clinical_signature_unavailable','Assinaturas de demonstração não são aceitas como consentimento clínico. Use o fluxo clínico oficial.');
 if(s.requests.length)fail('site_request_bridge_required','Solicitações do site precisam do vínculo operacional próprio.');
 for(const key of COLLECTIONS)for(const item of s[key])if(item.id.startsWith('demo-'))fail('demo_data_forbidden','Dados demonstrativos não podem ser enviados ao ambiente operacional.');
 for(const v of s.visits){for(const p of v.photos){if(p.src!==undefined||p.url!==undefined||p.original_url!==undefined||p.preview_url!==undefined)fail('photo_url_forbidden','URLs temporárias e fotos estáticas não pertencem ao estado.');if(!/^[a-f0-9]{64}$/.test(p.sha256||''))fail('photo_hash_required','Fotografia sem hash verificado.');}}
 for(const q of s.quotes){const totals=quoteTotals(q.items,q.discountBps);for(const key of ['margin','loss'])if(q[key]!==totals[key])fail('quote_totals_invalid','Resumo financeiro do orçamento inconsistente.');for(const item of q.items){const line=validateQuoteItem(item);for(const key of ['subtotal','cost','discount','total'])if(item[key]!==line[key])fail('quote_totals_invalid','Total de item inconsistente.');}}
}
function versioned(old,next,label){for(const p of old){const n=next.find(x=>x.id===p.id);if(!n)fail('record_removal_forbidden',`${label}: use inativação ou cancelamento.`);if(!same(p,n)&&n.version!==(p.version||1)+1)fail('entity_version_conflict',`${label}: versão não avançou exatamente uma vez.`,409);}}
export function validateTransition(old,next,{photos=[],now=new Date().toISOString(),clinicalCompletions=new Set()}={}){
 try{validateRecycleTransition(old,next);}catch(error){fail('recycle_transition_invalid',error.message);}
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'}).format(new Date(now));
 validateShape(next);if(next.revision!==old.revision)fail('revision_conflict','A revisão enviada difere da versão lida.',409);
 for(const type of COLLECTIONS)for(const record of next[type]||[]){const previous=get(old,type,record.id);if(previous&&same(previous,record))continue;for(const [field,owner]of Object.entries({patientId:'patients',visitId:'visits',billId:'bills',expenseId:'expenses',quoteId:'quotes',productId:'products',lotId:'stockLots',templateId:'documentTemplates'}))if(record[field]&&isRecycled(next,owner,record[field]))fail('recycled_binding','Recupere o registro vinculado na lixeira antes de cadastrar ou alterar este item.');}
 // Block new identity collisions without freezing unrelated work on a legacy
 // snapshot. Existing duplicates remain visible for deliberate correction.
 const cpfOf=p=>String(p?.cpf||'').replace(/\D/g,'');
 for(const p of next.patients){const previous=old.patients.find(x=>x.id===p.id),cpf=cpfOf(p);if(!cpf||previous&&cpfOf(previous)===cpf)continue;if(activeWorkspace(next).patients.some(other=>other.id!==p.id&&cpfOf(other)===cpf))fail('duplicate_patient_cpf','Este CPF já está vinculado a outro cadastro. Confira a paciente antes de salvar.');}
 try{assertFacialHistoryPreserved(old,next);}catch(error){fail('immutable_facial_history',error.message);}
 prefix(old.auditLog,next.auditLog,'Auditoria');if(next.auditLog.length!==old.auditLog.length)fail('audit_server_owned','A auditoria de revisão é registrada pelo servidor.');
 for(const key of ['stockMovements','quoteSessionUses','quoteProductDeliveries','quoteProductDeliveryReversals','operationHistory','patientHistory','installmentHistory','paymentReversals','expensePaymentReversals','financeHistory','documentHistory'])preserve(old[key]||[],next[key],key);
 try{assertQuoteDeliveryTransitions(activeWorkspace(old),activeWorkspace(next),{today,now});}catch(error){fail('product_delivery_invalid',error.message);}
 for(const key of ['patients','appointments','visits','bills','payments','products','procedures','stockLots','quotes','expenses','expensePayments','documentTemplates','documentResponses','comparisons','expectedReturns'])for(const p of old[key]||[])if(!get(next,key,p.id))fail('record_removal_forbidden','Use arquivamento ou cancelamento; não remova '+key+'.');
 preserve(old.expectedReturns,next.expectedReturns,'Retornos previstos',['status','appointmentId']);
 for(const a of next.appointments){const p=get(old,'appointments',a.id);if(p&&(p.status==='concluido'||old.visits.some(v=>v.appointmentId===p.id&&(v.status==='concluido'||v.lockedAt)))&&!same(p,a))fail('appointment_history_immutable','Preserve o horário e o profissional do atendimento concluído.');const moved=!p||['patientId','date','time','duration','professionalId'].some(k=>p[k]!==a[k])||p.status==='cancelado'&&a.status!=='cancelado';if(moved){try{validateClinicAppointment(activeWorkspace(next),a,a.id);}catch(error){fail('appointment_invalid',error.message);}}}
 for(const key of ['patients','products','procedures','stockLots','expenses'])versioned(old[key],next[key],key);
 for(const p of old.patients){const n=get(next,'patients',p.id);if(!same(p,n)&&!newly(old,next,'patientHistory').some(h=>h.patientId===p.id&&same(h.previous,p)&&same(h.snapshot,n)))fail('patient_history_required','A correção do cadastro precisa preservar a versão anterior.');}
 for(const e of old.expenses){const n=get(next,'expenses',e.id);if(same(e,n))continue;if(e.cancelledAt||old.expensePayments.some(p=>p.expenseId===e.id&&!p.reversedAt)&&next.expensePayments.some(p=>p.expenseId===e.id&&!p.reversedAt))fail('paid_expense_immutable','Estorne os pagamentos antes de corrigir a despesa.');if(!newly(old,next,'financeHistory').some(h=>h.entityId===e.id&&same(h.previous,e)&&same(h.snapshot,n)&&String(h.reason||'').trim().length>=5))fail('expense_history_required','A alteração da despesa precisa preservar seu histórico e motivo.');}
 preserve(old.payments,next.payments,'Recebimentos',['reversedAt','reconciledAt','reconciliationReference']);preserve(old.expensePayments,next.expensePayments,'Pagamentos',['reversedAt']);
 for(const p of old.payments){const n=get(next,'payments',p.id);if(n.reconciledAt!==p.reconciledAt||n.reconciliationReference!==p.reconciliationReference){if(p.reversedAt||!timestamp(n.reconciledAt)||typeof n.reconciliationReference!=='string'||!n.reconciliationReference.trim()||n.reconciliationReference.length>160||!newly(old,next,'financeHistory').some(h=>h.action==='conciliacao_manual'&&h.entityId===p.id))fail('invalid_reconciliation','Conferência sem referência e evento financeiro.');}}
 for(const key of ['payments','expensePayments'])for(const p of old[key]){const n=get(next,key,p.id);if(p.reversedAt&&!same(p,n))fail('immutable_reversal','Um estorno anterior não pode ser reescrito.');}
 for(const p of old.stockLots){const n=get(next,'stockLots',p.id);if(!same(omit(p,['balanceUnits','version','updatedAt','supplier']),omit(n,['balanceUnits','version','updatedAt','supplier'])))fail('lot_original_immutable','Os dados originais do lote são imutáveis.');}
 for(const part of old.installments){const current=get(next,'installments',part.id),archived=get(next,'installmentHistory',part.id);if(current&&!same(current,part)||!current&&(!archived||!same(part,omit(archived,['archivedAt']))))fail('installment_history_invalid','Parcelas anteriores devem permanecer ou ser arquivadas integralmente.');}
 for(const t of old.documentTemplates){const n=get(next,'documentTemplates',t.id);prefix(t.versions,n.versions,'Versões do documento');}
 for(const c of old.comparisons){const n=get(next,'comparisons',c.id);if(c.status==='excluido'&&!same(c,n))fail('immutable_comparison','Comparação excluída é preservada.');prefix(c.history||[],n.history||[],'Versões da comparação');if(!same(c,n)&&(n.version!==(c.schemaVersion===1?1:c.version)+1||n.history.length!==(c.history||[]).length+1||!same(n.history.at(-1).snapshot,omit(c,['history']))))fail('comparison_version_invalid','A comparação precisa arquivar a versão anterior e avançar uma versão.');}
 for(const q of old.quotes){const n=get(next,'quotes',q.id);prefix(q.history,n.history,'Histórico da proposta');
  if(q.status==='rascunho'&&!same(q,n)){
   if(n.history.length!==q.history.length+1)fail('quote_version_invalid','A proposta precisa preservar uma entrada de histórico por alteração.');
   if(n.status==='rascunho'){const snapshot={title:q.title,patientId:q.patientId,validUntil:q.validUntil,conditions:q.conditions,notes:q.notes||'',paymentMethods:q.paymentMethods||[],items:q.items,...quoteTotals(q.items,q.discountBps)};if(n.version!==q.version+1||!same(n.history.at(-1).snapshot,snapshot))fail('quote_version_invalid','A revisão da proposta precisa preservar os valores anteriores.');}
   if(n.status==='aprovado'&&(n.version!==q.version||!same(omit(q,['status','billId','approvedAt','approvalNote','history']),omit(n,['status','billId','approvedAt','approvalNote','history']))||n.history.at(-1).status!=='aprovado'||!String(n.approvalNote||'').trim()||q.validUntil&&q.validUntil<today))fail('quote_approval_invalid','A aprovação deve preservar a proposta vigente e registrar confirmação.');
   if(n.status==='cancelado'&&(n.version!==q.version+1||!same(omit(q,['status','version','cancelledAt','cancelDate','cancelReason','updatedAt','history']),omit(n,['status','version','cancelledAt','cancelDate','cancelReason','updatedAt','history']))))fail('quote_version_invalid','O cancelamento deve preservar os valores da proposta.');
  }
  if(q.status==='cancelado'&&!same(q,n))fail('immutable_quote','Orçamento cancelado é preservado.');
  if(q.status==='aprovado'&&!same(q,n)){
   if(n.status!=='cancelado'||n.version!==q.version+1||!same(omit(q,['status','version','cancelledAt','cancelDate','cancelReason','updatedAt','history']),omit(n,['status','version','cancelledAt','cancelDate','cancelReason','updatedAt','history'])))fail('immutable_quote','Valores e itens aprovados são imutáveis.');
   const active=activeWorkspace(next);
   if(active.quoteSessionUses.some(u=>u.quoteId===q.id&&!u.reversedAt))fail('quote_already_used','Orçamento com sessões utilizadas não pode ser cancelado.');
   if(active.quoteProductDeliveries.some(d=>d.quoteId===q.id&&!active.quoteProductDeliveryReversals.some(r=>r.deliveryId===d.id)))fail('quote_already_delivered','Confira e estorne as entregas antes de cancelar o orçamento.');
  }
 }
 for(const b of old.bills){const n=get(next,'bills',b.id);if(!same(omit(b,['cost','actualCost','costKind','cancelledAt','cancelDate','cancelReason']),omit(n,['cost','actualCost','costKind','cancelledAt','cancelDate','cancelReason'])))fail('immutable_bill','Valores e vínculos da cobrança anterior são preservados.');if(b.cancelledAt&&!same(b,n))fail('immutable_bill','Cobrança cancelada não pode mudar.');if(!b.visitId&&!b.quoteId&&!same(omit(b,['cancelledAt','cancelDate','cancelReason']),omit(n,['cancelledAt','cancelDate','cancelReason'])))fail('immutable_bill','Custos de cobrança avulsa são preservados.');if(n.cancelledAt&&(!timestamp(n.cancelledAt)||String(n.cancelReason||'').trim().length<5))fail('invalid_cancellation','Cancelamento precisa de data e motivo.');}
 // Stock cannot be consumed independently from the clinical conclusion that owns it.
 for(const m of newly(old,next,'stockMovements')){const lot=get(next,'stockLots',m.lotId);if(!['entrada','ajuste','consumo','entrega_produto','estorno_entrega_produto'].includes(m.type)||m.unitCost!==lot.unitCost||typeof m.reason!=='string'||!m.reason.trim())fail('stock_movement_invalid','Movimento de estoque sem tipo, custo ou motivo válido.');if(m.type==='entrada'&&(get(old,'stockLots',m.lotId)||m.deltaUnits!==lot.initialUnits))fail('stock_entry_invalid','A entrada inicial deve corresponder ao novo lote.');if(m.type==='consumo'&&(!m.visitId||get(old,'visits',m.visitId)?.status==='concluido'||get(next,'visits',m.visitId)?.status!=='concluido'))fail('stock_consumption_invalid','Baixa de consumo precisa de conclusão da consulta.');if(m.type!=='consumo'&&m.visitId)fail('stock_consumption_invalid','Ajuste de estoque não substitui o consumo da consulta.');}
 const verified=new Map(photos.map(p=>[p.id,p]));
 for(const v of next.visits){const previous=get(old,'visits',v.id);
  if(previous&&(previous.status==='concluido'||previous.lockedAt)){if(!same(omit(previous,['addenda']),omit(v,['addenda'])))fail('immutable_visit','Consulta concluída só aceita adendos.');prefix(previous.addenda||[],v.addenda||[],'Adendos');}
  if(previous?.status==='cancelado'&&!same(previous,v))fail('immutable_visit','Consulta cancelada é preservada.');
  if(previous){if(previous.patientId!==v.patientId)fail('patient_binding_immutable','A paciente da consulta não pode ser trocada.');if(previous.procedureSnapshot&&!same(previous.procedureSnapshot,v.procedureSnapshot))fail('procedure_snapshot_immutable','Preserve a versão do procedimento selecionada na consulta.');for(const p of previous.photos){const n=v.photos.find(x=>x.id===p.id);if(!n||!same(omit(p,['label','phase']),omit(n,['label','phase'])))fail('original_photo_immutable','O arquivo original e seu vínculo são imutáveis.');}for(const [id,m]of Object.entries(previous.maps)){const n=v.maps[id];if(!n)fail('map_removal_forbidden','Preserve o mapa e seu histórico.');if(!same(m,n)){const edit=same(n.history,[...m.history,m.points].slice(-20)),undo=m.history.length>0&&same(n.points,m.history.at(-1))&&same(n.history,m.history.slice(0,-1));if(n.version!==m.version+1||!edit&&!undo)fail('map_version_conflict','A alteração do mapa deve preservar sua versão anterior ou desfazer exatamente o último traçado.',409);}}}
  if(v.procedureSnapshot&&!previous?.procedureSnapshot&&!same(v.procedureSnapshot,get(next,'procedures',v.procedureId)))fail('procedure_snapshot_invalid','A versão selecionada deve corresponder ao catálogo.');
  for(const [photoId,map]of Object.entries(v.maps||{}))for(const point of map.points){
   if(!point.procedureId)continue;
   const priorMap=previous?.maps?.[photoId],priorPoint=priorMap?.points.find(p=>p.id===point.id),binding=p=>p&&({id:p.procedureId,version:p.procedureVersion,snapshot:p.procedureSnapshot});
   const restored=priorMap?.history?.length&&same(map.points,priorMap.history.at(-1))&&same(map.history,priorMap.history.slice(0,-1));
   if(!restored&&!same(binding(point),binding(priorPoint))){const catalog=get(next,'procedures',point.procedureId);if(!catalog||catalog.active===false||!same(catalog,point.procedureSnapshot)&&!same(v.procedureSnapshot,point.procedureSnapshot))fail('marking_procedure_invalid','Selecione uma versão ativa e exata do procedimento da marcação.');}
  }
  for(const photo of v.photos){const p=verified.get(photo.id);if(!p||p.status!=='ready'||p.patient_id!==v.patientId||p.visit_id!==v.id||p.sha256!==photo.sha256||p.width!==photo.width||p.height!==photo.height)fail('photo_binding_invalid','A fotografia não foi enviada/verificada para esta paciente e consulta.');}
  if(v.status==='concluido'&&!previous?.lockedAt){
   if(!v.completionSnapshot||!timestamp(v.completedAt)||v.lockedAt!==v.completedAt||!v.procedureSnapshot||!validId(v.completionOperationId))fail('completion_snapshot_required','Conclusão sem versão clínica preservada.');
   if(v.procedureSnapshot.active===false||get(next,'procedures',v.procedureId)?.active===false||v.date>today||Date.parse(v.completedAt)>Date.parse(now)+300000)fail('invalid_completion','Confira data e procedimento da conclusão.');
   const usage=v.consumptions||[],allocated=allocateLotCosts(usage);if(usage.some((x,i)=>x.cost!==allocated[i].cost))fail('cost_allocation_invalid','Custos dos lotes não correspondem ao consumo.');
   const activeVisit=get(activeWorkspace(next),'visits',v.id);
   if(!activeVisit)fail('recycled_binding','Recupere a consulta na lixeira antes de concluir.');
   const required=visitMarkings(activeVisit),seen=new Set(),totals=new Map();
   for(const x of usage){const lot=get(next,'stockLots',x.lotId),product=get(next,'products',x.productId);if(!lot||!product||product.active===false||x.unitCost!==lot.unitCost||x.productId!==lot.productId||x.unit!==lot.unit||x.lotCode!==lot.code||x.expiry!==lot.expiry||x.productName!==product.name||x.units!==stockUnits(x.quantity)||lot.expiry<today)fail('consumption_lot_invalid','Consumo difere do lote verificado ou o lote está vencido.');totals.set(lot.id,(totals.get(lot.id)||0)+x.units);if(x.photoId||x.pointId){const key=JSON.stringify([x.photoId,x.pointId]),point=required.find(p=>p.photoId===x.photoId&&p.pointId===x.pointId);if(!point||seen.has(key)||stockUnits(point.quantity)!==x.units||point.unit!==x.unit||point.region!==x.region)fail('consumption_marking_invalid','Consumo difere da marcação registrada.');seen.add(key);}else if(typeof x.reason!=='string'||!x.reason.trim())fail('consumption_reason_required','Informe o uso do material sem marcação.');}
   if(required.some(p=>!seen.has(JSON.stringify([p.photoId,p.pointId]))))fail('consumption_marking_missing','Toda marcação com quantidade precisa de lote e consumo.');
   const movements=newly(old,next,'stockMovements').filter(m=>m.visitId===v.id);if(movements.length!==totals.size||[...totals].some(([lot,units])=>!movements.some(m=>m.type==='consumo'&&m.lotId===lot&&m.deltaUnits===-units&&m.operationId===v.completionOperationId)))fail('consumption_movement_missing','Consumo precisa corresponder à baixa do estoque.');
   if(v.completionSnapshot.procedureExecutions){
    // Rebuild from the saved draft and the explicit user selections. This checks
    // every cost allocation and session event, including the multi-procedure case.
    const expectedActive=activeWorkspace(old),snap=v.completionSnapshot;
    const consumptions=usage.map(x=>Object.fromEntries(['lotId','quantity','photoId','pointId','reason'].filter(k=>x[k]!==undefined).map(k=>[k,x[k]])));
    try{completeVisit(expectedActive,{operationId:v.completionOperationId,visitId:v.id,procedureId:v.procedureId,consumptions,quoteId:v.quoteId||'',...(v.quoteId?{quoteItems:snap.quoteItems}:{}),today,now:v.completedAt},{documentCheck:()=>true});}catch(error){fail('completion_execution_invalid',error.message);}
    const expectedState=structuredClone(old);mergeActiveWorkspace(expectedState,expectedActive);
    const expectedVisit=get(expectedState,'visits',v.id);
    if(!same(expectedVisit,v))fail('completion_execution_invalid','A conclusão diverge da execução preservada dos procedimentos.');
    for(const key of ['quoteSessionUses','stockMovements','expectedReturns'])if(!same(expectedState[key].filter(x=>x.visitId===v.id),next[key].filter(x=>x.visitId===v.id)))fail('completion_execution_invalid','Sessões, estoque e retornos precisam corresponder à conclusão.');
    if(!same(get(expectedState,'bills',v.billId),get(next,'bills',v.billId)))fail('completion_execution_invalid','A cobrança diverge da execução dos procedimentos.');
   }else{
   const snap=v.completionSnapshot,sessions=snap.sessions;if(!Number.isSafeInteger(sessions)||sessions<1||sessions>1000||!v.quoteId&&sessions!==1)fail('invalid_sessions','Quantidade de sessões incompatível.');const expected=usage.reduce((n,x)=>n+x.cost,0)+v.procedureSnapshot.cost*sessions;if(v.actualCost!==expected||snap.actualCost!==expected||!same(snap.consumptions,usage)||!same(snap.procedure,v.procedureSnapshot)||snap.billId!==v.billId||snap.quoteId!==(v.quoteId||null)||snap.service!==v.service)fail('visit_cost_invalid','O custo realizado diverge do registro preservado.');
   if(v.quoteId){const uses=newly(old,next,'quoteSessionUses').filter(u=>u.visitId===v.id),q=get(next,'quotes',v.quoteId),item=q?.items.find(i=>i.id===uses[0]?.itemId);if(uses.length!==1||uses[0].reversedAt||uses[0].sessions!==sessions||uses[0].cost!==v.actualCost||uses[0].operationId!==v.completionOperationId||uses[0].quoteId!==v.quoteId||item?.procedureId!==v.procedureId||v.billId!==q.billId)fail('session_use_invalid','Sessão, procedimento, cobrança e custo devem corresponder.');}else {const b=get(next,'bills',v.billId);if(!b||b.visitId!==v.id||b.quoteId||b.total!==v.procedureSnapshot.price)fail('visit_bill_invalid','Cobrança incompatível com o procedimento da consulta.');}
   }
   // Only the authenticated completion handler can supply this server-owned Set.
   // A generic snapshot commit never authorizes a professional attestation.
   if(!(clinicalCompletions instanceof Set)||!clinicalCompletions.has(v.id))fail('clinical_signature_unavailable','Revise os documentos e confirme pessoalmente a conclusão no fluxo clínico.');
  }
 }
 for(const u of newly(old,next,'quoteSessionUses'))if(get(old,'visits',u.visitId)?.status==='concluido'||get(next,'visits',u.visitId)?.quoteId!==u.quoteId||u.reversedAt)fail('session_use_invalid','Evento de sessão precisa corresponder à nova conclusão.');
 // Every realised bill is derived from finished visits / session events; no client-written profit.
 const active=activeWorkspace(next);
 for(const b of next.bills){if(b.visitId){const v=get(next,'visits',b.visitId);if(v?.billId!==b.id||v.status!=='concluido')fail('visit_bill_invalid','Cobrança de consulta sem vínculo recíproco exclusivo.');if(b.actualCost!==v.actualCost||b.cost!==v.actualCost)fail('bill_cost_invalid','Custo de cobrança não corresponde à consulta.');}if(b.quoteId&&get(active,'quotes',b.quoteId)){const expected=quoteExecutionCosts(active,b.quoteId),prior=get(old,'bills',b.id),costChanged=!prior||['actualCost','cost','costKind'].some(k=>b[k]!==prior[k]);if(costChanged&&(b.actualCost!==expected.actualCost||b.cost!==expected.cost||b.costKind!==expected.costKind))fail('bill_cost_invalid','Custo da proposta não corresponde às sessões e produtos entregues.');}}
 return next;
}

const crcTable=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes)crc=crcTable[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
// Structural integrity, not a diagnostic image decoder. Never alters original bytes.
export function imageInfo(bytes,mime){
 const b=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes),view=new DataView(b.buffer,b.byteOffset,b.byteLength),tag=i=>String.fromCharCode(...b.slice(i,i+4));let width,height,complete=false;
 if(mime==='image/png'&&b.length>=57&&[137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v)){
  let i=8,ihdr=false,idat=false;while(i+12<=b.length){const size=view.getUint32(i),end=i+12+size;if(end>b.length)break;const type=tag(i+4);if(crc32(b.subarray(i+4,i+8+size))!==view.getUint32(i+8+size))break;
   if(!ihdr){if(type!=='IHDR'||size!==13)break;width=view.getUint32(i+8);height=view.getUint32(i+12);const depth=b[i+16],color=b[i+17];if(!({0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]})[color]?.includes(depth)||b[i+18]!==0||b[i+19]!==0||b[i+20]>1)break;ihdr=true;}
   else if(type==='IHDR')break;
   if(type==='IDAT'&&size>2)idat=true;
   if(type==='IEND'){complete=size===0&&idat&&end===b.length;break;}i=end;
  }
 }
 else if(mime==='image/jpeg'&&b.length>=16&&b[0]===255&&b[1]===216&&b.at(-2)===255&&b.at(-1)===217){
  let i=2;while(i+4<=b.length){if(b[i]!==255)break;let marker=b[++i];while(marker===255&&i<b.length)marker=b[++i];i++;if(marker===217)break;if(marker===0||marker===1||marker>=208&&marker<=215)continue;if(i+2>b.length)break;const size=view.getUint16(i);if(size<2||i+size>b.length)break;
   if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){if(size<11||size!==8+3*b[i+7])break;height=view.getUint16(i+3);width=view.getUint16(i+5);}
   if(marker===218){complete=Boolean(width&&height&&size>=6&&i+size<b.length-2);break;}i+=size;
  }
 }
 else if(mime==='image/webp'&&b.length>=26&&tag(0)==='RIFF'&&tag(8)==='WEBP'&&view.getUint32(4,true)+8===b.length){
  let i=12,bitstream=false,invalid=false;while(i+8<=b.length){const type=tag(i),size=view.getUint32(i+4,true),at=i+8,end=at+size;if(end+(size%2)>b.length){invalid=true;break;}
   if(type==='ANIM'||type==='ANMF'){invalid=true;break;}
   if(type==='VP8X'){if(size!==10||b[at]&2){invalid=true;break;}width=1+b[at+4]+(b[at+5]<<8)+(b[at+6]<<16);height=1+b[at+7]+(b[at+8]<<8)+(b[at+9]<<16);}
   if(type==='VP8 '){if(size<11||b[at+3]!==157||b[at+4]!==1||b[at+5]!==42){invalid=true;break;}width??=view.getUint16(at+6,true)&16383;height??=view.getUint16(at+8,true)&16383;bitstream=true;}
   if(type==='VP8L'){if(size<6||b[at]!==47){invalid=true;break;}width??=1+(b[at+1]|((b[at+2]&63)<<8));height??=1+((b[at+2]>>6)|(b[at+3]<<2)|((b[at+4]&15)<<10));bitstream=true;}i=end+(size%2);
  }complete=!invalid&&bitstream&&i===b.length;
 }
 if(!complete||!width||!height||width*height>40000000)fail('invalid_image','Imagem incompleta, inválida ou acima de 40 megapixels.');return {width,height};
}
