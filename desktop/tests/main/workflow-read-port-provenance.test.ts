import type {KSwarmService} from '../../electron/kswarm-service.js';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const repositoryRoot=process.env.XIAOK_WORKFLOW_TEST_REPO_ROOT||fileURLToPath(new URL('../../../',import.meta.url));
import {it,expect,vi} from 'vitest';
import {createOwnedWorkflowNetworkFixture} from '../support/owned-workflow-network-fixture.mjs';
vi.mock('electron',()=>({app:{isPackaged:false}}));
it('actual factory admits its port; fake/copied/replaced/sealed services reject without invoking supplied callbacks',async()=>{
 const fixture=await createOwnedWorkflowNetworkFixture(null);const previousFetch=globalThis.fetch;let ks:KSwarmService|undefined;let callbacks=0;
 const priorEntry=process.env.KSWARM_SERVER_PATH;
 try{
  globalThis.fetch=fixture.forwardedFetch;process.env.KSWARM_SERVER_PATH=resolve(repositoryRoot,'..','kswarm','src/server/index.js');
  const module=await import('../../electron/kswarm-service.ts');
  const checks=await import('../../../src/runtime/task-host/workflow-restriction-checkpoint.ts');
  const arbitrary={request:async()=>{callbacks++;throw Error('foreign_callback_must_never_run');}};
  await expect(Promise.resolve().then(()=>module.getKSwarmWorkflowReadPort(arbitrary as never))).rejects.toThrow();expect(callbacks).toBe(0);
  ks=module.createKSwarmService({spawnProcess:(()=>{throw Error('fixture_foreign_spawn_denied');}) as never,findPortOwner:async()=>null,killStalePortOwner:async()=>{throw Error('fixture_foreign_kill_denied');}});
  await expect(Promise.resolve().then(()=>module.getKSwarmWorkflowReadPort({...ks!}))).rejects.toThrow();
  const port=await module.getKSwarmWorkflowReadPort(ks);checks.assertNativeWorkflowReadPort(port);
  expect(()=>checks.assertNativeWorkflowReadPort({...port})).toThrow('workflow_stored_restrictions_denied');
  const original=ks.request;ks.request=arbitrary.request;
  await expect(Promise.resolve().then(()=>module.getKSwarmWorkflowReadPort(ks!))).rejects.toThrow();expect(callbacks).toBe(0);
  ks.request=original;
  await module.sealAndDrainKSwarmServiceInstance(ks);
  await expect(Promise.resolve().then(()=>module.getKSwarmWorkflowReadPort(ks!))).rejects.toThrow();
  expect(()=>checks.assertNativeWorkflowReadPort(port)).toThrow('workflow_stored_restrictions_denied');
  expect(callbacks).toBe(0);
  console.log(JSON.stringify({actualFactory:true,fakeCallbacks:callbacks,copiedServiceDenied:true,replacedGetterDenied:true,sealedOldPortDenied:true,oldPortReplacementDetectionClaim:false}));
 }finally{
  if(ks){const module=await import('../../electron/kswarm-service.ts');await module.sealAndDrainKSwarmServiceInstance(ks);}
  globalThis.fetch=previousFetch;if(priorEntry===undefined)delete process.env.KSWARM_SERVER_PATH;else process.env.KSWARM_SERVER_PATH=priorEntry;
  await fixture.close();
 }
},8000);
