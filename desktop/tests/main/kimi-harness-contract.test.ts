import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenAIAdapter } from '../../../src/ai/adapters/openai.js';
import { buildOpenAIAdapterInit, createAdapterFromBinding } from '../../../src/ai/models.js';
import { buildOpenAIHarnessContext } from '../../../src/ai/providers/model-harness-profile.js';
import type { ResolvedModelBinding } from '../../../src/ai/providers/control-plane.js';
import { createDesktopPromptCacheAffinity } from '../../../src/ai/runtime/prompt-cache-affinity.js';
import { streamDesktopTaskProviderConversation } from '../../../src/ai/runtime/provider-conversation-authorization.js';
import type { StreamOptions } from '../../../src/ai/runtime/model-capabilities.js';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import type { Message, StreamChunk, ToolDefinition, UsageStats } from '../../../src/types.js';
import {
  buildDesktopProviderMessages,
  runDesktopToolLoop,
} from '../../electron/desktop-services.js';

interface SdkStreamChunk {
  choices: Array<{
    delta: {
      content?: string;
      reasoning_content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    cached_tokens?: number;
  };
}

interface CapturedRequest {
  model: string;
  messages: Array<Record<string, unknown>>;
  tools?: Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }>;
  stream: true;
  stream_options: { include_usage: true };
  prompt_cache_key?: string;
}

interface FakeOpenAIClient {
  chat: {
    completions: {
      create(
        request: CapturedRequest,
        options?: { signal?: AbortSignal },
      ): Promise<AsyncIterable<SdkStreamChunk>>;
    };
  };
}

const SESSION_ID = 'sess_123e4567-e89b-42d3-a456-426614174000';
const CACHE_KEY = createDesktopPromptCacheAffinity(
  SESSION_ID,
  'inv_123e4567-e89b-42d3-a456-426614174000',
);
const SYSTEM_PROMPT = 'system';
const TOOLS: ToolDefinition[] = [{
  name: 'lookup',
  description: 'Look up one value',
  inputSchema: {
    type: 'object',
    properties: {
      value: {},
    },
    required: ['value'],
  },
}];
const MESSAGES: Message[] = [
  {
    role: 'user',
    content: [{ type: 'text', text: 'look up a value' }],
  },
  {
    role: 'assistant',
    content: [
      {
        type: 'thinking',
        thinking: '',
        reasoningProvenance: {
          captureVersion: 1,
          source: 'reasoning_content',
          fieldPresence: 'present',
        },
      },
      {
        type: 'tool_use',
        id: 'call-1',
        name: 'lookup',
        input: { value: 'x' },
      },
    ],
  },
  {
    role: 'user',
    content: [{
      type: 'tool_result',
      tool_use_id: 'call-1',
      content: '{"value":"x"}',
    }],
  },
];
const PROVIDER_USAGE: UsageStats = {
  inputTokens: 41,
  outputTokens: 7,
  cacheReadInputTokens: 13,
};

function strictKimiBinding(): ResolvedModelBinding {
  return {
    providerId: 'kimi',
    providerType: 'first_party',
    modelId: 'kimi-k3',
    wireModel: 'k3',
    protocol: 'openai_legacy',
    apiKey: 'test-key',
    baseUrl: 'https://api.kimi.com/coding/v1',
    headers: {},
    capabilities: ['tools', 'thinking'],
    runtimeOptions: {
      contextLimit: 262_144,
      reasoningEffort: 'high',
    },
  };
}

function genericBinding(
  providerId: 'openai' | 'deepseek' | 'glm',
  wireModel: string,
  baseUrl: string,
): ResolvedModelBinding {
  return {
    providerId,
    providerType: 'first_party',
    modelId: `${providerId}-default`,
    wireModel,
    protocol: 'openai_legacy',
    apiKey: 'test-key',
    baseUrl,
    headers: {},
    capabilities: ['tools'],
  };
}

function cleanSdkFixture(): SdkStreamChunk[] {
  return [
    {
      choices: [{ delta: { reasoning_content: '', content: 'ok' }, finish_reason: null }],
    },
    {
      choices: [{ delta: {}, finish_reason: 'stop' }],
    },
    {
      choices: [],
      usage: {
        prompt_tokens: PROVIDER_USAGE.inputTokens,
        completion_tokens: PROVIDER_USAGE.outputTokens,
        cached_tokens: PROVIDER_USAGE.cacheReadInputTokens,
      },
    },
  ];
}

