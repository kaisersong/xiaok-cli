import { describe, expect, it, vi } from 'vitest';
import type { Message, MessageBlock, ToolExecutionContext } from '../../../src/types.js';
import { AgentSessionState } from '../../../src/ai/runtime/session.js';
import { createNamedSubAgentSession, executeNamedSubAgent } from '../../../src/ai/agents/subagent-executor.js';
import { createAdapterFromBinding } from '../../../src/ai/models.js';
import type { OpenAIAdapter } from '../../../src/ai/adapters/openai.js';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import { assertOpenAIToolProtocol, type OpenAIToolProtocolMessage } from '../../support/openai-tool-protocol.js';

function forkContext(tail: Message[] = []): ToolExecutionContext {
  const parent = new AgentSessionState();
  parent.appendUserBlocks([{ type: 'text', text: 'PARENT_CONSTRAINT_READ_ONLY' }]);
  parent.appendAssistantBlocks([{ type: 'tool_use', id: 'read_completed', name: 'read', input: {} }]);
  parent.appendUserToolResults([{ type: 'tool_result', tool_use_id: 'read_completed', content: 'PARENT_FILE_FACT_7K9' }]);
  const session = parent.exportSnapshot();
  session.messages.push(...tail);
  return { session, messages: session.messages, systemPrompt: 'parent', toolDefinitions: [] };
}

const pendingCalls: Message = {
  role: 'assistant',
  content: [
    { type: 'text', text: 'IN_FLIGHT_DELEGATION' },
    { type: 'tool_use', id: 'spawn_a', name: 'spawn_agent', input: { task_name: 'a' } },
    { type: 'tool_use', id: 'spawn_b', name: 'spawn_agent', input: { task_name: 'b' } },
  ],
};
const result = (id: string): MessageBlock => ({ type: 'tool_result', tool_use_id: id, content: `result_${id}` });

function createHarness(context?: ToolExecutionContext) {
  const requests: OpenAIToolProtocolMessage[][] = [];
  const adapter = createAdapterFromBinding({
    providerId: 'test', providerType: 'custom', modelId: 'test', wireModel: 'test-model',
    protocol: 'openai_legacy', apiKey: 'test-key', baseUrl: 'http://127.0.0.1:1/v1',
    headers: {}, capabilities: ['tools'],
  }) as OpenAIAdapter;
  // Keep the real executor, Agent, authorization wrapper and OpenAI serialization.
  vi.spyOn(adapter.client.chat.completions, 'create').mockImplementation((async (request: { messages: OpenAIToolProtocolMessage[] }) => {
    requests.push(structuredClone(request.messages));
    assertOpenAIToolProtocol(request.messages);
    return (async function* () {
      yield { choices: [{ index: 0, delta: { content: 'CHILD_RESULT_42' }, finish_reason: null }] };
      yield { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
    })();
  }) as never);
  const releaseRegistry = vi.fn();
  return {
    requests, releaseRegistry,
    options: {
      agentDef: { name: 'fork_test', systemPrompt: 'child', maxIterations: 2 },
      sessionId: 'parent-test', cwd: process.cwd(), adapter: () => adapter,
      createRegistry: () => new ToolRegistry({ autoMode: true }, []),
      buildSystemPrompt: async () => 'child system', releaseRegistry, forkContext: context,
    },
  };
}

describe('subagent fork history through real Agent and OpenAI serialization', () => {
  it.each([
    ['missing all results', []],
    ['partial results', [result('spawn_a')]],
    ['wrong result ID', [result('spawn_a'), result('other')]],
    ['duplicate result ID', [result('spawn_a'), result('spawn_a')]],
  ] as const)('excludes the whole unfinished exchange: %s', async (_label, results) => {
    const context = forkContext([pendingCalls, ...(results.length ? [{ role: 'user' as const, content: [...results] }] : [])]);
    const original = structuredClone(context);
    const harness = createHarness(context);
    const child = await createNamedSubAgentSession(harness.options);
    try {
      await expect(child.run('first child task')).resolves.toBe('CHILD_RESULT_42');
      await expect(child.run('followup child task')).resolves.toBe('CHILD_RESULT_42');
      expect(harness.requests).toHaveLength(2);
      for (const request of harness.requests) {
        const text = JSON.stringify(request);
        expect(text).toContain('PARENT_CONSTRAINT_READ_ONLY');
        expect(text).toContain('PARENT_FILE_FACT_7K9');
        expect(text).not.toContain('IN_FLIGHT_DELEGATION');
        expect(text).not.toContain('spawn_a');
        expect(text).not.toContain('spawn_b');
      }
      expect(JSON.stringify(harness.requests[1])).toContain('first child task');
      expect(JSON.stringify(harness.requests[1])).toContain('CHILD_RESULT_42');
      expect(context).toEqual(original);
    } finally {
      await child.dispose();
    }
    expect(harness.releaseRegistry).toHaveBeenCalledOnce();
  });

  it('preserves completed exchanges and ordinary history without changing the parent', async () => {
    const context = forkContext([pendingCalls, { role: 'user', content: [result('spawn_a'), result('spawn_b')] },
      { role: 'assistant', content: [{ type: 'text', text: 'PARENT_COMPLETED' }] }]);
    const original = structuredClone(context);
    const harness = createHarness(context);
    const child = await createNamedSubAgentSession(harness.options);
    try {
      await expect(child.run('child task')).resolves.toBe('CHILD_RESULT_42');
      expect(JSON.stringify(harness.requests[0])).toContain('result_spawn_b');
      expect(JSON.stringify(harness.requests[0])).toContain('PARENT_COMPLETED');
      expect(context).toEqual(original);
    } finally { await child.dispose(); }
  });

  it('also fixes the legacy one-shot subagent entry and leaves no-fork unchanged', async () => {
    const inherited = createHarness(forkContext([pendingCalls]));
    await expect(executeNamedSubAgent({ ...inherited.options, prompt: 'one-shot task' })).resolves.toBe('CHILD_RESULT_42');
    expect(inherited.releaseRegistry).toHaveBeenCalledOnce();
    const isolated = createHarness();
    await expect(executeNamedSubAgent({ ...isolated.options, prompt: 'isolated task' })).resolves.toBe('CHILD_RESULT_42');
    expect(JSON.stringify(isolated.requests)).not.toContain('PARENT_');
  });

  it('the wire validator rejects dangling, orphan and duplicate results', () => {
    const call = { role: 'assistant', tool_calls: [{ id: 'a' }, { id: 'b' }] };
    const a = { role: 'tool', tool_call_id: 'a' };
    expect(() => assertOpenAIToolProtocol([call])).toThrow('missing tool results');
    expect(() => assertOpenAIToolProtocol([call, a, { role: 'user' }])).toThrow('missing tool results');
    expect(() => assertOpenAIToolProtocol([a])).toThrow('unexpected tool result');
    expect(() => assertOpenAIToolProtocol([call, a, a])).toThrow('unexpected tool result');
    expect(() => assertOpenAIToolProtocol([call, a, { role: 'tool', tool_call_id: 'b' }, { role: 'user' }])).not.toThrow();
  });
});
