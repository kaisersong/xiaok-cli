import { createTestOnlyCapacityProfile, type VerifiedCapacityProfile } from '../../../src/runtime/sol-pi/capacity-admission.js';
import { testOnlyCapacity } from '../../support/sol-pi-capacity.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { createTransportLeaseIssuer } from '../../../src/runtime/sol-pi/transport-lease.js';
import { createProviderDisclosureContext, createProviderDisclosureFetch, getProviderDisclosureSignal,
  assertProviderDisclosureActive, disposeProviderDisclosureContext } from '../../../src/runtime/sol-pi/provider-disclosure.js';
import { ClaudeAdapter } from '../../../src/ai/adapters/claude.js';
import { OpenAIAdapter } from '../../../src/ai/adapters/openai.js';
import { buildOpenAIHarnessContext, resolveKimiHarnessFeatureFlags } from '../../../src/ai/providers/model-harness-profile.js';
import { OpenAIResponsesAdapter } from '../../../src/ai/adapters/openai-responses.js';
import { createStatelessOpenAIResponse } from '../../../src/ai/adapters/openai-responses-native.js';
import type { StreamOptions } from '../../../src/ai/runtime/model-capabilities.js';
import { withObservationExecutionOwner } from '../../../src/runtime/sol-pi/observation-execution-scope.js';
import { streamDesktopSummaryRecovery } from '../../../desktop/electron/desktop-summary-stream.js';
import { createProjectAgentModel } from '../../../desktop/electron/project-agent-model.js';
import type { Config } from '../../../src/types.js';

afterEach(() => vi.unstubAllGlobals());
const base = 'https://provider.example/v1';
function fixture(destination = `${base}/chat/completions`, model = 'test-model', capacity: VerifiedCapacityProfile | null = testOnlyCapacity(destination, model), hostBinding: Record<string, unknown> = {}) {
  const authority = {}; let valid = true; const listeners = new Set<() => void>();
  const issuer = createTransportLeaseIssuer({ authority, withAdmission: operation => operation(),
    validate() { if (!valid) throw new Error('revoked'); },
    onRevoke(listener) { listeners.add(listener); return () => { listeners.delete(listener); } },
  });
  const context = createProviderDisclosureContext({ issuer, invocationId: crypto.randomUUID(), destination, model, capacityProfile: capacity ?? undefined,
    dependencies: [{ authority, key: 'material-policy-scope', epoch: 1 }], ...hostBinding });
  return { context, issuer, revoke() { valid = false; for (const listener of listeners) listener(); } };
}
async function drain(stream: AsyncIterable<unknown>) { for await (const _chunk of stream) { /* consume actual adapter */ } }
const requestBody = JSON.stringify({ model: 'test-model', messages: [{ role: 'user', content: 'actual' }] });
function openAIAdapter() {
  return new OpenAIAdapter({ apiKey: 'test', kimiCodingHeadersApplied: false, harnessContext: buildOpenAIHarnessContext({
    identity: { providerId: 'test', providerType: 'custom', protocol: 'openai_legacy', canonicalBaseUrl: base,
      wireModel: 'test-model', capabilities: [] }, flags: resolveKimiHarnessFeatureFlags({}),
  }) });
}
function scopeOwner(context: ReturnType<typeof createProviderDisclosureContext>) {
  return { prepareProviderDisclosure: () => context, ownsDisclosure: (candidate: object) => candidate === context, hasDependencies: () => true };
}

