import type {ChildProcess} from 'node:child_process';
import {types} from 'node:util';
import {createRoomTurnCustody} from './original-room-turn-custody.js';
import {appendIntrinsic,createIntrinsicSet} from '../../src/runtime/verification/intrinsic-async-collection.js';
import {loadOriginalKSwarmServicePorts} from './main-dsh-kswarm-service-ports-loader.js';
import {createOriginalProtectedBrokerChild,closeOriginalProtectedBrokerChild,readOptionalOriginalProtectedBrokerChildPortFate} from './broker-protected-child.js';
import {readOriginalBrokerProtectedStartup,readOriginalKSwarmServicePhysicalFate,sealAndDrainKSwarmServiceInstance,type KSwarmService} from './kswarm-service.js';
import {readOriginalBrokerReadyMessage} from './broker-protected-startup-data.js';
const descriptor=Object.getOwnPropertyDescriptor,own=Object.hasOwn;
const get=WeakMap.prototype.get,set=WeakMap.prototype.set,apply=Reflect.apply,define=Object.defineProperty as (target:object,key:PropertyKey,attributes:PropertyDescriptor&{__proto__?:null})=>object;
const NativePromise=Promise,then=Promise.prototype.then,freeze=Object.freeze;
interface Row {services:object;sources:object;service:object;lease:object;stock:ReturnType<typeof createRoomTurnCustody>;negative:ReturnType<typeof createRoomTurnCustody>;port?:object;ticket?:object;child?:ChildProcess;entering?:Promise<ChildProcess>;binding:Promise<void>;closing?:Promise<void>;stopped:boolean;physicalClosed?:boolean;rejectReady?:(raw:unknown)=>void;first?:{raw:unknown};raws:unknown[]}
const byService=new WeakMap<object,Row>(),ports=new WeakMap<object,Row>(),held=createIntrinsicSet<Row>();
function denied():never{throw Error('BROKER_ORIGINAL_SERVICE_SOURCE_REQUIRED');}
function rowFor(service:unknown):Row{const row=service&&typeof service==='object'?apply(get,byService,[service]) as Row|undefined:undefined;if(!row)return denied();return row;}
function remember(row:Row,raw:unknown):void{row.first??={raw};appendIntrinsic(row.raws,raw);row.negative.inventory(raw);}
function local(row:Row):void{if(row.stopped||row.first)return denied();row.stock.current();}
// This only relinquishes this module's delivery reference. The same Core keeps
// its original port and independently cancels a never-entered Source or joins
// Source physical fate AND Native terminal before closing the Core session.
async function returnDelivery(this:object):Promise<void>{
 const row=apply(get,ports,[this]) as Row|undefined;if(!row||row.port!==this)return denied();
 const fate=readOptionalOriginalProtectedBrokerChildPortFate(this);if(!fate)return;
 let first:{raw:unknown}|undefined;try{await closeOriginalProtectedBrokerChild(this);}catch(raw){remember(row,raw);first={raw};}
 await fate.waitPhysicalKnown();fate.assertPhysicalKnown();if(first)throw first.raw;
}
/** The actual Services private tuple selects its one service and Core lease.
 * No factory, path, role, scope digest, issuer or alternate SDK is accepted. */
export async function bindOriginalMainDshBrokerService(services:object,sources:object):Promise<void>{
 if(!services||typeof services!=='object'||types.isProxy(services)||!sources||typeof sources!=='object'||types.isProxy(sources))return denied();
 const api=await loadOriginalKSwarmServicePorts(),binding=api.readOriginalMainDshServicesBinding(services,sources),service=binding.kswarmService;
 const prior=apply(get,byService,[service]) as Row|undefined;
 if(prior){if(prior.services!==services||prior.sources!==sources||prior.stopped)return denied();return prior.binding;}
 let yes!:()=>void,no!:(raw:unknown)=>void;const promise=new NativePromise<void>((resolve,reject)=>{yes=resolve;no=reject;});define(promise,'constructor',{__proto__:null,value:NativePromise});apply(then,promise,[undefined,()=>{}]);
 const row:Row={services,sources,service,lease:binding.lease,stock:createRoomTurnCustody(),negative:createRoomTurnCustody(),binding:promise,stopped:false,raws:[]};apply(set,byService,[service,row]);held.add(row);
 const run=(async()=>{try{
  row.port=await row.stock.sdk<object>(api.prepareOriginalMainDshSourceBrokerChild,undefined,[sources,binding.lease],{accept(raw){if(!raw||typeof raw!=='object'||types.isProxy(raw))return false;row.port=raw;apply(set,ports,[raw,row]);return true;},consumer:returnDelivery});
  local(row);yes();
 }catch(raw){remember(row,raw);no(raw);}})();apply(then,run,[undefined,(raw:unknown)=>remember(row,raw)]);return promise;
}
/** Presence selects a narrower branch, never legacy fallback after failure. */
export function hasOriginalProtectedBrokerService(service:unknown):boolean{return !!service&&typeof service==='object'&&!!apply(get,byService,[service]);}
/** Passive original binding narrowing; a consumed/stopped resource cannot
 * reuse its old readiness Promise or silently select an ordinary listener. */
