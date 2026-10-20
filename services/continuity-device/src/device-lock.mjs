import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {AsyncLocalStorage} from 'node:async_hooks';
import {types} from 'node:util';
import {hash,identifier} from '../../continuity-sync/src/crypto.mjs';
import {validateCoordinatorIdentity} from '../../continuity-sync/src/identity.mjs';
import {privateDirectory,privateFile,syncDirectory} from '../../continuity-sync/src/private-files.mjs';
const unavailable=()=>new Error('device_owner_unavailable');
const leases=new WeakMap();
const NativePromise=Promise,PromisePrototype=Promise.prototype,intrinsicThen=Promise.prototype.then;
const species=Object.getOwnPropertyDescriptor(NativePromise,Symbol.species)?.get;
const ObjectPrototype=Object.prototype,ArrayPrototype=Array.prototype;
function supportedPromise(value){
 return types.isPromise(value)&&!types.isProxy(value)&&Object.getPrototypeOf(value)===PromisePrototype
  &&!Object.getOwnPropertyDescriptor(value,'constructor')&&!Object.getOwnPropertyDescriptor(value,'then')
  &&Object.getOwnPropertyDescriptor(PromisePrototype,'constructor')?.value===NativePromise
  &&Object.getOwnPropertyDescriptor(PromisePrototype,'then')?.value===intrinsicThen
  &&Object.getOwnPropertyDescriptor(NativePromise,Symbol.species)?.get===species;
}
function supportedData(value,seen=new Set(),depth=0){
 if(value===null||value===undefined||typeof value==='string'||typeof value==='boolean')return true;
 if(typeof value==='number')return Number.isFinite(value);
 if(typeof value!=='object'||types.isProxy(value)||depth>32||seen.size>10000||seen.has(value))return false;
 const prototype=Object.getPrototypeOf(value);
 if(prototype!==null&&prototype!==ObjectPrototype&&prototype!==ArrayPrototype)return false;
 if(Object.getPrototypeOf(ObjectPrototype)!==null||Object.getOwnPropertyDescriptor(ObjectPrototype,'then')||prototype===ArrayPrototype&&(Object.getPrototypeOf(ArrayPrototype)!==ObjectPrototype||Object.getOwnPropertyDescriptor(ArrayPrototype,'then')))return false;
 seen.add(value);const descriptors=Object.getOwnPropertyDescriptors(value);
 if(Object.getOwnPropertySymbols(value).length||Object.hasOwn(descriptors,'then'))return false;
 return Object.values(descriptors).every(d=>'value' in d&&supportedData(d.value,seen,depth+1));
}
/** Pure shape validation, not an owner/receipt. Owners call this before resolving
 * their original job so a rejected payload never becomes an uncertain drain. */
