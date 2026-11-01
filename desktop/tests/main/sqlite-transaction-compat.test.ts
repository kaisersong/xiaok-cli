// @vitest-environment node
import {it,expect} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {isSqliteTransactionActive} from '../../../src/utils/sqlite-transaction-state.js';
const oldApi=(db:DatabaseSync)=>({exec:(sql:string)=>db.exec(sql)});
it('observes a real legacy SQLite connection without leaving a probe transaction or changing caller rows',()=>{
 const db=new DatabaseSync(':memory:');try{
  db.exec('CREATE TABLE rows(value INTEGER)');const old=oldApi(db);
  expect(isSqliteTransactionActive(old)).toBe(false);
  db.exec('BEGIN');db.exec('INSERT INTO rows VALUES(1)');
  expect(isSqliteTransactionActive(old)).toBe(true);expect(db.prepare('SELECT count(*) AS n FROM rows').get()!.n).toBe(1);
  db.exec('ROLLBACK');expect(db.prepare('SELECT count(*) AS n FROM rows').get()!.n).toBe(0);
  expect(isSqliteTransactionActive(old)).toBe(false);
 }finally{db.close();}
});
it('retains the caller SAVEPOINT and handles native boolean state when available',()=>{
 const db=new DatabaseSync(':memory:');try{
  const old=oldApi(db);db.exec('SAVEPOINT caller');
  expect(isSqliteTransactionActive(old)).toBe(true);db.exec('ROLLBACK TO caller');db.exec('RELEASE caller');
  expect(isSqliteTransactionActive(db)).toBe(false);
  db.exec('BEGIN');expect(isSqliteTransactionActive(db)).toBe(true);db.exec('ROLLBACK');
 }finally{db.close();}
});
it('never mistakes unrelated SQLite failures or a closed connection for an inactive transaction',()=>{
 const error=Object.assign(Error('database is locked'),{code:'ERR_SQLITE_ERROR',errcode:5});
 expect(()=>isSqliteTransactionActive({exec:()=>{throw error;}})).toThrow(error);
 const db=new DatabaseSync(':memory:');db.close();expect(()=>isSqliteTransactionActive(oldApi(db))).toThrow();
});
it('propagates native getter and probe rollback errors instead of reporting an idle owner',()=>{
 const failure=Error('owner connection unavailable');
 expect(()=>isSqliteTransactionActive({get isTransaction():boolean{throw failure;},exec:()=>{throw Error('probe must not run');}})).toThrow(failure);
 const db=new DatabaseSync(':memory:');try{
  const legacy={exec(sql:string){if(sql==='ROLLBACK')throw failure;db.exec(sql);}};
  expect(()=>isSqliteTransactionActive(legacy)).toThrow(failure);
  // The failed cleanup remains visible and is still owned by this caller.
  expect(isSqliteTransactionActive(oldApi(db))).toBe(true);db.exec('ROLLBACK');
 }finally{db.close();}
});
