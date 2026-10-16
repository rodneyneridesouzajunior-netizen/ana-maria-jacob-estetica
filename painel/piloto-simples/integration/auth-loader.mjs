import {PUBLIC_BACKEND} from './public-backend.mjs';
import {createClinicAuthStorage,bindClinicAuthStorage} from './auth-storage.mjs';
let scripts;
const loadScript=url=>new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=url.href;script.onload=resolve;script.onerror=()=>{script.remove();reject(Error('Não foi possível carregar o acesso seguro.'));};document.head.append(script);});
export async function loadClinicAuth(){
  scripts??=(async()=>{if(!globalThis.supabase?.createClient)await loadScript(new URL('./vendor/supabase-js-2.112.3.min.js',import.meta.url));if(!globalThis.AMJAuth?.createController)await loadScript(new URL('./vendor/auth-mfa.js',import.meta.url));})().catch(error=>{scripts=null;throw error;});
  await scripts;
  const storage=createClinicAuthStorage();
  try{return bindClinicAuthStorage(globalThis.AMJAuth.createController({supabaseGlobal:globalThis.supabase,storage,windowLike:globalThis,...PUBLIC_BACKEND}),storage);}catch(error){storage.dispose();throw error;}
}
