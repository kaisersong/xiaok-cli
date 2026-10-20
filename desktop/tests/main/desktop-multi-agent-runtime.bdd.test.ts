// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Message, ModelAdapter } from '../../../src/types.js';
import { DesktopMultiAgentRuntime } from '../../electron/desktop-multi-agent-runtime.js';
import { DesktopMultiAgentWorktrees } from '../../electron/desktop-multi-agent-worktrees.js';
import { DesktopMultiAgentService, type DesktopAgentExecutionContext } from '../../electron/desktop-multi-agent-service.js';
import { DesktopMultiAgentStore } from '../../electron/desktop-multi-agent-store.js';
import { DesktopExecutionCoordinator } from '../../electron/desktop-execution-coordinator.js';
import { DesktopCapabilityCatalog } from '../../electron/desktop-multi-agent-capabilities.js';
import { InProcessTaskRuntimeHost } from '../../../src/runtime/task-host/task-runtime-host.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';
import { createSkillCatalog } from '../../../src/ai/skills/loader.js';
import { runDesktopToolLoop } from '../../electron/desktop-services.js';
import type { ToolExecutionContext } from '../../../src/types.js';
import { ContinuityService } from '../../electron/context-continuity/service.js';
import { TaskContinuitySource } from '../../electron/context-continuity/task-source.js';
import { createContextResolverTool } from '../../electron/context-continuity/tool.js';
import type { TaskSnapshot } from '../../shared/task-types.js';

