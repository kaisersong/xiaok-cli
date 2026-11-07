// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentSessionState } from '../../../src/ai/runtime/session.js';
import type { Tool, ToolExecutionContext } from '../../../src/types.js';
import { DesktopOwnedToolRegistry, DesktopToolCatalogBridge } from '../../electron/desktop-multi-agent-catalog-bridge.js';

describe('Desktop catalog execution policy through the production watchdog', () => {
  const cleanup: Array<() => void> = [];
  afterEach(() => { for (const dispose of cleanup.splice(0).reverse()) dispose(); vi.useRealTimers(); });

  function setup(executionPolicy?: Tool['executionPolicy']) {
    vi.useFakeTimers();
    let finish!: (value: string) => void;
    let execution: ToolExecutionContext | undefined;
    const tool: Tool = { permission: 'safe', executionPolicy,
      definition: { name: 'assistant_prepare_reply', description: 'Fictional draft decision fixture', inputSchema: { type: 'object', properties: {} } },
      execute: async (_input, context) => {
        execution = context;
        return new Promise<string>((resolve, reject) => {
          const abort = () => { context?.signal?.removeEventListener('abort', abort); reject(context?.signal?.reason); };
          finish = value => { context?.signal?.removeEventListener('abort', abort); resolve(value); };
          context?.signal?.addEventListener('abort', abort, { once: true });
          if (context?.signal?.aborted) abort();
        });
      },
    };
    const registry = new DesktopOwnedToolRegistry({ autoMode: true }, [tool]); cleanup.push(() => registry.dispose());
    const bridge = new DesktopToolCatalogBridge({ registry, workspaceId: 'fixture' }); cleanup.push(() => bridge.dispose());
    bridge.authorizeRoot();
    const handle = bridge.catalog.createScopedRegistry(bridge.catalog.snapshotPolicy(), {
      groupId: 'fixture', agentId: 'root_fixture', turnId: 'turn', cwd: process.cwd(), workspaceId: 'fixture',
      materialIds: [], permissionRevision: 0, signal: new AbortController().signal, deadlineAt: Date.now() + 60_000,
    }, { autoMode: true, toolIdleTimeoutMs: 100 });
    cleanup.push(() => handle.dispose());
    const controller = new AbortController(), states: string[] = [];
    const context: ToolExecutionContext = { taskId: 'fixture', session: new AgentSessionState().exportSnapshot(),
      messages: [], systemPrompt: '', toolDefinitions: [], signal: controller.signal, onExecutionHealth: state => states.push(state) };
    return { registry: handle.registry, bridge, handle, controller, states, context,
      execution: () => execution, finish: () => finish('draft_decided') };
  }

  it('keeps a draft waiting beyond idle timeout and returns after the user decision', async () => {
    const fixture = setup({ waitsForUser: true, idleTimeoutMs: 10 });
    const running = fixture.registry.executeTool('assistant_prepare_reply', {}, fixture.context);
    // Attach before advancing time so the red run cannot leak an unhandled rejection.
    const result = running.then(value => ({ value }), error => ({ error }));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fixture.states).toContain('waiting');
    expect(fixture.execution()?.signal?.aborted).toBe(false);
    fixture.finish();
    expect(await result).toEqual({ value: 'draft_decided' });
  });

  it.each([undefined, { waitsForUser: false }])('retains ordinary idle timeout for %j', async policy => {
    const fixture = setup(policy);
    const running = fixture.registry.executeTool('assistant_prepare_reply', {}, fixture.context);
    const assertion = expect(running).rejects.toThrow('TOOL_IDLE_TIMEOUT');
    await vi.advanceTimersByTimeAsync(101);
    await assertion;
    expect(fixture.states).toContain('cleanup_pending');
  });

  it('retains a custom idle timeout instead of the registry default', async () => {
    const fixture = setup({ idleTimeoutMs: 500 });
    const running = fixture.registry.executeTool('assistant_prepare_reply', {}, fixture.context);
    const result = running.then(value => ({ value }), error => ({ error }));
    await vi.advanceTimersByTimeAsync(200);
    expect(fixture.execution()?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(301);
    const settled = await result;
    expect('error' in settled && settled.error.message).toContain('TOOL_IDLE_TIMEOUT');
  });

  it.each(['user', 'scope'] as const)('still cancels a waiting tool when %s cancels', async cancellation => {
    const fixture = setup({ waitsForUser: true });
    const running = fixture.registry.executeTool('assistant_prepare_reply', {}, fixture.context);
    const result = running.then(value => ({ value }), error => ({ error }));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fixture.execution()?.signal?.aborted).toBe(false);
    if (cancellation === 'user') fixture.controller.abort(new Error('cancelled'));
    else fixture.handle.dispose();
    const settled = await result;
    expect('error' in settled && settled.error.message).toContain(cancellation === 'user' ? 'cancelled' : 'invocation authority disposed');
  });

  it('snapshots and freezes host policy', () => {
    const policy = { waitsForUser: true, idleTimeoutMs: 500 };
    const fixture = setup(policy);
    const descriptor = fixture.bridge.catalog.snapshotDescriptors().find(d => d.canonicalName === 'assistant_prepare_reply')!;
    policy.waitsForUser = false; policy.idleTimeoutMs = 1;
    expect(descriptor.executionPolicy).toEqual({ waitsForUser: true, idleTimeoutMs: 500 });
    expect(Object.isFrozen(descriptor.executionPolicy)).toBe(true);
    expect(fixture.registry.getRegisteredTool('assistant_prepare_reply')?.executionPolicy).toBe(descriptor.executionPolicy);
  });

  it.each(['agent', 'user'] as const)('rejects %s publishing a watchdog exemption', source => {
    const fixture = setup();
    const catalog = fixture.bridge.catalog, descriptor = catalog.snapshotDescriptors()[0]!;
    expect(() => catalog.publish({ requestSource: source, ownerId: descriptor.ownerId, slotId: descriptor.slotId,
      entry: { ...descriptor, executionPolicy: { waitsForUser: true } } })).toThrow('capability mutation source is not permitted');
    expect(fixture.registry.getRegisteredTool('assistant_prepare_reply')?.executionPolicy).toBeUndefined();
  });

  it('retains policy for aliases and narrowed forks after same-slot replacement', () => {
    const fixture = setup({ waitsForUser: true });
    const catalog = fixture.bridge.catalog, first = catalog.snapshotDescriptors()[0]!;
    const next = catalog.publish({ requestSource: 'scheduler', ownerId: first.ownerId, slotId: first.slotId,
      entry: { ...first, aliases: ['reply_alias'], executionPolicy: { waitsForUser: false, idleTimeoutMs: 500 } } });
    catalog.authorize({ requestSource: 'user', capabilityId: next.capabilityId });
    const fork = catalog.createScopedRegistry(catalog.forkPolicy(catalog.snapshotPolicy(), ['reply_alias']), fixture.handle.authority);
    cleanup.push(() => fork.dispose());
    for (const registry of [fixture.registry, fork.registry]) {
      expect(registry.getRegisteredTool('reply_alias')?.executionPolicy).toEqual({ waitsForUser: false, idleTimeoutMs: 500 });
      expect(registry.getRegisteredTool('assistant_prepare_reply')?.executionPolicy).toBe(next.executionPolicy);
    }
  });

  it('denies a new waiting invocation after the authority deadline', async () => {
    const fixture = setup({ waitsForUser: true });
    await vi.advanceTimersByTimeAsync(60_001);
    await expect(fixture.registry.executeTool('assistant_prepare_reply', {}, fixture.context)).rejects.toThrow('invocation deadline exceeded');
    expect(fixture.execution()).toBeUndefined();
  });
});
