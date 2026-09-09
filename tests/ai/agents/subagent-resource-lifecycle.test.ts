import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { createNamedSubAgentSession, executeNamedSubAgent } from '../../../src/ai/agents/subagent-executor.js';
import { createMultiAgentCoordinator } from '../../../src/ai/agents/multi-agent-coordinator.js';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import type { WorktreeManager } from '../../../src/platform/worktrees/manager.js';
import type { ModelAdapter } from '../../../src/types.js';

function fixture(cleanup: 'keep' | 'delete' = 'delete') {
  const path = join(tmpdir(), 'xiaok-resource-lifecycle', 'review-agent');
  const manager = {
    allocate: vi.fn(async (input) => ({ ...input, path, created: true })),
    release: vi.fn(async () => {}),
  } as unknown as WorktreeManager;
  const registry = new ToolRegistry({}, []);
  const releaseRegistry = vi.fn(() => registry.dispose());
  const adapter: ModelAdapter = { getModelName: () => 'fixture', async *stream() { yield { type: 'text', delta: 'done' }; yield { type: 'done' }; } };
  return { path, manager, registry, options: {
    agentDef: { name: 'review', source: 'builtin' as const, systemPrompt: '', isolation: 'worktree' as const, cleanup },
    sessionId: 'parent', runtimeAgentId: 'child/id', worktreeManager: manager,
    adapter: () => adapter, createRegistry: vi.fn(() => registry), releaseRegistry,
    buildSystemPrompt: vi.fn(async () => 'test'),
  } };
}

