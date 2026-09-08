import { describe, expect, it, vi } from 'vitest';
import type { ModelAdapter, StreamChunk } from '../../../src/types.js';
import { AgentRuntime } from '../../../src/ai/runtime/agent-runtime.js';
import { AgentSessionState } from '../../../src/ai/runtime/session.js';
import { AgentRunController } from '../../../src/ai/runtime/controller.js';
import { ToolRegistry } from '../../../src/ai/tools/index.js';

function barrier() { let release!: () => void; return { wait: new Promise<void>(resolve => { release = resolve; }), release: () => release() }; }

describe('M4 MCP original reason at the real CLI AgentRuntime boundary', () => {
  it.each([new Error('pre-aborted caller'), new DOMException('original abort', 'AbortError')])('preserves a pre-aborted reason without starting a run: %s', async reason => {
    const controller = new AbortController(); controller.abort(reason);
    const events: string[] = []; let calls = 0;
    const registry = new ToolRegistry({ autoMode: true }, []);
    const runtime = new AgentRuntime({ adapter: { getModelName: () => 'fixture', async *stream() { calls++; } } as ModelAdapter,
      registry, session: new AgentSessionState(), controller: new AgentRunController(), systemPrompt: 'fixture' });
    try {
      const error = await runtime.run('fixture', event => events.push(event.type), controller.signal).catch(error => error);
      expect(error).toMatchObject({ name: 'AbortError' });
      if (reason.name === 'AbortError') expect(error).toBe(reason); else expect(error.cause).toBe(reason);
      expect(calls).toBe(0); expect(events).toEqual([]);
    } finally { registry.dispose(); }
  });

  it('rejects the real Registry post-hook resolve / CLI await microtask gap before successful tool history', async () => {
    const entered = barrier(); let release!: (warnings: string[]) => void;
    const postHook = new Promise<string[]>(resolve => { release = resolve; });
    const controller = new AbortController(); const reason = new Error('between actual registry and CLI');
    const events: string[] = []; let modelCalls = 0; const session = new AgentSessionState();
    const registry = new ToolRegistry({ autoMode: true, hooksRunner: {
      runHooks: async () => ({ ok: true }), runPreHooks: async () => ({ ok: true }),
      runPostHooks: () => { entered.release(); return postHook; },
    } }, [{ permission: 'safe', definition: { name: 'probe', description: 'fixture', inputSchema: { type: 'object' } }, execute: async () => 'LATE_SUCCESS' }]);
    const runtime = new AgentRuntime({ adapter: { getModelName: () => 'fixture', async *stream(): AsyncIterable<StreamChunk> {
      modelCalls++; yield { type: 'tool_use', id: 'actual-call', name: 'probe', input: {} }; yield { type: 'done' };
    } } as ModelAdapter, registry, session, controller: new AgentRunController(), systemPrompt: 'fixture', maxIterations: 2 });
    const outcome = runtime.run('fixture', event => events.push(event.type), controller.signal).catch(error => error);
    try {
      await entered.wait;
      release([]); // Enqueues the real Registry continuation, which checks then resolves.
      queueMicrotask(() => controller.abort(reason)); // Wins before its caller resumes.
      const error = await outcome;
      expect.soft(error).toMatchObject({ name: 'AbortError' }); expect.soft(error.cause).toBe(reason);
      expect.soft(events).not.toContain('tool_finished'); expect.soft(events.filter(type => type === 'run_aborted')).toHaveLength(1);
      expect(events).not.toContain('run_failed'); expect(modelCalls).toBe(1);
      expect(session.getMessages().flatMap(message => message.content).filter(block => block.type === 'tool_result'))
        .toEqual([{ type: 'tool_result', tool_use_id: 'actual-call', content: '[user-cancelled]', is_error: true }]);
    } finally { release([]); await outcome; registry.dispose(); }
  });

  it.each(['run_started', 'assistant_text'])('emits run_aborted once when the %s listener cancels synchronously', async stage => {
    const controller = new AbortController(); const reason = new Error('event observer cancelled'); const events: string[] = [];
    const registry = new ToolRegistry({ autoMode: true }, []);
    const runtime = new AgentRuntime({ adapter: { getModelName: () => 'fixture', async *stream(): AsyncIterable<StreamChunk> {
      yield { type: 'text', delta: 'partial' }; yield { type: 'done' };
    } } as ModelAdapter, registry, session: new AgentSessionState(), controller: new AgentRunController(), systemPrompt: 'fixture' });
    try {
      const error = await runtime.run('fixture', event => { events.push(event.type); if (event.type === stage) controller.abort(reason); }, controller.signal).catch(error => error);
      expect.soft(error).toMatchObject({ name: 'AbortError', cause: reason });
      expect(events.filter(type => type === 'run_aborted')).toHaveLength(1); expect(events).not.toContain('run_failed');
    } finally { registry.dispose(); }
  });

  it('rechecks the final Registry Promise even when its own inner preflight and outcome guards have passed', async () => {
    const controller = new AbortController(); const reason = new Error('after final registry outcome'); const events: string[] = [];
    const session = new AgentSessionState(); let calls = 0;
    const registry = new ToolRegistry({ autoMode: true }, [{ permission: 'safe', definition: { name: 'probe', description: 'fixture', inputSchema: { type: 'object' } }, execute: async () => 'FINAL_REGISTRY_SUCCESS' }]);
    const original = registry.executeTool.bind(registry);
    vi.spyOn(registry, 'executeTool').mockImplementation(async (...args) => {
      const actualResult = await original(...args);
      queueMicrotask(() => controller.abort(reason));
      return actualResult;
    });
    const runtime = new AgentRuntime({ adapter: { getModelName: () => 'fixture', async *stream(): AsyncIterable<StreamChunk> {
      calls++; yield { type: 'tool_use', id: 'final-call', name: 'probe', input: {} }; yield { type: 'done' };
    } } as ModelAdapter, registry, session, controller: new AgentRunController(), systemPrompt: 'fixture', maxIterations: 2 });
    try {
      const error = await runtime.run('fixture', event => events.push(event.type), controller.signal).catch(error => error);
      expect(error).toMatchObject({ name: 'AbortError', cause: reason }); expect(events).not.toContain('tool_finished');
      expect(events.filter(type => type === 'run_aborted')).toHaveLength(1); expect(calls).toBe(1);
      expect(session.getMessages().flatMap(message => message.content).filter(block => block.type === 'tool_result'))
        .toEqual([{ type: 'tool_result', tool_use_id: 'final-call', content: '[user-cancelled]', is_error: true }]);
    } finally { registry.dispose(); }
  });

  it.each([
    ['DOMException', (): DOMException => new DOMException('cancelled', 'AbortError')],
    ['Error', (): Error => new Error('scheduler cancelled')],
    ['string', (): string => 'scheduler cancelled'],
  ] as const)('classifies %s as one run_aborted, repairs paired history, and does not request another model turn', async (_name, makeReason) => {
    const entered = barrier(); const held = barrier(); const controller = new AbortController(); const reason = makeReason();
    const events: string[] = []; let modelRequests = 0; const session = new AgentSessionState();
    const runtime = new AgentRuntime({
      adapter: {
        getModelName: () => 'controlled-fixture',
        async *stream(): AsyncIterable<StreamChunk> {
          modelRequests++;
          yield { type: 'text', delta: 'partial assistant text' };
          yield { type: 'tool_use', id: 'cancel_tool', name: 'probe', input: {} };
          yield { type: 'done' };
        },
      } as ModelAdapter,
      // Isolates the runtime after correct leaf/registry original-reason propagation.
      registry: { getToolDefinitions: () => [{ name: 'probe', description: 'fixture', inputSchema: { type: 'object' } }],
        executeTool: async () => { entered.release(); await held.wait; throw reason; } } as unknown as ToolRegistry,
      session, controller: new AgentRunController(), systemPrompt: 'controlled fixture', maxIterations: 2,
    });
    const outcome = runtime.run('controlled fixture', event => events.push(event.type), controller.signal).then(value => ({ value }), error => ({ error }));
    try {
      await entered.wait; controller.abort(reason); held.release();
      const ending = await outcome;
      expect(ending).toMatchObject({ error: { name: 'AbortError' } });
      if (!(reason instanceof Error && reason.name === 'AbortError')) expect((ending as { error: Error }).error.cause).toBe(reason);
      expect(events.filter(type => type === 'run_aborted')).toHaveLength(1); expect(events).not.toContain('run_failed');
      expect(modelRequests).toBe(1);
      const blocks = session.getMessages().flatMap(message => message.content);
      expect(blocks.filter(block => block.type === 'tool_use')).toMatchObject([{ id: 'cancel_tool' }]);
      expect(blocks.filter(block => block.type === 'tool_result')).toMatchObject([{ tool_use_id: 'cancel_tool', content: '[user-cancelled]', is_error: true }]);
    } finally { held.release(); await outcome; }
  });
});
