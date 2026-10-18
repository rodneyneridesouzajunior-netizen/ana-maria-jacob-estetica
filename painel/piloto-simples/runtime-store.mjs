import * as local from './store.mjs';
import {activeWorkspace,mergeActiveWorkspace} from './recycle-bin.mjs';
let provider=local;
export function configureRuntimeStore(next){if(provider!==local)throw Error('Armazenamento já configurado.');if(!next?.load||!next?.commit||!next?.getPhoto)throw Error('Armazenamento incompleto.');provider=next;}
export const isConnected=()=>provider!==local;
export const load=async(...args)=>activeWorkspace(await provider.load(...args));
export const commit=async(expected,update,photo)=>activeWorkspace(await provider.commit(expected,canonical=>{const edited=activeWorkspace(canonical);const result=update(edited);if(result?.then)throw Error('A alteração precisa ser síncrona.');mergeActiveWorkspace(canonical,edited);},photo));
export const getPhoto=(...args)=>provider.getPhoto(...args);
export const readSnapshot=(...args)=>provider.readSnapshot(...args);
export const restoreSnapshot=(...args)=>provider.restoreSnapshot(...args);

export const getClinicId=()=>provider.getClinicId?.()||null;