function attachSdkFixture(
  adapter: OpenAIAdapter,
  chunks: SdkStreamChunk[] = cleanSdkFixture(),
): { requests: CapturedRequest[]; requestOptions: Array<{ signal?: AbortSignal } | undefined> } {
  const requests: CapturedRequest[] = [];
  const requestOptions: Array<{ signal?: AbortSignal } | undefined> = [];
  const client: FakeOpenAIClient = {
    chat: {
      completions: {
        async create(request, options) {
          requests.push(structuredClone(request));
          requestOptions.push(options);
          return {
            async *[Symbol.asyncIterator]() {
              for (const chunk of chunks) {
                yield structuredClone(chunk);
              }
            },
          };
        },
      },
    },
  };
  (adapter as unknown as { client: FakeOpenAIClient }).client = client;
  return { requests, requestOptions };
}

function attachSdkFixtures(
  adapter: OpenAIAdapter,
  fixtures: SdkStreamChunk[][],
): { requests: CapturedRequest[] } {
  const requests: CapturedRequest[] = [];
  let fixtureIndex = 0;
  const client: FakeOpenAIClient = {
    chat: {
      completions: {
        async create(request) {
          requests.push(structuredClone(request));
          const chunks = fixtures[fixtureIndex++];
          if (!chunks) throw new Error('unexpected provider request');
          return {
            async *[Symbol.asyncIterator]() {
              for (const chunk of chunks) yield structuredClone(chunk);
            },
          };
        },
      },
    },
  };
  (adapter as unknown as { client: FakeOpenAIClient }).client = client;
  return { requests };
}

function withoutBrowserGlobals<T>(action: () => T): T {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: undefined });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: undefined });
  try {
    return action();
  } finally {
    if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor);
    else Reflect.deleteProperty(globalThis, 'window');
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
    else Reflect.deleteProperty(globalThis, 'navigator');
  }
}

async function consumeAdapter(
  adapter: OpenAIAdapter,
  messages: Message[],
  tools: ToolDefinition[],
  options?: StreamOptions,
): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of streamDesktopTaskProviderConversation({
    adapter,
    messages,
    tools,
    systemPrompt: SYSTEM_PROMPT,
    options,
    invocationId: 'desktop-contract',
  })) {
    chunks.push(chunk);
  }
  return chunks;
}

function adapterWithPhaseFlags(
  disabledGate?: 'normalizeToolSchema' | 'normalizeUsage' | 'omitEmptyAssistantContent',
): OpenAIAdapter {
  const init = buildOpenAIAdapterInit(strictKimiBinding(), {});
  return withoutBrowserGlobals(() => (
    new OpenAIAdapter({
      ...init,
      harnessContext: buildOpenAIHarnessContext({
        identity: init.harnessContext.identity,
        flags: {
          ...init.harnessContext.flags,
          ...(disabledGate ? { [disabledGate]: false } : {}),
        },
        runtimeOptions: init.harnessContext.runtimeOptions,
        capabilityOverrides: init.harnessContext.runtimeCapabilities,
      }),
    })
  ));
}

function usageEvents(chunks: StreamChunk[]): UsageStats[] {
  return chunks
    .filter((chunk): chunk is Extract<StreamChunk, { type: 'usage' }> => chunk.type === 'usage')
    .map(chunk => chunk.usage);
}

