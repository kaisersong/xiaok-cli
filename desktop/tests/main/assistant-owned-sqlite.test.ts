// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
const originalExec=DatabaseSync.prototype.exec;
afterEach(()=>{vi.restoreAllMocks();vi.resetModules();});
async function fixture(fault?:(sql:string,run:()=>void)=>void){
 const calls:string[]=[];
 vi.spyOn(DatabaseSync.prototype,'exec').mockImplementation(function(sql:string){calls.push(sql);if(fault)return fault(sql,()=>Reflect.apply(originalExec,this,[sql]));return Reflect.apply(originalExec,this,[sql]);});
 vi.resetModules();
 const owner=await import('../../electron/loop-database-owner.js'),sdk=await import('../../electron/assistant-owned-sqlite.js');
 const group=owner.createLoopDatabaseOwnerGroup([':memory:']),lease=owner.openLoopDatabase(group.sources[0]!),db=lease.database;
 lease.execWrite('CREATE TABLE sample(value INTEGER NOT NULL);INSERT INTO sample VALUES(1)');
 return {group,lease,db,sdk,calls};
}
it('rolls back only the genuine unique inner savepoint and preserves a bare undefined primary',async()=>{
 const f=await fixture();try{
  f.lease.execWrite('SAVEPOINT original_outer');let caught=false;
  try{f.sdk.assistantOwnedSavepoint(f.db,f.lease,()=>{f.lease.runWrite('INSERT INTO sample VALUES(2)');throw undefined;});}catch(raw){caught=true;expect(raw).toBeUndefined();}
  expect(caught).toBe(true);expect(f.db.prepare('SELECT value FROM sample').all().map(r=>r.value)).toEqual([1]);
  const starts=f.calls.filter(sql=>sql.startsWith('SAVEPOINT assistant_quality_'));
  expect(starts).toHaveLength(1);expect(starts[0]).toMatch(/^SAVEPOINT assistant_quality_[a-f0-9]{32}$/);
  expect(f.calls).toContain('ROLLBACK TO '+starts[0].slice('SAVEPOINT '.length));expect(f.calls).toContain('RELEASE '+starts[0].slice('SAVEPOINT '.length));
  f.lease.execWrite('RELEASE original_outer');
 }finally{f.lease.close();f.group.close();}
});
it.each(['rollback-before','rollback-after','release-before','release-after'] as const)('attempts both original negative commands, retains the primary and stops later reads/writes after %s',async mode=>{
 let entered=false;
 const f=await fixture((sql,run)=>{const chosen=mode.startsWith('rollback')?sql.startsWith('ROLLBACK TO assistant_quality_'):sql.startsWith('RELEASE assistant_quality_');if(entered&&chosen){entered=false;if(mode.endsWith('after'))run();throw undefined;}run();});
 try{
  const first=Object.freeze({kind:'original-business-rejection'});entered=true;let caught:unknown;
  try{f.sdk.assistantOwnedSavepoint(f.db,f.lease,()=>{throw first;});}catch(raw){caught=raw;}
  expect(caught).toBe(first);const rollback=f.calls.find(sql=>sql.startsWith('ROLLBACK TO assistant_quality_'));
  expect(rollback).toBeDefined();expect(f.calls).toContain('RELEASE '+rollback!.slice('ROLLBACK TO '.length));
  expect(()=>f.sdk.assistantOwnedGet(f.db,f.lease,'SELECT value FROM sample')).toThrow('loop_database_closed');
  expect(()=>f.lease.runWrite('INSERT INTO sample VALUES(3)')).toThrow('loop_database_closed');
 }finally{f.lease.close();f.group.close();}
});
it('rejects a foreign DB and hostile lease before callback/Proxy observation',async()=>{
 const f=await fixture(),other=new DatabaseSync(':memory:');let traps=0,callbacks=0;
 const foreign=new Proxy({}, {get(){traps++;throw Error('trap');},getPrototypeOf(){traps++;throw Error('trap');},ownKeys(){traps++;throw Error('trap');}});
 try{
  expect(()=>f.sdk.assistantOwnedSqlite(other,f.lease,()=>{callbacks++;})).toThrow('loop_database_lease');
  expect(()=>f.sdk.assistantOwnedSqlite(f.db,foreign as never,()=>{callbacks++;})).toThrow('loop_database_lease');
  expect(traps).toBe(0);expect(callbacks).toBe(0);
 }finally{other.close();f.lease.close();f.group.close();}
});
it('keeps an actual SDK bare undefined and rejects subsequent work while allowing original negative close',async()=>{
 let fail=false;const f=await fixture((sql,run)=>{if(fail&&sql==='SELECT 41'){fail=false;throw undefined;}run();});
 try{fail=true;let caught=false;try{f.sdk.assistantOwnedExec(f.db,f.lease,'SELECT 41');}catch(raw){caught=true;expect(raw).toBeUndefined();}
  expect(caught).toBe(true);expect(()=>f.sdk.assistantOwnedGet(f.db,f.lease,'SELECT value FROM sample')).toThrow('loop_database_closed');
 }finally{f.lease.close();f.group.close();}
});
it('does not turn a held error tail into known by cleanup; the original Promise must actually settle',async()=>{
 let resolve!:()=>void;const tail=new Promise<void>(yes=>{resolve=yes;}),raw=Object.assign(Error('original-sdk'),{tail});let fail=false;
 const f=await fixture((sql,run)=>{if(fail&&sql==='SELECT 42'){fail=false;throw raw;}run();});
 try{fail=true;expect(()=>f.sdk.assistantOwnedExec(f.db,f.lease,'SELECT 42')).toThrow(raw);
  expect(()=>f.group.close()).toThrow();expect(()=>f.lease.runWrite('INSERT INTO sample VALUES(3)')).toThrow('loop_database_closed');
  resolve();await tail;await Promise.resolve();
 }finally{resolve();await tail;f.lease.close();f.group.close();}
});
