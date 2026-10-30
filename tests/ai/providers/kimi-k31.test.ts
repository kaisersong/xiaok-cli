import { describe, expect, it, vi } from 'vitest';
import { resolveRuntimeModelBinding } from '../../../src/ai/providers/control-plane.js';
import { getProviderProfile } from '../../../src/ai/providers/registry.js';
import { resolveModelHarnessProfile, buildOpenAIHarnessContext, resolveKimiHarnessFeatureFlags } from '../../../src/ai/providers/model-harness-profile.js';
import { OpenAIAdapter } from '../../../src/ai/adapters/openai.js';
import { streamDesktopTaskProviderConversation } from '../../../src/ai/runtime/provider-conversation-authorization.js';
import { resolveRegisteredStrictKimiK3Profile, requiresKimiK3HistoryMigration } from '../../../src/ai/runtime/model-harness-identity.js';
import { assertKimiTransportAllowed } from '../../../src/ai/runtime/kimi-rollback-policy.js';
import { isKimiK3DurableModel } from '../../../src/ai/runtime/session-store/store.js';
import type { ConfigV2Input, Message } from '../../../src/types.js';

const endpoint = 'https://api.kimi.com/coding/v1';
const cases = [
  ['k3.1-pro', 'kimi-k3.1-pro-coding-openai'],
  ['k3.1-pro-highspeed', 'kimi-k3.1-pro-highspeed-coding-openai'],
] as const;
const identity = { providerId: 'kimi', providerType: 'first_party' as const, protocol: 'openai_legacy' as const, canonicalBaseUrl: endpoint, capabilities: ['tools', 'thinking', 'image_in'] };
function config(wire: string): ConfigV2Input {
  return { schemaVersion: 2, defaultProvider: 'kimi', defaultModelId: `kimi-${wire}`, providers: { kimi: { type: 'first_party', protocol: 'openai_legacy', apiKey: 'fixture', baseUrl: endpoint } }, models: { [`kimi-${wire}`]: { provider: 'kimi', model: wire } }, defaultMode: 'interactive', channels: {} };
}
async function collect(stream: AsyncIterable<unknown>) { const chunks = []; for await (const chunk of stream) chunks.push(chunk); return chunks; }

