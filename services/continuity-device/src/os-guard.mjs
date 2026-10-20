import {canonical,exactObject,hash,identifier,integer,parseCanonical} from '../../continuity-sync/src/crypto.mjs';
import {validateCoordinatorIdentity} from '../../continuity-sync/src/identity.mjs';
import {assertDeviceNamespace} from './device-lock.mjs';
import {originalCredentialChannel} from './os-backend.mjs';

const guards=new WeakMap(),unavailable=()=>new Error('os_guard_unavailable');
function copy(value){return parseCanonical(Buffer.from(canonical(value)));}
function head(value){exactObject(value,['identityHash','sequence','hash']);integer(value.sequence);for(const key of ['identityHash','hash'])if(!/^[a-f0-9]{64}$/.test(value[key]))throw unavailable();return copy(value);}
export function deviceOsAccountId(identity,deviceId){
 const verified=validateCoordinatorIdentity(identity).identity;identifier(deviceId);
 return hash(['xiaok/context-sync/device-os-state/v1',verified.rootKeyId,verified.syncGroupId,deviceId]);
}
class OsOutboxGuard{
 #assertOwner;#channel;#identityHash;#deviceId;#bytes;#poisoned=false;#testOnly;
 constructor({lease,backend,identity,deviceId},testOnly){
  identity=validateCoordinatorIdentity(identity).identity;identifier(deviceId);this.#identityHash=hash(identity);this.#deviceId=deviceId;this.#testOnly=testOnly;
  this.#assertOwner=()=>assertDeviceNamespace(lease,{testOnly,identityHash:this.#identityHash,deviceId,exactMode:testOnly?'test':'self-hosted'});
  this.#assertOwner();this.#channel=originalCredentialChannel(backend,{testOnly,accountId:deviceOsAccountId(identity,deviceId)});
  this.#read();guards.set(this,{testOnly,identityHash:this.#identityHash,deviceId,read:()=>this.#read(),advance:(before,after)=>this.#advance(before,after)});Object.freeze(this);
 }
 get kind(){return this.#testOnly?'test-only':'os-protected';}
 #read(){
  let raw;
  try{
   if(this.#poisoned)throw unavailable();this.#assertOwner();raw=this.#channel.read();
   if(!(raw instanceof Uint8Array)||raw.byteLength>2048)throw unavailable();
   const record=parseCanonical(raw);exactObject(record,['schemaVersion','identityHash','deviceId','cryptoHead']);
   if(record.schemaVersion!==1||record.identityHash!==this.#identityHash||record.deviceId!==this.#deviceId)throw unavailable();
   const result=head(record.cryptoHead);if(this.#bytes!==undefined&&!Buffer.from(raw).equals(this.#bytes))throw unavailable();
   this.#assertOwner();this.#bytes??=Buffer.from(raw);return result;
  }catch{this.#poisoned=true;throw unavailable();}finally{raw?.fill(0);}
 }
 #advance(before,after){
  let next;
  try{
   before=head(before);after=head(after);const current=this.#read();
   if(canonical(current)!==canonical(before)||before.identityHash!==after.identityHash||after.sequence!==before.sequence+1)throw unavailable();
   next=Buffer.from(canonical({schemaVersion:1,identityHash:this.#identityHash,deviceId:this.#deviceId,cryptoHead:after}));
   this.#assertOwner();this.#channel.compareReplace(this.#bytes,next);this.#assertOwner();
   this.#bytes.fill(0);this.#bytes=Buffer.from(next);this.#read();
  }catch{this.#poisoned=true;throw unavailable();}finally{next?.fill(0);}
 }
 read(){return this.#read();}
 advance(before,after){return this.#advance(before,after);}
 close(){this.#poisoned=true;this.#bytes?.fill(0);}
}
/** Reads existing OS state only. Missing items are never provisioned or restored from body data. */
export function openOsOutboxGuard(options){try{return new OsOutboxGuard(options,false);}catch{throw unavailable();}}
/** Explicit signed-test lease/backend only. Never returns the production brand. */
export function openTestOsOutboxGuard(options){try{return new OsOutboxGuard(options,true);}catch{throw unavailable();}}
export function originalOsOutboxGuard(guard,{identityHash}={}){
 const original=guards.get(guard);if(!original||original.testOnly||original.identityHash!==identityHash)throw unavailable();
 original.read();return Object.freeze({kind:'os-protected',identityHash:original.identityHash,deviceId:original.deviceId,read:original.read,advance:original.advance});
}