export function assertOriginalProtectedBrokerServiceCurrent(service:unknown):void{
 const row=rowFor(service);local(row);
 if(row.child){const d=descriptor(row.child,'connected');if(!d||!own(d,'value')||d.value!==true)return denied();}
}
/** Core's fixed negative port consumer. Null means no original binding only;
 * a failed or closing original service never falls back to another owner. */
export function closeOptionalOriginalProtectedBrokerServicePort(port:unknown):Promise<void>|null{
 const row=port&&typeof port==='object'?apply(get,ports,[port]) as Row|undefined:undefined;
 if(!row)return null;if(row.port!==port)return denied();
 return sealAndDrainKSwarmServiceInstance(row.service as KSwarmService);
}
/** Negative startup wake only. It neither closes Native IO nor declares fate.
 * Wake the existing start operation before Service waits its ingress drain. */
export function sealOriginalProtectedBrokerServiceStartup(service:object):void{
 const row=rowFor(service);row.stopped=true;row.rejectReady?.(Error('BROKER_ORIGINAL_SERVICE_CLOSED'));
}
export async function createOriginalProtectedBrokerServiceChild(service:object,ticket:object):Promise<ChildProcess>{
 const row=rowFor(service),environment=readOriginalBrokerProtectedStartup(service,ticket);
 if(row.entering){if(row.ticket!==ticket)return denied();local(row);return row.entering;}row.ticket=ticket;
 let yes!:(child:ChildProcess)=>void,no!:(raw:unknown)=>void;const result=new NativePromise<ChildProcess>((resolve,reject)=>{yes=resolve;no=reject;});define(result,'constructor',{__proto__:null,value:NativePromise});row.entering=result;
 const run=(async()=>{try{
  await row.binding;local(row);if(!row.port)return denied();
  const child=await createOriginalProtectedBrokerChild(row.port);row.child=child;local(row);
  const actualPid=descriptor(child,'pid');if(!actualPid||!own(actualPid,'value')||!Number.isSafeInteger(actualPid.value)||actualPid.value<1)return denied();
  let ready!:()=>void,reject!:(raw:unknown)=>void;
  const response=new NativePromise<void>((yes,no)=>{ready=yes;reject=no;});row.rejectReady=reject;define(response,'constructor',{__proto__:null,value:NativePromise});
  const onMessage=(raw:unknown)=>{try{row.stock.inventory(raw);const value=readOriginalBrokerReadyMessage(raw);if(value===null)return;if(value.pid!==actualPid.value||String(value.port)!==environment.PORT)return denied();local(row);ready();}catch(raw){remember(row,raw);reject(raw);}};
  const onExit=()=>reject(Error('BROKER_ORIGINAL_STARTUP_EXITED'));
  child.on('message',onMessage);child.once('exit',onExit);
  try{child.send({kind:'original_broker_start_v1',environment});await row.stock.sdk(()=>response,undefined,[]);local(row);yes(child);}
  finally{row.rejectReady=undefined;child.removeListener('message',onMessage);child.removeListener('exit',onExit);}
 }catch(raw){remember(row,raw);no(raw);}})();apply(then,run,[undefined,(raw:unknown)=>remember(row,raw)]);return result;
}
/** Negative delivery cleanup remains reachable after Source/current failure. */
export function closeOriginalProtectedBrokerService(service:object):Promise<void>{
 const row=rowFor(service);row.stopped=true;if(row.closing)return row.closing;
 let yes!:()=>void,no!:(raw:unknown)=>void;const result=new NativePromise<void>((resolve,reject)=>{yes=resolve;no=reject;});define(result,'constructor',{__proto__:null,value:NativePromise});row.closing=result;
 const run=(async()=>{try{
  try{await row.binding;}catch(raw){remember(row,raw);}
  if(row.port)try{await row.stock.consumeResource(returnDelivery,row.port,[]);}catch(raw){remember(row,raw);}
  if(row.entering)try{await row.entering;}catch(raw){remember(row,raw);}
  let physical:{raw:unknown}|undefined;try{await row.stock.waitPhysicalKnown();}catch(raw){physical={raw};remember(row,raw);}try{await row.negative.waitPhysicalKnown();}catch(raw){physical??={raw};remember(row,raw);}
  if(physical)throw physical.raw;row.physicalClosed=true;held.delete(row);if(row.first)throw row.first.raw;yes();
 }catch(raw){remember(row,raw);no(row.first?row.first.raw:raw);}})();apply(then,run,[undefined,(raw:unknown)=>remember(row,raw)]);return result;
}

/** Original service and delivery inventory only. This is no OS-domain or
 * canonical-enrollment assertion; old unclassified legacy failures stay closed. */
export function readOptionalOriginalProtectedBrokerServicePortFate(port:unknown):Readonly<{waitPhysicalKnown():Promise<void>;assertPhysicalKnown():void}>|null{
 const row=port&&typeof port==='object'?apply(get,ports,[port]) as Row|undefined:undefined;if(!row)return null;
 const service=readOriginalKSwarmServicePhysicalFate(row.service);
 const assert=()=>{if(!row.physicalClosed)return denied();row.stock.assertPhysicalKnown();row.negative.assertPhysicalKnown();service.assertPhysicalKnown();};
 return freeze({assertPhysicalKnown:assert,async waitPhysicalKnown(){await service.waitPhysicalKnown();await row.stock.waitPhysicalKnown();await row.negative.waitPhysicalKnown();assert();}});
}
