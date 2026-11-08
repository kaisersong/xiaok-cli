import {describe,it,expect} from 'vitest';
import {OpenAIAdapter} from '../../../src/ai/adapters/openai.js';
import {buildOpenAIHarnessContext,resolveKimiHarnessFeatureFlags} from '../../../src/ai/providers/model-harness-profile.js';
import {streamDesktopTaskProviderConversation} from '../../../src/ai/runtime/provider-conversation-authorization.js';
import {normalizeRuntimeError} from '../../../src/ai/runtime/runtime-errors.js';
function createTestAdapter(input:{wireModel:string;providerId:string;providerType:'first_party'}) {
 return new OpenAIAdapter({apiKey:'fictional',harnessContext:buildOpenAIHarnessContext({identity:{...input,protocol:'openai_legacy',canonicalBaseUrl: input.providerId==='kimi'?'https://api.kimi.com/coding/v1':'https://open.bigmodel.cn/api/coding/paas/v4', capabilities:['tools','thinking']},flags:resolveKimiHarnessFeatureFlags({})})});
}
const createStrictKimiAdapter=()=>createTestAdapter({wireModel:'k3',providerId:'kimi',providerType:'first_party'});
const streamTestAdapter=(adapter:OpenAIAdapter,messages:Parameters<OpenAIAdapter['stream']>[0],tools:Parameters<OpenAIAdapter['stream']>[1],systemPrompt:string,options:Parameters<OpenAIAdapter['stream']>[3]) => streamDesktopTaskProviderConversation({adapter,messages,tools,systemPrompt,options,invocationId:'fictional-provider-error'});

describe('first-party provider errors reach the user before any quota retry', () => {
  it.each(['glm', 'kimi'] as const)('%s disables SDK retries before business classification', providerId => {
    const adapter = createTestAdapter({ wireModel: providerId === 'glm' ? 'GLM-5.3' : 'kimi-for-coding', providerId, providerType: 'first_party' });
    expect(adapter.client.maxRetries).toBe(0);
  });
  it.each(['glm', 'kimi'] as const)('%s exposes quota with HTTP/code without leaking the raw body', async providerId => {
    const adapter = providerId === 'kimi' ? createStrictKimiAdapter() : createTestAdapter({ wireModel: 'GLM-5.3', providerId, providerType: 'first_party' });
    let calls = 0;
    adapter.client = adapter.client.withOptions({ fetch: async () => {
      calls++;
      return new Response(JSON.stringify({ error: providerId === 'glm'
        ? { code: '1310', message: '您已达到每周/每月使用上限，您的限额将在 2026-12-10 09:30:00 重置。PRIVATE_CANARY' }
        : { type: 'exceeded_current_quota_error', message: "You've reached your weekly (7-day) usage limit. PRIVATE_CANARY" } }), { status: 429, headers: { 'content-type': 'application/json', 'x-request-id': 'PRIVATE_CANARY' } });
    } });
    let error: unknown;
    try { for await (const _ of streamTestAdapter(adapter, [{ role: 'user', content: [{ type: 'text', text: 'fictional' }] }], [], '', { signal: AbortSignal.timeout(400) })) { /* drain */ } } catch (e) { error = e; }
    const result = normalizeRuntimeError(error);
    expect(calls).toBe(1);
    expect(result).toMatchObject({ code: 'model_failed', retryable: false, message: expect.stringContaining('额度') });
    expect(result.message).toContain('429');
    expect(result.message).not.toContain('PRIVATE_CANARY');
    if (providerId === 'glm') { expect(result.message).toContain('1310'); expect(result.message).toContain('2026-12-10 09:30:00'); }
  });
});

