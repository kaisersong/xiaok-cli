import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeAdapter } from '../../../src/ai/adapters/claude.js';
import { OpenAIResponsesAdapter } from '../../../src/ai/adapters/openai-responses.js';
import { OpenAIAdapter } from '../../../src/ai/adapters/openai.js';
import { buildOpenAIHarnessContext, resolveKimiHarnessFeatureFlags } from '../../../src/ai/providers/model-harness-profile.js';
import { AgentRuntime } from '../../../src/ai/runtime/agent-runtime.js';
import { AgentSessionState } from '../../../src/ai/runtime/session.js';
import { AgentRunController } from '../../../src/ai/runtime/controller.js';
import { CompactRunner } from '../../../src/ai/runtime/compact-runner.js';
import type { Message, ModelAdapter, StreamChunk } from '../../../src/types.js';

const history: Message[] = [{ role: 'user', content: [{ type: 'text', text: 'keep the original task' }] }];
function claude(events: unknown[]): ClaudeAdapter {
  const adapter = new ClaudeAdapter('fixture', 'claude-opus-4-6');
  (adapter as unknown as { client: unknown }).client = {
    messages: { stream: vi.fn(() => ({ async *[Symbol.asyncIterator]() { yield* events; } })) },
  };
  return adapter;
}
const text = { type: 'content_block_delta', delta: { type: 'text_delta', text: 'partial summary' } };
const end = (reason: string) => ({ type: 'message_delta', delta: { stop_reason: reason }, usage: { output_tokens: 7 } });

