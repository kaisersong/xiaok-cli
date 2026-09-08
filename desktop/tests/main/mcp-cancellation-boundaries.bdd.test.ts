// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import { buildMcpRuntimeTools } from '../../../src/ai/mcp/runtime/tools.js';
import { createSkillCatalog } from '../../../src/ai/skills/loader.js';
import { ProviderSlotDirectory } from '../../../src/platform/provider-runtime/provider-slot-directory.js';
import { componentInstanceKeyOf, type ProviderInvocationLease } from '../../../src/platform/provider-runtime/types.js';
import { createHostGatewayByName, type RendererProviderValue } from '../../electron/provider-gateways/create-host-gateways.js';
import { DesktopCapabilityCatalog } from '../../electron/desktop-multi-agent-capabilities.js';
import { DesktopMultiAgentStore } from '../../electron/desktop-multi-agent-store.js';
import { DesktopMultiAgentWorktrees } from '../../electron/desktop-multi-agent-worktrees.js';
import { runDesktopToolLoop } from '../../electron/desktop-services.js';
import { mcpTestContext } from '../../../tests/support/mcp-cancellation-context.js';
import type { Message } from '../../../src/types.js';

function barrier() { let release!: () => void; return { wait: new Promise<void>(resolve => { release = resolve; }), release: () => release() }; }
describe('R1 cancellation continuation, frozen provider source, and durable opaque boundary', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); vi.restoreAllMocks(); });
  function directory() { const root = mkdtempSync(join(tmpdir(), 'xiaok-mcp-boundaries-')); cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 })); return root; }

  it.each(['caller', 'runtime'] as const)('M6 freezes %s-first classification even if the provider returns a late success', async winner => {
    const slots = new ProviderSlotDirectory(); const provider = componentInstanceKeyOf('fixture', 'generation-1');
    const entered = barrier(); const held = barrier(); const controller = new AbortController(); let lease!: ProviderInvocationLease<RendererProviderValue>;
    slots.prepare({ capabilityKey: 'mcp:report-renderer', provider, resourceMode: 'invocation-scoped', value: { call: async () => { entered.release(); await held.wait; return 'late success'; } } });
    slots.commit('mcp:report-renderer', provider);
    const tool = createHostGatewayByName('mcp__report-renderer__list_themes', {
      acquire: (key, options) => { lease = slots.acquire<RendererProviderValue>(key, { ...options, budget: { executingMs: 10000, finalizingMs: 1000 } }); return lease; },
      describeUnavailable: () => ({ code: 'provider_unavailable', message: 'fixture', retryable: true }),
    });
    const outcome = tool.execute({}, mcpTestContext(controller.signal)).then(value => ({ value }), error => ({ error }));
    try {
      await entered.wait;
      if (winner === 'caller') { controller.abort(new Error('caller first')); slots.abortNonProtected(); }
      else { slots.abortNonProtected(); controller.abort(new Error('caller second')); }
      expect(lease.abortSource).toBe(winner); held.release();
      const ended = await outcome;
      if (winner === 'caller') expect(ended).toMatchObject({ error: { name: 'AbortError' } });
      else {
        expect(ended).toHaveProperty('value');
        expect((ended as { value: string }).value).not.toBe('late success');
        expect(JSON.parse((ended as { value: string }).value)).toMatchObject({ ok: false, error_code: 'provider_unavailable', retryable: true });
      }
      expect(lease.abortSource).toBe(winner); expect(slots.activeLeaseCount('mcp:report-renderer')).toBe(0);
    } finally { held.release(); await outcome; await slots.retire('mcp:report-renderer', 'generation-1'); }
  });

  it('M3 closes the Registry-to-Desktop-loop microtask window before tool_finished or model consumption', async () => {
    const root = directory(); const controller = new AbortController(); const events: string[] = []; let modelCalls = 0;
    const registry = new ToolRegistry({ autoMode: true }, [{ permission: 'safe', definition: { name: 'mcp__generic__probe', description: 'fixture', inputSchema: { type: 'object' } }, execute: async () => 'completed remote result' }]); cleanup.push(() => registry.dispose());
    const original = registry.executeTool.bind(registry);
    vi.spyOn(registry, 'executeTool').mockImplementation(async (...args) => {
      const result = await original(...args);
      // Correct registry result already exists. Cancellation wins before the next production await continuation.
      queueMicrotask(() => controller.abort(new Error('between registry and desktop loop')));
      return result;
    });
    const outcome = runDesktopToolLoop({ adapter: { async *stream() { modelCalls++; yield { type: 'tool_use', id: 'probe', name: 'mcp__generic__probe', input: {} }; } },
      systemPrompt: 'fixture', messages: [], allToolDefs: registry.getToolDefinitions(), registry, signal: controller.signal, taskDeadline: Date.now() + 10000,
      sessionId: 's', turnId: 't', intentId: 'i', stepId: 'step', taskId: 'task', materials: [], emitRuntimeEvent: async event => { events.push(event.type); },
      skillInvocation: null, skillCatalog: createSkillCatalog(undefined, root), dataRoot: root, cwd: root, taskStartTime: Date.now(), maxIterations: 2,
      strategies: { compact: { enabled: false, shouldCompact: () => false, doCompact: async () => {} }, buildApiView: messages => messages,
        processToolResult: result => result, trackAutoProgress: false, trackReferenceReads: false, emitSkillArtifactTrace: false },
    }).then(value => ({ value }), error => ({ error }));
    expect(await outcome).toHaveProperty('error'); expect(events).not.toContain('post_tool_use'); expect(events).not.toContain('tool_finished'); expect(modelCalls).toBe(1);
  });

  it('M9 actual opaque MCP canonical/alias path commits manual before cancellation and a real Git worktree cannot auto-delete', async () => {
    const root = directory(); const git = (args: string[]) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    git(['init']); git(['-c', 'user.name=BDD', '-c', 'user.email=bdd@example.invalid', 'commit', '--allow-empty', '-m', 'fixture']);
    const store = new DesktopMultiAgentStore(join(root, 'groups.sqlite')); cleanup.push(() => store.close());
    store.registerThread({ threadId: 'thread', profileId: 'profile', workspaceId: 'workspace', cwd: root }); const group = store.createGroup('thread');
    store.putAgent(group.groupId, { id: 'child', parentId: `root_${group.groupId}`, taskName: 'child', canonicalName: '/main/child', depth: 1, status: 'running', turn: 1 });
    const worktrees = new DesktopMultiAgentWorktrees({ store });
    const allocation = await worktrees.allocate({ groupId: group.groupId, agentId: 'child', cwd: root, cleanupPolicy: 'delete', signal: new AbortController().signal });
    const callTool = vi.fn(async () => 'effect'); const schema = { name: 'probe', description: 'fixture', inputSchema: { type: 'object' as const } };
    const tool = buildMcpRuntimeTools({ name: 'generic', command: 'fixture' }, { listTools: async () => [schema], callTool, dispose() {} }, [schema])[0]!;
    const catalog = new DesktopCapabilityCatalog(); const entry = catalog.publish({ requestSource: 'scheduler', ownerId: 'mcp:fixture', entry: { definition: tool.definition, aliases: ['probe_alias'], permission: tool.permission,
      scope: { workspaceId: 'workspace', materialIds: [], permissions: ['safe'] }, bindInvocation: () => tool.execute } });
    catalog.authorize({ requestSource: 'user', capabilityId: entry.capabilityId });
    const controller = new AbortController(); const reason = new Error('cancel after manual committed'); const journaled = barrier(); const held = barrier();
    const scope = catalog.createScopedRegistry(catalog.snapshotPolicy(), { groupId: group.groupId, agentId: 'child', turnId: 'turn', cwd: allocation.cwd, workspaceId: 'workspace', materialIds: [], permissionRevision: 0, signal: controller.signal, deadlineAt: Date.now() + 10000,
      beforeOpaqueInvocation: async () => { worktrees.beforeOpaqueInvocation(group.groupId, 'child'); journaled.release(); await held.wait; },
    }, { autoMode: true }); cleanup.push(() => scope.dispose());
    const outcome = scope.registry.executeTool('probe_alias', {}, mcpTestContext(controller.signal)).then(value => ({ value }), error => ({ error }));
    try {
      await journaled.wait; expect(store.resources(group.groupId)[0]?.cleanupEligibility).toBe('manual');
      controller.abort(reason); held.release(); const ended = await outcome;
      expect(callTool).not.toHaveBeenCalled(); expect(store.resources(group.groupId)[0]?.cleanupEligibility).toBe('manual');
      await expect(allocation.release()).rejects.toThrow(/manual/); expect(existsSync(allocation.cwd)).toBe(true);
      expect(ended).toEqual({ error: reason });
    } finally { held.release(); await outcome; }
  });

  it.each([
    ['post_tool_use', 'mcp__generic__probe'], ['post_tool_use_failure', 'mcp__generic__probe'],
    ['tool_finished', 'mcp__generic__probe'], ['progress_plan_reported', 'mcp__generic__probe'],
    ['file_changed', 'write'], ['artifact_recorded', 'write'], ['progress_plan_reported', 'report_progress'],
  ] as const)(
    'M3 cancellation during actual %s publication from %s prevents later events and tool-result consumption', async (stage, name) => {
      const root = directory(); const controller = new AbortController(); const reason = new Error(`cancel during ${stage}`);
      const entered = barrier(); const held = barrier(); const events: string[] = []; const messages: Message[] = []; let modelCalls = 0;
      const registry = new ToolRegistry({ autoMode: true }, [{ permission: 'safe', definition: { name, description: 'fixture', inputSchema: { type: 'object' } },
        execute: async () => stage === 'post_tool_use_failure' ? 'Error: normal remote error' : name === 'report_progress'
          ? JSON.stringify({ ok: true, displayed_steps: 1, _validated: [{ id: 'one', label: 'fixture', status: 'completed' }] }) : 'REMOTE_RESULT' }]); cleanup.push(() => registry.dispose());
      const result = runDesktopToolLoop({ adapter: { async *stream() { modelCalls++; yield { type: 'tool_use', id: 'probe', name, input: name === 'write' ? { file_path: join(root, 'fixture.txt') } : {} }; } },
        systemPrompt: 'fixture', messages, allToolDefs: registry.getToolDefinitions(), registry, signal: controller.signal, taskDeadline: Date.now() + 10000,
        sessionId: 's', turnId: 't', intentId: 'i', stepId: 'step', taskId: 'task', materials: [], emitRuntimeEvent: async event => {
          events.push(event.type); if (event.type === stage) { entered.release(); await held.wait; }
        }, skillInvocation: null, skillCatalog: createSkillCatalog(undefined, root), dataRoot: root, cwd: root, taskStartTime: Date.now(), maxIterations: 2,
        strategies: { compact: { enabled: false, shouldCompact: () => false, doCompact: async () => {} }, buildApiView: messages => messages,
          processToolResult: result => result, trackAutoProgress: true, trackReferenceReads: false, emitSkillArtifactTrace: false },
      }).then(value => ({ value }), error => ({ error }));
      try {
        await entered.wait; const before = [...events]; controller.abort(reason); held.release();
        expect.soft(await result).toEqual({ error: reason }); expect.soft(events).toEqual(before); expect(modelCalls).toBe(1);
        expect(messages.flatMap(message => message.content).filter(block => block.type === 'tool_result')).toEqual([]);
      } finally { held.release(); await result; }
    });
});
