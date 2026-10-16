import {PUBLIC_BACKEND} from './integration/public-backend.mjs';
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const failure=(code,message,details={})=>Object.assign(Error(message),{code,...details});
const definitive=new Set(['site_booking_invalid','site_booking_filters_invalid','site_request_unavailable','site_request_changed','site_request_already_booked','site_booking_confirmation_required','site_booking_patient_required','site_booking_identity_mismatch','site_booking_patient_ambiguous','site_booking_slot_invalid','site_booking_date_invalid','site_booking_id_conflict','revision_conflict','operation_reused','invalid_workspace_state','invalid_state','body_too_large']);

export function createSiteBookingService({session,fetchImpl=globalThis.fetch,timeoutMs=15000,uuidFactory=()=>crypto.randomUUID()}={}){
 if(!session?.requireReady||!session?.assertCurrent||!session?.subscribe)throw failure('session_required','Entre com sua conta da clínica.');
 let closed=false,generation=0,pending=null,busy=false,clinic=null;const controllers=new Set();
 const stop=()=>{closed=true;generation++;pending=null;busy=false;for(const c of controllers)c.abort();controllers.clear();};
 const unsubscribe=session.subscribe(stop),check=turn=>{if(closed||generation!==turn)throw failure('session_closed','Acesso encerrado. Entre novamente.');};
 async function call(action,payload={},write=false){
  const turn=generation;check(turn);const body=JSON.stringify({...structuredClone(payload),acao:action});let controller,timer,sent=false;
  try{
   const auth=await session.requireReady();check(turn);controller=new AbortController();controllers.add(controller);timer=setTimeout(()=>controller.abort(),timeoutMs);sent=true;
   const response=await fetchImpl(PUBLIC_BACKEND.supabaseUrl+'/functions/v1/app-workspace',{method:'POST',headers:{Authorization:'Bearer '+auth.token,apikey:PUBLIC_BACKEND.publishableKey,'Content-Type':'application/json'},body,signal:controller.signal,credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer'});
   check(turn);await session.assertCurrent(auth);check(turn);
   if(response.status===401||response.status===403){stop();session.invalidate?.('access_denied');throw failure('access_denied','Entre novamente com sua conta e autenticador.');}
   let result;try{result=await response.json();}catch{throw failure('invalid_response','Não foi possível confirmar o resultado. Confira a gravação.',{uncertain:write});}
   check(turn);await session.assertCurrent(auth);check(turn);
   if(!response.ok||result.ok===false){const rejected=result.ok===false&&definitive.has(result.codigo)&&[404,409,413,422].includes(response.status);throw failure(result.codigo||'backend_unavailable',rejected&&typeof result.erro==='string'?result.erro:'Não foi possível confirmar o resultado. Confira a gravação antes de repetir.',{uncertain:write&&!rejected,rejected});}
   if(result.ok!==true||result.auth_method!=='supabase_auth'||result.role!=='owner'||!uuid(result.clinic_id)||clinic&&clinic!==result.clinic_id)throw failure('invalid_auth_context','A resposta não confirmou o contexto da clínica.',{uncertain:write});
   clinic=result.clinic_id;return result;
  }catch(error){check(turn);if(error.code)throw error;throw failure('connection_failed',write&&sent?'A conexão caiu antes da confirmação. Confira a gravação antes de repetir.':'Não foi possível consultar os pedidos.',{uncertain:write&&sent});}
  finally{clearTimeout(timer);if(controller)controllers.delete(controller);}
 }
 function receipt(result,p,{status=false}={}){
  const op=result?.operation,value=status?op?.result:result,b=value?.booking;
  const patient=p.patient_id||p.new_patient?.id;
  if(!op||op.id!==p.operation_id||op.kind!=='site_booking'||op.status!=='committed'||!b||b.operation_id!==p.operation_id||b.request_id!==p.request_id||b.patient_id!==patient||b.appointment_id!==p.appointment?.id||value.workspace_revision!==p.expected_revision+1||b.workspace_revision!==value.workspace_revision)throw failure('invalid_booking_receipt','A resposta não confirmou este agendamento. Confira a gravação.',{uncertain:true});
  pending=null;return value;
 }
 async function send(){
  check(generation);if(busy||!pending||pending.rejected)throw failure('booking_pending','Confira a operação anterior.');const selected=pending,turn=generation;busy=true;
  try{return receipt(await call('agendar_pedido_site',selected.payload,true),selected.payload);}catch(error){if(!closed&&pending===selected)selected.rejected=error.rejected===true;throw error;}finally{if(turn===generation)busy=false;}
 }
 return Object.freeze({session,
  list:filters=>call('listar_pedidos_agenda',filters),
  schedule(input){check(generation);if(pending||busy)throw failure('booking_pending','Confira o agendamento anterior antes de criar outro.');const operation_id=uuidFactory();if(!uuid(operation_id))throw failure('invalid_operation','Não foi possível identificar a operação.');pending={payload:{...structuredClone(input),operation_id},rejected:false};return send();},
  retry:send,
  async resolve(){check(generation);if(busy||!pending||pending.rejected)throw failure('booking_pending','Não há gravação incerta para conferir.');const selected=pending,turn=generation;busy=true;try{const result=await call('status_agendamento_site',{operation_id:selected.payload.operation_id});return result.operation===null?{pending:true}:receipt(result,selected.payload,{status:true});}finally{if(turn===generation)busy=false;}},
  getPending:()=>pending?structuredClone(pending):null,isBusy:()=>busy,
  discardRejected(){check(generation);if(busy||pending&&!pending.rejected)throw failure('booking_pending','Confira a gravação incerta antes de descartar.');pending=null;},
  dispose(){stop();unsubscribe?.();},
 });
}
