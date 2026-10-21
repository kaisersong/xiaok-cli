import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAdapterFromBinding } from '../../../src/ai/models.js';
import { OpenAIAdapter } from '../../../src/ai/adapters/openai.js';
import { buildOpenAIHarnessContext, resolveKimiHarnessFeatureFlags } from '../../../src/ai/providers/model-harness-profile.js';
import type { Message, ToolDefinition } from '../../../src/types.js';
afterEach(() => vi.unstubAllGlobals());
function adapter(base = 'https://provider.example/v1') {
  return new OpenAIAdapter({ apiKey: 'fixture', kimiCodingHeadersApplied: false, harnessContext: buildOpenAIHarnessContext({
    identity: { providerId: 'test', providerType: 'custom', protocol: 'openai_legacy', canonicalBaseUrl: base,
      wireModel: 'fixture', capabilities: ['tools', 'thinking'] }, flags: resolveKimiHarnessFeatureFlags({}),
  }) });
}
describe('production OpenAI request preview shares actual request builder', () => {
  it('includes a bounded summary output limit and rejects a forged attempt before SDK dispatch', async () => {
    const raw=vi.fn();vi.stubGlobal('fetch',raw);
    const model=createAdapterFromBinding({providerId:'deepseek',providerType:'first_party',modelId:'deepseek-flash',wireModel:'deepseek-flash',protocol:'openai_legacy',apiKey:'fixture',baseUrl:'https://api.deepseek.com',headers:{},capabilities:['tools']});
    const options={semanticSummaryOutputTokens:2048};
    expect(JSON.parse(model.getObservationRequestPreview!([],[],'summary',options)!.serializedBody).max_tokens).toBe(2048);
    for(const max of [0,8193,Infinity])expect(()=>model.getObservationRequestPreview!([],[],'summary',{semanticSummaryOutputTokens:max})).toThrow();
    const consume=async()=>{for await(const _ of model.stream([],[],'summary',{...options,semanticSummaryAttempt:{} as never})){} };
    await expect(consume()).rejects.toThrow();expect(raw).not.toHaveBeenCalled();
  });
  it('does not expose preview for a factory-bound strict K3 adapter', () => {
    const raw = vi.fn(); vi.stubGlobal('fetch', raw);
    const model = createAdapterFromBinding({ providerId: 'kimi', providerType: 'first_party', modelId: 'kimi-k3',
      wireModel: 'k3', protocol: 'openai_legacy', apiKey: 'fixture', baseUrl: 'https://api.kimi.com/coding/v1', headers: {}, capabilities: ['tools', 'thinking'] });
    expect(model.getObservationRequestPreview?.([], [], 'system')).toBeUndefined();
    expect(raw).not.toHaveBeenCalled();
  });
  it.each(['https://provider.example/v1', 'https://provider.example'])('matches actual SDK wire with system, schema, reasoning and tool history at %s', async base => {
    const messages: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'first' }] },
      { role: 'assistant', content: [{ type: 'thinking', thinking: 'preserved reasoning' }, { type: 'text', text: 'checking' },
        { type: 'tool_use', id: 'call-1', name: 'read', input: { file_path: 'a' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-1', content: 'native plus policy' }, { type: 'text', text: 'continue' }] },
    ];
    const tools: ToolDefinition[] = [{ name: 'read', description: 'read text', inputSchema: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] } }];
    const initial = structuredClone({ messages, tools });
    const raw = vi.fn(async () => new Response('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } }));
    vi.stubGlobal('fetch', raw);
    const model = adapter(base);
    const preview = model.getObservationRequestPreview(messages, tools, 'full system prompt', { cacheKey: `pc1_${'a'.repeat(64)}` })!;
    expect(raw).not.toHaveBeenCalled();
    for await (const _chunk of model.stream(messages, tools, 'full system prompt', { cacheKey: `pc1_${'a'.repeat(64)}` })) { /* actual SDK */ }
    expect(raw).toHaveBeenCalledOnce();
    const [url, init] = raw.mock.calls[0] as unknown as [string, RequestInit];
    expect(preview.destination).toBe(url); expect(preview.serializedBody).toBe(init.body);
    expect(JSON.parse(preview.serializedBody).max_tokens).toBeUndefined();
    expect({ messages, tools }).toEqual(initial);
  });
});
