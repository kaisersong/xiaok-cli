import {DatabaseSync} from 'node:sqlite';
import {createRoomTurnCustody} from '../../src/runtime/verification/original-sdk-custody.js';
import {appendIntrinsic,createIntrinsicSet} from '../../src/runtime/verification/intrinsic-async-collection.js';
import {assertLoopSQLiteReady,closeLoopSQLiteDatabase} from './loop-sqlite-autocommit.js';

const NativeDatabase=DatabaseSync,NativeError=Error,freeze=Object.freeze;
const get=WeakMap.prototype.get,set=WeakMap.prototype.set,remove=WeakMap.prototype.delete,apply=Reflect.apply;
interface Birth {database?:DatabaseSync;phase:'opening'|'pending'|'failed'|'committed';closedKnown:boolean;inventoryUnknown:boolean;stock:ReturnType<typeof createRoomTurnCustody>;raws:unknown[];failure?:Error}
declare const birthBrand:unique symbol;
export interface LoopDatabaseBirth {readonly [birthBrand]:true;readonly database:DatabaseSync}
const members=new WeakMap<object,Birth>(),failed=createIntrinsicSet<Birth>();
function inventory(row:Birth,raw:unknown):void {
 appendIntrinsic(row.raws,raw);
 try{row.stock.inventory(raw);}catch(secondary){row.inventoryUnknown=true;appendIntrinsic(row.raws,secondary);}
}
function retain(row:Birth,primary:unknown):void {
 row.phase='failed';row.failure??=new NativeError('loop_database_birth_unconfirmed',{cause:primary});failed.add(row);inventory(row,primary);
}
function reap(row:Birth):boolean {
 if(!row.closedKnown||row.inventoryUnknown)return false;
 try{row.stock.assertPhysicalKnown();}catch{return false;}
 failed.delete(row);return true;
}
/** Local lifetime fuse only; never a Source or execution authorization. */
export function assertLoopDatabaseBirthReady():void {
 assertLoopSQLiteReady();
 const rows=failed.snapshot();
 for(let i=0;i<rows.length;i++){const row=rows[i]!;if(!reap(row))throw row.failure;}
}
export function openLoopDatabaseBirth(path:string):LoopDatabaseBirth {
 assertLoopDatabaseBirthReady();
 // The row precedes the Native constructor. A throw without a returned handle
 // cannot be certified as a physical close by a later successful connection.
 const row:Birth={phase:'opening',closedKnown:false,inventoryUnknown:false,stock:createRoomTurnCustody(),raws:[]};
 try{row.database=new NativeDatabase(path);}catch(primary){retain(row,primary);throw primary;}
 row.phase='pending';const token=freeze({database:row.database}) as LoopDatabaseBirth;apply(set,members,[token,row]);return token;
}
function pending(token:LoopDatabaseBirth):Birth {
 const row=apply(get,members,[token]) as Birth|undefined;
 if(!row||row.phase!=='pending')throw new NativeError('loop_database_birth_phase');return row;
}
export function commitLoopDatabaseBirth(token:LoopDatabaseBirth):void {
 const row=pending(token);row.phase='committed';apply(remove,members,[token]);
}
/** Exactly one negative close per unpublished birth; preserve the caller's
 * original primary even if closing or raw inventory also fails. */
export function abortLoopDatabaseBirth(token:LoopDatabaseBirth,primary:unknown):void {
 const row=pending(token);retain(row,primary);
 try{closeLoopSQLiteDatabase(row.database!);row.closedKnown=true;}catch(cleanup){inventory(row,cleanup);}
 reap(row);
}