describe('provider disclosure actual transport binding', () => {
  it.each(['prepare', 'confirm', 'markUnknown'] as const)('rejects non-sync %s and makes the disclosure terminal', async method => {
    for (const result of [Promise.resolve(), 7]) {
      const counter = { prepare: vi.fn((): unknown => undefined), confirm: vi.fn((): unknown => undefined), markUnknown: vi.fn((): unknown => undefined) };
      counter[method] = vi.fn(() => result);
      const f = fixture(undefined, undefined, undefined, { fullSend: { counter, observationIds: ['o'] } });
      const raw = vi.fn(async () => new Response(null, { status: method === 'markUnknown' ? 500 : 200 }));
      const guarded = createProviderDisclosureFetch(f.context, raw);
      await expect(guarded(`${base}/chat/completions`, { method: 'POST', body: requestBody })).rejects.toThrow(/AUTHORIZATION/);
      expect(raw).toHaveBeenCalledTimes(method === 'prepare' ? 0 : 1);
      await expect(guarded(`${base}/chat/completions`, { method: 'POST', body: requestBody })).rejects.toThrow(/AUTHORIZATION/);
      expect(raw).toHaveBeenCalledTimes(method === 'prepare' ? 0 : 1); f.issuer.dispose();
    }
  });
  it('real SDK cannot replay a send after async confirmation fails, and cancels its unread response', async () => {
    const confirm = vi.fn(() => Promise.reject(new Error('late confirmation failure')));
    const markUnknown = vi.fn(); const cancel = vi.fn();
    const f = fixture(undefined, undefined, undefined, { fullSend: { counter: { prepare() {}, confirm, markUnknown }, observationIds: ['o'] } });
    const raw = vi.fn(async () => new Response(new ReadableStream({ cancel }), { headers: { 'content-type': 'application/json' } }));
    const client = new OpenAI({ apiKey: 'test', baseURL: base, maxRetries: 1, fetch: createProviderDisclosureFetch(f.context, raw) });
    await expect(client.chat.completions.create({ model: 'test-model', messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow();
    expect(raw).toHaveBeenCalledOnce(); expect(confirm).toHaveBeenCalledOnce(); expect(markUnknown).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce(); expect(() => assertProviderDisclosureActive(f.context)).toThrow(/AUTHORIZATION/); f.issuer.dispose();
  });
  it('cannot dispatch when an async prepare continuation completes after rejection', async () => {
    let release!: () => void; let completed = false;
    const pause = new Promise<void>(resolve => { release = resolve; });
    const counter = { async prepare() { await pause; completed = true; }, confirm() {}, markUnknown() {} };
    const f = fixture(undefined, undefined, undefined, { fullSend: { counter, observationIds: ['o'] } });
    const raw = vi.fn(async () => new Response(null)); const guarded = createProviderDisclosureFetch(f.context, raw);
    await expect(guarded(`${base}/chat/completions`, { method: 'POST', body: requestBody })).rejects.toThrow(/AUTHORIZATION/);
    release(); await pause; await Promise.resolve(); expect(completed).toBe(true); expect(raw).not.toHaveBeenCalled();
    await expect(guarded(`${base}/chat/completions`, { method: 'POST', body: requestBody })).rejects.toThrow(/AUTHORIZATION/);
    expect(raw).not.toHaveBeenCalled(); f.issuer.dispose();
  });

  it('rejects equal-size wire drift before capacity, counter preparation or dispatch and stays terminal', async () => {
    const url = `${base}/chat/completions`; const count = vi.fn(() => 100);
    const capacity = createTestOnlyCapacityProfile({ destination: url, model: 'test-model', windowTokens: 1000,
      outputLimitField: 'max_tokens', defaultOutputTokens: 20, safetyMarginTokens: 10, countSerializedInput: count });
    const prepare = vi.fn(); const binding = { expectedSerializedBody: requestBody,
      fullSend: { counter: { prepare, confirm: vi.fn(), markUnknown: vi.fn() }, observationIds: ['o'] } };
    const f = fixture(url, 'test-model', capacity, binding); binding.expectedSerializedBody = requestBody.replace('actual', 'drift!');
    const raw = vi.fn(async () => new Response(null, { status: 200 })); const guarded = createProviderDisclosureFetch(f.context, raw);
    await expect(guarded(url, { method: 'POST', body: binding.expectedSerializedBody })).rejects.toThrow();
    expect(count).not.toHaveBeenCalled(); expect(prepare).not.toHaveBeenCalled(); expect(raw).not.toHaveBeenCalled();
    await expect(guarded(url, { method: 'POST', body: requestBody })).rejects.toThrow(); f.issuer.dispose();
  });
  it('accepts exact frozen expected body across actual SDK retries', async () => {
    const url = `${base}/chat/completions`; const body = { model: 'test-model', messages: [{ role: 'user' as const, content: 'actual' }] };
    const f = fixture(url, 'test-model', testOnlyCapacity(url, 'test-model'), { expectedSerializedBody: JSON.stringify(body) });
    let calls = 0; const raw = vi.fn(async () => ++calls === 1
      ? new Response('{}', { status: 500, headers: { 'retry-after-ms': '1' } })
      : new Response(JSON.stringify({ id: 'completion', choices: [], model: 'test-model' }), { headers: { 'content-type': 'application/json' } }));
    const client = new OpenAI({ apiKey: 'test', baseURL: base, maxRetries: 1, fetch: createProviderDisclosureFetch(f.context, raw) });
    await client.chat.completions.create(body); expect(raw).toHaveBeenCalledTimes(2); f.issuer.dispose();
  });
  it('unknown capacity and large actual wire schema are refused before any fetch', async () => {
    const url = `${base}/chat/completions`;
    const small = createTestOnlyCapacityProfile({ destination: url, model: 'test-model', windowTokens: 200,
      outputLimitField: 'max_tokens', defaultOutputTokens: 20, safetyMarginTokens: 10, countSerializedInput: body => Buffer.byteLength(body) });
    for (const cap of [null, small]) {
      const f = fixture(url, 'test-model', cap); const raw = vi.fn();
      const guarded = createProviderDisclosureFetch(f.context, raw);
      const huge = JSON.stringify({ ...JSON.parse(requestBody), tools: [{ description: 'schema'.repeat(1000) }] });
      await expect(guarded(url, { method: 'POST', body: huge })).rejects.toThrow(/CAPACITY|BUDGET/);
      expect(raw).not.toHaveBeenCalled(); f.issuer.dispose();
    }
  });
  it('checks capacity again on actual SDK retry without replaying the underlying transport', async () => {
    const url = `${base}/chat/completions`; let count = 0;
    const cap = createTestOnlyCapacityProfile({ destination: url, model: 'test-model', windowTokens: 1000,
      outputLimitField: 'max_tokens', defaultOutputTokens: 20, safetyMarginTokens: 10, countSerializedInput: () => ++count === 1 ? 100 : NaN });
    const f = fixture(url, 'test-model', cap); const raw = vi.fn(async () => new Response('{}', { status: 500, headers: { 'retry-after-ms': '1' } }));
    const client = new OpenAI({ apiKey: 'test', baseURL: base, maxRetries: 1, fetch: createProviderDisclosureFetch(f.context, raw) });
    await expect(client.chat.completions.create({ model: 'test-model', messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow();
    expect(count).toBe(2); expect(raw).toHaveBeenCalledOnce(); expect(() => assertProviderDisclosureActive(f.context)).toThrow(/CAPACITY/);
    f.issuer.dispose();
  });
  it('actual project model cannot activate fallback after an owner mismatch', async () => {
    const owner = fixture(); const foreign = fixture(); const raw = vi.fn(); vi.stubGlobal('fetch', raw);
    const factory = vi.fn(() => openAIAdapter());
    const config = { schemaVersion: 2, defaultProvider: 'test', defaultModelId: 'current',
      providers: { test: { type: 'custom', protocol: 'openai_legacy', baseUrl: base, apiKey: 'test' } },
      models: { current: { provider: 'test', model: 'current', label: 'current' }, selected: { provider: 'test', model: 'selected', label: 'selected' } } } as Config;
    const model = await createProjectAgentModel({ modelId: 'selected', loadConfig: async () => config, createAdapter: factory });
    await expect(withObservationExecutionOwner(scopeOwner(owner.context), async () => drain(model.stream({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'material' }] }], tools: [], systemPrompt: 'system',
      invocationId: 'test-fallback', deadline: Date.now() + 5000, options: { providerDisclosure: foreign.context },
    })))).rejects.toThrow(/OWNER/);
    expect(factory).toHaveBeenCalledTimes(1); expect(raw).not.toHaveBeenCalled(); owner.issuer.dispose(); foreign.issuer.dispose();
  });
  it('missing options cannot bypass owner scope in direct adapter or Desktop summary sends', async () => {
    for (const summary of [false, true]) {
      const f = fixture(); f.revoke(); const raw = vi.fn(); vi.stubGlobal('fetch', raw);
      const adapter = openAIAdapter();
      await expect(withObservationExecutionOwner(scopeOwner(f.context), async () => {
        await Promise.resolve();
        const messages = [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'material' }] }];
        await drain(summary ? streamDesktopSummaryRecovery({ adapter, messages, tools: [], systemPrompt: 'summary',
          invocationId: 'summary-recovery', deadline: Date.now() + 5000, canRecover: () => true }) : adapter.stream(messages, [], 'direct'));
      })).rejects.toThrow(/AUTHORIZATION/);
      expect(raw).not.toHaveBeenCalled(); f.issuer.dispose();
    }
  });

  it('concurrent owner scopes on the same adapter do not cross-authorize when options are absent', async () => {
    const denied = fixture(); denied.revoke(); const permitted = fixture();
    const raw = vi.fn(async () => new Response('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      { headers: { 'content-type': 'text/event-stream' } })); vi.stubGlobal('fetch', raw);
    const adapter = openAIAdapter();
    const outcomes = await Promise.allSettled([denied, permitted].map(f => withObservationExecutionOwner(scopeOwner(f.context), async () => {
      await Promise.resolve(); await drain(adapter.stream([{ role: 'user', content: [{ type: 'text', text: 'material' }] }], [], 'system'));
    })));
    expect(outcomes.map(result => result.status)).toEqual(['rejected', 'fulfilled']);
    expect(raw).toHaveBeenCalledTimes(1); denied.issuer.dispose(); permitted.issuer.dispose();
  });

  it('native eval rejects inherited scope even when no explicit context is supplied', async () => {
    const f = fixture('https://api.openai.com/v1/responses'); const raw = vi.fn(); vi.stubGlobal('fetch', raw);
    await expect(withObservationExecutionOwner(scopeOwner(f.context), () => createStatelessOpenAIResponse({ apiKey: 'test', baseUrl: 'https://api.openai.com/v1',
      model: 'test-model', input: [{ role: 'user', content: 'material' }] }))).rejects.toThrow(/AUTHORIZATION/);
    expect(raw).not.toHaveBeenCalled(); f.issuer.dispose();
  });
  it.each(['consume', 'cancel', 'error'] as const)('releases the real primitive attempt after response body %s', async kind => {
    const f = fixture(); const finishes: ReturnType<typeof vi.fn>[] = [];
    const original = f.issuer.dispatch.bind(f.issuer);
    vi.spyOn(f.issuer, 'dispatch').mockImplementation((...args) => {
      const attempt = original(...args); const finish = vi.fn(attempt.finish); finishes.push(finish);
      return { ...attempt, finish };
    });
    const raw = vi.fn(async () => new Response(new ReadableStream({
      pull(controller) {
        if (kind === 'error') controller.error(new Error('body failure'));
        else if (kind === 'consume') { controller.enqueue(new TextEncoder().encode('done')); controller.close(); }
      },
    })));
    const guarded = createProviderDisclosureFetch(f.context, raw);
    const response = await guarded(`${base}/chat/completions`, { method: 'POST', body: requestBody });
    if (kind === 'consume') expect(await response.text()).toBe('done');
    else if (kind === 'cancel') await response.body!.cancel();
    else await expect(response.text()).rejects.toThrow('body failure');
    expect(finishes[0]).toHaveBeenCalledTimes(1);
    disposeProviderDisclosureContext(f.context); expect(finishes[0]).toHaveBeenCalledTimes(1); f.issuer.dispose();
  });

  it('revocation aborts transport while the returned response body is still pending', async () => {
    const f = fixture(); let signal: AbortSignal | undefined; const cancelled = vi.fn();
    const guarded = createProviderDisclosureFetch(f.context, vi.fn(async (_url, init) => {
      signal = init?.signal!; return new Response(new ReadableStream({ cancel: cancelled }));
    }));
    const response = await guarded(`${base}/chat/completions`, { method: 'POST', body: requestBody });
    const consuming = response.text(); f.revoke();
    await expect(consuming).rejects.toThrow(/AUTHORIZATION/);
    expect(signal?.aborted).toBe(true); expect(cancelled).toHaveBeenCalledTimes(1);
    f.issuer.dispose();
  });

  it('rejects forged contexts and unknown body before invoking transport', async () => {
    const raw = vi.fn(); const f = fixture();
    expect(() => createProviderDisclosureFetch({} as typeof f.context, raw)).toThrow();
    const guarded = createProviderDisclosureFetch(f.context, raw);
    await expect(guarded(`${base}/chat/completions`, { method: 'POST', body: new Uint8Array([1]) })).rejects.toThrow();
    expect(raw).not.toHaveBeenCalled(); f.issuer.dispose();
  });

  it.each([null, false, {}])('production adapters reject supplied invalid context %s', async forged => {
    const raw = vi.fn(); vi.stubGlobal('fetch', raw);
    const options = { providerDisclosure: forged } as unknown as StreamOptions;
    for (const adapter of [openAIAdapter(), new ClaudeAdapter('test', 'test-model', 'https://provider.example'), new OpenAIResponsesAdapter('test', 'test-model', base)]) {
      await expect(drain(adapter.stream([], [], 'system', options))).rejects.toThrow(/AUTHORIZATION/);
    }
    expect(raw).not.toHaveBeenCalled();
  });

  it('freezes first actual wire body and rejects changed bytes/model/destination on retries', async () => {
    for (const mutation of ['body', 'model', 'destination']) {
      const f = fixture(); const raw = vi.fn(async () => new Response('ok'));
      const guarded = createProviderDisclosureFetch(f.context, raw);
      await (await guarded(`${base}/chat/completions`, { method: 'POST', body: requestBody })).text();
      const changed = mutation === 'model' ? requestBody.replace('test-model', 'other-model') : requestBody.replace('actual', 'changed');
      await expect(guarded(mutation === 'destination' ? `${base}/other` : `${base}/chat/completions`,
        { method: 'POST', body: mutation === 'destination' ? requestBody : changed })).rejects.toThrow();
      expect(raw).toHaveBeenCalledTimes(1); expect(getProviderDisclosureSignal(f.context).aborted).toBe(true);
      expect(() => assertProviderDisclosureActive(f.context)).toThrow(); f.issuer.dispose();
    }
  });

  it.each(['openai', 'claude'] as const)('real %s SDK automatic retry re-enters guard and rejects revocation', async (kind) => {
    const endpoint = `${base}/${kind === 'openai' ? 'chat/completions' : 'messages'}`;
    const f = fixture(endpoint); let fetchCalls = 0;
    const raw = vi.fn(async (_input: unknown, init?: RequestInit) => {
      expect(init?.redirect).toBe('error'); fetchCalls++;
      f.revoke();
      return new Response('{"error":{"message":"retry","type":"server_error"}}', {
        status: 500, headers: { 'content-type': 'application/json', 'retry-after-ms': '1' },
      });
    });
    const guarded = createProviderDisclosureFetch(f.context, raw);
    // SDK implementations are real; only their underlying HTTP transport is controlled.
    const retryFetch = vi.fn(guarded);
    const options = { apiKey: 'test', baseURL: kind === 'claude' ? 'https://provider.example' : base, maxRetries: 1, fetch: retryFetch };
    const promise = kind === 'openai'
      ? new OpenAI(options).chat.completions.create({ model: 'test-model', messages: [{ role: 'user', content: 'actual' }] })
      : new Anthropic(options).messages.create({ model: 'test-model', max_tokens: 8, messages: [{ role: 'user', content: 'actual' }] });
    await expect(promise).rejects.toThrow();
    expect(retryFetch.mock.calls.length).toBeGreaterThan(1);
    expect(fetchCalls).toBe(1); expect(() => assertProviderDisclosureActive(f.context)).toThrow();
    f.issuer.dispose();
  }, 15000);

  it('two concurrent invocation fetch closures do not share capabilities', async () => {
    const a = fixture(); const b = fixture(); let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const rawA = vi.fn(async () => { await pending; return new Response('a'); });
    const rawB = vi.fn(async () => new Response('b'));
    const ga = createProviderDisclosureFetch(a.context, rawA); const gb = createProviderDisclosureFetch(b.context, rawB);
    const pa = ga(`${base}/chat/completions`, { method: 'POST', body: requestBody });
    a.revoke();
    expect(await (await gb(`${base}/chat/completions`, { method: 'POST', body: requestBody.replace('actual', 'B') })).text()).toBe('b');
    expect(() => assertProviderDisclosureActive(b.context)).not.toThrow();
    release(); await pa.catch(() => {}); disposeProviderDisclosureContext(a.context); disposeProviderDisclosureContext(b.context);
    a.issuer.dispose(); b.issuer.dispose();
  });

  it('Claude production adapter guards the real promptCache body', async () => {
    const f = fixture(`${base}/messages`); const captures: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init?: RequestInit) => {
      captures.push(String(init?.body)); expect(init?.redirect).toBe('error'); f.revoke();
      return new Response('{}', { status: 500, headers: { 'retry-after-ms': '1' } });
    }));
    const adapter = new ClaudeAdapter('test', 'test-model', 'https://provider.example');
    const options: StreamOptions = { providerDisclosure: f.context, promptCache: {
      messages: [{ role: 'user', content: [{ type: 'text', text: 'CACHED_ACTUAL' }] }], tools: [], systemPrompt: [{ type: 'text', text: 'cache-system' }],
    } };
    await expect(drain(adapter.stream([{ role: 'user', content: [{ type: 'text', text: 'UNUSED' }] }], [], 'unused-system', options))).rejects.toThrow();
    expect(captures).toHaveLength(1); expect(captures[0]).toContain('CACHED_ACTUAL'); expect(captures[0]).not.toContain('UNUSED');
    f.issuer.dispose();
  }, 15000);

  it('OpenAI production adapter prevents SDK retry and does not downgrade terminal authorization', async () => {
    const f = fixture();
    const raw = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(init?.redirect).toBe('error'); f.revoke();
      return new Response('{}', { status: 500, headers: { 'retry-after-ms': '1' } });
    }); vi.stubGlobal('fetch', raw);
    await expect(drain(openAIAdapter().stream([{ role: 'user', content: [{ type: 'text', text: 'actual' }] }], [], 'system',
      { providerDisclosure: f.context }))).rejects.toThrow(/AUTHORIZATION/);
    expect(raw).toHaveBeenCalledTimes(1); f.issuer.dispose();
  }, 15000);

  it('two overlapping invocations on the same real OpenAI adapter keep separate context', async () => {
    const a = fixture(); const b = fixture(); let started!: () => void; let release!: () => void;
    const firstStarted = new Promise<void>(resolve => { started = resolve; });
    const pending = new Promise<void>(resolve => { release = resolve; });
    const raw = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const sent = String(init?.body);
      if (sent.includes('INVOCATION_A')) { started(); await pending; }
      return new Response('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } });
    }); vi.stubGlobal('fetch', raw);
    const adapter = openAIAdapter();
    const first = drain(adapter.stream([{ role: 'user', content: [{ type: 'text', text: 'INVOCATION_A' }] }], [], 'system', { providerDisclosure: a.context }));
    const observedFirst = first.catch(error => error);
    await firstStarted;
    await drain(adapter.stream([{ role: 'user', content: [{ type: 'text', text: 'INVOCATION_B' }] }], [], 'system', { providerDisclosure: b.context }));
    a.revoke(); release(); await observedFirst;
    expect(raw).toHaveBeenCalledTimes(2);
    a.issuer.dispose(); b.issuer.dispose();
  }, 15000);

  it('Responses production outer retry cannot resend revoked body', async () => {
    const f = fixture(`${base}/responses`);
    const raw = vi.fn(async () => { f.revoke(); throw new TypeError('fetch failed'); }); vi.stubGlobal('fetch', raw);
    const adapter = new OpenAIResponsesAdapter('test', 'test-model', base);
    await expect(drain(adapter.stream([{ role: 'user', content: [{ type: 'text', text: 'actual' }] }], [], 'system', { providerDisclosure: f.context }))).rejects.toThrow();
    expect(raw).toHaveBeenCalledTimes(1); f.issuer.dispose();
  }, 15000);

  it('eval-only native Responses refuses guarded context instead of dropping it', async () => {
    const f = fixture('https://api.openai.com/v1/responses'); const raw = vi.fn(); vi.stubGlobal('fetch', raw);
    await expect(createStatelessOpenAIResponse({ apiKey: 'test', baseUrl: 'https://api.openai.com/v1', model: 'test-model',
      input: [{ role: 'user', content: 'actual' }], providerDisclosure: f.context })).rejects.toThrow();
    expect(raw).not.toHaveBeenCalled(); f.issuer.dispose();
  });
});

