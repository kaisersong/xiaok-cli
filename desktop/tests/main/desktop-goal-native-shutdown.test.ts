// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DesktopGoalCoordinator} from '../../electron/desktop-goal-coordinator.js';
import {SqliteGoalStore} from '../../electron/goal-store-sqlite.js';
import {createTaskSourceWriterPopulation,type PersistedTaskEvent,type NativePersistedTaskEventReceipt} from '../../../src/runtime/task-host/task-runtime-host.js';
import {FileTaskSnapshotStore} from '../../../src/runtime/task-host/snapshot-store.js';
import {MaterialRegistry} from '../../../src/runtime/task-host/material-registry.js';
it.each([true,false])('shutdown native Goal audit preserves actual known=%s usage and never starts a continuation',async known=>{
 const root=mkdtempSync(join(tmpdir(),'goal-native-shutdown-')),store=new SqliteGoalStore(join(root,'goals.db')),snapshots=new FileTaskSnapshotStore(join(root,'tasks')),population=createTaskSourceWriterPopulation(snapshots),materials=new MaterialRegistry({workspaceRoot:join(root,'workspace'),maxBytes:1024});
 let entered!:()=>void,release!:()=>void;const ready=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve);let coordinator!:DesktopGoalCoordinator,actual!:PersistedTaskEvent,receipt!:NativePersistedTaskEventReceipt;const prepared=vi.fn(),changed=vi.fn(),runner=vi.fn(async(input:any)=>{if(known)await input.emitUsage({inputTokens:12,outputTokens:3});await input.emitRuntimeEvent({type:'receipt_emitted',sessionId:input.sessionId,turnId:input.taskId,intentId:'answer',stepId:'answer',note:'actual original answer'});});
 const host=population.createHost({materialRegistry:materials,runner,aheGuards:{artifactEvidence:false,recoveryContinuity:false},onPersistedEvent:async input=>{
  if(input.event.type!=='task_terminal')return;actual=input;receipt=population.getNativePersistedEventReceipt(input);entered();await gate;await coordinator.handleNativePersistedTaskEvent(input,receipt);
 }});
 coordinator=new DesktopGoalCoordinator({store,taskHost:host,instanceId:'actual-test-main',publishGoalTaskPrepared:prepared,publishGoalChanged:changed,assertNativePersistedEvent:population.assertNativePersistedEvent});
 try{
  const created=await coordinator.createGoal({threadId:'original-thread',objective:'Original native Goal',expectedEvidenceKinds:['answer'],turnLimit:4});
  await coordinator.ackGoalTaskAttached({threadId:'original-thread',attachmentId:created.preparedTask.attachmentId});await ready;
  coordinator.stopAccepting();population.stopAccepting();population.abortAllActive();const publications=changed.mock.calls.length;
  await expect(coordinator.handlePersistedTaskEvent(actual)).rejects.toThrow('goal_coordinator_closed');
  await expect(coordinator.handleNativePersistedTaskEvent({...actual},receipt)).rejects.toThrow('task_persisted_event_unverified');
  expect(await population.drainWithin(10)).toBe(false);release();
  expect(await population.drainWithin(2000)).toBe(known);const document=(await store.load('original-thread'))!;
  expect(runner).toHaveBeenCalledOnce();expect(prepared).toHaveBeenCalledOnce();expect(changed.mock.calls.length).toBe(publications);
  if(known){expect(document.turns).toHaveLength(1);expect(document.turns[0].tokensUsed).toBe(15);expect(document.state.status).toBe('paused');expect(await coordinator.drainShutdown(0)).toBe(true);await population.closeAfterShutdown(population.getShutdownDrainedReceipt()!);}
  else{expect(document.turns).toHaveLength(0);expect((await snapshots.recoverTask(actual.taskId))?.usage?.known).toBe(false);expect(population.getShutdownDrainedReceipt()).toBeUndefined();expect(await coordinator.drainShutdown(0)).toBe(false);}
  await expect(coordinator.handleNativePersistedTaskEvent(actual,receipt)).rejects.toThrow('task_persisted_event_unverified');
 }finally{release();coordinator.stopAccepting();await population.close().catch(()=>{});store.close();await materials.sealAndDrainInstanceMutations();rmSync(root,{recursive:true,force:true});}
},12000);

it.each([true,false])('the actual ordinary commit crossing shutdown cannot disguise unknown=%s usage as a drained duplicate',async known=>{
 const root=mkdtempSync(join(tmpdir(),'goal-native-commit-race-')),store=new SqliteGoalStore(join(root,'goals.db')),snapshots=new FileTaskSnapshotStore(join(root,'tasks')),population=createTaskSourceWriterPopulation(snapshots),materials=new MaterialRegistry({workspaceRoot:join(root,'workspace'),maxBytes:1024});
 let entered!:()=>void,release!:()=>void;const ready=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve);let coordinator!:DesktopGoalCoordinator;
 const prepared=vi.fn(),runner=vi.fn(async(input:any)=>{if(known)await input.emitUsage({inputTokens:6,outputTokens:2});await input.emitRuntimeEvent({type:'receipt_emitted',sessionId:input.sessionId,turnId:input.taskId,intentId:'original',stepId:'original',note:'Original commit-race answer.'});});
 const host=population.createHost({materialRegistry:materials,runner,aheGuards:{artifactEvidence:false,recoveryContinuity:false},onPersistedEvent:async input=>{if(input.event.type==='task_terminal')await coordinator.handleNativePersistedTaskEvent(input,population.getNativePersistedEventReceipt(input));}});
 coordinator=new DesktopGoalCoordinator({store,taskHost:host,instanceId:'actual-main-race',publishGoalTaskPrepared:prepared,assertNativePersistedEvent:population.assertNativePersistedEvent});
 const commit=store.commit.bind(store);let held=false;const pause=vi.spyOn(store,'commit').mockImplementation(async input=>{if(input.turns.length&&!held){held=true;entered();await gate;}return commit(input);});const close=vi.spyOn(store,'close');
 try{
  const created=await coordinator.createGoal({threadId:'race-thread',objective:'Original ordinary commit',expectedEvidenceKinds:['answer'],turnLimit:4});await coordinator.ackGoalTaskAttached({threadId:'race-thread',attachmentId:created.preparedTask.attachmentId});await ready;
  coordinator.stopAccepting();population.stopAccepting();population.abortAllActive();expect(await population.drainWithin(10)).toBe(false);release();
  expect(await population.drainWithin(2000)).toBe(known);expect(close).not.toHaveBeenCalled();const document=(await store.load('race-thread'))!;
  expect(document.turns).toHaveLength(1);expect(runner).toHaveBeenCalledOnce();expect(prepared).toHaveBeenCalledOnce();expect((await snapshots.recoverTask(created.preparedTask.taskId))?.usage?.known).toBe(known);
  if(known){expect(document.turns[0].tokensUsed).toBe(8);expect(await coordinator.drainShutdown(0)).toBe(true);await population.closeAfterShutdown(population.getShutdownDrainedReceipt()!);}
  else{expect(population.getShutdownDrainedReceipt()).toBeUndefined();expect(await coordinator.drainShutdown(0)).toBe(false);expect(await coordinator.whenShutdownDrained()).toBe(false);}
 }finally{release();await population.close().catch(()=>{});pause.mockRestore();store.close();await materials.sealAndDrainInstanceMutations();rmSync(root,{recursive:true,force:true});}
},12000);
