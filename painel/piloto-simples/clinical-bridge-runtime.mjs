// Authenticated service is injected after login. No private content is persisted here.
let current=null;
export function configureClinicalBridge(service){
  if(!service||typeof service.listDocuments!=='function'||typeof service.listSiteRequests!=='function')throw Error('Serviço de documentos e solicitações incompleto.');
  if(current&&current!==service)throw Error('Encerre o serviço anterior antes de trocar a sessão.');
  current=service;
}
export const getClinicalBridge=()=>current;
export function clearClinicalBridge(){const old=current;current=null;old?.dispose?.();}
