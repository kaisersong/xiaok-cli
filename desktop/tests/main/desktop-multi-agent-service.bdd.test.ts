// @vitest-environment node
import {declaredMainGroupsRows} from '../fixtures/captured-groups-declarations.js';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DesktopMultiAgentStore } from '../../electron/desktop-multi-agent-store.js';
import { DesktopExecutionCoordinator } from '../../electron/desktop-execution-coordinator.js';
import { DesktopMultiAgentService, type DesktopAgentExecutionContext, type DesktopHostDeliveryAuthority, type DesktopMultiAgentServiceOptions } from '../../electron/desktop-multi-agent-service.js';
import { DesktopMultiAgentApprovalTransport } from '../../electron/desktop-multi-agent-approval-transport.js';
import { InProcessTaskRuntimeHost } from '../../../src/runtime/task-host/task-runtime-host.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';
import type {TaskRunnerInput} from '../../../src/runtime/task-host/task-runtime-host.js';
import { compileVerifierEntry } from '../fixtures/desktop-post-seal-verifier-contract.js';
import {compileProtectionWorkerEntry} from '../fixtures/desktop-protection-worker-entry.js';

// Source-mode Vitest does not emit the fixed .js Worker entry. Map only that
// URL to the test-owned compiled production entry; execution and exit are native.
const nativeWorker = vi.hoisted(() => ({ output: '', root: '', protectionOutput:'',protectionRoot:'',starts: 0, exits: 0, originalEntries: [] as Array<{entry:string,protection:boolean,start:number,exit?:number,exitCode?:number,terminateCalls:number}> }));
vi.mock('node:worker_threads', async importOriginal => {
  const actual = await importOriginal<typeof import('node:worker_threads')>();
  const sourceUrl = new URL('../../../src/runtime/task-host/delivery-verifier-worker.js', import.meta.url);
  const source = join(realpathSync(dirname(fileURLToPath(sourceUrl))),basename(fileURLToPath(sourceUrl)));
  const protectionSource=new URL('../../../src/runtime/task-host/protection-read-worker.ts',import.meta.url).href;
  return { ...actual, Worker: class extends actual.Worker {
    private readonly originalEntry: {entry:string,protection:boolean,start:number,exit?:number,exitCode?:number,terminateCalls:number};
    override terminate():Promise<number>{this.originalEntry.terminateCalls++;return super.terminate();}
    constructor(filename: ConstructorParameters<typeof actual.Worker>[0], options?: ConstructorParameters<typeof actual.Worker>[1]) {
      let mapped=false;
      try{const path=typeof filename==='string'?filename:fileURLToPath(filename);mapped=join(realpathSync(dirname(path)),basename(path))===source;}catch{/* Non-owned entry remains native and must not be redirected. */}
      if (mapped && !nativeWorker.output) throw new Error('test compiled Worker entry is not ready');
      const protectionMapped=String(filename)===protectionSource;
      if(protectionMapped&&!nativeWorker.protectionOutput)throw Error('fresh production protection worker required');
      const originalEntry={entry:String(filename),protection:protectionMapped,start:Date.now(),exit:undefined as number|undefined,exitCode:undefined as number|undefined,terminateCalls:0};
      if(mapped||protectionMapped)nativeWorker.originalEntries.push(originalEntry);
      super(mapped?nativeWorker.output:protectionMapped?nativeWorker.protectionOutput:filename,options);
      this.originalEntry=originalEntry;this.once('exit',(code)=>{originalEntry.exit=Date.now();originalEntry.exitCode=code;});
      if (mapped) { nativeWorker.starts++; this.once('exit', () => { nativeWorker.exits++; }); }
    }
  } };
});
beforeAll(async()=>{Object.assign(nativeWorker,await compileVerifierEntry('delivery-verifier-worker.ts'));const protection=await compileProtectionWorkerEntry();nativeWorker.protectionOutput=protection.output;nativeWorker.protectionRoot=protection.root;});
afterAll(() => {
  try { expect(nativeWorker.exits).toBe(nativeWorker.starts); }
  finally { for(const root of [nativeWorker.root,nativeWorker.protectionRoot])if(root)rmSync(root,{recursive:true,force:true,maxRetries:3}); }
});

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

