import { describe, expect, it, vi } from 'vitest';
import { resolveRuntimeModelBinding } from '../../../src/ai/providers/control-plane.js';
import { getSupportedModelReasoningEfforts } from '../../../src/ai/providers/model-reasoning-effort.js';
import { getProviderProfile } from '../../../src/ai/providers/registry.js';
import { resolveModelHarnessProfile, buildOpenAIHarnessContext, resolveKimiHarnessFeatureFlags } from '../../../src/ai/providers/model-harness-profile.js';
import { OpenAIAdapter } from '../../../src/ai/adapters/openai.js';
import { streamDesktopTaskProviderConversation } from '../../../src/ai/runtime/provider-conversation-authorization.js';
import { isKimiK3DurableModel, assertKimiK3DurableResumeSupported } from '../../../src/ai/runtime/session-store/store.js';
import type { ConfigV2Input, Message } from '../../../src/types.js';

const endpoint = 'https://api.kimi.com/coding/v1';
const wire = 'kimi-for-coding';
const identity = { providerId: 'kimi', providerType: 'first_party' as const, protocol: 'openai_legacy' as const, canonicalBaseUrl: endpoint, capabilities: ['tools', 'thinking', 'image_in'] };
function config(wire: string): ConfigV2Input {
  return { schemaVersion: 2, defaultProvider: 'kimi', defaultModelId: `kimi-${wire}`, providers: { kimi: { type: 'first_party', protocol: 'openai_legacy', apiKey: 'fixture', baseUrl: endpoint } }, models: { [`kimi-${wire}`]: { provider: 'kimi', model: wire } }, defaultMode: 'interactive', channels: {} };
}
async function collect(stream: AsyncIterable<unknown>) { const chunks = []; for await (const chunk of stream) chunks.push(chunk); return chunks; }

describe('K2.8 Preview', () => {
  it('resolves exact catalog wire, vision and native effort without mutating configuration', () => {
    const input = config(wire); const before = structuredClone(input);
    const binding = resolveRuntimeModelBinding(input);
    expect(binding.wireModel).toBe(wire);
    expect(binding.capabilities).toEqual(['tools', 'thinking', 'image_in']);
    expect(binding.runtimeOptions).toEqual({ contextLimit: 1_048_576, reasoningEffort: 'high' });
    expect(input).toEqual(before);
    expect(getProviderProfile('kimi')?.availableModels?.find(x => x.model === wire)?.runtimeConstraints)
      .toEqual({ maxContextLimit: 1_048_576, reasoningEfforts: ['low', 'high', 'max'] });
    expect(getProviderProfile('kimi')?.availableModels?.find(x => x.model === wire)?.label).toBe('Kimi K2.8 Preview');
    input.models[`kimi-${wire}`]!.runtimeOptions = { contextLimit: 262_144, reasoningEffort: 'max' };
    expect(resolveRuntimeModelBinding(input).runtimeOptions).toEqual({ contextLimit: 262_144, reasoningEffort: 'max' });
    for (const effort of ['low', 'high', 'max'] as const) {
      input.models[`kimi-${wire}`]!.runtimeOptions = { reasoningEffort: effort };
      expect(resolveRuntimeModelBinding(input).runtimeOptions?.reasoningEffort).toBe(effort);
    }
    input.models[`kimi-${wire}`]!.runtimeOptions = { reasoningEffort: 'none' };
    expect(() => resolveRuntimeModelBinding(input)).toThrow('reasoningEffort is not allowed');
  });
  it('preserves the generic transport and accepts existing durable assistant history', () => {
    expect(resolveModelHarnessProfile({ ...identity, wireModel: wire }).id).toBe('generic-openai');
    expect(isKimiK3DurableModel(wire)).toBe(false);
    expect(() => assertKimiK3DurableResumeSupported({ model: wire, messages: [{ role: 'assistant', content: [{ type: 'text', text: 'old answer' }] }] })).not.toThrow();
  });
  it.each([
    { providerType: 'custom' as const }, { providerId: 'other' },
    { protocol: 'openai_responses' as const }, { wireModel: 'kimi-k2.8' },
    { canonicalBaseUrl: 'https://api.kimi.com.evil.example/coding/v1' },
    { canonicalBaseUrl: `${endpoint}?proxy=1` },
    { canonicalBaseUrl: 'https://api.moonshot.cn/v1' },
  ])('does not grant strict capability to unsupported identity %j', override => {
    const unsupported = { ...identity, wireModel: wire, ...override };
    expect(resolveModelHarnessProfile(unsupported).id).toBe('generic-openai');
    expect(getSupportedModelReasoningEfforts({ ...unsupported, baseUrl: unsupported.canonicalBaseUrl })).toEqual([]);
  });
  it.each(['low', 'high', 'max'] as const)('sends %s effort, image and tool history using the exact wire', async effort => {
    const adapter = new OpenAIAdapter({ apiKey: 'fixture', kimiCodingHeadersApplied: true, harnessContext: buildOpenAIHarnessContext({ identity: { ...identity, wireModel: wire }, runtimeOptions: { reasoningEffort: effort }, flags: resolveKimiHarnessFeatureFlags({}) }) });
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
    expect(request.reasoning_effort).toBe(effort);
    expect(request.thinking?.type).not.toBe('disabled');
    expect(request.messages[1].content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,aW1hZ2U=' } });
    expect(request.messages[2].reasoning_content).toBe('fixture reasoning');
    expect(request.messages[2].tool_calls[0].id).toBe('fixture_call');
    expect(request.messages[3]).toMatchObject({ role: 'tool', tool_call_id: 'fixture_call', content: 'ok' });
  });
});
