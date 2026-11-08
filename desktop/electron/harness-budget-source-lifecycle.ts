import {types} from 'node:util';
import {Worker} from 'node:worker_threads';
import {resolve} from 'node:path';
import {assertOrdinarySourceWriterRoute,observeOrdinarySQLiteWriter} from '../../src/runtime/verification/ordinary-source-writer-observation.js';
import {createRoomTurnCustody} from '../../src/runtime/verification/original-sdk-custody.js';
import {appendIntrinsic,createIntrinsicSet,settleIntrinsicOperations} from '../../src/runtime/verification/intrinsic-async-collection.js';
const isProxy=types.isProxy,NativeWorker=Worker,terminate=Worker.prototype.terminate,apply=Reflect.apply,then=Promise.prototype.then,NativePromise=Promise;
const freeze=Object.freeze,descriptor=Object.getOwnPropertyDescriptor,own=Object.hasOwn,NativeError=Error;
const get=WeakMap.prototype.get,set=WeakMap.prototype.set,mapGet=Map.prototype.get,mapSet=Map.prototype.set,mapDelete=Map.prototype.delete;
interface Row {path:string;stock:ReturnType<typeof createRoomTurnCustody>;worker?:Worker;acquisition?:Promise<Worker>;closing?:Promise<void>;exited:boolean;terminated:boolean;unknown:boolean;raws:unknown[];notifications:ReturnType<typeof createRoomTurnCustody>[];notified:boolean;failure?:{raw:unknown}}
const members=new WeakMap<object,Row>(),held=createIntrinsicSet<Row>(),failedPaths=new Map<string,Row>();
export interface OriginalBudgetSourceWorker {readonly worker:Worker;readonly birth:object;readonly acquisition:Promise<Worker>}
function row(birth:object):Row{const value=apply(get,members,[birth]) as Row|undefined;if(!value)throw new NativeError('budget_source_birth');return value;}
function key(path:string){return path===''||path===':memory:'?path:resolve(path);}
function remember(value:Row,raw:unknown){value.failure??={raw};appendIntrinsic(value.raws,raw);try{value.stock.inventory(raw);}catch(secondary){appendIntrinsic(value.raws,secondary);value.unknown=true;}held.add(value);apply(mapSet,failedPaths,[value.path,value]);}
function release(value:Row){if(!value.terminated||value.unknown)return;value.stock.assertPhysicalKnown();held.delete(value);if(apply(mapGet,failedPaths,[value.path])===value)apply(mapDelete,failedPaths,[value.path]);}
/** Ordinary discovery only. No protected birth, file-wide fence or capacity grant. */
export function openOriginalBudgetSourceWorker(data:Record<string,unknown>):OriginalBudgetSourceWorker {
 if(!data||typeof data!=='object'||isProxy(data))throw new NativeError('budget_source_path');
 const field=descriptor(data,'dbPath');if(!field||!own(field,'value')||typeof field.value!=='string')throw new NativeError('budget_source_path');
 const path=key(field.value),prior=apply(mapGet,failedPaths,[path]) as Row|undefined;if(prior)throw new NativeError('budget_source_initialization_unknown',{cause:prior.failure?.raw});
 const value:Row={path,stock:createRoomTurnCustody(),exited:false,terminated:false,unknown:false,raws:[],notifications:[],notified:false};
 const birth=freeze({});apply(set,members,[birth,value]);
 try{value.stock.syncVoid(assertOrdinarySourceWriterRoute,undefined,[]);}catch(raw){remember(value,raw);void apply(then,value.stock.waitPhysicalKnown(),[()=>{if(!value.unknown){held.delete(value);if(apply(mapGet,failedPaths,[path])===value)apply(mapDelete,failedPaths,[path]);}},()=>{}]);throw raw;}
 let constructorFailure:{raw:unknown}|undefined;
 const acquisition=value.stock.sdk<Worker>(()=>{try{value.worker=new NativeWorker(new URL('./harness-optimization-store-worker.mjs',import.meta.url),{workerData:data,execArgv:['--no-warnings']});return value.worker;}catch(raw){constructorFailure={raw};value.unknown=true;remember(value,raw);throw raw;}},undefined,[],{accept:actual=>actual===value.worker,consumer:terminate});
 value.acquisition=acquisition;void apply(then,acquisition,[()=>{},(raw:unknown)=>remember(value,raw)]);
 if(!value.worker){value.unknown=true;throw constructorFailure?constructorFailure.raw:new NativeError('budget_source_constructor_unknown');}
 value.worker.once('exit',()=>{value.exited=true;});
 return freeze({worker:value.worker,birth,acquisition});
}
export function completeOriginalBudgetSourceWorker(birth:object):void {
 const value=row(birth);if(value.closing||value.failure||value.unknown)throw value.failure?value.failure.raw:new NativeError('budget_source_unavailable');
 try{value.stock.syncVoid(observeOrdinarySQLiteWriter,undefined,[value.path,'harness-budget-sqlite-v1']);value.stock.syncVoid(assertOrdinarySourceWriterRoute,undefined,[]);}catch(raw){remember(value,raw);throw raw;}
}
export function notifyOriginalBudgetSourceFailure(birth:object,callback:()=>void):void {
 const value=row(birth);if(value.notified)return;value.notified=true;
 const stock=createRoomTurnCustody();appendIntrinsic(value.notifications,stock);
 try{stock.syncVoid(callback,undefined,[]);}catch(raw){remember(value,raw);}
}
export function retainOriginalBudgetSourceFailure(birth:object,raw:unknown):void{remember(row(birth),raw);}
/** Captured fixed negative consumer; a failed positive observer cannot block it. */
export function closeOriginalBudgetSourceWorker(birth:object):Promise<void> {
 const value=row(birth);if(value.closing)return value.closing;
 let yes!:()=>void,no!:(raw:unknown)=>void;value.closing=new NativePromise<void>((resolve,reject)=>{yes=resolve;no=reject;});
 const operation=(async()=>{
  let failure:{raw:unknown}|undefined;
  try{await value.stock.consumeResource(terminate,value.worker!,[]);}catch(raw){failure={raw};remember(value,raw);}
  const stocks=[value.stock];for(let i=0;i<value.notifications.length;i++)appendIntrinsic(stocks,value.notifications[i]!);
  const joined=await settleIntrinsicOperations(stocks,stock=>stock.waitPhysicalKnown());
  for(let i=0;i<joined.length;i++){const outcome=joined[i]!;if(outcome.status==='rejected'){failure??={raw:outcome.reason};remember(value,outcome.reason);}}
  if(!failure)try{if(!value.exited)throw new NativeError('budget_source_exit_unconfirmed');value.terminated=true;release(value);}catch(raw){failure={raw};remember(value,raw);} 
  if(failure)throw value.failure?value.failure.raw:failure.raw;
 })();void apply(then,operation,[yes,no]);return value.closing;
}
export function readOriginalBudgetSourceWorkerFate(birth:object):Readonly<{path:string;assertTerminated():void}>{
 const value=row(birth);return freeze({path:value.path,assertTerminated(){if(!value.terminated||!value.exited||value.unknown)throw new NativeError('budget_source_physical_unconfirmed');value.stock.assertPhysicalKnown();for(const stock of value.notifications)stock.assertPhysicalKnown();}});
}
