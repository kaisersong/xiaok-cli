import type {OriginalRoomRootAdmissionPort} from './main-room-root-admission.js';
import {loadOriginalRoomDiscussionPortReader} from './main-room-discussion-port-loader.js';
import {createRoomTurnCustody} from './original-room-turn-custody.js';
const bindings=new WeakMap<object,{source:object;read():OriginalRoomRootAdmissionPort;loading?:Promise<void>}>();
const get=WeakMap.prototype.get,set=WeakMap.prototype.set,apply=Reflect.apply;
/** Passive lookup only. A retired/pending binding never falls back to legacy. */
export function readOptionalOriginalRoomDiscussionAdmission(runtime:object,source:object):OriginalRoomRootAdmissionPort|null {
 const row=apply(get,bindings,[runtime]) as {source:object;read():OriginalRoomRootAdmissionPort}|undefined;
 if(!row)return null;
 if(row.source!==source)throw Error('ROOM_ROOT_ORIGINAL_BINDING_REQUIRED');return row.read();
}
/** Only the package-literal original Owner reader can supply this private port. */
export async function cacheOriginalRoomDiscussionAdmission(runtime:object,source:object):Promise<void> {
 const prior=apply(get,bindings,[runtime]) as {source:object;read():OriginalRoomRootAdmissionPort;loading?:Promise<void>}|undefined;
 if(prior){if(prior.source!==source)throw Error('ROOM_ROOT_ORIGINAL_BINDING_REQUIRED');await prior.loading;prior.read();return;}
 const row:{source:object;read():OriginalRoomRootAdmissionPort;loading?:Promise<void>}={source,read(){throw Error('ROOM_ROOT_ORIGINAL_BINDING_PENDING');}};
 apply(set,bindings,[runtime,row]);
 const stock=createRoomTurnCustody(),consume=()=>{};
 row.loading=(async()=>{
  let failure:{raw:unknown}|undefined;
  try{
   const original=await stock.sdk<Awaited<ReturnType<typeof loadOriginalRoomDiscussionPortReader>>>(loadOriginalRoomDiscussionPortReader,undefined,[],{accept:value=>!!value&&typeof value==='object',consumer:consume});
   const read=original.readOriginalMainRoomDiscussionAdmission;
   await stock.consumeResource(consume,original,[]);
   read(runtime,source);row.read=()=>read(runtime,source);
  }catch(raw){failure={raw};row.read=()=>{throw raw;};}
  try{await stock.waitPhysicalKnown();}catch(raw){row.read=()=>{throw raw;};if(failure)throw new AggregateError([failure.raw,raw],'ROOM_DISCUSSION_BIND_AND_DRAIN_FAILED',{cause:failure.raw});throw raw;}
  if(failure)throw failure.raw;
 })();await row.loading;
}
