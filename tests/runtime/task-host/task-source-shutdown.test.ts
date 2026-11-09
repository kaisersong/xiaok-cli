import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createTaskSourceWriterPopulation,type PersistedTaskEvent} from '../../../src/runtime/task-host/task-runtime-host.js';
import {FileTaskSnapshotStore} from '../../../src/runtime/task-host/snapshot-store.js';
import {MaterialRegistry} from '../../../src/runtime/task-host/material-registry.js';
const roots:string[]=[];
afterEach(()=>{vi.restoreAllMocks();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture(){const root=mkdtempSync(join(tmpdir(),'task-shutdown-source-'));roots.push(root);const store=new FileTaskSnapshotStore(join(root,'tasks')),population=createTaskSourceWriterPopulation(store),materials=new MaterialRegistry({workspaceRoot:join(root,'workspace'),maxBytes:1024});return {store,population,materials};}
it('shutdown drains real registered consumers before issuing a private receipt and before closing the shared writer',async()=>{
 const f=fixture();let entered!:()=>void,release!:()=>void;const ready=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve);
 const host=f.population.createHost({materialRegistry:f.materials,runner:async()=>{},onPersistedEvent:async input=>{if(input.event.type==='task_started'){entered();await gate;}}});
 await host.prepareTask({prompt:'actual accepted source',materials:[]});await ready;const close=vi.spyOn(f.store,'closeAndDrain');f.population.stopAccepting('app_shutdown');
 try{expect(await f.population.drainWithin(10)).toBe(false);expect(f.population.getShutdownDrainedReceipt()).toBeUndefined();expect(close).not.toHaveBeenCalled();}
 finally{release();}
 expect(await f.population.drainWithin(1000)).toBe(true);const receipt=f.population.getShutdownDrainedReceipt()!;expect(receipt).toBeTruthy();expect(close).not.toHaveBeenCalled();
 await expect(f.population.closeAfterShutdown({} as never)).rejects.toThrow('task_source_shutdown_receipt_invalid');
 const other=fixture();await expect(other.population.closeAfterShutdown(receipt)).rejects.toThrow('task_source_shutdown_receipt_invalid');await other.population.close();
 await f.population.closeAfterShutdown(receipt);expect(close).toHaveBeenCalledOnce();await f.population.closeAfterShutdown(receipt);expect(close).toHaveBeenCalledOnce();
});
it('shutdown abort observes the actual original execution and a deadline cannot manufacture a drained receipt',async()=>{
 const f=fixture();let entered!:()=>void,release!:()=>void,signal:AbortSignal|undefined;const ready=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve);let calls=0;
 const host=f.population.createHost({materialRegistry:f.materials,runner:async input=>{calls++;signal=input.signal;entered();await gate;}});await host.createTask({prompt:'held original execution',materials:[]});await ready;
 f.population.stopAccepting('app_shutdown');f.population.abortAllActive('app_shutdown');expect(signal!.aborted).toBe(true);expect(()=>f.population.createHost({materialRegistry:f.materials,runner:async()=>{}})).toThrow('task_source_population_closing');
 try{expect(await f.population.drainWithin(10)).toBe(false);expect(f.population.getShutdownDrainedReceipt()).toBeUndefined();expect(calls).toBe(1);}finally{release();}
 expect(await f.population.drainWithin(1000)).toBe(true);await f.population.closeAfterShutdown(f.population.getShutdownDrainedReceipt()!);expect(calls).toBe(1);
});
it('native event receipts are bound to the real input, active dispatch and original population',async()=>{
 const f=fixture(),other=fixture();let actual:PersistedTaskEvent|undefined,receipt:unknown;let entered!:()=>void,release!:()=>void;const ready=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve);
 const host=f.population.createHost({materialRegistry:f.materials,runner:async()=>{},onPersistedEvent:async input=>{if(input.event.type!=='task_started')return;actual=input;entered();receipt=f.population.getNativePersistedEventReceipt(input);f.population.assertNativePersistedEvent(input,receipt as never);await gate;}});
 await host.prepareTask({prompt:'real source receipt',materials:[]});await ready;
 try{
  expect(()=>f.population.getNativePersistedEventReceipt({...actual!})).toThrow('task_persisted_event_unverified');
  expect(()=>f.population.assertNativePersistedEvent(actual!,{} as never)).toThrow('task_persisted_event_unverified');
  expect(()=>other.population.assertNativePersistedEvent(actual!,receipt as never)).toThrow('task_persisted_event_unverified');
  const verify=()=>f.population.assertNativePersistedEvent(actual!,receipt as never);
  const createdAt=actual!.snapshot.createdAt;actual!.snapshot.createdAt++;expect(verify).toThrow('task_persisted_event_unverified');actual!.snapshot.createdAt=createdAt;
  const context=actual!.snapshot.context;actual!.snapshot.context={...context,threadId:'substituted-thread'};expect(verify).toThrow('task_persisted_event_unverified');actual!.snapshot.context=context;
  const usage=actual!.snapshot.usage;actual!.snapshot.usage={inputTokens:0,outputTokens:0,known:true};expect(verify).toThrow('task_persisted_event_unverified');actual!.snapshot.usage=usage;verify();
 }finally{release();}
 expect(await f.population.drainWithin(1000)).toBe(true);expect(()=>f.population.assertNativePersistedEvent(actual!,receipt as never)).toThrow('task_persisted_event_unverified');await f.population.closeAfterShutdown(f.population.getShutdownDrainedReceipt()!);await other.population.close();
});
it('a registered consumer failure prevents a shutdown receipt and never closes its dependent writer',async()=>{
 const f=fixture(),failure=Error('actual consumer failed');const host=f.population.createHost({materialRegistry:f.materials,runner:async()=>{},onPersistedEvent:async input=>{if(input.event.type==='task_started')throw failure;}});
 await host.prepareTask({prompt:'actual consumer failure',materials:[]});const close=vi.spyOn(f.store,'closeAndDrain');expect(await f.population.drainWithin(1000)).toBe(false);expect(f.population.getShutdownDrainedReceipt()).toBeUndefined();expect(close).not.toHaveBeenCalled();
 // Explicit migration close retains its preexisting permanent source seal even
 // on unconfirmed IO; this is NOT a successful shutdown receipt.
 await expect(f.population.close()).rejects.toThrow('task_source_close_unconfirmed');
});

