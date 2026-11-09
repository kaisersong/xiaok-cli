// @vitest-environment node
import {expect,it} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FileTaskSnapshotStore} from '../../../src/runtime/task-host/snapshot-store.js';
import {MaterialRegistry} from '../../../src/runtime/task-host/material-registry.js';
import {createTaskSourceWriterPopulation,readOriginalTaskExecutionPhysicalReceipt,readOriginalTaskHostPhysicalFate,withOriginalToolWorkerResource} from '../../../src/runtime/task-host/task-runtime-host.js';
it('original Host drain retains a returned runner promise own-symbol physical tail',async()=>{
 const root=mkdtempSync(join(tmpdir(),'host-physical-tail-')),store=new FileTaskSnapshotStore(join(root,'tasks')),population=createTaskSourceWriterPopulation(store),materials=new MaterialRegistry({workspaceRoot:join(root,'materials'),maxBytes:1024});
 let release!:()=>void,started!:()=>void;const held=new Promise<void>(yes=>{release=yes;}),ready=new Promise<void>(yes=>{started=yes;});
 const host=population.createHost({materialRegistry:materials,runner:()=>{const raw=Promise.resolve();Object.defineProperty(raw,Symbol('runner-physical-child'),{value:held});started();return raw;}});
 let drain:Promise<void>|undefined;
 try{
  const task=await host.createTask({prompt:'Observe original runner SDK physical completion',materials:[]});await ready;
  const receipt=readOriginalTaskExecutionPhysicalReceipt(host,store,task.taskId,null),fate=readOriginalTaskHostPhysicalFate(receipt,host,store,null);expect(()=>fate.assertKnown()).toThrow('TASK_HOST_PHYSICAL_UNCONFIRMED');
  let finished=false;drain=host.drain().then(()=>{finished=true;});let timer:ReturnType<typeof setTimeout>|undefined;
  await Promise.race([drain,new Promise<void>(yes=>{timer=setTimeout(yes,1500);})]);clearTimeout(timer);expect(finished).toBe(false);
  release();await drain;await fate.waitKnown();fate.assertKnown();expect(fate.componentOnly).toBe(true);
  let traps=0;const fake=new Proxy({},{get(){traps++;throw Error('getter');}});expect(()=>readOriginalTaskHostPhysicalFate(fake,host,store,null)).toThrow();expect(()=>readOriginalTaskHostPhysicalFate({...receipt},host,store,null)).toThrow();expect(traps).toBe(0);
 }finally{release();await drain;await host.drain();await store.closeAndDrain();rmSync(root,{recursive:true,force:true,maxRetries:5});}
});

it('an accepted unawaited fixed child remains part of original Host physical completion',async()=>{
 const root=mkdtempSync(join(tmpdir(),'host-child-physical-')),store=new FileTaskSnapshotStore(join(root,'tasks')),population=createTaskSourceWriterPopulation(store),materials=new MaterialRegistry({workspaceRoot:join(root,'materials'),maxBytes:1024});
 let release!:()=>void,started!:()=>void;const held=new Promise<void>(yes=>{release=yes;}),ready=new Promise<void>(yes=>{started=yes;});let child:Promise<unknown>|undefined;
 const host=population.createHost({materialRegistry:materials,runner:async()=>{child=withOriginalToolWorkerResource(async()=>{started();await held;});}});
 try{const task=await host.createTask({prompt:'Original child physical join',materials:[]});await ready;const receipt=readOriginalTaskExecutionPhysicalReceipt(host,store,task.taskId,null),fate=readOriginalTaskHostPhysicalFate(receipt,host,store,null);let finished=false;const wait=fate.waitKnown().then(()=>{finished=true;});await new Promise<void>(yes=>setImmediate(yes));expect(finished).toBe(false);release();await child;await host.drain();await wait;fate.assertKnown();}
 finally{release();await child;await host.drain();await store.closeAndDrain();rmSync(root,{recursive:true,force:true,maxRetries:5});}
});
