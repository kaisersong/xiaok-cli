import {it,expect,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {TimedActionStore} from '../../electron/timed-action-store.js';
import {LoopStore} from '../../electron/loop-store.js';
import {createLoopTimedCompletionHost} from '../../electron/loop-timed-completion.js';
function fixture(){const root=mkdtempSync(join(tmpdir(),'loop-timed-host-')),timedStore=new TimedActionStore(join(root,'timed.sqlite')),loopStore=new LoopStore(join(root,'loop.sqlite')),loopId='artifact-evidence-regression';loopStore.ensureBuiltInLoops(1);timedStore.createAction({id:'action',title:'Original',trigger:{kind:'once',at:5},executor:{kind:'loop',loopId},source:'user',now:1});const [claimed]=timedStore.claimDueActions(5,1,{recoveryReason:'normal_tick'});timedStore.markRunRunning('action',claimed.runId,5);const began=loopStore.beginLoopRun(loopId,{kind:'scheduled',timedActionId:'action',timedActionRunId:claimed.runId,scheduledDueAt:5},6,1000,{requestSource:'scheduler'});if(began.status!=='started')throw Error('begin');loopStore.finishLoopRunSuccess(began.run.id,[],10,'Original result');const host=createLoopTimedCompletionHost({timedStore,loopStore,captureAdmission:()=>()=>{},now:()=>11});return{root,timedStore,loopStore,host,input:{actionId:'action',timedRunId:claimed.runId,loopRunId:began.run.id,mode:'normal' as const,requestSource:'scheduler' as const},async close(){await host.close();timedStore.close();loopStore.close();rmSync(root,{recursive:true,force:true});}};}
it('actual two-store ordinary completion counts once and receipt confirms lost ACK without another write',async()=>{
 const f=fixture();try{expect(await f.host.finalize(f.input)).toMatchObject({status:'applied',disposition:'committed',outcome:'success'});expect(f.timedStore.getAction('action')).toMatchObject({status:'completed',runCount:1});const version=f.timedStore.getAutomationStoreVersion();expect(await f.host.finalize(f.input)).toMatchObject({status:'already_applied',disposition:'committed',outcome:'success'});expect(f.timedStore.getAutomationStoreVersion()).toBe(version);expect(f.timedStore.listRuns('action')[0].status).toBe('success');}finally{await f.close();}
});
it('receipt blocks history deletion and tombstone preserves ACK recovery',async()=>{
 const f=fixture();try{await f.host.finalize(f.input);expect(f.timedStore.clearActionRunHistory('action')).toBe(0);expect(f.timedStore.deleteAction('action')).toBe(true);expect(f.timedStore.getAction('action')).toBeUndefined();expect(f.timedStore.listRuns('action')).toHaveLength(1);expect(await f.host.finalize(f.input)).toMatchObject({status:'already_applied',outcome:'success'});expect(()=>f.timedStore.createAction({id:'action',title:'Different',trigger:{kind:'once',at:15},executor:{kind:'loop',loopId:'other'},source:'user',now:12})).toThrow();}finally{await f.close();}
});
it('cancel before completion rejects only the original run without advancing the action',async()=>{
 const f=fixture();try{f.timedStore.cancelAction('action','user cancelled',10);expect(await f.host.finalize(f.input)).toMatchObject({status:'applied',disposition:'rejected',outcome:'rejected'});expect(f.timedStore.getAction('action')).toMatchObject({status:'cancelled',runCount:0});}finally{await f.close();}
});
it('committed receipt resists later failure and running writers',async()=>{
 const f=fixture();try{await f.host.finalize(f.input);const before=f.timedStore.listRuns('action');f.timedStore.finishRunFailure('action',f.input.timedRunId,15,'late ACK error');expect(()=>f.timedStore.markRunRunning('action',f.input.timedRunId,16)).toThrow();expect(f.timedStore.listRuns('action')).toEqual(before);}finally{await f.close();}
});
it('a private timed completion ticket burns on a wrong store',async()=>{
 const f=fixture(),other=new TimedActionStore(join(f.root,'other.sqlite')),original=f.timedStore.applyLoopTimedCompletion.bind(f.timedStore);const spy=vi.spyOn(f.timedStore,'applyLoopTimedCompletion').mockImplementation(ticket=>{expect(()=>other.applyLoopTimedCompletion(ticket)).toThrow('ticket');expect(()=>original(ticket)).toThrow('ticket');throw Error('burned');});try{expect(await f.host.finalize(f.input)).toMatchObject({status:'retry_pending'});expect(f.timedStore.getAction('action')?.runCount).toBe(0);}finally{spy.mockRestore();other.close();await f.close();}
});

import {DatabaseSync} from 'node:sqlite';
it.each(['version','action','tombstone','loop'] as const)('actual SQL tail %s mutation rolls back the entire timed completion',async fault=>{
 const f=fixture(),db=new DatabaseSync(join(f.root,'timed.sqlite'));try{
  if(fault==='loop'){const internal=(f.timedStore as unknown as {db:DatabaseSync}).db;internal.function('change_loop',()=>{f.loopStore.setLoopStatus('artifact-evidence-regression','paused',12);return 0;});}
  const effect=fault==='version'?"UPDATE automation_store_metadata SET value=OLD.value WHERE key='version'":fault==='action'?"UPDATE timed_actions SET title='changed' WHERE id='action'":fault==='tombstone'?"INSERT OR IGNORE INTO loop_timed_action_tombstones(action_id,deleted_at) VALUES('action',12)":"SELECT change_loop()";
  (fault==='loop'?(f.timedStore as unknown as {db:DatabaseSync}).db:db).exec(`CREATE TRIGGER corrupt_completion_tail AFTER UPDATE ON automation_store_metadata WHEN EXISTS(SELECT 1 FROM loop_timed_completion_receipts) BEGIN ${effect}; END`);
  expect(await f.host.finalize(f.input)).toMatchObject({status:'retry_pending'});expect(f.timedStore.listRuns('action')[0].status).toBe('running');expect(f.timedStore.getAction('action')).toMatchObject({runCount:0,lockedRunId:f.input.timedRunId});expect(f.timedStore.getLoopTimedReceipt(f.input.timedRunId)).toBeUndefined();
 }finally{db.close();await f.close();}
});
it('legacy pending remains in migration population and cannot be cleared or physically deleted',async()=>{
 const f=fixture(),db=new DatabaseSync(join(f.root,'timed.sqlite'));try{db.prepare("UPDATE timed_action_runs SET status='publication_pending' WHERE run_id=?").run(f.input.timedRunId);expect(await f.host.finalize(f.input)).toMatchObject({status:'retry_pending'});expect(f.timedStore.listLoopTimedReconciliation()).toContainEqual({actionId:'action',timedRunId:f.input.timedRunId});expect(f.timedStore.clearActionRunHistory('action')).toBe(0);f.timedStore.deleteAction('action');expect(f.timedStore.listRuns('action')[0].status).toBe('publication_pending');expect(f.timedStore.getLoopTimedReceipt(f.input.timedRunId)).toBeUndefined();}finally{db.close();await f.close();}
});
it('actual receipt foreign key prevents deleting its original run',async()=>{
 const f=fixture();try{await f.host.finalize(f.input);const db=(f.timedStore as unknown as {db:DatabaseSync}).db;expect(()=>db.prepare('DELETE FROM timed_action_runs WHERE run_id=?').run(f.input.timedRunId)).toThrow();expect(f.timedStore.getLoopTimedReceipt(f.input.timedRunId)?.outcome).toBe('success');}finally{await f.close();}
});

it('changing the original claimed action definition rejects the old run and releases only its old lock',async()=>{
 const f=fixture();try{f.timedStore.updateActionDefinition('action',{title:'Changed',trigger:{kind:'once',at:99},executor:{kind:'loop',loopId:'kswarm-service-health'},now:10});expect(await f.host.finalize(f.input)).toMatchObject({status:'applied',outcome:'rejected'});expect(f.timedStore.getAction('action')).toMatchObject({title:'Changed',runCount:0,lockedRunId:undefined});}finally{await f.close();}
});

import {createHash} from 'node:crypto';
import {canonicalVerificationJson} from '../../../src/runtime/verification/protocol.js';
it.each(['outcome','mode','pending','decision','extra'] as const)('rejects malformed durable receipt %s even with a recomputed content hash',async fault=>{
 const f=fixture();try{await f.host.finalize(f.input);const db=(f.timedStore as unknown as {db:DatabaseSync}).db,receipt=JSON.parse(JSON.stringify(f.timedStore.getLoopTimedReceipt(f.input.timedRunId)));
 if(fault==='outcome')receipt.outcome='publication_pending';else if(fault==='mode')receipt.mode='caller-success';else if(fault==='pending')receipt.pendingAction=receipt.after.action;else if(fault==='decision')receipt.decision.loopRunId='other';else receipt.unrecognized=true;
 const bytes=canonicalVerificationJson(receipt);db.prepare('UPDATE loop_timed_completion_receipts SET record_json=?,record_hash=? WHERE timed_run_id=?').run(bytes,createHash('sha256').update(bytes).digest('hex'),f.input.timedRunId);
 expect(()=>f.timedStore.getLoopTimedReceipt(f.input.timedRunId)).toThrow('loop_timed_receipt_corrupt');
 }finally{await f.close();}
});
it.each(['source','accessor','aborted'] as const)('denies %s before durable completion',async fault=>{
 const f=fixture();try{let input:any={...f.input};const read=vi.fn(()=>f.input.actionId);if(fault==='source')input.requestSource='agent';else if(fault==='accessor')Object.defineProperty(input,'actionId',{get:read,enumerable:true});else input.signal=AbortSignal.abort();await expect(f.host.finalize(input)).rejects.toThrow();expect(read).not.toHaveBeenCalled();expect(f.timedStore.getAction('action')?.runCount).toBe(0);expect(f.timedStore.getLoopTimedReceipt(f.input.timedRunId)).toBeUndefined();}finally{await f.close();}
});
it('reopens the original durable receipt after a lost acknowledgment without counting again',async()=>{
 const f=fixture();let reopened:TimedActionStore|undefined,host:ReturnType<typeof createLoopTimedCompletionHost>|undefined;try{await f.host.finalize(f.input);await f.host.close();reopened=new TimedActionStore(join(f.root,'timed.sqlite'));host=createLoopTimedCompletionHost({timedStore:reopened,loopStore:f.loopStore,captureAdmission:()=>()=>{},now:()=>20});const version=reopened.getAutomationStoreVersion();expect(await host.finalize(f.input)).toMatchObject({status:'already_applied',outcome:'success'});expect(reopened.getAction('action')?.runCount).toBe(1);expect(reopened.getAutomationStoreVersion()).toBe(version);}finally{await host?.close();reopened?.close();await f.close();}
});
it('an open host confirms a committed historical receipt without re-entering revoked write admission',async()=>{
 const f=fixture(),capture=vi.fn(()=>{throw Error('write admission revoked');}),host=createLoopTimedCompletionHost({timedStore:f.timedStore,loopStore:f.loopStore,captureAdmission:capture});try{await f.host.finalize(f.input);expect(await host.finalize(f.input)).toMatchObject({status:'already_applied',outcome:'success'});expect(capture).not.toHaveBeenCalled();await host.close();await expect(host.finalize(f.input)).rejects.toThrow('closed');}finally{await host.close();await f.close();}
});
it('an inactive original Loop rejects its unconsumed timed occurrence without advancing it',async()=>{
 const f=fixture();try{f.loopStore.setLoopStatus('artifact-evidence-regression','paused',10);expect(await f.host.finalize(f.input)).toMatchObject({status:'applied',outcome:'rejected'});expect(f.timedStore.getAction('action')?.runCount).toBe(0);}finally{await f.close();}
});
it('cancelled occurrence cannot attach a different candidate Loop run to its rejection receipt',async()=>{
 const f=fixture();try{const other=f.loopStore.beginLoopRun('artifact-evidence-regression',{kind:'manual'},10,1000,{requestSource:'user'});if(other.status!=='started')throw Error('begin');f.timedStore.cancelAction('action','user',10);await expect(f.host.finalize({...f.input,loopRunId:other.run.id})).rejects.toThrow('identity');expect(f.timedStore.getLoopTimedReceipt(f.input.timedRunId)).toBeUndefined();expect(await f.host.finalize(f.input)).toMatchObject({outcome:'rejected'});}finally{await f.close();}
});
import {createLoopExecutor} from '../../electron/loop-executor.js';
import {TimedActionScheduler} from '../../electron/timed-action-scheduler.js';
it('actual executing Loop executor keeps its timed occurrence awaiting and later reconciles without reexecution',async()=>{
 const f=fixture(),run=vi.fn(async(_id:any,trigger:any)=>{const began=f.loopStore.beginLoopRun('kswarm-service-health',trigger,10,1000,{requestSource:'scheduler'});if(began.status!=='started')throw Error('begin');return {status:'executing' as const,run:began.run};});
 const scheduler=new TimedActionScheduler(f.timedStore,{loopCompletion:f.host,executors:{loop:createLoopExecutor({runLoop:run})},now:()=>10});
 try{await f.host.finalize(f.input);f.timedStore.createAction({id:'awaiting',title:'Awaiting',executor:{kind:'loop',loopId:'kswarm-service-health'},trigger:{kind:'once',at:10},source:'user',now:1});await scheduler.runOnce();await vi.waitFor(()=>expect(run).toHaveBeenCalledTimes(1));await new Promise(r=>setTimeout(r,10));expect(f.timedStore.listRuns('awaiting')[0].status).toBe('running');expect(f.timedStore.getAction('awaiting')).toMatchObject({runCount:0,lockedRunId:expect.any(String)});await scheduler.runOnce();expect(run).toHaveBeenCalledTimes(1);const original=f.loopStore.listLoopRuns('kswarm-service-health',1)[0];f.loopStore.finishLoopRunSuccess(original.id,[],10,'Original');await scheduler.runOnce();expect(f.timedStore.getAction('awaiting')).toMatchObject({runCount:1,status:'completed'});expect(run).toHaveBeenCalledTimes(1);}finally{scheduler.stopAccepting();await f.close();}
});
