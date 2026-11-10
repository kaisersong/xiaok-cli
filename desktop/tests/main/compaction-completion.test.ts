import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAIResponsesAdapter } from '../../../src/ai/adapters/openai-responses.js';
import { compactConversation } from '../../electron/context-manager.js';
import type { Message, ModelAdapter, StreamChunk } from '../../../src/types.js';
import type { StreamOptions } from '../../../src/ai/runtime/model-capabilities.js';

const messages = (): Message[] => [{ role: 'user', content: [{ type: 'text', text: 'original history' }] }];
describe('legacy Desktop compaction completion', () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each([
    [{ type: 'text', delta: 'partial' }],
    [{ type: 'tool_use', id: 't', name: 'write', input: {} }, { type: 'text', delta: 'text' }, { type: 'done' }],
    [{ type: 'text', delta: 'summary' }, { type: 'done' }, { type: 'text', delta: 'late' }],
  ] as StreamChunk[][])('rejects incomplete content without modifying history %j', async (...chunks) => {
    const source = messages(), before = JSON.stringify(source);
    const adapter: ModelAdapter = { getModelName: () => 'fixture', stream: async function* () { yield* chunks; } };
    await expect(compactConversation(source, adapter, '')).rejects.toThrow('compaction_response_incomplete');
    expect(JSON.stringify(source)).toBe(before);
  });
  it.each(['text', 'usage'] as const)('preserves the original late error after %s without snipping', async kind => {
    const source = messages(), before = JSON.stringify(source), error = new Error('late original');
    const adapter: ModelAdapter = { getModelName: () => 'fixture', stream: async function* () {
      if (kind === 'text') yield { type: 'text', delta: 'partial' };
      else yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 2 } };
      throw error;
    } };
    await expect(compactConversation(source, adapter, '')).rejects.toBe(error);
    expect(JSON.stringify(source)).toBe(before);
  });
  it('preserves cancellation before the first chunk', async () => {
    const source = messages(), before = JSON.stringify(source), error = new DOMException('cancelled', 'AbortError');
    const adapter: ModelAdapter = { getModelName: () => 'fixture', stream: async function* () { throw error; } };
    await expect(compactConversation(source, adapter, '')).rejects.toBe(error);
    expect(JSON.stringify(source)).toBe(before);
  });
  it('requires provider completion while preserving complete blank no-op', async () => {
    const source = messages(), before = JSON.stringify(source); let captured: StreamOptions | undefined;
    const adapter: ModelAdapter = { getModelName: () => 'fixture', stream: async function* (_m, _t, _s, options) {
      captured = options; yield { type: 'text', delta: '  ' }; yield { type: 'done' };
    } };
    await compactConversation(source, adapter, '');
    expect(captured?.requireCompleteResponse).toBe(true); expect(JSON.stringify(source)).toBe(before);
  });
  it.each([
    JSON.stringify({ status: 'completed', output: [{ type: 'function_call', name: 'write', arguments: '{}' }] }),
    '{malformed JSON',
    JSON.stringify({ status: 'completed', output: {} }),
  ])('preserves all history for malformed real Responses payload %s', async body => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })));
    const source: Message[] = Array.from({ length: 20 }, (_, index) => ({
      role: index % 2 ? 'assistant' : 'user', content: [{ type: 'text', text: `original ${index}` }],
    }));
    const before = JSON.stringify(source);
    await expect(compactConversation(source, new OpenAIResponsesAdapter('fixture', 'gpt-4o', 'https://fixture.invalid/v1'), '')).rejects.toThrow('compaction_response_incomplete');
    expect(JSON.stringify(source)).toBe(before);
  });

});
