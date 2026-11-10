import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {assertOrdinarySourceWriterRoute,observeOrdinarySQLiteWriter} from '../../src/runtime/verification/ordinary-source-writer-observation.js';
import {createRoomTurnCustody} from '../../src/runtime/verification/original-sdk-custody.js';
import {createIntrinsicSet,appendIntrinsic,aggregateIntrinsicErrors} from '../../src/runtime/verification/intrinsic-async-collection.js';
const NativeDatabase=DatabaseSync,close=DatabaseSync.prototype.close,apply=Reflect.apply,freeze=Object.freeze,then=Promise.prototype.then,define=Object.defineProperty,NativeError=Error;
const weakGet=WeakMap.prototype.get,weakSet=WeakMap.prototype.set,mapGet=Map.prototype.get,mapSet=Map.prototype.set,mapDelete=Map.prototype.delete;
interface Birth {path:string;database?:DatabaseSync;phase:'opening'|'open'|'completing'|'complete'|'failed';stock:ReturnType<typeof createRoomTurnCustody>;raws:unknown[];unknownClose:boolean}
const members=new WeakMap<object,Birth>(),held=createIntrinsicSet<Birth>(),failedPaths=new Map<string,Birth>();
export interface TimedActionSourceBirth {readonly database:DatabaseSync}
function retain(row:Birth,raw:unknown){appendIntrinsic(row.raws,raw);try{row.stock.inventory(raw);}catch(secondary){appendIntrinsic(row.raws,secondary);row.unknownClose=true;}}
function key(path:string){return path===''||path===':memory:'?path:resolve(path);}
function releaseKnown(row:Birth){if(row.unknownClose)return;const wait=row.stock.waitPhysicalKnown();apply(then,wait,[()=>{held.delete(row);if(apply(mapGet,failedPaths,[key(row.path)])===row)apply(mapDelete,failedPaths,[key(row.path)]);},()=>{}]);}
function member(value:object){const row=apply(weakGet,members,[value]) as Birth|undefined;if(!row)throw new NativeError('timed_action_source_birth');return row;}
/** This is ordinary writer discovery, never a Native capacity or all-writer proof. */
export function openTimedActionSource(path:string):TimedActionSourceBirth {
 path=key(path);
 const prior=apply(mapGet,failedPaths,[key(path)]) as Birth|undefined;if(prior)throw new NativeError('timed_action_source_initialization_unknown',{cause:prior.raws[0]});
 const row:Birth={path,phase:'opening',stock:createRoomTurnCustody(),raws:[],unknownClose:false};
 try{assertOrdinarySourceWriterRoute();mkdirSync(dirname(path),{recursive:true});}catch(raw){row.phase='failed';held.add(row);apply(mapSet,failedPaths,[path,row]);retain(row,raw);releaseKnown(row);throw raw;}
 try{row.database=new NativeDatabase(path);}catch(raw){row.phase='failed';row.unknownClose=true;held.add(row);apply(mapSet,failedPaths,[key(path),row]);retain(row,raw);throw raw;}
 row.phase='open';const birth=freeze({database:row.database});apply(weakSet,members,[birth,row]);return birth;
}
export function completeTimedActionSource(birth:TimedActionSourceBirth):void {
 const row=member(birth);if(row.phase!=='open')throw new NativeError('timed_action_source_phase');row.phase='completing';
 // The actual original schema must exist before its source observation is published.
 assertOrdinarySourceWriterRoute();observeOrdinarySQLiteWriter(row.path,'timed-actions-sqlite-v1');assertOrdinarySourceWriterRoute();row.phase='complete';
}
/** Negative cleanup remains reachable even if positive route/inventory failed. */
export function failTimedActionSource(birth:TimedActionSourceBirth,primary:unknown):never {
 const row=member(birth);if(row.phase==='failed'||row.phase==='complete')throw new NativeError('timed_action_source_phase');row.phase='failed';held.add(row);apply(mapSet,failedPaths,[key(row.path),row]);retain(row,primary);
 let cleanupFailed=false,cleanup:unknown;
 try{const returned=apply(close,row.database,[]);if(returned!==undefined){retain(row,returned);throw new NativeError('timed_action_source_close_nonvoid',{cause:returned});}}catch(raw){cleanupFailed=true;cleanup=raw;row.unknownClose=true;retain(row,raw);}
 // Known negative business failure is not an immortal resource. Unknown close/raw
 // tails keep the same birth strongly held, and cannot be washed by a new ctor.
 releaseKnown(row);
 if(cleanupFailed){const errors:unknown[]=[];appendIntrinsic(errors,primary);appendIntrinsic(errors,cleanup);const failure=aggregateIntrinsicErrors(errors,'timed_action_source_initialization_failed');define(failure,'cause',{__proto__:null,value:primary,writable:true,configurable:true} as PropertyDescriptor);throw failure;}
 throw primary;
}
