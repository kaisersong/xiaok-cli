// @vitest-environment node
import {afterEach, beforeEach, expect, it} from 'vitest';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DesktopContextContinuity} from '../../electron/context-continuity/runtime.js';
import type {TaskSnapshot} from '../../shared/task-types.js';

function deferred() { let resolve!:()=>void; const promise=new Promise<void>(done=>{resolve=done;}); return {promise,resolve}; }
let root:string, runtime:DesktopContextContinuity;
beforeEach(()=>{root=mkdtempSync(join(tmpdir(),'continuity-refresh-'));});
afterEach(async()=>{await runtime?.close();rmSync(root,{recursive:true,force:true,maxRetries:3});});
async function seed(inspect:(id:string)=>Promise<TaskSnapshot|null>) {
  // Main supplies this identity after bootstrap. The real OS identity/custody
  // checks have their own cross-platform tests; this fixture exercises batching.
  runtime=new DesktopContextContinuity(root,inspect,{profileId:'refresh-test-profile'});
  const {service,actor}=runtime.port(),conversation=service.createConversation(actor,{operationId:'fixture-conversation'});
  const snapshot={taskId:'task_refresh',sessionId:'session_refresh',prompt:'original input',status:'prepared',events:[],context:{threadId:conversation.id}} as unknown as TaskSnapshot;
  await runtime.bindPrepared({prompt:snapshot.prompt,context:snapshot.context} as never,snapshot.taskId,async()=>snapshot);
  return {snapshot,service,actor,conversation};
}

it('batches same-reader requests before a fresh pass and never caches its completed result',async()=>{
  let snapshot:TaskSnapshot,reads=0;const inspect=async()=>{reads++;return snapshot;};
  ({snapshot}=await seed(inspect));
  await Promise.all(Array.from({length:8},()=>runtime.reconcile()));
  expect(reads).toBe(1);
  await runtime.reconcile();
  expect(reads).toBe(2);
  expect(()=>runtime.assertNativeExecutionAvailable()).toThrow('native_execution_gate_unavailable');
});

it('puts a request arriving during inspection into a new pass that sees later source data',async()=>{
  const entered=deferred(),release=deferred();let snapshot:TaskSnapshot;
  let reads=0;const inspect=async()=>{reads++;const observed=structuredClone(snapshot);if(reads===1){entered.resolve();await release.promise;}return observed;};
  const fixture=await seed(inspect);snapshot=fixture.snapshot;
  const first=runtime.reconcile();await entered.promise;
  snapshot={...snapshot,status:'completed',events:[{type:'result',result:{summary:'new source answer',artifacts:[]}}]} as TaskSnapshot;
  const later=runtime.reconcile();
  const beforeRelease=reads;
  release.resolve();await Promise.all([first,later]);
  expect(beforeRelease).toBe(1);
  expect(reads).toBe(2);
  expect(fixture.service.listMessages(fixture.actor,fixture.conversation.id).map(row=>row.text)).toContain('new source answer');
});

it('does not merge distinct original inspection functions',async()=>{
  let snapshot:TaskSnapshot,originalReads=0,otherReads=0;const original=async()=>{originalReads++;return snapshot;},other=async()=>{otherReads++;return snapshot;};
  ({snapshot}=await seed(original));
  await Promise.all([runtime.reconcile(original),runtime.reconcile(other),runtime.reconcile(original),runtime.reconcile(other)]);
  expect(originalReads).toBe(1);expect(otherReads).toBe(1);
});

it('resolves the first batch without waiting for a later blocked reader pass',async()=>{
  const firstEntered=deferred(),firstRelease=deferred(),laterEntered=deferred(),laterRelease=deferred();let snapshot:TaskSnapshot;
  let reads=0;const inspect=async()=>{const call=++reads;if(call===1){firstEntered.resolve();await firstRelease.promise;}else{laterEntered.resolve();await laterRelease.promise;}return snapshot;};
  ({snapshot}=await seed(inspect));
  const first=runtime.reconcile();await firstEntered.promise;
  const later=runtime.reconcile();firstRelease.resolve();await laterEntered.promise;
  let firstDone=false;void first.then(()=>{firstDone=true;});await new Promise<void>(done=>setImmediate(done));
  const firstDoneBeforeLaterEnded=firstDone;
  laterRelease.resolve();await Promise.all([first,later]);expect(firstDoneBeforeLaterEnded).toBe(true);
});

it('keeps close waiting for the original SDK reader and refuses queued reads after shutdown',async()=>{
  const entered=deferred(),release=deferred();let snapshot:TaskSnapshot;
  let reads=0;const inspect=async()=>{reads++;entered.resolve();await release.promise;return snapshot;};
  ({snapshot}=await seed(inspect));
  const first=runtime.reconcile();await entered.promise;
  const queued=runtime.reconcile().then(()=>({ok:true}),error=>({ok:false,error:String(error)}));
  let closed=false;const closing=runtime.close().then(()=>{closed=true;});await Promise.resolve();
  const closedBeforeReaderEnded=closed;release.resolve();await first;const queuedResult=await queued;await closing;
  expect(closedBeforeReaderEnded).toBe(false);
  expect(queuedResult).toEqual({ok:true}); // No source read started; void never grants an IPC reply.
  expect(()=>runtime.port()).toThrow('continuity_unavailable');
  expect(reads).toBe(1);
  await runtime.reconcile();expect(reads).toBe(1);
});

it('discards a failed batch so the next request performs a new database read',async()=>{
  let snapshot:TaskSnapshot;const inspect=async()=>snapshot;
  ({snapshot}=await seed(inspect));runtime.port().service.store.close();
  const failures=await Promise.all(Array.from({length:3},()=>runtime.reconcile().then(()=>null,error=>error)));
  expect(failures[0]).toBeInstanceOf(Error);
  expect(failures.every(error=>error===failures[0])).toBe(true);
  const next=await runtime.reconcile().then(()=>null,error=>error);
  expect(next).toBeInstanceOf(Error);expect(next).not.toBe(failures[0]);
});

it('queues a synchronous reentrant request instead of entering its reader twice',async()=>{
  let snapshot:TaskSnapshot,reads=0,active=0,maxActive=0,nested:Promise<void>|undefined;
  const inspect=async()=>{reads++;active++;maxActive=Math.max(maxActive,active);if(reads===1)nested=runtime.reconcile();await Promise.resolve();active--;return snapshot;};
  ({snapshot}=await seed(inspect));await runtime.reconcile();await nested;
  expect(reads).toBe(2);expect(maxActive).toBe(1);
});
