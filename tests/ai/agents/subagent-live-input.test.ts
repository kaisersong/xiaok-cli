import { describe, expect, it } from 'vitest';
import { createNamedSubAgentSession } from '../../../src/ai/agents/subagent-executor.js';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import type { Message, ModelAdapter, Tool, ToolExecutionContext } from '../../../src/types.js';

describe('real subagent runtime live input', () => {
  it('rejects concurrent runs without replacing the active run callbacks', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const phases: string[] = [];
    const adapter: ModelAdapter = { getModelName: () => 'test', async *stream() {
      await gate;
      yield { type: 'thinking', delta: 'private' };
      yield { type: 'text', delta: 'done' };
      yield { type: 'done' };
    } };
    const child = await createNamedSubAgentSession({ agentDef: { name: 'serial', systemPrompt: '' }, sessionId: 'parent', adapter: () => adapter,
      createRegistry: () => new ToolRegistry({ autoMode: true }, []), buildSystemPrompt: async () => 'test' });
    const first = child.run('first', undefined, { onActivity: (event) => phases.push(event.phase), takePendingInput: () => undefined });
    try {
      await expect(child.run('second')).rejects.toThrow();
      release();
      await first;
      expect(phases).toContain('thinking');
    } finally { release(); await first; await child.dispose(); }
  });

  it('reports iteration exhaustion instead of returning intermediate text as a completed task', async () => {
    const adapter: ModelAdapter = { getModelName: () => 'test', async *stream() {
      yield { type: 'text', delta: 'still working' };
      yield { type: 'tool_use', id: 'probe', name: 'probe', input: {} };
      yield { type: 'done' };
    } };
    const child = await createNamedSubAgentSession({ agentDef: { name: 'limited', systemPrompt: '', maxIterations: 1 }, sessionId: 'parent', adapter: () => adapter,
      createRegistry: () => new ToolRegistry({ autoMode: true }, [{ permission: 'safe', definition: { name: 'probe', description: 'test', inputSchema: { type: 'object', properties: {} } }, execute: async () => 'ok' }]),
      buildSystemPrompt: async () => 'test' });
    try { await expect(child.run('run')).rejects.toThrow('SUBAGENT_ITERATION_LIMIT'); }
    finally { await child.dispose(); }
  });

  it('propagates cooperative tool cancellation without normalizing it into a failure result', async () => {
    const error = new DOMException('interrupted tool', 'AbortError');
    const registry = new ToolRegistry({ autoMode: true }, [{ permission: 'safe', definition: { name: 'probe', description: 'test', inputSchema: { type: 'object', properties: {} } }, execute: async () => { throw error; } }]);
    await expect(registry.executeTool('probe', {})).rejects.toBe(error);
  });
  it.each(['tool_batch', 'final_text'] as const)('consumes in-flight input at a complete message boundary: %s', async (mode) => {
    let pending: string | undefined;
    const requests: Message[][] = [];
    const phases: unknown[] = [];
    const adapter: ModelAdapter = {
      getModelName: () => 'test',
      async *stream(messages) {
        requests.push(structuredClone(messages));
        if (requests.length === 1) {
          yield { type: 'thinking', delta: 'PRIVATE_THINKING_MUST_NOT_LEAK' };
          if (mode === 'tool_batch') {
            yield { type: 'tool_use', id: 'one', name: 'probe', input: {} };
            yield { type: 'tool_use', id: 'two', name: 'probe', input: {} };
          } else {
            pending = 'MAIN_LIVE_MESSAGE';
            yield { type: 'text', delta: 'initial result' };
          }
        } else {
          yield { type: 'text', delta: 'acknowledged MAIN_LIVE_MESSAGE' };
        }
        yield { type: 'done' };
      },
    };
    const probe: Tool = { permission: 'safe', definition: { name: 'probe', description: 'test', inputSchema: { type: 'object', properties: {} } },
      execute: async () => { pending = 'MAIN_LIVE_MESSAGE'; return 'ok'; },
    };
    const child = await createNamedSubAgentSession({ agentDef: { name: 'live', systemPrompt: '', maxIterations: 4 }, sessionId: 'parent',
      adapter: () => adapter, createRegistry: () => new ToolRegistry({ autoMode: true }, [probe]), buildSystemPrompt: async () => 'test' });
    try {
      const result = await child.run('start', undefined, { onActivity: (event) => phases.push(event), takePendingInput: () => { const value = pending; pending = undefined; return value; } });
      expect(result).toContain('acknowledged MAIN_LIVE_MESSAGE');
      expect(requests).toHaveLength(2);
      expect(requests[1].at(-1)).toMatchObject({ role: 'user', content: [{ type: 'text', text: 'MAIN_LIVE_MESSAGE' }] });
      if (mode === 'tool_batch') {
        const results = requests[1].flatMap((m) => m.content).filter((b) => b.type === 'tool_result');
        expect(results).toHaveLength(2);
        expect(phases).toContainEqual(expect.objectContaining({ phase: 'tool', toolName: 'probe' }));
      }
      expect(phases).toContainEqual(expect.objectContaining({ phase: 'thinking' }));
      expect(JSON.stringify(phases)).not.toContain('PRIVATE_THINKING');
    } finally { await child.dispose(); }
  });

  it('does not dispatch a tool after approval arrives for an aborted run', async () => {
    const controller = new AbortController();
    let executed = false;
    const registry = new ToolRegistry({ onPrompt: async () => { controller.abort(); return true; } }, [{
      permission: 'write', definition: { name: 'write', description: 'test', inputSchema: { type: 'object', properties: {} } },
      execute: async () => { executed = true; return 'bad'; },
    }]);
    await expect(registry.executeTool('write', {}, { signal: controller.signal } as ToolExecutionContext)).rejects.toMatchObject({ name: 'AbortError' });
    expect(executed).toBe(false);
  });
});
