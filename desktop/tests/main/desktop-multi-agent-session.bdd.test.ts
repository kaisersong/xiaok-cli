// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Message, ModelAdapter, ToolExecutionContext } from '../../../src/types.js';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import { createSkillCatalog } from '../../../src/ai/skills/loader.js';
import { DesktopManagedAgentSession, buildDesktopAgentFork } from '../../electron/desktop-managed-agent-session.js';
import { DesktopMultiAgentStore } from '../../electron/desktop-multi-agent-store.js';
import { DesktopMultiAgentTurnMailbox, MultiAgentCommandSequencer } from '../../electron/desktop-multi-agent-mailbox.js';
import type { DesktopAgentExecutionContext } from '../../electron/desktop-multi-agent-service.js';
import { createAdapterFromBinding } from '../../../src/ai/models.js';

describe('BDD: managed Desktop sessions use the production Desktop loop', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); });
  const text = (value: string): Message => ({ role: 'user', content: [{ type: 'text', text: value }] });
  const parent: Message[] = [text('committed'),
    { role: 'assistant', content: [{ type: 'tool_use', id: 'old', name: 'read', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'old', content: 'old result' }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'pending', name: 'spawn_agent', input: {} }] },
  ];
  function setup(adapter: Pick<ModelAdapter, 'stream'>, messages = parent) {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-desktop-session-'));
    cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
    const store = new DesktopMultiAgentStore(join(root, 'multi.sqlite'));
    cleanup.push(() => store.close());
    store.registerThread({ threadId: 'thread', profileId: 'profile', workspaceId: 'workspace', cwd: root });
    const group = store.createGroup('thread');
    const agentId = `root_${group.groupId}`;
    const lifetime = new AbortController();
    const contexts: ToolExecutionContext[] = [];
    let turn = 0;
    let current!: DesktopAgentExecutionContext;
    const nextTurn = () => {
      turn++;
      current = { groupId: group.groupId, agentId, turnId: `turn-${turn}`, turn, rootEpoch: turn, cwd: root,
        effectiveDeadline: Date.now() + 60_000, signal: lifetime.signal, permissionRevision: 0,
        actor: { groupId: group.groupId, agentId, turnId: `turn-${turn}` }, memberTicket: {} as never,
        mailbox: new DesktopMultiAgentTurnMailbox({ store, groupId: group.groupId, agentId, turnId: `turn-${turn}`,
          commands: new MultiAgentCommandSequencer(), assertCurrent: () => {}, onSeal: () => {} }),
      };
    };
    nextTurn();
    const disposeRegistry = vi.fn();
    const createRegistry = vi.fn(() => {
      const registry = new ToolRegistry({ autoMode: true }, [{ permission: 'safe',
        definition: { name: 'inspect_context', description: 'inspect binding', inputSchema: { type: 'object', properties: {} } },
        execute: async (_input, context) => { contexts.push(context!); return 'bound result'; },
      }]);
      return { registry, dispose: () => { disposeRegistry(); registry.dispose(); } };
    });
    const session = new DesktopManagedAgentSession({ adapter, systemPrompt: 'child system', parentMessages: messages, forkContext: true,
      getTurnContext: () => current, createRegistry, dataRoot: join(root, 'application-data'),
      skillCatalog: createSkillCatalog(undefined, root), materials: [], emitRuntimeEvent: vi.fn(), onUsage: vi.fn(), maxIterations: 3,
    });
    cleanup.push(() => session.dispose());
    return { session, nextTurn, root, contexts, createRegistry, disposeRegistry, lifetime, store, group, agentId };
  }

  it('A5 Given an in-flight parent tool batch, When the real child requests a model turn, Then only the complete prefix is inherited without changing its parent', async () => {
    const requests: Message[][] = [];
    const adapter: Pick<ModelAdapter, 'stream'> = { async *stream(messages) { requests.push(structuredClone(messages)); yield { type: 'text', delta: 'child done' }; } };
    const before = structuredClone(parent);
    const { session } = setup(adapter);
    expect(await session.run('child task')).toBe('child done');
    expect(parent).toEqual(before);
    expect(requests[0].slice(0, 3)).toEqual(before.slice(0, 3));
    expect(JSON.stringify(requests)).not.toContain('pending');
    expect(JSON.stringify(requests)).toContain('child task');
  });

  it('U1 Given a completed session run, Then reusing the same trusted turn cannot silently reset progress or invoke the provider twice', async () => {
    const entered = vi.fn(); const adapter: Pick<ModelAdapter, 'stream'> = { async *stream() { entered(); yield { type: 'text', delta: 'done' }; } };
    const { session } = setup(adapter, []); await session.run('first');
    await expect(session.run('same turn again')).rejects.toThrow(/turn.*already|stale.*turn/);
    expect(entered).toHaveBeenCalledOnce();
  });

  it('A5 Given duplicate results or a partial multi-call batch, When forking, Then the entire first invalid exchange and later suffix are excluded', () => {
    const adapter = { stream: vi.fn() };
    const malformed: Message[] = [text('safe'), { role: 'assistant', content: [
      { type: 'tool_use', id: 'a', name: 'read', input: {} }, { type: 'tool_use', id: 'b', name: 'read', input: {} },
    ] }, { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'a', content: 'one' }, { type: 'tool_result', tool_use_id: 'a', content: 'duplicate' },
    ] }, text('unsafe suffix')];
    expect(buildDesktopAgentFork(adapter, malformed, true)).toMatchObject({ mode: 'completed_prefix', messages: [text('safe')], truncated: true });
    expect(buildDesktopAgentFork(adapter, parent, false)).toMatchObject({ mode: 'none', messages: [], truncated: false });
  });

  it('A25 Given a real strict K3 adapter and oversized private history, When forking, Then the shared public synthesized helper keeps a bounded tail without private reasoning', () => {
    const adapter = createAdapterFromBinding({ providerId: 'kimi', providerType: 'first_party', modelId: 'kimi-k3', wireModel: 'k3',
      protocol: 'openai_legacy', apiKey: 'fixture', baseUrl: 'https://api.kimi.com/coding/v1', headers: {}, capabilities: ['tools', 'thinking'],
      runtimeOptions: { contextLimit: 262_144, reasoningEffort: 'high' } });
    const messages: Message[] = [text('OLD_SENTINEL' + 'x'.repeat(39_900)),
      { role: 'assistant', content: [{ type: 'thinking', thinking: 'PRIVATE_SENTINEL' }, { type: 'text', text: 'visible answer' }] }, text('TAIL_SENTINEL')];
    const fork = buildDesktopAgentFork(adapter, messages, true);
    expect(fork.mode).toBe('synthesized'); expect(fork.truncated).toBe(true);
    const wire = JSON.stringify(fork.messages);
    expect(wire).toContain('TAIL_SENTINEL'); expect(wire).not.toContain('OLD_SENTINEL'); expect(wire).not.toContain('PRIVATE_SENTINEL');
    expect(fork.messages[0].content[0]).toMatchObject({ type: 'text' });
    expect((fork.messages[0].content[0] as { text: string }).text.length).toBeLessThanOrEqual(40_000);
  });

  it('A24 Given suspension and a later turn, When tools run again, Then session history survives but registry/turn/cwd authority is freshly bound', async () => {
    const requests: Message[][] = [];
    let calls = 0;
    const adapter: Pick<ModelAdapter, 'stream'> = { async *stream(messages) {
      requests.push(structuredClone(messages)); calls++;
      if (calls % 2) yield { type: 'tool_use', id: `call-${calls}`, name: 'inspect_context', input: {} };
      else yield { type: 'text', delta: `done-${calls}` };
    } };
    const { session, nextTurn, root, contexts, createRegistry, disposeRegistry } = setup(adapter, []);
    await session.run('first'); await session.suspend(); nextTurn(); await session.run('followup');
    expect(createRegistry).toHaveBeenCalledTimes(2); expect(disposeRegistry).toHaveBeenCalledTimes(2);
    expect(contexts.map(context => context.session.cwd)).toEqual([root, root]);
    expect(contexts[0].session.sessionId).toBe(contexts[1].session.sessionId);
    expect(JSON.stringify(requests[2])).toContain('done-2');
    expect(JSON.stringify(requests[2])).toContain('followup');
  });

  it('A11/A25 Given inline model overrides, When constructing a Desktop child, Then it fails before any registry or provider side effect', () => {
    const createRegistry = vi.fn(); const stream = vi.fn();
    for (const override of [{ model: 'other' }, { modelCapability: 'other' }]) {
      expect(() => new DesktopManagedAgentSession({ adapter: { stream }, createRegistry, ...override } as never)).toThrow(/model.*override|model.*unsupported/);
    }
    expect(createRegistry).not.toHaveBeenCalled(); expect(stream).not.toHaveBeenCalled();
  });

  it('A6/A12 Given a stream contains private thinking chunks, When the actual Desktop child runs, Then watchdog activity receives phase metadata only', async () => {
    const adapter: Pick<ModelAdapter, 'stream'> = { async *stream() {
      yield { type: 'thinking', delta: 'PRIVATE_REASONING_NEVER_PUBLISH' }; yield { type: 'text', delta: 'public answer' };
    } };
    const { session } = setup(adapter, []); const activity = vi.fn();
    await session.run('work', undefined, { onActivity: activity, takePendingInput: () => { throw new Error('Desktop cannot use CLI inbox'); } });
    expect(activity).toHaveBeenCalledWith({ phase: 'thinking' });
    expect(JSON.stringify(activity.mock.calls)).not.toContain('PRIVATE_REASONING');
  });

  it('A7/A42 Given pre-abort or a session that ignores abort, When disposing, Then no new calls start and cleanup never pretends the live execution settled', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const entered = vi.fn();
    const adapter: Pick<ModelAdapter, 'stream'> = { async *stream() { entered(); await gate; yield { type: 'text', delta: 'late' }; } };
    const { session, createRegistry } = setup(adapter, []);
    const aborted = new AbortController(); aborted.abort();
    await expect(session.run('never starts', aborted.signal)).rejects.toThrow(); expect(createRegistry).not.toHaveBeenCalled();
    const execution = session.run('running'); const caught = execution.catch(error => error);
    let disposed = false;
    try {
      await vi.waitFor(() => expect(entered).toHaveBeenCalledOnce());
      const disposal = session.dispose().then(() => { disposed = true; });
      await Promise.resolve(); await Promise.resolve(); expect(disposed).toBe(false);
      release(); await disposal; expect(disposed).toBe(true); expect(await caught).toMatchObject({ name: 'AbortError' });
      await expect(session.run('after disposal')).rejects.toThrow(/closed|disposed/);
    } finally { release(); await caught; }
  });
});