describe.each(cases)('K3.1 Coding %s', (wire, profileId) => {
  it('resolves exact catalog wire, vision and native effort without mutating configuration', () => {
    const input = config(wire); const before = structuredClone(input);
    const binding = resolveRuntimeModelBinding(input);
    expect(binding.wireModel).toBe(wire);
    expect(binding.capabilities).toEqual(['tools', 'thinking', 'image_in']);
    expect(binding.runtimeOptions).toEqual({ contextLimit: 262_144, reasoningEffort: 'high' });
    expect(input).toEqual(before);
    expect(getProviderProfile('kimi')?.availableModels?.find(x => x.model === wire)?.runtimeConstraints)
      .toEqual({ maxContextLimit: 1_048_576, reasoningEfforts: ['low', 'high', 'max'] });
    for (const effort of ['low', 'high', 'max'] as const) {
      input.models[`kimi-${wire}`]!.runtimeOptions = { reasoningEffort: effort };
      expect(resolveRuntimeModelBinding(input).runtimeOptions?.reasoningEffort).toBe(effort);
    }
    input.models[`kimi-${wire}`]!.runtimeOptions = { reasoningEffort: 'none' };
    expect(() => resolveRuntimeModelBinding(input)).toThrow('reasoningEffort is not allowed');
  });
  it('keeps strict profile ownership and history migration distinct from K3 and the other K3.1 model', () => {
    expect(resolveModelHarnessProfile({ ...identity, wireModel: wire }).id).toBe(profileId);
    expect(isKimiK3DurableModel(wire)).toBe(true);
    expect(() => assertKimiTransportAllowed({ canonicalBaseUrl: endpoint, wireModel: wire }, 'rollback')).toThrow('KIMI_K3_DISABLED');
    for (const old of ['kimi-k3-coding-openai', ...cases.map(x => x[1])] as const) {
      expect(requiresKimiK3HistoryMigration(old, profileId, 1)).toBe(old !== profileId);
      expect(requiresKimiK3HistoryMigration(old, profileId, 0)).toBe(false);
    }
  });
  it.each([
    { providerType: 'custom' as const }, { providerId: 'other' },
    { protocol: 'openai_responses' as const }, { wireModel: 'k3.1-pro-typo' },
    { canonicalBaseUrl: 'https://api.kimi.com.evil.example/coding/v1' },
    { canonicalBaseUrl: `${endpoint}?proxy=1` },
    { canonicalBaseUrl: 'https://api.moonshot.cn/v1' },
  ])('does not grant strict capability to unsupported identity %j', override => {
    expect(resolveModelHarnessProfile({ ...identity, wireModel: wire, ...override }).id).toBe('generic-openai');
  });
  it('rejects unsigned direct calls and fake strict adapters before provider dispatch', async () => {
    const adapter = new OpenAIAdapter({ apiKey: 'fixture', kimiCodingHeadersApplied: true, harnessContext: buildOpenAIHarnessContext({ identity: { ...identity, wireModel: wire }, flags: resolveKimiHarnessFeatureFlags({}) }) });
    expect(resolveRegisteredStrictKimiK3Profile(adapter)).toBe(profileId);
    await expect(collect(adapter.stream([{ role: 'user', content: [{ type: 'text', text: 'fixture' }] }], [], 'fixture'))).rejects.toThrow('KIMI_K3');
    const fake = { getHarnessProfileId: () => profileId, stream: vi.fn() };
    expect(() => streamDesktopTaskProviderConversation({ adapter: fake as unknown as OpenAIAdapter, messages: [], tools: [], systemPrompt: 'fixture' })).toThrow('KIMI_K3_PROFILE_CAPABILITY_REQUIRED');
    expect(fake.stream).not.toHaveBeenCalled();
  });
  it('sends authorized image and tool history with preserved official reasoning using the exact wire', async () => {
    const adapter = new OpenAIAdapter({ apiKey: 'fixture', kimiCodingHeadersApplied: true, harnessContext: buildOpenAIHarnessContext({ identity: { ...identity, wireModel: wire }, flags: resolveKimiHarnessFeatureFlags({}) }) });
    const create = vi.fn(async () => ({ async *[Symbol.asyncIterator]() { yield { choices: [{ delta: { reasoning_content: 'fixture reasoning', content: 'ok' }, finish_reason: 'stop' }] }; } }));
    (adapter as unknown as { client: unknown }).client = { chat: { completions: { create } } };
    const messages: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'inspect fixture' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aW1hZ2U=' } }] },
      { role: 'assistant', content: [{ type: 'thinking', thinking: 'fixture reasoning', reasoningProvenance: { captureVersion: 1, source: 'reasoning_content', fieldPresence: 'present' } }, { type: 'tool_use', id: 'fixture_call', name: 'echo', input: { value: 'ok' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'fixture_call', content: 'ok' }] },
    ];
    await collect(streamDesktopTaskProviderConversation({ adapter, invocationId: 'fixture-invocation', messages, tools: [], systemPrompt: 'fixture', options: { reasoningMode: 'disabled' } }));
    expect(create).toHaveBeenCalledOnce();
    const request = (create.mock.calls[0] as unknown as [Record<string, any>])[0];
    expect(request.model).toBe(wire);
    expect(request.reasoning_effort).toBe('high');
    expect(request.thinking?.type).not.toBe('disabled');
    expect(request.messages[1].content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,aW1hZ2U=' } });
    expect(request.messages[2].reasoning_content).toBe('fixture reasoning');
    expect(request.messages[2].tool_calls[0].id).toBe('fixture_call');
    expect(request.messages[3]).toMatchObject({ role: 'tool', tool_call_id: 'fixture_call', content: 'ok' });
  });
});
