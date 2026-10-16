// Store only the SDK session, never passwords, clinical payloads or the action PIN.
// The server remains authoritative for expiry, MFA and account permissions.
const AUTH='amj-auth-v1', EXIT='amj_auth_local_signed_out';
const KEYS=[AUTH,AUTH+'-user',AUTH+'-code-verifier','amj_auth_requires_password','amj_auth_pending_factor'];
const MIGRATED='amj_auth_shared_migrated_v1';
const isAuth=key=>key===AUTH||key.startsWith(AUTH+'-');
function userId(raw){try{return JSON.parse(raw)?.user?.id||null;}catch{return null;}}

export function createClinicAuthStorage(win=globalThis){
  const legacy=win.sessionStorage;
  let storage;
  try{storage=win.localStorage;storage.setItem('amj_shared_probe','1');storage.removeItem('amj_shared_probe');}
  catch{storage=legacy;}
  const persistent=storage!==legacy;
  if(persistent&&legacy.getItem(MIGRATED)!=='1'){
    if(storage.getItem(EXIT)!=='1'&&!storage.getItem(AUTH)&&legacy.getItem(EXIT)!=='1'){
      for(const key of KEYS){const value=legacy.getItem(key);if(value!==null)storage.setItem(key,value);}
    }
    // Never resurrect a leftover tab session after a later explicit sign-out.
    for(const key of [...KEYS,EXIT])legacy.removeItem(key);
    legacy.setItem(MIGRATED,'1');
  }
  let closed=storage.getItem(EXIT)==='1';
  const listeners=new Set();
  const close=()=>{if(closed)return;closed=true;for(const fn of listeners)fn();};
  const changed=event=>{
    if(event.storageArea&&event.storageArea!==storage)return;
    if(event.key===null||event.key===EXIT&&event.newValue==='1'||event.key===AUTH&&(!event.newValue||(userId(event.oldValue)&&userId(event.oldValue)!==userId(event.newValue))))close();
  };
  if(persistent)win.addEventListener('storage',changed);
  return {
    persistent,
    get closed(){return closed;},
    getItem(key){return closed&&isAuth(key)?null:storage.getItem(key);},
    setItem(key,value){if(isAuth(key)&&(closed||storage.getItem(EXIT)==='1'))return;storage.setItem(key,value);if(key===EXIT&&value==='1')close();},
    removeItem(key){storage.removeItem(key);if(key===EXIT)closed=false;},
    subscribeClosed(fn){listeners.add(fn);return()=>listeners.delete(fn);},
    dispose(){if(persistent)win.removeEventListener('storage',changed);listeners.clear();},
  };
}

export function bindClinicAuthStorage(controller,storage){
  const originalDestroy=controller.destroy.bind(controller);
  const originalSession=controller.getSession.bind(controller);
  const originalNext=controller.getNextStep.bind(controller);
  controller.subscribeSessionClosed=fn=>storage.subscribeClosed(fn);
  controller.getSession=async()=>{if(storage.closed)return null;const result=await originalSession();return storage.closed?null:result;};
  controller.getNextStep=async()=>{if(storage.closed)return{step:'login',session:null};const result=await originalNext();return storage.closed?{step:'login',session:null}:result;};
  controller.destroy=()=>{storage.dispose();originalDestroy();};
  return controller;
}
