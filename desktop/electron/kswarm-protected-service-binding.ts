import type {ChildProcess} from 'node:child_process';
import {types} from 'node:util';
import {createRoomTurnCustody} from './original-room-turn-custody.js';
import {appendIntrinsic,createIntrinsicSet} from '../../src/runtime/verification/intrinsic-async-collection.js';
import {loadOriginalKSwarmServicePorts} from './main-dsh-kswarm-service-ports-loader.js';
import {createOriginalProtectedKSwarmChild,closeOriginalProtectedKSwarmChild,readOptionalOriginalProtectedKSwarmChildPortFate} from './kswarm-protected-child.js';
import {readOriginalKSwarmProtectedStartup,readOriginalKSwarmServicePhysicalFate,sealAndDrainKSwarmServiceInstance,type KSwarmService} from './kswarm-service.js';
const get=WeakMap.prototype.get,set=WeakMap.prototype.set,apply=Reflect.apply,define=Object.defineProperty as (target:object,key:PropertyKey,attributes:PropertyDescriptor&{__proto__?:null})=>object;
const NativePromise=Promise,then=Promise.prototype.then,freeze=Object.freeze;
interface Row {services:object;sources:object;service:object;lease:object;stock:ReturnType<typeof createRoomTurnCustody>;negative:ReturnType<typeof createRoomTurnCustody>;port?:object;ticket?:object;child?:ChildProcess;entering?:Promise<ChildProcess>;binding:Promise<void>;closing?:Promise<void>;stopped:boolean;physicalClosed?:boolean;first?:{raw:unknown};raws:unknown[]}
const byService=new WeakMap<object,Row>(),ports=new WeakMap<object,Row>(),held=createIntrinsicSet<Row>();
function denied():never{throw Error('KSWARM_ORIGINAL_SERVICE_SOURCE_REQUIRED');}
function rowFor(service:unknown):Row{const row=service&&typeof service==='object'?apply(get,byService,[service]) as Row|undefined:undefined;if(!row)return denied();return row;}
function remember(row:Row,raw:unknown):void{row.first??={raw};appendIntrinsic(row.raws,raw);row.negative.inventory(raw);}
function local(row:Row):void{if(row.stopped||row.first)return denied();row.stock.current();}
// This only relinquishes this module's delivery reference. The same Core keeps
// its original port and independently cancels a never-entered Source or joins
// Source physical fate AND Native terminal before closing the Core session.
async function returnDelivery(this:object):Promise<void>{
 const row=apply(get,ports,[this]) as Row|undefined;if(!row||row.port!==this)return denied();
 const fate=readOptionalOriginalProtectedKSwarmChildPortFate(this);if(!fate)return;
 let first:{raw:unknown}|undefined;try{await closeOriginalProtectedKSwarmChild(this);}catch(raw){remember(row,raw);first={raw};}
 await fate.waitPhysicalKnown();fate.assertPhysicalKnown();if(first)throw first.raw;
}
/** The actual Services private tuple selects its one service and Core lease.
 * No factory, path, role, scope digest, issuer or alternate SDK is accepted. */
export async function bindOriginalMainDshKSwarmService(services:object,sources:object):Promise<void>{
 if(!services||typeof services!=='object'||types.isProxy(services)||!sources||typeof sources!=='object'||types.isProxy(sources))return denied();
 const api=await loadOriginalKSwarmServicePorts(),binding=api.readOriginalMainDshServicesBinding(services,sources),service=binding.kswarmService;
 const prior=apply(get,byService,[service]) as Row|undefined;
 if(prior){if(prior.services!==services||prior.sources!==sources||prior.stopped)return denied();return prior.binding;}
 let yes!:()=>void,no!:(raw:unknown)=>void;const promise=new NativePromise<void>((resolve,reject)=>{yes=resolve;no=reject;});define(promise,'constructor',{__proto__:null,value:NativePromise});apply(then,promise,[undefined,()=>{}]);
 const row:Row={services,sources,service,lease:binding.lease,stock:createRoomTurnCustody(),negative:createRoomTurnCustody(),binding:promise,stopped:false,raws:[]};apply(set,byService,[service,row]);held.add(row);
 const run=(async()=>{try{
  row.port=await row.stock.sdk<object>(api.prepareOriginalMainDshSourceKSwarmChild,undefined,[sources,binding.lease],{accept(raw){if(!raw||typeof raw!=='object'||types.isProxy(raw))return false;row.port=raw;apply(set,ports,[raw,row]);return true;},consumer:returnDelivery});
  local(row);yes();
 }catch(raw){remember(row,raw);no(raw);}})();apply(then,run,[undefined,(raw:unknown)=>remember(row,raw)]);return promise;
}
/** Presence selects a narrower branch, never legacy fallback after failure. */
export function hasOriginalProtectedKSwarmService(service:unknown):boolean{return !!service&&typeof service==='object'&&!!apply(get,byService,[service]);}
/** Core's fixed negative port consumer. Null means no original binding only;
 * a failed or closing original service never falls back to another owner. */
