// @vitest-environment node
import { expect, it } from 'vitest';
import { DEFAULT_CONFIG, type Config, type ModelAdapter, type StreamChunk } from '../../../src/types.js';
import { createProjectAgentModel } from '../../electron/project-agent-model.js';
import { streamDesktopSummaryRecovery } from '../../electron/desktop-summary-stream.js';
import * as services from '../../electron/desktop-services.js';
import type { DesktopTaskRequestPreparer } from '../../electron/desktop-task-stream.js';

// The test config appends only an export alias to the real private function.
const finalize = (services as unknown as { __testFinalization(input: {
  adapter: ModelAdapter; projectModel?: Awaited<ReturnType<typeof createProjectAgentModel>>;
  prepareRequest?: DesktopTaskRequestPreparer; beforeRequest?: () => Promise<void>;
  deadline?: number; apiMessages: ReturnType<typeof request>['messages']; systemPrompt: string;
  streamOptions: ReturnType<typeof request>['options']; signal: AbortSignal;
  sessionId: string; turnId: string; intentId: string; stepId: string;
  emitRuntimeEvent(event: { type: string; state?: string }): void | Promise<void>;
  onUsage?(chunk: Extract<StreamChunk, { type: 'usage' }>, id: string): void;
}): Promise<{ reply: string }> }).__testFinalization;

const config = (): Config => ({ ...structuredClone(DEFAULT_CONFIG), schemaVersion: 2, defaultProvider: 'local', defaultModelId: 'current',
  providers: { local: { type: 'custom', protocol: 'openai_legacy', baseUrl: 'http://localhost:1234/v1' } },
  models: { current: { provider: 'local', model: 'current', label: 'Current', capabilities: ['tools'] },
    selected: { provider: 'local', model: 'selected', label: 'Selected', capabilities: ['tools'] } },
});
const request = () => ({ messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'work' }] }],
  tools: [], systemPrompt: 'test', invocationId: 'initial', deadline: Date.now() + 10000,
  options: { signal: new AbortController().signal } });
async function collect(stream: AsyncIterable<StreamChunk>) { const out: StreamChunk[] = []; for await (const chunk of stream) out.push(chunk); return out; }
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
const answer = async function* (): AsyncGenerator<StreamChunk> { yield { type: 'text', delta: 'done' }; yield { type: 'done' }; };

it.each([null, 'selected'])('real project model has one prepare, authority check and invocation owner: %s', async modelId => {
  const order: string[] = [];
  const model = await createProjectAgentModel({ modelId, loadConfig: async () => config(), createAdapter: binding => ({
    getModelName: () => binding.wireModel, stream() { order.push('send'); return answer(); },
  }) });
  await collect(model.stream({ ...request(), beforeRequest: async () => { order.push('authority'); },
    prepareRequest: async input => { order.push('prepare'); return input; }, onInvocation: () => { order.push('invocation'); } }));
  expect(order).toEqual(['authority', 'prepare', 'invocation', 'send']);
});

it.each([null, 'selected'])('project preparation rejection is not a provider fallback: %s', async modelId => {
  let sends = 0; const reason = Error('original preparation failure');
  const model = await createProjectAgentModel({ modelId, loadConfig: async () => config(), createAdapter: binding => ({
    getModelName: () => binding.wireModel, stream() { sends++; return answer(); },
  }) });
  await expect(collect(model.stream({ ...request(), prepareRequest: async () => { throw reason; } }))).rejects.toBe(reason);
  expect(sends).toBe(0);
});