describe('production subagent resource lifecycle', () => {
  it.each(['keep', 'delete'] as const)('allocates a unique child worktree and honors %s on one-shot cleanup', async (cleanup) => {
    const { options, manager, path } = fixture(cleanup);
    expect(await executeNamedSubAgent({ ...options, prompt: 'hello' })).toBe('done');
    expect(manager.allocate).toHaveBeenCalledWith({ owner: 'review', taskId: 'child/id', branch: 'review-child-id', cleanup });
    expect(options.createRegistry).toHaveBeenCalledWith(path, undefined, 'child/id', { parentDepth: undefined });
    expect(options.releaseRegistry).toHaveBeenCalledOnce();
    expect(manager.release).toHaveBeenCalledTimes(cleanup === 'delete' ? 1 : 0);
    if (cleanup === 'delete') expect(manager.release).toHaveBeenCalledWith(path);
  });

  it('cleans an allocated worktree when initialization fails before registry creation', async () => {
    const { options, manager, path } = fixture();
    options.buildSystemPrompt.mockRejectedValue(new Error('prompt failed'));
    await expect(createNamedSubAgentSession(options)).rejects.toThrow('prompt failed');
    expect(options.createRegistry).not.toHaveBeenCalled();
    expect(manager.release).toHaveBeenCalledWith(path);
  });

  it('disposes the real one-shot session when the provider run fails', async () => {
    const { options, manager, registry, path } = fixture();
    options.adapter = () => ({ async *stream() { throw new Error('provider run failed'); } });
    await expect(executeNamedSubAgent({ ...options, prompt: 'fail in run' })).rejects.toThrow('provider run failed');
    expect(options.releaseRegistry).toHaveBeenCalledExactlyOnceWith(registry);
    expect(registry.getToolDefinitions()).toEqual([]);
    expect(manager.release).toHaveBeenCalledExactlyOnceWith(path);
  });

  it.each(['signal', 'forkContext'] as const)('preserves one-shot cancellation from %s and disposes before rejecting', async (source) => {
    const { options, manager, registry } = fixture();
    const controller = new AbortController();
    let actualSignal: AbortSignal | undefined;
    options.adapter = () => ({ async *stream(_messages, _tools, _prompt, streamOptions) {
      actualSignal = streamOptions?.signal;
      await new Promise<void>((_resolve, reject) => actualSignal?.addEventListener('abort', () => reject(actualSignal?.reason), { once: true }));
    } });
    const cancellation = source === 'signal' ? { signal: controller.signal } : { forkContext: { signal: controller.signal } };
    const running = executeNamedSubAgent({ ...options, ...cancellation, prompt: 'wait for cancellation' });
    const rejected = expect(running).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(actualSignal).toBeDefined());
    controller.abort();
    await rejected;
    expect(actualSignal?.aborted).toBe(true);
    expect(options.releaseRegistry).toHaveBeenCalledExactlyOnceWith(registry);
    expect(manager.release).toHaveBeenCalledOnce();
  });

  it('rejects deactivated/disposed runs and releases resources exactly once', async () => {
    const { options, manager } = fixture();
    const session = await createNamedSubAgentSession(options);
    await session.deactivate();
    await expect(session.run('must not run')).rejects.toThrow(/deactivated|disposed/);
    await Promise.all([session.dispose(), session.dispose()]);
    await expect(session.run('must not run')).rejects.toThrow('disposed');
    expect(options.releaseRegistry).toHaveBeenCalledOnce();
    expect(manager.release).toHaveBeenCalledOnce();
  });

  it('surfaces worktree release failure without claiming successful disposal', async () => {
    const { options, manager } = fixture();
    vi.mocked(manager.release).mockRejectedValue(new Error('directory busy'));
    const session = await createNamedSubAgentSession(options);
    await expect(session.dispose()).rejects.toThrow('directory busy');
    await expect(session.dispose()).rejects.toThrow('directory busy');
    expect(manager.release).toHaveBeenCalledOnce();
    expect(options.releaseRegistry).toHaveBeenCalledOnce();
  });

  it('retains a delete-policy worktree for idle followup and releases it on explicit close', async () => {
    const { options, manager } = fixture();
    const session = await createNamedSubAgentSession(options);
    await session.run('first');
    await session.suspend();
    expect(options.releaseRegistry).toHaveBeenCalledOnce();
    expect(manager.release).not.toHaveBeenCalled();
    await session.dispose();
    expect(manager.release).toHaveBeenCalledOnce();
  });

  it('releases delete worktrees only after the real Agent tool execution settles', async () => {
    let finish!: () => void;
    let started = false;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const { options, manager, path, registry } = fixture();
    registry.registerTool({permission:'safe', definition:{name:'held_tool',description:'fixture',inputSchema:{type:'object',properties:{}}},
      execute:async () => {started = true; await gate; return 'done';}});
    options.adapter = () => ({ getModelName: () => 'stubborn', async *stream() {
      yield {type:'tool_use' as const,id:'held',name:'held_tool',input:{}};
      yield { type: 'done' as const };
    } });
    const caller = { requestSource: 'agent' as const, callerId: 'main' };
    const coordinator = createMultiAgentCoordinator({ closeSettlementTimeoutMs: 5 });
    const child = await coordinator.spawn({ ...caller, taskName: 'isolated', message: 'run', createSession: () => createNamedSubAgentSession(options) });
    await vi.waitFor(() => expect(started).toBe(true));
    expect(await coordinator.closeAgent({ ...caller, target: child.id })).toMatchObject({ resourcesReleased: false, cleanupPending: true });
    expect(options.releaseRegistry).toHaveBeenCalledOnce();
    expect(manager.release).not.toHaveBeenCalled();
    finish();
    await vi.waitFor(() => expect(manager.release).toHaveBeenCalledWith(path));
    expect(await coordinator.closeAgent({ ...caller, target: child.id })).toMatchObject({ resourcesReleased: true });
    expect(manager.release).toHaveBeenCalledOnce();
    await coordinator.dispose();
  });

  it('isolates a cancelled model reader and never executes its late tool request', async () => {
    const {options, registry, manager} = fixture();
    let finish!: () => void;
    let started = false;
    const gate = new Promise<void>(resolve => {finish = resolve;});
    const execute = vi.fn(async () => 'unexpected');
    registry.registerTool({permission:'safe',definition:{name:'late_tool',description:'fixture',inputSchema:{type:'object',properties:{}}},execute});
    options.adapter = () => ({async *stream() {
      started = true; await gate;
      yield {type:'tool_use' as const,id:'late',name:'late_tool',input:{}};
      yield {type:'done' as const};
    }});
    const caller = {requestSource:'agent' as const,callerId:'main'};
    const coordinator = createMultiAgentCoordinator();
    try {
      const child = await coordinator.spawn({...caller,taskName:'late',message:'run',createSession:() => createNamedSubAgentSession(options)});
      await vi.waitFor(() => expect(started).toBe(true));
      expect(await coordinator.closeAgent({...caller,target:child.id})).toMatchObject({resourcesReleased:true});
      finish();
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(execute).not.toHaveBeenCalled();
      expect(manager.release).toHaveBeenCalledOnce();
    } finally {finish(); await coordinator.dispose();}
  });

  it('publishes actual stalled tool health while retaining the SubAgent execution owner',async()=>{
    const {options,registry}=fixture();let finish!:(s:string)=>void;
    registry.registerTool({permission:'safe',definition:{name:'stalled',description:'test',inputSchema:{}},executionPolicy:{idleTimeoutMs:50},execute:async()=>new Promise(resolve=>{finish=resolve;})});
    options.adapter=()=>({async *stream(){yield {type:'tool_use' as const,id:'held',name:'stalled',input:{}};yield {type:'done' as const};}});
    const caller={requestSource:'agent' as const,callerId:'main'};const coordinator=createMultiAgentCoordinator();
    try {
      const child=await coordinator.spawn({...caller,taskName:'health',message:'work',createSession:()=>createNamedSubAgentSession(options)});
      await vi.waitFor(()=>expect(coordinator.listAgents(caller)).toContainEqual(expect.objectContaining({id:child.id,executionHealth:'cleanup_pending',executionActive:true,resourcesReleased:false})));
      finish('exited');
      await vi.waitFor(()=>expect(coordinator.listAgents(caller).find(a=>a.id===child.id)?.executionActive).toBe(false));
    }finally{finish?.('exit');await coordinator.dispose();}
  });

  it('rejects model plus capability before Agent dispatch and cleans acquired resources', async () => {
    const { options, manager } = fixture();
    await expect(createNamedSubAgentSession({ ...options, agentDef: { ...options.agentDef, model: 'one', modelCapability: 'two' } })).rejects.toThrow('mutually exclusive');
    expect(options.releaseRegistry).toHaveBeenCalledOnce();
    expect(manager.release).toHaveBeenCalledOnce();
  });

  it.each(['before_close', 'during_close'] as const)('reports failed creation rollback %s without claiming release', async (timing) => {
    const { options, manager } = fixture();
    let failPrompt!: (error: Error) => void;
    options.buildSystemPrompt.mockImplementation(() => new Promise((_resolve, reject) => { failPrompt = reject; }));
    vi.mocked(manager.release).mockRejectedValue(new Error('rollback busy'));
    const caller = { requestSource: 'agent' as const, callerId: 'main' };
    const coordinator = createMultiAgentCoordinator();
    const child = await coordinator.spawn({ ...caller, taskName: 'init_failed', message: 'run', createSession: () => createNamedSubAgentSession(options) });
    await new Promise(setImmediate);
    const closing = timing === 'during_close' ? coordinator.closeAgent({ ...caller, target: child.id }) : undefined;
    failPrompt(new Error('prompt failed'));
    await coordinator.waitForUpdate({ ...caller, targets: [child.id], timeoutMs: 100 });
    if (!closing) expect(() => coordinator.followupTask({ ...caller, target: child.id, message: 'retry' })).toThrow('cleanup failed');
    await closing;
    expect(await coordinator.closeAgent({ ...caller, target: child.id })).toMatchObject({ resourcesReleased: false, cleanupPending: false,
      agents: [expect.objectContaining({ cleanupError: expect.stringContaining('rollback busy') })],
    });
    expect(manager.release).toHaveBeenCalledOnce();
    await coordinator.dispose();
  });
});
