import type {OriginalAdmissionDatabaseBundle} from './protected-authority-database-types.js';
import {Worker} from 'node:worker_threads';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {types} from 'node:util';
import {readOriginalHarnessBudgetWorkerBirth} from './harness-optimization-lifecycle.js';
import {createRoomTurnCustody,type RoomTurnCustody} from './original-room-turn-custody.js';
import {retainSourceErrorTails} from '../../src/runtime/verification/source-error-tails.js';
const requireFixed=createRequire(import.meta.url),apply=Reflect.apply,construct=Reflect.construct,descriptor=Object.getOwnPropertyDescriptor,own=Object.hasOwn,freeze=Object.freeze;
const NativePromise=Promise,then=Promise.prototype.then,get=WeakMap.prototype.get,set=WeakMap.prototype.set;
const workerId=descriptor(Worker.prototype,'threadId')?.get,on=Worker.prototype.on;
const records=new WeakMap<object,Birth>();
// A rejected preparation may never return its opaque token. Unknown SDK tails
// must still have a module-owned strong root, independent of that weak key.
const heldBirths=new Set<Birth>(),holdBirth=Set.prototype.add,releaseBirth=Set.prototype.delete;
interface Birth {prepared:unknown;root:string;identity:string;ownerId:string;initOperationId:string;initializing:boolean;carrier:object;module:object;modulePath:string;publish:Function;closed:Function;release?:Function;carrierRelease?:Function;moduleRelease?:Function;raw:unknown[];pending:Promise<unknown>[];worker?:Worker;failed:boolean;first?:{raw:unknown};used:boolean;stock:RoomTurnCustody;creation?:Promise<unknown>;exit?:Promise<void>}
function fail(row:Birth,raw:unknown):void{row.raw[row.raw.length]=raw;row.failed=true;row.first??={raw};}
function retain(row:Birth,raw:unknown):void{
 row.raw[row.raw.length]=raw;
 retainSourceErrorTails(raw,(value,kind)=>{
  row.raw[row.raw.length]=value;
  if(kind==='unknown')fail(row,Error('protected_budget_worker_sdk_unconfirmed'));
  if(types.isPromise(value)&&!types.isProxy(value)){
   const observed=new NativePromise<void>(resolve=>{apply(then,value,[()=>resolve(),(error:unknown)=>{fail(row,error);resolve();}]);});
   row.pending[row.pending.length]=observed;
  }
 });
}
function method(module:object,name:string):Function{const d=descriptor(module,name);if(!d||!own(d,'value')||typeof d.value!=='function'||types.isProxy(d.value))throw Error('protected_budget_worker_native_required');return d.value;}
/** Called only by the original Core closure with its private original issuer.
 * Neither the issuer nor any Native method/path is returned to the caller. */
