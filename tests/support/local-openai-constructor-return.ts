import type OpenAI from 'openai';
import type { APIPromise } from 'openai';
import type { Stream } from 'openai/core/streaming';
import type { ChatCompletionChunk } from 'openai/resources/chat/completions';

/** TEST fixture only: actual public constructor values, not a production port or authority. */
export interface PublicOpenAIConstructors {
  Client: typeof OpenAI;
  APIPromise: typeof APIPromise;
  Stream: typeof Stream;
}

export function createLocalChatCompletionFactory(sdk: PublicOpenAIConstructors) {
  const constructorOptions = new WeakMap<object, ConstructorParameters<typeof OpenAI>[0]>();
  const clients = new WeakMap<object, OpenAI>();
  const lastTokens = new WeakMap<object, APIPromise<Stream<ChatCompletionChunk>>>();

  function recordOptions(receiver: object, options: ConstructorParameters<typeof OpenAI>[0]): void {
    constructorOptions.set(receiver, options);
  }

  function create(
    receiver: object,
    produce: () => Promise<AsyncIterable<ChatCompletionChunk>>,
  ): APIPromise<Stream<ChatCompletionChunk>> {
    let client = clients.get(receiver);
    if (!client) {
      const options = constructorOptions.get(receiver);
      if (!options || typeof options.apiKey !== 'string' || !options.apiKey
        || options.provider !== undefined || options.workloadIdentity !== undefined
        || options.x509Transport !== undefined) {
        throw new Error('local_sdk_fixture_original_constructor_options_required');
      }
      client = new sdk.Client(options);
      clients.set(receiver, client);
    }
    const controller = new AbortController();
    const responseInfo: Awaited<ConstructorParameters<
      typeof sdk.APIPromise<Stream<ChatCompletionChunk>>
    >[1]> = {
      response: new Response(null, { status: 200 }),
      options: { method: 'post', path: '/chat/completions', stream: true },
      controller,
      requestLogID: 'UNIT_DATA_ONLY:local-chat-completion',
      retryOfRequestLogID: undefined,
      startTime: 0,
    };
    let resolveResponseInfo: (value: typeof responseInfo) => void;
    let rejectResponseInfo: (reason: unknown) => void;
    const responseInfoPromise = new Promise<typeof responseInfo>((resolve, reject) => {
      resolveResponseInfo = resolve;
      rejectResponseInfo = reject;
    });
    // Observation only; SAME returned SDK response promise retains its exact rejection.
    void responseInfoPromise.catch(() => undefined);
    let originalValue: AsyncIterable<ChatCompletionChunk>;
    const result = new sdk.APIPromise<Stream<ChatCompletionChunk>>(
      client,
      responseInfoPromise,
      () => new sdk.Stream<ChatCompletionChunk>(
        () => originalValue[Symbol.asyncIterator](), controller, client,
      ),
    );
    // Read-only TEST introspection returns actual objects, never a cloned brand/approval DTO.
    lastTokens.set(receiver, result);
    // Exact named TEST callbacks supply trusted local async arrows. Not an untrusted-producer boundary.
    const originalResult = produce();
    const settlement = originalResult.then(
      value => {
        originalValue = value;
        resolveResponseInfo(responseInfo);
      },
      reason => { rejectResponseInfo(reason); },
    );
    void settlement.catch(reason => { rejectResponseInfo(reason); });
    return result;
  }

  return {
    recordOptions,
    create,
    clientFor(receiver: object): OpenAI | undefined { return clients.get(receiver); },
    lastTokenFor(receiver: object): APIPromise<Stream<ChatCompletionChunk>> | undefined {
      return lastTokens.get(receiver);
    },
  };
}