export function assertSupportedDeviceJobData(value){if(!supportedData(value))throw unavailable();}
/** Namespace exclusion only. Never an OS guard, registration or effect receipt. */
class DeviceNamespaceLease{
 #db;#registry;#filename;#directoryIdentity;#fileIdentity;#mode;
 #closed=false;#poisoned=false;#pending=new Set();#completion;#resolveClosed;#rejectClosed;#operation=new AsyncLocalStorage();
 constructor(registry,filename,mode,binding){
  this.#registry=registry;this.#filename=filename;this.#mode=mode;
  try{
   this.#directoryIdentity=fs.lstatSync(registry);this.#fileIdentity=fs.lstatSync(privateFile(filename));
   this.#db=new DatabaseSync(filename,{timeout:0});this.#db.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE');this.#assertCurrent();leases.set(this,{mode,...binding,assert:()=>this.#assertCurrent()});Object.freeze(this);
  }catch{this.#db?.close();throw unavailable();}
 }
 get kind(){return this.#mode==='test'?'test-only-device-namespace':'device-namespace-lease';}
 #assertCurrent(){
  try{
   if(this.#closed||this.#poisoned||!this.#db?.isOpen||this.#db.isTransaction!==true)throw unavailable();
   const directory=fs.lstatSync(this.#registry);
   if(!directory.isDirectory()||directory.isSymbolicLink()||directory.uid!==process.getuid()||(directory.mode&0o077)!==0)throw unavailable();
   privateFile(this.#filename);const file=fs.lstatSync(this.#filename);
   if(directory.dev!==this.#directoryIdentity.dev||directory.ino!==this.#directoryIdentity.ino||file.dev!==this.#fileIdentity.dev||file.ino!==this.#fileIdentity.ino)throw unavailable();
  }catch{this.#poisoned=true;throw unavailable();}
 }
 #releaseClosed(){
  if(!this.#closed||this.#pending.size||!this.#db)return;
  try{this.#db.close();this.#db=undefined;this.#resolveClosed();}catch{this.#poisoned=true;this.#rejectClosed(unavailable());}
 }
 run(action){
  try{this.#assertCurrent();if(typeof action!=='function')throw unavailable();}catch{return new NativePromise((_resolve,reject)=>reject(unavailable()));}
  // Install the original obligation before any synchronous action can reenter close.
  const obligation=Symbol();this.#pending.add(obligation);
  return new NativePromise((resolve,reject)=>this.#operation.run(this,()=>{
   const finish=()=>{this.#pending.delete(obligation);this.#releaseClosed();};
   const failed=()=>{this.#poisoned=true;reject(unavailable());finish();};
   const uncertain=()=>{this.#poisoned=true;reject(unavailable());};
   const succeeded=value=>{let supported=false;try{supported=supportedData(value);}catch{}if(!supported){uncertain();return;}try{this.#assertCurrent();resolve(value);}catch{reject(unavailable());}finally{finish();}};
   let observing=false;try{
    const raw=action();
    if(types.isPromise(raw)){if(!supportedPromise(raw)){uncertain();return;}observing=true;intrinsicThen.call(raw,succeeded,failed);}
    else if(supportedData(raw))succeeded(raw);else uncertain();
   }catch{observing?uncertain():failed();}
  }));
 }
 close(){
  if(this.#closed)return;this.#closed=true;
  this.#completion=new NativePromise((resolve,reject)=>{this.#resolveClosed=resolve;this.#rejectClosed=reject;});this.#releaseClosed();
 }
 drainClosed(){
  if(!this.#closed||this.#operation.getStore()===this)return new NativePromise((_resolve,reject)=>reject(unavailable()));
  return this.#completion;
 }
}
/** Fixed main/device-worker boundary, never callable through renderer or model IPC. */
export function claimDeviceNamespace({identity,deviceId,testRegistryDir}={}){
 try{
  const verified=validateCoordinatorIdentity(identity).identity;identifier(deviceId);
  const mode=verified.certificate.body.deploymentMode;
  if(process.platform==='win32'||typeof process.getuid!=='function'||mode==='self-hosted'&&testRegistryDir!==undefined||mode==='test'&&(typeof testRegistryDir!=='string'||!testRegistryDir))throw unavailable();
  // The signed test mode is kept in the private lease brand; it never qualifies real OS access.
  const registry=privateDirectory(mode==='test'?testRegistryDir:path.join(os.userInfo().homedir,'.xiaok-continuity-devices-v1'));
  const key=hash(['xiaok/context-sync/device-owner/v1',verified.rootKeyId,verified.syncGroupId,deviceId]),filename=path.join(registry,key+'.sqlite');
  try{privateFile(filename,{create:true});syncDirectory(registry);}catch(error){if(error.code!=='EEXIST')throw error;privateFile(filename);}
  return new DeviceNamespaceLease(registry,filename,mode,{identityHash:hash(verified),deviceId});
 }catch{throw unavailable();}
}

/** Exact original lease check for future fixed OS owners; a kind string is never proof. */
export function assertDeviceNamespace(lease,{testOnly=false,identityHash,deviceId,exactMode}={}){
 const receipt=leases.get(lease);if(!receipt||receipt.mode==='test'&&!testOnly)throw unavailable();
 if(exactMode!==undefined&&receipt.mode!==exactMode)throw unavailable();
 if(identityHash!==undefined&&receipt.identityHash!==identityHash||deviceId!==undefined&&receipt.deviceId!==deviceId)throw unavailable();
 try{receipt.assert();}catch{throw unavailable();}
}
