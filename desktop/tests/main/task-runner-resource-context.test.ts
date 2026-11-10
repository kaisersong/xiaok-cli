// @vitest-environment node
import {expect,it} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FileTaskSnapshotStore} from '../../../src/runtime/task-host/snapshot-store.js';
import {MaterialRegistry} from '../../../src/runtime/task-host/material-registry.js';
import {createTaskSourceWriterPopulation,InProcessTaskRuntimeHost,readCurrentOriginalTaskRunnerResourceContext,readOriginalTaskRunnerResourceContext} from '../../../src/runtime/task-host/task-runtime-host.js';
it('propagates only an active original Population execution and revokes it on cancellation and return',async()=>{
 const root=mkdtempSync(join(tmpdir(),'task-resource-context-')),store=new FileTaskSnapshotStore(join(root,'tasks')),population=createTaskSourceWriterPopulation(store),materials=new MaterialRegistry({workspaceRoot:join(root,'materials'),maxBytes:1024});
 let context:object|null=null,started!:()=>void,finish!:()=>void;
 const ready=new Promise<void>(yes=>{started=yes;}),held=new Promise<void>(yes=>{finish=yes;});
 const host=population.createHost({materialRegistry:materials,runner:async()=>{context=readCurrentOriginalTaskRunnerResourceContext();await Promise.resolve();expect(readCurrentOriginalTaskRunnerResourceContext()).toBe(context);started();await held;}});
 const sibling=population.createHost({materialRegistry:materials,runner:async()=>{}}),foreign=new InProcessTaskRuntimeHost({snapshotStore:store,materialRegistry:materials,runner:async()=>{}});
 try{
  expect(readCurrentOriginalTaskRunnerResourceContext()).toBeNull();const task=await host.createTask({prompt:'original resource invocation',materials:[]});await ready;expect(context).not.toBeNull();
  const view=readOriginalTaskRunnerResourceContext(context,host,store);expect(view).toMatchObject({kind:'original_task_runner_resource_context_v1',taskId:task.taskId,executionClass:'main_turn'});view.assertCurrent();expect(readOriginalTaskRunnerResourceContext(context,sibling,store).populationId).toBe(view.populationId);
  expect(()=>readOriginalTaskRunnerResourceContext(context,foreign,store)).toThrow();expect(()=>readOriginalTaskRunnerResourceContext({...context},host,store)).toThrow();
  let traps=0;const fake=new Proxy({},{get(){traps++;throw Error('foreign getter');}});expect(()=>readOriginalTaskRunnerResourceContext(fake,host,store)).toThrow();expect(traps).toBe(0);
  await host.cancelTask(task.taskId);expect(()=>view.assertLocal()).toThrow('TASK_RUNNER_RESOURCE_CONTEXT_CLOSED');finish();await host.drain();expect(()=>view.assertCurrent()).toThrow();expect(readCurrentOriginalTaskRunnerResourceContext()).toBeNull();
 }finally{finish();await host.drain();await sibling.drain();await foreign.drain();rmSync(root,{recursive:true,force:true,maxRetries:5});}
});
