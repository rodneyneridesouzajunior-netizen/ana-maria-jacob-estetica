import test from 'node:test';
import assert from 'node:assert/strict';
import {createClinicAuthStorage,bindClinicAuthStorage} from '../auth-storage.mjs';
const AUTH='amj-auth-v1',EXIT='amj_auth_local_signed_out';
function memory(){const data=new Map();return{getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,String(value)),removeItem:key=>data.delete(key)};}
function windowFor(local=memory(),session=memory()){const listeners=new Set();return{localStorage:local,sessionStorage:session,addEventListener:(_,fn)=>listeners.add(fn),removeEventListener:(_,fn)=>listeners.delete(fn),emit:event=>{for(const fn of listeners)fn({storageArea:local,...event});},count:()=>listeners.size};}
test('existing tab session migrates once; new tabs share it without storing the password',()=>{
  const local=memory(),w=windowFor(local);w.sessionStorage.setItem(AUTH,'fictional-sdk-session');w.sessionStorage.setItem('password','not-migrated');
  const a=createClinicAuthStorage(w),b=createClinicAuthStorage(windowFor(local));
  assert.equal(a.persistent,true);assert.equal(b.getItem(AUTH),'fictional-sdk-session');assert.equal(local.getItem('password'),null);assert.equal(w.sessionStorage.getItem(AUTH),null);
  a.setItem(EXIT,'1');a.removeItem(AUTH);a.dispose();b.dispose();
  w.sessionStorage.setItem(AUTH,'stale-tab');const reopened=createClinicAuthStorage(w);assert.equal(reopened.getItem(AUTH),null);reopened.dispose();
});
test('another tab sign-out blocks delayed token refresh even after a different tab signs in again',()=>{
  const w=windowFor(),storage=createClinicAuthStorage(w);let closed=0;storage.subscribeClosed(()=>closed++);
  w.localStorage.setItem(EXIT,'1');w.emit({key:EXIT,newValue:'1'});assert.equal(closed,1);
  w.localStorage.removeItem(EXIT);storage.setItem(AUTH,'late-refresh');assert.equal(w.localStorage.getItem(AUTH),null);
  storage.removeItem(EXIT);storage.setItem(AUTH,'explicit-login');assert.equal(storage.getItem(AUTH),'explicit-login');
  storage.dispose();assert.equal(w.count(),0);
});
test('same-user refresh keeps session; identity switch closes current private context',()=>{
  const w=windowFor(),storage=createClinicAuthStorage(w),raw=id=>JSON.stringify({user:{id}});let count=0;storage.subscribeClosed(()=>count++);
  w.emit({key:AUTH,oldValue:raw('a'),newValue:raw('a')});assert.equal(count,0);
  w.emit({key:AUTH,oldValue:raw('a'),newValue:raw('b')});assert.equal(count,1);assert.equal(storage.closed,true);storage.dispose();
});
test('in-flight session checks cannot return access after cross-tab logout',async()=>{
  const w=windowFor(),storage=createClinicAuthStorage(w);let resolve;
  const auth=bindClinicAuthStorage({getSession:()=>new Promise(r=>resolve=r),getNextStep:async()=>({step:'ready'}),destroy(){}},storage);
  const result=auth.getSession();w.emit({key:EXIT,newValue:'1'});resolve({user:{id:'test'}});assert.equal(await result,null);assert.deepEqual(await auth.getNextStep(),{step:'login',session:null});auth.destroy();
});
test('browser denying persistent storage retains tab-based login instead of breaking access',()=>{
  const w=windowFor();Object.defineProperty(w,'localStorage',{get(){throw Error('denied');}});const storage=createClinicAuthStorage(w);assert.equal(storage.persistent,false);storage.setItem(AUTH,'fixture');assert.equal(storage.getItem(AUTH),'fixture');storage.dispose();
});
