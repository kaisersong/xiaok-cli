import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenAIAdapter } from '../../../src/ai/adapters/openai.js';
import { buildOpenAIAdapterInit, createAdapterFromBinding } from '../../../src/ai/models.js';
import type { ResolvedModelBinding } from '../../../src/ai/providers/control-plane.js';
import { createPromptCacheAffinity } from '../../../src/ai/runtime/prompt-cache-affinity.js';
import type { StreamOptions } from '../../../src/ai/runtime/model-capabilities.js';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import type { Message, StreamChunk, ToolDefinition, UsageStats } from '../../../src/types.js';
import { runDesktopToolLoop } from '../../electron/desktop-services.js';

interface SdkStreamChunk {
  choices: Array<{
    delta: {
      content?: string;
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
const CACHE_KEY = createPromptCacheAffinity(SESSION_ID);
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
    content: [{
      type: 'tool_use',
      id: 'call-1',
      name: 'lookup',
      input: { value: 'x' },
    }],
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
      choices: [{ delta: { content: 'ok' }, finish_reason: null }],
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
  for await (const chunk of adapter.stream(messages, tools, SYSTEM_PROMPT, options)) {
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
      harnessContext: {
        ...init.harnessContext,
        flags: {
          ...init.harnessContext.flags,
          ...(disabledGate ? { [disabledGate]: false } : {}),
        },
      },
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
