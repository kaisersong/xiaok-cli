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

describe('BDD: real service/core/SQLite/registry/session/root loop integration', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); });

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
    const bindings: Array<{ agentId: string; cwd: string; turnId: string }> = [];
    const capability = catalog.publish({ requestSource: 'scheduler', ownerId: 'builtin', entry: {
      definition: { name: 'inspect_binding', description: 'binding probe', inputSchema: { type: 'object', properties: {} } }, aliases: [], permission: 'safe',
      scope: { workspaceId: 'workspace', materialIds: [], permissions: ['safe'] },
      bindInvocation: authority => async () => { bindings.push({ agentId: authority.agentId, cwd: authority.cwd, turnId: authority.turnId }); return 'bound'; },
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
