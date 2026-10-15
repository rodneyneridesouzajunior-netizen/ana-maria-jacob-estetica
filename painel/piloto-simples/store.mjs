import {seed} from './domain.mjs';
import {ensureOperations} from './operations-domain.mjs';
import {normalizeClinicState} from './clinic-domain.mjs';
import {ensureFinance} from './finance-domain.mjs';
import {ensureDocuments} from './documents-domain.mjs';
export function normalizeWorkspace(value){ensureOperations(value);normalizeClinicState(value);ensureFinance(value);ensureDocuments(value);for(const key of ['comparisons','auditLog']){value[key]??=[];if(!Array.isArray(value[key]))throw Error('Coleção local incompatível: '+key);}return value;}
const NAME='amj-piloto-local-20261015';
let db,connecting;
export function connect() {
  if(db)return Promise.resolve(db);if(connecting)return connecting;
  connecting=new Promise((resolve,reject)=>{
    const r=indexedDB.open(NAME,1);
    r.onupgradeneeded=()=>{r.result.createObjectStore('state');r.result.createObjectStore('photos');};
    r.onsuccess=()=>{const opened=r.result;db=opened;opened.onversionchange=()=>{opened.close();if(db===opened)db=undefined;};resolve(opened);};
    r.onerror=()=>reject(Error('O navegador não permitiu abrir o armazenamento local.'));
    r.onblocked=()=>reject(Error('Feche outra aba do piloto para continuar.'));
  });return connecting.finally(()=>{connecting=undefined;});
}
function immutableRecords(old,value,photo){
 for(const previous of old.visits.filter(v=>v.status==='concluido'||v.lockedAt)){const current=value.visits.find(v=>v.id===previous.id);const core=v=>{if(!v)return null;const {addenda,...rest}=v;return rest;};if(JSON.stringify(core(previous))!==JSON.stringify(core(current)))throw Error('Consulta concluída não pode ser reescrita. Use adendo.');const a=previous.addenda||[],b=current.addenda||[];if(!Array.isArray(b)||b.length<a.length||a.some((entry,i)=>JSON.stringify(entry)!==JSON.stringify(b[i])))throw Error('Adendos anteriores precisam ser preservados.');}
 for(const previous of old.documentResponses||[]){if(previous.status!=='assinado_demo'&&!previous.signature)continue;const current=(value.documentResponses||[]).find(d=>d.id===previous.id);if(JSON.stringify(current)!==JSON.stringify(previous))throw Error('Documento assinado de demonstração não pode ser reescrito nem removido.');}
 if(photo){if(!photo.id||!(photo.original instanceof Blob)||!(photo.preview instanceof Blob))throw Error('Fotografia incompleta.');if(old.visits.some(v=>(v.photos||[]).some(p=>p.id===photo.id)))throw Error('O original da fotografia já registrada não pode ser sobrescrito.');const owners=value.visits.filter(v=>(v.photos||[]).some(p=>p.id===photo.id));if(owners.length!==1||owners[0].status==='concluido'||owners[0].lockedAt)throw Error('A nova fotografia precisa pertencer a uma consulta em aberto.');}
}
export async function load() {
  if(!db) await connect();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('state','readwrite'),store=tx.objectStore('state'),r=store.get('workspace');let value;
    r.onsuccess=()=>{try{value=normalizeWorkspace(r.result||seed());if(!r.result)store.put(value,'workspace');}catch(error){tx.abort();reject(error);}};
    tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Não foi possível abrir o piloto.'));
  });
}
export function commit(expectedRevision, update, photo) {
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(['state','photos'],'readwrite'),store=tx.objectStore('state'),r=store.get('workspace');let value,reason;
    r.onsuccess=()=>{
      try {
        const old=r.result;
        if(old.revision!==expectedRevision) throw Error('Outra aba alterou o piloto. Recarregue a página antes de continuar.');
        value=normalizeWorkspace(structuredClone(old));const result=update(value);if(result?.then)throw Error('A alteração precisa ser transacional e síncrona.');
        immutableRecords(old,value,photo);
        value.revision=old.revision+1;value.auditLog.push({id:crypto.randomUUID(),at:new Date().toISOString(),action:'Alteração local confirmada',revision:value.revision});
        store.put(value,'workspace');if(photo)tx.objectStore('photos').add(photo,photo.id);
      }catch(e){reason=e;tx.abort();}
    };
    tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(reason||tx.error);tx.onabort=()=>reject(reason||tx.error||Error('O registro não foi salvo.'));
  });
}
export async function readSnapshot(){if(!db)await connect();return new Promise((resolve,reject)=>{const tx=db.transaction(['state','photos'],'readonly');let state,photos;const r=tx.objectStore('state').get('workspace'),p=tx.objectStore('photos').getAll();r.onsuccess=()=>state=r.result;p.onsuccess=()=>photos=p.result;tx.oncomplete=()=>resolve({state:normalizeWorkspace(state||seed()),photos:photos||[]});tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Não foi possível preparar o backup.'));});}
export async function restoreSnapshot(expectedRevision,verified){if(!db)await connect();return new Promise((resolve,reject)=>{const tx=db.transaction(['state','photos'],'readwrite'),store=tx.objectStore('state'),r=store.get('workspace');let reason,value;r.onsuccess=()=>{try{if(r.result.revision!==expectedRevision)throw Error('Outra aba alterou os dados. Reabra a restauração.');value=normalizeWorkspace(structuredClone(verified.state));value.revision=expectedRevision+1;value.auditLog.push({id:crypto.randomUUID(),at:new Date().toISOString(),action:'Backup local restaurado',revision:value.revision});store.put(value,'workspace');const photos=tx.objectStore('photos');photos.clear();for(const p of verified.photos)photos.put(p,p.id);}catch(error){reason=error;tx.abort();}};tx.oncomplete=()=>resolve(value);tx.onabort=tx.onerror=()=>reject(reason||tx.error||Error('A restauração não foi gravada.'));});}
export function getPhoto(id) {
  return new Promise((resolve,reject)=>{const r=db.transaction('photos').objectStore('photos').get(id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
}
