// @vitest-environment node
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
import { compileProtectionWorkerEntry } from '../fixtures/desktop-protection-worker-entry.js';
import * as publicationProducer from '../../../src/runtime/sol-pi/compound-publication-producer.js';

// Source-mode Vitest does not emit the fixed .js Worker entry. Map only that
// URL to the test-owned compiled production entry; execution and exit are native.
const nativeWorker = vi.hoisted(() => ({ output: '', root: '', protectionOutput: '', protectionRoot: '', starts: 0, exits: 0 }));
vi.mock('node:worker_threads', async importOriginal => {
  const actual = await importOriginal<typeof import('node:worker_threads')>();
  const sourceUrl = new URL('../../../src/runtime/task-host/delivery-verifier-worker.js', import.meta.url);
  const source = join(realpathSync(dirname(fileURLToPath(sourceUrl))),basename(fileURLToPath(sourceUrl)));
  const protectionUrl = new URL('../../../src/runtime/task-host/protection-read-worker.ts', import.meta.url);
  const protectionSource = join(realpathSync(dirname(fileURLToPath(protectionUrl))), basename(fileURLToPath(protectionUrl)));
  return { ...actual, Worker: class extends actual.Worker {
    constructor(filename: ConstructorParameters<typeof actual.Worker>[0], options?: ConstructorParameters<typeof actual.Worker>[1]) {
      let mapped=false;
      try{const path=typeof filename==='string'?filename:fileURLToPath(filename);mapped=join(realpathSync(dirname(path)),basename(path))===source;}catch{/* Non-owned entry remains native and must not be redirected. */}
      if (mapped && !nativeWorker.output) throw new Error('test compiled Worker entry is not ready');
      let protectionMapped = false;
      try { const path = typeof filename === 'string' ? filename : fileURLToPath(filename); protectionMapped = join(realpathSync(dirname(path)), basename(path)) === protectionSource; } catch { /* unowned native entry */ }
      if (protectionMapped && !nativeWorker.protectionOutput) throw Error('fresh fixed protection Worker required');
      super(mapped ? nativeWorker.output : protectionMapped ? nativeWorker.protectionOutput : filename, options);
      if (mapped || protectionMapped) { nativeWorker.starts++; this.once('exit', () => { nativeWorker.exits++; }); }
    }
  } };
});
beforeAll(async () => { Object.assign(nativeWorker, await compileVerifierEntry('delivery-verifier-worker.ts')); const protection = await compileProtectionWorkerEntry(); nativeWorker.protectionOutput = protection.output; nativeWorker.protectionRoot = protection.root; });
afterAll(() => {
  try { expect(nativeWorker.exits).toBe(nativeWorker.starts); }
  finally { for (const root of [nativeWorker.root, nativeWorker.protectionRoot]) if (root) rmSync(root, { recursive: true, force: true, maxRetries: 3 }); }
});

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

