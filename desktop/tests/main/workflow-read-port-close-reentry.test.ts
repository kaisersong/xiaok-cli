// @vitest-environment node
import type {KSwarmService} from '../../electron/kswarm-service.js';
import {realpathSync} from 'node:fs';
import {resolve} from 'node:path';
const repositoryRoot=process.env.XIAOK_WORKFLOW_TEST_REPO_ROOT||resolve(import.meta.dirname,'../../..');
import {it,expect,vi} from 'vitest';
import {createOwnedWorkflowNetworkFixture} from '../support/owned-workflow-network-fixture.mjs';
vi.mock('electron',()=>({app:{isPackaged:false}}));
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};};
it.each(['port','service'] as const)('real held GET: %s close reentry returns the identical cached promise and waits for its read',async(mode)=>{
 const fixture=await createOwnedWorkflowNetworkFixture(null);const previousFetch=globalThis.fetch,priorEntry=process.env.KSWARM_SERVER_PATH;
 const entered=deferred(),release=deferred();let ks:KSwarmService|undefined,reading,closing,reentered;let acknowledged=false;
 try{
  globalThis.fetch=fixture.forwardedFetch;process.env.KSWARM_SERVER_PATH=realpathSync(resolve(repositoryRoot,'..','kswarm','src/server/index.js'));
  const serviceModule=await import('../../electron/kswarm-service.ts');
  const check=await import('../../../src/runtime/task-host/workflow-restriction-checkpoint.ts');
  ks=serviceModule.createKSwarmService({spawnProcess:(()=>{throw Error('fixture_foreign_spawn_denied');}) as never,findPortOwner:async()=>null,killStalePortOwner:async()=>{throw Error('fixture_foreign_kill_denied');}});
  const port=await serviceModule.getKSwarmWorkflowReadPort(ks);
  globalThis.fetch=async(input,init)=>{
   const response=await fixture.forwardedFetch(input,init);
   if(new URL(String(input)).pathname==='/projects/project'){
    init!.signal!.addEventListener('abort',()=>{reentered=mode==='port'?check.closeNativeWorkflowReadPort(port):serviceModule.sealAndDrainKSwarmServiceInstance(ks!);},{once:true});
    entered.resolve();await release.promise;
   }
   return response;
  };
  const handoff=fixture.issued.dispatches[0];
  reading=check.createNativeWorkflowRestrictionCheckpoint(port,{projectId:handoff.projectId,workflowRunId:handoff.workflowRunId,workflowId:handoff.workflowId,nodeId:handoff.nodeId,nodeKind:handoff.nodeKind,attempt:handoff.attempt,handoffId:handoff.handoffId,participantId:'xiaok-worker',admittedRoot:fixture.workspace.path}).then(value=>({ok:true as const,value}),error=>({ok:false as const,error}));
  await entered.promise;
  closing=mode==='port'?check.closeNativeWorkflowReadPort(port):serviceModule.sealAndDrainKSwarmServiceInstance(ks);
  closing.then(()=>{acknowledged=true;});
  await Promise.resolve();await Promise.resolve();expect(acknowledged).toBe(false);
  expect(reentered).toBe(closing);
  release.resolve();await closing;expect(acknowledged).toBe(true);
  expect((await reading).ok).toBe(false);expect(()=>check.assertNativeWorkflowReadPort(port)).toThrow('workflow_stored_restrictions_denied');
  console.log(JSON.stringify({mode,sameCachedPromise:true,heldReadPreventedEarlyAck:true,closedPortDenied:true,actualHTTP:true}));
 }finally{
  release.resolve();await reading;await closing;await reentered;
  if(ks){const module=await import('../../electron/kswarm-service.ts');await module.sealAndDrainKSwarmServiceInstance(ks);}
  globalThis.fetch=previousFetch;if(priorEntry===undefined)delete process.env.KSWARM_SERVER_PATH;else process.env.KSWARM_SERVER_PATH=priorEntry;
  await fixture.close();
 }
},8000);
