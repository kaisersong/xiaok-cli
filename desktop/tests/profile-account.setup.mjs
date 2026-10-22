// Isolate actual Node filesystem home before setup mocks load production.
import {afterAll,inject} from 'vitest';
import {mkdtempSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {createRequire,syncBuiltinESMExports} from 'node:module';
import {assertProfileAccountWorkerReleased} from '../../tests/support/profile-account-ownership.mjs';
const ownDescriptor=Object.getOwnPropertyDescriptor,define=Object.defineProperty;
const own=Object.hasOwn,apply=Reflect.apply;
const descriptorFields=['value','writable','get','set','enumerable','configurable'];
function sameDescriptor(a,b){
 if(!a||!b)return a===b;
 for(let i=0;i<descriptorFields.length;i++){const key=descriptorFields[i];if(own(a,key)!==own(b,key)||own(a,key)&&a[key]!==b[key])return false;}
 return true;
}
/** Test infrastructure only; preserve every native account fact except home. */
export function installTestAccountHome(os,accountHome,registerCleanup,synchronize=syncBuiltinESMExports){
 const originalUserInfo=os.userInfo;
 const userInfo=options=>{
  const info=apply(originalUserInfo,os,[options]);
  return {...info,homedir:Buffer.isBuffer(info.homedir)?Buffer.from(accountHome):accountHome};
 };
 const wrappers={userInfo,homedir:()=>accountHome};
 const entries=['userInfo','homedir'].map(key=>{
  const nativeDescriptor=ownDescriptor(os,key);
  if(!nativeDescriptor||!own(nativeDescriptor,'value')||typeof nativeDescriptor.value!=='function')throw Error('test_profile_account_native_descriptor');
  const original={__proto__:null,...nativeDescriptor};
  return {key,original,installed:{__proto__:null,...original,value:wrappers[key]},active:false};
 });
 const restore=()=>{
  const errors=[];
  for(let i=0;i<entries.length;i++){
   const entry=entries[i];
   if(!entry.active)continue;
   try{
    if(!sameDescriptor(ownDescriptor(os,entry.key),entry.installed))throw Error('test_profile_account_restoration_conflict:'+entry.key);
    define(os,entry.key,entry.original);
    entry.active=false;
   }catch(error){errors.push(error);}
  }
  try{synchronize();}catch(error){errors.push(error);}
  if(errors.length)throw new AggregateError(errors,'test_profile_account_restore_failed');
 };
 // Register before the first mutation: hook-registration failure cannot leak.
 registerCleanup(restore);
 try{
  for(let i=0;i<entries.length;i++){const entry=entries[i];define(os,entry.key,entry.installed);entry.active=true;}
  synchronize();
 }catch(error){
  try{restore();}catch(cleanupError){throw new AggregateError([error,cleanupError],'test_profile_account_install_failed');}
  throw error;
 }
 return restore;
}
const root=inject('profileTestAccountRoot');
if(typeof root!=='string'||!root)throw Error('test_profile_account_root_required');
const ownership=inject('profileTestAccountOwnership');
assertProfileAccountWorkerReleased(ownership);
const accountHome=realpathSync(mkdtempSync(join(root,'account-')));
const require=createRequire(import.meta.url),os=require('node:os');
installTestAccountHome(os,accountHome,restore=>afterAll(()=>{
 // Keep the account wrapper while an actual qualified callback may still read
 // it; a later file fails admission before allocating or changing its home.
 assertProfileAccountWorkerReleased(ownership);
 restore();
}));