describe('P2 actual managed ancestor followup', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  const capturedAssertions: unknown[] = [];
  const expectedRunnerFailures=new Set<unknown>();
  afterEach(async () => {
    const cleanupErrors:unknown[]=[];
    for (const action of cleanup.splice(0).reverse()) {try{await action();}catch(error){cleanupErrors.push(error);}}
    // Always restore every fixture, even when an unknown physical outcome makes
    // disposal reject; report that original failure without contaminating the next case.
    const assertions=capturedAssertions.splice(0).filter(error=>!expectedRunnerFailures.has(error));expectedRunnerFailures.clear();
    if(cleanupErrors.length)throw new AggregateError([...assertions,...cleanupErrors],'runner and cleanup failures: '+[...assertions,...cleanupErrors].map(value=>value instanceof Error?value.stack:String(value)).join('\n'));
    // Host/core intentionally catch runner failures. A test assertion inside a
    // real runner must still fail this test, not be mistaken for product output.
    expect(assertions.map(error=>error instanceof Error?error.stack+(error.cause instanceof Error?"\nCAUSE: "+error.cause.stack:""):error)).toEqual([]);
  });
  async function setup(createSession: DesktopMultiAgentServiceOptions['createSession'], body: (context: DesktopAgentExecutionContext,input:TaskRunnerInput) => Promise<void>, policy: { expectedDisposeError?:Error|(()=>Error|undefined); isolatedConfigRoot?: boolean; multiAgentLeaseMs?: number; coreIdleTimeoutMs?: number; prepareObservationSession?: DesktopMultiAgentServiceOptions['prepareObservationSession']; prepareObservationMessage?: DesktopMultiAgentServiceOptions['prepareObservationMessage']; prepareObservationFollowup?:DesktopMultiAgentServiceOptions['prepareObservationFollowup'] } = {}) {
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
    cleanup.push(async () => {try{await service.dispose();}catch(error){if(error!==(typeof policy.expectedDisposeError==='function'?policy.expectedDisposeError():policy.expectedDisposeError))throw error;}});
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

  it.each(['success','unpublished-ack','unknown-resource','own-effect','active-window','final-history-failure','final-history-failure-shutdown','root-tail'] as const)('uses exact drained descendant resources for a fresh user turn: %s',async scenario=>{
    const finalHistoryFailure=scenario==='final-history-failure'||scenario==='final-history-failure-shutdown';
    const negative=!['success','active-window','final-history-failure','final-history-failure-shutdown','root-tail'].includes(scenario);
    const finalPublication=vi.spyOn(publicationProducer,'publishCompoundFinalPublication');cleanup.push(()=>finalPublication.mockRestore());
    const {writeFileSync,readFileSync}=await import('node:fs'),{homedir}=await import('node:os');
    const {DesktopMultiAgentRuntime}=await import('../../electron/desktop-multi-agent-runtime.js');
    const {DesktopOwnedToolRegistry,DesktopToolCatalogBridge}=await import('../../electron/desktop-multi-agent-catalog-bridge.js');
    const {createDesktopModelRunnerWithRegistry}=await import('../../electron/desktop-services.js');
    const {buildToolList}=await import('../../../src/ai/tools/index.js'),{parseObservationPolicyFile}=await import('../../../src/runtime/sol-pi/product-bootstrap.js');
    let expectedFailure:Error|undefined;let runtime!:InstanceType<typeof DesktopMultiAgentRuntime>,rootCalls=0,childCalls=0,descendantCalls=0;
    let retainedActivation:import('../../electron/desktop-observation-owner.js').DesktopObservationTaskActivation|undefined;
    const generationTwoInvocations=new Set<string>();
    const entered=deferred<void>(),release=deferred<void>(),outcome=deferred<string>(),rootPublished=deferred<void>();
    const response=(delta:unknown,tool=false)=>new Response('data: '+JSON.stringify({choices:[{delta,finish_reason:tool?'tool_calls':'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
    const tool=(id:string,name:string,args:unknown)=>response({tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]},true);
    const f=await setup(input=>runtime.createSession(input),async(context,input)=>{
      const source=join(f.root,'source.txt');writeFileSync(source,'Selected source');const policyFile=join(f.root,'policy.json'),expiresAt=Date.now()+240000;
      writeFileSync(policyFile,JSON.stringify({version:1,environmentId:'deepseek-recipe-0.1.1',model:'deepseek-flash',destination:{provider:'deepseek',url:'https://api.deepseek.com/chat/completions'},localPersistence:true,allowUnclassifiedText:true,allowModelDisclosure:true,allowIncomplete:false,expiresAt,readFileScopes:[{filePath:source,startLine:1}],bashSources:[],compoundExecution:{version:1,mode:'mechanism-experiment'},ordinaryChildren:{enabled:true,maxDepth:2,maxChildren:3,expiresAt,nativeTools:['read']}}));
      const config=await import('../../../src/utils/config.js'),mock=vi.spyOn(config,'loadConfig').mockResolvedValue({schemaVersion:2,defaultProvider:'deepseek',defaultModelId:'current',providers:{deepseek:{type:'custom',protocol:'openai_legacy',baseUrl:'https://api.deepseek.com',apiKey:'fixture-only'}},models:{current:{provider:'deepseek',model:'deepseek-flash',label:'Current'}},defaultMode:'interactive'} as never);cleanup.push(()=>mock.mockRestore());
      const read=buildToolList(undefined,{cwd:f.root}).find(t=>t.definition.name==='read')!,base=new DesktopOwnedToolRegistry({autoMode:true},[read]);cleanup.push(()=>base.dispose());
      const bridge=new DesktopToolCatalogBridge({registry:base,workspaceId:'w1',getService:()=>f.service});cleanup.push(()=>bridge.dispose());
      const activation:import('../../electron/desktop-observation-owner.js').DesktopObservationTaskActivation=retainedActivation??{policy:parseObservationPolicyFile(policyFile),profileRoot:join(f.root,'profile'),environmentRoot:join(homedir(),'.cache/xiaok/sol-pi/deepseek-recipe-0.1.1'),onPrompt:async()=>true,consumed:false};
      retainedActivation=activation;
      const runner=createDesktopModelRunnerWithRegistry(base,[read],f.root,{} as never,new MaterialRegistry({workspaceRoot:join(f.root,'runner-materials'),maxBytes:1048576}),{}, {observationTasks:new Map([[input.taskId,activation]]),observationGroupHost:{getHost:()=>f.host,observationStore:new FileTaskSnapshotStore(join(f.root,'tasks')).observations},multiAgent:{runtime,service:f.service,catalog:bridge,workspaceId:'w1',cwd:f.root}});
      try{await runner({...input,permissionMode:'auto'},context);}
      catch(error){if(scenario==='final-history-failure-shutdown'&&context.signal.aborted&&error instanceof Error&&error.name==='AbortError')expectedRunnerFailures.add(error);throw error;}
    },{expectedDisposeError:()=>expectedFailure,isolatedConfigRoot:true,prepareObservationSession:input=>runtime.prepareObservationSession(input),prepareObservationMessage:input=>runtime.prepareObservationMessage(input),prepareObservationFollowup:async preparation=>{
      const facts=f.service.inspectManagedFollowupPreparation(preparation),path=join(f.root,'compound-sessions',facts.childSession.exportSnapshot().sessionId+'.json'),original=readFileSync(path,'utf8');
      if(negative){
        const snapshot=JSON.parse(original),ledger=snapshot.compoundOperations,row=ledger.directOperations[0];
        const {advanceDirectOperation,createOrGetDirectOperation}=await import('../../../src/runtime/sol-pi/compound-direct-operation.js');
        if(scenario==='unpublished-ack')row.delegation.managed.ackPublished=false;
        else if(scenario==='unknown-resource')snapshot.compoundOperations=advanceDirectOperation(ledger,row.id,{stage:'outcome_unknown',outcome:'unknown'});
        else{const created=createOrGetDirectOperation(ledger,{dispatch:{...row.dispatch,originalToolUseId:'unfinished-own-effect'},toolName:'write',inputHash:row.inputHash,ownerId:row.ownerId,requestSource:'agent',scopeId:row.scopeId,permissionGeneration:row.permissionGeneration});snapshot.compoundOperations=advanceDirectOperation(created.ledger,created.operation.id,{stage:'started',finalInputHash:row.inputHash});}
        writeFileSync(path,JSON.stringify(snapshot));
      }
      try{return await runtime.prepareObservationFollowup(preparation);}catch(error){if(negative)expectedFailure=error as Error;outcome.resolve(String(error));throw error;}
      finally{if(negative)writeFileSync(path,original);}
    }});

    if(scenario==='success'){
      const {DesktopManagedAgentSession}=await import('../../electron/desktop-managed-agent-session.js');
      const originalRun=DesktopManagedAgentSession.prototype.run;
      const rejectionObserver=vi.spyOn(DesktopManagedAgentSession.prototype,'run').mockImplementation(function(this:InstanceType<typeof DesktopManagedAgentSession>,...args){
        const raw=originalRun.apply(this,args);
        void raw.then(()=>{},error=>{outcome.resolve(String(error));});
        return raw;
      });cleanup.push(()=>rejectionObserver.mockRestore());
    }
    const followupTarget=f.service as unknown as {activateManagedFollowup(...args:unknown[]):Promise<void>},activate=followupTarget.activateManagedFollowup.bind(followupTarget);
    const activationSpy=vi.spyOn(followupTarget,'activateManagedFollowup').mockImplementation(async(...args)=>{try{return await activate(...args);}catch(error){outcome.resolve(String(error));throw error;}});cleanup.push(()=>activationSpy.mockRestore());
    if(scenario==='active-window'){
      const followup=f.service.followup.bind(f.service),spy=vi.spyOn(f.service,'followup').mockImplementation(async input=>{const result=await followup(input);expect(result.state).toBe('queued_next_admission');release.resolve();return result;});cleanup.push(()=>spy.mockRestore());
    }
    if(finalHistoryFailure){
      const {FileSessionStore}=await import('../../../src/ai/runtime/session-store/file-store.js'),original=FileSessionStore.prototype.compareAndSave,error=Error('actual final assistant history save failed');expectedRunnerFailures.add(error);
      const spy=vi.spyOn(FileSessionStore.prototype,'compareAndSave').mockImplementation(async function(this:InstanceType<typeof FileSessionStore>,input){
        if(input.nextSnapshot.messages.at(-1)?.content.some(block=>block.type==='text'&&block.text==='First child turn completed.')){
          throw error;
        }
        return original.call(this,input);
      });cleanup.push(()=>spy.mockRestore());
    }
    if(scenario==='final-history-failure-shutdown'){
      const eventOwner=f.service as unknown as {captureCoreEvent(group:unknown,event:{kind:string;agent:{error?:string;status:string}}):void},capture=eventOwner.captureCoreEvent.bind(eventOwner);let stopped=false;
      const eventSpy=vi.spyOn(eventOwner,'captureCoreEvent').mockImplementation((group,event)=>{
        if(!stopped&&event.kind==='status'&&event.agent.error==='actual final assistant history save failed'){
          stopped=true;release.resolve();void f.service.dispose().catch(failure=>{expectedFailure=failure as Error;expectedRunnerFailures.add(failure);});
        }
        capture(group,event);
      });cleanup.push(()=>eventSpy.mockRestore());
    }
    const tailEntered=deferred<void>(),tailRelease=deferred<void>();
    if(scenario==='root-tail'){
      const original=FileTaskSnapshotStore.prototype.saveWithReceipt;let held=false;
      const spy=vi.spyOn(FileTaskSnapshotStore.prototype,'saveWithReceipt').mockImplementation(async function(this:FileTaskSnapshotStore,snapshot,previous){
        if(!held&&snapshot.status==='completed'){held=true;tailEntered.resolve();await tailRelease.promise;}
        return original.call(this,snapshot,previous);
      });cleanup.push(()=>spy.mockRestore());cleanup.push(()=>tailRelease.resolve());
    }
    runtime=new DesktopMultiAgentRuntime({service:f.service});
    vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{
      try{
      const body=JSON.parse(String(init?.body)),system=String(body.messages[0].content),groupId=f.store.getThread('t1')!.activeGroupId!;
      if(system.includes('Assigned Desktop agent: /root/managed/descendant\n')){
        descendantCalls++;entered.resolve();
        if(descendantCalls===1){await release.promise;if(scenario==='active-window')return response({tool_calls:[
          {index:0,id:'descendant-read',type:'function',function:{name:'read',arguments:JSON.stringify({file_path:join(f.root,'source.txt')})}},
          {index:1,id:'descendant-send',type:'function',function:{name:'send_message',arguments:JSON.stringify({target:'/root/managed',message:'The selected source is available for the next turn.'})}},
        ]},true);}
        if(scenario==='active-window'&&descendantCalls===2)expect(childCalls).toBe(3);
        return response({content:'Descendant completed.'});
      }
      if(system.includes('Assigned Desktop agent: /root/managed\n')){
        childCalls++;if(childCalls===1){await rootPublished.promise;return tool('spawn-descendant','spawn_agent',{task_name:'descendant',message:'Continue independently.'});}
        if(childCalls===2){expect(body.messages.find((r:{tool_call_id?:string})=>r.tool_call_id==='spawn-descendant')?.content).not.toMatch(/^Error:/);await entered.promise;return response({content:'First child turn completed.'});}
        const child=f.store.allAgents(groupId).find(a=>a.canonicalName==='/root/managed')!,{FileSessionStore}=await import('../../../src/ai/runtime/session-store/file-store.js'),{desktopObservationSessionId}=await import('../../../src/runtime/task-host/protected-observation-store.js');
        expect((await new FileSessionStore(join(f.root,'compound-sessions')).load(desktopObservationSessionId(child.id)))?.compoundOperations?.managedTurns?.records.at(-1)).toMatchObject({generation:2,state:'active',turnId:child.turnId});
        if(scenario==='active-window'){
          const durable=await new FileSessionStore(join(f.root,'compound-sessions')).load(desktopObservationSessionId(child.id));
          const attempt=durable!.compoundOperations!.providerAttempts!.at(-1)!;
          expect(attempt.attemptIndex).toBe(0);expect(generationTwoInvocations.has(attempt.logicalInvocationId)).toBe(false);generationTwoInvocations.add(attempt.logicalInvocationId);
          if(childCalls===3)expect(descendantCalls).toBe(1);else {expect(childCalls).toBe(4);expect(JSON.stringify(body.messages)).toContain('Descendant completed.');}
          expect((await new FileSessionStore(join(f.root,'compound-sessions')).load(desktopObservationSessionId(child.id)))?.protectedObservationClosure?.observations).toHaveLength(1);
        }else expect(f.store.allAgents(groupId).find(a=>a.canonicalName==='/root/managed/descendant')).toMatchObject({status:'completed',executionActive:false,resourcesReleased:false});
        outcome.resolve('generation 2');return response({content:'Second child turn completed.'});
      }
      rootCalls++;if(rootCalls===1)return tool('spawn-managed','spawn_agent',{task_name:'managed',message:'Create a long-lived descendant.'});
      rootPublished.resolve();await vi.waitFor(()=>expect(f.store.allAgents(groupId).find(a=>a.canonicalName==='/root/managed'),JSON.stringify(f.store.allAgents(groupId).map(a=>({name:a.canonicalName,status:a.status,error:a.error})))).toMatchObject({status:scenario==='final-history-failure-shutdown'?expect.stringMatching(/^(failed|interrupted|closed)$/):finalHistoryFailure?'failed':'completed',executionActive:false}),{timeout:20000});
      if(scenario==='active-window'&&rootCalls===2)return tool('ancestor-followup','followup_task',{target:'/root/managed',message:'Continue with the descendant publication.'});
      return response({content:'Root completed.'});
      }catch(error){capturedAssertions.push(error);outcome.resolve(String(error));throw error;}
    }));cleanup.push(()=>{vi.unstubAllGlobals();});
    try{
      await f.start();
      if(scenario==='root-tail'){
        await tailEntered.promise;const previousCalls=rootCalls;
        const owner=retainedActivation!.group!.product.owner,controller=new AbortController(),cancelled=publicationProducer.waitForCompoundFinalPublication(owner,controller.signal);
        controller.abort(Error('cancel only this new waiter'));await expect(cancelled).rejects.toThrow('cancel only this new waiter');
        expect(()=>publicationProducer.bindCompoundFinalPublicationConsumer(owner,'replacement',{register:async()=>{},inspectReceipt:()=>{throw Error('not called');}})).toThrow('compound_final_consumer_already_bound');
        await f.start();
        await new Promise(resolve=>setTimeout(resolve,40));expect(rootCalls).toBe(previousCalls);expect(capturedAssertions).toEqual([]);
        tailRelease.resolve();await f.host.drain();expect(rootCalls).toBe(previousCalls+1);return;
      }
      if(scenario==='final-history-failure-shutdown'){
        await vi.waitFor(()=>expect(f.store.allAgents(f.store.getThread('t1')!.activeGroupId!).find(a=>a.canonicalName==='/root/managed')).toMatchObject({executionActive:false,status:expect.stringMatching(/^(failed|interrupted|closed)$/)}),{timeout:20000});
        const group=f.store.getThread('t1')!.activeGroupId!,child=f.store.allAgents(group).find(a=>a.canonicalName==='/root/managed')!;
        const terminalEvents=f.store.readEvents(group,0,1000).filter(event=>event.kind==='status'&&event.agentId===child.id&&['failed','interrupted','closed'].includes(String((event.payload.agent as {status?:string})?.status)));
        expect(terminalEvents.length).toBeGreaterThan(0);
        for(const event of terminalEvents){const agent=event.payload.agent as {error?:string;lastResult?:string;resultSummary?:string};expect(agent.error).toBeUndefined();expect(agent.lastResult).toBeUndefined();expect(agent.resultSummary).toBeUndefined();}
        return;
      }
      await f.host.drain();expect(rootCalls).toBeGreaterThanOrEqual(2);
      if(scenario==='success')expect(finalPublication.mock.calls.length,JSON.stringify(f.store.allAgents(f.store.getThread('t1')!.activeGroupId!).map(a=>({name:a.canonicalName,status:a.status,error:a.error})))).toBeGreaterThan(0);
      if(scenario==='active-window'){expect(await outcome.promise).toBe('generation 2');await vi.waitFor(()=>expect(descendantCalls).toBe(2),{timeout:10000});expect(childCalls).toBeGreaterThanOrEqual(3);expect(childCalls).toBeLessThanOrEqual(4);return;}
      expect(childCalls).toBe(2);expect(descendantCalls).toBe(1);
      if(finalHistoryFailure){
        const {FileSessionStore}=await import('../../../src/ai/runtime/session-store/file-store.js'),{desktopObservationSessionId}=await import('../../../src/runtime/task-host/protected-observation-store.js');
        const child=f.store.allAgents(f.store.getThread('t1')!.activeGroupId!).find(a=>a.canonicalName==='/root/managed')!,snapshot=await new FileSessionStore(join(f.root,'compound-sessions')).load(desktopObservationSessionId(child.id));
        expect(child.status).toBe('failed');expect(JSON.stringify(snapshot?.messages)).not.toContain('First child turn completed.');
        expect(child).toMatchObject({bodyUnavailable:true});expect(child.lastResult).toBeUndefined();
        const originalStatusEvents=f.store.readEvents(f.store.getThread('t1')!.activeGroupId!,0,1000).filter(event=>event.kind==='status'&&event.agentId===child.id);
        expect(JSON.stringify(originalStatusEvents)).not.toContain('actual final assistant history save failed');
        expect(JSON.stringify(originalStatusEvents)).not.toContain('First child turn completed.');
        const failedGroup=f.store.getThread('t1')!.activeGroupId!,messages=f.store.listMessages(failedGroup,`root_${failedGroup}`),failure=messages.find(message=>message.sender.kind==='agent'&&message.sender.agentId===child.id&&message.bodyUnavailable);
        expect(failure).toMatchObject({preview:'FINAL_CONTENT_NOT_PERSISTED',bodyUnavailable:true});
        const page=f.store.readContent(failedGroup,child.resultContentId!,0);expect(page).toMatchObject({bodyUnavailable:true,status:'failed'});expect(Buffer.from(page.base64,'base64').toString()).toBe('FINAL_CONTENT_NOT_PERSISTED');
        expect(snapshot?.compoundOperations?.providerAttempts?.every(row=>row.transportState==='drained')).toBe(true);return;
      }
      {
        const {FileSessionStore}=await import('../../../src/ai/runtime/session-store/file-store.js'),{desktopObservationSessionId}=await import('../../../src/runtime/task-host/protected-observation-store.js');
        const child=f.store.allAgents(f.store.getThread('t1')!.activeGroupId!).find(a=>a.canonicalName==='/root/managed')!;
        expect(JSON.stringify((await new FileSessionStore(join(f.root,'compound-sessions')).load(desktopObservationSessionId(child.id)))?.messages)).toContain('First child turn completed.');
        expect(child.bodyUnavailable).not.toBe(true);expect(child.lastResult).toContain('First child turn completed.');
      }
      const groupId=f.store.getThread('t1')!.activeGroupId!,child=f.store.allAgents(groupId).find(a=>a.canonicalName==='/root/managed')!,access=f.service.createUserAccess({requestSource:'user',actorId:'actual-user',threadId:'t1',profileId:'p1',workspaceId:'w1'});
      expect(await f.service.userFollowup({access,requestSource:'user',groupId,agentId:child.id,operationId:'actual-user-ancestor-followup',expectedTurn:child.turn,message:'Continue while your descendant remains active.'})).toMatchObject({state:'queued_next_admission',expectedTurn:2});
      expect(childCalls).toBe(2);release.resolve();
      const actual=await outcome.promise;
      if(scenario==='success'){expect(actual).toBe('generation 2');expect(childCalls).toBe(3);}
      else{expect(actual).toMatch(scenario==='unpublished-ack'?/compound_tree_branch_unpublished/:/compound_followup_old_turn_not_drained/);expect(childCalls).toBe(2);}
      expect(descendantCalls).toBe(1);
    }finally{rootPublished.resolve();release.resolve();}
  },120000);
});
