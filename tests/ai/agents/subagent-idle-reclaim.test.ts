import { describe, expect, it, vi } from 'vitest';
import { createMultiAgentCoordinator } from '../../../src/ai/agents/multi-agent-coordinator.js';
import { createNamedSubAgentSession } from '../../../src/ai/agents/subagent-executor.js';
import { CapabilityRegistry } from '../../../src/platform/runtime/capability-registry.js';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import type { Message, ModelAdapter } from '../../../src/types.js';

const caller = { requestSource: 'agent' as const, callerId: 'main' };
describe('idle production subagent reclamation', () => {
  it.each(['completed', 'failed', 'interrupted'] as const)('releases %s runtime resources while preserving followup history', async (outcome) => {
    const capabilities = new CapabilityRegistry();
    const requests: Message[][] = [];
    let signal: AbortSignal | undefined;
    const adapter: ModelAdapter = { getModelName: () => 'fixture', async *stream(messages, _tools, _prompt, options) {
      requests.push(structuredClone(messages));
      if (requests.length === 1 && outcome === 'failed') throw new Error('first turn failed');
      if (requests.length === 1 && outcome === 'interrupted') {
        signal = options?.signal;
        await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve(), { once: true }));
      }
      yield { type: 'text', delta: 'saved response' };
      yield { type: 'done' };
    } };
    const registries: ToolRegistry[] = [];
    const coordinator = createMultiAgentCoordinator({ maxResidentAgents: 2 });
    const child = await coordinator.spawn({ ...caller, taskName: 'idle', message: 'first task', createSession: () => createNamedSubAgentSession({
      agentDef: { name: 'idle', systemPrompt: '', source: 'builtin' }, sessionId: 'idle', adapter: () => adapter,
      createRegistry: () => { const registry = new ToolRegistry({ capabilityRegistry: capabilities }, []); registries.push(registry); return registry; },
      releaseRegistry: (registry) => registry.dispose(), buildSystemPrompt: async () => 'test',
    }) });
    if (outcome === 'interrupted') {
      await vi.waitFor(() => expect(signal).toBeDefined());
      coordinator.interruptAgent({ ...caller, target: child.id });
    }
    await vi.waitFor(() => expect(coordinator.listAgents(caller)).toContainEqual(expect.objectContaining({ id: child.id, status: outcome, runtimeResident: false, executionActive: false })));
    expect(capabilities.search('')).toEqual([]);
    expect(registries[0].getToolDefinitions()).toEqual([]);
    coordinator.followupTask({ ...caller, target: child.id, message: 'second task' });
    await vi.waitFor(() => expect(coordinator.listAgents(caller)).toContainEqual(expect.objectContaining({ id: child.id, status: 'completed', turn: 2, runtimeResident: false })));
    expect(registries).toHaveLength(2);
    expect(JSON.stringify(requests.at(-1))).toContain('first task');
    expect(JSON.stringify(requests.at(-1))).toContain('second task');
    if (outcome === 'completed') expect(JSON.stringify(requests.at(-1))).toContain('saved response');
    await coordinator.dispose();
  });

  it('admits new work after idle reclamation and prevents old IDs bypassing full runtime capacity', async () => {
    const coordinator = createMultiAgentCoordinator({ maxResidentAgents: 2 });
    const createSession = async () => createNamedSubAgentSession({ agentDef: { name: 'idle', systemPrompt: '', source: 'builtin' }, sessionId: 'idle',
      adapter: () => ({ getModelName: () => 'fixture', async *stream() { yield { type: 'text' as const, delta: 'done' }; yield { type: 'done' as const }; } }),
      createRegistry: () => new ToolRegistry({}, []), releaseRegistry: (registry) => registry.dispose(), buildSystemPrompt: async () => 'test',
    });
    const idle = await coordinator.spawn({ ...caller, taskName: 'idle', message: 'first', createSession });
    await vi.waitFor(() => expect(coordinator.listAgents(caller)).toContainEqual(expect.objectContaining({ id: idle.id, runtimeResident: false })));
    const busy = await coordinator.spawn({ ...caller, taskName: 'busy', message: 'wait', createSession: async () => ({
      run: (_message, signal) => new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new DOMException('abort', 'AbortError')), { once: true })),
      dispose: async () => {},
    }) });
    expect(() => coordinator.followupTask({ ...caller, target: idle.id, message: 'bypass' })).toThrow('capacity');
    await coordinator.closeAgent({ ...caller, target: busy.id });
    coordinator.followupTask({ ...caller, target: idle.id, message: 'allowed' });
    await vi.waitFor(() => expect(coordinator.listAgents(caller)).toContainEqual(expect.objectContaining({ id: idle.id, turn: 2, runtimeResident: false })));
    await coordinator.dispose();
  });
});