it.each(['abort', 'deadline'])('selected project rechecks %s after preparation before sending', async mode => {
  let sends = 0; const controller = new AbortController(); const reason = new DOMException('original cancellation', 'AbortError');
  const model = await createProjectAgentModel({ modelId: 'selected', loadConfig: async () => config(), createAdapter: binding => ({
    getModelName: () => binding.wireModel, stream() { sends++; return answer(); },
  }) });
  const input = { ...request(), options: { signal: controller.signal }, prepareRequest: async (value: Parameters<DesktopTaskRequestPreparer>[0]) => {
    if (mode === 'abort') controller.abort(reason); else input.deadline = 0; return value;
  } };
  const pending = collect(model.stream(input));
  if (mode === 'abort') await expect(pending).rejects.toBe(reason); else await expect(pending).rejects.toThrow('deadline');
  expect(sends).toBe(0);
});

it('failed selected usage keeps its invocation and awaits status before fallback preparation', async () => {
  const entered = deferred(), barrier = deferred(); const order: string[] = [], usageIds: string[] = [], ids: string[] = [];
  let currentId = ''; let recoveryNotice: unknown;
  const model = await createProjectAgentModel({ modelId: 'selected', loadConfig: async () => config(), createAdapter: binding => ({
    getModelName: () => binding.wireModel, async *stream() {
      order.push('send:' + binding.modelId);
      if (binding.modelId === 'selected') {
        yield { type: 'usage', usage: { inputTokens: 7, outputTokens: 2 } };
        yield { type: 'tool_use', id: 'discard', name: 'write', input: {} }; throw Error('HTTP 503');
      }
      yield { type: 'usage', usage: { inputTokens: 3, outputTokens: 1 } }; yield* answer();
    },
  }) });
  const out: StreamChunk[] = [];
  const pending = (async () => { for await (const chunk of model.stream({ ...request(),
    prepareRequest: async value => { order.push('prepare'); return value; },
    onInvocation: id => { currentId = id; ids.push(id); },
    onRecovery: async notice => { recoveryNotice = notice; order.push('status'); entered.resolve(); await barrier.promise; },
  })) { out.push(chunk); if (chunk.type === 'usage') usageIds.push(currentId); } })();
  try { await Promise.race([entered.promise, pending.then(() => { throw Error('status_callback_not_invoked'); })]); expect(recoveryNotice).toEqual({ summaryOnly: false }); expect(order).toEqual(['prepare', 'send:selected', 'status']); expect(usageIds).toEqual([ids[0]]); }
  finally { barrier.resolve(); }
  await pending;
  expect(order).toEqual(['prepare', 'send:selected', 'status', 'prepare', 'send:current']);
  expect(ids).toHaveLength(2); expect(ids[0]).not.toBe(ids[1]); expect(usageIds).toEqual(ids);
  expect(out.some(chunk => chunk.type === 'tool_use')).toBe(false);
});

it('selected status rejection cannot open the fallback request', async () => {
  const reason = Error('original status failure'); const calls: string[] = [];
  const model = await createProjectAgentModel({ modelId: 'selected', loadConfig: async () => config(), createAdapter: binding => ({
    getModelName: () => binding.wireModel, async *stream() { calls.push(binding.modelId); throw Error('HTTP 503'); },
  }) });
  await expect(collect(model.stream({ ...request(), onRecovery: async () => { throw reason; } }))).rejects.toBe(reason);
  expect(calls).toEqual(['selected']);
});

it('selected usage consumer failure escapes without replaying a provider', async () => {
  const reason = Error('terminated journal'); const calls: string[] = [];
  const model = await createProjectAgentModel({ modelId: 'selected', loadConfig: async () => config(), createAdapter: binding => ({
    getModelName: () => binding.wireModel, async *stream() { calls.push(binding.modelId); yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }; yield* answer(); },
  }) });
  await expect((async () => { for await (const chunk of model.stream(request())) if (chunk.type === 'usage') throw reason; })()).rejects.toBe(reason);
  expect(calls).toEqual(['selected']);
});

