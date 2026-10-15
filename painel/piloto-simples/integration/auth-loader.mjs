import {PUBLIC_BACKEND} from './public-backend.mjs';
let scripts;
const loadScript=url=>new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=url.href;script.onload=resolve;script.onerror=()=>{script.remove();reject(Error('Não foi possível carregar o acesso seguro.'));};document.head.append(script);});
export async function loadClinicAuth(){
  scripts??=(async()=>{if(!globalThis.supabase?.createClient)await loadScript(new URL('./vendor/supabase-js-2.112.3.min.js',import.meta.url));if(!globalThis.AMJAuth?.createController)await loadScript(new URL('./vendor/auth-mfa.js',import.meta.url));})().catch(error=>{scripts=null;throw error;});
  await scripts;
  return globalThis.AMJAuth.createController({supabaseGlobal:globalThis.supabase,storage:globalThis.sessionStorage,windowLike:globalThis,...PUBLIC_BACKEND});
}
