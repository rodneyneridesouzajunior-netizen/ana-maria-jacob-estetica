import {validateConfig,assertNetworkAllowed} from './config.mjs';
import {IntegrationError} from './errors.mjs';

// Public site requests are NOT appointments. No session, patient identifiers,
// medical photos or clinical notes are sent through this anonymous endpoint.
export function createSiteClient({config:input,origin,fetchImpl=globalThis.fetch}={}) {
  const config=validateConfig(input,origin);
  return Object.freeze({
    async requestAppointment(payload) {
      assertNetworkAllowed(config,{write:true});
      if(!payload||typeof payload!=='object'||Array.isArray(payload)||payload.consentimento_contato!==true||
         !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.idempotency_key||'')) {
        throw new IntegrationError('invalid_site_request','Confira os dados da solicitação e o consentimento para contato.');
      }
      const allowed=['idempotency_key','started_at','website','nome','telefone','primeira_visita','interesse','data_preferida','periodo','consentimento_contato'];
      if(Object.keys(payload).some(key=>!allowed.includes(key))) throw new IntegrationError('unexpected_site_field','Esta solicitação contém campos fora do formulário público.');
      const body=JSON.stringify(payload),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),config.timeoutMs);
      try {
        const response=await fetchImpl(`${config.supabaseUrl}/functions/v1/agendamento-submit`,{
          method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body,
          cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',signal:controller.signal,
        });
        let result;
        try{result=await response.json();}catch{throw new IntegrationError('invalid_response','O recebimento não foi confirmado. Confira antes de enviar novamente.',{uncertain:true});}
        if(!response.ok||result?.ok!==true||result?.recebido!==true){
          throw new IntegrationError('site_request_rejected',typeof result?.erro==='string'?result.erro.slice(0,400):'O servidor não confirmou o recebimento.',{status:response.status,uncertain:response.status>=500});
        }
        return Object.freeze({received:true,appointmentConfirmed:false});
      }catch(error){
        if(error instanceof IntegrationError)throw error;
        throw new IntegrationError('site_request_uncertain','O recebimento não foi confirmado. Confira a solicitação antes de repetir o envio.',{uncertain:true});
      }finally{clearTimeout(timer);}
    },
  });
}
