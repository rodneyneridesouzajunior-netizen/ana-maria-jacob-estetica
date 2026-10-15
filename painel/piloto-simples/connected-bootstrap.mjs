import {loadClinicAuth} from './integration/auth-loader.mjs';
import {createSessionBridge} from './integration/session.mjs';
import {errorMessage} from './integration/errors.mjs';
import {createCloudStore} from './cloud-store.mjs';
import {configureRuntimeStore} from './runtime-store.mjs';
import {createClinicalBridgeService} from './clinical-bridge-service.mjs';
import {configureClinicalBridge,clearClinicalBridge,getClinicalBridge} from './clinical-bridge-runtime.mjs';
const shell=document.querySelector('.app'),content=document.getElementById('content');
const gate=document.createElement('section');gate.className='connected-gate';gate.setAttribute('aria-label','Acesso ao aplicativo da clínica');
document.body.prepend(gate);shell.hidden=true;
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let auth,bridge,store,started=false,busy=false;
const message=text=>{const el=gate.querySelector('[data-login-status]');if(el)el.textContent=text;};
const base=body=>`<div class="connected-card"><img src="assets/logo.png" alt="Ana Maria Jacob — Estética Avançada"><p class="eyebrow">ÁREA PRIVADA</p>${body}<p data-login-status role="status" aria-live="polite"></p><p class="small-label">Versão em validação clínica. Utilize dados fictícios enquanto os fluxos são conferidos.</p><a href="https://anamariajacob.com.br/">Site da clínica</a> · <a href="https://anamariajacob.com.br/painel/">Documentos oficiais</a></div>`;
function invalidate(){clearClinicalBridge();window.dispatchEvent(new Event('amj:connection-invalidated'));shell.hidden=true;gate.hidden=false;gate.innerHTML=base('<h1>Acesso encerrado</h1><p>Os dados privados foram retirados desta tela.</p><button class="primary" data-login-reload>Entrar novamente</button>');}
async function ready(){
  if(started){location.reload();return;}
  bridge=createSessionBridge(auth);
  store=createCloudStore({session:bridge,onInvalidated:invalidate,onStatus:state=>{
    const status=document.querySelector('[data-cloud-status]');if(status){status.textContent=state.message;status.dataset.kind=state.kind;}
    document.querySelector('[data-cloud-resolve]')?.toggleAttribute('hidden',!state.pending||state.canDiscardPending);
    document.querySelector('[data-cloud-conflict]')?.toggleAttribute('hidden',!state.canDiscardPending);
  }});
  try{await store.load();}catch(error){store.dispose();bridge.destroy();gate.innerHTML=base('<h1>Conexão ainda não confirmada</h1><p>'+escape(error.message)+'</p><button class="primary" data-login-reload>Conferir conexão novamente</button>');return;}
  configureClinicalBridge(createClinicalBridgeService({session:bridge}));
  configureRuntimeStore(store);started=true;gate.hidden=true;shell.hidden=false;
  await import('./app.mjs');
}
async function show(){
  const next=await auth.getNextStep();
  if(next.step==='ready'){await ready();return;}
  if(next.step==='challenge')gate.innerHTML=base('<h1>Confirme o autenticador</h1><form data-login="mfa"><label class="field">Código de 6 dígitos<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label><button class="primary" type="submit">Confirmar acesso</button><button class="subtle" type="button" data-login-exit>Trocar conta</button></form>');
  else if(next.step==='enroll'||next.step==='password')gate.innerHTML=base('<h1>Conclua seu acesso</h1><p>Defina sua senha ou configure o autenticador no painel oficial e depois volte a esta página.</p><a class="primary" href="https://anamariajacob.com.br/painel/">Abrir acesso oficial</a>');
  else gate.innerHTML=base('<h1>Entrar na clínica</h1><p>Use a mesma conta individual do painel atual.</p><form data-login="password"><label class="field">E-mail da clínica<input name="email" type="email" autocomplete="username" required></label><label class="field">Senha<input name="password" type="password" autocomplete="current-password" required></label><button class="primary" type="submit">Entrar com segurança</button></form>');
}
gate.addEventListener('submit',async event=>{const form=event.target.closest('[data-login]');if(!form)return;event.preventDefault();if(busy)return;busy=true;const values=new FormData(form);form.inert=true;message('Conferindo o acesso…');try{if(form.dataset.login==='mfa')await auth.verifyChallenge(String(values.get('code')));else await auth.signIn(String(values.get('email')),String(values.get('password')));form.reset();await show();}catch(error){const password=form.querySelector('[name="password"]');if(password)password.value='';message(errorMessage(error));}finally{busy=false;form.inert=false;}});
gate.addEventListener('click',async event=>{if(event.target.closest('[data-login-reload]'))location.reload();if(event.target.closest('[data-login-exit]')&&!busy){await auth.signOut();await show();}});
document.querySelector('[data-cloud-exit]')?.addEventListener('click',async()=>{const originalService=getClinicalBridge(),pending=originalService?.getPendingLink?.();if(store?.isBusy()||originalService?.isLinkBusy?.()||pending&&!pending.rejected){document.querySelector('[data-cloud-status]').textContent='Confira a gravação pendente antes de sair da conta.';return;}if(!confirm('Sair da conta e retirar os dados desta tela? Alterações não salvas serão descartadas.'))return;try{await bridge.signOut();}catch{invalidate();}});
document.querySelector('[data-cloud-resolve]')?.addEventListener('click',async()=>{try{await store.resolvePending();window.dispatchEvent(new Event('amj:cloud-refresh'));}catch(error){document.querySelector('[data-cloud-status]').textContent=error.message;}});
document.querySelector('[data-cloud-refresh]')?.addEventListener('click',()=>window.dispatchEvent(new Event('amj:cloud-refresh')));
document.querySelector('[data-cloud-conflict]')?.addEventListener('click',()=>window.dispatchEvent(new CustomEvent('amj:cloud-reload-request',{detail:{refresh:()=>store.refreshAfterConflict()}})));
gate.innerHTML=base('<h1>Preparando acesso seguro…</h1>');
try{auth=await loadClinicAuth();await auth.initialize();await show();}catch(error){gate.innerHTML=base('<h1>Não foi possível iniciar o acesso</h1><p>'+escape(errorMessage(error))+'</p><button class="primary" data-login-reload>Tentar novamente</button>');}
addEventListener('pagehide',()=>{clearClinicalBridge();store?.dispose();bridge?.destroy();auth?.destroy();},{once:true});
addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
