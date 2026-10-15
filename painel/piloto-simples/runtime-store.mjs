import * as local from './store.mjs';
let provider=local;
export function configureRuntimeStore(next){if(provider!==local)throw Error('Armazenamento já configurado.');if(!next?.load||!next?.commit||!next?.getPhoto)throw Error('Armazenamento incompleto.');provider=next;}
export const isConnected=()=>provider!==local;
export const load=(...args)=>provider.load(...args);
export const commit=(...args)=>provider.commit(...args);
export const getPhoto=(...args)=>provider.getPhoto(...args);
export const readSnapshot=(...args)=>provider.readSnapshot(...args);
export const restoreSnapshot=(...args)=>provider.restoreSnapshot(...args);