it('summary recovery awaits status before the second prepare and preserves authority ownership', async () => {
  const entered = deferred(), barrier = deferred(); const order: string[] = []; let sends = 0; let recoveryNotice: unknown;
  const pending = collect(streamDesktopSummaryRecovery({ ...request(), canRecover: () => true,
    adapter: { async *stream() { order.push('send'); if (++sends === 1) { yield { type: 'text', delta: 'prefix' }; throw Error('terminated'); } yield* answer(); } },
    beforeRequest: async () => { order.push('authority'); }, prepareRequest: async value => { order.push('prepare'); return value; },
    onRecovery: async notice => { recoveryNotice = notice; order.push('status'); entered.resolve(); await barrier.promise; },
  }));
  try { await Promise.race([entered.promise, pending.then(() => { throw Error('status_callback_not_invoked'); })]); expect(recoveryNotice).toEqual({ summaryOnly: true }); expect(order).toEqual(['authority', 'prepare', 'send', 'status']); }
  finally { barrier.resolve(); }
  await pending; expect(order).toEqual(['authority', 'prepare', 'send', 'status', 'authority', 'prepare', 'send']);
});

it.each([null, 'selected'])('actual private finalization has one project preparation owner: %s', async modelId => {
  const prepared: string[] = [], sent: string[] = [];
  const model = await createProjectAgentModel({ modelId, loadConfig: async () => config(), createAdapter: binding => ({
    getModelName: () => binding.wireModel, stream() { sent.push(binding.modelId); return answer(); },
  }) });
  const input = request(); const result = await finalize({ adapter: model.adapter, projectModel: model,
    prepareRequest: async value => { prepared.push(value.invocationId); return value; }, deadline: input.deadline,
    apiMessages: input.messages, systemPrompt: input.systemPrompt, streamOptions: input.options, signal: input.options.signal,
    sessionId: 's', turnId: 't', intentId: 'i', stepId: 'step', emitRuntimeEvent() {},
  });
  expect(result.reply).toBe('done'); expect(sent).toHaveLength(1); expect(prepared).toHaveLength(1);
});

it('actual private ordinary finalization prepares each recovery attempt with a distinct usage owner', async () => {
  const prepared: string[] = [], usageIds: string[] = [], events: string[] = []; let sends = 0;
  const adapter: ModelAdapter = { getModelName: () => 'test', async *stream(_messages, tools) {
    expect(tools).toEqual([]); yield { type: 'usage', usage: { inputTokens: 2, outputTokens: 1 } };
    if (++sends === 1) throw Error('terminated'); yield* answer();
  } };
  const input = request(); const result = await finalize({ adapter,
    prepareRequest: async value => { prepared.push(value.invocationId); return value; }, deadline: input.deadline,
    apiMessages: input.messages, systemPrompt: input.systemPrompt, streamOptions: input.options, signal: input.options.signal,
    sessionId: 's', turnId: 't', intentId: 'i', stepId: 'step', emitRuntimeEvent(event) { if (event.type === 'execution_health') events.push(event.state!); },
    onUsage(_chunk, id) { usageIds.push(id); },
  });
  expect(result.reply).toBe('done'); expect(prepared).toHaveLength(2); expect(prepared[0]).not.toBe(prepared[1]);
  expect(usageIds).toEqual(prepared); expect(events).toEqual(['recovering', 'running']);
});

it.each(['ordinary', 'default', 'selected'])('private finalization preparation rejection prevents sending: %s', async mode => {
  let sends = 0; const reason = Error('original finalization preparation rejection');
  const adapter: ModelAdapter = { getModelName: () => 'test', stream() { sends++; return answer(); } };
  const projectModel = mode === 'ordinary' ? undefined : await createProjectAgentModel({
    modelId: mode === 'default' ? null : 'selected', loadConfig: async () => config(), createAdapter: () => adapter,
  });
  const input = request();
  await expect(finalize({ adapter, projectModel, prepareRequest: async () => { throw reason; }, deadline: input.deadline,
    apiMessages: input.messages, systemPrompt: input.systemPrompt, streamOptions: input.options, signal: input.options.signal,
    sessionId: 's', turnId: 't', intentId: 'i', stepId: 'step', emitRuntimeEvent() {},
  })).rejects.toBe(reason);
  expect(sends).toBe(0);
});