it('waits for actual response body cancellation before disposed issuer drain completes', async () => {
  const f = fixture(); let cancelComplete!: () => void;
  const raw = vi.fn(async () => new Response(new ReadableStream({ cancel: () => new Promise<void>(done => { cancelComplete = done; }) })));
  const guarded = createProviderDisclosureFetch(f.context, raw as typeof fetch);
  const response = await guarded(`${base}/chat/completions`, { method: 'POST', body: requestBody });
  let drained = false; const draining = f.issuer.disposeAndDrain().then(() => { drained = true; });
  await Promise.resolve(); expect(drained).toBe(false);
  cancelComplete(); await draining; expect(drained).toBe(true);
  await expect(response.body!.cancel()).rejects.toThrow();
});

it('does not confuse an aborted pending reader completion with actual cancel settlement', async () => {
  const f = fixture(); let cancelComplete!: () => void;
  const guarded = createProviderDisclosureFetch(f.context, (async () => new Response(new ReadableStream({
    cancel: () => new Promise<void>(done => { cancelComplete = done; }),
  }))) as typeof fetch);
  const response = await guarded(`${base}/chat/completions`, { method: 'POST', body: requestBody });
  const reading = response.body!.getReader().read().catch(() => undefined);
  await Promise.resolve();
  let drained = false; const draining = f.issuer.disposeAndDrain().then(() => { drained = true; });
  await reading; for (let n = 0; n < 8; n++) await Promise.resolve();
  expect(drained).toBe(false); cancelComplete(); await draining;
});