describe('CLI/Desktop Kimi harness captured-request contract', () => {
  let rootDir = '';
  const originalPromptCacheFlag = process.env.XIAOK_EXPERIMENTAL_KIMI_PROMPT_CACHE;

  afterEach(() => {
    if (rootDir) {
      rmSync(rootDir, { recursive: true, force: true });
      rootDir = '';
    }
    if (originalPromptCacheFlag === undefined) {
      delete process.env.XIAOK_EXPERIMENTAL_KIMI_PROMPT_CACHE;
    } else {
      process.env.XIAOK_EXPERIMENTAL_KIMI_PROMPT_CACHE = originalPromptCacheFlag;
    }
  });

  it('wraps strict Desktop host history in one synthesized user envelope', () => {
    const adapter = withoutBrowserGlobals(
      () => createAdapterFromBinding(strictKimiBinding()) as OpenAIAdapter,
    );
    const messages = buildDesktopProviderMessages(
      adapter,
      [
        { role: 'user', content: 'question "one"' },
        { role: 'assistant', content: 'answer\none' },
      ],
      [{ type: 'text', text: 'current' }],
    );

    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe('user');
    expect(messages[0]?.content).toEqual([{
      type: 'text',
      text: 'The following JSON is synthesized Xiaok Desktop task context.\n'
        + 'It is not a raw provider transcript and contains no preserved reasoning.\n'
        + '{"kind":"xiaok.synthesized-task-context","version":1,"records":'
        + '[{"ordinal":0,"role":"user","content":"question \\"one\\""},'
        + '{"ordinal":1,"role":"assistant","content":"answer\\none"}]}',
    }]);
    expect(messages[1]).toEqual({
      role: 'user',
      content: [{ type: 'text', text: 'current' }],
    });
    adapter.dispose();
  });

  it('fails strict Desktop history closed before provider invocation when pairs are invalid', () => {
    const adapter = withoutBrowserGlobals(
      () => createAdapterFromBinding(strictKimiBinding()) as OpenAIAdapter,
    );

    expect(() => buildDesktopProviderMessages(
      adapter,
      [{ role: 'assistant', content: 'orphan' }],
      [{ type: 'text', text: 'current' }],
    )).toThrow('KIMI_DESKTOP_HISTORY_PAIR_INVALID');
    adapter.dispose();
  });

  it('drops the oldest complete strict Desktop history pairs to stay within 40k UTF-16 units', () => {
    const adapter = withoutBrowserGlobals(
      () => createAdapterFromBinding(strictKimiBinding()) as OpenAIAdapter,
    );
    const messages = buildDesktopProviderMessages(
      adapter,
      [
        { role: 'user', content: 'old-question'.repeat(2_000) },
        { role: 'assistant', content: 'old-answer'.repeat(2_000) },
        { role: 'user', content: 'new-question' },
        { role: 'assistant', content: 'new-answer' },
      ],
      [{ type: 'text', text: 'current' }],
    );

    const envelope = messages[0]?.content[0];
    expect(envelope?.type).toBe('text');
    expect(envelope?.type === 'text' ? envelope.text.length : 0).toBeLessThanOrEqual(40_000);
    expect(envelope?.type === 'text' ? envelope.text : '').not.toContain('old-question');
    expect(envelope?.type === 'text' ? envelope.text : '').toContain('new-question');
    expect(envelope?.type === 'text' ? envelope.text : '').toContain(
      '"ordinal":2,"role":"user"',
    );
    adapter.dispose();
  });

  it('preserves the existing per-entry Desktop history projection for generic adapters', () => {
    const adapter = withoutBrowserGlobals(
      () => createAdapterFromBinding(genericBinding(
        'openai',
        'gpt-4o',
        'https://api.openai.com/v1',
      )) as OpenAIAdapter,
    );
    const messages = buildDesktopProviderMessages(
      adapter,
      [
        { role: 'user', content: 'question' },
        { role: 'assistant', content: 'answer' },
      ],
      [{ type: 'text', text: 'current' }],
    );

    expect(messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'question' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'answer' }] },
      { role: 'user', content: [{ type: 'text', text: 'current' }] },
    ]);
    adapter.dispose();
  });

  it('captures identical complete Kimi request JSON and usage accounting from CLI and Desktop', async () => {
    expect(CACHE_KEY).toMatch(/^pc1_[0-9a-f]{64}$/);
    process.env.XIAOK_EXPERIMENTAL_KIMI_PROMPT_CACHE = '1';
    const cliAdapter = withoutBrowserGlobals(
      () => createAdapterFromBinding(strictKimiBinding()) as OpenAIAdapter,
    );
    const desktopAdapter = withoutBrowserGlobals(
      () => createAdapterFromBinding(strictKimiBinding()) as OpenAIAdapter,
    );
    const cliCapture = attachSdkFixture(cliAdapter);
    const desktopCapture = attachSdkFixture(desktopAdapter);

    const cliChunks = await consumeAdapter(
      cliAdapter,
      structuredClone(MESSAGES),
      structuredClone(TOOLS),
      { cacheKey: CACHE_KEY },
    );

    rootDir = join(tmpdir(), `xiaok-kimi-harness-contract-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    const desktopResult = await runDesktopToolLoop({
      adapter: desktopAdapter,
      systemPrompt: SYSTEM_PROMPT,
      messages: structuredClone(MESSAGES),
      allToolDefs: structuredClone(TOOLS),
      registry: new ToolRegistry({ autoMode: true }, []),
      signal: new AbortController().signal,
      invocationOptions: { cacheKey: CACHE_KEY },
      taskDeadline: Date.now() + 30_000,
      sessionId: SESSION_ID,
      turnId: 'turn-1',
      intentId: 'intent-1',
      stepId: 'step-1',
      taskId: 'task-1',
      materials: [],
      emitRuntimeEvent() {},
      skillInvocation: null,
      skillCatalog: {} as never,
      dataRoot: rootDir,
      taskStartTime: Date.now(),
      strategies: {
        compact: {
          enabled: false,
          shouldCompact: () => false,
          doCompact: async (_messages, _streamOptions?: StreamOptions) => {},
        },
        buildApiView: messages => messages,
        processToolResult: result => result,
        trackAutoProgress: false,
        trackReferenceReads: false,
        emitSkillArtifactTrace: false,
      },
    });

    expect(cliCapture.requests).toHaveLength(1);
    expect(desktopCapture.requests).toHaveLength(1);
    expect(desktopCapture.requests[0]).toEqual(cliCapture.requests[0]);
    expect(cliCapture.requests[0].prompt_cache_key).toBe(CACHE_KEY);
    expect(desktopCapture.requests[0].prompt_cache_key).toBe(CACHE_KEY);
    expect(usageEvents(cliChunks)).toEqual([PROVIDER_USAGE]);
    expect({
      inputTokens: desktopResult.totalInputTokens,
      outputTokens: desktopResult.totalOutputTokens,
    }).toEqual({
      inputTokens: PROVIDER_USAGE.inputTokens,
      outputTokens: PROVIDER_USAGE.outputTokens,
    });
  });

  it('replays official Kimi reasoning only inside the task-local Desktop tool continuation', async () => {
    const adapter = withoutBrowserGlobals(
      () => createAdapterFromBinding(strictKimiBinding()) as OpenAIAdapter,
    );
    const capture = attachSdkFixtures(adapter, [
      [
        {
          choices: [{
            delta: {
              reasoning_content: 'provider-private-reasoning',
              tool_calls: [{
                index: 0,
                id: 'call-1',
                function: { name: 'lookup', arguments: '{"value":"x"}' },
              }],
            },
            finish_reason: 'tool_calls',
          }],
        },
        { choices: [], usage: { prompt_tokens: 12, completion_tokens: 3 } },
      ],
      [
        {
          choices: [{
            delta: { reasoning_content: '', content: 'done' },
            finish_reason: null,
          }],
        },
        { choices: [{ delta: {}, finish_reason: 'stop' }] },
        { choices: [], usage: { prompt_tokens: 18, completion_tokens: 2 } },
      ],
    ]);
    let capturedToolContext: unknown;
    const registry = new ToolRegistry({ autoMode: true }, [{
      permission: 'safe',
      definition: TOOLS[0],
      async execute(_input, context) {
        capturedToolContext = context;
        return '{"value":"x"}';
      },
    }]);
    rootDir = join(tmpdir(), `xiaok-kimi-desktop-replay-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    const runtimeEvents: Array<Record<string, unknown>> = [];

    const result = await runDesktopToolLoop({
      adapter,
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'lookup' }] }],
      allToolDefs: structuredClone(TOOLS),
      registry,
      signal: new AbortController().signal,
      taskDeadline: Date.now() + 30_000,
      sessionId: SESSION_ID,
      turnId: 'turn-replay',
      intentId: 'intent-replay',
      stepId: 'step-replay',
      taskId: 'task-replay',
      materials: [],
      emitRuntimeEvent(event) {
        runtimeEvents.push(event as unknown as Record<string, unknown>);
      },
      skillInvocation: null,
      skillCatalog: {} as never,
      dataRoot: rootDir,
      taskStartTime: Date.now(),
      maxIterations: 2,
      strategies: {
        compact: {
          enabled: false,
          shouldCompact: () => false,
          doCompact: async () => {},
        },
        buildApiView: messages => messages,
        processToolResult: value => value,
        trackAutoProgress: false,
        trackReferenceReads: false,
        emitSkillArtifactTrace: false,
      },
    });

    expect(result.reply).toBe('done');
    expect(capture.requests).toHaveLength(2);
    expect(capture.requests[1]?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'assistant',
        reasoning_content: 'provider-private-reasoning',
      }),
    ]));
    expect(JSON.stringify(runtimeEvents)).not.toContain('provider-private-reasoning');
    expect(JSON.stringify(capturedToolContext)).not.toContain('provider-private-reasoning');
    expect(JSON.stringify(capturedToolContext)).not.toContain('reasoningProvenance');
    expect(JSON.stringify(capturedToolContext)).not.toContain('"type":"thinking"');
    expect(Object.isFrozen(capturedToolContext)).toBe(true);
    const projectedContext = capturedToolContext as {
      session: { messages: Message[] };
      messages: Message[];
      toolDefinitions: ToolDefinition[];
    };
    expect(Object.isFrozen(projectedContext.session)).toBe(true);
    expect(Object.isFrozen(projectedContext.session.messages)).toBe(true);
    expect(Object.isFrozen(projectedContext.messages)).toBe(true);
    expect(Object.isFrozen(projectedContext.toolDefinitions)).toBe(true);
    expect(Object.isFrozen(projectedContext.toolDefinitions[0]?.inputSchema)).toBe(true);
    adapter.dispose();
  });

  it('keeps prompt_cache_key absent by default even when invocation affinity is present', async () => {
    delete process.env.XIAOK_EXPERIMENTAL_KIMI_PROMPT_CACHE;
    const adapter = withoutBrowserGlobals(
      () => createAdapterFromBinding(strictKimiBinding()) as OpenAIAdapter,
    );
    const capture = attachSdkFixture(adapter);

    await consumeAdapter(adapter, structuredClone(MESSAGES), structuredClone(TOOLS), {
      cacheKey: CACHE_KEY,
    });

    expect(capture.requests).toHaveLength(1);
    expect(capture.requests[0]).not.toHaveProperty('prompt_cache_key');
  });

  it.each([
    {
      providerId: 'openai' as const,
      wireModel: 'gpt-4o',
      baseUrl: 'https://api.openai.com/v1',
    },
    {
      providerId: 'deepseek' as const,
      wireModel: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com/v1',
    },
    {
      providerId: 'glm' as const,
      wireModel: 'glm-4.5',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    },
  ])('preserves the complete generic $providerId request baseline without Kimi fields', async ({
    providerId,
    wireModel,
    baseUrl,
  }) => {
    process.env.XIAOK_EXPERIMENTAL_KIMI_PROMPT_CACHE = '1';
    const adapter = withoutBrowserGlobals(
      () => createAdapterFromBinding(genericBinding(providerId, wireModel, baseUrl)) as OpenAIAdapter,
    );
    const capture = attachSdkFixture(adapter);
    const genericMessages: Message[] = [{
      role: 'user',
      content: [{ type: 'text', text: 'hello' }],
    }];

    await consumeAdapter(adapter, genericMessages, structuredClone(TOOLS), {
      cacheKey: CACHE_KEY,
    });

    expect(capture.requests).toEqual([{
      model: wireModel,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: 'hello' },
      ],
      tools: [{
        type: 'function',
        function: {
          name: 'lookup',
          description: 'Look up one value',
          parameters: TOOLS[0].inputSchema,
        },
      }],
      stream: true,
      stream_options: { include_usage: true },
    }]);
    expect(capture.requests[0]).not.toHaveProperty('prompt_cache_key');
    expect(capture.requests[0]).not.toHaveProperty('reasoning_effort');
  });

  it.each([
    {
      disabledGate: 'normalizeToolSchema' as const,
      expectsNormalizedSchema: false,
      expectsProviderUsage: true,
      expectsOmittedContent: true,
    },
    {
      disabledGate: 'normalizeUsage' as const,
      expectsNormalizedSchema: true,
      expectsProviderUsage: false,
      expectsOmittedContent: true,
    },
    {
      disabledGate: 'omitEmptyAssistantContent' as const,
      expectsNormalizedSchema: true,
      expectsProviderUsage: true,
      expectsOmittedContent: false,
    },
  ])('rolls back only the $disabledGate Phase 1A trait', async ({
    disabledGate,
    expectsNormalizedSchema,
    expectsProviderUsage,
    expectsOmittedContent,
  }) => {
    const adapter = adapterWithPhaseFlags(disabledGate);
    const capture = attachSdkFixture(adapter);

    const chunks = await consumeAdapter(
      adapter,
      structuredClone(MESSAGES),
      structuredClone(TOOLS),
    );

    const parameters = capture.requests[0].tools?.[0]?.function.parameters;
    expect(parameters).toEqual(expectsNormalizedSchema
      ? {
          type: 'object',
          properties: { value: { type: 'string' } },
          required: ['value'],
        }
      : TOOLS[0].inputSchema);
    const assistantMessage = capture.requests[0].messages.find(message => message.role === 'assistant');
    expect(assistantMessage).toBeDefined();
    if (expectsOmittedContent) {
      expect(assistantMessage).not.toHaveProperty('content');
    } else {
      expect(assistantMessage).toHaveProperty('content', null);
    }
    expect(usageEvents(chunks)).toHaveLength(1);
    if (expectsProviderUsage) {
      expect(usageEvents(chunks)).toEqual([PROVIDER_USAGE]);
    } else {
      expect(usageEvents(chunks)[0]).not.toEqual(PROVIDER_USAGE);
    }
    expect(chunks.at(-1)).toEqual({ type: 'done' });
  });
});