it('private finalization awaits durable recovery status before preparing another request', async () => {
  const entered = deferred(), barrier = deferred(); const order: string[] = []; let sends = 0;
  const adapter: ModelAdapter = { getModelName: () => 'test', async *stream() {
    order.push('send'); if (++sends === 1) throw Error('terminated'); yield* answer();
  } };
  const input = request(); const pending = finalize({ adapter,
    prepareRequest: async value => { order.push('prepare'); return value; }, deadline: input.deadline,
    apiMessages: input.messages, systemPrompt: input.systemPrompt, streamOptions: input.options, signal: input.options.signal,
    sessionId: 's', turnId: 't', intentId: 'i', stepId: 'step', async emitRuntimeEvent(event) {
      if (event.type === 'execution_health' && event.state === 'recovering') { order.push('status'); entered.resolve(); await barrier.promise; }
    },
  });
  try { await Promise.race([entered.promise, pending.then(() => { throw Error('status_callback_not_invoked'); })]); expect(order).toEqual(['prepare', 'send', 'status']); }
  finally { barrier.resolve(); }
  await pending; expect(order).toEqual(['prepare', 'send', 'status', 'prepare', 'send']);
});

it('private finalization recovery status failure prevents a second provider request', async () => {
  const reason = Error('original recovery status failure'); let sends = 0, prepares = 0;
  const adapter: ModelAdapter = { getModelName: () => 'test', async *stream() { sends++; throw Error('terminated'); } };
  const input = request();
  await expect(finalize({ adapter,
    prepareRequest: async value => { prepares++; return value; }, deadline: input.deadline,
    apiMessages: input.messages, systemPrompt: input.systemPrompt, streamOptions: input.options, signal: input.options.signal,
    sessionId: 's', turnId: 't', intentId: 'i', stepId: 'step', emitRuntimeEvent(event) {
      if (event.type === 'execution_health') throw reason;
    },
  })).rejects.toBe(reason);
  expect(sends).toBe(1); expect(prepares).toBe(1);
});

it('selected provider iterator close failure cannot trigger default fallback', async () => {
  const reason = Error('original iterator close failure'); const calls: string[] = [];
  const model = await createProjectAgentModel({ modelId: 'selected', loadConfig: async () => config(), createAdapter: binding => ({
    getModelName: () => binding.wireModel, stream() {
      calls.push(binding.modelId); let index = 0;
      const iterator: AsyncIterableIterator<StreamChunk> = { [Symbol.asyncIterator]() { return this; }, async next(): Promise<IteratorResult<StreamChunk>> {
        if (++index === 1) return { done: false, value: { type: 'text', delta: 'done' } };
        if (index === 2) return { done: false, value: { type: 'done' } };
        return { done: true, value: undefined };
      }, async return(): Promise<IteratorResult<StreamChunk>> { throw reason; } };
      return iterator;
    },
  }) });
  await expect(collect(model.stream(request()))).rejects.toBe(reason); expect(calls).toEqual(['selected']);
});

it.each(['text-only', 'done-only', 'empty'])('preserves existing selected incomplete-response fallback: %s', async mode => {
  const calls: string[] = [];
  const model = await createProjectAgentModel({ modelId: 'selected', loadConfig: async () => config(), createAdapter: binding => ({
    getModelName: () => binding.wireModel, async *stream() {
      calls.push(binding.modelId);
      if (binding.modelId === 'selected') {
        if (mode === 'text-only') yield { type: 'text', delta: 'discarded partial' };
        if (mode === 'done-only') yield { type: 'done' };
        return;
      }
      yield* answer();
    },
  }) });
  expect(await collect(model.stream(request()))).toEqual([{ type: 'text', delta: 'done' }, { type: 'done' }]);
  expect(calls).toEqual(['selected', 'current']);
});
