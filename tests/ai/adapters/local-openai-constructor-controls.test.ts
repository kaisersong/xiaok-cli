import { afterEach, describe, expect, it, vi } from 'vitest';
import OpenAI, { APIPromise } from 'openai';
import { Stream } from 'openai/core/streaming';
import type { ChatCompletionChunk } from 'openai/resources/chat/completions';
import { createLocalChatCompletionFactory } from '../../support/local-openai-constructor-return.js';

// Public SDK classes only. The mock below is an exact pass-through, never a fake SDK constructor.
const constructorBoot = await vi.hoisted(async () => {
  const order: string[] = [];
  const actual = await vi.importActual<typeof import('openai')>('openai');
  const streaming = await vi.importActual<typeof import('openai/core/streaming')>('openai/core/streaming');
  order.push('sdk');
  const helper = await import('../../support/local-openai-constructor-return.js');
  order.push('helper');
  return { actual, streaming, helper, order };
});
vi.mock('openai', () => {
  constructorBoot.order.push('mock');
  return constructorBoot.actual;
});
constructorBoot.order.push('body');

// Extracted from the ORIGINAL21 constructor source rows, not default/new credentials or a profile.
const originalOptions21: Array<{ line: number; options: NonNullable<ConstructorParameters<typeof OpenAI>[0]> }> = [
  { line: 88, options: { apiKey: 'test' } },
  { line: 1203, options: { apiKey: 'test' } },
  { line: 1254, options: { apiKey: 'test' } },
  { line: 2023, options: { apiKey: 'test' } },
  { line: 2119, options: { apiKey: 'test' } },
  { line: 2424, options: { apiKey: 'test' } },
  { line: 2631, options: { apiKey: 'test' } },
  { line: 2940, options: { apiKey: 'test' } },
  { line: 3186, options: { apiKey: 'test' } },
  { line: 3345, options: { apiKey: 'test' } },
  { line: 3398, options: { apiKey: 'test' } },
  { line: 3427, options: { apiKey: 'test' } },
  { line: 3489, options: { apiKey: 'test' } },
  { line: 3604, options: { apiKey: 'test' } },
  { line: 3714, options: { apiKey: 'test' } },
  { line: 3794, options: { apiKey: 'test' } },
  { line: 3857, options: { apiKey: 'test' } },
  { line: 3926, options: { apiKey: 'test' } },
  { line: 4043, options: { apiKey: 'test' } },
  { line: 4086, options: { apiKey: 'test' } },
  { line: 4118, options: { apiKey: 'test' } },
];
const sdk = { Client: OpenAI, APIPromise, Stream };

function unitChunk(id: string): ChatCompletionChunk {
  return { id, object: 'chat.completion.chunk', created: 0, model: 'UNIT_DATA_ONLY', choices: [] };
}
function sourceOf(chunk: ChatCompletionChunk): AsyncIterable<ChatCompletionChunk> {
  return { async *[Symbol.asyncIterator]() { yield chunk; } };
}
function fixture(index: number) {
  const original = originalOptions21[index];
  if (!original) throw new Error('original_option_row_missing');
  const factory = createLocalChatCompletionFactory(sdk);
  const receiver = {};
  factory.recordOptions(receiver, original.options);
  return { factory, receiver, options: original.options };
}
function deferred<T>() {
  // Native Promise executor is synchronous; these are resolver locals, never SDK/private brands.
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function watchDispatch() {
  const request = vi.spyOn(OpenAI.prototype, 'request');
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
    // A dispatch is a failing control, not a successful mock request. No network is sent.
    return Promise.reject(new Error('constructor_control_unexpected_fetch'));
  });
  const timer = vi.spyOn(globalThis, 'setTimeout');
  return { request, fetch, timer };
}
function quiet(spies: ReturnType<typeof watchDispatch>) {
  // Counts/booleans only: never print real client/header/optional environment fields.
  expect(spies.request.mock.calls.length).toBe(0);
  expect(spies.fetch.mock.calls.length).toBe(0);
}
const nextTurn = () => new Promise<void>(resolve => { setImmediate(resolve); });
afterEach(() => { vi.restoreAllMocks(); });

