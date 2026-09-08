import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMultiAgentCoordinator, type ManagedAgentRunContext, type ManagedAgentSession } from '../../../src/ai/agents/multi-agent-coordinator.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('multi-agent progress and bounded execution', () => {
  afterEach(() => vi.useRealTimers());

  it('fails an abort-insensitive run, wakes wait, and keeps resources until physical settlement', async () => {
    vi.useFakeTimers();
    const gate = deferred<string>();
    const dispose = vi.fn(async () => {});
    let signal: AbortSignal | undefined;
    let runContext: ManagedAgentRunContext | undefined;
    const coordinator = createMultiAgentCoordinator({ idleTimeoutMs: 100, turnTimeoutMs: 500, closeSettlementTimeoutMs: 1 });
    const child = await coordinator.spawn({ requestSource: 'agent', callerId: 'main', taskName: 'stuck', message: 'run',
      createSession: async () => ({ run: (_message, nextSignal, context) => {
        signal = nextSignal; runContext = context; return gate.promise;
      }, dispose }),
    });
    const waiting = coordinator.waitForUpdate({ requestSource: 'agent', callerId: 'main', targets: [child.id], timeoutMs: 10_000 });
    await vi.advanceTimersByTimeAsync(101);
    const update = await waiting;
    expect(update).toMatchObject({ timedOut: false, agents: [{ status: 'failed', executionActive: true, resourcesReleased: false }] });
    expect(update.agents[0].error).toContain('MULTI_AGENT_IDLE_TIMEOUT');
    expect(update.messages).toContainEqual(expect.objectContaining({ kind: 'error' }));
    expect(signal?.aborted).toBe(true);
    expect(() => coordinator.followupTask({ requestSource: 'agent', callerId: 'main', target: child.id, message: 'retry' })).toThrow(/settling/);
    runContext?.onActivity({ phase: 'tool', toolName: 'late_tool' });
    expect(coordinator.listAgents({ requestSource: 'user', callerId: 'main' })[1].currentTool).not.toBe('late_tool');
    const closing = coordinator.closeAgent({ requestSource: 'agent', callerId: 'main', target: child.id });
    await vi.advanceTimersByTimeAsync(2);
    await closing;
    expect(dispose).not.toHaveBeenCalled();
    gate.resolve('late success');
    await vi.advanceTimersByTimeAsync(0);
    expect(dispose).toHaveBeenCalledOnce();
    expect(coordinator.listAgents({ requestSource: 'user', callerId: 'main' })[1]).toMatchObject({ status: 'closed', resourcesReleased: true });
    await coordinator.dispose();
  });

  it('times out session initialization too and never starts a late-created session', async () => {
    vi.useFakeTimers();
    const gate = deferred<ManagedAgentSession>();
    const run = vi.fn(async () => 'must not run');
    const coordinator = createMultiAgentCoordinator({ idleTimeoutMs: 50, turnTimeoutMs: 500 });
    const child = await coordinator.spawn({ requestSource: 'agent', callerId: 'main', taskName: 'init', message: 'run', createSession: () => gate.promise });
    await vi.advanceTimersByTimeAsync(51);
    expect(coordinator.listAgents({ requestSource: 'user', callerId: 'main' })[1]).toMatchObject({ status: 'failed', phase: 'starting' });
    gate.resolve({ run, dispose: async () => {} });
    await vi.advanceTimersByTimeAsync(0);
    expect(run).not.toHaveBeenCalled();
    expect(coordinator.listAgents({ requestSource: 'user', callerId: 'main' })[1]).toMatchObject({ status: 'failed', executionActive: false });
    await coordinator.closeAgent({ requestSource: 'agent', callerId: 'main', target: child.id });
    await coordinator.dispose();
  });

  it('only real activity extends the idle deadline and never extends the total deadline', async () => {
    vi.useFakeTimers();
    const gate = deferred<string>();
    let context!: ManagedAgentRunContext;
    const coordinator = createMultiAgentCoordinator({ idleTimeoutMs: 100, turnTimeoutMs: 250 });
    const child = await coordinator.spawn({ requestSource: 'agent', callerId: 'main', taskName: 'active', message: 'run',
      createSession: async () => ({ run: (_message, _signal, ctx) => { context = ctx!; return gate.promise; }, dispose: async () => {} }),
    });
    for (let index = 0; index < 3; index++) {
      await vi.advanceTimersByTimeAsync(80);
      context.onActivity({ phase: 'thinking' });
    }
    expect(coordinator.listAgents({ requestSource: 'user', callerId: 'main' })[1].status).toBe('running');
    await vi.advanceTimersByTimeAsync(11);
    expect(coordinator.listAgents({ requestSource: 'user', callerId: 'main' })[1].error).toContain('MULTI_AGENT_TURN_TIMEOUT');
    gate.resolve('late success');
    await vi.advanceTimersByTimeAsync(0);
    expect(coordinator.listAgents({ requestSource: 'user', callerId: 'main' })[1]).toMatchObject({ status: 'failed', executionActive: false });
    await coordinator.dispose();
  });

  it('does not treat main messages as progress and records sent/consumed message IDs', async () => {
    vi.useFakeTimers();
    const gate = deferred<string>();
    let context!: ManagedAgentRunContext;
    const events: unknown[] = [];
    const coordinator = createMultiAgentCoordinator({ idleTimeoutMs: 100, turnTimeoutMs: 500, onEvent: (event) => events.push(event) });
    const child = await coordinator.spawn({ requestSource: 'agent', callerId: 'main', taskName: 'inbox', message: 'run',
      createSession: async () => ({ run: (_message, _signal, ctx) => { context = ctx!; return gate.promise; }, dispose: async () => {} }),
    });
    await vi.advanceTimersByTimeAsync(60);
    const sent = coordinator.sendMessage({ requestSource: 'agent', callerId: 'main', target: child.id, message: 'please finish' });
    expect(context.takePendingInput()).toContain('please finish');
    expect(context.takePendingInput()).toBeUndefined();
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'message_sent', message: expect.objectContaining({ messageId: sent.messageId }) }),
      expect.objectContaining({ kind: 'message_consumed', message: expect.objectContaining({ messageId: sent.messageId }) }),
    ]));
    await vi.advanceTimersByTimeAsync(41);
    expect(coordinator.listAgents({ requestSource: 'user', callerId: 'main' })[1].status).toBe('failed');
    expect(context.takePendingInput()).toBeUndefined();
    gate.resolve('late');
    await vi.advanceTimersByTimeAsync(0);
    await coordinator.dispose();
  });

  it('ignores stale callbacks after followup, resets activity per turn and isolates observer errors', async () => {
    const contexts: ManagedAgentRunContext[] = [];
    const coordinator = createMultiAgentCoordinator({ onEvent: () => { throw new Error('observer down'); } });
    const child = await coordinator.spawn({ requestSource: 'agent', callerId: 'main', taskName: 'reuse', message: 'first',
      createSession: async () => ({ run: async (_message, _signal, ctx) => { contexts.push(ctx!); ctx!.onActivity({ phase: 'tool', toolName: 'read' }); return 'done'; }, dispose: async () => {} }),
    });
    await new Promise(setImmediate);
    coordinator.followupTask({ requestSource: 'agent', callerId: 'main', target: child.id, message: 'next' });
    await new Promise(setImmediate);
    contexts[0].onActivity({ phase: 'tool', toolName: 'stale' });
    expect(coordinator.listAgents({ requestSource: 'user', callerId: 'main' })[1]).toMatchObject({ status: 'completed', turn: 2, executionActive: false });
    expect(coordinator.listAgents({ requestSource: 'user', callerId: 'main' })[1].currentTool).not.toBe('stale');
    await coordinator.dispose();
  });
});