describe('actual adapter to CompactRunner completion boundary', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(['max_tokens', 'model_context_window_exceeded', 'refusal', 'tool_use'])('rejects Claude %s with the default output reservation', async reason => {
    await expect(new CompactRunner(claude([text, end(reason), { type: 'message_stop' }])).run(history)).rejects.toThrow();
  });
  it('rejects Claude EOF without message_stop', async () => {
    await expect(new CompactRunner(claude([text, end('end_turn')])).run(history)).rejects.toThrow();
  });
  it('keeps a complete Claude summary', async () => {
    await expect(new CompactRunner(claude([text, end('end_turn'), { type: 'message_stop' }])).run(history)).resolves.toBe('partial summary');
  });
  it.each(['incomplete', 'failed', 'cancelled', undefined])('rejects Responses status %s without an explicit output limit', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status,
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'partial summary' }] }],
      usage: { input_tokens: 3, output_tokens: 7 },
    }), { status: 200 })));
    const adapter = new OpenAIResponsesAdapter('fixture', 'gpt-4o', 'https://fixture.invalid/v1');
    await expect(new CompactRunner(adapter).run(history)).rejects.toThrow();
  });
  it.each(['length', 'content_filter', 'tool_calls'])('rejects actual OpenAI %s and drains the usage trailer', async finish_reason => {
    let drained = false;
    const adapter = new OpenAIAdapter({ apiKey: 'fixture', kimiCodingHeadersApplied: false,
      harnessContext: buildOpenAIHarnessContext({ identity: { providerId: 'fixture', providerType: 'custom',
        protocol: 'openai_legacy', canonicalBaseUrl: 'https://fixture.invalid/v1', wireModel: 'fixture', capabilities: [] },
      flags: resolveKimiHarnessFeatureFlags({}) }) });
    const create = vi.spyOn(adapter.client.chat.completions, 'create').mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: 'partial summary' }, finish_reason }] };
        yield { choices: [], usage: { prompt_tokens: 3, completion_tokens: 7 } }; drained = true;
      },
    } as never);
    await expect(new CompactRunner(adapter).run(history)).rejects.toThrow();
    expect(drained).toBe(true); expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty('requireCompleteResponse');
  });

  it.each([
    [{ choices: [{ delta: { content: 'late' }, finish_reason: null }] }],
    [{ choices: [{ delta: {}, finish_reason: 'stop' }] }],
    [{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'late', function: { name: 'write', arguments: '{}' } }] }, finish_reason: null }] }],
  ])('rejects actual OpenAI post-terminal content or repeated finish %j', async trailer => {
    const adapter = new OpenAIAdapter({ apiKey: 'fixture', kimiCodingHeadersApplied: false,
      harnessContext: buildOpenAIHarnessContext({ identity: { providerId: 'fixture', providerType: 'custom',
        protocol: 'openai_legacy', canonicalBaseUrl: 'https://fixture.invalid/v1', wireModel: 'fixture', capabilities: [] },
      flags: resolveKimiHarnessFeatureFlags({}) }) });
    vi.spyOn(adapter.client.chat.completions, 'create').mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: 'summary' }, finish_reason: 'stop' }] };
        yield trailer;
      },
    } as never);
    await expect(new CompactRunner(adapter).run(history)).rejects.toThrow();
  });
  it('accepts actual OpenAI stop followed only by usage', async () => {
    const adapter = new OpenAIAdapter({ apiKey: 'fixture', kimiCodingHeadersApplied: false,
      harnessContext: buildOpenAIHarnessContext({ identity: { providerId: 'fixture', providerType: 'custom',
        protocol: 'openai_legacy', canonicalBaseUrl: 'https://fixture.invalid/v1', wireModel: 'fixture', capabilities: [] },
      flags: resolveKimiHarnessFeatureFlags({}) }) });
    vi.spyOn(adapter.client.chat.completions, 'create').mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: 'summary' }, finish_reason: 'stop' }] };
        yield { choices: [], usage: { prompt_tokens: 3, completion_tokens: 7 } };
      },
    } as never);
    await expect(new CompactRunner(adapter).run(history)).resolves.toBe('summary');
  });
  it.each([[{ type: 'message_stop' }], [text]])('rejects Claude content after its terminal %j', async trailer => {
    await expect(new CompactRunner(claude([text, end('end_turn'), { type: 'message_stop' }, trailer])).run(history)).rejects.toThrow();
  });
  it('keeps Claude usage-only trailers', async () => {
    await expect(new CompactRunner(claude([text, end('end_turn'), { type: 'message_stop' },
      { type: 'message_delta', delta: {}, usage: { output_tokens: 8 } }])).run(history)).resolves.toBe('partial summary');
  });
  it('accepts a completed Responses body without sending the internal policy', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'summary' }] }],
      usage: { input_tokens: 3, output_tokens: 7 },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await expect(new CompactRunner(new OpenAIResponsesAdapter('fixture', 'gpt-4o', 'https://fixture.invalid/v1')).run(history)).resolves.toBe('summary');
    expect(JSON.parse((fetch.mock.calls as unknown as Array<[unknown, RequestInit]>)[0]![1].body as string)).not.toHaveProperty('requireCompleteResponse');
  });
  it('routes a real Claude truncation through AgentRuntime fallback and honest failure events', async () => {
    const adapter = claude([]);
    let requests = 0;
    const create = vi.fn(() => {
      // AgentRuntime performs its summary request before the normal turn.
      const compact = requests++ === 0;
      return { async *[Symbol.asyncIterator]() {
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: compact ? 'MUST_NOT_INSTALL_PARTIAL' : 'final answer' } };
        yield end(compact ? 'max_tokens' : 'end_turn');
        yield { type: 'message_stop' };
      } };
    });
    (adapter as unknown as { client: unknown }).client = { messages: { stream: create } };
    const session = new AgentSessionState();
    session.appendUserText(`old prefix ${'a'.repeat(10_000)}`);
    session.appendAssistantBlocks([{ type: 'text', text: `retained answer ${'b'.repeat(10_000)}` }]);
    const runtime = new AgentRuntime({ adapter, registry: { getToolDefinitions: () => [], executeTool: async () => 'ok' } as never,
      session, controller: new AgentRunController(), systemPrompt: 'system', contextLimit: 100 });
    const events: string[] = [];
    await runtime.run('current', event => events.push(event.type));
    expect(create).toHaveBeenCalledTimes(2);
    expect(events.filter(event => event === 'compact_failed' || event === 'compact_triggered')).toEqual(['compact_failed', 'compact_triggered']);
    expect(session.getCompactions()).toHaveLength(1);
    expect(session.getCompactions()[0]!.summary).toContain('[context compacted summary]');
    expect(JSON.stringify(session.getMessages())).not.toContain('MUST_NOT_INSTALL_PARTIAL');
  });

  it('rejects a Claude tool block even when its closing event is missing', async () => {
    await expect(new CompactRunner(claude([text,
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tool', name: 'write' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{}' } },
      end('end_turn'), { type: 'message_stop' },
    ])).run(history)).rejects.toThrow();
  });
  it('preserves cancellation over a simultaneous iterator failure', async () => {
    const controller = new AbortController(), reason = new Error('caller cancelled'), late = new Error('late failure');
    const adapter: ModelAdapter = { getModelName: () => 'fixture', stream: async function* () {
      yield { type: 'text', delta: 'summary' }; yield { type: 'done' }; controller.abort(reason); throw late;
    } };
    await expect(new CompactRunner(adapter).run(history, { signal: controller.signal })).rejects.toBe(reason);
  });
  it('does not invent Responses usage when the completed response omits it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'summary' }] }],
    }), { status: 200 })));
    const chunks: StreamChunk[] = [];
    const adapter = new OpenAIResponsesAdapter('fixture', 'gpt-4o', 'https://fixture.invalid/v1');
    for await (const chunk of adapter.stream(history, [], 'summary', { requireCompleteResponse: true })) chunks.push(chunk);
    expect(chunks).toEqual([{ type: 'text', delta: 'summary' }, { type: 'done' }]);
  });

  it.each([
    [{ type: 'text', delta: 'partial' }],
    [{ type: 'text', delta: '   ' }, { type: 'done' }],
    [{ type: 'thinking', delta: 'only thinking' }, { type: 'done' }],
    [{ type: 'tool_use', id: 'tool', name: 'write', input: {} }, { type: 'text', delta: 'text' }, { type: 'done' }],
    [{ type: 'text', delta: 'first' }, { type: 'done' }, { type: 'text', delta: 'late' }],
  ] as StreamChunk[][])('does not accept an invalid normalized summary %j', async (...chunks) => {
    const adapter: ModelAdapter = { getModelName: () => 'fixture', stream: async function* () { yield* chunks; } };
    await expect(new CompactRunner(adapter).run(history)).rejects.toThrow();
  });
  it('drains late usage and preserves a late original error', async () => {
    const error = new Error('late original failure'); let usageSeen = false;
    const adapter: ModelAdapter = { getModelName: () => 'fixture', stream: async function* () {
      yield { type: 'text', delta: 'summary' }; yield { type: 'done' };
      yield { type: 'usage', usage: { inputTokens: 2, outputTokens: 3 } }; usageSeen = true; throw error;
    } };
    await expect(new CompactRunner(adapter).run(history)).rejects.toBe(error);
    expect(usageSeen).toBe(true);
  });
  it('does not commit text after cancellation won at the terminal boundary', async () => {
    const controller = new AbortController(), reason = new Error('cancelled');
    const adapter: ModelAdapter = { getModelName: () => 'fixture', stream: async function* () {
      yield { type: 'text', delta: 'summary' }; yield { type: 'done' }; controller.abort(reason);
    } };
    await expect(new CompactRunner(adapter).run(history, { signal: controller.signal })).rejects.toBe(reason);
  });
});
