import {DatabaseSync as OriginalDatabase,StatementSync} from 'node:sqlite';
import {captureLoopSQLiteBindings} from './loop-sqlite-bindings.js';
const nativePrepare=OriginalDatabase.prototype.prepare,nativeGet=StatementSync.prototype.get,nativeAll=StatementSync.prototype.all,apply=Reflect.apply;
import {randomUUID} from 'node:crypto';
import {readOriginalLoopMigrationLease,type LoopDatabaseLease} from './loop-database-owner.js';
import type {DatabaseSync} from 'node:sqlite';
/** Fixed domain SDK boundary; the original DB/lease membership precedes callback
 * execution. This grants no role, namespace or caller-supplied known state. */
export function assistantOwnedSqlite<T>(db:DatabaseSync,original:LoopDatabaseLease,sdk:()=>T):T{
 const lease=readOriginalLoopMigrationLease(original,db);if(lease.database!==db)throw Error('loop_database_lease');
 try{return sdk();}catch(raw){lease.failAssistantQualityOwned(raw);throw raw;}
}
/** Unique names make pre/post-call failure cleanup unable to roll back an
 * unrelated outer savepoint. Cleanup is negative and bypasses positive fresh. */
export function assistantOwnedSavepoint<T>(db:DatabaseSync,original:LoopDatabaseLease,body:()=>T):T{
 const lease=readOriginalLoopMigrationLease(original,db),name='assistant_quality_'+randomUUID().replace(/-/g,'');
 try{assistantOwnedExec(db,original,'SAVEPOINT '+name);const result=body();assistantOwnedExec(db,original,'RELEASE '+name);return result;}
 catch(first){try{lease.rollbackAssistantQualitySavepointOwned(name);}catch{/* Original owner retains every cleanup raw and remains stopped. */}throw first;}
}

export function assistantOwnedGet(db:DatabaseSync,original:LoopDatabaseLease,sql:string,...bindings:unknown[]):ReturnType<StatementSync['get']>{
 const args=captureLoopSQLiteBindings(bindings);return assistantOwnedSqlite(db,original,()=>apply(nativeGet,apply(nativePrepare,db,[sql]),args));
}
export function assistantOwnedAll(db:DatabaseSync,original:LoopDatabaseLease,sql:string,...bindings:unknown[]):ReturnType<StatementSync['all']>{
 const args=captureLoopSQLiteBindings(bindings);return assistantOwnedSqlite(db,original,()=>apply(nativeAll,apply(nativePrepare,db,[sql]),args));
}

export function assistantOwnedRun(db:DatabaseSync,original:LoopDatabaseLease,sql:string,...bindings:unknown[]):ReturnType<StatementSync['run']>{return assistantOwnedSqlite(db,original,()=>readOriginalLoopMigrationLease(original,db).runWrite(sql,...bindings));}
export function assistantOwnedExec(db:DatabaseSync,original:LoopDatabaseLease,sql:string):void{return assistantOwnedSqlite(db,original,()=>readOriginalLoopMigrationLease(original,db).execWrite(sql));}
