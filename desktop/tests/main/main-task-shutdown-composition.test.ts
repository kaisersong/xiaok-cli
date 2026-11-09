// @vitest-environment node
import {readFileSync} from 'node:fs';
import {compileFunction} from 'node:vm';
import ts from 'typescript';
import type {createDesktopServices} from '../../electron/desktop-services.js';
import type {IngressOwner,DurableStoreOwner} from '../../electron/desktop-shutdown-coordinator.js';
import {expect,it,vi} from 'vitest';
import {task7FactoryFixture} from './task7-factory-fixture.js';
import {CodexNativeService} from '../../electron/codex-native-service.js';
import {DesktopMultiAgentService} from '../../electron/desktop-multi-agent-service.js';
import {DesktopGoalCoordinator} from '../../electron/desktop-goal-coordinator.js';
import {SqliteGoalStore} from '../../electron/goal-store-sqlite.js';
import {DesktopShutdownCoordinator} from '../../electron/desktop-shutdown-coordinator.js';
import {ArtifactWorkspaceService} from '../../electron/artifact-workspace-service.js';
import {OpenAIAdapter} from '../../../src/ai/adapters/openai.js';
// Execute the actual Main registration statements over actual service owners.
// Removing Main's population registration must fail this composition test.
function registeredMainOwners(services:ReturnType<typeof createDesktopServices>){
 const source=readFileSync(new URL('../../electron/main.ts',import.meta.url),'utf8'),ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);
 const registrations:ts.ExpressionStatement[]=[];let unsafeLifetime=false;
 const visit=(node:ts.Node)=>{
  if(ts.isExpressionStatement(node)&&ts.isCallExpression(node.expression)){
   const call=node.expression,name=call.expression.getText(ast);
   if(['desktopIngressOwners.push','desktopDurableStores.push'].includes(name)&&call.arguments.some(arg=>arg.getText(ast).includes('services.taskShutdown')))registrations.push(node);
   if(name==='registerLifetimeDisposerStep'&&call.arguments.some(arg=>arg.getText(ast).includes('services.disposeMultiAgent')))unsafeLifetime=true;
  }ts.forEachChild(node,visit);
 };visit(ast);expect(registrations).toHaveLength(2);expect(unsafeLifetime).toBe(false);
 const ingress:IngressOwner[]=[],durable:DurableStoreOwner[]=[];
 compileFunction(registrations.map(node=>node.getText(ast)).join('\n'),['services','desktopIngressOwners','desktopDurableStores'])(services,ingress,durable);
 expect(ingress).toEqual([services.goalShutdown.ingress,services.kswarmBootstrapShutdown,services.taskShutdown.ingress]);expect(durable).toEqual([services.taskShutdown.durable]);return {ingress,durable};
}
it.each(['known','unknown','consumer_failure','deadline','commit_known','commit_unknown'] as const)('actual Main task shutdown waits its registered native Goal tail before closing its writer (%s)',async scenario=>{
 const known=!['unknown','commit_unknown'].includes(scenario),qualified=['known','deadline','commit_known'].includes(scenario),commitCrossing=scenario.startsWith('commit_');
 const close=vi.spyOn(SqliteGoalStore.prototype,'close');
 const f=await task7FactoryFixture({status:'completed',events:[]},qualified?{}:{expectedSourceCloseFailure:'task_source_close_unconfirmed'});vi.spyOn(OpenAIAdapter.prototype,'stream').mockImplementation(async function*(){if(known)yield {type:'usage',usage:{inputTokens:7,outputTokens:2}};yield {type:'text',delta:'Original Goal answer.'};yield {type:'done'};});
 let entered!:()=>void,release!:()=>void;const ready=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve);
 const native=DesktopGoalCoordinator.prototype.handleNativePersistedTaskEvent;
 vi.spyOn(DesktopGoalCoordinator.prototype,'handleNativePersistedTaskEvent').mockImplementation(async function(input,receipt){if(input.event.type==='task_terminal'&&!commitCrossing){entered();await gate;}return native.call(this,input,receipt);});
 if(scenario==='consumer_failure'){const project=ArtifactWorkspaceService.prototype.handlePersistedTaskEvent;vi.spyOn(ArtifactWorkspaceService.prototype,'handlePersistedTaskEvent').mockImplementation(async function(input){if(input.event.type==='task_terminal')throw Error('actual artifact consumer IO failure');return project.call(this,input);});}
 if(commitCrossing){const originalCommit=SqliteGoalStore.prototype.commit;let held=false;vi.spyOn(SqliteGoalStore.prototype,'commit').mockImplementation(async function(input){if(input.turns.length&&!held){held=true;entered();await gate;}return originalCommit.call(this,input);});}
 const physicalOrder:string[]=[];
 const nativeClose=CodexNativeService.prototype.quiesceShutdown,groupClose=DesktopMultiAgentService.prototype.quiesceShutdown,seal=DesktopGoalCoordinator.prototype.sealNativePersistedTail;
 const nativeObserved=new WeakMap<CodexNativeService,Promise<void>>(),groupObserved=new WeakMap<DesktopMultiAgentService,Promise<void>>();
 vi.spyOn(CodexNativeService.prototype,'quiesceShutdown').mockImplementation(function(){let actual=nativeObserved.get(this);if(!actual){actual=nativeClose.call(this);nativeObserved.set(this,actual);void actual.then(()=>physicalOrder.push('native_closed'),()=>{});}return actual;});
 vi.spyOn(DesktopMultiAgentService.prototype,'quiesceShutdown').mockImplementation(function(){let actual=groupObserved.get(this);if(!actual){actual=groupClose.call(this);groupObserved.set(this,actual);void actual.then(()=>physicalOrder.push('group_closed'),()=>{});}return actual;});
 vi.spyOn(DesktopGoalCoordinator.prototype,'sealNativePersistedTail').mockImplementation(function(receipt){seal.call(this,receipt);physicalOrder.push('goal_sealed');});
 const loads=vi.spyOn(SqliteGoalStore.prototype,'load');
 const created=await f.service.createGoal({threadId:'shutdown-goal',objective:'Original shutdown Goal',expectedEvidenceKinds:['answer'],turnLimit:4});await f.service.ackGoalTaskAttached({threadId:'shutdown-goal',attachmentId:created.preparedTask.attachmentId});await ready;
 const store=loads.mock.contexts.find(value=>value instanceof SqliteGoalStore)!;
 try{
  const owner=f.service.taskShutdown;
  if(scenario==='deadline'){
   const pin=vi.fn(async()=>{}),continuation=vi.fn(),registered=registeredMainOwners(f.service);
   const shutdown=new DesktopShutdownCoordinator({gate:f.gate,providerRuntime:{beginShutdown:()=>({leases:[],waitForSettled:async()=>true}),hideAndAbortNonProtected(){},closeOrdinaryProviders:async()=>({cleanupFailed:[]})},
    ingressOwners:registered.ingress,durableStores:registered.durable,destroyWindows(){},disposeLifetimeResources:async()=>{},releaseMainSourcePin:pin,continuation,ordinaryCleanupDeadlineMs:10});
   const first=shutdown.onBeforeQuit();expect(shutdown.onBeforeQuit().shutdown).toBe(first.shutdown);const report=await first.shutdown;
   expect(report.ordinaryDrained).toBe(false);expect(report.storesClosed).toBe(false);expect(close).not.toHaveBeenCalled();expect(pin).not.toHaveBeenCalled();expect(continuation).toHaveBeenCalledOnce();
   release();expect(await owner.ingress.drain(3000)).toBe(true);expect(close).not.toHaveBeenCalled();expect(pin).not.toHaveBeenCalled();expect(shutdown.onBeforeQuit().preventDefault).toBe(false);expect(continuation).toHaveBeenCalledOnce();
   // Explicit test teardown only; a late real drain did not reopen phase six.
   await owner.durable.close();return;
  }
  owner.ingress.stopAccepting();owner.ingress.abortAllActive('app_shutdown');
  expect(await owner.ingress.drain(10)).toBe(false);expect(close).not.toHaveBeenCalled();expect((await store.load('shutdown-goal'))!.turns).toHaveLength(0);release();
  expect(await owner.ingress.drain(3000)).toBe(qualified);
  if(qualified){expect(physicalOrder.indexOf('native_closed')).toBeGreaterThanOrEqual(0);expect(physicalOrder.indexOf('group_closed')).toBeGreaterThanOrEqual(0);expect(physicalOrder.indexOf('goal_sealed')).toBeGreaterThan(physicalOrder.indexOf('native_closed'));expect(physicalOrder.indexOf('goal_sealed')).toBeGreaterThan(physicalOrder.indexOf('group_closed'));expect((await store.load('shutdown-goal'))!.turns[0].tokensUsed).toBe(9);await owner.durable.close();expect(close).toHaveBeenCalledOnce();await owner.durable.close();expect(close).toHaveBeenCalledOnce();}
  else{await expect(owner.durable.close()).rejects.toThrow('desktop_task_shutdown_not_drained');expect(close).not.toHaveBeenCalled();expect((await store.load('shutdown-goal'))!.turns).toHaveLength(commitCrossing?1:known?1:0);}
  expect(f.hostCalls.start).toHaveBeenCalledOnce();
 }finally{release();if(!qualified){await expect(f.service.closeTaskSourceWritersForMigration()).rejects.toThrow('task_source_close_unconfirmed');await f.service.disposeMultiAgent();store.close();}}
},15000);