it.each(['admission','snapshot'] as const)('shutdown abort fences an original execution still waiting for its %s before any runner exists',async stage=>{
 const f=fixture();let entered!:()=>void,release!:()=>void;const ready=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve);const runner=vi.fn(async()=>{});
 const host=f.population.createHost({materialRegistry:f.materials,runner,...(stage==='admission'?{assertTaskAdmission:async()=>{entered();await gate;}}:{})});
 const task=await host.prepareTask({prompt:'original not yet entered runner',materials:[]});
 if(stage==='snapshot'){const recover=f.store.recoverTask.bind(f.store);let held=false;vi.spyOn(f.store,'recoverTask').mockImplementation(async(...args)=>{if(!held){held=true;entered();await gate;}return recover(...args);});}
 const start=host.startTask(task.taskId);const settled=Promise.allSettled([start]);await ready;f.population.stopAccepting();f.population.abortAllActive();
 try{expect(host.activeExecutionCount()).toBe(1);expect(runner).not.toHaveBeenCalled();expect(await f.population.drainWithin(10)).toBe(false);}finally{release();}
 await settled;expect(await f.population.drainWithin(1000)).toBe(true);expect(runner).not.toHaveBeenCalled();expect((await f.store.recoverTask(task.taskId))?.status).toBe('cancelled');await f.population.closeAfterShutdown(f.population.getShutdownDrainedReceipt()!);
});
