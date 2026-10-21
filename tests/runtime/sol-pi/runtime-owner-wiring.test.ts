import { describe, expect, it, vi } from 'vitest';
import { AgentRuntime } from '../../../src/ai/runtime/agent-runtime.js';
import { AgentSessionState } from '../../../src/ai/runtime/session.js';
import { AgentRunController } from '../../../src/ai/runtime/controller.js';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import { hasObservationExecutionOwner } from '../../../src/runtime/sol-pi/observation-execution-scope.js';
import type { ObservationSessionOwner } from '../../../src/runtime/sol-pi/observation-session-owner.js';
import type { ModelAdapter, StreamChunk, ToolExecutionContext } from '../../../src/types.js';

describe('runtime optional observation owner wiring', () => {
  it('binds the whole run and projects per-call result before spill/history', async () => {
    const session = new AgentSessionState(); let seen: ToolExecutionContext | undefined; let requests = 0;
    const collector = { begin: vi.fn(() => ({ append() {}, finalize() {} })) };
    const owner = {
      assertSession: vi.fn((actual: AgentSessionState) => { expect(actual).toBe(session); }),
      collectorFor: vi.fn(() => collector), projectToolResult: vi.fn(async () => 'authorized-preview'),
      getResultProvenance: vi.fn(() => undefined), finalizeToolResult: vi.fn(() => undefined),
      hasDependencies: () => false, ownsDisclosure: () => false, prepareProviderDisclosure: () => undefined,
    };
    const registry = new ToolRegistry({ autoMode: true }, [{
      permission: 'safe', definition: { name: 'read', description: 'test', inputSchema: { type: 'object', properties: {} } },
      execute: async (_input, context) => { seen = context; expect(hasObservationExecutionOwner()).toBe(true); return 'RAW_SECRET'.repeat(10000); },
    }]);
    const adapter: ModelAdapter = { getModelName: () => 'test', async *stream(): AsyncIterable<StreamChunk> {
      expect(hasObservationExecutionOwner()).toBe(true);
      if (requests++ === 0) yield { type: 'tool_use', id: 'call-owner-1', name: 'read', input: {} };
      else yield { type: 'text', delta: 'done' };
      yield { type: 'done' };
    } };
    const runtime = new AgentRuntime({ session, registry, adapter, controller: new AgentRunController(), systemPrompt: 'test',
      observationOwner: owner as unknown as ObservationSessionOwner });
    await runtime.run('go', () => {});
    expect(owner.assertSession).toHaveBeenCalledWith(session);
    expect(owner.collectorFor).toHaveBeenCalledWith('call-owner-1'); expect(seen?.observationCollector).toBe(collector);
    expect(owner.projectToolResult).toHaveBeenCalledWith('call-owner-1', expect.stringContaining('RAW_SECRET'));
    expect(owner.finalizeToolResult).toHaveBeenCalledWith('call-owner-1', 'authorized-preview');
    const results = session.getMessages().flatMap(message => message.content).filter(block => block.type === 'tool_result');
    expect(results).toEqual([expect.objectContaining({ content: 'authorized-preview', is_error: false })]);
    expect(hasObservationExecutionOwner()).toBe(false);
  });

  it('blocks protected restored history without owner before any provider call', async () => {
    const session = new AgentSessionState();
    session.addProtectedObservationReferences([{ authorityId: '00000000-0000-4000-8000-000000000001', profileId: 'p', sourceSessionId: 's',
      ownerAgentId: 'a', scopeId: 'scope', permissionGeneration: 0, observationId: 'obs', contentHash: 'a'.repeat(64), revision: 1, policyId: 'policy', policyRevision: 1 }]);
    const stream = vi.fn(async function* () { yield { type: 'done' as const }; });
    const runtime = new AgentRuntime({ session, registry: new ToolRegistry({ autoMode: true }, []),
      adapter: { getModelName: () => 'test', stream }, controller: new AgentRunController(), systemPrompt: 'test' });
    await expect(runtime.run('continue', () => {})).rejects.toThrow(/OBSERVATION|observation/);
    expect(stream).not.toHaveBeenCalled();
  });

  it('keeps completed tool fact and pairing when publishing observation fails, without replay or raw body', async () => {
    const session = new AgentSessionState(); const execute = vi.fn(async () => 'PRIVATE_RAW_RESULT');
    const registry = new ToolRegistry({ autoMode: true }, [{ permission: 'safe', definition: { name: 'read', description: 'test', inputSchema: {} }, execute }]);
    const stream = vi.fn(async function* (): AsyncIterable<StreamChunk> {
      yield { type: 'tool_use', id: 'finished-call', name: 'read', input: {} }; yield { type: 'done' };
    });
    const owner = { assertSession() {}, collectorFor: () => undefined, hasDependencies: () => false,
      projectToolResult: async () => { throw new Error('disclosure-blocked'); } } as unknown as ObservationSessionOwner;
    const runtime = new AgentRuntime({ session, registry, adapter: { getModelName: () => 'test', stream },
      controller: new AgentRunController(), systemPrompt: 'test', observationOwner: owner });
    await expect(runtime.run('go', () => {})).rejects.toThrow('disclosure-blocked');
    const results = session.getMessages().flatMap(message => message.content).filter(block => block.type === 'tool_result');
    expect(results).toEqual([expect.objectContaining({ tool_use_id: 'finished-call', is_error: false, content: expect.stringContaining('disclosure blocked') })]);
    expect(JSON.stringify(session.getMessages())).not.toContain('PRIVATE_RAW_RESULT');
    expect(execute).toHaveBeenCalledOnce(); expect(stream).toHaveBeenCalledOnce();
  });

  it('does not treat child as an ordinary owner with delegated authority', async () => {
    const stream = vi.fn(async function* () { yield { type: 'done' as const }; });
    const owner = { assertSession: vi.fn(), hasDependencies: () => false } as unknown as ObservationSessionOwner;
    const runtime = new AgentRuntime({ session: new AgentSessionState(), registry: new ToolRegistry({ autoMode: true }, []),
      adapter: { getModelName: () => 'test', stream }, controller: new AgentRunController(), systemPrompt: 'test',
      providerSurfaceKind: 'cli-subagent', observationOwner: owner });
    await expect(runtime.run('go', () => {})).rejects.toThrow(/AUTHORIZATION/);
    expect(stream).not.toHaveBeenCalled();
  });
});
