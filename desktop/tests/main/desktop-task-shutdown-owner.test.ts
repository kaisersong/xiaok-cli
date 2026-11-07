// @vitest-environment node
import {Worker} from 'node:worker_threads';
import {expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDesktopTaskShutdownOwner} from '../../electron/desktop-task-shutdown-owner.js';
import {DesktopGoalCoordinator} from '../../electron/desktop-goal-coordinator.js';
import {createDesktopGoalShutdownOwner} from '../../electron/desktop-goal-shutdown-owner.js';
import {SqliteGoalStore} from '../../electron/goal-store-sqlite.js';
import {CodexTaskBridge} from '../../electron/codex-task-bridge.js';
import {JsonKSwarmInitialPlanBootstrapStore,KSwarmInitialPlanBootstrapQueue} from '../../electron/kswarm-initial-plan-bootstrap.js';
import {createTaskSourceWriterPopulation} from '../../../src/runtime/task-host/task-runtime-host.js';
import {FileTaskSnapshotStore} from '../../../src/runtime/task-host/snapshot-store.js';
import {MaterialRegistry} from '../../../src/runtime/task-host/material-registry.js';
it('a synchronous original stop failure still stops siblings and reports drain false without closing dependent writers',async()=>{
 const root=mkdtempSync(join(tmpdir(),'task-stop-fault-')),store=new FileTaskSnapshotStore(join(root,'tasks')),population=createTaskSourceWriterPopulation(store),materials=new MaterialRegistry({workspaceRoot:join(root,'workspace'),maxBytes:1024});
 const host=population.createHost({materialRegistry:materials,runner:async()=>{throw Error('must not execute');}}),goals=new SqliteGoalStore(join(root,'goals.sqlite'));
 const goal=new DesktopGoalCoordinator({store:goals,taskHost:host,instanceId:'original-main',assertNativePersistedEvent:population.assertNativePersistedEvent,assertTaskSourceShutdownDrainedReceipt:population.assertShutdownDrainedReceipt});
 const goalShutdown=createDesktopGoalShutdownOwner(goal,goals),codex=new CodexTaskBridge({dataRoot:root,profileId:'actual-main-user',cwd:root,materialRegistry:materials,snapshotStore:store,sourcePopulation:population}),bootstrap=new KSwarmInitialPlanBootstrapQueue(new JsonKSwarmInitialPlanBootstrapStore(root),async()=>({ok:true}));
 const final=vi.fn(async()=>{await codex.dispose();}),close=vi.spyOn(goals,'close');
 const owner=createDesktopTaskShutdownOwner({population,goal,codex,bootstrap,stopGoal:()=>{goalShutdown.ingress.stopAccepting();throw Error('actual_original_stop_failure');},closeGoal:goalShutdown.durable.close,finalizeServices:final});
 try{
  await expect(owner.ingress.drain(1000)).resolves.toBe(false);
  expect(()=>population.createHost({materialRegistry:materials,runner:async()=>{}})).toThrow('task_source_population_closing');
  expect(()=>codex.authorize({requestSource:'user',actorId:'actual-main-user'})).toThrow('native_access_denied');
  expect(bootstrap.enqueue({projectId:'late',projectName:'late',goal:'late',requirements:'',planningGuidance:'',poAgent:'po',members:[]})).toEqual({ok:false,error:'bootstrap_queue_stopped'});
  await expect(owner.durable.close()).rejects.toThrow('desktop_task_shutdown_not_drained');expect(final).not.toHaveBeenCalled();expect(close).not.toHaveBeenCalled();
 }finally{await population.close();await codex.dispose();goals.close();await materials.sealAndDrainInstanceMutations();rmSync(root,{recursive:true,force:true});}
});

it('an actual auxiliary Worker must exit before population proof and Goal seal; a final source-close failure keeps Goal open',async()=>{
 const root=mkdtempSync(join(tmpdir(),'task-native-worker-close-')),store=new FileTaskSnapshotStore(join(root,'tasks')),population=createTaskSourceWriterPopulation(store),materials=new MaterialRegistry({workspaceRoot:join(root,'workspace'),maxBytes:1024}),goals=new SqliteGoalStore(join(root,'goals.sqlite'));
 const host=population.createHost({materialRegistry:materials,runner:async()=>{}}),goal=new DesktopGoalCoordinator({store:goals,taskHost:host,instanceId:'actual-main',assertNativePersistedEvent:population.assertNativePersistedEvent,assertTaskSourceShutdownDrainedReceipt:population.assertShutdownDrainedReceipt});
 const goalShutdown=createDesktopGoalShutdownOwner(goal,goals),codex=new CodexTaskBridge({dataRoot:root,profileId:'user',cwd:root,materialRegistry:materials,snapshotStore:store,sourcePopulation:population}),bootstrap=new KSwarmInitialPlanBootstrapQueue(new JsonKSwarmInitialPlanBootstrapStore(root),async()=>({ok:true}));
 const worker=new Worker('setInterval(()=>{},1000)',{eval:true}),threadId=worker.threadId;let exited=false;worker.once('exit',()=>{exited=true;});let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(resolve=>release=resolve),ready=new Promise<void>(resolve=>entered=resolve);
 const final=vi.fn(async()=>{await codex.dispose();}),closed=vi.spyOn(goals,'close'),sourceClose=vi.spyOn(store,'closeAndDrain');
 const owner=createDesktopTaskShutdownOwner({population,goal,codex,bootstrap,stopGoal:goalShutdown.ingress.stopAccepting,closeGoal:goalShutdown.durable.close,finalizeServices:final,quiesceAuxiliary:async()=>{entered();await gate;await worker.terminate();}});
 try{
  owner.ingress.stopAccepting();owner.ingress.abortAllActive('app_shutdown');const draining=owner.ingress.drain(2000);await ready;
  expect(await owner.ingress.drain(10)).toBe(false);expect(exited).toBe(false);expect(population.getShutdownDrainedReceipt()).toBeUndefined();expect(sourceClose).not.toHaveBeenCalled();expect(closed).not.toHaveBeenCalled();release();
  expect(await draining).toBe(true);expect(exited).toBe(true);expect(population.getShutdownDrainedReceipt()).toBeTruthy();
  sourceClose.mockRejectedValueOnce(Error('actual_source_close_failure'));
  await expect(owner.durable.close()).rejects.toThrow('task_source_close_unconfirmed');expect(final).not.toHaveBeenCalled();expect(closed).not.toHaveBeenCalled();expect(await goals.load('none')).toBeNull();
  console.log(JSON.stringify({test:'task-auxiliary-worker-close',threadId,actualExitObserved:exited}));
 }finally{release();if(!exited)await worker.terminate();sourceClose.mockRestore();await store.closeAndDrain();await codex.dispose();goals.close();await materials.sealAndDrainInstanceMutations();rmSync(root,{recursive:true,force:true});}
});
