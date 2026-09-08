import { describe, expect, it, vi } from 'vitest';
import { createMultiAgentCoordinator } from '../../../src/ai/agents/multi-agent-coordinator.js';
import { createNamedSubAgentSession } from '../../../src/ai/agents/subagent-executor.js';
import { ToolRegistry } from '../../../src/ai/tools/index.js';

const caller = { requestSource: 'agent' as const, callerId: 'main' };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

describe('queued followup during production session suspension', () => {
  it.each(['failed', 'completed'] as const)('fences queued work correctly when suspension %s', async (outcome) => {
    const releasing = deferred<void>();
    const releaseGate = deferred<void>();
    const requests: string[] = [];
    let releases = 0;
    const coordinator = createMultiAgentCoordinator({ maxResidentAgents: 2, closeSettlementTimeoutMs: 5 });
    const child = await coordinator.spawn({ ...caller, taskName: 'suspending', message: 'first task',
      createSession: () => createNamedSubAgentSession({
        agentDef: { name: 'suspending', systemPrompt: '', source: 'builtin' }, sessionId: 'suspending',
        adapter: () => ({ getModelName: () => 'fixture', async *stream(messages) {
          requests.push(JSON.stringify(messages));
          yield { type: 'text' as const, delta: 'completed task' };
          yield { type: 'done' as const };
        } }),
        createRegistry: () => new ToolRegistry({}, []),
        releaseRegistry: async (registry) => {
          if (++releases === 1) { releasing.resolve(); await releaseGate.promise; }
          registry.dispose();
        },
        buildSystemPrompt: async () => 'fixture',
      }),
    });
    await releasing.promise;
    coordinator.followupTask({ ...caller, target: child.id, message: 'queued while suspending' });
    try {
      if (outcome === 'failed') releaseGate.reject(new Error('registry teardown failed'));
      else releaseGate.resolve();
      await vi.waitFor(() => expect(coordinator.listAgents(caller).find((item) => item.id === child.id)?.executionActive).toBe(false));
      if (outcome === 'failed') {
        expect(requests).toHaveLength(1);
        expect(coordinator.listAgents(caller)).toContainEqual(expect.objectContaining({
          id: child.id, turn: 1, status: 'failed', runtimeResident: true, resourcesReleased: false,
          cleanupError: 'registry teardown failed', error: expect.stringContaining('MULTI_AGENT_SUSPEND_FAILED'),
        }));
        expect(() => coordinator.followupTask({ ...caller, target: child.id, message: 'another retry' })).toThrow('cleanup failed');
        const result = await coordinator.waitForUpdate({ ...caller, targets: [child.id], timeoutMs: 10 });
        expect(result.messages).toContainEqual(expect.objectContaining({ kind: 'error', text: expect.stringContaining('MULTI_AGENT_SUSPEND_FAILED') }));
      } else {
        expect(requests).toHaveLength(2);
        expect(requests[1]).toContain('first task');
        expect(requests[1]).toContain('queued while suspending');
        expect(coordinator.listAgents(caller)).toContainEqual(expect.objectContaining({ id: child.id, turn: 2, status: 'completed', runtimeResident: false }));
      }
    } finally {
      await coordinator.dispose();
    }
  });
});