describe('BDD: durable service uses the real shared coordinator', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  const capturedAssertions: unknown[] = [];
  afterEach(async () => {
    const cleanupErrors:unknown[]=[];
    for (const action of cleanup.splice(0).reverse()) {try{await action();}catch(error){cleanupErrors.push(error);}}
    // Always restore every fixture, even when an unknown physical outcome makes
    // disposal reject; report that original failure without contaminating the next case.
    const assertions=capturedAssertions.splice(0);
    if(cleanupErrors.length)throw new AggregateError([...assertions,...cleanupErrors],'runner and cleanup failures: '+[...assertions,...cleanupErrors].map(value=>value instanceof Error?value.stack:String(value)).join('\n'));
    // Host/core intentionally catch runner failures. A test assertion inside a
    // real runner must still fail this test, not be mistaken for product output.
    expect(assertions.map(error=>error instanceof Error?error.stack+(error.cause instanceof Error?"\nCAUSE: "+error.cause.stack:""):error)).toEqual([]);
  });
  async function setup(createSession: DesktopMultiAgentServiceOptions['createSession'], body: (context: DesktopAgentExecutionContext,input:TaskRunnerInput) => Promise<void>, policy: { expectedDisposeError?:Error; isolatedConfigRoot?: boolean; multiAgentLeaseMs?: number; coreIdleTimeoutMs?: number; prepareObservationSession?: DesktopMultiAgentServiceOptions['prepareObservationSession']; prepareObservationMessage?: DesktopMultiAgentServiceOptions['prepareObservationMessage']; prepareObservationFollowup?:DesktopMultiAgentServiceOptions['prepareObservationFollowup'] } = {}) {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'xiaok-multi-agent-service-')));
    if(policy.isolatedConfigRoot){const previous=process.env.XIAOK_CONFIG_DIR;process.env.XIAOK_CONFIG_DIR=root;cleanup.push(()=>{if(previous===undefined)delete process.env.XIAOK_CONFIG_DIR;else process.env.XIAOK_CONFIG_DIR=previous;});}
    cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
    const store = new DesktopMultiAgentStore(join(root, 'groups.sqlite'));
    cleanup.push(() => store.close());
    const coordinator = new DesktopExecutionCoordinator({ multiAgentLeaseMs: policy.multiAgentLeaseMs });
    const service = new DesktopMultiAgentService({ store, coordinator, createSession: async input => {
      const session = await createSession(input);
      return { ...session, run: async (...args) => {
        try { return await session.run(...args); }
        catch (error) { if (!(error instanceof Error && error.name === 'AbortError')) capturedAssertions.push(error); throw error; }
      } };
    }, prepareObservationSession: policy.prepareObservationSession, prepareObservationMessage: policy.prepareObservationMessage, prepareObservationFollowup:policy.prepareObservationFollowup, closeGraceMs: 10 });
    cleanup.push(async () => {try{await service.dispose();}catch(error){if(error!==policy.expectedDisposeError)throw error;}});
    service.registerThread({ threadId: 't1', profileId: 'p1', workspaceId: 'w1', cwd: root });
    let deliveryAuthority!: DesktopHostDeliveryAuthority;
    const host = new InProcessTaskRuntimeHost({
      snapshotStore: new FileTaskSnapshotStore(join(root, 'tasks')),
      groupObservationSource: service,
      materialRegistry: new MaterialRegistry({ workspaceRoot: join(root, 'materials'), maxBytes: 1024 * 1024 }),
      runner: input => service.runRoot(input, async context => {
        try { return await body(context,input); }
        catch (error) { capturedAssertions.push(error); throw error; }
      }),
      authorizePreparation: (taskId, marker) => service.assertHostPreparation(taskId, marker),
      assertTaskAdmission: snapshot => service.assertHostAdmission(snapshot),
      decideCancellation: (snapshot, reason) => service.decideHostCancellation(snapshot, reason),
      getExecutionPolicy: () => ({ deliveryRepair: 'explicit' }),
      onDeliveryReport: report => service.recordHostDelivery({ requestSource: 'scheduler', authority: deliveryAuthority, report }),
    });
    await service.initialize(host);
    deliveryAuthority = service.bindHostDeliveryOwner(host);
    cleanup.push(() => host.drain());
    const start = async () => {
      const prepared = await service.prepareRoot(host, 't1', { prompt: 'run root', materials: [] });
      if (policy.coreIdleTimeoutMs !== undefined) {
        // Explicit test-only policy before activation. The real core timer and
        // service event/settlement paths remain untouched; Desktop has no default.
        const groups = (service as unknown as { groups: Map<string, { core: object }> }).groups;
        Object.defineProperty(groups.get(store.getRootBinding(prepared.taskId)!.groupId)!.core, 'idleTimeoutMs', { value: policy.coreIdleTimeoutMs });
      }
      await host.startTask(prepared.taskId);
      return prepared.taskId;
    };
    return { root, store, service, coordinator, host, start };
  }

  it.each([false,true,'activation-failure','aggregate-revoke'] as const)('commits only a real delegated publication before activating its prepared child identity (message port=%s)',async(messagePort)=>{
    let activated=0,disposedSessions=0;let firstReadOwner:import('../../../src/runtime/sol-pi/observation-session-owner.js').ObservationSessionOwner|undefined;const childUsers=new Map<object,object>();let sourceOwner:import('../../../src/runtime/sol-pi/observation-session-owner.js').ObservationSessionOwner;let approval:object;
    const f=await setup(async()=>{throw Error('late unprepared factory must not run');},async(context,input)=>{
      const {createObservationService}=await import('../../../src/runtime/sol-pi/observation-service.js');
      const {createObservationSessionOwner}=await import('../../../src/runtime/sol-pi/observation-session-owner.js');
      const {AgentSessionState}=await import('../../../src/ai/runtime/session.js');
      const {desktopObservationSessionId}=await import('../../../src/runtime/task-host/protected-observation-store.js');
      const archive=createObservationService({profileRoot:join(f.root,'archive'),profileId:'fixture',redactor:{version:'fixture',redact:text=>text}});
      const session=new AgentSessionState();session.restoreSnapshot({...session.exportSnapshot(),sessionId:desktopObservationSessionId(input.taskId)});
      const claims={sessionId:session.exportSnapshot().sessionId,ownerAgentId:'root',scopeId:'root',permissionGeneration:1,surface:'ordinary-owner' as const};
      const caller=archive.bindCaller({...claims,requestSource:'agent'}),user=archive.bindCaller({...claims,requestSource:'user'});
      const destination={provider:'fixture',model:'fixture',url:'https://example.test/chat'};
      sourceOwner=createObservationSessionOwner({service:archive,caller,session,destination,persist:snapshot=>new FileTaskSnapshotStore(join(f.root,'tasks')).observations.persistSession(input.taskId,snapshot)});
      approval=archive.approveDelegation({sourcePolicyIds:[],requestSource:'user',caller:user,destination,maxDepth:2,maxChildren:2,expiresAt:Date.now()+30000});
      f.service.registerGroupObservationOwner({actor:context.actor,requestSource:'agent',owner:sourceOwner,canonicalTaskId:input.taskId});
      const lifetime=f.service.bindObservationGroupLifetime(context.actor,sourceOwner);lifetime.onClose(async()=>{sourceOwner.dispose();archive.dispose();lifetime.release();});
      if(messagePort==='activation-failure'){
        const core=(f.service as unknown as {groups:Map<string,{core:{activatePreparedTurn(...args:unknown[]):unknown}}>}).groups.get(context.groupId)!.core;
        const original=core.activatePreparedTurn.bind(core),activation=vi.spyOn(core,'activatePreparedTurn').mockImplementation((...args)=>{original(...args);throw Error('activation response lost');});
        try{await expect(f.service.spawn({actor:context.actor,requestSource:'agent',operationId:'real-protected-prepare',taskName:'child',message:'authorized prepared task'})).rejects.toThrow('activation response lost');
          expect(f.store.getOperation(context.groupId,'real-protected-prepare')!.applyState).toBe('applied');expect(f.store.requireGroup(context.groupId).mutationBlockedReason).toBe('multi_agent_activation_unknown');expect(disposedSessions).toBeGreaterThan(0);
          await expect(f.service.spawn({actor:context.actor,requestSource:'agent',operationId:'real-protected-prepare',taskName:'child',message:'authorized prepared task'})).rejects.toThrow();expect(activation).toHaveBeenCalledOnce();
        }finally{activation.mockRestore();}return;
      }
      const result=await f.service.spawn({actor:context.actor,requestSource:'agent',operationId:'real-protected-prepare',taskName:'child',message:'authorized prepared task'});
      expect(result.state).toBe('applied');await vi.waitFor(()=>expect(activated).toBe(1));
      if(messagePort==='aggregate-revoke'){await f.service.spawn({actor:context.actor,requestSource:'agent',operationId:'second-protected-child',taskName:'second_child',message:'authorized prepared task'});await vi.waitFor(()=>expect(activated).toBe(2));await expect(f.service.listForModel({actor:context.actor,requestSource:'agent'})).rejects.toThrow();return;}
      const sent=f.service.send({actor:context.actor,requestSource:'agent',operationId:'message-authority',target:result.targetAgentId!,message:'authorized additional message'});
      if(messagePort){await expect(sent).resolves.toMatchObject({state:'applied'});expect(f.store.listMessages(context.groupId,result.targetAgentId!).map(row=>row.preview)).toContain('authorized additional message');}
      else {await expect(sent).rejects.toThrow('SOL_PI_DESKTOP_MESSAGE_FACTORY_REQUIRED');expect(f.store.listMessages(context.groupId,result.targetAgentId!).map(row=>row.preview)).not.toContain('authorized additional message');}
    },{prepareObservationMessage:messagePort?async input=>{const {prepareObservationMessagePublication}=await import('../../../src/runtime/sol-pi/observation-message-publication.js');if(messagePort==='aggregate-revoke'){if(!firstReadOwner)firstReadOwner=input.sourceOwner;else{const {getObservationSessionOwnerHostBinding}=await import('../../../src/runtime/sol-pi/observation-session-owner.js');const first=getObservationSessionOwnerHostBinding(firstReadOwner);first.service.revokeCaller({requestSource:'user',caller:childUsers.get(firstReadOwner!) as never,target:first.caller});}}return prepareObservationMessagePublication({...input,approval});}:undefined,prepareObservationSession:async input=>{
      const preparedRows=declaredMainGroupsRows(f.store,'operations').filter(row=>row.body.operationId===input.operationId);
      expect(preparedRows).toHaveLength(1);expect(preparedRows[0].body.applyState).toBe('prepared');expect(preparedRows[0].unmapped).toEqual([]);
      const {getObservationSessionOwnerHostBinding}=await import('../../../src/runtime/sol-pi/observation-session-owner.js');
      const {createDelegatedObservationExecutionPlan,consumeDelegatedObservationExecutionPlan}=await import('../../../src/runtime/sol-pi/delegated-session-owner.js');
      const {prepareObservationMessagePublication}=await import('../../../src/runtime/sol-pi/observation-message-publication.js');
      const {AgentSessionState}=await import('../../../src/ai/runtime/session.js');const {ToolRegistry}=await import('../../../src/ai/tools/index.js');
      const {desktopObservationSessionId}=await import('../../../src/runtime/task-host/protected-observation-store.js');
      const parent=getObservationSessionOwnerHostBinding(sourceOwner),session=new AgentSessionState();session.restoreSnapshot({...session.exportSnapshot(),sessionId:desktopObservationSessionId(input.identity.id)});
      const recipient=parent.service.bindCaller({sessionId:session.exportSnapshot().sessionId,ownerAgentId:input.identity.id,scopeId:input.identity.id,permissionGeneration:1,surface:'ordinary-owner',requestSource:'agent'});
      const capability=parent.service.issueDelegationWithApproval({requestSource:'agent',caller:parent.caller,approval,recipient,observationIds:[],destination:parent.destination,expiresAt:Date.now()+20000});
      const registry=new ToolRegistry({autoMode:true},[]);const sidecar=new FileTaskSnapshotStore(join(f.root,'tasks')).observations;
      const plan=createDelegatedObservationExecutionPlan({parentOwner:sourceOwner,service:parent.service,recipient,capability,session,destination:parent.destination,persist:snapshot=>sidecar.persistSession(input.identity.id,snapshot)});
      const child=await consumeDelegatedObservationExecutionPlan(plan,registry);
      childUsers.set(child.owner,parent.service.bindCaller({sessionId:session.exportSnapshot().sessionId,ownerAgentId:input.identity.id,scopeId:input.identity.id,permissionGeneration:1,surface:'ordinary-owner',requestSource:'user'}));
      session.addProtectedObservationReferences([]);
      const publication=await prepareObservationMessagePublication({sourceOwner,recipientOwner:child.owner,approval,operationId:input.operationId,text:input.message,assertCurrent:()=>{f.service.assertObservationChildPreparation(input.preparation);}});
      await sidecar.persistSession(input.identity.id,session.exportSnapshot());
      return {owner:child.owner,registry,publication,observationStore:sidecar,session:{run:async(message)=>{f.service.assertInvocation(input.context.actor,input.context);expect(f.store.getOperation(input.context.groupId,input.operationId)!.applyState).toBe('applied');expect(message).toBe('authorized prepared task');activated++;return 'terminal';},dispose:async()=>{disposedSessions++;registry.dispose();child.owner.dispose();}}};
    }});
    await f.start();await f.host.drain();
  });

  it.each([false,true,'reserve-failure'] as const)('holds protected child text outside the visible journal and drains preparation before shutdown (%s)',async(shutdownDuringPreparation)=>{
    let preparedCalls=0,runCalls=0,resourceClosed=false;let disposal:Promise<void>|undefined;
    const f=await setup(async()=>({run:async()=>{runCalls++;return 'must not execute';},dispose:async()=>{}}),async(context,input)=>{
      const {createObservationService}=await import('../../../src/runtime/sol-pi/observation-service.js');
      const {createObservationSessionOwner}=await import('../../../src/runtime/sol-pi/observation-session-owner.js');
      const {AgentSessionState}=await import('../../../src/ai/runtime/session.js');
      const {desktopObservationSessionId}=await import('../../../src/runtime/task-host/protected-observation-store.js');
      const archive=createObservationService({profileRoot:join(f.root,'archive'),profileId:'fixture',redactor:{version:'fixture',redact:text=>text}});
      const session=new AgentSessionState();session.restoreSnapshot({...session.exportSnapshot(),sessionId:desktopObservationSessionId(input.taskId)});
      const caller=archive.bindCaller({sessionId:session.exportSnapshot().sessionId,ownerAgentId:'root',scopeId:'root',permissionGeneration:1,surface:'ordinary-owner',requestSource:'agent'});
      const owner=createObservationSessionOwner({service:archive,caller,session,destination:{provider:'fixture',model:'fixture',url:'https://example.test/chat'},persist:snapshot=>new FileTaskSnapshotStore(join(f.root,'tasks')).observations.persistSession(input.taskId,snapshot)});
      f.service.registerGroupObservationOwner({actor:context.actor,requestSource:'agent',owner,canonicalTaskId:input.taskId});
      const lifetime=f.service.bindObservationGroupLifetime(context.actor,owner);lifetime.onClose(async()=>{resourceClosed=true;owner.dispose();archive.dispose();lifetime.release();});
      const original=f.store.putOperation.bind(f.store);
      const fault=shutdownDuringPreparation==='reserve-failure'?vi.spyOn(f.store,'putOperation').mockImplementation((row,control)=>{if(row.operationId==='protected-prepare'&&row.applyState==='prepared'&&row.result.targetAgentId)throw Error('prepared identity persistence failed');return original(row,control);}):undefined;
      try{await expect(f.service.spawn({actor:context.actor,requestSource:'agent',operationId:'protected-prepare',taskName:'child',message:'protected initial message'})).rejects.toThrow(shutdownDuringPreparation==='reserve-failure'?'prepared identity persistence failed':'actual preparation rejected');}finally{fault?.mockRestore();}
      if(shutdownDuringPreparation===false){
        const replay=await f.service.spawn({actor:context.actor,requestSource:'agent',operationId:'protected-prepare',taskName:'child',message:'protected initial message'});
        expect(replay).toMatchObject({state:'completed',outcome:'rejected'});
        expect(f.service.getFixedObservationAck(replay),'rejected preparation must not expose the stale success ACK').toBeUndefined();
      }
      expect(preparedCalls).toBe(shutdownDuringPreparation==='reserve-failure'?0:1);expect(runCalls).toBe(0);expect(f.service.runtimeStatus().residentSlots).toBe(0);
    },{prepareObservationSession:async input=>{
      preparedCalls++;expect(typeof f.service.bindManagedObservationAdmission).toBe('function');expect(()=>f.service.bindManagedObservationAdmission(input.preparation,{admission:{} as never,onResourcesReleased:async()=>{throw Error('must not call');}})).toThrow();const preparationFacts=f.service.assertObservationChildPreparation(input.preparation);expect(JSON.parse(preparationFacts.ackBytes)).toMatchObject({operationId:input.operationId,state:'applied',targetAgentId:input.identity.id,displayNames:{zh:expect.any(String),en:expect.any(String)}});
      expect(()=>f.service.assertInvocation(input.context.actor,input.context)).toThrow();
      expect(f.store.getAgent(input.context.groupId,input.identity.id)).toBeNull();
      const row=f.store.getOperation(input.context.groupId,input.operationId);expect(row!.applyState).toBe('prepared');expect(JSON.stringify(row)).not.toContain('protected initial message');
      if(shutdownDuringPreparation===true){disposal=f.service.dispose();await new Promise(resolve=>setTimeout(resolve,20));expect(resourceClosed).toBe(false);}
      throw Error('actual preparation rejected');
    }});
    await f.start();await f.host.drain();await disposal;
  });

  it('stopping an observation-owned root turn retains its child while closing the real group aborts and drains it', async () => {
    const entered=deferred<void>(), rootDone=deferred<void>();let childSignal:AbortSignal|undefined;
    const f=await setup(async()=>({run:async(_message,signal)=>{childSignal=signal;entered.resolve();await new Promise<void>(resolve=>signal!.addEventListener('abort',()=>resolve(),{once:true}));return 'stopped';},dispose:async()=>{}}),async(context,input)=>{
      const {createObservationService}=await import('../../../src/runtime/sol-pi/observation-service.js');
      const {createObservationSessionOwner}=await import('../../../src/runtime/sol-pi/observation-session-owner.js');
      const {AgentSessionState}=await import('../../../src/ai/runtime/session.js');
      const {desktopObservationSessionId}=await import('../../../src/runtime/task-host/protected-observation-store.js');
      const archive=createObservationService({profileRoot:join(f.root,'archive'),profileId:'fixture',redactor:{version:'fixture',redact:text=>text}});
      const session=new AgentSessionState();session.restoreSnapshot({...session.exportSnapshot(),sessionId:desktopObservationSessionId(input.taskId)});
      const caller=archive.bindCaller({sessionId:session.exportSnapshot().sessionId,ownerAgentId:'root',scopeId:'root',permissionGeneration:1,surface:'ordinary-owner',requestSource:'agent'});
      const owner=createObservationSessionOwner({service:archive,caller,session,destination:{provider:'fixture',model:'fixture',url:'https://example.test/chat'},persist:snapshot=>new FileTaskSnapshotStore(join(f.root,'tasks')).observations.persistSession(input.taskId,snapshot)});
      await f.service.spawn({actor:context.actor,requestSource:'agent',operationId:'child-before-root-stop',taskName:'child',message:'work'});
      await entered.promise;
      expect(()=>f.service.assertFreshObservationGroup(context)).toThrow('SOL_PI_DESKTOP_FRESH_GROUP_REQUIRED');
      f.service.registerGroupObservationOwner({actor:context.actor,requestSource:'agent',owner,canonicalTaskId:input.taskId});
      const lifetime=f.service.bindObservationGroupLifetime(context.actor,owner);
      lifetime.onClose(async()=>{owner.dispose();archive.dispose();lifetime.release();});
      await f.service.cancelRootTurn({requestSource:'scheduler',sourceTaskId:input.taskId,expectedRootEpoch:context.rootEpoch,reason:'user_cancelled'});
      expect(context.signal.aborted).toBe(true);expect(childSignal!.aborted).toBe(false);expect(lifetime.signal.aborted).toBe(false);
      rootDone.resolve();
    });
    await f.start();
    try{await Promise.race([rootDone.promise,f.host.drain()]);expect(childSignal!.aborted).toBe(false);}
    finally{await f.service.dispose();}
    expect(childSignal!.aborted).toBe(true);
  });

  it('closes only its actual group while another group preparation remains pending',async()=>{
    const preparingB=deferred<void>(),releaseB=deferred<void>();let closedA=false;
    let firstGroup:string|undefined,closeA:(()=>Promise<void>)|undefined;
    const f=await setup(async()=>({run:async()=> 'completed A',dispose:async()=>{closedA=true;}}),async(context,input)=>{
      const first=!firstGroup;if(first)firstGroup=context.groupId;
      if(first){const child=await f.service.spawn({actor:context.actor,requestSource:'agent',operationId:'ordinary-A',taskName:'child',message:'A'});await vi.waitFor(()=>expect(f.store.getAgent(context.groupId,child.targetAgentId!)?.executionActive).toBe(false));}
      const {createObservationService}=await import('../../../src/runtime/sol-pi/observation-service.js');
      const {createObservationSessionOwner}=await import('../../../src/runtime/sol-pi/observation-session-owner.js');
      const {AgentSessionState}=await import('../../../src/ai/runtime/session.js');
      const {desktopObservationSessionId}=await import('../../../src/runtime/task-host/protected-observation-store.js');
      const archive=createObservationService({profileRoot:join(f.root,'archive-'+context.groupId),profileId:'fixture',redactor:{version:'fixture',redact:text=>text}});
      const session=new AgentSessionState();session.restoreSnapshot({...session.exportSnapshot(),sessionId:desktopObservationSessionId(input.taskId)});
      const caller=archive.bindCaller({sessionId:session.exportSnapshot().sessionId,ownerAgentId:'root',scopeId:'root',permissionGeneration:1,surface:'ordinary-owner',requestSource:'agent'});
      const owner=createObservationSessionOwner({service:archive,caller,session,destination:{provider:'fixture',model:'fixture',url:'https://example.test/chat'},persist:snapshot=>new FileTaskSnapshotStore(join(f.root,'tasks')).observations.persistSession(input.taskId,snapshot)});
      f.service.registerGroupObservationOwner({actor:context.actor,requestSource:'agent',owner,canonicalTaskId:input.taskId});
      const lifetime=f.service.bindObservationGroupLifetime(context.actor,owner);lifetime.onClose(async()=>{owner.dispose();archive.dispose();lifetime.release();});
      if(first){closeA=()=>lifetime.requestClose();return;}
      await expect(f.service.spawn({actor:context.actor,requestSource:'agent',operationId:'prepared-B',taskName:'child',message:'B'})).rejects.toThrow('released B preparation');
    },{prepareObservationSession:async()=>{preparingB.resolve();await releaseB.promise;throw Error('released B preparation');}});
    await f.start();await f.host.drain();expect(closedA).toBe(false);
    f.service.registerThread({threadId:'t2',profileId:'p1',workspaceId:'w1',cwd:f.root});
    const prepared=await f.service.prepareRoot(f.host,'t2',{prompt:'second group',materials:[]});await f.host.startTask(prepared.taskId);await preparingB.promise;
    const closing=closeA!();
    try{await vi.waitFor(()=>expect(closedA,'A physical resources must close without awaiting B').toBe(true),{timeout:500});await closing;expect(f.store.getOperation(f.store.getThread('t2')!.activeGroupId!,'prepared-B')?.applyState).toBe('prepared');}
    finally{releaseB.resolve();await f.host.drain();await closing;}
  });

  it('validates message metadata only against the original actual service operation and exact native result',async()=>{
    const f=await setup(async()=>({run:async()=> 'child',dispose:async()=>{}}),async(context)=>{
      const child=await f.service.spawn({actor:context.actor,requestSource:'agent',operationId:'metadata-child',taskName:'child',message:'work'});
      const {createDesktopMultiAgentTools}=await import('../../electron/desktop-multi-agent-tools.js');
      const tool=createDesktopMultiAgentTools({service:f.service,context,agents:[],allowedControls:['send_message'],createSeed(){throw Error('unused');}})[0]!;
      const finalInput={target:child.targetAgentId!,message:'exact original text'},nativeInvocationId='metadata-native';
      const result=await tool.execute(finalInput,{toolInvocationId:nativeInvocationId} as import('../../../src/types.js').ToolExecutionContext);
      const facts=f.service.inspectCommittedManagedMessage(context,{nativeInvocationId,finalInput,result});
      expect(facts).toMatchObject({adapter:'desktop-service-metadata-v1',kind:'send',operationId:`${context.turnId}:${nativeInvocationId}`,groupId:context.groupId,actorId:context.agentId,epoch:context.rootEpoch});
      for(const changed of [{nativeInvocationId:'other',finalInput,result},{nativeInvocationId,finalInput:{...finalInput,message:'different'},result},{nativeInvocationId,finalInput,result:'{"state":"applied"}'}])expect(()=>f.service.inspectCommittedManagedMessage(context,changed)).toThrow();
      expect(()=>f.service.inspectCommittedManagedMessage({...context}, {nativeInvocationId,finalInput,result})).toThrow();
    });await f.start();await f.host.drain();
  });

  it.each([false,true,'publication-persist-failure','semantic-next-turn','closed-result-read','compound-group','compound-managed','group-close-drain','compound-managed-close','compound-managed-parallel','compound-managed-followup','compound-managed-agent-followup','compound-managed-agent-followup-busy','compound-managed-followup-cancel','compound-managed-followup-ack-loss','compound-managed-followup-close-preparing','compound-root-orphan'] as const)('uses the actual prepared Runtime and managed session before its first SDK send (product runner=%s)',async(mode)=>{
    const rootOrphan=mode==='compound-root-orphan',compoundRoot=mode==='compound-group'||rootOrphan;let orphanInjected=false;
    const followupClosePreparing=mode==='compound-managed-followup-close-preparing';
    const followupAckLoss=mode==='compound-managed-followup-ack-loss',followupCancel=mode==='compound-managed-followup-cancel',userFollowup=mode==='compound-managed-followup'||followupCancel||followupAckLoss||followupClosePreparing;
    const followupFailure=deferred<unknown>();const ackLossError=Error('actual followup active acknowledgement lost');
    const followupPrepared=deferred<void>(),releaseFollowup=deferred<void>();cleanup.push(()=>releaseFollowup.resolve());
    const agentFollowup=mode==='compound-managed-agent-followup'||mode==='compound-managed-agent-followup-busy';
    const compoundManaged=mode==='compound-managed'||mode==='compound-managed-close'||mode==='compound-managed-parallel'||userFollowup||agentFollowup;
    const productRunner=mode===true||compoundRoot||compoundManaged||mode==='group-close-drain';
    const closeEntered=deferred<void>(),allowClose=deferred<void>();
    const firstTransportHeld=deferred<void>(),releaseFirstTransport=deferred<void>();let parallelObserved=false;cleanup.push(()=>releaseFirstTransport.resolve());
    const {homedir}=await import('node:os');const {writeFileSync,realpathSync}=await import('node:fs');
    const {createDesktopProductObservationGroup}=await import('../../electron/desktop-observation-group.js');
    const {DesktopMultiAgentRuntime}=await import('../../electron/desktop-multi-agent-runtime.js');
    const {DesktopCapabilityCatalog}=await import('../../electron/desktop-multi-agent-capabilities.js');
    const {ToolRegistry}=await import('../../../src/ai/tools/index.js');
    const capturedTools:import('../../../src/types.js').Tool[]=[];
    const originalRegister=ToolRegistry.prototype.registerTool;
    if(rootOrphan){const original=ToolRegistry.prototype.publishCompoundHistory;const spy=vi.spyOn(ToolRegistry.prototype,'publishCompoundHistory').mockImplementation(async function(this:InstanceType<typeof ToolRegistry>){await original.call(this);if(orphanInjected)return;orphanInjected=true;const {FileSessionStore}=await import('../../../src/ai/runtime/session-store/file-store.js');const {AgentSessionState}=await import('../../../src/ai/runtime/session.js');const orphan=new AgentSessionState();orphan.appendUserText('Unregistered actual canonical session');await new FileSessionStore(join(f.root,'compound-sessions')).save({...orphan.exportSnapshot(),sessionId:'actual-root-orphan'});});cleanup.push(()=>spy.mockRestore());}
    if(mode===false){const capture=vi.spyOn(ToolRegistry.prototype,'registerTool').mockImplementation(function(this:InstanceType<typeof ToolRegistry>,tool){capturedTools.push(tool);return originalRegister.call(this,tool);});cleanup.push(()=>capture.mockRestore());}
    if(compoundManaged){const {FileSessionStore}=await import('../../../src/ai/runtime/session-store/file-store.js');const save=FileSessionStore.prototype.save;const spy=vi.spyOn(FileSessionStore.prototype,'save').mockImplementation(async function(this:InstanceType<typeof FileSessionStore>,...args){try{return await save.apply(this,args);}catch(error){capturedAssertions.push(error);throw error;}});cleanup.push(()=>spy.mockRestore());}
    const {parseObservationPolicyFile}=await import('../../../src/runtime/sol-pi/product-bootstrap.js');
    const {createAdapterFromBinding}=await import('../../../src/ai/models.js');
    const {createSkillCatalog}=await import('../../../src/ai/skills/loader.js');
    let retainedGroup:Awaited<ReturnType<typeof createDesktopProductObservationGroup>>|undefined;let previousSemanticBinding:import('../../electron/desktop-observation-owner.js').DesktopObservationBinding|undefined;
    let runtime!:InstanceType<typeof DesktopMultiAgentRuntime>;let sends=0,rootSends=0;let source='';const bodies:unknown[]=[];let retainedRunner:ReturnType<typeof import('../../electron/desktop-services.js').createDesktopModelRunnerWithRegistry>|undefined;let retainedActivation:import('../../electron/desktop-observation-owner.js').DesktopObservationTaskActivation|undefined;
    vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{const body=JSON.parse(String(init?.body));bodies.push(body);
      if(compoundManaged&&JSON.stringify(body.messages[0]).includes('Assigned Desktop agent:')){
        const child=f.store.allAgents(f.store.getThread('t1')!.activeGroupId!).find(agent=>agent.parentId&&String(body.messages[0].content).includes(`Assigned Desktop agent: ${agent.canonicalName}\n`))!;
        expect(child,'actual Main child identity').toBeDefined();
        const {FileSessionStore}=await import('../../../src/ai/runtime/session-store/file-store.js');
        const {desktopObservationSessionId}=await import('../../../src/runtime/task-host/protected-observation-store.js');
        const durable=await new FileSessionStore(join(f.root,'compound-sessions')).load(desktopObservationSessionId(child.id));
        try{expect(durable?.compoundOperations?.managedTurns?.records.at(-1),'current generation must be durable before physical SDK fetch').toMatchObject({generation:followupCancel&&child.turn===2?3:child.turn,state:'active',turnId:child.turnId});}catch(error){capturedAssertions.push(error);throw error;}
      }
      if(mode==='compound-managed-parallel'){
        const response=(delta:unknown,tool=false)=>new Response('data: '+JSON.stringify({choices:[{delta,finish_reason:tool?'tool_calls':'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
        if(!JSON.stringify(body.messages[0]).includes('Assigned Desktop agent:')){
          rootSends++;
          if(rootSends===1)return response({tool_calls:[{index:0,id:'product-spawn',type:'function',function:{name:'spawn_agent',arguments:JSON.stringify({task_name:'managed',message:'Reply briefly.'})}}]},true);
          if(rootSends===2){await firstTransportHeld.promise;return response({tool_calls:[{index:0,id:'product-spawn-second',type:'function',function:{name:'spawn_agent',arguments:JSON.stringify({task_name:'managed2',message:'Independent child.'})}}]},true);}
          if(rootSends===3){
            const ack=body.messages.find((row:{tool_call_id?:string})=>row.tool_call_id==='product-spawn-second');
            try{expect(ack?.content,'second actual spawn ACK').not.toMatch(/^Error:/);expect(parallelObserved,'both actual child executions must be live').toBe(true);}finally{releaseFirstTransport.resolve();}
            return response({tool_calls:[{index:0,id:'product-wait',type:'function',function:{name:'wait_agent',arguments:JSON.stringify({targets:['/root/managed','/root/managed2'],timeout_ms:1000})}}]},true);
          }
          return response({content:'Root completed.'});
        }
        sends++;
        if(JSON.stringify(body.messages[0]).includes('/root/managed2')){
          parallelObserved=f.store.allAgents(f.store.getThread('t1')!.activeGroupId!).filter(agent=>agent.parentId&&agent.executionActive).length===2;
          releaseFirstTransport.resolve();return response({content:'Second managed result'});
        }
        if(sends===1)return response({tool_calls:[{index:0,id:'actual-managed-read',type:'function',function:{name:'read',arguments:JSON.stringify({file_path:source})}},{index:1,id:'actual-managed-message',type:'function',function:{name:'send_message',arguments:JSON.stringify({target:'main',message:'Managed progress'})}}]},true);
        firstTransportHeld.resolve();await releaseFirstTransport.promise;return response({content:'Managed real SDK result'});
      }
      if(agentFollowup&&!JSON.stringify(body.messages[0]).includes('Assigned Desktop agent:')){
        rootSends++;
        if(rootSends===3&&mode!=='compound-managed-agent-followup-busy')await vi.waitFor(()=>expect(f.store.allAgents(f.store.getThread('t1')!.activeGroupId!).find(agent=>agent.parentId)).toMatchObject({status:'completed',executionActive:false}),{timeout:20000});
        const tool=rootSends===1?{name:'spawn_agent',id:'product-spawn',args:{task_name:'managed',message:'Reply briefly.'}}:rootSends===2?{name:'wait_agent',id:'product-wait',args:{targets:['/root/managed'],timeout_ms:1000}}:rootSends===3?{name:'followup_task',id:'product-followup',args:{target:'/root/managed',message:'Actual agent second turn'}}:rootSends===4?{name:'wait_agent',id:'product-followup-wait',args:{targets:['/root/managed'],timeout_ms:1000}}:undefined;
        const delta=tool?{tool_calls:[{index:0,id:tool.id,type:'function',function:{name:tool.name,arguments:JSON.stringify(tool.args)}}]}:{content:'Root completed.'};
        return new Response('data: '+JSON.stringify({choices:[{delta,finish_reason:tool?'tool_calls':'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
      }
      if(productRunner&&!JSON.stringify(body.messages[0]).includes('Assigned Desktop agent:')){rootSends++;const delta=compoundRoot?(rootSends===1?{tool_calls:[{index:0,id:'compound-group-read',type:'function',function:{name:'read',arguments:JSON.stringify({file_path:source})}}]}:{content:'Root completed.'}):rootSends===1?{tool_calls:[{index:0,id:'product-spawn',type:'function',function:{name:'spawn_agent',arguments:JSON.stringify({task_name:'managed',message:'Reply briefly.'})}}]}:rootSends===2?{tool_calls:[{index:0,id:'product-wait',type:'function',function:{name:'wait_agent',arguments:JSON.stringify({targets:['/root/managed'],timeout_ms:1000})}}]}:mode==='compound-managed-close'&&rootSends===3?{tool_calls:[{index:0,id:'product-close',type:'function',function:{name:'close_agent',arguments:JSON.stringify({target:'/root/managed'})}}]}:{content:'Root completed.'};return new Response('data: '+JSON.stringify({choices:[{delta,finish_reason:rootSends<(compoundRoot?2:mode==='compound-managed-close'?4:3)?'tool_calls':'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});}sends++;const delta=sends===1?{tool_calls:[{index:0,id:'actual-managed-read',type:'function',function:{name:'read',arguments:JSON.stringify({file_path:source})}},{index:1,id:'actual-managed-message',type:'function',function:{name:'send_message',arguments:JSON.stringify({target:'main',message:'Managed progress'})}}]}:{content:'Managed real SDK result'};return new Response('data: '+JSON.stringify({choices:[{delta,finish_reason:sends===1?'tool_calls':'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});}));
    cleanup.push(()=>{vi.unstubAllGlobals();});
    const adapter=createAdapterFromBinding({providerId:'deepseek',providerType:'custom',modelId:'deepseek-flash',protocol:'openai_legacy',baseUrl:'https://api.deepseek.com',apiKey:'fixture-only',wireModel:'deepseek-flash',headers:{},capabilities:['tools']});
    const f=await setup(input=>runtime.createSession(input),async(context,input)=>{
      if(mode==='semantic-next-turn'&&retainedGroup){const {takeDesktopSemanticBoundary}=await import('../../electron/desktop-observation-owner.js');expect(()=>takeDesktopSemanticBoundary(previousSemanticBinding!)).toThrow();await retainedGroup.runRootTurn(context,'auto',input.signal,async turn=>{expect(takeDesktopSemanticBoundary(turn.binding)).toBe(true);expect(takeDesktopSemanticBoundary(turn.binding)).toBe(false);});return;}
      if(productRunner&&retainedRunner){await retainedRunner({...input,permissionMode:'auto'},context);expect(rootSends).toBeGreaterThanOrEqual(compoundRoot?3:4);expect(JSON.stringify(retainedActivation!.group!.session.getMessages())).toContain('Root completed.');return;}
      source=join(realpathSync(f.root),'source.txt');writeFileSync(source,'authorized source '.repeat(100));
      const policyFile=join(f.root,'policy.json'),expiresAt=Date.now()+120000;
      writeFileSync(policyFile,JSON.stringify({version:1,environmentId:'deepseek-recipe-0.1.1',model:'deepseek-flash',destination:{provider:'deepseek',url:'https://api.deepseek.com/chat/completions'},localPersistence:true,allowUnclassifiedText:true,allowModelDisclosure:true,allowIncomplete:false,expiresAt,readFileScopes:[{filePath:source,startLine:1}],bashSources:[],...((compoundRoot||compoundManaged)?{compoundExecution:{version:1,mode:'mechanism-experiment'}}:{}),ordinaryChildren:{enabled:true,maxDepth:1,maxChildren:2,expiresAt,nativeTools:['read']}}));
      if(productRunner){
        const {DesktopOwnedToolRegistry,DesktopToolCatalogBridge}=await import('../../electron/desktop-multi-agent-catalog-bridge.js');
        const {createDesktopModelRunnerWithRegistry}=await import('../../electron/desktop-services.js');
        const {createReadTool}=await import('../../../src/ai/tools/read.js');
        const config=await import('../../../src/utils/config.js');
        const mock=vi.spyOn(config,'loadConfig').mockResolvedValue({schemaVersion:2,defaultProvider:'deepseek',defaultModelId:'current',providers:{deepseek:{type:'custom',protocol:'openai_legacy',baseUrl:'https://api.deepseek.com',apiKey:'fixture-only'}},models:{current:{provider:'deepseek',model:'old-alias',label:'Current'}},defaultMode:'interactive'} as never);cleanup.push(()=>mock.mockRestore());
        const read=(compoundRoot||compoundManaged)?(await import('../../../src/ai/tools/index.js')).buildToolList(undefined,{cwd:realpathSync(f.root)}).find(tool=>tool.definition.name==='read')!:createReadTool({cwd:realpathSync(f.root)}),base=new DesktopOwnedToolRegistry({autoMode:true},[read]);cleanup.push(()=>base.dispose());
        const bridge=new DesktopToolCatalogBridge({registry:base,workspaceId:'w1',getService:()=>f.service});cleanup.push(()=>bridge.dispose());
        const activation:import('../../electron/desktop-observation-owner.js').DesktopObservationTaskActivation={policy:parseObservationPolicyFile(policyFile),profileRoot:join(f.root,'profile'),environmentRoot:join(homedir(),'.cache/xiaok/sol-pi/deepseek-recipe-0.1.1'),onPrompt:async()=>true,consumed:false};
        const materials=new MaterialRegistry({workspaceRoot:join(f.root,'runner-materials'),maxBytes:1048576});
        const runner=createDesktopModelRunnerWithRegistry(base,[read],f.root,{} as never,materials,{}, {observationTasks:new Map([[input.taskId,activation]]),observationGroupHost:{getHost:()=>f.host,observationStore:new FileTaskSnapshotStore(join(f.root,'tasks')).observations},multiAgent:{runtime,service:f.service,catalog:bridge,workspaceId:'w1',cwd:realpathSync(f.root)}});
        retainedRunner=runner;retainedActivation=activation;
        if(rootOrphan){await expect(runner({...input,permissionMode:'auto'},context)).rejects.toThrow('SOL_PI_TRANSPORT_AUTHORIZATION_REJECTED');expect(orphanInjected).toBe(true);expect(rootSends,'orphan must stop the actual root second SDK').toBe(1);return;}
        try{await runner({...input,permissionMode:'auto'},context);}catch(error){if(compoundManaged)throw new Error(JSON.stringify({agents:f.store.allAgents(context.groupId),history:activation.group?.session.getMessages()}),{cause:error});throw error;}
        if(compoundRoot){
          expect(rootSends).toBe(2);expect(sends).toBe(0);
          const {FileSessionStore}=await import('../../../src/ai/runtime/session-store/file-store.js');
          const durable=await new FileSessionStore(join(f.root,'compound-sessions')).load(activation.group!.session.exportSnapshot().sessionId);
          expect(durable?.protectedObservationClosure?.observations,JSON.stringify(durable?.messages)).toHaveLength(1);return;
        }
        expect(rootSends).toBeGreaterThanOrEqual(3);await vi.waitFor(()=>expect(sends,JSON.stringify({agents:f.store.allAgents(context.groupId),bodies})).toBe(mode==='compound-managed-parallel'||agentFollowup?3:2));
        expect(activation.group!.session.getProtectedObservationClosure()!.observations,JSON.stringify(bodies)).toHaveLength(1);
        if(compoundManaged){
          const outcomes=bodies.flatMap(body=>(body as {messages:Array<{role:string;tool_call_id:string;content:string}>}).messages.filter((message:{role:string})=>message.role==='tool').map((message:{tool_call_id:string;content:string})=>({id:message.tool_call_id,content:message.content})));
          for(const id of ['actual-managed-read','actual-managed-message','product-wait',...(mode==='compound-managed-close'?['product-close']:[]),...(agentFollowup?['product-followup','product-followup-wait']:[])]){const actual=outcomes.find(row=>row.id===id);expect(actual,id).toBeDefined();expect(actual!.content,id).not.toMatch(/^Error:/);}
        }
        return;
      }
      const base=new ToolRegistry({autoMode:true});cleanup.push(()=>base.dispose());
      const group=await createDesktopProductObservationGroup({service:f.service,host:f.host,context,observationStore:new FileTaskSnapshotStore(join(f.root,'tasks')).observations,
        taskId:input.taskId,cwd:realpathSync(f.root),policy:parseObservationPolicyFile(policyFile),sourceRegistry:base,profileRoot:join(f.root,'profile'),environmentRoot:join(homedir(),'.cache/xiaok/sol-pi/deepseek-recipe-0.1.1'),credentialSecrets:[],permissionMode:'auto',onPrompt:async()=>true});
      retainedGroup=group;
      cleanup.push(()=>group.dispose());
      let publicationReady=false;const publicationReleases:ReturnType<typeof vi.fn>[]=[];
      if(mode==='publication-persist-failure'){
        const {getObservationSessionOwnerHostBinding}=await import('../../../src/runtime/sol-pi/observation-session-owner.js');const {requireDesktopProductHost}=await import('../../electron/desktop-observation-owner.js');const port=getObservationSessionOwnerHostBinding(requireDesktopProductHost(group.productBinding).product.owner).service.transportPort;
        const originalSubscribe=port.onRevoke.bind(port);let collecting=false;
        const subscribe=vi.spyOn(port,'onRevoke').mockImplementation(listener=>{const release=vi.fn(originalSubscribe(listener));if(collecting)publicationReleases.push(release);return release;});cleanup.push(()=>subscribe.mockRestore());
        const module=await import('../../../src/runtime/sol-pi/observation-message-publication.js');const originalPrepare=module.prepareObservationMessagePublication;
        const prepare=vi.spyOn(module,'prepareObservationMessagePublication').mockImplementation(async input=>{collecting=true;try{const result=await originalPrepare(input);publicationReady=true;return result;}finally{collecting=false;}});cleanup.push(()=>prepare.mockRestore());
        const originalPersist=group.observationStore.persistSession.bind(group.observationStore);const persist=vi.spyOn(group.observationStore,'persistSession').mockImplementation(async(...args)=>{if(publicationReady){publicationReady=false;throw Error('post-publication sidecar persistence failure');}return originalPersist(...args);});cleanup.push(()=>persist.mockRestore());
      }
      await group.runRootTurn(context,'auto',input.signal,async turn=>{
        const {takeDesktopSemanticBoundary,requireDesktopObservationBinding}=await import('../../electron/desktop-observation-owner.js');
        previousSemanticBinding=turn.binding;
        const semanticClaims=requireDesktopObservationBinding(turn.binding,input.taskId,turn.registry);
        expect(()=>f.service.takeGroupSubtaskBoundary({actor:context.actor,requestSource:'agent',ticket:{...semanticClaims.groupReference!.ticket}})).toThrow();
        expect(()=>f.service.takeGroupSubtaskBoundary({actor:context.actor,requestSource:'user',ticket:semanticClaims.groupReference!.ticket})).toThrow();
        expect(takeDesktopSemanticBoundary(turn.binding)).toBe(false);
        group.session.appendUserText('Create a bounded child.');
        const catalog=new DesktopCapabilityCatalog();const {createReadTool}=await import('../../../src/ai/tools/read.js');const read=createReadTool({cwd:realpathSync(f.root)});const descriptor=catalog.publish({requestSource:'scheduler',ownerId:'builtin',entry:{definition:read.definition,aliases:[],permission:read.permission,scope:{workspaceId:'w1',materialIds:[],permissions:[read.permission]},bindInvocation:()=>read.execute}});catalog.authorize({requestSource:'user',capabilityId:descriptor.capabilityId});
        const scope=runtime.bindRoot(context,{adapter,systemPrompt:'Root',catalog,policy:catalog.snapshotPolicy(),workspaceId:'w1',materialIds:[],registryOptions:{autoMode:true},materials:[],skillCatalog:createSkillCatalog(undefined,f.root),dataRoot:f.root,agents:[],emitRuntimeEvent:input.emitRuntimeEvent,observation:group});
        try{
          const raw=await scope.registry.executeTool('spawn_agent',{task_name:'managed',message:'Reply briefly.'},{signal:input.signal,taskId:input.taskId,session:group.session.exportSnapshot(),systemPrompt:'Root',toolDefinitions:scope.registry.getToolDefinitions(),toolInvocationId:'actual-spawn',messages:group.session.getMessages()});
          if(mode==='publication-persist-failure'){expect(raw).toContain('post-publication sidecar persistence failure');expect(sends).toBe(0);expect(publicationReleases.length).toBeGreaterThan(0);for(const release of publicationReleases)expect(release).toHaveBeenCalled();return;}
          expect(raw).not.toMatch(/^Error:/);const result=JSON.parse(raw);expect(result.state).toBe('applied');expect(raw).toBe(f.store.getOperation(context.groupId,result.operationId)?.fixedAckBytes);
          await vi.waitFor(()=>expect(f.store.getAgent(context.groupId,result.targetAgentId)!.executionActive).toBe(false));
          const settled=await f.service.wait({actor:context.actor,requestSource:'agent',targets:[result.targetAgentId],timeoutMs:1000});
          expect(settled.agents[0].status,JSON.stringify(settled)).toBe('completed');expect(sends).toBe(2);expect(group.session.getProtectedObservationClosure()!.observations).toHaveLength(1);
          if(mode==='closed-result-read'){
            await f.service.close({actor:context.actor,requestSource:'agent',operationId:'close-completed-source',target:result.targetAgentId});
            await vi.waitFor(()=>expect(f.store.getAgent(context.groupId,result.targetAgentId)!.resourcesReleased).toBe(true));
            const closed=await f.service.wait({actor:context.actor,requestSource:'agent',targets:[result.targetAgentId],timeoutMs:1000});
            expect(closed.agents[0].status).toBe('closed');
            const page=await f.service.listForModel({actor:context.actor,requestSource:'agent'});
            expect(page.items.some(agent=>agent.id===result.targetAgentId)).toBe(true);
          }
          const inbox=await context.mailbox.drainInput();expect(inbox.messages.some(row=>row.preview==='Managed progress')).toBe(true);if(inbox.claimId)await context.mailbox.returnClaim(inbox.claimId);
          expect(f.store.listMessages(context.groupId,context.agentId).map(row=>row.preview)).toContain('Managed real SDK result');
          if(mode!=='semantic-next-turn'){expect(takeDesktopSemanticBoundary(turn.binding)).toBe(true);expect(takeDesktopSemanticBoundary(turn.binding)).toBe(false);}
        }finally{scope.dispose();}
      });
    },{expectedDisposeError:followupAckLoss?ackLossError:undefined,isolatedConfigRoot:compoundRoot||compoundManaged,prepareObservationSession:async input=>{const prepared=await runtime.prepareObservationSession(input);if(mode==='group-close-drain'){const original=prepared.session.dispose.bind(prepared.session);prepared.session.dispose=async()=>{closeEntered.resolve();await allowClose.promise;return original();};}if(mode===false){try{const {getManagedCompoundSpawnAdapter}=await import('../../../src/runtime/sol-pi/compound-managed-tool.js');const matches=capturedTools.flatMap(tool=>{const adapter=getManagedCompoundSpawnAdapter(tool);if(!adapter)return [];try{return [adapter.inspectPreparation(input.preparation)];}catch{return [];}});expect(matches).toHaveLength(1);expect(matches[0]).toMatchObject({nativeInvocationId:'actual-spawn',childSessionId:expect.any(String),childTurnId:input.context.turnId,initialMessage:input.message,agentId:input.identity.id,operationId:input.operationId});expect(JSON.parse(matches[0].ackBytes).targetAgentId).toBe(input.identity.id);for(const tool of capturedTools){const adapter=getManagedCompoundSpawnAdapter(tool);if(adapter)expect(()=>adapter.inspectPreparation({...input.preparation})).toThrow();}}catch(error){prepared.publication.dispose();try{await prepared.session.dispose();}finally{prepared.releasePreparation();}throw error;}}return prepared;},prepareObservationMessage:input=>runtime.prepareObservationMessage(input),prepareObservationFollowup:async preparation=>{expect(()=>f.service.inspectManagedFollowupPreparation({...preparation})).toThrow();const facts=f.service.inspectManagedFollowupPreparation(preparation);if(agentFollowup){expect(facts.origin?.session).toBe(retainedActivation!.group!.session);expect(facts.origin?.nativeInvocationId).toEqual(expect.any(String));expect(facts.operationId.endsWith(':'+facts.origin!.nativeInvocationId)).toBe(true);}else expect(facts.origin).toBeUndefined();const result=await runtime.prepareObservationFollowup(preparation);if(followupCancel||followupClosePreparing){followupPrepared.resolve();await releaseFollowup.promise;}return {commitApplied:async receipt=>{await expect(result.commitApplied({...receipt as object})).rejects.toThrow();await result.commitApplied(receipt);if(followupAckLoss)throw ackLossError;},cancelBeforeApplied:async receipt=>{await expect(result.cancelBeforeApplied({...receipt as object})).rejects.toThrow();return result.cancelBeforeApplied(receipt);}};}});
    if(userFollowup||agentFollowup){
      const target=f.service as unknown as {activateManagedFollowup(...args:unknown[]):Promise<void>},original=target.activateManagedFollowup.bind(target);
      const spy=vi.spyOn(target,'activateManagedFollowup').mockImplementation(async(...args)=>{try{return await original(...args);}catch(error){if(followupAckLoss&&error===ackLossError)followupFailure.resolve(error);else capturedAssertions.push(error);throw error;}});cleanup.push(()=>spy.mockRestore());
    }
    let resourcePreparation:Parameters<typeof f.service.assertObservationChildPersistence>[0]|undefined;
    let resourceAdmission:import('../../../src/runtime/sol-pi/compound-managed-admission.js').ManagedCompoundAdmission|undefined;
    if(mode==='compound-managed'){
      const original=f.service.bindManagedObservationAdmission.bind(f.service);
      const spy=vi.spyOn(f.service,'bindManagedObservationAdmission').mockImplementation((preparation,input)=>{const result=original(preparation,input);resourceAdmission=input.admission;resourcePreparation=preparation;expect(()=>f.service.assertObservationChildPersistence(preparation,input.admission)).not.toThrow();expect(()=>f.service.assertObservationChildPersistence(preparation,{...input.admission})).toThrow();return result;});cleanup.push(()=>spy.mockRestore());
    }
    let cancellationTicket:object|undefined,wrongKindCheck:Promise<unknown>|undefined;
    if(mode==='compound-managed-close'){
      const original=f.service.prepareManagedCancellation.bind(f.service);
      const spy=vi.spyOn(f.service,'prepareManagedCancellation').mockImplementation((context,kind,input)=>{
        const ticket=original(context,kind,input);cancellationTicket=ticket;
        const other=original(context,kind,input);
        wrongKindCheck=expect(f.service.runManagedCancellation(other,async()=>JSON.stringify(await f.service.interrupt({actor:context.actor,requestSource:'agent',operationId:`${context.turnId}:${input.nativeInvocationId}`,target:String(input.finalInput.target)})))).rejects.toThrow('SOL_PI_DESKTOP_CANCEL_STALE');
        return ticket;
      });cleanup.push(()=>spy.mockRestore());
    }
    runtime=new DesktopMultiAgentRuntime({service:f.service});await f.start();await f.host.drain();if(!rootOrphan&&(productRunner||mode==='semantic-next-turn')){await f.start();await f.host.drain();}
    if(userFollowup){
      const groupId=f.store.getThread('t1')!.activeGroupId!,child=f.store.allAgents(groupId).find(agent=>agent.parentId)!;
      const access=f.service.createUserAccess({requestSource:'user',actorId:'actual-user',threadId:'t1',profileId:'p1',workspaceId:'w1'});
      const request={access,requestSource:'user' as const,groupId,agentId:child.id,operationId:'actual-user-followup',expectedTurn:child.turn,message:'Second turn after two root tasks'};
      const followupResult=await f.service.userFollowup(request);expect(followupResult,JSON.stringify(followupResult)).toMatchObject({state:'queued_next_admission',expectedTurn:2});
      if(followupClosePreparing){
        await followupPrepared.promise;let closed=false;
        const closing=f.service.dispose().then(()=>{closed=true;});
        await new Promise(resolve=>setTimeout(resolve,30));
        expect(closed).toBe(false);expect(retainedActivation!.group!.product.getStatus().disposed).toBe(false);expect(sends).toBe(2);
        releaseFollowup.resolve();await closing;
        expect(closed).toBe(true);expect(retainedActivation!.group!.product.getStatus().disposed).toBe(true);expect(sends).toBe(2);return;
      }
      if(followupCancel){await followupPrepared.promise;await f.service.userInterrupt({access,requestSource:'user',groupId,agentId:child.id,operationId:'cancel-prepared-followup',expectedTurn:child.turn});releaseFollowup.resolve();const {FileSessionStore}=await import('../../../src/ai/runtime/session-store/file-store.js');const {desktopObservationSessionId}=await import('../../../src/runtime/task-host/protected-observation-store.js');await vi.waitFor(async()=>expect((await new FileSessionStore(join(f.root,'compound-sessions')).load(desktopObservationSessionId(child.id)))?.compoundOperations?.managedTurns?.records.at(-1)?.state).toBe('cancelled_before_activation'),{timeout:10000});request.operationId='actual-user-followup-after-cancel';expect(await f.service.userFollowup(request)).toMatchObject({state:'queued_next_admission',expectedTurn:2});}
      if(followupAckLoss){
        expect(await followupFailure.promise).toBe(ackLossError);
        const {FileSessionStore}=await import('../../../src/ai/runtime/session-store/file-store.js');const {desktopObservationSessionId}=await import('../../../src/runtime/task-host/protected-observation-store.js');
        const durable=await new FileSessionStore(join(f.root,'compound-sessions')).load(desktopObservationSessionId(child.id));
        expect(durable?.compoundOperations?.managedTurns?.records.at(-1)).toMatchObject({generation:2,state:'active'});
        expect(f.store.getOperation(groupId,request.operationId)?.applyState).toBe('applied');
        expect(sends).toBe(2);
        await expect(f.service.userFollowup({...request,operationId:'must-not-replay-active-turn'})).rejects.toThrow();
        expect(sends).toBe(2);
        await expect(f.service.dispose()).rejects.toBe(ackLossError);
        expect(retainedActivation!.group!.product.getStatus().disposed).toBe(false);return;
      }
      await vi.waitFor(()=>{expect(sends,JSON.stringify(f.store.getAgent(groupId,child.id))).toBe(3);expect(f.store.getAgent(groupId,child.id)).toMatchObject({turn:2,status:'completed',executionActive:false});},{timeout:20000});
      expect(await f.service.userFollowup(request)).toMatchObject({state:'applied',expectedTurn:2});
      expect(sends).toBe(3);
    }
    if(mode==='compound-managed'){
      expect(resourceAdmission).toBeDefined();
      expect(()=>f.service.assertManagedResourceCurrent(resourceAdmission!)).not.toThrow();
      expect(()=>f.service.assertObservationChildPersistence(resourcePreparation!,resourceAdmission!)).not.toThrow();
      expect(()=>f.service.assertObservationChildPersistence({...resourcePreparation!},resourceAdmission!)).toThrow();
      expect(()=>f.service.assertObservationChildPersistence(resourcePreparation!,{...resourceAdmission!})).toThrow();
      expect(()=>f.service.assertManagedResourceCurrent({...resourceAdmission!})).toThrow();
      await f.service.dispose();
      expect(()=>f.service.assertManagedResourceCurrent(resourceAdmission!)).toThrow();
      expect(()=>f.service.assertObservationChildPersistence(resourcePreparation!,resourceAdmission!)).toThrow();
    }
    if(mode==='compound-managed-close'){await wrongKindCheck;expect(cancellationTicket).toBeDefined();const work=vi.fn(async()=> 'must not run');await expect(f.service.runManagedCancellation({...cancellationTicket},work)).rejects.toThrow();await expect(f.service.runManagedCancellation(cancellationTicket,work)).rejects.toThrow();expect(work).not.toHaveBeenCalled();}
    if(mode==='group-close-drain'){const closing=f.service.dispose();try{await closeEntered.promise;await new Promise(resolve=>setTimeout(resolve,25));expect(retainedActivation!.group!.product.getStatus().disposed).toBe(false);}finally{allowClose.resolve();await closing;}expect(retainedActivation!.group!.product.getStatus().disposed).toBe(true);}
  },120000);

  it('retains an actual product group owner and native history across two real root tasks with durable alias publication', async () => {
    const {homedir}=await import('node:os');const {existsSync,writeFileSync,realpathSync}=await import('node:fs');
    const environmentRoot=join(homedir(),'.cache/xiaok/sol-pi/deepseek-recipe-0.1.1');
    if(process.platform!=='darwin'||process.arch!=='arm64'||!existsSync(join(environmentRoot,'manifest.json')))throw Error('actual product capacity environment required');
    const {createDesktopProductObservationGroup}=await import('../../electron/desktop-observation-group.js');
    const {ToolRegistry,buildToolList}=await import('../../../src/ai/tools/index.js');
    const {parseObservationPolicyFile}=await import('../../../src/runtime/sol-pi/product-bootstrap.js');
    const {requireDesktopObservationBinding}=await import('../../electron/desktop-observation-owner.js');
    let group:Awaited<ReturnType<typeof createDesktopProductObservationGroup>>|undefined;
    let count=0,firstSession:unknown, retiredRegistry:InstanceType<typeof ToolRegistry>|undefined;const ids:string[]=[];
    const f=await setup(async()=>{throw Error('no child in group lifetime case');},async(context,input)=>{
      if(!group){
        const source=realpathSync(join(f.root,'source.txt')),policyFile=join(f.root,'policy.json'),expiresAt=Date.now()+120000;
        writeFileSync(policyFile,JSON.stringify({version:1,environmentId:'deepseek-recipe-0.1.1',model:'deepseek-flash',destination:{provider:'deepseek',url:'https://api.deepseek.com/chat/completions'},localPersistence:true,allowUnclassifiedText:true,allowModelDisclosure:true,allowIncomplete:false,expiresAt,readFileScopes:[{filePath:source,startLine:1}],bashSources:[],ordinaryChildren:{enabled:true,maxDepth:1,maxChildren:2,expiresAt,nativeTools:['read']}}));
        const registry=new ToolRegistry({autoMode:true},buildToolList(undefined,{cwd:realpathSync(f.root)}));cleanup.push(()=>registry.dispose());
        group=await createDesktopProductObservationGroup({service:f.service,host:f.host,context,observationStore:new FileTaskSnapshotStore(join(f.root,'tasks')).observations,
          taskId:input.taskId,cwd:realpathSync(f.root),policy:parseObservationPolicyFile(policyFile),sourceRegistry:registry,profileRoot:join(f.root,'profile'),environmentRoot,credentialSecrets:[],permissionMode:'auto',onPrompt:async()=>true});
        cleanup.push(()=>group!.dispose());
      }
      await group.runRootTurn(context,'auto',input.signal,async turn=>{
        const facts=requireDesktopObservationBinding(turn.binding,input.taskId,turn.registry);
        retiredRegistry=turn.registry;
        if(!firstSession)firstSession=facts.session;else expect(facts.session).toBe(firstSession);
        expect(facts.session.getMessages()).toHaveLength(count);
        facts.session.appendUserText(`actual root ${++count}`);ids.push(input.taskId);
        const invocation=`actual-read-${count}`;
        const result=await turn.registry.executeTool('read',{file_path:realpathSync(join(f.root,'source.txt')),max_chars:80},{signal:input.signal,taskId:input.taskId,session:facts.session.exportSnapshot(),messages:facts.session.getMessages(),systemPrompt:'Root',toolDefinitions:turn.registry.getToolDefinitions(),observationCollector:facts.owner.collectorFor(invocation),projectObservationResult:value=>facts.owner.projectToolResult(invocation,value)});
        expect(result).toContain('[observation ');expect(result).not.toContain('unavailable');
        expect((await f.host.recoverTask(input.taskId)).snapshot.protectedObservationClosure).toEqual(facts.session.getProtectedObservationClosure());
      });
    });
    writeFileSync(join(f.root,'source.txt'),'source text '.repeat(500));
    await f.start();await f.host.drain();
    await expect(retiredRegistry!.executeTool('read',{file_path:realpathSync(join(f.root,'source.txt'))})).resolves.toBe('Error: tool registry is disposed');
    await f.start();await f.host.drain();
    expect(count).toBe(2);expect(ids[0]).not.toBe(ids[1]);
  },120000);

  it('publishes a real archived root closure through the actual group journal and rejects copied tickets', async () => {
    let retained: any;
    const f = await setup(async () => { throw new Error('no child'); }, async (context, input) => {
      if (retained) {
        const { owner, session, canonical } = retained;
        const before = (await f.host.recoverTask(canonical)).snapshot;
        expect(before.status).toBe('completed');
        const port = owner.collectorFor('capture-second').begin({ toolName: 'bash', source: { command: 'fixture', workdir: f.root } });
        port.append('second result'); port.finalize({ executionState: 'terminal', outcome: 'success' }); await owner.projectToolResult('capture-second', 'second result');
        const failed = f.service.prepareGroupObservationReference({ actor: context.actor, requestSource: 'agent', taskId: canonical, operationId: 'failed-terminal-save' });
        const originalSave = FileTaskSnapshotStore.prototype.save;
        const failingSave = vi.spyOn(FileTaskSnapshotStore.prototype, 'save').mockImplementation(function(this: FileTaskSnapshotStore, ...args: Parameters<FileTaskSnapshotStore['save']>) {
          return args[0].taskId === canonical ? Promise.reject(new Error('actual terminal journal failure')) : originalSave.apply(this, args);
        });
        try { await expect(f.host.publishGroupObservationReference(failed)).rejects.toThrow('actual terminal journal failure'); }
        finally { failingSave.mockRestore(); }
        expect(f.store.getOperation(context.groupId, 'failed-terminal-save')).toBeNull();
        const failedAfter = (await f.host.recoverTask(canonical)).snapshot;
        expect({ ...failedAfter, protectedObservationClosure: undefined }).toEqual({ ...before, protectedObservationClosure: undefined });
        expect(failedAfter.protectedObservationClosure?.observations).toHaveLength(2); // sidecar protection remains conservative after journal failure
        const tickets = ['union-one', 'union-two'].map(operationId => f.service.prepareGroupObservationReference({ actor: context.actor, requestSource: 'agent', taskId: canonical, operationId }));
        await Promise.all(tickets.map(ticket => f.host.publishGroupObservationReference(ticket)));
        const after = (await f.host.recoverTask(canonical)).snapshot;
        expect(after.protectedObservationClosure?.observations).toHaveLength(2);
        const { protectedObservationClosure: _old, ...oldFacts } = before;
        const { protectedObservationClosure: _new, ...newFacts } = after;
        expect(newFacts).toEqual(oldFacts);
        const alias = f.service.prepareGroupObservationReference({ actor: context.actor, requestSource: 'agent', taskId: input.taskId, operationId: 'new-turn-alias' });
        await f.host.publishGroupObservationReference(alias);
        expect(await new FileTaskSnapshotStore(join(f.root, 'tasks')).observations.read(input.taskId)).toEqual(session.getProtectedObservationClosure());
        const { bindDesktopGroupObservationSession, requireDesktopObservationBinding } = await import('../../electron/desktop-observation-owner.js');
        const { ToolRegistry } = await import('../../../src/ai/tools/index.js');
        const registry = new ToolRegistry({}, []);
        try {
          expect(() => bindDesktopGroupObservationSession({ service: f.service, ticket: { ...alias }, registry })).toThrow();
          const binding = bindDesktopGroupObservationSession({ service: f.service, ticket: alias, registry });
          expect(requireDesktopObservationBinding(binding, input.taskId, registry).session).toBe(session);
          expect(() => requireDesktopObservationBinding(binding, canonical, registry)).toThrow();
          const more = owner.collectorFor('capture-third').begin({ toolName: 'bash', source: { command: 'fixture', workdir: f.root } });
          more.append('third result'); more.finalize({ executionState: 'terminal', outcome: 'success' }); await owner.projectToolResult('capture-third', 'third result');
          expect(() => requireDesktopObservationBinding(binding, input.taskId, registry)).toThrow(/NOT_PUBLISHED/);
          const updated = f.service.prepareGroupObservationReference({ actor: context.actor, requestSource: 'agent', taskId: input.taskId, operationId: 'alias-more' });
          await f.host.publishGroupObservationReference(updated);
          expect(requireDesktopObservationBinding(binding, input.taskId, registry).session).toBe(session);
        } finally { registry.dispose(); }

        const stale = f.service.prepareGroupObservationReference({ actor: context.actor, requestSource: 'agent', taskId: canonical, operationId: 'reference-stale' });
        owner.dispose(); await expect(f.host.publishGroupObservationReference(stale)).rejects.toThrow();
        const replacement = retained.replacement(input.taskId);
        try { expect(() => f.service.registerGroupObservationOwner({ actor: context.actor, requestSource: 'agent', owner: replacement, canonicalTaskId: input.taskId })).toThrow(/AUTHORIZATION_REBIND/); }
        finally { replacement.dispose(); }
        return;
      }
      const { createObservationService } = await import('../../../src/runtime/sol-pi/observation-service.js');
      const { createObservationSessionOwner } = await import('../../../src/runtime/sol-pi/observation-session-owner.js');
      const { AgentSessionState } = await import('../../../src/ai/runtime/session.js');
      const { desktopObservationSessionId } = await import('../../../src/runtime/task-host/protected-observation-store.js');
      const { testOnlyCapacity } = await import('../../../tests/support/sol-pi-capacity.js');
      const archive = createObservationService({ profileRoot: join(f.root, 'archive'), profileId: 'test', redactor: { version: 'test', redact: text => text } });
      const session = new AgentSessionState(); session.restoreSnapshot({ ...session.exportSnapshot(), sessionId: desktopObservationSessionId(input.taskId) });
      const claims = { sessionId: session.exportSnapshot().sessionId, ownerAgentId: 'root', scopeId: 'root', permissionGeneration: 1, surface: 'ordinary-owner' as const };
      const caller = archive.bindCaller({ ...claims, requestSource: 'agent' });
      const user = archive.bindCaller({ ...claims, requestSource: 'user' });
      const destination = { provider: 'test', model: 'test', url: 'https://example.test/chat/completions' };
      archive.setArchivePolicy({ requestSource: 'user', caller: user, policy: { version: 1, id: 'source', revision: 1, scopeId: 'root', sourceAdapterId: 'native.bash.v1', sourceDescriptors: [JSON.stringify({ toolName: 'bash', command: 'fixture', workdir: f.root })], localPersistence: true, allowUnclassifiedText: true, allowIncomplete: false, expiresAt: Date.now() + 60000, destinations: [destination] } });
      const sidecar = new FileTaskSnapshotStore(join(f.root, 'tasks')).observations;
      const owner = createObservationSessionOwner({ service: archive, caller, session, destination, capacityProfile: testOnlyCapacity(destination.url, destination.model), persist: snapshot => sidecar.persistSession(input.taskId, snapshot) });
      retained = { owner, session, canonical: input.taskId, replacement(taskId: string) {
        const next = new AgentSessionState(); next.restoreSnapshot({ ...next.exportSnapshot(), sessionId: desktopObservationSessionId(taskId) });
        const caller = archive.bindCaller({ ...claims, sessionId: next.exportSnapshot().sessionId, requestSource: 'agent' });
        return createObservationSessionOwner({ service: archive, caller, session: next, destination, capacityProfile: testOnlyCapacity(destination.url, destination.model), persist: snapshot => sidecar.persistSession(taskId, snapshot) });
      } };
      cleanup.push(() => { owner.dispose(); archive.dispose(); });
      {
        f.service.registerGroupObservationOwner({ actor: context.actor, requestSource: 'agent', owner, canonicalTaskId: input.taskId });
        const port = owner.collectorFor('capture').begin({ toolName: 'bash', source: { command: 'fixture', workdir: f.root } });
        port.append('actual archived result'); port.finalize({ executionState: 'terminal', outcome: 'success' }); await owner.projectToolResult('capture', 'actual archived result');
        const request = { actor: context.actor, requestSource: 'agent' as const, taskId: input.taskId, operationId: 'reference-one' };
        for (const requestSource of ['user', 'scheduler'] as const) expect(() => f.service.prepareGroupObservationReference({ ...request, requestSource })).toThrow();
        expect(() => f.service.registerGroupObservationOwner({ actor: { ...context.actor }, requestSource: 'agent', owner, canonicalTaskId: input.taskId })).toThrow();
        f.service.registerThread({ threadId: 'foreign-reference-thread', profileId: 'p1', workspaceId: 'w1', cwd: f.root });
        const foreign = f.store.createGroup('foreign-reference-thread');
        f.store.putRootBinding({ ...f.store.getRootBinding(input.taskId)!, groupId: foreign.groupId, threadId: 'foreign-reference-thread', sourceTaskId: 'foreign-target', preparationId: 'foreign-preparation' });
        expect(() => f.service.prepareGroupObservationReference({ ...request, taskId: 'foreign-target' })).toThrow(/AUTHORIZATION/);
        const ticket = f.service.prepareGroupObservationReference(request);
        await expect(f.host.publishGroupObservationReference({ ...ticket })).rejects.toThrow(/AUTHORIZATION/);
        await f.host.publishGroupObservationReference(ticket);
        expect((await f.host.recoverTask(input.taskId)).snapshot.protectedObservationClosure).toEqual(session.getProtectedObservationClosure());
        expect(f.store.getOperation(context.groupId, 'reference-one')).toMatchObject({ command: 'observation_reference', applyState: 'applied' });
        await expect(f.host.publishGroupObservationReference(ticket)).rejects.toThrow(/AUTHORIZATION/);
      }
    });
    await f.start(); await f.host.drain();
    await f.start(); await f.host.drain();
  });

  it('U1 Given a root-only thread and a foreign child, Then the real snapshot and first-root notification deny history while explicit audit reads remain available', async () => {
    const createSession = vi.fn(); const f = await setup(createSession, async () => {});
    f.service.registerThread({ threadId: 'foreign', profileId: 'other-profile', workspaceId: 'other-workspace', cwd: f.root });
    const foreign = f.store.createGroup('foreign');
    f.store.putAgent(foreign.groupId, { id: 'foreign-child', parentId: `root_${foreign.groupId}`, taskName: 'foreign', canonicalName: '/root/foreign',
      depth: 1, status: 'closed', turn: 1, resourcesReleased: true, activationState: 'settled' });
    const access = f.service.createUserAccess({ requestSource: 'user', actorId: 'user', threadId: 't1', profileId: 'p1', workspaceId: 'w1' });
    expect(f.service.getSnapshot({ access })).toMatchObject({ group: null, root: null, hasAgentHistory: false, threadDeleteState: 'none' });
    const received = vi.fn(); const unsubscribe = f.service.subscribe(access, received);
    try {
      await f.start(); await f.host.drain();
      const groupId = f.store.activeGroup('t1')!.groupId;
      expect(received).toHaveBeenCalledWith(expect.objectContaining({ channel: 'group_changed', threadId: 't1', oldGroupId: null,
        newGroupId: groupId, hasAgentHistory: false, threadDeleteState: 'none' }));
      expect(f.service.getSnapshot({ access, groupId })).toMatchObject({ hasAgentHistory: false, root: { status: 'completed' } });
      expect(f.service.listGroups({ access })).toEqual({ items: [], nextCursor: null });
      expect(f.store.listGroups('t1').items.map(item => item.groupId)).toEqual([groupId]);
      expect(() => f.service.getSnapshot({ access, groupId: foreign.groupId })).toThrow(/scope/);
      expect(() => f.service.getSnapshot({ access: { ...access } })).toThrow(/authority/);
      expect(createSession).not.toHaveBeenCalled();
    } finally { unsubscribe(); }
  });

  it('summary recovery requires a current root with fully settled current-turn children', async () => {
    const entered = deferred<void>(), release = deferred<string>();
    let current: DesktopAgentExecutionContext | undefined;
    const f = await setup(async () => ({ run: async () => { entered.resolve(); return release.promise; }, suspend: async () => {}, dispose: async () => {} }), async context => {
      current = context;
      expect(f.service.canResumeSummary(context)).toBe(false);
      const child = (await f.service.spawn({ actor: context.actor, requestSource: 'agent', operationId: 'summary-spawn', taskName: 'summary', message: 'work' })).targetAgentId!;
      expect(f.service.presentation({ actor: context.actor, requestSource: 'agent', target: child })).toEqual({ presentationOrdinal: 1 });
      expect(() => f.service.presentation({ actor: context.actor, requestSource: 'agent', target: 'foreign-child' })).toThrow();
      await entered.promise;
      expect(f.service.canResumeSummary(context)).toBe(false);
      release.resolve('complete result');
      await vi.waitFor(() => expect(f.service.canResumeSummary(context)).toBe(true));
      const saved = f.store.getAgent(context.groupId, child)!;
      f.store.putAgent(context.groupId, { ...saved, sourceTaskId: 'old-task' });
      expect(f.service.canResumeSummary(context)).toBe(false);
      f.store.putAgent(context.groupId, saved);
      expect(f.service.canResumeSummary(context)).toBe(true);
    });
    try { await f.start(); await f.host.drain(); expect(current).toBeDefined(); expect(() => f.service.canResumeSummary(current!)).toThrow(); }
    finally { release.resolve('cleanup'); }
  });

  it('U1 Given a real settled child, Then reset creates an empty current group without losing thread history or authorizing the historical child', async () => {
    const entered = deferred<void>(), release = deferred<string>(); let oldGroupId = '', childId = '';
    const f = await setup(async () => ({ run: async () => { entered.resolve(); return release.promise; }, suspend: async () => {}, dispose: async () => {} }), async context => {
      oldGroupId = context.groupId;
      childId = (await f.service.spawn({ actor: context.actor, requestSource: 'agent', operationId: 'history-spawn', taskName: 'history', message: 'work' })).targetAgentId!;
      await entered.promise;
    });
    try {
      await f.start(); await f.host.drain(); release.resolve('history result');
      await vi.waitFor(() => expect(f.store.getAgent(oldGroupId, childId)?.executionActive).toBe(false));
      const access = f.service.createUserAccess({ requestSource: 'user', actorId: 'user', threadId: 't1', profileId: 'p1', workspaceId: 'w1' });
      expect(f.service.getSnapshot({ access }).hasAgentHistory).toBe(true);
      const received = vi.fn(); const unsubscribe = f.service.subscribe(access, received);
      try {
        await f.service.resetGroup({ access, requestSource: 'user', operationId: 'history-reset', expectedGroupId: oldGroupId, confirmTerminate: true });
        await vi.waitFor(() => expect(f.store.activeGroup('t1')?.groupId).not.toBe(oldGroupId));
        const current = f.service.getSnapshot({ access });
        expect(current).toMatchObject({ hasAgentHistory: true, counts: { total: 1 }, threadDeleteState: 'none' });
        expect(current.agents.map(agent => agent.parentId)).toEqual([null]);
        expect(received).toHaveBeenCalledWith(expect.objectContaining({ channel: 'group_changed', oldGroupId,
          newGroupId: current.activeGroupId, hasAgentHistory: true, threadDeleteState: 'none' }));
        expect(f.service.listGroups({ access }).items.map(item => item.groupId)).toEqual([oldGroupId]);
        expect(f.store.listGroups('t1').items).toHaveLength(2);
        expect(f.service.getSnapshot({ access, groupId: oldGroupId })).toMatchObject({ hasAgentHistory: true, group: { historicalOnly: true } });
        await expect(f.service.userFollowup({ access, requestSource: 'user', groupId: oldGroupId, agentId: childId,
          operationId: 'history-cannot-run', expectedTurn: 1, message: 'must not start' })).rejects.toThrow(/historical|read.only/);
      } finally { unsubscribe(); }
    } finally { release.resolve('cleanup'); }
  });

  it('U1 Given an inactive historical child group, Then a null-expected reset publishes its history fact without creating a session', async () => {
    const createSession = vi.fn(); const f = await setup(createSession, async () => {});
    const old = f.store.createGroup('t1');
    f.store.putAgent(old.groupId, { id: 'old-child', parentId: `root_${old.groupId}`, taskName: 'old', canonicalName: '/root/old',
      depth: 1, status: 'closed', turn: 1, resourcesReleased: true, activationState: 'settled' });
    f.store.putGroup({ ...f.store.requireGroup(old.groupId), historicalOnly: true }, true); f.store.clearActiveGroup('t1', old.groupId);
    const access = f.service.createUserAccess({ requestSource: 'user', actorId: 'user', threadId: 't1', profileId: 'p1', workspaceId: 'w1' });
    expect(f.service.getSnapshot({ access })).toMatchObject({ group: null, activeGroupId: null, hasAgentHistory: true });
    const received = vi.fn(); const unsubscribe = f.service.subscribe(access, received);
    try {
      const result = await f.service.resetGroup({ access, requestSource: 'user', operationId: 'empty-reset', expectedGroupId: null, confirmTerminate: true });
      expect(result.state).toBe('completed');
      expect(received).toHaveBeenCalledWith(expect.objectContaining({ channel: 'group_changed', oldGroupId: null,
        newGroupId: result.groupId, hasAgentHistory: true, threadDeleteState: 'none' }));
      expect(createSession).not.toHaveBeenCalled();
    } finally { unsubscribe(); }
  });

  it('A1/A31 Given capacity=1, When the real root spawns two children and waits, Then both run under its lease and root receives durable results', async () => {
    const entered = deferred<void>(); const release = deferred<void>();
    let started = 0; let groupId = ''; let rootId = '';
    const fixture = await setup(async () => ({
      async run(message) { if (++started === 2) entered.resolve(); await release.promise; return `${message} result`; },
      async suspend() {}, async dispose() {},
    }), async context => {
      groupId = context.groupId; rootId = context.agentId;
      const a = await fixture.service.spawn({ actor: context.actor, requestSource: 'agent', operationId: 'spawn-a', taskName: 'a', message: 'one' });
      const b = await fixture.service.spawn({ actor: context.actor, requestSource: 'agent', operationId: 'spawn-b', taskName: 'b', message: 'two' });
      await entered.promise;
      expect(context.memberTicket.refCount).toBe(3);
      release.resolve();
      const waitInput = { actor: context.actor, requestSource: 'agent' as const, targets: [a.targetAgentId!, b.targetAgentId!], timeoutMs: 1000 };
      let waited = await fixture.service.wait(waitInput);
      const kinds: string[] = [];
      // A result may arrive before the corresponding suspend/settlement fence.
      // Model input consumes it; wait itself is notification-only.
      while (waited.reason === 'message') {
        const notification = await context.mailbox.drainInput();
        kinds.push(...notification.messages.map(message => message.kind));
        await context.mailbox.confirmApplied(notification.claimId!);
        waited = await fixture.service.wait(waitInput);
      }
      expect(waited.reason).toBe('settled_terminal');
      expect(waited.agents.every(agent => !agent.executionActive)).toBe(true);
      const batch = await context.mailbox.drainInput();
      kinds.push(...batch.messages.map(message => message.kind));
      expect(kinds).toEqual(['result', 'result']);
      if (batch.claimId) await context.mailbox.confirmApplied(batch.claimId);
    });
    await fixture.start(); await fixture.host.drain();
    expect(started).toBe(2);
    expect(fixture.coordinator.snapshot().active).toBe(0);
    expect(fixture.store.getAgent(groupId, rootId)).toMatchObject({ status: 'completed', executionActive: false });
  });

  it('A17/A37/A40 Given a suspended child, When a confirmed user reset awaits real dispose, Then no root/followup is admitted and settlement alone creates exactly one new group', async () => {
    const released = deferred<void>(); const entered = deferred<void>(); let groupId = ''; let childId = '';
    const fixture = await setup(async () => ({ run: async () => { entered.resolve(); return 'done'; }, suspend: async () => {}, dispose: () => released.promise }), async context => {
      groupId = context.groupId;
      childId = (await fixture.service.spawn({ actor: context.actor, requestSource: 'agent', operationId: 'spawn', taskName: 'child', message: 'work' })).targetAgentId!;
      await entered.promise;
    });
    try {
      await fixture.start(); await fixture.host.drain();
      await vi.waitFor(() => expect(fixture.store.getAgent(groupId, childId)?.executionActive).toBe(false));
      const access = fixture.service.createUserAccess({ requestSource: 'user', actorId: 'user', threadId: 't1', profileId: 'p1', workspaceId: 'w1' });
      const request = { access, requestSource: 'user' as const, expectedGroupId: groupId, confirmTerminate: true as const, operationId: 'reset-once' };
      await expect(fixture.service.resetGroup({ ...request, requestSource: 'agent' })).rejects.toThrow(/source/);
      await expect(fixture.service.resetGroup({ ...request, confirmTerminate: false as never })).rejects.toThrow(/confirm/);
      expect(fixture.store.activeGroup('t1')?.groupId).toBe(groupId);
      expect(await fixture.service.resetGroup(request)).toMatchObject({ state: 'cleanup_pending', groupId });
      expect(await fixture.service.resetGroup(request)).toMatchObject({ state: 'cleanup_pending', groupId });
      await expect(fixture.service.prepareRoot(fixture.host, 't1', { prompt: 'not yet', materials: [] })).rejects.toThrow(/reset_pending/);
      await expect(fixture.service.userFollowup({ access, requestSource: 'user', groupId, agentId: childId, expectedTurn: 1,
        operationId: 'denied-followup', message: 'not yet' })).rejects.toThrow(/reset_pending/);
      expect(fixture.service.runtimeStatus().residentSlots).toBe(1);
      released.resolve();
      await vi.waitFor(() => expect(fixture.store.activeGroup('t1')?.groupId).not.toBe(groupId));
      const next = fixture.store.activeGroup('t1')!;
      expect(next.groupId).toBeTruthy(); expect(fixture.store.requireGroup(groupId).historicalOnly).toBe(true);
      expect(fixture.service.runtimeStatus().residentSlots).toBe(0);
      expect(await fixture.service.resetGroup(request)).toMatchObject({ state: 'completed', groupId: next.groupId });
      expect(fixture.store.listGroups('t1').items).toHaveLength(2);
      expect(fixture.store.getOperation(groupId, 'reset-once')).toMatchObject({ applyState: 'applied', result: { phase: 'completed' } });
    } finally { released.resolve(); }
  });

  it('A17/A40 Given no active group, When a new user resets with null expected ID, Then a group is created idempotently and stale expected IDs cannot replace it', async () => {
    const fixture = await setup(vi.fn(), async () => {});
    const access = fixture.service.createUserAccess({ requestSource: 'user', actorId: 'user', threadId: 't1', profileId: 'p1', workspaceId: 'w1' });
    const request = { access, requestSource: 'user' as const, expectedGroupId: null, confirmTerminate: true as const, operationId: 'first-group' };
    const created = await fixture.service.resetGroup(request);
    expect(created.state).toBe('completed'); expect(created.groupId).toBeTruthy();
    expect(await fixture.service.resetGroup(request)).toEqual(created);
    await expect(fixture.service.resetGroup({ ...request, operationId: 'stale-null' })).rejects.toThrow(/expected|stale/);
    expect(fixture.store.listGroups('t1').items).toHaveLength(1);
  });

  it('A15/A40 Given reset intent committed but unused root projection write fails, Then the operation is unknown and a fresh confirmed operation can recover after storage recovers', async () => {
    const fixture = await setup(vi.fn(), async () => {});
    const group = fixture.store.createGroup('t1');
    const access = fixture.service.createUserAccess({ requestSource: 'user', actorId: 'user', threadId: 't1', profileId: 'p1', workspaceId: 'w1' });
    const input = { access, requestSource: 'user' as const, expectedGroupId: group.groupId, confirmTerminate: true as const, operationId: 'reset-write-fails' };
    const original = fixture.store.putAgent.bind(fixture.store);
    const fault = vi.spyOn(fixture.store, 'putAgent').mockImplementation((groupId, agent, control) => {
      if (agent.status === 'closed') throw new Error('SQLITE_FULL'); return original(groupId, agent, control);
    });
    let result: unknown;
    try { result = await fixture.service.resetGroup(input); } catch (error) { result = error; } finally { fault.mockRestore(); }
    expect(result).toMatchObject({ state: 'unknown' });
    expect(fixture.store.getOperation(group.groupId, input.operationId)?.applyState).toBe('unknown');
    expect(await fixture.service.resetGroup({ ...input, operationId: 'reset-after-recovery' })).toMatchObject({ state: 'completed' });
    expect(fixture.store.activeGroup('t1')?.groupId).not.toBe(group.groupId);
  });

  it.each(['rejected', 'synchronous', 'late'] as const)('A40 Given host cancel acknowledgement fails (%s) but its root physically settles, Then reset completes from real settlement without a second user reset', async mode => {
    const entered = deferred<void>(); const release = deferred<void>(); let groupId = '';
    const fixture = await setup(vi.fn(), async context => { groupId = context.groupId; entered.resolve(); await release.promise; });
    await fixture.start(); await entered.promise;
    const access = fixture.service.createUserAccess({ requestSource: 'user', actorId: 'user', threadId: 't1', profileId: 'p1', workspaceId: 'w1' });
    let rejectLate!: (error: Error) => void;
    const late = new Promise<void>((_resolve, reject) => { rejectLate = reject; }); void late.catch(() => {});
    const error = new Error('host acknowledgement unavailable');
    const fault = vi.spyOn(fixture.host, 'cancelTask').mockImplementation(() => { if (mode === 'synchronous') throw error; return mode === 'late' ? late : Promise.reject(error); });
    try {
      expect(await fixture.service.resetGroup({ access, requestSource: 'user', expectedGroupId: groupId, confirmTerminate: true, operationId: 'reset-host-warning' })).toMatchObject({ state: 'cleanup_pending' });
      await Promise.resolve(); release.resolve(); await fixture.host.drain();
      await vi.waitFor(() => expect(fixture.store.activeGroup('t1')?.groupId).not.toBe(groupId));
      if (mode === 'late') rejectLate(error);
      await vi.waitFor(() => expect(fixture.store.getOperation(groupId, 'reset-host-warning')?.result).toMatchObject({ state: 'completed', cancellationError: 'host acknowledgement unavailable' }));
    } finally { rejectLate(error); release.resolve(); fault.mockRestore(); }
  });

  it('A40 Given two concurrent null-expected resets, Then the real command and transaction owners grant only one group', async () => {
    const fixture = await setup(vi.fn(), async () => {});
    const access = fixture.service.createUserAccess({ requestSource: 'user', actorId: 'user', threadId: 't1', profileId: 'p1', workspaceId: 'w1' });
    const input = { access, requestSource: 'user' as const, expectedGroupId: null, confirmTerminate: true as const };
    const results = await Promise.allSettled(['a', 'b'].map(operationId => fixture.service.resetGroup({ ...input, operationId })));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(fixture.store.listGroups('t1').items).toHaveLength(1);
  });

  it('A25/A40 Given a reset waiting for a never-settled child, Then it never creates a replacement or clears audit rows and the original execution remains blocked', async () => {
    const entered = deferred<void>(); const release = deferred<string>(); let groupId = ''; let childId = '';
    const fixture = await setup(async () => ({ run: () => { entered.resolve(); return release.promise; }, suspend: async () => {}, dispose: async () => {} }), async context => {
      groupId = context.groupId;
      childId = (await fixture.service.spawn({ actor: context.actor, requestSource: 'agent', operationId: 'spawn', taskName: 'child', message: 'work' })).targetAgentId!;
      await entered.promise;
    });
    try {
      await fixture.start(); await fixture.host.drain();
      const access = fixture.service.createUserAccess({ requestSource: 'user', actorId: 'user', threadId: 't1', profileId: 'p1', workspaceId: 'w1' });
      await fixture.service.resetGroup({ access, requestSource: 'user', expectedGroupId: groupId, confirmTerminate: true, operationId: 'reset-stalled' });
      await vi.waitFor(() => expect(fixture.service.runtimeStatus().blocked).toBe(true));
      expect(fixture.store.activeGroup('t1')?.groupId).toBe(groupId);
      expect(fixture.store.getAgent(groupId, childId)).toMatchObject({ executionActive: true, cleanupPending: true });
      expect(fixture.store.getOperation(groupId, 'reset-stalled')?.result.phase).toBe('cleanup_pending');
      expect(fixture.store.listGroups('t1').items).toHaveLength(1);
    } finally { release.resolve('late'); await vi.waitFor(() => expect(fixture.coordinator.snapshot().active).toBe(0)); }
  });

  it('A15 Given the applied transaction fails, When spawn is attempted, Then factory is never entered, the group freezes and its unused lease is released', async () => {
    const factory = vi.fn(async () => ({ run: async () => 'done', dispose: async () => {} }));
    let rejected: unknown;
    const fixture = await setup(factory, async context => {
      const original = fixture.store.putOperation.bind(fixture.store);
      const fault = vi.spyOn(fixture.store, 'putOperation').mockImplementation((operation, control) => {
        if (operation.applyState === 'applied' && operation.command === 'spawn') throw new Error('SQLITE_FULL');
        return original(operation, control);
      });
      try { await fixture.service.spawn({ actor: context.actor, requestSource: 'agent', operationId: 'spawn-fail', taskName: 'bad', message: 'work' }); }
      catch (error) { rejected = error; }
      fault.mockRestore();
    });
    await fixture.start(); await fixture.host.drain();
    expect(String(rejected)).toMatch(/SQLITE_FULL|persistence/);
    expect(factory).not.toHaveBeenCalled();
    expect(fixture.coordinator.snapshot().active).toBe(0);
    expect(fixture.store.activeGroup('t1')?.mutationBlockedReason).toBeTruthy();
  });

  it('A12 Given many public deltas and repeated usage IDs, When the real turn seals, Then output is coalesced and flushed before terminal status with usage counted once', async () => {
    let groupId = ''; let rootId = '';
    const fixture = await setup(vi.fn(), async context => {
      groupId = context.groupId; rootId = context.agentId;
      for (let index = 0; index < 20; index++) await fixture.service.recordRuntimeEvent(context, {
        type: 'assistant_delta', sessionId: 'session', turnId: context.turnId, intentId: 'intent', stepId: 'step', delta: `delta-${index};`,
      });
      await fixture.service.recordUsage(context, { usageId: 'usage-1', inputTokens: 10, outputTokens: 2 });
      await fixture.service.recordUsage(context, { usageId: 'usage-1', inputTokens: 10, outputTokens: 2 });
    });
    await fixture.start(); await fixture.host.drain();
    const events = fixture.store.readEvents(groupId); const output = events.filter(event => event.kind === 'output');
    expect(output).toHaveLength(1); expect(output[0].payload.text).toBe(Array.from({ length: 20 }, (_, index) => `delta-${index};`).join(''));
    const terminal = events.find(event => event.kind === 'status' && (event.payload.agent as { status?: string })?.status === 'completed')!;
    expect(output[0].seq).toBeLessThan(terminal.seq);
    expect(events.filter(event => event.kind === 'usage')).toHaveLength(1);
    expect(declaredMainGroupsRows(fixture.store,'events').find(row=>row.body.kind==='usage')?.unmapped).toEqual([]);
    expect(fixture.store.getAgent(groupId, rootId)).toMatchObject({ usage: { inputTokens: 10, outputTokens: 2 } });
  });

  it('A12/U5 Given rapid phase changes, When activity is projected, Then it emits at most once per second, checkpoints after five seconds and never allocates durable sequence for activity', async () => {
    const envelopes: Array<{ channel: string; activityRevision?: number; phase?: string }> = [];
    const fixture = await setup(vi.fn(), async context => {
      const before = fixture.store.requireGroup(context.groupId).lastSeq;
      const instant = Date.now(); const clock = vi.spyOn(Date, 'now').mockReturnValue(instant);
      try {
        for (let index = 0; index < 20; index++) await fixture.service.recordActivity(context, { phase: index % 2 ? 'thinking' : 'model' });
        expect(envelopes.filter(event => event.channel === 'activity')).toHaveLength(1);
        clock.mockReturnValue(instant + 1001);
        await fixture.service.recordActivity(context, { phase: 'tool', toolName: 'read' });
        expect(envelopes.filter(event => event.channel === 'activity')).toHaveLength(2);
        clock.mockReturnValue(instant + 5001);
        await fixture.service.recordActivity(context, { phase: 'thinking' });
        expect(fixture.store.getAgent(context.groupId, context.agentId)).toMatchObject({ phase: 'thinking', lastActivityAt: instant + 5001 });
        expect(fixture.store.requireGroup(context.groupId).lastSeq).toBe(before);
      } finally { clock.mockRestore(); }
    });
    const access = fixture.service.createUserAccess({ requestSource: 'user', actorId: 'user', threadId: 't1', profileId: 'p1', workspaceId: 'w1' });
    const unsubscribe = fixture.service.subscribe(access, envelope => envelopes.push(envelope));
    await fixture.start(); await fixture.host.drain(); unsubscribe();
    const revisions = envelopes.filter(event => event.channel === 'activity').map(event => event.activityRevision!);
    expect(revisions).toEqual([...new Set(revisions)].sort((a, b) => a - b));
  });

  it('A12 Given public output persistence fails at seal, When a turn ends, Then it cannot publish success after losing its output', async () => {
    let groupId = ''; let failed: unknown;
    const fixture = await setup(vi.fn(), async context => {
      groupId = context.groupId;
      await fixture.service.recordRuntimeEvent(context, { type: 'assistant_delta', sessionId: 'session', turnId: context.turnId, intentId: 'i', stepId: 's', delta: 'must persist' });
      const original = fixture.store.appendEvent.bind(fixture.store);
      const fault = vi.spyOn(fixture.store, 'appendEvent').mockImplementation((group, event) => {
        if (event.kind === 'output') throw new Error('SQLITE_FULL'); return original(group, event);
      });
      try { await context.mailbox.trySealTurn(); } catch (error) { failed = error; } finally { fault.mockRestore(); }
    });
    await fixture.start(); await fixture.host.drain();
    expect(failed).toBeTruthy(); expect(fixture.store.requireGroup(groupId).mutationBlockedReason).toBeTruthy();
    expect(fixture.store.getAgent(groupId, `root_${groupId}`)?.status).not.toBe('completed');
  });

  it('A11 Given an existing canonical task name, When another spawn is rejected, Then it does not freeze or abort the healthy group', async () => {
    const release = deferred<string>(); const entered = deferred<void>();
    const fixture = await setup(async () => ({ run: async () => { entered.resolve(); return release.promise; }, suspend: async () => {}, dispose: async () => {} }), async context => {
      try {
        await fixture.service.spawn({ actor: context.actor, requestSource: 'agent', operationId: 'original', taskName: 'same', message: 'first' });
        await entered.promise;
        await expect(fixture.service.spawn({ actor: context.actor, requestSource: 'agent', operationId: 'duplicate-name', taskName: 'same', message: 'second' })).rejects.toThrow();
        expect(context.signal.aborted).toBe(false);
        expect(fixture.store.requireGroup(context.groupId).mutationBlockedReason).toBeNull();
        expect(context.memberTicket.refCount).toBe(2);
      } finally { release.resolve('done'); }
    });
    await fixture.start(); await fixture.host.drain();
  });

  it('A34 Given queued followups behind a live child, When interrupted, Then old future work is cancelled and its operation is durably terminal', async () => {
    const entered = deferred<void>(); const release = deferred<string>(); const calls: string[] = [];
    const fixture = await setup(async () => ({ run: async message => { calls.push(message); entered.resolve(); return release.promise; }, suspend: async () => {}, dispose: async () => {} }), async context => {
      const input = { actor: context.actor, requestSource: 'agent' as const };
      const child = await fixture.service.spawn({ ...input, operationId: 'spawn', taskName: 'child', message: 'first' });
      try {
        await entered.promise;
        await fixture.service.followup({ ...input, target: child.targetAgentId!, operationId: 'future', message: 'must not run' });
        await fixture.service.interrupt({ ...input, target: child.targetAgentId!, operationId: 'stop' });
        expect(fixture.store.getOperation(context.groupId, 'future')?.result).toMatchObject({ state: 'completed', outcome: 'cancelled' });
      } finally { release.resolve('late'); }
    });
    await fixture.start(); await fixture.host.drain();
    await vi.waitFor(() => expect(fixture.coordinator.snapshot().active).toBe(0));
    expect(calls).toEqual(['first']);
  });

  it('A14 Given an old interrupt operation was applied, When replayed during a newer child turn, Then the cached acknowledgement cannot interrupt that new execution', async () => {
    const entered = deferred<void>(); const first = deferred<string>(); const second = deferred<string>(); const secondEntered = deferred<void>();
    let call = 0; let currentSignal: AbortSignal | undefined;
    const fixture = await setup(async () => ({ run: async (_message, signal) => {
      currentSignal = signal; if (++call === 1) { entered.resolve(); return first.promise; }
      secondEntered.resolve(); return second.promise;
    }, suspend: async () => {}, dispose: async () => {} }), async context => {
      const input = { actor: context.actor, requestSource: 'agent' as const };
      const child = await fixture.service.spawn({ ...input, operationId: 'spawn', taskName: 'child', message: 'first' });
      const stop = { ...input, target: child.targetAgentId!, operationId: 'interrupt-once' };
      try {
        await entered.promise; await fixture.service.interrupt(stop); first.resolve('stopped');
        await vi.waitFor(() => expect(fixture.store.getAgent(context.groupId, child.targetAgentId!)?.executionActive).toBe(false));
        await fixture.service.followup({ ...input, target: child.targetAgentId!, operationId: 'next', message: 'second' });
        await secondEntered.promise;
        await fixture.service.interrupt(stop);
        expect(currentSignal?.aborted).toBe(false);
      } finally { first.resolve('done'); second.resolve('done'); }
      // Results are independently consumed by the root model boundary.
      await vi.waitFor(() => expect(fixture.store.getAgent(context.groupId, child.targetAgentId!)?.executionActive).toBe(false));
      const batch = await context.mailbox.drainInput(); if (batch.claimId) await context.mailbox.confirmApplied(batch.claimId);
    });
    await fixture.start(); await fixture.host.drain(); expect(call).toBe(2);
  });

  it.each(['interrupt', 'close'] as const)('A15/A34 Given queued followup audit writes fail, When agent %s is authorized, Then physical abort still happens and acknowledgement is unknown', async command => {
    const entered = deferred<void>(); const release = deferred<string>(); let childSignal: AbortSignal | undefined;
    const fixture = await setup(async () => ({ run: async (_message, signal) => { childSignal = signal; entered.resolve(); return release.promise; }, dispose: async () => {} }), async context => {
      const auth = { actor: context.actor, requestSource: 'agent' as const };
      const child = await fixture.service.spawn({ ...auth, operationId: 'spawn-audit', taskName: 'audit', message: 'work' });
      await entered.promise;
      await fixture.service.followup({ ...auth, operationId: 'queued-audit', target: child.targetAgentId!, message: 'never run' });
      const original = fixture.store.putOperation.bind(fixture.store);
      const fault = vi.spyOn(fixture.store, 'putOperation').mockImplementation((operation, control) => {
        if (operation.operationId === 'queued-audit' && operation.result.outcome === 'cancelled') throw new Error('SQLITE_FULL');
        return original(operation, control);
      });
      try {
        let ack: unknown;
        try { ack = await fixture.service[command]({ ...auth, operationId: 'stop-audit', target: child.targetAgentId! }); } catch { /* Inspect physical outcome before the ACK. */ }
        expect(childSignal?.aborted).toBe(true);
        expect(ack).toMatchObject({ state: 'unknown' });
        expect(fixture.store.requireGroup(context.groupId).mutationBlockedReason).toBeTruthy();
      } finally { fault.mockRestore(); release.resolve('late'); }
    });
    await fixture.start(); await fixture.host.drain();
  });

  it('LIFE-D1 Given root and child execution explicitly waiting for approval, When 31 minutes elapse, Then total duration does not expire lease or approval actors', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const entered = deferred<void>(), releaseChild = deferred<string>(), releaseRoot = deferred<void>();
    let root!: DesktopAgentExecutionContext, child!: DesktopAgentExecutionContext;
    const fixture = await setup(async input => ({ run: async () => {
      child = input.getTurnContext(); entered.resolve(); return releaseChild.promise;
    }, suspend: async () => {}, dispose: async () => {} }), async (context,input) => {
      root = context;
      await input.emitRuntimeEvent({type:'approval_required',sessionId:input.sessionId,turnId:'long-turn',approvalId:'long-user-approval'});
      await fixture.service.spawn({ actor: context.actor, requestSource: 'agent', operationId: 'long-spawn', taskName: 'long_child', message: 'work' });
      await releaseRoot.promise;
    });
    const transport = new DesktopMultiAgentApprovalTransport({ store: fixture.store, service: fixture.service });
    const owner = fixture.service.bindApprovalTransport(transport);
    try {
      const taskId = await fixture.start(); await entered.promise;
      await vi.advanceTimersByTimeAsync(31 * 60_000);
      expect(root.memberTicket.deadlineAt).toBeUndefined();
      expect(root.effectiveDeadline).toBe(Infinity); expect(child.effectiveDeadline).toBe(Infinity);
      await fixture.service.expireLease({ requestSource: 'scheduler', groupId: root.groupId, leaseEpoch: root.memberTicket.epoch });
      for (const context of [root, child]) {
        expect(fixture.service.getApprovalDeadline(context.actor)).toBe(Infinity);
        fixture.service.expireApprovalActor(owner, context);
        fixture.service.assertInvocation(context.actor, context);
        expect(context.signal.aborted).toBe(false);
        expect(fixture.store.getAgent(context.groupId, context.agentId)).toMatchObject({ status: 'running', executionActive: true });
      }
      expect((await fixture.host.inspectTask(taskId))?.status).toBe('running');
      expect(fixture.coordinator.snapshot()).toMatchObject({ active: 1, waiting: 0 });
    } finally {
      releaseChild.resolve('done'); releaseRoot.resolve(); await fixture.host.drain();
      await transport.dispose(); vi.useRealTimers();
    }
  });

  it('A6/A33 Given an explicitly configured core watchdog wins before the child exception seals, When the late interruption is sealed, Then the durable failed outcome is not overwritten', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const entered = deferred<void>(); const late = deferred<string>(); const rootRelease = deferred<void>();
    let childContext: DesktopAgentExecutionContext; let observed: string | undefined;
    const fixture = await setup(async input => ({ run: async () => { childContext = input.getTurnContext(); entered.resolve(); return late.promise; }, dispose: async () => {} }), async context => {
      await fixture.service.spawn({ actor: context.actor, requestSource: 'agent', operationId: 'timeout-seal', taskName: 'timeout', message: 'work' });
      await rootRelease.promise;
    }, { coreIdleTimeoutMs: 5 * 60_000 });
    try {
      await fixture.start(); await entered.promise;
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      expect(fixture.store.getAgent(childContext!.groupId, childContext!.agentId)?.status).toBe('failed');
      await childContext!.mailbox.trySealTurn({ outcome: 'interrupted' });
      observed = fixture.store.getAgent(childContext!.groupId, childContext!.agentId)?.status;
    } finally { late.resolve('late'); rootRelease.resolve(); await fixture.host.drain(); vi.useRealTimers(); }
    expect(observed).toBe('failed');
  });

  it('A33 Given a sealed root with a live child, When its lease deadline expires, Then the child stops without cancelling the completed host or releasing unsettled work', async () => {
    const entered = deferred<void>(); const release = deferred<string>(); let context!: DesktopAgentExecutionContext; let signal!: AbortSignal;
    const fixture = await setup(async () => ({ run: async (_message, turnSignal) => { signal = turnSignal!; entered.resolve(); return release.promise; }, dispose: async () => {} }), async current => {
      context = current;
      await fixture.service.spawn({ actor: current.actor, requestSource: 'agent', operationId: 'lease-child', taskName: 'child', message: 'work' });
      await entered.promise;
    }, { multiAgentLeaseMs: 30 * 60_000 });
    try {
      const taskId = await fixture.start(); await fixture.host.drain();
      const clock = vi.spyOn(Date, 'now').mockReturnValue(context.memberTicket.deadlineAt! + 1);
      try { await fixture.service.expireLease({ requestSource: 'scheduler', groupId: context.groupId, leaseEpoch: context.memberTicket.epoch }); } finally { clock.mockRestore(); }
      expect(signal.aborted).toBe(true);
      expect((await fixture.host.inspectTask(taskId))?.status).toBe('completed');
      expect(fixture.store.getAgent(context.groupId, context.agentId)?.status).toBe('completed');
      expect(fixture.coordinator.snapshot().active).toBe(1);
    } finally { release.resolve('late'); }
  });

  it('A33 preserves the original host cancellation cause after the stalled-root grace blocks its group', async () => {
    const entered = deferred<void>(), release = deferred<void>(); let context!: DesktopAgentExecutionContext;
    const fixture = await setup(vi.fn(), async current => { context = current; entered.resolve(); await release.promise; });
    try {
      const taskId = await fixture.start(); await entered.promise;
      await fixture.host.cancelTask(taskId, 'original_host_cancel');
      await new Promise(resolve => setTimeout(resolve, 30));
      // Deliberately do not observe the composite until both sources aborted.
      expect(context.signal.reason.message).toBe('original_host_cancel');
      expect(context.signal.aborted).toBe(true);
    } finally { release.resolve(); await fixture.host.drain(); }
  });

  it('A33 Given an active root, When a stale or early lease expiry is followed by a real expiry, Then only the real deadline wins and cancels its host execution', async () => {
    const entered = deferred<void>(); const release = deferred<void>(); let context!: DesktopAgentExecutionContext;
    const fixture = await setup(vi.fn(), async current => { context = current; entered.resolve(); await release.promise; }, { multiAgentLeaseMs: 30 * 60_000 });
    try {
      const taskId = await fixture.start(); await entered.promise;
      await fixture.service.expireLease({ requestSource: 'scheduler', groupId: context.groupId, leaseEpoch: context.memberTicket.epoch - 1 });
      await fixture.service.expireLease({ requestSource: 'scheduler', groupId: context.groupId, leaseEpoch: context.memberTicket.epoch });
      expect(context.signal.aborted).toBe(false);
      const clock = vi.spyOn(Date, 'now').mockReturnValue(context.memberTicket.deadlineAt! + 1);
      try { await fixture.service.expireLease({ requestSource: 'scheduler', groupId: context.groupId, leaseEpoch: context.memberTicket.epoch }); } finally { clock.mockRestore(); }
      expect(context.signal.aborted).toBe(true);
      expect((await fixture.host.inspectTask(taskId))?.status).toBe('cancelled');
      expect(context.signal.reason.message).toBe('multi_agent_lease_expired');
      await context.mailbox.trySealTurn();
      expect(fixture.store.getAgent(context.groupId, context.agentId)?.status).toBe('interrupted');
    } finally { release.resolve(); await fixture.host.drain(); }
  });

  it('A18/A42 Given host preparation persisted but queued journal write fails, When root admission aborts, Then the host checkpoint is compensated immediately without waiting for restart', async () => {
    const fixture = await setup(vi.fn(), async () => {});
    const original = fixture.store.putRootBinding.bind(fixture.store); let taskId = '';
    const fault = vi.spyOn(fixture.store, 'putRootBinding').mockImplementation((binding, control) => {
      taskId = binding.sourceTaskId;
      if (binding.phase === 'queued') throw new Error('SQLITE_FULL');
      return original(binding, control);
    });
    try { await expect(fixture.service.prepareRoot(fixture.host, 't1', { prompt: 'fail queue', materials: [] })).rejects.toThrow('SQLITE_FULL'); } finally { fault.mockRestore(); }
    expect((await fixture.host.inspectTask(taskId))?.status).toBe('failed');
    expect(await fixture.host.getActiveTasks()).toEqual([]);
    expect(fixture.coordinator.snapshot().active).toBe(0);
  });

  it('A29 Given a live peer sends a message, When wait observes it, Then it returns notification IDs without consuming the mailbox', async () => {
    const childReady = deferred<void>(); const release = deferred<string>();
    const fixture = await setup(async input => ({ run: async () => {
      await fixture.service.send({ actor: input.getTurnContext().actor, requestSource: 'agent', operationId: 'progress', target: 'parent', message: 'progress sentinel' });
      childReady.resolve(); return release.promise;
    }, suspend: async () => {}, dispose: async () => {} }), async context => {
      const child = await fixture.service.spawn({ actor: context.actor, requestSource: 'agent', operationId: 'spawn', taskName: 'child', message: 'work' });
      try {
        await childReady.promise;
        const result = await fixture.service.wait({ actor: context.actor, requestSource: 'agent', targets: [child.targetAgentId!], timeoutMs: 10 });
        expect(result).toMatchObject({ reason: 'message', settled: false });
        expect(result.messageIds).toHaveLength(1);
        expect(fixture.store.listMessages(context.groupId, context.agentId)[0].deliveryState).toBe('unread');
        const batch = await context.mailbox.drainInput(); await context.mailbox.confirmApplied(batch.claimId!);
      } finally { release.resolve('done'); }
    });
    await fixture.start(); await fixture.host.drain();
  });

  it('A12/A43 Given a child with a live execution, When closed through the service, Then descendants stop, resources stay pending, and root controls are denied', async () => {
    const entered = deferred<void>(); const release = deferred<string>(); let agentId = ''; let groupId = '';
    const fixture = await setup(async () => ({ run: async () => { entered.resolve(); return release.promise; }, dispose: async () => {} }), async context => {
      groupId = context.groupId;
      const input = { actor: context.actor, requestSource: 'agent' as const };
      await expect(fixture.service.close({ ...input, operationId: 'deny-root', target: 'main' })).rejects.toThrow(/root|permitted/);
      const child = await fixture.service.spawn({ ...input, operationId: 'spawn', taskName: 'child', message: 'work' }); agentId = child.targetAgentId!;
      try {
        await entered.promise;
        const result = await fixture.service.close({ ...input, operationId: 'close', target: agentId });
        expect(result).toMatchObject({ state: 'cleanup_pending', cleanupPending: true, resourcesReleased: false });
        const listed = fixture.service.list({ ...input });
        expect(listed.items.find(agent => agent.id === agentId)).toMatchObject({ status: 'closed', executionActive: true, cleanupPending: true });
      } finally { release.resolve('late'); }
    });
    await fixture.start(); await fixture.host.drain();
    await vi.waitFor(() => expect(fixture.store.getAgent(groupId, agentId)).toMatchObject({ status: 'closed', executionActive: false, resourcesReleased: true }));
  });

  it('A37/A43 Given a child authority, When it sends to main but tries to control main or forge its actor, Then only the message succeeds', async () => {
    const childDone = deferred<void>(); let rootContext!: DesktopAgentExecutionContext;
    const fixture = await setup(async input => ({
      async run() {
        try {
        const context = input.getTurnContext();
        await fixture.service.send({ actor: context.actor, requestSource: 'agent', operationId: 'message-parent', target: 'main', message: 'child sentinel' });
        await expect(fixture.service.interrupt({ actor: context.actor, requestSource: 'agent', operationId: 'deny-parent', target: 'main' })).rejects.toThrow(/root|permitted/);
        await expect(fixture.service.send({ actor: { ...rootContext.actor }, requestSource: 'agent', operationId: 'forged', target: 'main', message: 'forged' })).rejects.toThrow(/authority|actor/);
        return 'done';
        } finally { childDone.resolve(); }
      }, async suspend() {}, async dispose() {},
    }), async context => {
      rootContext = context;
      await fixture.service.spawn({ actor: context.actor, requestSource: 'agent', operationId: 'spawn-child', taskName: 'child', message: 'work' });
      await childDone.promise;
      const batch = await context.mailbox.drainInput();
      expect(batch.messages.some(message => message.preview === 'child sentinel')).toBe(true);
      await context.mailbox.confirmApplied(batch.claimId!);
    });
    await fixture.start(); await fixture.host.drain();
  });

  it('A34 Given a child ignores abort, When interrupted and waited on, Then stopping is reported without claiming settlement or freeing its lease', async () => {
    const entered = deferred<void>(); const release = deferred<string>(); let waited: unknown;
    const fixture = await setup(async () => ({ async run() { entered.resolve(); return release.promise; }, async dispose() {} }), async context => {
      const child = await fixture.service.spawn({ actor: context.actor, requestSource: 'agent', operationId: 'spawn-stuck', taskName: 'stuck', message: 'work' });
      await entered.promise;
      await fixture.service.interrupt({ actor: context.actor, requestSource: 'agent', operationId: 'interrupt-stuck', target: child.targetAgentId! });
      waited = await fixture.service.wait({ actor: context.actor, requestSource: 'agent', targets: [child.targetAgentId!], timeoutMs: 5 });
      expect(context.memberTicket.refCount).toBe(2);
      release.resolve('late');
    });
    await fixture.start(); await fixture.host.drain();
    expect(waited).toMatchObject({ reason: 'stopping', settled: false });
  });

  it('A6/A16 Given an explicitly idle-limited child never settles, When its real core watchdog and cleanup grace expire, Then the whole runtime blocks rather than running forever behind a failed status', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const entered = deferred<void>(); const childRelease = deferred<string>(); const rootRelease = deferred<void>();
    let groupId = ''; let childId = '';
    const fixture = await setup(async () => ({ run: async () => { entered.resolve(); return childRelease.promise; }, dispose: async () => {} }), async context => {
      groupId = context.groupId;
      const child = await fixture.service.spawn({ actor: context.actor, requestSource: 'agent', operationId: 'spawn-timeout', taskName: 'timeout', message: 'work' });
      childId = child.targetAgentId!; await rootRelease.promise;
    }, { coreIdleTimeoutMs: 5 * 60_000 });
    try {
      await fixture.start(); await entered.promise;
      await vi.advanceTimersByTimeAsync(5 * 60_000 + 20);
      expect(fixture.store.getAgent(groupId, childId)).toMatchObject({ status: 'failed', executionActive: true, stopState: 'stalled', resourcesReleased: false });
      await expect(fixture.coordinator.run(undefined, async () => {})).rejects.toThrow('runtime_blocked');
    } finally { childRelease.resolve('late'); rootRelease.resolve(); await fixture.host.drain(); vi.useRealTimers(); }
  });

  it('A16/A33 Given the root provider ignores user cancellation, When the cleanup grace expires, Then root execution retains its ticket and blocks all future work', async () => {
    const entered = deferred<void>(); const release = deferred<void>(); let groupId = ''; let rootId = '';
    const fixture = await setup(vi.fn(), async context => { groupId = context.groupId; rootId = context.agentId; entered.resolve(); await release.promise; });
    try {
      const taskId = await fixture.start(); await entered.promise; await fixture.host.cancelTask(taskId);
      await vi.waitFor(() => expect(fixture.store.getAgent(groupId, rootId)).toMatchObject({ stopState: 'stalled', executionActive: true }));
      expect(fixture.coordinator.snapshot().active).toBe(1);
      await expect(fixture.coordinator.run(undefined, async () => {})).rejects.toThrow('runtime_blocked');
    } finally { release.resolve(); await fixture.host.drain(); }
  });

  it('A33 Given cancel and pure-text seal enter the same sequencer in that order, When both settle, Then seal cannot overwrite the cancelled root with completed', async () => {
    let groupId = ''; let rootId = '';
    const fixture = await setup(vi.fn(), async context => {
      groupId = context.groupId; rootId = context.agentId;
      const cancelling = fixture.service.cancelRootTurn({ requestSource: 'scheduler', sourceTaskId: context.sourceTaskId!, expectedRootEpoch: context.rootEpoch, reason: 'user_cancelled' });
      const sealing = context.mailbox.trySealTurn();
      await Promise.all([cancelling, sealing]);
      expect(fixture.store.getAgent(groupId, rootId)?.status).toBe('interrupted');
    });
    await fixture.start(); await fixture.host.drain();
    expect(fixture.store.getAgent(groupId, rootId)?.status).toBe('interrupted');
  });

  it('A18/A33 Given a root waits in global FIFO without starting, When preparation is cancelled, Then pending identity is visible and the next root does not inherit a busy preparation', async () => {
    const fixture = await setup(vi.fn(), async () => {});
    const release = deferred<void>(); const entered = deferred<void>();
    const ordinary = fixture.coordinator.run(undefined, async () => { entered.resolve(); await release.promise; });
    await entered.promise;
    try {
      const first = await fixture.service.prepareRoot(fixture.host, 't1', { prompt: 'first', materials: [] });
      const group = fixture.store.activeGroup('t1')!;
      expect(fixture.store.getAgent(group.groupId, `root_${group.groupId}`)).toMatchObject({ status: 'pending', turn: 1, sourceTaskId: first.taskId, executionActive: false });
      await fixture.host.cancelTask(first.taskId);
      expect(fixture.store.getAgent(group.groupId, `root_${group.groupId}`)).toMatchObject({ status: 'interrupted', turn: 1, resourcesReleased: true });
      const second = await fixture.service.prepareRoot(fixture.host, 't1', { prompt: 'second', materials: [] });
      expect(second.taskId).not.toBe(first.taskId);
      await fixture.host.cancelTask(second.taskId);
      expect(fixture.coordinator.snapshot().waiting).toBe(0);
    } finally { release.resolve(); await ordinary; }
  });

  it('A16 Given a settled root with a running child, When ordinary work queues, Then it waits until the last real execution member settles', async () => {
    const entered = deferred<void>(); const release = deferred<string>();
    const fixture = await setup(async () => ({ async run() { entered.resolve(); return release.promise; }, async suspend() {}, async dispose() {} }), async context => {
      await fixture.service.spawn({ actor: context.actor, requestSource: 'agent', operationId: 'spawn-long', taskName: 'long', message: 'work' });
      await entered.promise;
    });
    await fixture.start(); await fixture.host.drain();
    const ordinary = vi.fn(async () => {});
    const queued = fixture.coordinator.run(undefined, ordinary);
    await Promise.resolve(); expect(ordinary).not.toHaveBeenCalled();
    release.resolve('done');
    await queued;
    expect(ordinary).toHaveBeenCalledOnce();
  });

  it('A2 Given eight suspended child sessions, When another spawn requests capacity, Then reclamation starts without awaiting dispose and the slot stays reserved until actual release', async () => {
    const releaseCleanup = deferred<void>(); let disposing = 0;
    const fixture = await setup(async () => ({ run: async () => 'done', suspend: async () => {}, dispose: async () => { disposing++; await releaseCleanup.promise; } }), async context => {
      const actor = { actor: context.actor, requestSource: 'agent' as const };
      try {
        for (let index = 0; index < 8; index++) {
          const child = await fixture.service.spawn({ ...actor, operationId: `spawn-${index}`, taskName: `child_${index}`, message: 'work' });
          await vi.waitFor(() => expect(fixture.store.getAgent(context.groupId, child.targetAgentId!)?.executionActive).toBe(false));
        }
        await expect(fixture.service.spawn({ ...actor, operationId: 'capacity-full', taskName: 'ninth', message: 'work' })).rejects.toThrow('capacity_reclaiming');
        await vi.waitFor(() => expect(disposing).toBe(1));
        expect(fixture.service.runtimeStatus().residentSlots).toBe(8);
      } finally { releaseCleanup.resolve(); }
      await vi.waitFor(() => expect(fixture.service.runtimeStatus().residentSlots).toBe(7));
      const ninth = await fixture.service.spawn({ ...actor, operationId: 'retry-capacity', taskName: 'ninth', message: 'work' });
      await vi.waitFor(() => expect(fixture.store.getAgent(context.groupId, ninth.targetAgentId!)?.executionActive).toBe(false));
      const batch = await context.mailbox.drainInput(); if (batch.claimId) await context.mailbox.confirmApplied(batch.claimId);
    });
    await fixture.start(); await fixture.host.drain();
  });

  it('A20 Given many fully settled groups, When runtime objects become dormant, Then only bounded metadata remains and returning to a group rebuilds its core without changing historical results', async () => {
    const nativeEntryStart=nativeWorker.originalEntries.length;
    const fixture = await setup(vi.fn(), async () => {});
    const first = await fixture.start(); await fixture.host.drain();
    const firstGroup = fixture.store.activeGroup('t1')!;
    for (let index = 0; index < 10; index++) {
      const threadId = `thread-${index}`;
      fixture.service.registerThread({ threadId, profileId: 'p1', workspaceId: 'w1', cwd: fixture.root });
      const prepared = await fixture.service.prepareRoot(fixture.host, threadId, { prompt: 'work', materials: [] });
      await fixture.host.startTask(prepared.taskId); await fixture.host.drain();
    }
    expect(fixture.service.runtimeStatus()).toMatchObject({ liveGroups: 0, residentSlots: 0, dormantGroups: 8 });
    expect(fixture.store.getAgent(firstGroup.groupId, `root_${firstGroup.groupId}`)?.status).toBe('completed');
    const again = await fixture.start(); await fixture.host.drain();
    expect(again).not.toBe(first); expect(fixture.store.activeGroup('t1')?.groupId).toBe(firstGroup.groupId);
    expect(fixture.store.getAgent(firstGroup.groupId, `root_${firstGroup.groupId}`)?.turn).toBe(2);
    const originalWorkers=nativeWorker.originalEntries.slice(nativeEntryStart);
    expect(originalWorkers.filter(worker=>worker.protection).length).toBeGreaterThan(0);
    expect(originalWorkers.filter(worker=>!worker.protection).length).toBeGreaterThan(0);
    expect(originalWorkers.every(worker=>worker.exit!==undefined&&worker.exitCode===0&&worker.terminateCalls===0)).toBe(true);
  });

  it('A8/A28 Given an idle child and no active root, When the authenticated user follows up behind ordinary X, Then it uses FIFO and a new epoch without requiring a live root actor', async () => {
    const order: string[] = []; const epochs: number[] = []; let groupId = ''; let childId = '';
    const fixture = await setup(async input => ({ run: async message => { order.push(message); epochs.push(input.getTurnContext().memberTicket.epoch); return 'done'; }, suspend: async () => {}, dispose: async () => {} }), async context => {
      groupId = context.groupId;
      const child = await fixture.service.spawn({ actor: context.actor, requestSource: 'agent', operationId: 'spawn', taskName: 'child', message: 'first' }); childId = child.targetAgentId!;
      await vi.waitFor(() => expect(fixture.store.getAgent(groupId, childId)?.executionActive).toBe(false));
      const claim = await context.mailbox.drainInput(); if (claim.claimId) await context.mailbox.confirmApplied(claim.claimId);
    });
    await fixture.start(); await fixture.host.drain();
    const access = fixture.service.createUserAccess({ requestSource: 'user', actorId: 'real-user', threadId: 't1', profileId: 'p1', workspaceId: 'w1' });
    const release = deferred<void>(); const entered = deferred<void>();
    const x = fixture.coordinator.run(undefined, async () => { order.push('X'); entered.resolve(); await release.promise; });
    await entered.promise;
    try {
      const acknowledgement = await fixture.service.userFollowup({ access, requestSource: 'user', groupId, agentId: childId, operationId: 'user-next', expectedTurn: 1, message: 'second' });
      expect(acknowledgement).toMatchObject({ state: 'queued_next_admission', expectedTurn: 2 });
      const y = fixture.coordinator.run(undefined, async () => { order.push('Y'); });
      release.resolve(); await x; await y;
      expect(order).toEqual(['first', 'X', 'second', 'Y']); expect(epochs[1]).toBeGreaterThan(epochs[0]);
    } finally { release.resolve(); await x; }
  });

  it('A8/A17/A37 Given main-issued user access, When source or expected turn is forged or root is targeted by lifecycle controls, Then no physical control is allowed and user messages keep their actual sender', async () => {
    let groupId = ''; let rootId = '';
    const fixture = await setup(vi.fn(), async context => { groupId = context.groupId; rootId = context.agentId; });
    await fixture.start(); await fixture.host.drain();
    const access = fixture.service.createUserAccess({ requestSource: 'user', actorId: 'actual-user', threadId: 't1', profileId: 'p1', workspaceId: 'w1' });
    const request = { access, requestSource: 'user' as const, groupId, agentId: rootId, operationId: 'root-control', expectedTurn: 1 };
    for (const expectedTurn of [1, 99]) {
      for (const action of [() => fixture.service.userFollowup({ ...request, expectedTurn, message: 'forbidden' }), () => fixture.service.userInterrupt({ ...request, expectedTurn }), () => fixture.service.userClose({ ...request, expectedTurn })]) await expect(action()).rejects.toThrow(/root|permitted/);
      expect(fixture.store.getOperation(groupId, request.operationId)).toBeNull();
    }
    await expect(fixture.service.userSend({ ...request, requestSource: 'agent', message: 'forged' })).rejects.toThrow(/source|permitted/);
    const stale = await fixture.service.userSend({ ...request, expectedTurn: 99, message: 'stale' });
    expect(stale).toMatchObject({ state: 'completed', outcome: 'rejected', error: 'stale_expected_turn' });
    expect(fixture.service.readOperation({ access, groupId, operationId: request.operationId })?.result).toEqual(stale);
    expect(fixture.store.listMessages(groupId, rootId)).toEqual([]);
    await fixture.service.userSend({ ...request, operationId: 'actual-message', message: 'user context' });
    expect(fixture.store.listMessages(groupId, rootId)[0].sender).toEqual({ kind: 'user', actorId: 'actual-user' });
  });

  it.each(['userSend', 'userFollowup', 'userInterrupt', 'userClose'] as const)('A15 Given an authenticated stale %s, Then main records a known refusal with no control effect and the same ID never replays it', async method => {
    let groupId = '', childId = '';
    const run = vi.fn(async () => 'done');
    const f = await setup(async () => ({ run, suspend: async () => {}, dispose: async () => {} }), async context => {
      groupId = context.groupId;
      childId = (await f.service.spawn({ actor: context.actor, requestSource: 'agent', operationId: 'spawn', taskName: 'child', message: 'first' })).targetAgentId!;
    });
    await f.start(); await f.host.drain();
    await vi.waitFor(() => expect(f.store.getAgent(groupId, childId)).toMatchObject({ executionActive: false, resumable: true }));
    const access = f.service.createUserAccess({ requestSource: 'user', actorId: 'actual-user', threadId: 't1', profileId: 'p1', workspaceId: 'w1' });
    const input = { access, requestSource: 'user' as const, groupId, agentId: childId, operationId: 'stale-control', expectedTurn: 0, message: 'keep draft' };
    const before = f.store.getAgent(groupId, childId);
    for (const requestSource of ['agent', 'scheduler', 'tool'] as const) {
      await expect(f.service[method]({ ...input, requestSource: requestSource as never })).rejects.toThrow(/source|permitted/);
      expect(f.store.getOperation(groupId, input.operationId)).toBeNull();
    }
    const [result, duplicate] = await Promise.all([f.service[method](input), f.service[method](input)]);
    expect(duplicate).toEqual(result);
    expect(result).toMatchObject({ state: 'completed', outcome: 'rejected', error: 'stale_expected_turn' });
    expect(f.service.readOperation({ access, groupId, operationId: input.operationId })).toMatchObject({ applyState: 'applied', result });
    expect(await f.service[method](input)).toEqual(result);
    expect(f.store.getAgent(groupId, childId)).toEqual(before);
    expect(f.store.listMessages(groupId, childId)).toEqual([]); expect(run).toHaveBeenCalledTimes(1);
    await expect(f.service[method]({ ...input, expectedTurn: 1 })).rejects.toThrow(/operation_id_conflict/);
    expect(await f.service.userSend({ ...input, expectedTurn: 1, operationId: 'fresh-send' })).toMatchObject({ state: 'applied' });
    expect(f.store.listMessages(groupId, childId)).toHaveLength(1);
  });

  it.each(['userSend', 'userFollowup', 'userInterrupt', 'userClose'] as const)('A15 Given an authenticated unknown target for %s, Then rejection is durable without a synthetic agent and foreign or purged groups stay denied', async method => {
    let groupId = '', rootId = '';
    const createSession = vi.fn();
    const f = await setup(createSession, async context => { groupId = context.groupId; rootId = context.agentId; });
    await f.start(); await f.host.drain();
    const access = f.service.createUserAccess({ requestSource: 'user', actorId: 'actual-user', threadId: 't1', profileId: 'p1', workspaceId: 'w1' });
    const input = { access, requestSource: 'user' as const, groupId, agentId: 'missing-child', operationId: 'missing-control', expectedTurn: 1, message: 'keep draft' };
    const before = f.store.allAgents(groupId);
    f.service.registerThread({ threadId: 'foreign-thread', profileId: 'p2', workspaceId: 'w2', cwd: f.root });
    const foreign = f.service.createUserAccess({ requestSource: 'user', actorId: 'foreign-user', threadId: 'foreign-thread', profileId: 'p2', workspaceId: 'w2' });
    await expect(f.service[method]({ ...input, access: foreign })).rejects.toThrow(/scope/);
    expect(f.store.getOperation(groupId, input.operationId)).toBeNull();
    for (const agentId of ['', 123, 'x'.repeat(129)]) {
      await expect(f.service[method]({ ...input, agentId: agentId as string })).rejects.toThrow(/invalid.*agent/i);
      expect(f.store.getOperation(groupId, input.operationId)).toBeNull();
    }
    const result = await f.service[method](input);
    expect(result).toMatchObject({ operationId: input.operationId, state: 'completed', outcome: 'rejected', error: 'unknown_target', targetAgentId: input.agentId });
    expect(f.service.readOperation({ access, groupId, operationId: input.operationId })?.result).toEqual(result);
    expect(await f.service[method](input)).toEqual(result);
    await expect(f.service[method]({ ...input, expectedTurn: 2 })).rejects.toThrow('operation_id_conflict');
    expect(f.store.allAgents(groupId)).toEqual(before); expect(f.store.listMessages(groupId, rootId)).toEqual([]);
    expect(createSession).not.toHaveBeenCalled();
    const revision = f.store.getThread('t1')!.threadRevision!;
    expect(await f.service.deleteThread({ access, requestSource: 'user', operationId: `delete:${revision}:purge`, expectedThreadRevision: revision, confirmTerminate: true }))
      .toMatchObject({ state: 'completed' });
    await expect(f.service[method]({ ...input, operationId: 'after-purge' })).rejects.toThrow();
    expect(f.store.getOperation(groupId, 'after-purge')).toBeNull();
  });

  it('A15 Given model and user followups race for the same child, Then the shared queue admits only four and the excess user command gets a durable refusal', async () => {
    const ready = deferred<void>(), rootRelease = deferred<void>(), childRelease = deferred<string>();
    let context!: DesktopAgentExecutionContext; let childId = '';
    const run = vi.fn(async () => childRelease.promise);
    const f = await setup(async () => ({ run, suspend: async () => {}, dispose: async () => {} }), async current => {
      context = current;
      childId = (await f.service.spawn({ actor: current.actor, requestSource: 'agent', operationId: 'spawn', taskName: 'child', message: 'first' })).targetAgentId!;
      await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1)); ready.resolve(); await rootRelease.promise;
    });
    try {
      await f.start(); await ready.promise;
      const groupId = context.groupId;
      const access = f.service.createUserAccess({ requestSource: 'user', actorId: 'actual-user', threadId: 't1', profileId: 'p1', workspaceId: 'w1' });
      const user = (operationId: string) => f.service.userFollowup({ access, requestSource: 'user', groupId, agentId: childId, operationId, expectedTurn: 1, message: 'user' });
      const model = (operationId: string) => f.service.followup({ actor: context.actor, requestSource: 'agent', target: childId, operationId, message: 'model' });
      const result = await Promise.all([model('model-1'), model('model-2'), user('user-1'), user('user-2'), user('user-excess')]);
      expect(result.slice(0, 4).map(item => item.state)).toEqual(Array(4).fill('queued_next_admission'));
      expect(result[4]).toMatchObject({ state: 'completed', outcome: 'rejected', error: 'multi_agent_followup_queue_full' });
      expect(f.service.readOperation({ access, groupId, operationId: 'user-excess' })?.result).toEqual(result[4]);
      await expect(model('model-excess')).rejects.toThrow('multi_agent_followup_queue_full');
      expect(f.store.getOperation(groupId, 'model-excess')).toBeNull(); expect(run).toHaveBeenCalledTimes(1);
    } finally { rootRelease.resolve(); childRelease.resolve('done'); await f.host.drain(); }
  });

  it('A15 Given a child cannot yet resume, Then its rejected operation stays rejected after real settlement and only a new explicit ID may follow up', async () => {
    const entered = deferred<void>(), release = deferred<string>(); let groupId = '', childId = '';
    const run = vi.fn(async () => { entered.resolve(); return release.promise; });
    const f = await setup(async () => ({ run, suspend: async () => {}, dispose: async () => {} }), async context => {
      groupId = context.groupId;
      childId = (await f.service.spawn({ actor: context.actor, requestSource: 'agent', operationId: 'spawn', taskName: 'child', message: 'first' })).targetAgentId!;
      await entered.promise;
    });
    try {
      await f.start(); await f.host.drain();
      const access = f.service.createUserAccess({ requestSource: 'user', actorId: 'actual-user', threadId: 't1', profileId: 'p1', workspaceId: 'w1' });
      const input = { access, requestSource: 'user' as const, groupId, agentId: childId, operationId: 'busy-control', expectedTurn: 1, message: 'second' };
      await f.service.userInterrupt({ ...input, operationId: 'interrupt-current' });
      const result = await f.service.userFollowup(input);
      expect(result).toMatchObject({ state: 'completed', outcome: 'rejected', error: 'agent_not_resumable' });
      release.resolve('done'); await vi.waitFor(() => expect(f.store.getAgent(groupId, childId)).toMatchObject({ executionActive: false, resumable: true }));
      expect(await f.service.userFollowup(input)).toEqual(result); expect(run).toHaveBeenCalledTimes(1);
      expect(await f.service.userFollowup({ ...input, operationId: 'new-followup' })).toMatchObject({ state: 'queued_next_admission' });
      await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    } finally { release.resolve('done'); }
  });

  it('A15 Given rejection receipt persistence fails, Then main freezes the group without sending the message or pretending the refusal was durably acknowledged', async () => {
    let groupId = '', rootId = '';
    const f = await setup(vi.fn(), async context => { groupId = context.groupId; rootId = context.agentId; });
    await f.start(); await f.host.drain();
    const access = f.service.createUserAccess({ requestSource: 'user', actorId: 'actual-user', threadId: 't1', profileId: 'p1', workspaceId: 'w1' });
    const put = f.store.putOperation.bind(f.store);
    const fault = vi.spyOn(f.store, 'putOperation').mockImplementation((operation, emergency) => {
      if (operation.operationId === 'rejected-write') throw new Error('rejected_receipt_write_failed');
      return put(operation, emergency);
    });
    try {
      await expect(f.service.userSend({ access, requestSource: 'user', groupId, agentId: rootId, expectedTurn: 99, operationId: 'rejected-write', message: 'never send' }))
        .rejects.toThrow('rejected_receipt_write_failed');
      expect(f.store.getOperation(groupId, 'rejected-write')).toBeNull(); expect(f.store.listMessages(groupId, rootId)).toEqual([]);
      expect(f.store.requireGroup(groupId).mutationBlockedReason).toBe('multi_agent_persistence_failed');
    } finally { fault.mockRestore(); }
  });

  it('A15 Given four queued user followups or a closed child, Then excess queue/send requests have durable refusals without hidden work', async () => {
    let groupId = '', childId = '';
    const run = vi.fn(async () => 'done');
    const f = await setup(async () => ({ run, suspend: async () => {}, dispose: async () => {} }), async context => {
      groupId = context.groupId;
      childId = (await f.service.spawn({ actor: context.actor, requestSource: 'agent', operationId: 'spawn', taskName: 'child', message: 'first' })).targetAgentId!;
    });
    await f.start(); await f.host.drain(); await vi.waitFor(() => expect(f.store.getAgent(groupId, childId)).toMatchObject({ executionActive: false, resumable: true }));
    const access = f.service.createUserAccess({ requestSource: 'user', actorId: 'actual-user', threadId: 't1', profileId: 'p1', workspaceId: 'w1' });
    const input = { access, requestSource: 'user' as const, groupId, agentId: childId, expectedTurn: 1, message: 'queued' };
    const entered = deferred<void>(), release = deferred<void>();
    const blocker = f.coordinator.run(undefined, async () => { entered.resolve(); await release.promise; }); await entered.promise;
    try {
      for (let index = 0; index < 4; index++) expect(await f.service.userFollowup({ ...input, operationId: `queue-${index}` })).toMatchObject({ state: 'queued_next_admission' });
      const excess = await f.service.userFollowup({ ...input, operationId: 'queue-full' });
      expect(excess).toMatchObject({ state: 'completed', outcome: 'rejected', error: 'multi_agent_followup_queue_full' });
      expect(await f.service.userFollowup({ ...input, operationId: 'queue-full' })).toEqual(excess); expect(run).toHaveBeenCalledTimes(1);
      const beforeGuard = f.store.getAgent(groupId, childId)!;
      f.store.putAgent(groupId, { ...beforeGuard, resumable: false });
      expect(await f.service.userFollowup({ ...input, operationId: 'not-resumable-and-full' })).toMatchObject({ outcome: 'rejected', error: 'agent_not_resumable' });
      f.store.putAgent(groupId, beforeGuard);
      await f.service.userClose({ ...input, operationId: 'close' });
      expect(await f.service.userSend({ ...input, expectedTurn: 0, operationId: 'closed-and-stale' })).toMatchObject({ outcome: 'rejected', error: 'stale_expected_turn' });
      const closed = await f.service.userSend({ ...input, operationId: 'send-closed' });
      expect(closed).toMatchObject({ state: 'completed', outcome: 'rejected', error: 'target_closed' });
      expect(f.store.listMessages(groupId, childId)).toEqual([]);
      expect(f.service.readOperation({ access, groupId, operationId: 'send-closed' })?.result).toEqual(closed);
      expect(await f.service.userFollowup({ ...input, operationId: 'followup-closed' })).toMatchObject({ state: 'completed', outcome: 'rejected', error: 'agent_not_resumable' });
      const stopped = await f.service.userInterrupt({ ...input, operationId: 'interrupt-closed' });
      expect(stopped).toMatchObject({ state: 'applied' });
      expect(await f.service.userInterrupt({ ...input, operationId: 'interrupt-closed' })).toEqual(stopped);
      const closedAgain = await f.service.userClose({ ...input, operationId: 'close-again' });
      expect(['cleanup_pending', 'completed']).toContain(closedAgain.state);
      expect(f.service.readOperation({ access, groupId, operationId: 'close-again' })).not.toBeNull();
      expect(await f.service.userFollowup({ ...input, operationId: 'queue-0' })).toMatchObject({ outcome: 'cancelled' });
    } finally { release.resolve(); await blocker; }
  });

  it('A31 Given one child never settles after abort, When its grace expires, Then all global waiters fail and the live slot is not released', async () => {
    const entered = deferred<void>(); const release = deferred<string>();
    const rootEnded = deferred<void>(); let childId = '';
    const fixture = await setup(async () => ({ async run() { entered.resolve(); return release.promise; }, async dispose() {} }), async context => {
      const child = await fixture.service.spawn({ actor: context.actor, requestSource: 'agent', operationId: 'spawn-never', taskName: 'never', message: 'work' });
      childId = child.targetAgentId!;
      await entered.promise;
      await fixture.service.interrupt({ actor: context.actor, requestSource: 'agent', operationId: 'stop-never', target: childId });
      rootEnded.resolve();
    });
    await fixture.start(); await rootEnded.promise; await fixture.host.drain();
    const action = vi.fn(async () => {});
    const queued = fixture.coordinator.run(undefined, action);
    const outcome = queued.then(() => null, error => error);
    try {
      await vi.waitFor(() => expect(fixture.coordinator.snapshot().waiting).toBe(0), { timeout: 100, interval: 5 });
      expect(String(await outcome)).toContain('runtime_blocked');
      expect(action).not.toHaveBeenCalled();
      expect(fixture.coordinator.snapshot().active).toBe(1);
      expect(fixture.store.getAgent(fixture.store.activeGroup('t1')!.groupId, childId)).toMatchObject({ stopState: 'stalled', executionActive: true, resourcesReleased: false });
    } finally { release.resolve('cleanup after assertions'); }
  });

  it.each(['before-close', 'consuming', 'after-close', 'applied', 'multiple-ancestors'] as const)('A18 Given a child handoff %s, When its receiver closes, Then unconfirmed results reach a live ancestor exactly once', async order => {
    const rootGate = deferred<void>(), parentGate = deferred<void>(), leafGate = deferred<void>(), entered = deferred<void>(), leafEntered = deferred<void>();
    let groupId = '', rootId = '', parentId = '', leafId = '';
    const contexts = new Map<string, DesktopAgentExecutionContext>();
    const fixture = await setup(async input => ({
      async run() {
        const context = input.getTurnContext(); contexts.set(context.agentId, context);
        if (input.identity.taskName === 'leaf') { leafId = context.agentId; leafEntered.resolve(); await leafGate.promise; return 'LEAF_RESULT'; }
        if (input.identity.taskName === 'parent') parentId = context.agentId;
        await fixture.service.spawn({ actor: context.actor, requestSource: 'agent', operationId: `spawn-${context.agentId}`,
          taskName: input.identity.taskName === 'parent' && order === 'multiple-ancestors' ? 'middle' : 'leaf', message: 'work' });
        await leafEntered.promise; if (input.identity.taskName === 'parent') entered.resolve();
        await parentGate.promise; return 'PARENT_RESULT';
      }, async suspend() {}, async dispose() {},
    }), async context => {
      groupId = context.groupId; rootId = context.agentId;
      await fixture.service.spawn({ actor: context.actor, requestSource: 'agent', operationId: 'spawn-parent', taskName: 'parent', message: 'delegate' });
      await rootGate.promise;
      const batch = await context.mailbox.drainInput(); if (batch.claimId) await context.mailbox.confirmApplied(batch.claimId);
    });
    try {
      await fixture.start(); await entered.promise;
      const receiverId = fixture.store.getAgent(groupId, leafId)!.parentId!;
      let originalId: string | undefined, claimId: string | null = null;
      if (order !== 'after-close') {
        leafGate.resolve();
        await vi.waitFor(() => expect(fixture.store.listMessages(groupId, receiverId).some(message => message.preview === 'LEAF_RESULT')).toBe(true));
        originalId = fixture.store.listMessages(groupId, receiverId).find(message => message.preview === 'LEAF_RESULT')!.messageId;
        if (order === 'consuming' || order === 'applied') {
          const mailbox = contexts.get(receiverId)!.mailbox;
          claimId = (await mailbox.drainInput()).claimId;
          if (order === 'applied') await mailbox.confirmApplied(claimId!);
        }
      }
      const access = fixture.service.createUserAccess({ requestSource: 'user', actorId: 'user', threadId: 't1', profileId: 'p1', workspaceId: 'w1' });
      await fixture.service.userClose({ access, requestSource: 'user', groupId, agentId: parentId, expectedTurn: 1, operationId: 'close-parent' });
      leafGate.resolve(); parentGate.resolve();
      await vi.waitFor(() => {
        expect(fixture.store.getAgent(groupId, leafId)?.executionActive).toBe(false);
        expect(fixture.store.getAgent(groupId, parentId)?.executionActive).toBe(false);
      });
      const leafMessages = fixture.store.listMessages(groupId, rootId).filter(message => message.sender.kind === 'agent' && message.sender.agentId === leafId);
      if (order === 'applied') {
        expect(leafMessages).toHaveLength(0);
        expect(fixture.store.listMessages(groupId, receiverId).find(message => message.messageId === originalId)?.deliveryState).toBe('context_applied');
      } else {
        expect(leafMessages).toHaveLength(1);
        expect(leafMessages[0]).toMatchObject({ receiverId: rootId, deliveryState: 'unread', claimId: null, turnId: null });
        if (originalId) expect(leafMessages[0]).toMatchObject({ messageId: originalId, originalReceiverId: receiverId });
        expect(fixture.store.listMessages(groupId, receiverId).filter(message => message.messageId === originalId)).toHaveLength(0);
        if (claimId) await expect(contexts.get(receiverId)!.mailbox.confirmApplied(claimId)).rejects.toThrow(/stale|sealed/);
      }
      expect(fixture.service.goalReadiness('t1')).toBe('children_need_attention');
      rootGate.resolve(); await fixture.host.drain();
      expect(fixture.service.goalReadiness('t1')).toBe('ready');
    } finally { leafGate.resolve(); parentGate.resolve(); rootGate.resolve(); await fixture.host.drain(); }
  });

  it.each([true, false])('A17 Given a real granted followup with cancelFirst=%s, Then cancellation and activation have only one winner without freezing the group', async cancelFirst => {
    const release = deferred<void>(), first = deferred<void>(); let runs = 0, groupId = '', childId = '';
    const fixture = await setup(async () => ({
      async run() { runs++; if (runs === 1) { first.resolve(); return 'FIRST_RESULT'; } await release.promise; return 'LATE_RESULT'; },
      async suspend() {}, async dispose() {},
    }), async context => {
      groupId = context.groupId;
      childId = (await fixture.service.spawn({ actor: context.actor, requestSource: 'agent', operationId: 'spawn', taskName: 'child', message: 'first' })).targetAgentId!;
      await first.promise;
    });
    try {
      await fixture.start(); await fixture.host.drain();
      await vi.waitFor(() => expect(fixture.coordinator.snapshot().active).toBe(0));
      const access = fixture.service.createUserAccess({ requestSource: 'user', actorId: 'user', threadId: 't1', profileId: 'p1', workspaceId: 'w1' });
      const control = { access, requestSource: 'user' as const, groupId, agentId: childId, expectedTurn: 1, operationId: 'cancel' };
      let interrupted: Promise<unknown> | undefined;
      if (cancelFirst) {
        const enqueue = fixture.coordinator.enqueueGroupTurn.bind(fixture.coordinator);
        vi.spyOn(fixture.coordinator, 'enqueueGroupTurn').mockImplementation((...args) => {
          const realRequest = enqueue(...args);
          // Observe the real grant before service registers its admission callback.
          // Both controls still execute through the actual group sequencer.
          void realRequest.then(() => { interrupted = fixture.service.userInterrupt(control); }).catch(() => {});
          return realRequest;
        });
      }
      await fixture.service.userFollowup({ ...control, operationId: 'queued', message: 'second' });
      if (!cancelFirst) {
        await vi.waitFor(() => expect(fixture.store.getAgent(groupId, childId)).toMatchObject({ turn: 2, status: 'running' }));
        interrupted = fixture.service.userInterrupt({ ...control, expectedTurn: 2 });
      }
      await vi.waitFor(() => expect(interrupted).toBeDefined()); await interrupted;
      release.resolve(); await vi.waitFor(() => expect(fixture.coordinator.snapshot().active).toBe(0));
      expect(runs).toBe(cancelFirst ? 1 : 2);
      expect(fixture.store.getGroup(groupId)?.mutationBlockedReason).toBeNull();
      const cancellations = fixture.store.listMessages(groupId, `root_${groupId}`).filter(message => message.kind === 'error');
      expect(cancellations).toHaveLength(1);
      if (cancelFirst) expect(cancellations[0].preview).toContain('followup_cancelled');
      else expect(cancellations[0].preview).toBe('agent_interrupted');
    } finally { release.resolve(); vi.restoreAllMocks(); }
  });

  it('A37 Given interrupt has revoked a child turn, When it tries another side effect, Then its stale scoped actor is rejected immediately', async () => {
    const entered = deferred<void>(); const release = deferred<string>(); let childContext!: DesktopAgentExecutionContext;
    const fixture = await setup(async input => ({
      async run() { childContext = input.getTurnContext(); entered.resolve(); return release.promise; }, async dispose() {},
    }), async context => {
      const child = await fixture.service.spawn({ actor: context.actor, requestSource: 'agent', operationId: 'spawn-revoke', taskName: 'revoke', message: 'work' });
      await entered.promise;
      await fixture.service.interrupt({ actor: context.actor, requestSource: 'agent', operationId: 'stop-revoke', target: child.targetAgentId! });
      try {
        expect(childContext.signal.aborted).toBe(true);
        await expect(fixture.service.send({ actor: childContext.actor, requestSource: 'agent', operationId: 'late-send', target: 'main', message: 'must fail' })).rejects.toThrow(/authority/);
      } finally { release.resolve('late'); }
    });
    await fixture.start(); await fixture.host.drain();
  });

  it.each(['agent', 'user-busy', 'user-idle', 'unknown-source'] as const)('A12/A32 Given %s followup from A waits behind X, Then a later prepared B cannot change its accepted provenance', async mode => {
    const entered = deferred<void>(), first = deferred<string>(), externalEntered = deferred<void>(), externalRelease = deferred<void>();
    const turns: DesktopAgentExecutionContext[] = []; const order: string[] = [];
    let rootCalls = 0, childId = '', groupId = '', ordinary!: Promise<void>;
    const f = await setup(async input => ({ run: async () => {
      const current = input.getTurnContext(); turns.push(current);
      if (turns.length === 1) { entered.resolve(); return first.promise; }
      order.push('followup');
      await f.service.recordRuntimeEvent(current, { type: 'artifact_recorded', sessionId: 'child', turnId: current.turnId,
        intentId: 'artifact', stageId: 'artifact', artifactId: `artifact-${current.turn}`, label: 'result.txt', kind: 'file', path: join(f.root, 'result.txt') });
      return 'followup result';
    }, suspend: async () => {}, dispose: async () => {} }), async context => {
      if (++rootCalls > 1) {
        order.push('root-B'); const batch = await context.mailbox.drainInput();
        if (batch.claimId) await context.mailbox.confirmApplied(batch.claimId); return;
      }
      groupId = context.groupId;
      childId = (await f.service.spawn({ actor: context.actor, requestSource: 'agent', operationId: 'source-spawn', taskName: 'source', message: 'first' })).targetAgentId!;
      await entered.promise;
      ordinary = f.coordinator.run(undefined, async () => { order.push('X'); externalEntered.resolve(); await externalRelease.promise; });
      if (mode === 'agent' || mode === 'unknown-source') {
        // This compatibility edge deliberately supplies an unknown private source,
        // not a public caller-controlled provenance field.
        if (mode === 'unknown-source') context.sourceTaskId = undefined;
        const input = { actor: context.actor, requestSource: 'agent' as const, operationId: 'source-followup', target: childId, message: 'second' };
        const acknowledgement = await f.service.followup(input);
        expect(await f.service.followup(input)).toEqual(acknowledgement);
        await expect(f.service.followup({ ...input, message: 'conflicting payload' })).rejects.toThrow('operation_id_conflict');
      }
    });
    try {
      const sourceA = await f.start(); await f.host.drain();
      const access = f.service.createUserAccess({ requestSource: 'user', actorId: 'user', threadId: 't1', profileId: 'p1', workspaceId: 'w1' });
      const userInput = { access, requestSource: 'user' as const, operationId: 'source-followup', groupId, agentId: childId, expectedTurn: 1, message: 'second' };
      let userAcknowledgement;
      if (mode === 'user-busy') userAcknowledgement = await f.service.userFollowup(userInput);
      first.resolve('first result'); await externalEntered.promise;
      await vi.waitFor(() => expect(f.store.getAgent(groupId, childId)?.executionActive).toBe(false));
      if (mode === 'user-idle') userAcknowledgement = await f.service.userFollowup(userInput);
      await vi.waitFor(() => expect(f.coordinator.snapshot().waiting).toBe(1));
      const b = await f.service.prepareRoot(f.host, 't1', { prompt: 'B', materials: [] }); await f.host.startTask(b.taskId);
      expect(f.store.getRootBinding(b.taskId)?.phase).toBe('queued');
      if (mode.startsWith('user')) {
        expect(await f.service.userFollowup(userInput)).toEqual(userAcknowledgement);
        await expect(f.service.userFollowup({ ...userInput, message: 'conflicting payload' })).rejects.toThrow('operation_id_conflict');
      }
      externalRelease.resolve(); await ordinary; await f.host.drain();
      await vi.waitFor(() => expect(turns).toHaveLength(2));
      const expectedSource = mode === 'unknown-source' ? undefined : sourceA;
      expect(turns[0].sourceTaskId).toBe(sourceA);
      expect(turns[1].sourceTaskId).toBe(expectedSource);
      expect(f.store.getAgent(groupId, childId)?.sourceTaskId).toBe(expectedSource);
      const artifact = f.store.readEvents(groupId).find(event => event.kind === 'artifact' && event.turnId === turns[1].turnId)!;
      expect(artifact.payload.sourceTaskId).toBe(expectedSource);
      expect(order).toEqual(['X', 'followup', 'root-B']);
      expect(turns[1].turnId).not.toBe(turns[0].turnId);
      expect(turns[1].signal).not.toBe(turns[0].signal);
      expect(turns[1].memberTicket.epoch).not.toBe(turns[0].memberTicket.epoch);
      expect(f.store.getOperation(groupId, 'source-followup')?.result.state).toBe('applied');
    } finally { first.resolve('cleanup'); externalRelease.resolve(); await f.host.drain(); }
  });

  it.each([false, true])('A12/A32 Given root B follows up A child with earlier A followup=%s, Then each queued operation preserves its own caller source after both roots end', async includeA => {
    const entered = deferred<void>(), release = deferred<string>(); const sources: Array<string | undefined> = [];
    let childId = '', groupId = '', rootCalls = 0;
    const f = await setup(async input => ({ run: async () => {
      const context = input.getTurnContext(); sources.push(context.sourceTaskId);
      if (sources.length === 1) { entered.resolve(); return release.promise; }
      await f.service.recordRuntimeEvent(context, { type: 'artifact_recorded', sessionId: 'child', turnId: context.turnId,
        intentId: 'artifact', stageId: 'artifact', artifactId: `artifact-${context.turn}`, label: 'result.txt', kind: 'file', path: join(f.root, 'result.txt') });
      return 'result';
    }, suspend: async () => {}, dispose: async () => {} }), async context => {
      if (++rootCalls === 1) {
        groupId = context.groupId;
        childId = (await f.service.spawn({ actor: context.actor, requestSource: 'agent', operationId: 'callers-spawn', taskName: 'callers', message: 'first' })).targetAgentId!;
        await entered.promise;
        if (!includeA) return;
      }
      const request = { actor: context.actor, requestSource: 'agent' as const, operationId: `caller-${rootCalls}`, target: childId, message: `from ${rootCalls}` };
      const acknowledgement = await f.service.followup(request);
      expect(await f.service.followup(request)).toEqual(acknowledgement);
    });
    try {
      const a = await f.start(); await f.host.drain();
      const b = await f.start(); await f.host.drain();
      expect(a).not.toBe(b); expect(sources).toEqual([a]);
      release.resolve('first');
      await vi.waitFor(() => expect(f.coordinator.snapshot().active).toBe(0));
      expect(sources).toEqual(includeA ? [a, a, b] : [a, b]);
      expect(f.store.getAgent(groupId, childId)?.sourceTaskId).toBe(b);
      expect(f.store.readEvents(groupId).filter(event => event.kind === 'artifact').map(event => event.payload.sourceTaskId)).toEqual(includeA ? [a, b] : [b]);
    } finally { release.resolve('cleanup'); }
  });

  it.each(['agent', 'user'] as const)('A15 Given %s followup receipt persistence fails, Then no new source-bearing turn is queued or executed', async source => {
    const entered = deferred<void>(), release = deferred<string>(); const run = vi.fn(async () => { entered.resolve(); return release.promise; });
    let groupId = '', childId = '';
    const f = await setup(async () => ({ run, suspend: async () => {}, dispose: async () => {} }), async context => {
      groupId = context.groupId;
      childId = (await f.service.spawn({ actor: context.actor, requestSource: 'agent', operationId: 'failure-spawn', taskName: 'failure', message: 'first' })).targetAgentId!;
      await entered.promise;
      const original = f.store.putOperation.bind(f.store);
      const fault = vi.spyOn(f.store, 'putOperation').mockImplementation((operation, control) => {
        if (operation.operationId === 'failure-followup') throw new Error('SQLITE_FULL'); return original(operation, control);
      });
      try {
        const access = f.service.createUserAccess({ requestSource: 'user', actorId: 'user', threadId: 't1', profileId: 'p1', workspaceId: 'w1' });
        const request = source === 'agent' ? f.service.followup({ actor: context.actor, requestSource: 'agent', operationId: 'failure-followup', target: childId, message: 'never' })
          : f.service.userFollowup({ access, requestSource: 'user', groupId, agentId: childId, expectedTurn: 1, operationId: 'failure-followup', message: 'never' });
        await expect(request).rejects.toThrow('SQLITE_FULL');
      } finally { fault.mockRestore(); release.resolve('cleanup'); }
    });
    try {
      const taskId = await f.start(); await f.host.drain();
      await vi.waitFor(() => expect(f.coordinator.snapshot().active).toBe(0));
      expect(run).toHaveBeenCalledTimes(1);
      expect(f.store.getOperation(groupId, 'failure-followup')).toBeNull();
      expect(f.store.getAgent(groupId, childId)?.sourceTaskId).toBe(taskId);
    } finally { release.resolve('cleanup'); }
  });

  it('LIFE-F1 Given B is busy and X waits, When root waits for its followup, Then B2 settles in the current epoch before root exits and X runs', async () => {
    const entered = deferred<void>(); const release = deferred<string>(); const followupDone = deferred<void>();
    const order: string[] = []; const epochs: number[] = [];
    let requests = 0; let ordinary!: Promise<void>;
    const fixture = await setup(async input => ({
      async run() {
        epochs.push(input.getTurnContext().memberTicket.epoch);
        if (++requests === 1) { entered.resolve(); return release.promise; }
        order.push('B2'); followupDone.resolve(); return 'second result';
      }, async suspend() {}, async dispose() {},
    }), async context => {
      const child = await fixture.service.spawn({ actor: context.actor, requestSource: 'agent', operationId: 'spawn-busy', taskName: 'busy', message: 'one' });
      await entered.promise;
      try {
      ordinary = fixture.coordinator.run(undefined, async () => { order.push('X'); });
      const followup = await fixture.service.followup({ actor: context.actor, requestSource: 'agent', operationId: 'follow-busy', target: child.targetAgentId!, message: 'two' });
      expect(followup).toMatchObject({ state: 'queued_next_admission', expectedTurn: 2 });
      const input = { actor: context.actor, requestSource: 'agent' as const, targets: [child.targetAgentId!], operationId: 'follow-busy', expectedTurn: 2, timeoutMs: 1000 };
      let returned = false;
      const waiting = fixture.service.wait(input).then(value => { returned = true; return value; });
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(returned).toBe(false);
      release.resolve('one result');
      let waited = await waiting;
      for (let attempts = 0; !waited.settled && attempts < 5; attempts++) {
        expect(waited.reason).not.toBe('queued');
        const batch = await context.mailbox.drainInput(); if (batch.claimId) await context.mailbox.confirmApplied(batch.claimId);
        waited = await fixture.service.wait(input);
      }
      expect(waited).toMatchObject({ reason: 'settled_terminal', settled: true });
      expect(waited.agents[0].turn).toBe(2);
      expect(order).toEqual(['B2']);
      await expect(fixture.service.wait({ ...input, operationId: 'spawn-busy', expectedTurn: 1 })).rejects.toThrow('multi_agent_wait_turn_superseded');
      } finally { release.resolve('one result'); }
    });
    await fixture.start(); await fixture.host.drain(); await ordinary;
    await vi.waitFor(() => expect(requests).toBe(2));
    await followupDone.promise;
    expect(order).toEqual(['B2', 'X']); expect(epochs[1]).toBe(epochs[0]);
  });

  it('LIFE-F2 Given a future user turn, Then agent followup is durably refused and impossible waits cannot spin', async () => {
    const release = deferred<string>();
    const fixture = await setup(async () => ({ run: async () => release.promise, suspend: async () => {}, dispose: async () => {} }), async context => {
      const auth = { actor: context.actor, requestSource: 'agent' as const };
      const child = await fixture.service.spawn({ ...auth, operationId: 'spawn-barrier', taskName: 'barrier', message: 'first' });
      await vi.waitFor(() => expect(fixture.store.getAgent(context.groupId, child.targetAgentId!)?.sessionResident).toBe(true));
      const access = fixture.service.createUserAccess({ requestSource: 'user', actorId: 'user', threadId: 't1', profileId: 'p1', workspaceId: 'w1' });
      await fixture.service.userFollowup({ access, requestSource: 'user', groupId: context.groupId, agentId: child.targetAgentId!, operationId: 'user-barrier', expectedTurn: 1, message: 'user next' });
      const request = { ...auth, operationId: 'blocked-agent', target: child.targetAgentId!, message: 'cannot join' };
      const denied = await fixture.service.followup(request);
      expect(denied).toMatchObject({ state: 'completed', outcome: 'rejected', error: 'multi_agent_followup_user_barrier' });
      expect(await fixture.service.followup(request)).toEqual(denied);
      expect(fixture.store.getOperation(context.groupId, 'blocked-agent')?.result).toEqual(denied);
      const wait = { ...auth, targets: [child.targetAgentId!], timeoutMs: 100 };
      await expect(fixture.service.wait({ ...wait, expectedTurn: 9 })).rejects.toThrow('multi_agent_wait_invalid_turn');
      await expect(fixture.service.wait({ ...wait, operationId: 'unknown' })).rejects.toThrow('multi_agent_wait_invalid_operation');
      await expect(fixture.service.wait({ ...wait, operationId: 'spawn-barrier', expectedTurn: 2 })).rejects.toThrow('multi_agent_wait_invalid_operation');
      await expect(fixture.service.wait({ ...wait, targets: [child.targetAgentId!, context.agentId], operationId: 'spawn-barrier' })).rejects.toThrow('multi_agent_wait_invalid_operation');
      await expect(fixture.service.wait({ ...wait, expectedTurn: 2 })).rejects.toThrow('multi_agent_wait_user_barrier');
      await fixture.service.interrupt({ ...auth, operationId: 'interrupt-barrier', target: child.targetAgentId! });
      expect(fixture.store.getAgent(context.groupId, child.targetAgentId!)?.resumable).toBe(false);
      release.resolve('done');
    });
    try { await fixture.start(); await fixture.host.drain(); } finally { release.resolve('done'); }
  });

  it('LIFE-F3 Given child session initialization is pending, Then followup remains queueable and interrupt removes that capability', async () => {
    const initialized = deferred<void>();
    const fixture = await setup(async () => { await initialized.promise; return { run: async () => 'done', suspend: async () => {}, dispose: async () => {} }; }, async context => {
      const auth = { actor: context.actor, requestSource: 'agent' as const };
      const child = await fixture.service.spawn({ ...auth, operationId: 'init-spawn', taskName: 'init', message: 'first' });
      try {
        expect(fixture.store.getAgent(context.groupId, child.targetAgentId!)).toMatchObject({ resumable: true, sessionResident: false });
        expect(await fixture.service.followup({ ...auth, operationId: 'init-followup', target: child.targetAgentId!, message: 'next' })).toMatchObject({ state: 'queued_next_admission' });
        await fixture.service.interrupt({ ...auth, operationId: 'init-interrupt', target: child.targetAgentId! });
        expect(fixture.store.getAgent(context.groupId, child.targetAgentId!)?.resumable).toBe(false);
      } finally { initialized.resolve(); }
    });
    try { await fixture.start(); await fixture.host.drain(); } finally { initialized.resolve(); }
  });

  it('A33 Given root seal committed before host terminal, When user cancellation arrives, Then host and root complete while its child keeps running', async () => {
    const sealed = deferred<void>(); const rootFinish = deferred<void>(); const childFinish = deferred<string>();
    const childEntered = deferred<void>();
    let rootContext!: DesktopAgentExecutionContext; let childSignal!: AbortSignal;
    const fixture = await setup(async () => ({ async run(_message, signal) { childSignal = signal!; childEntered.resolve(); return childFinish.promise; }, async suspend() {}, async dispose() {} }), async context => {
      rootContext = context;
      await fixture.service.spawn({ actor: context.actor, requestSource: 'agent', operationId: 'spawn-seal', taskName: 'seal_child', message: 'work' });
      await childEntered.promise;
      await context.mailbox.trySealTurn(); sealed.resolve(); await rootFinish.promise;
    });
    const taskId = await fixture.start(); await sealed.promise;
    try {
      await fixture.host.cancelTask(taskId);
      expect(rootContext.signal.aborted).toBe(false);
      expect(childSignal.aborted).toBe(false);
      rootFinish.resolve(); await fixture.host.drain();
      expect((await fixture.host.recoverTask(taskId)).snapshot.status).toBe('completed');
      expect(fixture.store.getAgent(rootContext.groupId, rootContext.agentId)?.status).toBe('completed');
    } finally { rootFinish.resolve(); childFinish.resolve('done'); }
  });

  it('A33 Given cancellation wins before root seal, When the actual host cancellation runs, Then both root and child signals are aborted', async () => {
    const entered = deferred<void>(); let rootContext!: DesktopAgentExecutionContext; let childSignal!: AbortSignal;
    const childEntered = deferred<void>();
    const fixture = await setup(async () => ({ async run(_message, signal) {
      childSignal = signal!;
      childEntered.resolve();
      return new Promise<string>(resolve => signal!.addEventListener('abort', () => resolve('aborted'), { once: true }));
    }, async suspend() {}, async dispose() {} }), async context => {
      rootContext = context;
      await fixture.service.spawn({ actor: context.actor, requestSource: 'agent', operationId: 'spawn-cancel', taskName: 'cancel_child', message: 'work' });
      await childEntered.promise;
      entered.resolve();
      await new Promise<void>(resolve => context.signal.addEventListener('abort', () => resolve(), { once: true }));
    });
    const taskId = await fixture.start(); await entered.promise;
    await fixture.host.cancelTask(taskId); await fixture.host.drain();
    expect(rootContext.signal.aborted).toBe(true); expect(childSignal.aborted).toBe(true);
    expect((await fixture.host.recoverTask(taskId)).snapshot.status).toBe('cancelled');
  });

  it('A33 Given an authorized cancellation cannot persist its intent, When SQLite fails, Then physical abort still happens but the host call returns unknown', async () => {
    const entered = deferred<void>(); let rootContext!: DesktopAgentExecutionContext;
    const fixture = await setup(async () => ({ async run() { return 'unused'; }, async dispose() {} }), async context => {
      rootContext = context; entered.resolve();
      await new Promise<void>(resolve => context.signal.addEventListener('abort', () => resolve(), { once: true }));
    });
    const taskId = await fixture.start(); await entered.promise;
    const original = fixture.store.putRootBinding.bind(fixture.store);
    const fault = vi.spyOn(fixture.store, 'putRootBinding').mockImplementation((binding, control) => {
      if (binding.phase === 'abandoned') throw new Error('SQLITE_FULL');
      return original(binding, control);
    });
    try {
      await expect(fixture.host.cancelTask(taskId)).rejects.toThrow(/persistence/);
      expect(rootContext.signal.aborted).toBe(true);
    } finally { fault.mockRestore(); }
    await fixture.host.drain();
  });

  it('A42 Given queued host checkpoints from the previous boot, When startup reconciles both stores, Then roots fail without replay and ordinary preparations remain untouched', async () => {
    const fixture = await setup(async () => ({ async run() { return 'unused'; }, async dispose() {} }), async () => {});
    const ordinary = await fixture.host.prepareTask({ prompt: 'ordinary preparation', materials: [] });
    const prepared = await fixture.service.prepareRoot(fixture.host, 't1', { prompt: 'old root', materials: [] });
    await fixture.service.dispose(); fixture.store.close();
    const store = new DesktopMultiAgentStore(join(fixture.root, 'groups.sqlite'), { bootId: 'second-boot' });
    cleanup.push(() => store.close());
    const runner = vi.fn(async () => {});
    const service = new DesktopMultiAgentService({ store, coordinator: new DesktopExecutionCoordinator(), createSession: vi.fn() });
    cleanup.push(() => service.dispose());
    const host = new InProcessTaskRuntimeHost({ snapshotStore: new FileTaskSnapshotStore(join(fixture.root, 'tasks')),
      materialRegistry: new MaterialRegistry({ workspaceRoot: join(fixture.root, 'materials'), maxBytes: 1024 * 1024 }), runner,
      assertTaskAdmission: snapshot => service.assertHostAdmission(snapshot),
    });
    await service.initialize(host);
    expect((await host.inspectTask(prepared.taskId))?.status).toBe('failed');
    expect((await host.inspectTask(prepared.taskId))?.salvage?.reason).toBe('multi_agent_prepare_interrupted');
    expect((await host.inspectTask(ordinary.taskId))?.status).toBe('understanding');
    expect(store.activeGroup('t1')).toBeNull();
    await expect(host.startTask(prepared.taskId)).rejects.toThrow(/interrupted|terminal/);
    expect(runner).not.toHaveBeenCalled();
    expect(await host.getActiveTasks()).toEqual([{ taskId: ordinary.taskId }]);
  });
});