describe('BDD: real service/core/SQLite/registry/session/root loop integration', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); });

  it('opens a distinct child invocation at the actual service turn and retains physical settlement while its close awaits',async()=>{
    const root=mkdtempSync(join(tmpdir(),'xiaok-child-invocation-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true,maxRetries:3}));
    const store=new DesktopMultiAgentStore(join(root,'groups.sqlite'));cleanup.push(()=>store.close());const coordinator=new DesktopExecutionCoordinator();let runtime!:DesktopMultiAgentRuntime;
    const service=new DesktopMultiAgentService({store,coordinator,createSession:input=>runtime.createSession(input)});cleanup.push(()=>service.dispose());runtime=new DesktopMultiAgentRuntime({service});
    service.registerThread({threadId:'thread',profileId:'profile',workspaceId:'workspace',cwd:root});const materials=new MaterialRegistry({workspaceRoot:join(root,'materials')}),catalog=new DesktopCapabilityCatalog(),skillCatalog=createSkillCatalog(undefined,root);
    let release!:()=>void;const closing=new Promise<void>(r=>release=r);let turns=0,childId='',rootTask='';const closed=vi.fn(()=>closing),childStream=vi.fn(async function*(){yield {type:'text' as const,delta:'INDEPENDENT_CHILD'};yield {type:'done' as const};});
    const openChildInvocation=vi.fn(async(context:DesktopAgentExecutionContext,signal:AbortSignal)=>{expect(context.sourceTaskId).toBe(rootTask);expect(context.agentId).not.toBe(rootTask);expect(signal.aborted).toBe(false);return {adapter:{stream:childStream,getModelName:()=> 'separate child'},closeAndDrain:closed};});
    const adapter={async *stream(messages:Message[],_tools:unknown,system:string){if(system.includes('Assigned Desktop agent:'))throw new Error('stateful parent adapter reached by child');if(++turns===1)yield {type:'tool_use' as const,id:'spawn',name:'spawn_agent',input:{task_name:'child',message:'bounded child'}};else if(turns===2){const result=messages.flatMap(m=>m.content).find(b=>b.type==='tool_result'&&b.tool_use_id==='spawn');if(result?.type!=='tool_result')throw new Error('missing original spawn');childId=JSON.parse(String(result.content)).targetAgentId;yield {type:'tool_use' as const,id:'wait',name:'wait_agent',input:{targets:[childId],timeout_ms:1000}};}else yield {type:'text' as const,delta:'ROOT_DONE'};}};
    const settled=vi.fn(),host=new InProcessTaskRuntimeHost({materialRegistry:materials,snapshotStore:new FileTaskSnapshotStore(join(root,'tasks')),authorizePreparation:(id,marker)=>service.assertHostPreparation(id,marker),assertTaskAdmission:snapshot=>service.assertHostAdmission(snapshot),onExecutionSettled:settled,runner:input=>service.runRoot(input,async context=>{
      rootTask=input.taskId;const scope=runtime.bindRoot(context,{adapter,openChildInvocation,catalog,policy:catalog.snapshotPolicy(),workspaceId:'workspace',materialIds:[],registryOptions:{autoMode:true},materials:[],materialRegistry:materials,skillCatalog,dataRoot:root,systemPrompt:'root',agents:[],emitRuntimeEvent:input.emitRuntimeEvent} as any);
      try{const result=await runDesktopToolLoop({adapter,registry:scope.registry,systemPrompt:'root',allToolDefs:scope.registry.getToolDefinitions(),messages:[{role:'user',content:[{type:'text',text:'root work'}]}],signal:context.signal,taskDeadline:context.effectiveDeadline,sessionId:input.sessionId,turnId:context.turnId,intentId:'intent',stepId:'step',taskId:input.taskId,cwd:root,dataRoot:root,taskStartTime:Date.now(),materials:[],materialRegistry:materials,skillCatalog,skillInvocation:null,emitRuntimeEvent:input.emitRuntimeEvent,mailbox:context.mailbox,maxIterations:8,strategies:{compact:{enabled:false,shouldCompact:()=>false,doCompact:async()=>{}},buildApiView:m=>m,processToolResult:r=>r,trackAutoProgress:false,trackReferenceReads:false,emitSkillArtifactTrace:false}});await input.emitRuntimeEvent({type:'receipt_emitted',sessionId:input.sessionId,turnId:context.turnId,intentId:'intent',stepId:'step',note:result.reply});}finally{scope.dispose();}
    })});
    await service.initialize(host);try{const task=await service.prepareRoot(host,'thread',{prompt:'run',materials:[]});await host.startTask(task.taskId);await vi.waitFor(()=>expect(closed).toHaveBeenCalledOnce());expect(childStream).toHaveBeenCalledOnce();expect(openChildInvocation).toHaveBeenCalledOnce();expect(settled).not.toHaveBeenCalled();}finally{release();await host.drain();}
    expect(settled).toHaveBeenCalledOnce();expect(store.readEvents(store.getRootBinding(rootTask)!.groupId).filter(event=>event.kind==='output'&&event.agentId===childId).map(event=>event.payload.text)).toEqual(['INDEPENDENT_CHILD']);
  });

  it.each(['none', 'worktree', 'worktree_dirty'] as const)('A1/A3/A8/A18/A26 Given a scoped Desktop root with %s isolation, When its real model loop spawns a child, Then both exchange durable messages and execute with independently bound registries', async scenario => {
    const isolation = scenario === 'none' ? 'none' : 'worktree';
    const root = mkdtempSync(join(tmpdir(), 'xiaok-multi-runtime-'));
    cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
    const store = new DesktopMultiAgentStore(join(root, 'groups.sqlite')); cleanup.push(() => store.close());
    if (isolation === 'worktree') {
      execFileSync('git', ['init'], { cwd: root, stdio: 'pipe' });
      execFileSync('git', ['-c', 'user.name=BDD', '-c', 'user.email=bdd@example.invalid', 'commit', '--allow-empty', '-m', 'fixture'], { cwd: root, stdio: 'pipe' });
    }
    const coordinator = new DesktopExecutionCoordinator();
    let runtime!: DesktopMultiAgentRuntime;
    const worktrees = new DesktopMultiAgentWorktrees({ store });
    const service = new DesktopMultiAgentService({ store, coordinator, worktrees, createSession: input => runtime.createSession(input) });
    cleanup.push(() => service.dispose());
    runtime = new DesktopMultiAgentRuntime({ service, worktrees });
    service.registerThread({ threadId: 'thread', profileId: 'profile', workspaceId: 'workspace', cwd: root });
    const materialRegistry = new MaterialRegistry({ workspaceRoot: join(root, 'materials'), maxBytes: 1024 * 1024 });
    const catalog = new DesktopCapabilityCatalog();
    const bindings: Array<{ agentId: string; cwd: string; turnId: string; readerTaskId?:string }> = [];
    const capability = catalog.publish({ requestSource: 'scheduler', ownerId: 'builtin', entry: {
      definition: { name: 'inspect_binding', description: 'binding probe', inputSchema: { type: 'object', properties: {} } }, aliases: [], permission: 'safe',
      scope: { workspaceId: 'workspace', materialIds: [], permissions: ['safe'] },
      bindInvocation: authority => async (_input,context) => { bindings.push({ agentId: authority.agentId, cwd: authority.cwd, turnId: authority.turnId,readerTaskId:context?.contextReaderTaskId }); return 'bound'; },
    } });
    catalog.authorize({ requestSource: 'user', capabilityId: capability.capabilityId });
    const requests: Array<{ child: boolean; messages: Message[]; tools: string[] }> = [];
    let rootCalls = 0; let childCalls = 0; let groupId = ''; let rootId = ''; let childId = '';
    const adapter: Pick<ModelAdapter, 'stream'> = { async *stream(messages, tools, system) {
      const child = system?.includes('Assigned Desktop agent:') ?? false;
      requests.push({ child, messages: structuredClone(messages), tools: tools.map(tool => tool.name) });
      if (child) {
        if (++childCalls === 1) {
          yield { type: 'tool_use', id: 'child-message', name: 'send_message', input: { target: 'main', message: 'CHILD_PROGRESS_SENTINEL' } };
          yield { type: 'tool_use', id: 'child-probe', name: 'inspect_binding', input: {} };
        } else {
          yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 2 } };
          yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 2 } };
          yield { type: 'text', delta: 'CHILD_RESULT_SENTINEL' };
        }
      } else if (++rootCalls === 1) {
        yield { type: 'tool_use', id: 'root-spawn', name: 'spawn_agent', input: { task_name: 'review', message: 'CHILD_TASK_SENTINEL', isolation,
          ...(scenario === 'worktree_dirty' ? { agent: 'delete-preset' } : {}) } };
      } else if (rootCalls === 2) {
        const result = messages.flatMap(message => message.content).find(block => block.type === 'tool_result' && block.tool_use_id === 'root-spawn');
        if (result?.type !== 'tool_result') throw new Error('spawn did not return real result');
        childId = JSON.parse(String(result.content)).targetAgentId;
        yield { type: 'tool_use', id: 'root-wait', name: 'wait_agent', input: { targets: [childId], timeout_ms: 1000 } };
        yield { type: 'tool_use', id: 'root-probe', name: 'inspect_binding', input: {} };
      } else yield { type: 'text', delta: 'ROOT_DONE' };
    } };
    const errors: unknown[] = [];
    const host = new InProcessTaskRuntimeHost({ snapshotStore: new FileTaskSnapshotStore(join(root, 'tasks')), materialRegistry,
      authorizePreparation: (taskId, marker) => service.assertHostPreparation(taskId, marker),
      assertTaskAdmission: snapshot => service.assertHostAdmission(snapshot),
      decideCancellation: (snapshot, reason) => service.decideHostCancellation(snapshot, reason),
      getExecutionPolicy: () => ({ deliveryRepair: 'explicit' }),
      runner: input => service.runRoot(input, async context => {
        groupId = context.groupId; rootId = context.agentId;
        const skillCatalog = createSkillCatalog(undefined, root);
        const scope = runtime.bindRoot(context, { adapter, catalog, policy: catalog.snapshotPolicy(), workspaceId: 'workspace', materialIds: [],
          permissionRevision: 0, registryOptions: { autoMode: true }, materials: [], materialRegistry, skillCatalog, dataRoot: root,
          systemPrompt: 'Root system', agents: [{ name: 'delete-preset', systemPrompt: 'Review', isolation: 'worktree', cleanup: 'delete' }],
          emitRuntimeEvent: input.emitRuntimeEvent, onUsage: () => {}, maxIterations: 8,
        });
        try {
          const result = await runDesktopToolLoop({ adapter, registry: scope.registry, systemPrompt: 'Root system',
            allToolDefs: scope.registry.getToolDefinitions(), messages: [{ role: 'user', content: [{ type: 'text', text: 'ROOT_CONTEXT_SENTINEL' }] }],
            signal: context.signal, taskDeadline: context.effectiveDeadline, sessionId: input.sessionId, turnId: context.turnId, intentId: 'intent', stepId: 'step', taskId: input.taskId,
            cwd: root, dataRoot: root, taskStartTime: Date.now(), materials: [], materialRegistry, skillCatalog, skillInvocation: null,
            emitRuntimeEvent: input.emitRuntimeEvent, mailbox: context.mailbox, maxIterations: 8,
            strategies: { compact: { enabled: false, shouldCompact: () => false, doCompact: async () => {} }, buildApiView: messages => messages,
              processToolResult: result => result, trackAutoProgress: false, trackReferenceReads: false, emitSkillArtifactTrace: false },
          });
          await input.emitRuntimeEvent({ type: 'receipt_emitted', sessionId: input.sessionId, turnId: context.turnId, intentId: 'intent', stepId: 'step', note: result.reply });
        } catch (error) { errors.push(error); throw error; } finally { scope.dispose(); }
      }),
    });
    await service.initialize(host);
    const prepared = await service.prepareRoot(host, 'thread', { prompt: 'run', materials: [] });
    await host.startTask(prepared.taskId); await host.drain();
    expect(errors).toEqual([]);
    await vi.waitFor(() => expect(coordinator.snapshot().active).toBe(0));
    expect(childCalls).toBe(2);
    expect(requests.filter(request => request.child)).toHaveLength(2);
    expect(JSON.stringify(requests.find(request => request.child)?.messages)).toContain('ROOT_CONTEXT_SENTINEL');
    expect(JSON.stringify(requests.find(request => request.child)?.messages)).not.toContain('root-spawn');
    expect(bindings.map(binding => binding.agentId).sort()).toEqual([rootId, childId].sort());
    expect(bindings.every(binding=>binding.readerTaskId===prepared.taskId)).toBe(true);
    expect(bindings.find(binding => binding.agentId === rootId)?.cwd).toBe(root);
    if (isolation === 'worktree') expect(bindings.find(binding => binding.agentId === childId)?.cwd).toBe(store.resources(groupId)[0]?.canonicalPath);
    else expect(bindings.every(binding => binding.cwd === root)).toBe(true);
    expect(store.getAgent(groupId, childId)).toMatchObject({ status: 'completed', executionActive: false, sessionResident: true });
    expect(store.listMessages(groupId, rootId).map(message => message.preview)).toContain('CHILD_PROGRESS_SENTINEL');
    expect(store.listMessages(groupId, rootId).map(message => message.preview)).toContain('CHILD_RESULT_SENTINEL');
    expect(store.readEvents(groupId).filter(event => event.kind === 'output' && event.agentId === childId).map(event => event.payload.text)).toEqual(['CHILD_RESULT_SENTINEL']);
    expect(store.getAgent(groupId, childId)?.usage).toEqual({ inputTokens: 10, outputTokens: 2 });
    expect(JSON.stringify(requests.filter(request => !request.child).at(-1)?.messages)).toContain('CHILD_PROGRESS_SENTINEL');
    if (scenario === 'worktree_dirty') {
      const resource = store.resources(groupId)[0]!;
      writeFileSync(join(resource.canonicalPath, 'user-result.txt'), 'PRESERVE_USER_BYTES');
      const access = service.createUserAccess({ requestSource: 'user', actorId: 'user', threadId: 'thread', profileId: 'profile', workspaceId: 'workspace' });
      await service.userClose({ access, requestSource: 'user', groupId, agentId: childId, expectedTurn: 1, operationId: 'close-dirty' });
      await vi.waitFor(() => expect(service.runtimeStatus().residentSlots).toBe(0));
      expect(store.getAgent(groupId, childId)).toMatchObject({ status: 'closed', sessionResident: false, executionActive: false,
        runtimeResident: false, resourcesReleased: false, cleanupPending: true });
      expect(store.resources(groupId)[0]).toMatchObject({ state: 'cleanup_pending' });
      expect(store.getOperation(groupId, 'close-dirty')?.result.state).toBe('cleanup_pending');
      expect(existsSync(resource.canonicalPath)).toBe(true);
      await expect(service.resolveResource({ access, requestSource: 'agent', groupId, resourceId: resource.resourceId, action: 'keep', operationId: 'forged' })).rejects.toThrow(/source/);
      await expect(service.resolveResource({ access, requestSource: 'user', groupId, resourceId: 'foreign', action: 'keep', operationId: 'foreign' })).rejects.toThrow(/unknown/);
      const cleanupRequest = { access, requestSource: 'user' as const, groupId, resourceId: resource.resourceId, action: 'retryCleanup' as const, operationId: 'cleanup-journal-fails' };
      const resourceWrite = store.putResource.bind(store);
      const journalFault = vi.spyOn(store, 'putResource').mockImplementation((record, control) => {
        if (record.state === 'cleanup_pending') throw new Error('SQLITE_FULL'); return resourceWrite(record, control);
      });
      try { expect(await service.resolveResource(cleanupRequest)).toMatchObject({ state: 'unknown' }); } finally { journalFault.mockRestore(); }
      expect(await service.resolveResource(cleanupRequest)).toMatchObject({ state: 'unknown' });
      const request = { access, requestSource: 'user' as const, groupId, resourceId: resource.resourceId, action: 'keep' as const, operationId: 'keep-ack-fails' };
      const original = store.putOperation.bind(store);
      const fault = vi.spyOn(store, 'putOperation').mockImplementation((operation, control) => {
        if (operation.operationId === request.operationId && operation.result.state === 'completed') throw new Error('SQLITE_FULL');
        return original(operation, control);
      });
      try { expect(await service.resolveResource(request)).toMatchObject({ state: 'unknown' }); } finally { fault.mockRestore(); }
      expect(await service.resolveResource(request)).toMatchObject({ state: 'unknown' });
      const resolved = await service.resolveResource({ access, requestSource: 'user', groupId, resourceId: resource.resourceId, action: 'keep', operationId: 'keep-dirty' });
      expect(resolved.state).toBe('completed');
      expect(readFileSync(join(resource.canonicalPath, 'user-result.txt'), 'utf8')).toBe('PRESERVE_USER_BYTES');
      expect(store.getAgent(groupId, childId)).toMatchObject({ resourcesReleased: true, cleanupPending: false, resumable: false });
      expect(store.getOperation(groupId, 'close-dirty')?.result.state).toBe('completed');
      expect(store.getOperation(groupId, 'keep-dirty')?.applyState).toBe('applied');
    }
  });

  it('A13 Given no registered parent runtime, When a forged seed requests a child, Then it is rejected before any side effects', async () => {
    const runtime = new DesktopMultiAgentRuntime({ service: {} as DesktopMultiAgentService });
    await expect(runtime.createSession({ groupId: 'g', parent: { actor: {} } as DesktopAgentExecutionContext,
      identity: {} as never, signal: new AbortController().signal, getTurnContext: () => ({} as DesktopAgentExecutionContext), sessionSeed: { seedId: 'forged' },
    })).rejects.toThrow(/seed|authority|runtime/);
  });

  it('blocks a retained real child from adding a reference after its settled root is frozen by native admission',async()=>{
    const root=mkdtempSync(join(tmpdir(),'continuity-retained-child-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));
    const continuity=new ContinuityService({dbPath:join(root,'continuity.sqlite'),profileId:'profile'});cleanup.push(()=>continuity.close());
    const actor={requestSource:'user' as const,profileId:'profile',actorId:'desktop-user:profile'},projection=new TaskContinuitySource(continuity,actor);
    const target=continuity.createConversation(actor,{operationId:'target'}),source=continuity.createConversation(actor,{operationId:'source'});
    continuity.recordMessage(actor,{conversationId:source.id,sourceKind:'desktop_task',sourceId:'task_private',sourceDataEpoch:'epoch',sourceMessageId:'answer',sourceRevision:1,role:'assistant',text:'PRIVATE_LATE_CHILD_CANARY',executionState:'settled'});
    const ref=continuity.createReference(actor,{conversationId:source.id,expectedRevision:continuity.getConversation(actor,source.id)!.revision,operationId:'reference'});
    continuity.attachReference(actor,{refId:ref.refId,targetConversationId:target.id,operationId:'grant'});
    const store=new DesktopMultiAgentStore(join(root,'groups.sqlite'));cleanup.push(()=>store.close());
    let runtime!:DesktopMultiAgentRuntime;
    const service=new DesktopMultiAgentService({store,coordinator:new DesktopExecutionCoordinator(),createSession:input=>runtime.createSession(input)});cleanup.push(()=>service.dispose());
    runtime=new DesktopMultiAgentRuntime({service});service.registerThread({threadId:target.id,profileId:'profile',workspaceId:'workspace',cwd:root});
    const catalog=new DesktopCapabilityCatalog(),resolver=createContextResolverTool(()=>({service:continuity,actor}));
    const capability=catalog.publish({requestSource:'scheduler',ownerId:'fixture',entry:{definition:resolver.definition,aliases:[],permission:'safe',scope:{workspaceId:'workspace',materialIds:[],permissions:['safe']},bindInvocation:()=>resolver.execute.bind(resolver)}});
    catalog.authorize({requestSource:'user',capabilityId:capability.capabilityId});
    let release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve;});cleanup.push(()=>release());
    let childEntered=false,rootCalls=0,childCalls=0,groupId='',result='';
    const adapter:Pick<ModelAdapter,'stream'>={async *stream(messages,_tools,system){
      if(system?.includes('Assigned Desktop agent:')){
        if(++childCalls===1){childEntered=true;await barrier;yield {type:'tool_use',id:'late-ref',name:'resolve_context_reference',input:{refId:ref.refId}};}
        else{result=JSON.stringify(messages);yield {type:'text',delta:'child done'};}
      }else if(++rootCalls===1)yield {type:'tool_use',id:'spawn',name:'spawn_agent',input:{task_name:'late',message:'wait'}};
      else yield {type:'text',delta:'root done'};
    }};
    const materialRegistry=new MaterialRegistry({workspaceRoot:join(root,'materials'),maxBytes:1024*1024});
    const host=new InProcessTaskRuntimeHost({snapshotStore:new FileTaskSnapshotStore(join(root,'tasks')),materialRegistry,
      authorizePreparation:(id,marker)=>service.assertHostPreparation(id,marker),assertTaskAdmission:s=>service.assertHostAdmission(s),
      onExecutionSettled:s=>{projection.capture(s,{physicallySettled:true});},
      runner:input=>service.runRoot(input,async context=>{
        groupId=context.groupId;const skillCatalog=createSkillCatalog(undefined,root);
        const scope=runtime.bindRoot(context,{adapter,catalog,policy:catalog.snapshotPolicy(),workspaceId:'workspace',materialIds:[],registryOptions:{autoMode:true},materials:[],materialRegistry,skillCatalog,dataRoot:root,systemPrompt:'Root system',agents:[],emitRuntimeEvent:input.emitRuntimeEvent});
        try{await runDesktopToolLoop({adapter,registry:scope.registry,systemPrompt:'Root system',allToolDefs:scope.registry.getToolDefinitions(),messages:[{role:'user',content:[{type:'text',text:'work'}]}],signal:context.signal,taskDeadline:context.effectiveDeadline,sessionId:input.sessionId,turnId:context.turnId,intentId:'intent',stepId:'step',taskId:input.taskId,cwd:root,dataRoot:root,taskStartTime:Date.now(),materials:[],materialRegistry,skillCatalog,skillInvocation:null,emitRuntimeEvent:input.emitRuntimeEvent,maxIterations:4,strategies:{compact:{enabled:false,shouldCompact:()=>false,doCompact:async()=>{}},buildApiView:messages=>messages,processToolResult:r=>r,trackAutoProgress:false,trackReferenceReads:false,emitSkillArtifactTrace:false}});}finally{scope.dispose();}
      })});
    await service.initialize(host);const prepared=await service.prepareRoot(host,target.id,{prompt:'work',materials:[],context:{threadId:target.id}});
    await projection.bindPrepared({conversationId:target.id,taskId:prepared.taskId,publicPrompt:'work'},()=>host.inspectTask(prepared.taskId));
    await host.startTask(prepared.taskId);await host.drain();await vi.waitFor(()=>expect(childEntered).toBe(true));
    expect(store.getAgent(groupId,`root_${groupId}`)?.sourceTaskId).toBe(prepared.taskId);
    const native={taskId:'task_native',sessionId:'native_epoch',prompt:'next',status:'running',context:{threadId:target.id},events:[],createdAt:1,updatedAt:2,materials:[]} as TaskSnapshot;
    await projection.bindPrepared({conversationId:target.id,taskId:native.taskId,publicPrompt:'next',sourceKind:'native_codex'},async()=>native);
    continuity.acquireNativeContext(actor,native.taskId,[prepared.taskId]);release();
    await vi.waitFor(()=>expect(result).toContain('Error: not_readable'));
    expect(result).not.toContain('PRIVATE_LATE_CHILD_CANARY');
    expect(continuity.store.db.prepare('SELECT * FROM context_dependencies').all()).toEqual([]);
    await vi.waitFor(()=>expect(store.allAgents(groupId).filter(a=>a.parentId).every(a=>!a.executionActive)).toBe(true));
  });

  it.each(['root', 'current'])('inherits root and current-turn context fences through the actual child seed (%s)', async mode => {
    const root = mkdtempSync(join(tmpdir(), 'continuity-child-fence-')); let valid = true, calls = 0;
    const spawn = vi.fn(async () => ({ state: 'applied' }));
    // Contract spy for inherited source fences; actual sealed actor ownership is covered by the real service tests.
    const service = { spawn, assertInvocation: () => {}, assertResultCurrent: () => {}, getApprovalDeadline: () => Date.now() + 30_000, recordRuntimeEvent: async () => {}, recordToolFinished: async () => {} } as unknown as DesktopMultiAgentService;
    const runtime = new DesktopMultiAgentRuntime({ service }), catalog = new DesktopCapabilityCatalog();
    const actor = Object.freeze({ groupId: 'group', agentId: 'root', turnId: 'turn' });
    const context = { ...actor, actor, turn: 1, permissionRevision: 0, signal: new AbortController().signal, effectiveDeadline: Date.now() + 30_000, cwd: root } as DesktopAgentExecutionContext;
    const probe = catalog.publish({ requestSource: 'scheduler', ownerId: 'fixture', entry: { definition: { name: 'probe', description: 'fixture', inputSchema: { type: 'object', properties: {} } }, aliases: [], permission: 'safe', scope: { workspaceId: 'workspace', materialIds: [], permissions: ['safe'] }, bindInvocation: () => async () => { valid = false; return 'done'; } } });
    catalog.authorize({ requestSource: 'user', capabilityId: probe.capabilityId });
    const scope = runtime.bindRoot(context, { authorizeContext: () => { if (mode === 'root' && !valid) throw new Error('context_revoked'); }, authorizeTaskSource: source => { if (mode === 'current' && source === 'task_B' && !valid) throw new Error('context_revoked'); }, catalog, policy: catalog.snapshotPolicy(), adapter: { async *stream() { calls++; if (calls === 1) yield { type: 'tool_use', id: 'probe', name: 'probe', input: {} }; else yield { type: 'text', delta: 'leaked child context' }; } }, systemPrompt: '', workspaceId: 'workspace', materialIds: [], registryOptions: { autoMode: true }, materials: [], dataRoot: root, skillCatalog: createSkillCatalog(undefined, root), agents: [], emitRuntimeEvent: async () => {} });
    let child: Awaited<ReturnType<typeof runtime.createSession>> | undefined;
    try {
      await scope.registry.executeTool('spawn_agent', { task_name: 'child', message: 'work' }, { messages: [{ role: 'user', content: [{ type: 'text', text: 'PRIVATE_ROOT_CANARY' }] }] } as ToolExecutionContext);
      const seed = (spawn.mock.calls as unknown as Array<[{ sessionSeed: { seedId: string } }]>)[0][0].sessionSeed;
      const childActor = Object.freeze({ groupId: 'group', agentId: 'child', turnId: 'child-turn' });
      child = await runtime.createSession({ groupId: 'group', identity: { id: 'child', canonicalName: 'child' } as never, parent: context, signal: context.signal, sessionSeed: seed, getTurnContext: () => ({ ...context, ...childActor, actor: childActor, sourceTaskId: 'task_B' } as DesktopAgentExecutionContext) });
      await expect(child.run('work')).rejects.toThrow('context_revoked'); expect(calls).toBe(1);
    } finally { await child?.dispose(); scope.dispose(); rmSync(root, { recursive: true, force: true }); }
  });

  it('A14 contract Given a retried tool invocation, When the real runtime captures its seed again, Then it retains its operation fingerprint rather than conflicting on a fresh random seed ID', async () => {
    const spawn = vi.fn(async () => ({ state: 'applied' }));
    // Contract spy only: the production service/core execution is covered above.
    const runtime = new DesktopMultiAgentRuntime({ service: { spawn, assertInvocation: () => {}, getApprovalDeadline: () => Date.now() + 30_000 } as unknown as DesktopMultiAgentService });
    const actor = Object.freeze({ groupId: 'group', agentId: 'root', turnId: 'turn' });
    const context = { ...actor, actor, permissionRevision: 0, signal: new AbortController().signal, effectiveDeadline: Date.now() + 30_000, cwd: process.cwd() } as DesktopAgentExecutionContext;
    const catalog = new DesktopCapabilityCatalog();
    const scope = runtime.bindRoot(context, { catalog, policy: catalog.snapshotPolicy(), adapter: { stream: vi.fn() },
      systemPrompt: 'system', workspaceId: 'workspace', materialIds: [], permissionRevision: 0, registryOptions: { autoMode: true },
      materials: [], dataRoot: process.cwd(), skillCatalog: createSkillCatalog(undefined, process.cwd()), agents: [], emitRuntimeEvent: vi.fn(),
    });
    try {
      const toolContext = { toolInvocationId: 'same-call', messages: [] } as unknown as ToolExecutionContext;
      const input = { task_name: 'child', message: 'work' };
      await scope.registry.executeTool('spawn_agent', input, toolContext);
      await scope.registry.executeTool('spawn_agent', input, toolContext);
      expect(spawn).toHaveBeenCalledTimes(2);
      const calls = spawn.mock.calls as unknown as Array<[{ operationId: string; sessionSeed: { seedId: string } }]>;
      expect(calls[1][0].sessionSeed.seedId).toBe(calls[0][0].sessionSeed.seedId);
      expect(calls[1][0].operationId).toBe(calls[0][0].operationId);
    } finally { scope.dispose(); }
  });
});
