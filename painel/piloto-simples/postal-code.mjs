const STATES=new Set('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' '));
const ADDRESS_FIELDS=['address','neighborhood','city','state'];
export const POSTAL_CODE_MESSAGES={invalid:'Informe um CEP com 8 dígitos.',not_found:'CEP não encontrado. Confira o número ou preencha o endereço manualmente.',unavailable:'Não foi possível consultar o CEP. Você pode preencher o endereço manualmente.',timeout:'A consulta demorou mais que o esperado. Tente novamente ou preencha manualmente.'};
export class PostalCodeError extends Error{constructor(code){super(POSTAL_CODE_MESSAGES[code]||'Consulta cancelada.');this.name='PostalCodeError';this.code=code;}}
export function normalizePostalCode(value){const text=String(value??'').trim();if(!/^\d{5}-?\d{3}$/.test(text))throw new PostalCodeError('invalid');return text.replace('-','');}

/** Only the CEP leaves the browser. Successful responses are cached in memory. */
export function createPostalCodeClient({fetchImpl=(...args)=>globalThis.fetch(...args),timeoutMs=7000,now=()=>Date.now(),cacheTTL=30*60_000}={}){
 const cache=new Map();
 async function lookup(value,{signal}={}){
  const code=normalizePostalCode(value);if(signal?.aborted)throw new PostalCodeError('aborted');
  const hit=cache.get(code);if(hit&&now()-hit.at<cacheTTL)return {...hit.address};
  const controller=new AbortController();let timer,abort;
  const cancelled=new Promise((_,reject)=>{abort=()=>{controller.abort();reject(new PostalCodeError('aborted'));};signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>{controller.abort();reject(new PostalCodeError('timeout'));},timeoutMs);});
  const request=async()=>{
   const response=await fetchImpl(`https://viacep.com.br/ws/${code}/json/`,{method:'GET',credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',redirect:'error',signal:controller.signal});
   if(!response.ok)throw new PostalCodeError('unavailable');const data=await response.json();
   if(!data||typeof data!=='object'||Array.isArray(data))throw new PostalCodeError('unavailable');
   if(data.erro===true||data.erro==='true')throw new PostalCodeError('not_found');
   const safeText=(key,max)=>{if(typeof data[key]!=='string'||data[key].length>max||/[\u0000-\u001f\u007f]/.test(data[key]))throw new PostalCodeError('unavailable');return data[key].trim();};
   let returnedCode;try{returnedCode=normalizePostalCode(data.cep);}catch{throw new PostalCodeError('unavailable');}
   const address={postalCode:code,address:safeText('logradouro',300),neighborhood:safeText('bairro',120),city:safeText('localidade',120),state:safeText('uf',2)};
   if(returnedCode!==code||!address.city||!STATES.has(address.state))throw new PostalCodeError('unavailable');return address;
  };
  try{const address=await Promise.race([cancelled,request()]);if(signal?.aborted||controller.signal.aborted)throw new PostalCodeError('aborted');cache.delete(code);cache.set(code,{at:now(),address});if(cache.size>100)cache.delete(cache.keys().next().value);return {...address};}
  catch(error){if(error instanceof PostalCodeError)throw error;throw new PostalCodeError(signal?.aborted?'aborted':'unavailable');}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
 }
 return {lookup};
}
const defaultClient=createPostalCodeClient();

/** Preserves edits made while a request is pending and cancels on save/close. */
export function mountPostalCodeLookup(form,{client=defaultClient,canApply=()=>true}={}){
 const postal=form.elements.namedItem('postalCode'),button=form.querySelector('[data-postal-search]'),status=form.querySelector('[data-postal-status]'),section=form.querySelector('[data-postal-section]');
 const fields=Object.fromEntries(ADDRESS_FIELDS.map(name=>[name,form.elements.namedItem(name)])),edits=Object.fromEntries(ADDRESS_FIELDS.map(name=>[name,0]));
 let disposed=false,sequence=0,pending=null,lastSuccess='';
 const announce=text=>{if(!disposed)status.textContent=text;};
 const loading=value=>{if(disposed)return;button.disabled=value;section.setAttribute('aria-busy',String(value));};
 function cancel(){sequence++;pending?.controller.abort();pending=null;loading(false);}
 async function search({explicit=false}={}){
  if(disposed||!canApply())return;let code;try{code=normalizePostalCode(postal.value);}catch{cancel();if(explicit)announce(POSTAL_CODE_MESSAGES.invalid);return;}
  if(pending?.code===code||!explicit&&lastSuccess===code)return;
  cancel();const token=sequence,controller=new AbortController(),snapshot=Object.fromEntries(ADDRESS_FIELDS.map(name=>[name,{value:fields[name].value,edits:edits[name]}]));pending={code,controller};loading(true);announce('Consultando CEP…');
  try{
   const address=await client.lookup(code,{signal:controller.signal});if(disposed||token!==sequence||!canApply()||normalizePostalCode(postal.value)!==code)return;
   let changed=false,preserved=false;
   for(const name of ADDRESS_FIELDS){if(edits[name]!==snapshot[name].edits||fields[name].value!==snapshot[name].value){preserved=true;continue;}if(address[name]&&fields[name].value!==address[name]){fields[name].value=address[name];changed=true;}}
   if(changed)form.dataset.unsaved='true';lastSuccess=code;
   announce(preserved?'CEP localizado. Suas alterações manuais foram preservadas. Confira o endereço.':!address.address||!address.neighborhood?'CEP localizado. Confira e complete rua e bairro manualmente.':'Endereço preenchido pelo CEP. Confira e informe número e complemento.');
  }catch(error){if(!disposed&&token===sequence&&error?.code!=='aborted')announce(error instanceof PostalCodeError?error.message:POSTAL_CODE_MESSAGES.unavailable);}
  finally{if(!disposed&&token===sequence){pending=null;loading(false);}}
 }
 function input(event){if(disposed)return;const name=event.target.name;if(Object.hasOwn(edits,name))edits[name]++;if(name==='postalCode'){lastSuccess='';cancel();announce('');void search();}}
 function change(event){if(Object.hasOwn(edits,event.target.name))edits[event.target.name]++;if(event.target===postal)void search();}
 const blur=()=>{if(!postal.value.trim())return;try{normalizePostalCode(postal.value);void search();}catch{cancel();announce(POSTAL_CODE_MESSAGES.invalid);}},click=()=>void search({explicit:true});
 const submit=()=>{cancel();announce('');};
 form.addEventListener('input',input);form.addEventListener('change',change);form.addEventListener('submit',submit,true);postal.addEventListener('blur',blur);button.addEventListener('click',click);
 return {dispose(){if(disposed)return;cancel();disposed=true;form.removeEventListener('input',input);form.removeEventListener('change',change);form.removeEventListener('submit',submit,true);postal.removeEventListener('blur',blur);button.removeEventListener('click',click);}};
}
