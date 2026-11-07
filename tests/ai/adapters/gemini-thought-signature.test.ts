import { describe, expect, it, vi } from 'vitest';
import { OpenAIAdapter } from '../../../src/ai/adapters/openai.js';
import { buildOpenAIHarnessContext, resolveKimiHarnessFeatureFlags, type AdapterBindingIdentity } from '../../../src/ai/providers/model-harness-profile.js';
import { streamDesktopTaskProviderConversation } from '../../../src/ai/runtime/provider-conversation-authorization.js';
import { projectProviderPrivateMessages } from '../../../src/ai/runtime/provider-private-data.js';
import { toDurableSessionSnapshot } from '../../../src/ai/runtime/session-store/store.js';
import { parseFileSessionSnapshot, readCapturedFileSession } from '../../../src/ai/runtime/session-store/file-session-parser.js';
import type { Message, StreamChunk } from '../../../src/types.js';

const identity: AdapterBindingIdentity = {
  providerId: 'gemini', providerType: 'first_party', protocol: 'openai_legacy',
  canonicalBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  wireModel: 'gemini-3.1-pro-preview', capabilities: ['tools', 'thinking', 'image_in'],
};
function fixture(overrides: Partial<AdapterBindingIdentity> = {}, signature: unknown = 'opaque-google-signature') {
  const adapter = new OpenAIAdapter({ apiKey: 'fixture', kimiCodingHeadersApplied: false,
    harnessContext: buildOpenAIHarnessContext({ identity: { ...identity, ...overrides }, flags: resolveKimiHarnessFeatureFlags({}) }) });
  let calls = 0;
  const create = vi.fn(async () => ({ async *[Symbol.asyncIterator]() {
    if (++calls === 1) {
      yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-one', function: { name: 'echo', arguments: '{"value":"one"}' } }, { index: 1, id: 'call-two', function: { name: 'echo', arguments: '{"value":"two"}' } }] }, finish_reason: null }] };
      // Signature can arrive independently after the complete function arguments.
      yield { choices: [{ delta: { tool_calls: [{ index: 0, extra_content: { google: { thought_signature: signature } } }] }, finish_reason: 'tool_calls' }] };
    } else yield { choices: [{ delta: { content: 'done' }, finish_reason: 'stop' }] };
  } }));
  (adapter as unknown as { client: unknown }).client = { chat: { completions: { create } } };
  return { adapter, create };
}
async function collect(adapter: OpenAIAdapter, messages: Message[] = []) {
  const chunks: StreamChunk[] = [];
  for await (const chunk of streamDesktopTaskProviderConversation({ adapter, messages, tools: [], systemPrompt: 'fixture' })) chunks.push(chunk);
  return chunks;
}
function history(chunks: StreamChunk[]): Message[] {
  const messages: Message[] = [
    { role: 'assistant', content: chunks.filter(chunk => chunk.type === 'tool_use') },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-one', content: 'one' }, { type: 'tool_result', tool_use_id: 'call-two', content: 'two' }] },
  ];
  const durable = toDurableSessionSnapshot({ sessionId: 'signature-fixture', cwd: '/fixture', model: identity.wireModel,
    createdAt: 1, updatedAt: 1, lineage: ['signature-fixture'], messages,
    usage: { inputTokens: 0, outputTokens: 0 }, compactions: [], memoryRefs: [], approvalRefs: [], backgroundJobRefs: [],
  });
  const json = JSON.stringify({ ...durable, schemaVersion: 1 });
  readCapturedFileSession(json, 'signature-fixture');
  return parseFileSessionSnapshot(json, 'signature-fixture').messages;
}
describe('official Gemini 3 thought signature', () => {
  it('preserves a late signature through JSON history and a second tool-result request', async () => {
    const { adapter, create } = fixture();
    const saved = history(await collect(adapter));
    expect(saved[0].content[0]).toMatchObject({ googleThoughtSignature: { model: identity.wireModel, signature: 'opaque-google-signature' } });
    expect(JSON.stringify(projectProviderPrivateMessages(saved))).not.toContain('opaque-google-signature');
    expect(saved[0].content[0]).toHaveProperty('googleThoughtSignature');
    await collect(adapter, saved);
    const request = (create.mock.calls[1] as unknown as [Record<string, any>])[0];
    expect(request.messages[1].tool_calls[0].extra_content).toEqual({ google: { thought_signature: 'opaque-google-signature' } });
    expect(request.messages[1].tool_calls[1].extra_content).toBeUndefined();
    expect(request.messages[2]).toMatchObject({ role: 'tool', tool_call_id: 'call-one' });
    expect(request.messages[3]).toMatchObject({ role: 'tool', tool_call_id: 'call-two' });
  });
  it.each([
    { providerType: 'custom' as const }, { providerId: 'other' }, { protocol: 'openai_responses' as const },
    { canonicalBaseUrl: 'https://generativelanguage.googleapis.com.evil.example/v1beta/openai' },
    { canonicalBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai?proxy=1' },
    { canonicalBaseUrl: 'https://proxy.example/v1' }, { wireModel: 'gemini-2.5-pro' },
    { canonicalBaseUrl: 'https://user:secret@generativelanguage.googleapis.com/v1beta/openai' },
    { canonicalBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai#fragment' },
  ])('does not capture or replay for unsupported identity %j', async overrides => {
    const official = fixture();
    const saved = history(await collect(official.adapter));
    const { adapter, create } = fixture(overrides);
    const output = await collect(adapter, saved);
    expect(output.filter(chunk => chunk.type === 'tool_use')).toHaveLength(2);
    expect(output.filter(chunk => chunk.type === 'tool_use').some(chunk => 'googleThoughtSignature' in chunk)).toBe(false);
    expect((create.mock.calls[0] as unknown as [Record<string, any>])[0].messages[1].tool_calls[0].extra_content).toBeUndefined();
  });
  it('does not disclose signatures after switching to another Gemini model', async () => {
    const original = fixture();
    const saved = history(await collect(original.adapter));
    const other = fixture({ wireModel: 'gemini-3.1-flash-lite-preview' });
    await collect(other.adapter, saved);
    expect((other.create.mock.calls[0] as unknown as [Record<string, any>])[0].messages[1].tool_calls[0].extra_content).toBeUndefined();
  });
  it.each([null, 42, {}, ''])('ignores malformed provider signature %j', async signature => {
    const { adapter } = fixture({}, signature);
    expect((await collect(adapter)).some(chunk => 'googleThoughtSignature' in chunk)).toBe(false);
  });
  it('rejects unexpected private metadata fields before visible projection', async () => {
    const { adapter } = fixture();
    const saved = history(await collect(adapter));
    const block = saved[0].content[0] as unknown as { googleThoughtSignature: Record<string, unknown> };
    block.googleThoughtSignature.untrusted = 'private';
    expect(() => projectProviderPrivateMessages(saved)).toThrow();
  });
});