describe('real SDK provider response boundaries', () => {
  const event = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
  async function failureFor(adapter: OpenAIAdapter, fetch: typeof globalThis.fetch) {
    adapter.client = adapter.client.withOptions({ fetch });
    try { for await (const chunk of streamTestAdapter(adapter, [{ role: 'user', content: [{ type: 'text', text: 'fictional' }] }], [], '', { signal: AbortSignal.timeout(2000) })) { if (chunk.type === 'tool_use') throw Error('uncommitted tool escaped the failed stream'); } } catch (error) { return error; }
    throw Error('expected a provider failure');
  }
  it.each(['glm', 'kimi'] as const)('status-less %s SSE quota errors retain the permanent reason', async providerId => {
    const adapter = providerId === 'kimi' ? createStrictKimiAdapter() : createTestAdapter({ wireModel: 'GLM-5.3', providerId, providerType: 'first_party' });
    let calls = 0;
    const error = await failureFor(adapter, async () => {
      calls++;
      return new Response(event({ error: providerId === 'glm' ? { code: '1308', message: 'PRIVATE_CANARY' }
        : { type: 'exceeded_current_quota_error', message: "You've reached your weekly (7-day) usage limit. PRIVATE_CANARY" } }), { headers: { 'content-type': 'text/event-stream' } });
    });
    expect(calls).toBe(1);
    expect(normalizeRuntimeError(error)).toMatchObject({ code: 'model_failed', retryable: false, message: expect.stringContaining('额度') });
    expect(normalizeRuntimeError(error).message).not.toContain('PRIVATE_CANARY');
  });
  it.each(['sensitive', 'content_filter'])('does not commit tool calls on GLM %s finish frames', async finish_reason => {
    const adapter = createTestAdapter({ wireModel: 'GLM-5.3', providerId: 'glm', providerType: 'first_party' });
    const error = await failureFor(adapter, async () => new Response(event({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'uncommitted', type: 'function', function: { name: 'fictional_effect', arguments: '{}' } }] }, finish_reason }] }), { headers: { 'content-type': 'text/event-stream' } }));
    expect(normalizeRuntimeError(error)).toMatchObject({ retryable: false, message: expect.stringContaining('安全策略') });
  });
  it('does not misreport a Kimi content filter as missing reasoning admission', async () => {
    const error = await failureFor(createStrictKimiAdapter(), async () => new Response(event({ choices: [{ index: 0, delta: {}, finish_reason: 'content_filter' }] }), { headers: { 'content-type': 'text/event-stream' } }));
    expect(normalizeRuntimeError(error).message).toContain('安全策略');
    expect(normalizeRuntimeError(error).message).not.toContain('KIMI_REASONING_ADMISSION_REQUIRED');
  });
  it.each(['http', 'sse'])('does not mislabel an unrecognized Kimi 429 reason as quota (%s)', async mode => {
    let calls = 0;
    const error = await failureFor(createStrictKimiAdapter(), async () => {
      calls++;
      const error = { type: 'exceeded_current_quota_error', message: 'PRIVATE_CANARY' };
      return mode === 'http' ? new Response(JSON.stringify({ error }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '60' } })
        : new Response(event({ choices: [{ index: 0, delta: { reasoning_content: '', content: 'fictional partial' }, finish_reason: null }] }) + event({ error }), { headers: { 'content-type': 'text/event-stream' } });
    });
    expect(calls).toBe(1);
    expect(normalizeRuntimeError(error)).toMatchObject({ retryable: true });
    expect(normalizeRuntimeError(error).message).not.toContain('额度已用尽');
    expect(normalizeRuntimeError(error).message).not.toContain('PRIVATE_CANARY');
  });
  it('identifies an unknown Kimi SSE error as a provider failure without forwarding private fields', async () => {
    const error = await failureFor(createStrictKimiAdapter(), async () => new Response(event({ error: { type: 'PRIVATE_CANARY', code: 'PRIVATE_CANARY', message: 'PRIVATE_CANARY' } }), { headers: { 'content-type': 'text/event-stream' } }));
    expect(normalizeRuntimeError(error).message).toContain('Kimi');
    expect(normalizeRuntimeError(error).message).toContain('供应商');
    expect(normalizeRuntimeError(error).message).not.toContain('xiaok');
    expect(normalizeRuntimeError(error).message).not.toContain('PRIVATE_CANARY');
  });
  it('passes rate limiting to the existing recovery owner without an early SDK or adapter retry', async () => {
    const adapter = createTestAdapter({ wireModel: 'GLM-5.3', providerId: 'glm', providerType: 'first_party' });
    let calls = 0;
    const error = await failureFor(adapter, async () => { calls++; return new Response(JSON.stringify({ error: { code: '1302', message: 'PRIVATE_CANARY' } }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '60' } }); });
    expect(calls).toBe(1); expect(normalizeRuntimeError(error)).toMatchObject({ retryable: true, message: expect.stringContaining('1302') });
  });
});