export function closeOptionalOriginalProtectedKSwarmServicePort(port:unknown):Promise<void>|null{
 const row=port&&typeof port==='object'?apply(get,ports,[port]) as Row|undefined:undefined;
 if(!row)return null;if(row.port!==port)return denied();
 return sealAndDrainKSwarmServiceInstance(row.service as KSwarmService);
}
export async function createOriginalProtectedKSwarmServiceChild(service:object,ticket:object):Promise<ChildProcess>{
 const row=rowFor(service),environment=readOriginalKSwarmProtectedStartup(service,ticket);
 if(row.entering){if(row.ticket!==ticket)return denied();local(row);return row.entering;}row.ticket=ticket;
 let yes!:(child:ChildProcess)=>void,no!:(raw:unknown)=>void;const result=new NativePromise<ChildProcess>((resolve,reject)=>{yes=resolve;no=reject;});define(result,'constructor',{__proto__:null,value:NativePromise});row.entering=result;
 const run=(async()=>{try{await row.binding;local(row);if(!row.port)return denied();const child=await createOriginalProtectedKSwarmChild(row.port);row.child=child;local(row);child.send({kind:'original_kswarm_start_v1',environment});local(row);yes(child);}catch(raw){remember(row,raw);no(raw);}})();apply(then,run,[undefined,(raw:unknown)=>remember(row,raw)]);return result;
}
/** Negative delivery cleanup remains reachable after Source/current failure. */
export function closeOriginalProtectedKSwarmService(service:object):Promise<void>{
 const row=rowFor(service);row.stopped=true;if(row.closing)return row.closing;
 let yes!:()=>void,no!:(raw:unknown)=>void;const result=new NativePromise<void>((resolve,reject)=>{yes=resolve;no=reject;});define(result,'constructor',{__proto__:null,value:NativePromise});row.closing=result;
 const run=(async()=>{try{
  try{await row.binding;}catch(raw){remember(row,raw);}if(row.entering)try{await row.entering;}catch(raw){remember(row,raw);}
  if(row.port)try{await row.stock.consumeResource(returnDelivery,row.port,[]);}catch(raw){remember(row,raw);}
  let physical:{raw:unknown}|undefined;try{await row.stock.waitPhysicalKnown();}catch(raw){physical={raw};remember(row,raw);}try{await row.negative.waitPhysicalKnown();}catch(raw){physical??={raw};remember(row,raw);}
  if(physical)throw physical.raw;row.physicalClosed=true;held.delete(row);if(row.first)throw row.first.raw;yes();
 }catch(raw){remember(row,raw);no(row.first?row.first.raw:raw);}})();apply(then,run,[undefined,(raw:unknown)=>remember(row,raw)]);return result;
}

/** Original service and delivery inventory only. This is no OS-domain or
 * canonical-enrollment assertion; old unclassified legacy failures stay closed. */
export function readOptionalOriginalProtectedKSwarmServicePortFate(port:unknown):Readonly<{waitPhysicalKnown():Promise<void>;assertPhysicalKnown():void}>|null{
 const row=port&&typeof port==='object'?apply(get,ports,[port]) as Row|undefined:undefined;if(!row)return null;
 const service=readOriginalKSwarmServicePhysicalFate(row.service);
 const assert=()=>{if(!row.physicalClosed)return denied();row.stock.assertPhysicalKnown();row.negative.assertPhysicalKnown();service.assertPhysicalKnown();};
 return freeze({assertPhysicalKnown:assert,async waitPhysicalKnown(){await service.waitPhysicalKnown();await row.stock.waitPhysicalKnown();await row.negative.waitPhysicalKnown();assert();}});
}
