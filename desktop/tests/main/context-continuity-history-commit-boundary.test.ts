// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {contextDerivative} from '../fixtures/context-derivative.js';
import {ContinuityPolicyUnavailable} from '../../../src/runtime/context-continuity/policy-denial.js';

// Real original Host runs and physical owner receipts. The injected public
// body-gate denial models the new write fence; it is not OS qualification.
it('prepares the next actual local turn after a real reference consumer without calling its public body gate inside a SQLite write',async()=>{
 const f=await contextDerivative(),port=f.services.continuity.port(),original=port.service.assertTaskReadable;
 const calls:boolean[]=[];
 port.service.assertTaskReadable=function(id:string){calls.push(this.store.db.isTransaction);if(this.store.db.isTransaction)throw new ContinuityPolicyUnavailable('actual_public_gate_write_fence');return original.call(this,id);};
 try{
  const current=await f.read();const threadId=current.snapshot.context!.threadId!;
  const next=await f.services.createTask({prompt:'next actual reference consumer',materials:[],context:{threadId}});
  await vi.waitFor(()=>expect(port.service.store.db.prepare('SELECT 1 FROM effect_owner_receipts WHERE task_id=?').get(next.taskId)).toBeTruthy());
  expect(calls.length).toBeGreaterThan(0);expect(calls).not.toContain(true);
  const after=await f.services.recoverTask(next.taskId);expect(after.snapshot.status).toBe('completed');expect(after.snapshot.result?.summary).toContain('DERIVED_PRIVATE_SOURCE_CANARY');
 }finally{port.service.assertTaskReadable=original;await f.close();}
});
it('registers exact physical raw-history dependency metadata without invoking the public body gate inside the write',async()=>{
 const f=await contextDerivative(),port=f.services.continuity.port(),original=port.service.assertTaskReadable;
 try{
  const current=await f.read(),consumer='future-consumer-metadata-only';
  port.service.assertTaskReadable=function(id:string){if(this.store.db.isTransaction)throw new ContinuityPolicyUnavailable('actual_public_gate_write_fence');return original.call(this,id);};
  expect(()=>port.service.recordEffectHistory(port.actor,consumer,[current.snapshot],true)).not.toThrow();
  expect(port.service.store.db.prepare('SELECT valid FROM effect_history_dependencies WHERE task_id=? AND source_task_id=?').get(consumer,current.snapshot.taskId)?.valid).toBe(1);
  expect(port.service.store.db.prepare('SELECT 1 FROM effect_owner_receipts WHERE task_id=?').get(consumer)).toBeUndefined();
  expect(()=>port.service.assertTaskReadable(consumer)).not.toThrow();
 }finally{port.service.assertTaskReadable=original;await f.close();}
});
