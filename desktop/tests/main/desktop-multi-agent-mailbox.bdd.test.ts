// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DesktopMultiAgentStore } from '../../electron/desktop-multi-agent-store.js';
import { DesktopMultiAgentTurnMailbox, MultiAgentCommandSequencer } from '../../electron/desktop-multi-agent-mailbox.js';
import { runDesktopToolLoop } from '../../electron/desktop-services.js';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import type { Message, ModelAdapter } from '../../../src/types.js';

describe('BDD: actual Desktop provider loop and durable mailbox', () => {
  const cleanup: Array<() => void> = [];
  afterEach(() => { for (const action of cleanup.splice(0).reverse()) action(); });
  function setup() {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-desktop-mailbox-'));
    cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
    const store = new DesktopMultiAgentStore(join(root, 'groups.sqlite'));
    cleanup.push(() => store.close());
    store.registerThread({ threadId: 't1', profileId: 'p1', workspaceId: 'w1', cwd: root });
    const group = store.createGroup('t1');
    const agentId = `root_${group.groupId}`;
    const onSeal = vi.fn();
    const commands = new MultiAgentCommandSequencer();
    const mailbox = new DesktopMultiAgentTurnMailbox({ store, groupId: group.groupId, agentId, turnId: 'turn-1', commands, assertCurrent: () => {}, onSeal });
    const send = (text: string) => store.sendMessage(group.groupId, { sender: { kind: 'user', actorId: 'p1' }, receiverId: agentId, text });
    const registry = new ToolRegistry({ autoMode: true }, [{
      permission: 'safe', definition: { name: 'read', description: 'fixture read', inputSchema: { type: 'object', properties: {} } },
      execute: async () => 'tool result',
    }]);
    const context = {
      systemPrompt: 'system', messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'PROMPT_SENTINEL' }] }],
      registry, allToolDefs: registry.getToolDefinitions(), signal: new AbortController().signal,
      taskDeadline: Date.now() + 30_000, sessionId: 'session-1', turnId: 'turn-1', intentId: 'intent-1', stepId: 'step-1', taskId: 'task-1',
      materials: [], emitRuntimeEvent: vi.fn(), skillInvocation: null, skillCatalog: {} as never, dataRoot: root, taskStartTime: Date.now(), mailbox,
      strategies: { compact: { enabled: false, shouldCompact: () => false, doCompact: async () => {} },
        buildApiView: (messages: Message[]) => messages, processToolResult: (result: string) => result,
        trackAutoProgress: false, trackReferenceReads: false, emitSkillArtifactTrace: false },
    };
    return { store, group, agentId, mailbox, send, onSeal, context };
  }

  it('A24/A32 Given M before the first request, When the real loop streams, Then its exact user blocks are M/P once and already confirmed', async () => {
    const { context, send, store, group, agentId, onSeal } = setup();
    send('MESSAGE_SENTINEL');
    const requests: Message[][] = [];
    const adapter: Pick<ModelAdapter, 'stream'> = { async *stream(messages) {
      requests.push(structuredClone(messages));
      expect(store.listMessages(group.groupId, agentId)[0]?.deliveryState).toBe('context_applied');
      yield { type: 'text', delta: 'done' };
    } };
    await runDesktopToolLoop({ ...context, adapter, maxIterations: 2 });
    const wire = JSON.stringify(requests[0]);
    expect(wire.match(/MESSAGE_SENTINEL/g)).toHaveLength(1);
    expect(wire.match(/PROMPT_SENTINEL/g)).toHaveLength(1);
    expect(wire.indexOf('MESSAGE_SENTINEL')).toBeLessThan(wire.indexOf('PROMPT_SENTINEL'));
    expect(onSeal).toHaveBeenCalledExactlyOnceWith('completed');
  });

  it('A19 Given M arrives during a pure-text response, When seal sees available budget, Then the next real request consumes it', async () => {
    const { context, send, store, group, agentId, onSeal } = setup();
    const requests: Message[][] = [];
    const adapter: Pick<ModelAdapter, 'stream'> = { async *stream(messages) {
      requests.push(structuredClone(messages));
      if (requests.length === 1) send('LATE_SENTINEL');
      yield { type: 'text', delta: 'done' };
    } };
    await runDesktopToolLoop({ ...context, adapter, maxIterations: 2 });
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1]).match(/LATE_SENTINEL/g)).toHaveLength(1);
    expect(store.listMessages(group.groupId, agentId)[0]?.deliveryState).toBe('context_applied');
    expect(onSeal).toHaveBeenCalledExactlyOnceWith('completed');
  });

  it('A39 Given N=1 and M arrives before pure-text seal, When budget is exhausted, Then no extra request occurs and M remains unread', async () => {
    const { context, send, store, group, agentId, onSeal } = setup();
    let requests = 0;
    const adapter: Pick<ModelAdapter, 'stream'> = { async *stream() { requests++; send('late'); yield { type: 'text', delta: 'partial' }; } };
    await expect(runDesktopToolLoop({ ...context, adapter, maxIterations: 1 })).rejects.toMatchObject({ code: 'multi_agent_iteration_limit', partialReply: 'partial' });
    expect(requests).toBe(1);
    expect(store.listMessages(group.groupId, agentId)[0]?.deliveryState).toBe('unread');
    expect(onSeal).toHaveBeenCalledExactlyOnceWith('failed');
  });

  it('A41 Given N=1 ends with a tool, When the no-tool tail returns text, Then it is still a partial failure with at most N+1 requests', async () => {
    const { context, onSeal } = setup();
    let requests = 0;
    const adapter: Pick<ModelAdapter, 'stream'> = { async *stream(_messages, tools) {
      requests++;
      if (requests === 1) yield { type: 'tool_use', id: 'call-1', name: 'read', input: {} };
      else { expect(tools).toHaveLength(0); yield { type: 'text', delta: 'partial tail' }; }
    } };
    await expect(runDesktopToolLoop({ ...context, adapter, maxIterations: 1 })).rejects.toMatchObject({ code: 'multi_agent_iteration_limit', partialReply: 'partial tail' });
    expect(requests).toBe(2);
    expect(onSeal).toHaveBeenCalledExactlyOnceWith('failed');
  });

  it('A24 Given API view construction fails before confirm, When the loop fails, Then the claim is returned and the turn is sealed once', async () => {
    const { context, send, store, group, agentId, onSeal } = setup();
    send('unconfirmed');
    const adapter = { stream: vi.fn() } as unknown as Pick<ModelAdapter, 'stream'>;
    await expect(runDesktopToolLoop({ ...context, adapter, strategies: { ...context.strategies, buildApiView: () => { throw new Error('view failed'); } } })).rejects.toThrow('view failed');
    expect(store.listMessages(group.groupId, agentId)[0]).toMatchObject({ deliveryState: 'unread', claimId: null });
    expect(adapter.stream).not.toHaveBeenCalled();
    expect(onSeal).toHaveBeenCalledExactlyOnceWith('failed');
  });

  it('A29 Given confirm succeeds then provider aborts, When the loop exits, Then context remains applied rather than silently replayable', async () => {
    const { context, send, store, group, agentId, onSeal } = setup();
    send('confirmed');
    const abort = new DOMException('provider aborted', 'AbortError');
    const adapter: Pick<ModelAdapter, 'stream'> = { async *stream() { throw abort; } };
    await expect(runDesktopToolLoop({ ...context, adapter })).rejects.toBe(abort);
    expect(store.listMessages(group.groupId, agentId)[0]?.deliveryState).toBe('context_applied');
    expect(onSeal).toHaveBeenCalledExactlyOnceWith('interrupted');
  });

  it('A39 Given a pre-aborted turn, When run is attempted, Then no drain/provider call occurs but its single finish verdict is recorded', async () => {
    const { context, send, store, group, agentId, onSeal } = setup();
    send('not consumed');
    const controller = new AbortController(); controller.abort();
    const adapter = { stream: vi.fn() } as unknown as Pick<ModelAdapter, 'stream'>;
    await expect(runDesktopToolLoop({ ...context, adapter, signal: controller.signal })).rejects.toThrow();
    expect(adapter.stream).not.toHaveBeenCalled();
    expect(store.listMessages(group.groupId, agentId)[0]?.deliveryState).toBe('unread');
    expect(onSeal).toHaveBeenCalledExactlyOnceWith('interrupted');
  });

  it('A19 Given synchronous commands, When a long promise is returned accidentally, Then the sequencer rejects it and later commands still progress', async () => {
    const commands = new MultiAgentCommandSequencer();
    const never = new Promise<void>(() => {});
    await expect(commands.run(() => never)).rejects.toThrow(/synchronous|async/);
    await expect(commands.run(() => 42)).resolves.toBe(42);
  });

  it('A7 Given the Desktop cancellation signal carries AbortError, When the shared loop catches its legacy cancellation wrapper, Then multi-agent returns the original interruption', async () => {
    const { context } = setup();
    const controller = new AbortController(); const reason = new DOMException('user stop', 'AbortError'); controller.abort(reason);
    await expect(runDesktopToolLoop({ ...context, signal: controller.signal, adapter: { stream: vi.fn() } })).rejects.toBe(reason);
  });

  it('A12 Given async usage persistence fails, When the actual model loop receives usage, Then it awaits the sink and cannot seal successful delivery', async () => {
    const { context, onSeal } = setup();
    const failure = Promise.reject(new Error('usage persistence failed')); void failure.catch(() => {});
    const adapter: Pick<ModelAdapter, 'stream'> = { async *stream() { yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 2 } }; yield { type: 'text', delta: 'must not succeed' }; } };
    await expect(runDesktopToolLoop({ ...context, adapter, onUsage: () => failure })).rejects.toThrow('usage persistence failed');
    expect(onSeal).toHaveBeenCalledExactlyOnceWith('failed');
  });
});
