import { describe, expect, it, vi } from 'vitest';
import { AgentSessionState } from '../../../src/ai/runtime/session.js';
import { projectStrictToolExecutionContext } from '../../../src/ai/runtime/provider-private-projection.js';
import { createNamedSubAgentSession } from '../../../src/ai/agents/subagent-executor.js';
import { createAdapterFromBinding } from '../../../src/ai/models.js';
import type { OpenAIAdapter } from '../../../src/ai/adapters/openai.js';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import type { ToolExecutionContext } from '../../../src/types.js';
const ref = { authorityId: 'af14bafe-0b46-42df-93c3-7fb27e36379a', profileId: 'profile', sourceSessionId: 'source', ownerAgentId: 'owner', scopeId: 'scope', permissionGeneration: 1,
  observationId: 'HOST_ONLY_OBSERVATION_ID', contentHash: 'a'.repeat(64), revision: 2, policyId: 'policy', policyRevision: 1 };
function context(protectedHistory = true): ToolExecutionContext {
  const session = new AgentSessionState(); session.appendUserText('derived protected history');
  if (protectedHistory) session.addProtectedObservationReferences([ref]);
  return { taskId: 'task', session: session.exportSnapshot(), messages: session.getMessages(), systemPrompt: 'system', toolDefinitions: [] };
}
describe('protected closure through strict provider projection', () => {
  it('accepts the new optional host snapshot field for ordinary history', () => {
    expect(() => projectStrictToolExecutionContext(context(false))).not.toThrow();
  });
  it('preserves and freezes host-only closure but never inserts it in provider DTO fields', () => {
    const input = context(); const projected = projectStrictToolExecutionContext(input);
    expect(projected.session.protectedObservationClosure).toEqual(input.session.protectedObservationClosure);
    expect(Object.isFrozen(projected.session.protectedObservationClosure)).toBe(true);
    expect(JSON.stringify({ messages: projected.messages, tools: projected.toolDefinitions, system: projected.systemPrompt })).not.toContain(ref.observationId);
    const child = new AgentSessionState(); child.restoreSnapshot(projected.session);
    expect(child.getProtectedObservationClosure()).toEqual(input.session.protectedObservationClosure);
  });
  it('rejects malformed or accessor-based protected metadata', () => {
    const input = context(); (input.session.protectedObservationClosure as any).requiresReauthorization = false;
    expect(() => projectStrictToolExecutionContext(input)).toThrow();
    const accessor = context(); const getter = vi.fn(() => ref.observationId);
    Object.defineProperty(accessor.session.protectedObservationClosure!.observations[0], 'observationId', { enumerable: true, get: getter });
    expect(() => projectStrictToolExecutionContext(accessor)).toThrow(); expect(getter).not.toHaveBeenCalled();
  });
  it('keeps strict K3 synthesized child history blocked instead of losing its parent closure', async () => {
    const adapter = createAdapterFromBinding({ providerId: 'kimi', providerType: 'first_party', modelId: 'k3', wireModel: 'k3', protocol: 'openai_legacy', apiKey: 'sk-test', baseUrl: 'https://api.kimi.com/coding/v1', headers: {}, capabilities: ['tools', 'thinking'] }) as OpenAIAdapter;
    const send = vi.spyOn(adapter.client.chat.completions, 'create').mockImplementation((async () => (async function* () {
      yield { choices: [{ index: 0, delta: { content: 'unexpected send' }, finish_reason: 'stop' }] };
    })()) as never);
    const child = await createNamedSubAgentSession({ agentDef: { name: 'protected-child', systemPrompt: 'child', maxIterations: 1 }, sessionId: 'parent', cwd: process.cwd(), adapter: () => adapter,
      createRegistry: () => new ToolRegistry({ autoMode: true }, []), buildSystemPrompt: async () => 'child', forkContext: context() });
    try { await expect(child.run('child task')).rejects.toThrow('SOL_PI_PROTECTED_OBSERVATION_REAUTHORIZATION_REQUIRED'); expect(send).not.toHaveBeenCalled(); }
    finally { await child.dispose(); send.mockRestore(); }
  });
});
