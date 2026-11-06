import {Worker} from 'node:worker_threads';
import {resolve} from 'node:path';
import {ProtectedJsonFile,protectedJsonDigest} from './protected-json.js';
export interface Versioned {value:Record<string,unknown>|undefined;digest:string;backupDigest:string}
const cache=new Map<string,Versioned>();
const isMain=()=> (process as NodeJS.Process & {type?:string}).type==='browser';
const key=(file:string)=>resolve(file);
export function readProtectedJsonVersionedSync(file:string):Versioned {
  if(isMain()){const saved=cache.get(key(file));if(!saved||saved.digest!==protectedJsonDigest(file)||saved.backupDigest!==protectedJsonDigest(file+'.bak'))throw Error('credential_cache_not_ready');return structuredClone(saved);}
  for(let i=0;i<3;i++){const before=protectedJsonDigest(file),bak=protectedJsonDigest(file+'.bak');const value=new ProtectedJsonFile(file).read();const digest=protectedJsonDigest(file),backupDigest=protectedJsonDigest(file+'.bak');if(before===digest&&bak===backupDigest)return {value,digest,backupDigest};}throw Error('credential_config_changed');
}
export function readProtectedJsonSync(file:string){return readProtectedJsonVersionedSync(file).value;}

function operate(file:string,operation:'read'|'save',value?:unknown,expectedHash?:string,signal?:AbortSignal):Promise<Versioned>{
  signal?.throwIfAborted();
  if(!isMain()) {if(operation==='read')return Promise.resolve(readProtectedJsonVersionedSync(file));const store=new ProtectedJsonFile(file),receipt=store.save(value,expectedHash,()=>signal?.throwIfAborted());return Promise.resolve({value:structuredClone(value) as Record<string,unknown>,...receipt});}
  return new Promise((accept,reject)=>{const state=new Int32Array(new SharedArrayBuffer(4));const worker=new Worker(new URL('./credential-worker.js',import.meta.url),{workerData:{file,operation,value,expectedHash,state:state.buffer}});let settled=false;
    const finish=(error?:Error,result?:Versioned)=>{if(settled)return;settled=true;signal?.removeEventListener('abort',abort);void worker.terminate();if(error)reject(error);else accept(result!);};
    const abort=()=>{if(Atomics.compareExchange(state,0,0,1)===0)finish(Error('credential_cancelled'));};
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    worker.once('message',(message:{ok:boolean;result?:Versioned;error?:string})=>{if(message.ok)finish(undefined,message.result);else finish(Error(message.error??'credential_store_unavailable'));});
    worker.once('error',()=>finish(Error('credential_store_unavailable')));worker.once('exit',()=>{if(!settled)finish(Error('credential_worker_unavailable'));});
  });
}
export async function readProtectedJsonVersioned(file:string):Promise<Versioned>{const saved=cache.get(key(file));if(saved&&saved.digest===protectedJsonDigest(file)&&saved.backupDigest===protectedJsonDigest(file+'.bak'))return structuredClone(saved);const result=await operate(file,'read');cache.set(key(file),structuredClone(result));return structuredClone(result);}
export async function readProtectedJson(file:string){return (await readProtectedJsonVersioned(file)).value;}
export async function saveProtectedJson(file:string,value:unknown,expectedHash?:string,signal?:AbortSignal):Promise<Versioned>{const expected=expectedHash??cache.get(key(file))?.digest??protectedJsonDigest(file);const result=await operate(file,'save',value,expected,signal);cache.set(key(file),structuredClone(result));return structuredClone(result);}
export async function updateProtectedJson(file:string,update:(value:Record<string,unknown>)=>Record<string,unknown>,signal?:AbortSignal):Promise<void>{const snapshot=await readProtectedJsonVersioned(file);signal?.throwIfAborted();const expected=snapshot.digest;const next=update(snapshot.value??{});await saveProtectedJson(file,next,expected,signal);}

export function updateProtectedAutomationSync(file:string,enabled:boolean,initial:Record<string,unknown>={}):void {const value=readProtectedJsonSync(file)??structuredClone(initial);const expected=protectedJsonDigest(file);new ProtectedJsonFile(file).updateAutomation(enabled,expected,initial);value.automations={...(value.automations as object??{}),globalBackgroundAutoRunEnabled:enabled};cache.set(key(file),{value,digest:protectedJsonDigest(file),backupDigest:protectedJsonDigest(file+'.bak')});}
