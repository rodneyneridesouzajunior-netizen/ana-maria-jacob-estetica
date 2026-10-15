import test from 'node:test';
import assert from 'node:assert/strict';
import {createSessionBridge} from '../session.mjs';

const USER='11111111-1111-4111-8111-111111111111';
const drain=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function fixture(t){
 t.mock.timers.enable({apis:['setTimeout','Date'],now:100000});
 let callback,inCallback=false,aal='aal2',nextDeferred=null,reads=0;
 let session={access_token:'fictional-old-token',expires_at:160,user:{id:USER}};
 const notifications=[],auth={
  getSession:async()=>session,
  async getNextStep(){assert.equal(inCallback,false,'SDK auth must not be called inside its locked auth-event callback');reads++;if(nextDeferred)return nextDeferred;return{step:session?(aal==='aal2'?'ready':'challenge'):'login',session,aal:{currentLevel:aal}};},
  signOut:async()=>{session=null;callback?.('SIGNED_OUT',null);},
  client:{auth:{onAuthStateChange(fn){callback=fn;return{data:{subscription:{unsubscribe(){callback=null;}}}};}}},
 };
 const bridge=createSessionBridge(auth,{now:()=>Date.now(),onInvalidated:reason=>notifications.push(reason)});
 t.after(()=>bridge.destroy());
 const emit=(event,next)=>{if(next!==undefined)session=next;inCallback=true;try{callback?.(event,session);}finally{inCallback=false;}};
 return{bridge,notifications,emit,reads:()=>reads,tick:async ms=>{t.mock.timers.tick(ms);await drain();},fresh:()=>({access_token:'fictional-new-token',expires_at:400,user:{id:USER}}),aal:value=>aal=value,defer(value){nextDeferred=value;}};
}

test('same-user automatic refresh revalidates outside SDK callback and replaces the old idle expiry timer',async t=>{
 const h=fixture(t),first=await h.bridge.requireReady();await h.tick(10000);h.emit('TOKEN_REFRESHED',h.fresh());await h.tick(0);
 await h.tick(50001);assert.deepEqual(h.notifications,[]);assert.ok(h.reads()>=2);
 const fresh=await h.bridge.requireReady();assert.equal(fresh.userId,first.userId);assert.equal(fresh.revision,first.revision);assert.equal(fresh.expiresAt,400);assert.equal(fresh.token,'fictional-new-token');
});

test('refresh with MFA downgrade ends access and a later refresh cannot reopen the invalidated bridge',async t=>{
 const h=fixture(t);await h.bridge.requireReady();h.aal('aal1');h.emit('TOKEN_REFRESHED',h.fresh());await h.tick(0);
 assert.deepEqual(h.notifications,['mfa_required']);await assert.rejects(h.bridge.requireReady(),{code:'session_closed'});
 h.aal('aal2');h.emit('TOKEN_REFRESHED',h.fresh());await h.tick(0);await assert.rejects(h.bridge.requireReady(),{code:'session_closed'});assert.equal(h.notifications.length,1);
});

test('refresh identity switch and password recovery invalidate immediately',async t=>{
 for(const event of ['TOKEN_REFRESHED','PASSWORD_RECOVERY']){
  const h=fixture(t);await h.bridge.requireReady();h.emit(event,{...h.fresh(),user:{id:'22222222-2222-4222-8222-222222222222'}});
  assert.deepEqual(h.notifications,[event]);await assert.rejects(h.bridge.requireReady(),{code:'session_closed'});h.bridge.destroy();t.mock.timers.reset();
 }
});

test('logout wins over an asynchronous refresh validation already in progress',async t=>{
 const h=fixture(t);await h.bridge.requireReady();let resolve;h.defer(new Promise(r=>resolve=r));h.emit('TOKEN_REFRESHED',h.fresh());await h.tick(0);
 await h.bridge.signOut();resolve({step:'ready',session:h.fresh(),aal:{currentLevel:'aal2'}});await drain();
 assert.deepEqual(h.notifications,['SIGNED_OUT']);await assert.rejects(h.bridge.requireReady(),{code:'session_closed'});
});

test('absent or expired renewal cannot extend private access and expiry is terminal for this bridge',async t=>{
 const h=fixture(t);await h.bridge.requireReady();await h.tick(60000);assert.deepEqual(h.notifications,['session_expired']);
 h.emit('TOKEN_REFRESHED',h.fresh());await h.tick(0);await assert.rejects(h.bridge.requireReady(),{code:'session_closed'});assert.equal(h.notifications.length,1);
});

test('a refresh event alone is insufficient: SDK readiness and fresh expiry must be validated',async t=>{
 const h=fixture(t);await h.bridge.requireReady();h.emit('TOKEN_REFRESHED',{...h.fresh(),expires_at:101});await h.tick(0);
 assert.deepEqual(h.notifications,['session_expired']);await assert.rejects(h.bridge.requireReady(),{code:'session_closed'});
});

test('an older readiness call resolving late cannot restore the obsolete expiry timer',async t=>{
 const h=fixture(t),first=await h.bridge.requireReady();let resolve;
 h.defer(new Promise(r=>resolve=r));const older=h.bridge.requireReady();h.defer(null);
 await h.tick(10000);h.emit('TOKEN_REFRESHED',h.fresh());await h.tick(0);
 resolve({step:'ready',session:{access_token:first.token,expires_at:first.expiresAt,user:{id:USER}},aal:{currentLevel:'aal2'}});await older;
 await h.tick(50001);assert.deepEqual(h.notifications,[]);assert.equal((await h.bridge.requireReady()).expiresAt,400);
});

test('an expired stale readiness result cannot invalidate a newer verified renewal',async t=>{
 const h=fixture(t),first=await h.bridge.requireReady();let resolve;
 h.defer(new Promise(r=>resolve=r));const older=h.bridge.requireReady();h.defer(null);
 await h.tick(10000);h.emit('TOKEN_REFRESHED',h.fresh());await h.tick(0);
 await h.tick(60000);
 resolve({step:'ready',session:{access_token:first.token,expires_at:first.expiresAt,user:{id:USER}},aal:{currentLevel:'aal2'}});
 await assert.rejects(older);assert.deepEqual(h.notifications,[]);assert.equal((await h.bridge.requireReady()).expiresAt,400);
});
