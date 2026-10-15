// Opt-in presentation policy; authorization remains the responsibility of the host.
export function viewerPolicy(search=''){
  const mode=new URLSearchParams(search).get('mode'),local=['local-pilot','connected-app'].includes(mode);
  return {local,appearanceOnly:local,storage:mode==='connected-app'?'clinic-server':local?'local-browser':'legacy-private'};
}
export function assertViewerMode(mode,policy){
  if(!['appearance','anatomy'].includes(mode)||policy.appearanceOnly&&mode!=='appearance')throw Error('Este modo local usa apenas o modelo externo genérico.');
  return mode;
}
export function assertViewerStudy(study,policy){
  if(policy.appearanceOnly&&study?.document?.points?.some(p=>p.mode!=='appearance'))throw Error('O estudo contém camadas que não estão disponíveis neste modo local.');
  return study;
}
