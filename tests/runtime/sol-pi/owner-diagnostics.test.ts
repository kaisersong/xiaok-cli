import { describe, expect, it, vi } from 'vitest';
import { AgentRuntime } from '../../../src/ai/runtime/agent-runtime.js';
import { AgentRunController } from '../../../src/ai/runtime/controller.js';
import { AgentSessionState } from '../../../src/ai/runtime/session.js';
import { ToolRegistry } from '../../../src/ai/tools/index.js';

describe('semantic compaction diagnostics in actual AgentRuntime owner', () => {
  it.each([false, true])('consumes a host boundary once and keeps executor closed (revision drift=%s)', async drift => {
    const session = new AgentSessionState(); const registry = new ToolRegistry({ autoMode: true }, []);
    const onDecision = vi.fn(); let notified = false;
    const runtime: AgentRuntime = new AgentRuntime({ session, registry, controller: new AgentRunController(), systemPrompt: 'system',
      adapter: { getModelName: () => 'test', stream: async function* () { yield { type: 'text', delta: 'done' }; yield { type: 'done' }; } },
      onSemanticCompactionDecision: onDecision,
      takePendingInput: () => { if (!notified) { notified = true; runtime.notifySubtaskBoundary(); return drift ? 'new correction' : undefined; } return undefined; },
    });
    try { await runtime.run('task', () => {});
      expect(onDecision).toHaveBeenCalledOnce(); expect(onDecision.mock.calls[0]?.[0]).toMatchObject({ action: 'skip' });
      expect(session.getCompactions()).toHaveLength(0);
      await runtime.run('next task', () => {}); expect(onDecision).toHaveBeenCalledOnce();
    } finally { registry.dispose(); }
  });
});

it('forwards host completion diagnostics through the production Agent wrapper', async () => {
  const { Agent } = await import('../../../src/ai/agent.js');
  const registry = new ToolRegistry({ autoMode: true }, []); const onDecision = vi.fn();
  let agent: InstanceType<typeof Agent>; let notified = false;
  agent = new Agent({ getModelName: () => 'test', stream: async function* () { yield { type: 'text', delta: 'done' }; yield { type: 'done' }; } }, registry, 'system', {
    onSemanticCompactionDecision: onDecision,
    takePendingInput: () => { if (!notified) { notified = true; agent.notifySubtaskBoundary(); } return undefined; },
  });
  try { await agent.runTurn('task', () => {}); expect(onDecision).toHaveBeenCalledOnce();
    expect(onDecision.mock.calls[0]?.[0]).toMatchObject({ action: 'skip' });
  } finally { registry.dispose(); }
});