describe('local genuine public OpenAI constructors ONLY; no product harness or SDK request', () => {
  it('C01 publishes the actual SDK token before the original eager body starts', async () => {
    const spies = watchDispatch();
    const { factory, receiver } = fixture(0);
    let bodyCalls = 0;
    let tokenSeen: ReturnType<typeof factory.create> | undefined;
    const token = factory.create(receiver, async () => {
      bodyCalls += 1;
      tokenSeen = factory.lastTokenFor(receiver);
      return sourceOf(unitChunk('C01'));
    });
    expect(bodyCalls).toBe(1);
    expect(tokenSeen === token).toBe(true);
    expect(token instanceof APIPromise).toBe(true);
    expect(factory.clientFor(receiver) instanceof OpenAI).toBe(true);
    expect((await token) instanceof Stream).toBe(true);
    expect(spies.timer.mock.calls.length).toBe(0);
    quiet(spies);
  });

  it('C02 uses exactly the21 original constructor option rows without filling an identity', async () => {
    const spies = watchDispatch();
    const factory = createLocalChatCompletionFactory(sdk);
    expect(originalOptions21.length).toBe(21);
    for (const original of originalOptions21) {
      const receiver = {};
      factory.recordOptions(receiver, original.options);
      const token = factory.create(receiver, async () => sourceOf(unitChunk('C02')));
      await token;
      const client = factory.clientFor(receiver);
      expect(client instanceof OpenAI).toBe(true);
      expect(client?.apiKey === original.options.apiKey).toBe(true);
    }
    expect(spies.timer.mock.calls.length).toBe(0);
    quiet(spies);
  });

  it('C03 rejects missing original options before body or SDK client/token construction', () => {
    const spies = watchDispatch();
    const factory = createLocalChatCompletionFactory(sdk), receiver = {};
    let bodyCalls = 0;
    expect(() => factory.create(receiver, async () => {
      bodyCalls += 1;
      return sourceOf(unitChunk('C03'));
    })).toThrow('local_sdk_fixture_original_constructor_options_required');
    expect(bodyCalls).toBe(0);
    expect(factory.clientFor(receiver) === undefined).toBe(true);
    expect(factory.lastTokenFor(receiver) === undefined).toBe(true);
    expect(spies.timer.mock.calls.length).toBe(0);
    quiet(spies);
  });

  it('C04 caches a genuine client by receiver only while keeping each token/response independent', async () => {
    const spies = watchDispatch();
    const { factory, receiver, options } = fixture(0);
    const first = factory.create(receiver, async () => sourceOf(unitChunk('first')));
    const client = factory.clientFor(receiver);
    const second = factory.create(receiver, async () => sourceOf(unitChunk('second')));
    const otherReceiver = {};
    factory.recordOptions(otherReceiver, options);
    const other = factory.create(otherReceiver, async () => sourceOf(unitChunk('other')));
    expect(factory.clientFor(receiver) === client).toBe(true);
    expect(factory.clientFor(otherReceiver) === client).toBe(false);
    expect(first === second).toBe(false);
    expect((await first.asResponse()) === (await second.asResponse())).toBe(false);
    const [a, b, c] = await Promise.all([first, second, other]);
    expect(a.controller === b.controller).toBe(false);
    expect(b.controller === c.controller).toBe(false);
    quiet(spies);
  });

  it('C05 links raw creation rejection to asResponse,await,withResponse including falsy reasons', async () => {
    const spies = watchDispatch();
    const reasons: unknown[] = [new Error('raw'), new DOMException('raw abort', 'AbortError'), 'raw', 0, false, null, undefined];
    for (const reason of reasons) {
      const { factory, receiver } = fixture(0);
      const token = factory.create(receiver, async () => { throw reason; });
      await expect(token.asResponse()).rejects.toBe(reason);
      await expect(Promise.resolve(token)).rejects.toBe(reason);
      await expect(token.withResponse()).rejects.toBe(reason);
    }
    quiet(spies);
  });

  it('C06 observes an unparsed rejected body without orphaning or replacing its error', async () => {
    const spies = watchDispatch();
    const events: unknown[] = [], reason = new Error('unparsed original');
    const listener = (value: unknown) => { events.push(value); };
    process.on('unhandledRejection', listener);
    try {
      const { factory, receiver } = fixture(0);
      const token = factory.create(receiver, async () => { throw reason; });
      // No parse/asResponse/then on the SDK token until after the observation window.
      await nextTurn();
      await nextTurn();
      expect(events.length).toBe(0);
      await expect(token.asResponse()).rejects.toBe(reason);
      await expect(Promise.resolve(token)).rejects.toBe(reason);
      await expect(token.withResponse()).rejects.toBe(reason);
      expect(events.length).toBe(0);
      quiet(spies);
    } finally { process.removeListener('unhandledRejection', listener); }
  });

  it('C07 leaves metadata pending until original fulfillment and does not pull its iterator', async () => {
    const spies = watchDispatch();
    const { factory, receiver } = fixture(0);
    const gate = deferred<AsyncIterable<ChatCompletionChunk>>();
    let pulls = 0, resolved = false;
    const original: AsyncIterable<ChatCompletionChunk> = {
      async *[Symbol.asyncIterator]() { pulls += 1; yield unitChunk('C07'); },
    };
    try {
      const token = factory.create(receiver, () => gate.promise);
      const metadata = token.asResponse().then(response => { resolved = true; return response; });
      await Promise.resolve();
      expect(resolved).toBe(false);
      gate.resolve(original);
      const response = await metadata;
      expect(response instanceof Response).toBe(true);
      expect(response.status).toBe(200);
      expect(pulls).toBe(0);
      expect((await token.asResponse()) === response).toBe(true);
      quiet(spies);
    } finally { gate.resolve(original); }
  });

  it('C08 exposes a delayed original rejection through metadata without a false200', async () => {
    const spies = watchDispatch();
    const { factory, receiver } = fixture(0);
    const gate = deferred<AsyncIterable<ChatCompletionChunk>>(), reason = new Error('held creation failure');
    let completed = false;
    try {
      const token = factory.create(receiver, () => gate.promise);
      const metadata = token.asResponse().then(
        () => { completed = true; return { rejected: false, reason: undefined }; },
        error => { completed = true; return { rejected: true, reason: error }; },
      );
      await Promise.resolve();
      expect(completed).toBe(false);
      gate.reject(reason);
      const outcome = await metadata;
      expect(outcome.rejected).toBe(true);
      expect(outcome.reason === reason).toBe(true);
      await expect(Promise.resolve(token)).rejects.toBe(reason);
      await expect(token.withResponse()).rejects.toBe(reason);
      quiet(spies);
    } finally { gate.reject(reason); }
  });

  it('C09 memoizes parse and keeps actual local metadata/addRequestID behavior explicit', async () => {
    const spies = watchDispatch();
    const { factory, receiver } = fixture(0);
    let produces = 0, iteratorCalls = 0;
    const token = factory.create(receiver, async () => {
      produces += 1;
      return { async *[Symbol.asyncIterator]() { iteratorCalls += 1; yield unitChunk('C09'); } };
    });
    const wrapped = await token.withResponse(), data = await token;
    expect(data === wrapped.data).toBe(true);
    expect((await token.asResponse()) === wrapped.response).toBe(true);
    expect(wrapped.request_id).toBe(null);
    expect(produces).toBe(1);
    expect(iteratorCalls).toBe(0);
    expect(Object.hasOwn(data, '_request_id')).toBe(false);
    // No private/internal SDK parser or unwrap helper is called by these controls.
    const again = await token.withResponse();
    expect(again.data === data).toBe(true);
    expect(again.request_id).toBe(null);
    expect(Object.hasOwn(again.data, '_request_id')).toBe(false);
    quiet(spies);
  });

  it('C10 separates successful metadata from a later identical iterator failure', async () => {
    const spies = watchDispatch();
    const { factory, receiver } = fixture(0), reason = new Error('iteration failure');
    const token = factory.create(receiver, async () => ({
      async *[Symbol.asyncIterator]() { throw reason; },
    }));
    expect((await token.asResponse()).status).toBe(200);
    const stream = await token;
    await expect(stream[Symbol.asyncIterator]().next()).rejects.toBe(reason);
    expect((await token.asResponse()).status).toBe(200);
    quiet(spies);
  });

  it('C11 isolates reverse-settled concurrent values and responses on one receiver', async () => {
    const spies = watchDispatch();
    const { factory, receiver } = fixture(0);
    const a = deferred<AsyncIterable<ChatCompletionChunk>>(), b = deferred<AsyncIterable<ChatCompletionChunk>>();
    const one = unitChunk('one'), two = unitChunk('two');
    try {
      const first = factory.create(receiver, () => a.promise);
      const client = factory.clientFor(receiver);
      const second = factory.create(receiver, () => b.promise);
      b.resolve(sourceOf(two));
      const secondStream = await second, secondResponse = await second.asResponse();
      a.resolve(sourceOf(one));
      const firstStream = await first, firstResponse = await first.asResponse();
      expect(factory.clientFor(receiver) === client).toBe(true);
      expect(firstStream === secondStream).toBe(false);
      expect(firstResponse === secondResponse).toBe(false);
      const firstValues: ChatCompletionChunk[] = [], secondValues: ChatCompletionChunk[] = [];
      for await (const value of firstStream) firstValues.push(value);
      for await (const value of secondStream) secondValues.push(value);
      expect(firstValues[0] === one).toBe(true);
      expect(secondValues[0] === two).toBe(true);
      quiet(spies);
    } finally { a.resolve(sourceOf(one)); b.resolve(sourceOf(two)); }
  });

  it('C12 preserves original iterator receiver and one return on early break', async () => {
    const spies = watchDispatch();
    const { factory, receiver } = fixture(0), chunk = unitChunk('C12');
    let receiverMatched = false, pulls = 0, returns = 0;
    const original: AsyncIterable<ChatCompletionChunk> = {
      [Symbol.asyncIterator]() {
        receiverMatched = this === original;
        const iterator: AsyncIterator<ChatCompletionChunk> = {
          async next() { pulls += 1; return { done: false, value: chunk }; },
          async return() { returns += 1; return { done: true, value: undefined }; },
        };
        return iterator;
      },
    };
    const stream = await factory.create(receiver, async () => original);
    for await (const value of stream) { expect(value === chunk).toBe(true); break; }
    expect(receiverMatched).toBe(true);
    expect(pulls).toBe(1);
    expect(returns).toBe(1);
    quiet(spies);
  });

  it('C13 keeps the local Stream controller separate and preserves caller abort/finally', async () => {
    const spies = watchDispatch();
    const { factory, receiver } = fixture(0), caller = new AbortController();
    const reason = new DOMException('original caller', 'AbortError');
    let finish = 0, remove: (() => void) | undefined;
    const token = factory.create(receiver, async () => ({
      async *[Symbol.asyncIterator]() {
        try {
          yield unitChunk('C13');
          await new Promise<never>((_resolve, reject) => {
            const abort = () => { reject(caller.signal.reason); };
            remove = () => { caller.signal.removeEventListener('abort', abort); };
            if (caller.signal.aborted) abort();
            else caller.signal.addEventListener('abort', abort, { once: true });
          });
        } finally { remove?.(); finish += 1; }
      },
    }));
    try {
      const stream = await token, iterator = stream[Symbol.asyncIterator]();
      await iterator.next();
      let settled = false;
      const outcome = iterator.next().then(
        value => { settled = true; return { rejected: false, reason: value }; },
        error => { settled = true; return { rejected: true, reason: error }; },
      );
      stream.controller.abort('LOCAL_METADATA_ONLY');
      await Promise.resolve();
      expect(caller.signal.aborted).toBe(false);
      expect(settled).toBe(false);
      caller.abort(reason);
      const result = await outcome;
      expect(result.rejected).toBe(true);
      expect(result.reason === reason).toBe(true);
      expect(finish).toBe(1);
      quiet(spies);
    } finally { caller.abort(reason); remove?.(); }
  });

  it('C14 validates awaited hoist and a synthetic5min stall with only its owned timer', async () => {
    expect(constructorBoot.order).toEqual(['sdk', 'helper', 'mock', 'body']);
    expect(OpenAI === constructorBoot.actual.default).toBe(true);
    expect(Stream === constructorBoot.streaming.Stream).toBe(true);
    expect(createLocalChatCompletionFactory === constructorBoot.helper.createLocalChatCompletionFactory).toBe(true);
    vi.useFakeTimers();
    const spies = watchDispatch();
    const { factory, receiver } = fixture(0), caller = new AbortController();
    const reason = new DOMException('original5min', 'TimeoutError');
    let ownedTimer: ReturnType<typeof setTimeout> | undefined, remove: (() => void) | undefined;
    try {
      const token = factory.create(receiver, async () => ({
        async *[Symbol.asyncIterator]() {
          yield unitChunk('C14');
          await new Promise<never>((_resolve, reject) => {
            const abort = () => { reject(caller.signal.reason); };
            remove = () => { caller.signal.removeEventListener('abort', abort); };
            if (caller.signal.aborted) abort();
            else caller.signal.addEventListener('abort', abort, { once: true });
          });
        },
      }));
      const iterator = (await token)[Symbol.asyncIterator]();
      await iterator.next();
      let settled = false;
      const outcome = iterator.next().then(
        value => { settled = true; return { rejected: false, reason: value }; },
        error => { settled = true; return { rejected: true, reason: error }; },
      );
      expect(spies.timer.mock.calls.length).toBe(0);
      ownedTimer = setTimeout(() => { caller.abort(reason); }, 5 * 60_000);
      await vi.advanceTimersByTimeAsync(5 * 60_000 - 1);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const result = await outcome;
      expect(result.rejected).toBe(true);
      expect(result.reason === reason).toBe(true);
      expect(spies.timer.mock.calls.length).toBe(1);
      expect(spies.timer.mock.calls.some(call => call[1] === 1000)).toBe(false);
      quiet(spies);
    } finally {
      caller.abort(reason);
      remove?.();
      if (ownedTimer !== undefined) clearTimeout(ownedTimer);
      vi.restoreAllMocks();
      vi.useRealTimers();
    }
  });
});