export async function prepareOriginalProtectedBudgetWorker(prepared:unknown,issuer:object):Promise<object>{
 const birth=readOriginalHarnessBudgetWorkerBirth(prepared);birth.assertLocal();
 const token=freeze(Object.create(null));
 const row:Birth={prepared,root:birth.root,identity:birth.identity,ownerId:birth.ownerId,initOperationId:birth.initOperationId,initializing:birth.initializing,carrier:token,module:token,modulePath:join(dirname(fileURLToPath(import.meta.url)),'protected_sqlite.node'),publish:()=>{},closed:()=>{},raw:[],pending:[],failed:false,used:false,stock:createRoomTurnCustody()};
 apply(set,records,[token,row]);
 apply(holdBirth,heldBirths,[row]);
 try{
  const moduleRelease=()=>{};row.moduleRelease=moduleRelease;
  const module=await row.stock.sdk<object>(requireFixed,undefined,[row.modulePath],{accept:raw=>!!raw&&typeof raw==='object'&&!types.isProxy(raw),consumer:moduleRelease,strictProxyGraph:true});row.raw[row.raw.length]=module;row.module=module;await row.stock.waitKnown();
  const prepare=method(module,'prepareOriginalBudgetWorker');row.publish=method(module,'publishOriginalBudgetWorker');row.closed=method(module,'assertOriginalBudgetWorkerIoClosed');
  const carrierRelease=()=>{const result=apply(row.closed,row.module,[row.carrier]);if(result!==undefined)throw Error('protected_budget_worker_close_unconfirmed');};row.carrierRelease=carrierRelease;
  birth.assertLocal();const raw=await row.stock.sdk<object>(prepare,module,[issuer],{accept:value=>!!value&&typeof value==='object'&&!types.isProxy(value)&&types.isSharedArrayBuffer(value),consumer:carrierRelease,strictProxyGraph:true});row.raw[row.raw.length]=raw;
  if(!raw||typeof raw!=='object'||types.isProxy(raw)||!types.isSharedArrayBuffer(raw))throw Error('protected_budget_worker_carrier_required');row.carrier=raw;
  return token;
 }catch(raw){fail(row,raw);throw raw;}
}
/** Original Store constructor consumes one private birth, never a caller Worker. */
export function constructOriginalProtectedBudgetWorker(token:unknown,data:Record<string,unknown>):Worker{
 const row=token&&typeof token==='object'?apply(get,records,[token]) as Birth|undefined:undefined;
 if(!row||row.used||row.failed)throw Error('protected_budget_worker_birth_required');
 if(typeof workerId!=='function'||types.isProxy(workerId)||typeof on!=='function')throw Error('protected_budget_worker_sdk_unavailable');
 readOriginalHarnessBudgetWorkerBirth(row.prepared).assertLocal();
 for(const key of ['root','identity','ownerId','initOperationId','initializing'] as const){const d=descriptor(data,key);if(!d||!own(d,'value')||d.value!==row[key])throw Error('protected_budget_worker_birth_changed');}
 row.used=true;
 try{
  const entry=new URL('./harness-optimization-store-worker.mjs',import.meta.url);
  const env={...process.env};delete env.NODE_OPTIONS;delete env.NODE_PATH;
  const release=async()=>{if(row.exit)await row.exit;const result=apply(row.closed,row.module,[row.carrier]);if(result!==undefined)throw Error('protected_budget_worker_close_unconfirmed');};
  row.release=release;
  row.creation=row.stock.sdk<Worker>(construct,undefined,[Worker,[entry,{workerData:{...data,originalProtectedBudgetCarrier:row.carrier},execArgv:['--no-warnings'],env}]],{
   accept(raw){
    row.raw[row.raw.length]=raw;
    if(!raw||typeof raw!=='object'||types.isProxy(raw)||Object.getPrototypeOf(raw)!==Worker.prototype)return false;
    row.worker=raw as Worker;
    row.exit=new NativePromise<void>((resolve,reject)=>{
     apply(on,raw,['error',(error:unknown)=>{fail(row,error);}]);
     apply(on,raw,['exit',(code:unknown)=>{if(code!==0){const error=Error('protected_budget_worker_exit_unknown');fail(row,error);reject(error);}else resolve();}]);
    });apply(then,row.exit,[undefined,()=>{}]);return true;
   },consumer:release,strictProxyGraph:true,
  });
  apply(then,row.creation,[undefined,(raw:unknown)=>fail(row,raw)]);
  if(!row.worker)throw Error('protected_budget_worker_sdk_unconfirmed');
  const worker=row.worker;
  const publish=(async()=>{
   await row.creation;await row.stock.waitKnown();readOriginalHarnessBudgetWorkerBirth(row.prepared).assertLocal();
   const id=apply(workerId,worker,[]);row.raw[row.raw.length]=id;if(!Number.isSafeInteger(id)||id<1)throw Error('protected_budget_worker_thread_required');
   const result=apply(row.publish,row.module,[row.carrier,id]);row.raw[row.raw.length]=result;if(result!==undefined)throw Error('protected_budget_worker_publish_unconfirmed');
  })();row.pending[row.pending.length]=publish;apply(then,publish,[undefined,(raw:unknown)=>fail(row,raw)]);
  return worker;
 }catch(raw){fail(row,raw);throw raw;}
}
export async function closeOriginalProtectedBudgetWorker(token:unknown):Promise<void>{
 const row=token&&typeof token==='object'?apply(get,records,[token]) as Birth|undefined:undefined;if(!row)throw Error('protected_budget_worker_birth_required');
 if(row.worker){
  // Store sent shutdown first. Natural exit, not terminate's numeric result,
  // precedes the Native exact Environment/IO closure check.
  if(row.exit)await row.exit;
 }
 for(let i=0;i<row.pending.length;i++)await row.pending[i];
 if(row.failed)throw row.first?.raw;
 if(row.worker&&row.release)await row.stock.consumeResource(row.release,row.worker,[]);
 if(row.carrierRelease)await row.stock.consumeResource(row.carrierRelease,row.carrier,[]);
 if(row.moduleRelease)await row.stock.consumeResource(row.moduleRelease,row.module,[]);
 await row.stock.drain();
 apply(releaseBirth,heldBirths,[row]);
}

/** Fixed Main admission consumer; Native private issuer is never returned. */
export function prepareOriginalProtectedAdmissionDatabase(issuer:object):OriginalAdmissionDatabaseBundle{
 const module=requireFixed(join(dirname(fileURLToPath(import.meta.url)),'protected_sqlite.node')) as object;
 const core=apply(method(module,'prepareOriginalAdmissionNamespace'),module,[issuer]);
 const adapter=requireFixed('./harness-protected-sqlite.cjs') as object;
 const bundle=apply(method(adapter,'wrapOriginalProtectedSQLiteNamespace'),adapter,[core]) as object;
 apply(method(adapter,'readOriginalProtectedSQLiteNamespace'),adapter,[bundle,core]);return bundle as OriginalAdmissionDatabaseBundle;
}
