import { describe, expect, it, vi } from 'vitest';
import { createNamedSubAgentSession, executeNamedSubAgent } from '../../../src/ai/agents/subagent-executor.js';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import type { ModelAdapter } from '../../../src/types.js';

function fixture(stream?: ModelAdapter['stream']) {
  const events: any[] = [];
  const registry = new ToolRegistry({}, [
    { definition: { name: 'inspect', description: 'Inspect', inputSchema: { type: 'object' } }, permission: 'safe', execute: async () => 'evidence' },
    { definition: { name: 'broken', description: 'Failure', inputSchema: { type: 'object' } }, permission: 'safe', execute: async () => 'Error: unavailable' },
  ]);
  let requests = 0;
  const adapter: ModelAdapter = { async *stream(...args) {
    if (stream) { yield* stream(...args); return; }
    if (requests++ === 0) {
      yield { type: 'text', delta: '准备开始检查。' };
      yield { type: 'tool_use', id: 'inspect-1', name: 'inspect', input: {} };
      yield { type: 'tool_use', id: 'broken-1', name: 'broken', input: {} };
    } else { yield { type: 'text', delta: '检查完成，发现一处问题。' }; }
    yield { type: 'done' };
  } };
  return { events, options: {
    agentDef: { name: 'inline', source: 'builtin' as const, systemPrompt: '' },
    sessionId: 'parent', adapter: () => adapter, createRegistry: () => registry,
    buildSystemPrompt: async () => 'PRIVATE_SYSTEM_PROMPT',
    onSubAgentEvent: (event: any) => events.push(event),
  } };
}

describe('subagent presentation from the real executor', () => {
  it('reports the actual task, settled tools, failure count and run duration', async () => {
    const { options, events } = fixture();
    await executeNamedSubAgent({ ...options, prompt: '检查队列与取消' });
    expect(events[0]).toMatchObject({ kind: 'started', task: '检查队列与取消', turn: 1, status: 'running' });
    expect(events.at(-1)).toMatchObject({ kind: 'finished', status: 'completed', toolsCompleted: 2, toolsFailed: 1, toolCounts: { inspect: 1, broken: 1 }, resultSummary: '检查完成，发现一处问题。' });
    expect(events.at(-1).elapsedMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(events)).not.toContain('PRIVATE_SYSTEM_PROMPT');
  });

  it('keeps the managed identity across followup and resets turn metrics', async () => {
    const { options, events } = fixture();
    const session = await createNamedSubAgentSession({ ...options, runtimeAgentId: 'agent_managed', taskDescription: '检查生命周期' });
    await session.run('first');
    await session.run('followup');
    expect(events.filter(e => e.kind === 'started').map(e => [e.agentId, e.turn, e.task])).toEqual([
      ['agent_managed', 1, '检查生命周期'], ['agent_managed', 2, 'followup'],
    ]);
    expect(events.at(-1)).toMatchObject({ toolsCompleted: 0, toolsFailed: 0, turn: 2 });
    await session.dispose();
  });

  it('distinguishes concurrent anonymous instances with the same name', async () => {
    const a = fixture(); const b = fixture();
    await Promise.all([executeNamedSubAgent({ ...a.options, prompt: 'a' }), executeNamedSubAgent({ ...b.options, prompt: 'b' })]);
    expect(a.events[0].agentId).not.toBe(b.events[0].agentId);
  });

  it('counts separate executions even when the provider reuses an invocation id', async () => {
    let requests = 0;
    const { options, events } = fixture(async function* () {
      if (requests++ < 2) yield { type: 'tool_use', id: 'reused', name: 'inspect', input: {} };
      else yield { type: 'text', delta: 'done' };
      yield { type: 'done' };
    });
    await executeNamedSubAgent({ ...options, prompt: 'two inspections' });
    expect(events.at(-1)).toMatchObject({ toolsCompleted: 2, toolCounts: { inspect: 2 } });
  });

  it('reports provider failure and interruption without claiming completion', async () => {
    const failed = fixture(async function* () { throw new Error('provider failed'); });
    await expect(executeNamedSubAgent({ ...failed.options, prompt: 'fail' })).rejects.toThrow('provider failed');
    expect(failed.events.at(-1)).toMatchObject({ kind: 'finished', status: 'failed', toolsCompleted: 0 });
    const controller = new AbortController();
    const cancelled = fixture(async function* () { controller.abort(); throw controller.signal.reason; });
    await expect(executeNamedSubAgent({ ...cancelled.options, signal: controller.signal, prompt: 'cancel' })).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancelled.events.at(-1)).toMatchObject({ kind: 'finished', status: 'interrupted' });
  });

  it('does not report a stuck run as finished, and observer errors do not break cleanup', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const { options, events } = fixture(async function* () { await gate; yield { type: 'text', delta: 'done' }; yield { type: 'done' }; });
    const running = executeNamedSubAgent({ ...options, prompt: 'wait' });
    await vi.waitFor(() => expect(events.some(e => e.kind === 'started')).toBe(true));
    expect(events.some(e => e.kind === 'finished')).toBe(false);
    release(); await running;
    const observerFailure = fixture();
    await expect(executeNamedSubAgent({ ...observerFailure.options, prompt: 'safe', onSubAgentEvent: () => { throw new Error('UI failure'); } })).resolves.toContain('检查完成');
  });
});
