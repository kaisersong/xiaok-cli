// @vitest-environment node
import {expect,it,vi} from 'vitest';
import * as resources from '../../../src/runtime/task-host/task-runtime-host.js';
import {openManagedResourceFixture,resourceBarrier} from '../support/desktop-managed-resource-fixture.js';
it('refuses a foreign original group input before any proxy property is read',()=>{
 let traps=0;const foreign=new Proxy({},{get(){traps++;throw Error('unexpected_proxy_read');}});
 expect(()=>resources.issueOriginalManagedGroupResource(foreign,foreign)).toThrow('TASK_MANAGED_ORIGINAL_INPUT_REQUIRED');expect(traps).toBe(0);
});
it('refuses counterfeit issuer and turn objects without caller descriptors or callbacks',()=>{
 let traps=0;const foreign=new Proxy({},{get(){traps++;throw Error('unexpected_proxy_read');}});
 expect(()=>resources.prepareOriginalManagedGroupTurn(foreign)).toThrow('TASK_MANAGED_GROUP_REQUIRED');
 expect(()=>resources.readOriginalManagedGroupTurnSignal(foreign)).toThrow('TASK_MANAGED_TURN_REQUIRED');expect(traps).toBe(0);
});
it('keeps a genuine independent turn current after its Root runner returned; old root callbacks stay closed',async()=>{
 const f=await openManagedResourceFixture();
 try{
  const original=resources.readOriginalTaskRunnerResourceContext(f.originalContext,f.host,f.store);
  f.releaseRoot();await vi.waitFor(async()=>expect((await f.host.recoverTask(f.task.taskId)).snapshot.status).toBe('completed'));
  expect(()=>original.assertLocal()).toThrow('TASK_RUNNER_RESOURCE_CONTEXT_CLOSED');
  const turn=resources.prepareOriginalManagedGroupTurn(f.issuer);
  await resources.runOriginalManagedGroupTurn(turn,async()=>{
   const context=resources.readCurrentOriginalTaskRunnerResourceContext();expect(context).not.toBe(f.originalContext);
   const view=resources.readOriginalTaskRunnerResourceContext(context,f.host,f.store);view.assertCurrent();
   await resources.withOriginalToolWorkerResource(async()=>{resources.readCurrentOriginalTaskRunnerResourceContext();});
  });await resources.finishOriginalManagedGroupTurn(turn);
  await expect(resources.runOriginalManagedGroupTurn(turn,async()=>{})).rejects.toThrow('TASK_MANAGED_TURN_SPENT');
 }finally{await f.close();}
});
it('joins original SDK Promise own-symbol tails before declaring a turn physically complete',async()=>{
 const f=await openManagedResourceFixture(),hold=resourceBarrier();
 try{
  const turn=resources.prepareOriginalManagedGroupTurn(f.issuer);const raw=Promise.resolve('done');Object.defineProperty(raw,Symbol('held'),{value:hold.promise});
  let finished=false;const pending=resources.runOriginalManagedGroupTurn(turn,()=>raw).then(()=>{finished=true;});
  await Promise.resolve();await Promise.resolve();expect(finished).toBe(false);hold.release();await pending;await resources.finishOriginalManagedGroupTurn(turn);expect(finished).toBe(true);
 }finally{hold.release();await f.close();}
});
it('revoke aborts accepted turns synchronously, settles only never-born reservations, and cannot revive',async()=>{
 const f=await openManagedResourceFixture();
 try{
  const neverBorn=resources.prepareOriginalManagedGroupTurn(f.issuer);const reason=new Error('group_revoke');
  resources.revokeOriginalManagedGroupResource(f.issuer,reason);expect(resources.readOriginalManagedGroupTurnSignal(neverBorn).reason).toBe(reason);
  await resources.finishOriginalManagedGroupTurn(neverBorn);
  expect(()=>resources.prepareOriginalManagedGroupTurn(f.issuer)).toThrow('TASK_MANAGED_GROUP_CLOSED');
  expect(()=>resources.issueOriginalManagedGroupResource({...f.input},f.source)).toThrow('TASK_MANAGED_ORIGINAL_INPUT_REQUIRED');
 }finally{await f.close();}
});
it('Host stop aborts a running child but still waits for its accepted SDK tail',async()=>{
 const f=await openManagedResourceFixture(),entered=resourceBarrier(),held=resourceBarrier();
 try{
  const turn=resources.prepareOriginalManagedGroupTurn(f.issuer);let signal!:AbortSignal;
  const run=resources.runOriginalManagedGroupTurn(turn,async()=>{signal=resources.readOriginalManagedGroupTurnSignal(turn);entered.release();await held.promise;});
  await entered.promise;f.host.stopAccepting('profile_migration');expect(signal.aborted).toBe(true);
  expect(()=>resources.prepareOriginalManagedGroupTurn(f.issuer)).toThrow('TASK_MANAGED_GROUP_CLOSED');
  f.releaseRoot();let closed=false;const drain=f.host.drain().then(()=>{closed=true;});await Promise.resolve();expect(closed).toBe(false);
  held.release();await run;await resources.finishOriginalManagedGroupTurn(turn);await drain;expect(closed).toBe(true);
 }finally{held.release();await f.close();}
});

