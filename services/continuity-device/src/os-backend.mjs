import {createRequire} from 'node:module';
import {timingSafeEqual} from 'node:crypto';
const require=createRequire(import.meta.url),SERVICE='xiaok.continuity.device.v1',MAX_BYTES=2048;
const unavailable=()=>new Error('os_backend_unavailable');
const backends=new WeakMap();
function synchronous(value){if(value&&typeof value.then==='function'){Promise.resolve(value).catch(()=>{});throw unavailable();}return value;}
function secret(value){if(!(value instanceof Uint8Array)||value.byteLength<1||value.byteLength>MAX_BYTES)throw unavailable();return Buffer.from(value);}
function equal(a,b){return a!==null&&b!==null&&a.length===b.length&&timingSafeEqual(a,b);}
/** Native credential IO only: this is deliberately NOT an os-protected CryptoOutbox guard. */
class CredentialBackend{
 #entry;#poisoned=false;#kind;
 constructor(entry,kind,accountId){this.#entry=entry;this.#kind=kind;backends.set(this,{kind,accountId,check:()=>this.#check(),read:()=>originalRead.call(this),compareReplace:(before,after)=>originalCompareReplace.call(this,before,after)});Object.freeze(this);}
 get kind(){return this.#kind;}
 #check(){if(this.#poisoned)throw unavailable();}
 #read(){
  const value=synchronous(this.#entry.getSecret());if(value===null)return null;
  if(!(value instanceof Uint8Array)&&!(Array.isArray(value)&&Object.keys(value).length===value.length&&value.every(n=>Number.isInteger(n)&&n>=0&&n<=255)))throw unavailable();
  return secret(Buffer.from(value));
 }
 #matches(expected){const current=this.#read();try{return expected===null?current===null:equal(current,expected);}finally{current?.fill(0);}}
 read(){this.#check();try{return this.#read();}catch{this.#poisoned=true;throw unavailable();}}
 createInitial(value){
  this.#check();let next;
  try{next=secret(value);if(!this.#matches(null))throw unavailable();if(synchronous(this.#entry.setSecret(next))!==undefined)throw unavailable();if(!this.#matches(next))throw unavailable();}
  catch{this.#poisoned=true;throw unavailable();}finally{next?.fill(0);}
 }
 compareReplace(expected,value){
  this.#check();let before,next;
  try{before=secret(expected);next=secret(value);if(!this.#matches(before))throw unavailable();if(synchronous(this.#entry.setSecret(next))!==undefined)throw unavailable();if(!this.#matches(next))throw unavailable();}
  catch{this.#poisoned=true;throw unavailable();}finally{before?.fill(0);next?.fill(0);}
 }
 close(){this.#poisoned=true;}
}
const originalRead=CredentialBackend.prototype.read,originalCompareReplace=CredentialBackend.prototype.compareReplace;
/** Exact original channel, never a public-method or kind-string attestation. */
export function originalCredentialChannel(backend,{accountId,testOnly=false}={}){
 const original=backends.get(backend);
 if(!original||original.accountId!==accountId||original.kind!==(testOnly?'test-only-credential-backend':'os-credential-backend'))throw unavailable();
 original.check();return Object.freeze({read:original.read,compareReplace:original.compareReplace});
}
export function assertOsCredentialPlatform(platform=process.platform,arch=process.arch){
 if(!(platform==='darwin'&&['arm64','x64'].includes(arch)||platform==='win32'&&arch==='x64'))throw unavailable();
}
/** Main/worker-only, fixed native package and service; no executable path, fallback, or enumeration. */
export function openOsCredentialBackend({accountId}={}){
 assertOsCredentialPlatform();if(typeof accountId!=='string'||!/^[a-f0-9]{64}$/.test(accountId))throw unavailable();
 try{
  // Direct pinned platform binding bypasses the generic loader's native-path/WASI overrides.
  const target=process.platform==='darwin'?`darwin-${process.arch}`:'win32-x64-msvc',name=`@napi-rs/keyring-${target}`;
  if(require(name+'/package.json').version!=='2.1.1')throw unavailable();
  const {Entry}=require(name);if(typeof Entry!=='function')throw unavailable();
  // withTarget writes an empty Windows credential during construction; never use it.
  return new CredentialBackend(new Entry(SERVICE,accountId),'os-credential-backend',accountId);
 }catch{throw unavailable();}
}
/** Fault-injection backend can never advertise the production OS-guard kind. */
export function createTestCredentialBackend(entry,{accountId}={}){return new CredentialBackend(entry,'test-only-credential-backend',accountId);}