it('does not wait on Core settlement from inside the turn that Core itself awaits',async()=>{
 const f=await openManagedResourceFixture(),coreSettlement=resourceBarrier();
 try{
  const turn=resources.prepareOriginalManagedGroupTurn(f.issuer);resources.retainOriginalManagedGroupTurnTail(turn,coreSettlement.promise);
  await resources.runOriginalManagedGroupTurn(turn,async()=> 'actual turn returned');
  let known=false;const finishing=resources.finishOriginalManagedGroupTurn(turn).then(()=>{known=true;});await Promise.resolve();expect(known).toBe(false);
  coreSettlement.release();await finishing;expect(known).toBe(true);
 }finally{coreSettlement.release();await f.close();}
});
it('preserves throw undefined as a business first cause without inventing a physical tail',async()=>{
 const f=await openManagedResourceFixture();
 try{
  const turn=resources.prepareOriginalManagedGroupTurn(f.issuer);let failure:{raw:unknown}|undefined;
  try{await resources.runOriginalManagedGroupTurn(turn,async()=>{throw undefined;});}catch(raw){failure={raw};}
  expect(failure).toEqual({raw:undefined});await resources.finishOriginalManagedGroupTurn(turn);
 }finally{await f.close();}
});

it('keeps the original failed settlement sticky when a concurrent finish later joins successfully',async()=>{
 const f=await openManagedResourceFixture(),held=resourceBarrier();f.retainUnknown();
 try{
  const turn=resources.prepareOriginalManagedGroupTurn(f.issuer);
  await resources.runOriginalManagedGroupTurn(turn,async()=>{});
  resources.retainOriginalManagedGroupTurnTail(turn,held.promise);
  const finishing=resources.finishOriginalManagedGroupTurn(turn);let caught:{raw:unknown}|undefined;
  await Promise.resolve();resources.failOriginalManagedGroupTurn(turn,undefined);held.release();
  try{await finishing;}catch(raw){caught={raw};}expect(caught).toEqual({raw:undefined});
  expect(()=>resources.prepareOriginalManagedGroupTurn(f.issuer)).toThrow('TASK_MANAGED_GROUP_CLOSED');
  await expect(resources.finishOriginalManagedGroupTurn(turn)).rejects.toBeUndefined();
 }finally{
  held.release();await expect(f.close()).rejects.toBeDefined();
  console.log(JSON.stringify({kind:'retained-intentional-unknown-resource-fixture',root:f.root}));
 }
});

it('a later negative observer cannot turn a previously known Promise into a false metadata close receipt',async()=>{
 const f=await openManagedResourceFixture();f.retainUnknown();const first=new Error('late_original_observer_failure');
 try{
  const turn=resources.prepareOriginalManagedGroupTurn(f.issuer);await resources.runOriginalManagedGroupTurn(turn,async()=>{});await resources.finishOriginalManagedGroupTurn(turn);
  resources.failOriginalManagedGroupTurn(turn,first);await expect(resources.finishOriginalManagedGroupTurn(turn)).rejects.toBe(first);
  expect(()=>resources.prepareOriginalManagedGroupTurn(f.issuer)).toThrow('TASK_MANAGED_GROUP_CLOSED');
 }finally{await expect(f.close()).rejects.toBeDefined();console.log(JSON.stringify({kind:'retained-late-unknown-resource-fixture',root:f.root}));}
});

it('retires a constructed ready turn after revoke through real negative join, without needing a later run',async()=>{
 const f=await openManagedResourceFixture();let turn:object|undefined;
 try{
  turn=resources.prepareOriginalManagedGroupTurn(f.issuer);await resources.runOriginalManagedGroupConstruction(turn,async()=>{});
  f.releaseRoot();await vi.waitFor(async()=>expect((await f.host.recoverTask(f.task.taskId)).snapshot.status).toBe('completed'));
  resources.revokeOriginalManagedGroupResource(f.issuer,new Error('stop_after_construction'));
  let drained=false;const drain=f.host.drain().then(()=>{drained=true;});
  await vi.waitFor(()=>expect(drained).toBe(true));await drain;
  await expect(resources.runOriginalManagedGroupTurn(turn,async()=>{})).rejects.toThrow('TASK_MANAGED_GROUP_CLOSED');
 }finally{if(turn)await resources.finishOriginalManagedGroupTurn(turn);await f.close();}
});

it('revocation inside an entered constructor waits its accepted tail and retires the eventual ready phase',async()=>{
 const f=await openManagedResourceFixture(),entered=resourceBarrier(),release=resourceBarrier();let turn:object|undefined;
 try{
  turn=resources.prepareOriginalManagedGroupTurn(f.issuer);const token=turn;
  const constructing=resources.runOriginalManagedGroupConstruction(token,async()=>{entered.release();await release.promise;});
  await entered.promise;resources.revokeOriginalManagedGroupResource(f.issuer,new Error('revoke_during_constructor'));
  expect(resources.readOriginalManagedGroupTurnSignal(token).aborted).toBe(true);f.releaseRoot();let done=false;const drain=f.host.drain().then(()=>{done=true;});
  await Promise.resolve();expect(done).toBe(false);release.release();await constructing;await drain;expect(done).toBe(true);
 }finally{release.release();if(turn)await resources.finishOriginalManagedGroupTurn(turn);await f.close();}
});
