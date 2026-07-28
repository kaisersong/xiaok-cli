// tests/ai/adapters/openai.test.ts
import { describe, it, expect, vi } from 'vitest';
import { OpenAIAdapter } from '../../../src/ai/adapters/openai.js';
import {
  buildOpenAIAdapterInit,
  createAdapterFromBinding,
} from '../../../src/ai/models.js';
import {
  buildOpenAIHarnessContext,
  KIMI_K3_CODING_OPENAI_HARNESS_PROFILE,
  resolveKimiHarnessFeatureFlags,
  type KimiUsageDiagnostic,
  type OpenAIAdapterInit,
  type ReasoningDialectState,
} from '../../../src/ai/providers/model-harness-profile.js';
import {
  KIMI_SCHEMA_LIMITS,
  KimiToolSchemaError,
} from '../../../src/ai/providers/kimi-tool-schema.js';
import { normalizeMcpToolSchema } from '../../../src/ai/mcp/client.js';
import type { ModelRuntimeOptions } from '../../../src/ai/providers/types.js';
import type { Message, StreamChunk, ToolDefinition, UsageStats } from '../../../src/types.js';
import type { StreamOptions } from '../../../src/ai/runtime/model-capabilities.js';

const openAIConstructorCalls: unknown[] = [];

type KimiReasoningEffort = 'low' | 'high' | 'max';

interface CapturedChatCompletionRequest {
  model: string;
  reasoning_effort?: KimiReasoningEffort;
  prompt_cache_key?: string;
  messages: Array<Record<string, unknown>>;
  tools?: Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }>;
}

type UsageDiagnostic = KimiUsageDiagnostic;

vi.mock('openai', () => {
  return {
    default: class OpenAI {
      constructor(opts?: unknown) {
        openAIConstructorCalls.push(opts);
      }

      chat = {
        completions: {
          create: vi.fn(),
        },
      };
    },
  };
});

async function captureChatCompletionRequest(
  adapter: unknown,
  tools: ToolDefinition[] = [],
  messages: Message[] = [],
  options?: StreamOptions,
): Promise<CapturedChatCompletionRequest> {
  let capturedRequest: CapturedChatCompletionRequest | undefined;
  const mockStream = {
    async *[Symbol.asyncIterator]() {
      yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
    },
  };

  const OpenAI = (await import('openai')).default;
  const instance = new OpenAI({ apiKey: 'test' });
  vi.spyOn(instance.chat.completions, 'create').mockImplementation(async (params: unknown) => {
    capturedRequest = params as CapturedChatCompletionRequest;
    return mockStream as never;
  });

  (adapter as { client: typeof instance }).client = instance;
  const streamAdapter = adapter as {
    stream(
      messages: never[],
      tools: ToolDefinition[],
      systemPrompt: string,
      options?: StreamOptions,
    ): AsyncIterable<unknown>;
  };
  for await (const _ of streamAdapter.stream(messages as never[], tools, 'system', options)) { /* consume */ }

  if (!capturedRequest) {
    throw new Error('OpenAI request was not captured');
  }
  return capturedRequest;
}

function getReasoningDialectState(adapter: OpenAIAdapter): ReasoningDialectState {
  return (adapter as unknown as {
    reasoningDialectState: ReasoningDialectState;
  }).reasoningDialectState;
}

async function attachRequestSpy(adapter: OpenAIAdapter) {
  const mockStream = {
    async *[Symbol.asyncIterator]() {
      yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
    },
  };
  const OpenAI = (await import('openai')).default;
  const instance = new OpenAI({ apiKey: 'test' });
  const createSpy = vi.spyOn(instance.chat.completions, 'create')
    .mockResolvedValue(mockStream as never);
  (adapter as unknown as { client: typeof instance }).client = instance;
  return createSpy;
}

async function captureStreamError(
  adapter: OpenAIAdapter,
  tools: ToolDefinition[],
): Promise<unknown> {
  try {
    for await (const _ of adapter.stream([], tools, 'system')) { /* consume */ }
  } catch (error) {
    return error;
  }
  throw new Error('Expected stream to reject before SDK create');
}

function tool(
  name: string,
  inputSchema: Record<string, unknown>,
): ToolDefinition {
  return {
    name,
    description: `${name} description`,
    inputSchema,
  };
}

function schemaWithInputNodes(target: number): Record<string, unknown> {
  return {
    'x-padding': Array.from({ length: target - 2 }, () => null),
  };
}

function schemaWithOutputBytes(target: number): Record<string, unknown> {
  return {
    x: 'a'.repeat(target - 8),
  };
}

function wideSharedRefSchema(): Record<string, unknown> {
  return {
    $defs: {
      payload: {
        type: 'object',
        'x-padding': Array.from({ length: 113 }, () => null),
      },
    },
    properties: Object.fromEntries(
      Array.from({ length: 430 }, (_, index) => [
        `tool${index}`,
        { $ref: '#/$defs/payload' },
      ]),
    ),
  };
}

function createTestAdapter(input: {
  wireModel: string;
  baseUrl?: string;
  providerId?: string;
  providerType?: 'first_party' | 'custom';
  capabilities?: string[];
  capabilityOverrides?: {
    supportsPromptCaching?: boolean;
    supportsImageInput?: boolean;
  };
  runtimeOptions?: ModelRuntimeOptions;
  flags?: ReturnType<typeof resolveKimiHarnessFeatureFlags>;
  resolvedHeaders?: Record<string, string | null>;
  kimiCodingHeadersApplied?: boolean;
  onUsageDiagnostic?: (diagnostic: UsageDiagnostic) => void;
}): OpenAIAdapter {
  const identity = {
    providerId: input.providerId ?? 'test',
    providerType: input.providerType ?? 'custom',
    protocol: 'openai_legacy' as const,
    canonicalBaseUrl: input.baseUrl,
    wireModel: input.wireModel,
    capabilities: input.capabilities ?? [],
  };
  const init: OpenAIAdapterInit = {
    apiKey: 'test-key',
    resolvedHeaders: input.resolvedHeaders,
    kimiCodingHeadersApplied: input.kimiCodingHeadersApplied ?? false,
    onUsageDiagnostic: input.onUsageDiagnostic ?? (() => {}),
    harnessContext: buildOpenAIHarnessContext({
      identity,
      flags: input.flags ?? resolveKimiHarnessFeatureFlags({}),
      runtimeOptions: input.runtimeOptions,
      capabilityOverrides: input.capabilityOverrides,
    }),
  };

  return new OpenAIAdapter(init);
}

function createStrictKimiAdapter(
  overrides: Partial<Parameters<typeof createTestAdapter>[0]> = {},
): OpenAIAdapter {
  return createTestAdapter({
    wireModel: 'k3',
    providerId: 'kimi',
    providerType: 'first_party',
    baseUrl: 'https://api.kimi.com/coding/v1',
    capabilities: ['tools', 'thinking'],
    ...overrides,
  });
}

function parseKimiUsage(
  chunk: Record<string, unknown>,
  onDiagnostic?: (diagnostic: UsageDiagnostic) => void,
): UsageStats | undefined {
  const parser = KIMI_K3_CODING_OPENAI_HARNESS_PROFILE.extractUsage;
  expect(parser).toBeTypeOf('function');
  if (!parser) {
    throw new Error('Kimi usage parser is missing');
  }
  return parser(chunk, onDiagnostic);
}

async function collectAdapterChunks(
  adapter: OpenAIAdapter,
  options?: StreamOptions,
): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of adapter.stream([], [], 'system', options)) {
    chunks.push(chunk);
  }
  return chunks;
}

describe('OpenAIAdapter Kimi tool schema serialization gate', () => {
  it('normalizes schemas only for the strict Kimi profile with tools capability and flag enabled', async () => {
    const inputSchema = {
      type: 'object',
      properties: {
        value: {},
      },
    };
    const snapshot = structuredClone(inputSchema);
    const adapter = createStrictKimiAdapter();

    const request = await captureChatCompletionRequest(adapter, [
      tool('strict-kimi', inputSchema),
    ]);

    expect(request.tools?.[0]?.function.parameters).toEqual({
      type: 'object',
      properties: {
        value: { type: 'string' },
      },
    });
    expect(request.tools?.[0]?.function.parameters).not.toBe(inputSchema);
    expect(inputSchema).toEqual(snapshot);
  });

  it.each([
    {
      label: 'changing bigint',
      getValue(reads: number): unknown {
        return reads === 1 ? null : 1n;
      },
    },
    {
      label: 'changing cycle',
      getValue(reads: number): unknown {
        if (reads === 1) return null;
        const cycle: Record<string, unknown> = {};
        cycle.self = cycle;
        return cycle;
      },
    },
    {
      label: 'throwing',
      getValue(): unknown {
        throw new Error('getter must never run');
      },
    },
  ])(
    'rejects an MCP $label accessor locally before strict Kimi SDK create',
    async ({ getValue }) => {
      let getterReads = 0;
      const nested: Record<string, unknown> = {};
      Object.defineProperty(nested, 'value', {
        enumerable: true,
        get() {
          getterReads += 1;
          return getValue(getterReads);
        },
      });
      const definition = normalizeMcpToolSchema('unsafe', {
        name: 'accessor',
        inputSchema: {
          type: 'object',
          'x-nested': nested,
        },
      });
      const adapter = createStrictKimiAdapter();
      const createSpy = await attachRequestSpy(adapter);

      const error = await captureStreamError(adapter, [definition]);

      expect(error).toBeInstanceOf(KimiToolSchemaError);
      expect(error).toMatchObject({
        code: 'KIMI_SCHEMA_INVALID_JSON_VALUE',
        toolName: 'mcp__unsafe__accessor',
      });
      expect(getterReads).toBe(0);
      expect(createSpy).not.toHaveBeenCalled();
    },
  );

  it('rejects a non-JSON enum candidate as TYPE_INFERENCE before SDK create', async () => {
    const adapter = createStrictKimiAdapter();
    const createSpy = await attachRequestSpy(adapter);

    const error = await captureStreamError(adapter, [
      tool('non-json-enum', {
        type: 'object',
        properties: {
          value: {
            enum: ['ok', 1n],
          },
        },
      }),
    ]);

    expect(error).toBeInstanceOf(KimiToolSchemaError);
    expect(error).toMatchObject({
      code: 'KIMI_SCHEMA_TYPE_INFERENCE_FAILED',
      toolName: 'non-json-enum',
    });
    expect(createSpy).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'generic provider',
      input: {
        wireModel: 'gpt-4o',
        providerId: 'openai',
        providerType: 'first_party' as const,
        baseUrl: 'https://api.openai.com/v1',
        capabilities: ['tools'],
      },
    },
    {
      label: 'custom Kimi binding',
      input: {
        wireModel: 'k3',
        providerId: 'kimi',
        providerType: 'custom' as const,
        baseUrl: 'https://api.kimi.com/coding/v1',
        capabilities: ['tools'],
      },
    },
    {
      label: 'Kimi K2 model',
      input: {
        wireModel: 'kimi-k2.7',
        providerId: 'kimi',
        providerType: 'first_party' as const,
        baseUrl: 'https://api.kimi.com/coding/v1',
        capabilities: ['tools'],
      },
    },
    {
      label: 'strict profile without tools capability',
      input: {
        wireModel: 'k3',
        providerId: 'kimi',
        providerType: 'first_party' as const,
        baseUrl: 'https://api.kimi.com/coding/v1',
        capabilities: ['thinking'],
      },
    },
    {
      label: 'strict profile with normalization flag disabled',
      input: {
        wireModel: 'k3',
        providerId: 'kimi',
        providerType: 'first_party' as const,
        baseUrl: 'https://api.kimi.com/coding/v1',
        capabilities: ['tools'],
        flags: {
          ...resolveKimiHarnessFeatureFlags({}),
          normalizeToolSchema: false,
        },
      },
    },
  ])('keeps baseline wire schema identity for $label', async ({ input }) => {
    const inputSchema = {
      type: 'object',
      properties: {
        value: {},
      },
    };
    const adapter = createTestAdapter(input);

    const request = await captureChatCompletionRequest(adapter, [
      tool('baseline', inputSchema),
    ]);

    expect(request.tools?.[0]?.function.parameters).toBe(inputSchema);
    expect(request.tools?.[0]?.function.parameters).toEqual({
      type: 'object',
      properties: {
        value: {},
      },
    });
  });
});

describe('OpenAIAdapter Kimi request schema budgets', () => {
  it('accepts request tool count limit - 1 and rejects limit + 1 before reading schemas', async () => {
    const acceptedAdapter = createStrictKimiAdapter();
    const acceptedRequest = await captureChatCompletionRequest(
      acceptedAdapter,
      Array.from(
        { length: KIMI_SCHEMA_LIMITS.maxRequestToolCount - 1 },
        (_, index) => tool(`accepted-${index}`, {}),
      ),
    );
    expect(acceptedRequest.tools).toHaveLength(
      KIMI_SCHEMA_LIMITS.maxRequestToolCount - 1,
    );

    let schemaReads = 0;
    const rejectedTools = Array.from(
      { length: KIMI_SCHEMA_LIMITS.maxRequestToolCount + 1 },
      (_, index) => {
        const definition = {
          name: `rejected-${index}`,
          description: 'count preflight',
        } as ToolDefinition;
        Object.defineProperty(definition, 'inputSchema', {
          enumerable: true,
          get() {
            schemaReads += 1;
            return {};
          },
        });
        return definition;
      },
    );
    const rejectedAdapter = createStrictKimiAdapter();
    const createSpy = await attachRequestSpy(rejectedAdapter);
    const error = await captureStreamError(rejectedAdapter, rejectedTools);

    expect(error).toBeInstanceOf(KimiToolSchemaError);
    expect(error).toMatchObject({
      code: 'KIMI_SCHEMA_LIMIT_EXCEEDED',
      limitKind: 'request_tool_count',
    });
    expect(schemaReads).toBe(0);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('accepts request input nodes limit - 1', async () => {
    const schemas = [
      ...Array.from(
        { length: 5 },
        () => schemaWithInputNodes(KIMI_SCHEMA_LIMITS.maxInputNodes - 1),
      ),
      schemaWithInputNodes(4),
    ];
    const request = await captureChatCompletionRequest(
      createStrictKimiAdapter(),
      schemas.map((schema, index) => tool(`input-${index}`, schema)),
    );

    expect(request.tools).toHaveLength(6);
  });

  it('rejects request input nodes limit + 1 and never touches tool N + 1', async () => {
    let nextSchemaReads = 0;
    const nextTool = {
      name: 'input-6',
      description: 'must remain untouched',
    } as ToolDefinition;
    Object.defineProperty(nextTool, 'inputSchema', {
      enumerable: true,
      get() {
        nextSchemaReads += 1;
        return {};
      },
    });
    const tools = [
      ...Array.from(
        { length: 5 },
        (_, index) => tool(
          `input-${index}`,
          schemaWithInputNodes(KIMI_SCHEMA_LIMITS.maxInputNodes - 1),
        ),
      ),
      tool('input-5', schemaWithInputNodes(6)),
      nextTool,
    ];
    const adapter = createStrictKimiAdapter();
    const createSpy = await attachRequestSpy(adapter);

    const error = await captureStreamError(adapter, tools);

    expect(error).toBeInstanceOf(KimiToolSchemaError);
    expect(error).toMatchObject({
      code: 'KIMI_SCHEMA_LIMIT_EXCEEDED',
      limitKind: 'request_input_nodes',
      toolName: 'input-5',
    });
    expect(nextSchemaReads).toBe(0);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('accepts request output nodes limit - 1 and rejects limit + 1', async () => {
    const wideSchemas = Array.from({ length: 4 }, () => wideSharedRefSchema());
    const acceptedRequest = await captureChatCompletionRequest(
      createStrictKimiAdapter(),
      [
        ...wideSchemas.map((schema, index) => tool(`output-${index}`, schema)),
        tool('output-4', { x: null, y: null }),
      ],
    );
    expect(acceptedRequest.tools).toHaveLength(5);

    const rejectedAdapter = createStrictKimiAdapter();
    const createSpy = await attachRequestSpy(rejectedAdapter);
    const error = await captureStreamError(rejectedAdapter, [
      ...wideSchemas.map((schema, index) => tool(`output-${index}`, schema)),
      tool('output-4', { x: null, y: null, z: null, w: null }),
    ]);

    expect(error).toBeInstanceOf(KimiToolSchemaError);
    expect(error).toMatchObject({
      code: 'KIMI_SCHEMA_LIMIT_EXCEEDED',
      limitKind: 'request_output_nodes',
      toolName: 'output-4',
    });
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('accepts request tool bytes limit - 1 and rejects limit + 1', async () => {
    const prefixSchemas = [
      ...Array.from(
        { length: 3 },
        () => schemaWithOutputBytes(KIMI_SCHEMA_LIMITS.maxOutputBytes - 1),
      ),
      schemaWithOutputBytes(KIMI_SCHEMA_LIMITS.maxOutputBytes - 6),
    ];
    const acceptedRequest = await captureChatCompletionRequest(
      createStrictKimiAdapter(),
      [
        ...prefixSchemas.map((schema, index) => tool(`bytes-${index}`, schema)),
        tool('bytes-4', { x: '' }),
      ],
    );
    expect(acceptedRequest.tools).toHaveLength(5);

    const rejectedAdapter = createStrictKimiAdapter();
    const createSpy = await attachRequestSpy(rejectedAdapter);
    const error = await captureStreamError(rejectedAdapter, [
      ...prefixSchemas.map((schema, index) => tool(`bytes-${index}`, schema)),
      tool('bytes-4', { x: 'aa' }),
    ]);

    expect(error).toBeInstanceOf(KimiToolSchemaError);
    expect(error).toMatchObject({
      code: 'KIMI_SCHEMA_LIMIT_EXCEEDED',
      limitKind: 'request_tool_bytes',
      toolName: 'bytes-4',
    });
    expect(createSpy).not.toHaveBeenCalled();
  });
});

describe('OpenAIAdapter', () => {
  describe('Kimi usage snapshots', () => {
    it('prefers a complete top-level snapshot over choices[0].usage', () => {
      expect(parseKimiUsage({
        usage: {
          prompt_tokens: 11,
          completion_tokens: 3,
          cached_tokens: 4,
        },
        choices: [{
          usage: {
            prompt_tokens: 99,
            completion_tokens: 88,
            cached_tokens: 77,
          },
        }],
      })).toEqual({
        inputTokens: 11,
        outputTokens: 3,
        cacheReadInputTokens: 4,
      });
    });

    it('falls back to choices[0].usage when top-level totals are partial or invalid', () => {
      expect(parseKimiUsage({
        usage: {
          prompt_tokens: 11,
        },
        choices: [{
          usage: {
            prompt_tokens: 9,
            completion_tokens: 2,
          },
        }],
      })).toEqual({
        inputTokens: 9,
        outputTokens: 2,
      });
      expect(parseKimiUsage({
        usage: {
          prompt_tokens: -1,
          completion_tokens: 2,
        },
        choices: [{
          usage: {
            prompt_tokens: 8,
            completion_tokens: 1,
          },
        }],
      })).toEqual({
        inputTokens: 8,
        outputTokens: 1,
      });
    });

    it.each([
      ['missing prompt', { completion_tokens: 1 }],
      ['missing completion', { prompt_tokens: 1 }],
      ['negative prompt', { prompt_tokens: -1, completion_tokens: 1 }],
      ['negative completion', { prompt_tokens: 1, completion_tokens: -1 }],
      ['fraction prompt', { prompt_tokens: 1.5, completion_tokens: 1 }],
      ['fraction completion', { prompt_tokens: 1, completion_tokens: 1.5 }],
      ['NaN prompt', { prompt_tokens: Number.NaN, completion_tokens: 1 }],
      ['infinite completion', { prompt_tokens: 1, completion_tokens: Number.POSITIVE_INFINITY }],
      ['unsafe prompt', { prompt_tokens: Number.MAX_SAFE_INTEGER + 1, completion_tokens: 1 }],
    ])('rejects %s instead of zero-filling or accepting partial totals', (_label, usage) => {
      expect(parseKimiUsage({ usage })).toBeUndefined();
    });

    it('uses valid direct cached tokens first and falls back to valid details', () => {
      expect(parseKimiUsage({
        usage: {
          prompt_tokens: 12,
          completion_tokens: 2,
          cached_tokens: 5,
          prompt_tokens_details: { cached_tokens: 4 },
        },
      })).toEqual({
        inputTokens: 12,
        outputTokens: 2,
        cacheReadInputTokens: 5,
      });
      expect(parseKimiUsage({
        usage: {
          prompt_tokens: 12,
          completion_tokens: 2,
          cached_tokens: -1,
          prompt_tokens_details: { cached_tokens: 4 },
        },
      })).toEqual({
        inputTokens: 12,
        outputTokens: 2,
        cacheReadInputTokens: 4,
      });
    });

    it.each([
      ['greater than prompt', 13],
      ['negative', -1],
      ['fraction', 1.5],
      ['NaN', Number.NaN],
      ['infinite', Number.POSITIVE_INFINITY],
      ['unsafe', Number.MAX_SAFE_INTEGER + 1],
    ])('ignores %s cached tokens without invalidating complete totals', (_label, cachedTokens) => {
      expect(parseKimiUsage({
        usage: {
          prompt_tokens: 12,
          completion_tokens: 2,
          cached_tokens: cachedTokens,
        },
      })).toEqual({
        inputTokens: 12,
        outputTokens: 2,
      });
    });

    it('reports invalid totals and cached fields without exposing token values', () => {
      const invalidTotalsDiagnostics: UsageDiagnostic[] = [];
      expect(parseKimiUsage({
        usage: {
          prompt_tokens: 91,
        },
        choices: [{
          usage: {
            prompt_tokens: 8,
            completion_tokens: 2,
          },
        }],
      }, (diagnostic) => invalidTotalsDiagnostics.push(diagnostic))).toEqual({
        inputTokens: 8,
        outputTokens: 2,
      });
      expect(invalidTotalsDiagnostics).toEqual([{
        type: 'invalid_usage',
        harnessProfileId: 'kimi-k3-coding-openai',
        location: 'top_level',
        field: 'totals',
        reason: 'incomplete_or_invalid',
      }]);

      const invalidCachedDiagnostics: UsageDiagnostic[] = [];
      expect(parseKimiUsage({
        usage: {
          prompt_tokens: 12,
          completion_tokens: 2,
          cached_tokens: 99,
          prompt_tokens_details: { cached_tokens: 4 },
        },
      }, (diagnostic) => invalidCachedDiagnostics.push(diagnostic))).toEqual({
        inputTokens: 12,
        outputTokens: 2,
        cacheReadInputTokens: 4,
      });
      expect(invalidCachedDiagnostics).toEqual([{
        type: 'invalid_usage',
        harnessProfileId: 'kimi-k3-coding-openai',
        location: 'top_level',
        field: 'cached_tokens',
        reason: 'invalid_or_exceeds_prompt_tokens',
      }]);

      const invalidDetailsDiagnostics: UsageDiagnostic[] = [];
      expect(parseKimiUsage({
        choices: [{
          usage: {
            prompt_tokens: 7,
            completion_tokens: 1,
            prompt_tokens_details: { cached_tokens: 8 },
          },
        }],
      }, (diagnostic) => invalidDetailsDiagnostics.push(diagnostic))).toEqual({
        inputTokens: 7,
        outputTokens: 1,
      });
      expect(invalidDetailsDiagnostics).toEqual([{
        type: 'invalid_usage',
        harnessProfileId: 'kimi-k3-coding-openai',
        location: 'choices_0',
        field: 'prompt_tokens_details.cached_tokens',
        reason: 'invalid_or_exceeds_prompt_tokens',
      }]);
      expect(JSON.stringify([
        ...invalidTotalsDiagnostics,
        ...invalidCachedDiagnostics,
        ...invalidDetailsDiagnostics,
      ])).not.toMatch(/91|99/);
    });

    it('treats null usage placeholders as absent rather than invalid', () => {
      const diagnostics: UsageDiagnostic[] = [];

      expect(parseKimiUsage({
        usage: null,
        choices: [{
          usage: {
            prompt_tokens: 6,
            completion_tokens: 2,
          },
        }],
      }, (diagnostic) => diagnostics.push(diagnostic))).toEqual({
        inputTokens: 6,
        outputTokens: 2,
      });
      expect(diagnostics).toEqual([]);
    });
  });

  it('keeps cache, session, cwd, prompt, headers, and reasoning bodies out of diagnostics and logs', async () => {
    const sensitive = {
      cacheKey: `pc1_${'9'.repeat(64)}`,
      sessionId: 'sess_99999999-9999-4999-8999-999999999999',
      cwd: '/private/customer/project',
      prompt: 'private customer prompt body',
      header: 'Bearer private-header-value',
      reasoning: 'private chain of thought body',
    };
    const diagnostics: UsageDiagnostic[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const OpenAI = (await import('openai')).default;
    const instance = new OpenAI({ apiKey: 'test' });
    vi.spyOn(instance.chat.completions, 'create').mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield {
          choices: [{
            delta: { reasoning_content: sensitive.reasoning },
            finish_reason: null,
          }],
          usage: {
            prompt_tokens: 4,
            completion_tokens: 1,
            cached_tokens: 5,
          },
        };
        yield {
          choices: [{
            delta: { reasoning: sensitive.reasoning },
            finish_reason: null,
          }],
        };
        yield {
          choices: [{
            delta: {},
            finish_reason: 'stop',
          }],
        };
      },
    } as never);
    const flags = {
      ...resolveKimiHarnessFeatureFlags({}),
      promptCacheKey: true,
      preservedThinking: true,
    };
    const adapter = createStrictKimiAdapter({
      flags,
      resolvedHeaders: { Authorization: sensitive.header },
      onUsageDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    (adapter as unknown as { client: typeof instance }).client = instance;

    try {
      const messages: Message[] = [{
        role: 'user',
        content: [{
          type: 'text',
          text: `${sensitive.sessionId}\n${sensitive.cwd}\n${sensitive.prompt}`,
        }],
      }, {
        role: 'assistant',
        content: [{ type: 'thinking', thinking: sensitive.reasoning }],
      }];
      for await (const _ of adapter.stream(
        messages,
        [],
        sensitive.prompt,
        { cacheKey: sensitive.cacheKey },
      )) { /* drain */ }

      const capturedObservability = JSON.stringify({
        diagnostics,
        warnings: warn.mock.calls,
      });
      for (const value of Object.values(sensitive)) {
        expect(capturedObservability).not.toContain(value);
      }
      expect(diagnostics).toContainEqual({
        type: 'invalid_usage',
        harnessProfileId: 'kimi-k3-coding-openai',
        location: 'top_level',
        field: 'cached_tokens',
        reason: 'invalid_or_exceeds_prompt_tokens',
      });
      expect(warn).toHaveBeenCalledWith('reasoningDialectConflict', {
        previous: 'reasoning_content',
        candidate: 'reasoning',
      });
    } finally {
      warn.mockRestore();
    }
  });

  it('drains strict Kimi after finish and emits only the trailing provider usage before done', async () => {
    const diagnostics: UsageDiagnostic[] = [];
    const OpenAI = (await import('openai')).default;
    const instance = new OpenAI({ apiKey: 'test' });
    vi.spyOn(instance.chat.completions, 'create').mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield {
          choices: [{
            delta: { content: 'visible' },
            finish_reason: 'stop',
          }],
        };
        yield {
          choices: [],
          usage: {
            prompt_tokens: 20,
            completion_tokens: 4,
            cached_tokens: 7,
          },
        };
      },
    } as never);
    const adapter = createStrictKimiAdapter({
      onUsageDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    (adapter as unknown as { client: typeof instance }).client = instance;

    await expect(collectAdapterChunks(adapter)).resolves.toEqual([
      { type: 'text', delta: 'visible' },
      {
        type: 'usage',
        usage: {
          inputTokens: 20,
          outputTokens: 4,
          cacheReadInputTokens: 7,
        },
      },
      { type: 'done' },
    ]);
    expect(diagnostics).toEqual([{
      type: 'usage_source',
      harnessProfileId: 'kimi-k3-coding-openai',
      usageSource: 'provider',
    }]);
  });

  it('rethrows the exact caller abort after final Kimi usage without yielding done', async () => {
    const sentinel = new DOMException('caller timeout after final usage', 'TimeoutError');
    const controller = new AbortController();
    const OpenAI = (await import('openai')).default;
    const instance = new OpenAI({ apiKey: 'test' });
    vi.spyOn(instance.chat.completions, 'create').mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield {
          choices: [{
            delta: { content: 'visible' },
            finish_reason: 'stop',
          }],
        };
        yield {
          choices: [],
          usage: {
            prompt_tokens: 20,
            completion_tokens: 4,
          },
        };
      },
    } as never);
    const adapter = createStrictKimiAdapter();
    (adapter as unknown as { client: typeof instance }).client = instance;
    const iterator = adapter.stream([], [], 'system', {
      signal: controller.signal,
    })[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { type: 'text', delta: 'visible' },
    });
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: {
        type: 'usage',
        usage: {
          inputTokens: 20,
          outputTokens: 4,
        },
      },
    });
    controller.abort(sentinel);
    await expect(iterator.next()).rejects.toBe(sentinel);
    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
  });

  it('keeps the latest complete Kimi snapshot without merging partial or cached fields', async () => {
    const OpenAI = (await import('openai')).default;
    const instance = new OpenAI({ apiKey: 'test' });
    vi.spyOn(instance.chat.completions, 'create').mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield {
          choices: [],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 1,
            cached_tokens: 6,
          },
        };
        yield {
          choices: [],
          usage: {
            completion_tokens: 99,
          },
        };
        yield {
          choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }],
        };
        yield {
          choices: [],
          usage: {
            prompt_tokens: 14,
            completion_tokens: 3,
          },
        };
      },
    } as never);
    const adapter = createStrictKimiAdapter();
    (adapter as unknown as { client: typeof instance }).client = instance;

    const chunks = await collectAdapterChunks(adapter);

    expect(chunks.filter((chunk) => chunk.type === 'usage')).toEqual([{
      type: 'usage',
      usage: {
        inputTokens: 14,
        outputTokens: 3,
      },
    }]);
    expect(chunks.at(-1)).toEqual({ type: 'done' });
  });

  it('estimates usage exactly once only after a clean strict Kimi completion', async () => {
    const diagnostics: UsageDiagnostic[] = [];
    const OpenAI = (await import('openai')).default;
    const instance = new OpenAI({ apiKey: 'test' });
    vi.spyOn(instance.chat.completions, 'create').mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: 'abcde' }, finish_reason: 'stop' }] };
      },
    } as never);
    const adapter = createStrictKimiAdapter({
      onUsageDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    (adapter as unknown as { client: typeof instance }).client = instance;

    const chunks = await collectAdapterChunks(adapter);

    expect(chunks.map((chunk) => chunk.type)).toEqual(['text', 'usage', 'done']);
    expect(chunks.filter((chunk) => chunk.type === 'usage')).toEqual([{
      type: 'usage',
      usage: expect.objectContaining({ outputTokens: 2 }),
    }]);
    expect(diagnostics).toEqual([{
      type: 'usage_source',
      harnessProfileId: 'kimi-k3-coding-openai',
      usageSource: 'estimate',
    }]);
  });

  it('preserves generic finish early-return and trailing-usage estimate parity', async () => {
    let capturedRequest: unknown;
    const OpenAI = (await import('openai')).default;
    const instance = new OpenAI({ apiKey: 'test' });
    vi.spyOn(instance.chat.completions, 'create').mockImplementation(async (request: unknown) => {
      capturedRequest = request;
      return {
        async *[Symbol.asyncIterator]() {
          yield { choices: [{ delta: { content: 'generic' }, finish_reason: 'stop' }] };
          yield {
            choices: [],
            usage: {
              prompt_tokens: 500,
              completion_tokens: 400,
            },
          };
        },
      } as never;
    });
    const adapter = createTestAdapter({ wireModel: 'gpt-4o' });
    (adapter as unknown as { client: typeof instance }).client = instance;

    const chunks = await collectAdapterChunks(adapter);

    expect(chunks).toEqual([
      { type: 'text', delta: 'generic' },
      {
        type: 'usage',
        usage: {
          inputTokens: 2,
          outputTokens: 2,
        },
      },
      { type: 'done' },
    ]);
    expect(capturedRequest).toEqual({
      model: 'gpt-4o',
      messages: [{ role: 'system', content: 'system' }],
      tools: undefined,
      stream: true,
      stream_options: { include_usage: true },
    });
    expect(chunks).not.toContainEqual({
      type: 'usage',
      usage: {
        inputTokens: 500,
        outputTokens: 400,
      },
    });
  });

  it('uses generic usage semantics when normalizeUsage is false without disabling schema or content traits', async () => {
    let capturedRequest: CapturedChatCompletionRequest | undefined;
    const OpenAI = (await import('openai')).default;
    const instance = new OpenAI({ apiKey: 'test' });
    vi.spyOn(instance.chat.completions, 'create').mockImplementation(async (request: unknown) => {
      capturedRequest = request as CapturedChatCompletionRequest;
      return {
        async *[Symbol.asyncIterator]() {
          yield { choices: [{ delta: { content: 'flag off' }, finish_reason: 'stop' }] };
          yield {
            choices: [],
            usage: {
              prompt_tokens: 500,
              completion_tokens: 400,
            },
          };
        },
      } as never;
    });
    const flags = {
      ...resolveKimiHarnessFeatureFlags({}),
      normalizeUsage: false,
    };
    const adapter = createStrictKimiAdapter({ flags });
    (adapter as unknown as { client: typeof instance }).client = instance;

    const chunks: StreamChunk[] = [];
    for await (const chunk of adapter.stream([{
      role: 'assistant',
      content: [
        { type: 'text', text: '  ' },
        { type: 'tool_use', id: 'tu_1', name: 'lookup', input: {} },
      ],
    }], [tool('lookup', {
      type: 'object',
      properties: { value: {} },
    })], 'system')) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { type: 'text', delta: 'flag off' },
      {
        type: 'usage',
        usage: {
          inputTokens: 3,
          outputTokens: 2,
        },
      },
      { type: 'done' },
    ]);
    expect(capturedRequest).toEqual({
      model: 'k3',
      messages: [
        { role: 'system', content: 'system' },
        {
          role: 'assistant',
          tool_calls: [{
            id: 'tu_1',
            type: 'function',
            function: {
              name: 'lookup',
              arguments: '{}',
            },
          }],
        },
      ],
      tools: [{
        type: 'function',
        function: {
          name: 'lookup',
          description: 'lookup description',
          parameters: {
            type: 'object',
            properties: { value: { type: 'string' } },
          },
        },
      }],
      stream: true,
      stream_options: { include_usage: true },
    });
    const assistant = capturedRequest?.messages.find((message) => message.role === 'assistant');
    expect(assistant).toBeDefined();
    expect(Object.hasOwn(assistant!, 'content')).toBe(false);
    expect(adapter.harnessContext.flags).toMatchObject({
      normalizeUsage: false,
      normalizeToolSchema: true,
      omitEmptyAssistantContent: true,
    });
  });

  it.each([
    {
      label: 'generic profile',
      createAdapter: () => createTestAdapter({ wireModel: 'gpt-4o' }),
    },
    {
      label: 'strict Kimi with normalizeUsage disabled',
      createAdapter: () => createStrictKimiAdapter({
        flags: {
          ...resolveKimiHarnessFeatureFlags({}),
          normalizeUsage: false,
        },
      }),
    },
  ])('rethrows the exact caller abort after inline usage for $label', async ({ createAdapter }) => {
    const sentinel = new DOMException('caller timeout after inline usage', 'TimeoutError');
    const controller = new AbortController();
    const OpenAI = (await import('openai')).default;
    const instance = new OpenAI({ apiKey: 'test' });
    vi.spyOn(instance.chat.completions, 'create').mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield {
          choices: [],
          usage: {
            prompt_tokens: 9,
            completion_tokens: 2,
          },
        };
        yield {
          choices: [{
            delta: { content: 'late text' },
            finish_reason: 'stop',
          }],
        };
      },
    } as never);
    const adapter = createAdapter();
    (adapter as unknown as { client: typeof instance }).client = instance;
    const iterator = adapter.stream([], [], 'system', {
      signal: controller.signal,
    })[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: {
        type: 'usage',
        usage: {
          inputTokens: 9,
          outputTokens: 2,
        },
      },
    });
    controller.abort(sentinel);
    await expect(iterator.next()).rejects.toBe(sentinel);
    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
  });

  it.each(['/coding', '/coding/v1', '/coding/v2', '/coding/v3', '/coding/preview'])(
    'factory owns compatibility headers for a custom Kimi %s endpoint',
    async (path) => {
      openAIConstructorCalls.length = 0;
      const adapter = createAdapterFromBinding({
        providerId: 'custom-kimi',
        providerType: 'custom',
        modelId: 'custom-kimi-model',
        wireModel: 'kimi-for-coding',
        protocol: 'openai_legacy',
        apiKey: 'test-key',
        baseUrl: `https://api.kimi.com${path}`,
        headers: {
          'User-Agent': 'caller-agent',
          'X-Stainless-Lang': 'caller-lang',
        },
        capabilities: ['tools', 'thinking'],
      }) as OpenAIAdapter;

      expect(openAIConstructorCalls).toHaveLength(1);
      expect(openAIConstructorCalls[0]).toMatchObject({
        apiKey: 'test-key',
        baseURL: `https://api.kimi.com${path}`,
        defaultHeaders: {
          'User-Agent': 'claude-cli/1.0.0 (external, cli)',
          'X-Stainless-Lang': null,
          'X-Stainless-Package-Version': null,
          'X-Stainless-OS': null,
          'X-Stainless-Arch': null,
          'X-Stainless-Runtime': null,
          'X-Stainless-Runtime-Version': null,
          'X-Stainless-Retry-Count': null,
          'X-Stainless-Timeout': null,
        },
      });
      expect(adapter.harnessContext.profile.id).toBe('generic-openai');
    },
  );

  it.each(['/coding/v1', '/coding/v2'])(
    'marks kimiCodingHeadersApplied for broad %s compatibility without selecting the strict profile',
    (path) => {
      const init = buildOpenAIAdapterInit({
        providerId: 'custom-kimi',
        providerType: 'custom',
        modelId: 'custom-kimi-model',
        wireModel: 'kimi-for-coding',
        protocol: 'openai_legacy',
        apiKey: 'test-key',
        baseUrl: `https://api.kimi.com${path}`,
        headers: {},
        capabilities: ['tools', 'thinking'],
      }, {});

      expect(init.kimiCodingHeadersApplied).toBe(true);
      expect(init.harnessContext.profile.id).toBe('generic-openai');
    },
  );

  it('keeps the default openai sdk user agent for non-kimi endpoints', async () => {
    openAIConstructorCalls.length = 0;
    createAdapterFromBinding({
      providerId: 'openai',
      providerType: 'first_party',
      modelId: 'openai-gpt-4o',
      wireModel: 'gpt-4o',
      protocol: 'openai_legacy',
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.com/v1',
      headers: {},
      capabilities: ['tools'],
    });

    expect(openAIConstructorCalls).toHaveLength(1);
    expect(openAIConstructorCalls[0]).toMatchObject({
      apiKey: 'test-key',
      baseURL: 'https://api.openai.com/v1',
    });
    expect(openAIConstructorCalls[0]).not.toMatchObject({
      defaultHeaders: {
        'User-Agent': 'claude-cli/1.0.0 (external, cli)',
      },
    });
  });

  it('uses one factory binding as the SDK and harness identity source', async () => {
    openAIConstructorCalls.length = 0;
    const adapter = createAdapterFromBinding({
      providerId: 'kimi',
      providerType: 'first_party',
      modelId: 'kimi-k3',
      wireModel: 'k3',
      protocol: 'openai_legacy',
      apiKey: 'sk-kimi',
      baseUrl: 'https://api.kimi.com/coding/v1',
      headers: {},
      capabilities: ['tools', 'thinking'],
      runtimeOptions: {
        contextLimit: 262_144,
        reasoningEffort: 'high',
      },
    }) as OpenAIAdapter;

    const request = await captureChatCompletionRequest(adapter);

    expect(openAIConstructorCalls[0]).toMatchObject({
      apiKey: 'sk-kimi',
      baseURL: adapter.harnessContext.identity.canonicalBaseUrl,
    });
    expect(request.model).toBe(adapter.harnessContext.identity.wireModel);
    expect(adapter.harnessContext.identity).toEqual({
      providerId: 'kimi',
      providerType: 'first_party',
      protocol: 'openai_legacy',
      canonicalBaseUrl: 'https://api.kimi.com/coding/v1',
      wireModel: 'k3',
      capabilities: ['tools', 'thinking'],
    });
    expect(adapter.harnessContext.profile.id).toBe('kimi-k3-coding-openai');
  });

  it.each(['low', 'high', 'max'] as const)(
    'sends K3 reasoning_effort=%s to the strict official endpoint',
    async (reasoningEffort) => {
      const adapter = createTestAdapter({
        providerId: 'kimi',
        providerType: 'first_party',
        wireModel: 'k3',
        baseUrl: 'https://api.kimi.com/coding/v1',
        runtimeOptions: { contextLimit: 262_144, reasoningEffort },
      });

      const request = await captureChatCompletionRequest(adapter);

      expect(request).toMatchObject({
        model: 'k3',
        reasoning_effort: reasoningEffort,
      });
    },
  );

  it.each([
    ['Kimi K2.7', 'kimi-k2.7', 'https://api.kimi.com/coding/v1'],
    ['K3 on a non-official endpoint', 'k3', 'https://proxy.example.com/coding/v1'],
  ] as const)('omits reasoning_effort for %s', async (_label, model, baseUrl) => {
    const adapter = createTestAdapter({
      providerId: 'kimi',
      providerType: 'first_party',
      wireModel: model,
      baseUrl,
      runtimeOptions: { contextLimit: 262_144, reasoningEffort: 'high' },
    });

    const request = await captureChatCompletionRequest(adapter);

    expect(request).not.toHaveProperty('reasoning_effort');
  });

  it('preserves K3 runtime overrides when cloning to the same wire model', async () => {
    const adapter = createTestAdapter({
      providerId: 'kimi',
      providerType: 'first_party',
      wireModel: 'k3',
      baseUrl: 'https://api.kimi.com/coding/v1',
      runtimeOptions: { contextLimit: 1_048_576, reasoningEffort: 'max' },
    });

    const clone = adapter.cloneWithModel('k3');
    const request = await captureChatCompletionRequest(clone);

    expect(clone.getCapabilities()).toMatchObject({ contextLimit: 1_048_576 });
    expect(request.reasoning_effort).toBe('max');
  });

  it.each([
    ['Kimi K2.7', 'kimi-k2.7', 200_000],
    ['GPT-4o', 'gpt-4o', 128_000],
  ] as const)('drops K3 runtime policy when cloning to %s', async (_label, model, contextLimit) => {
    const adapter = createTestAdapter({
      providerId: 'kimi',
      providerType: 'first_party',
      wireModel: 'k3',
      baseUrl: 'https://api.kimi.com/coding/v1',
      runtimeOptions: { contextLimit: 1_048_576, reasoningEffort: 'max' },
    });

    const clone = adapter.cloneWithModel(model);
    const request = await captureChatCompletionRequest(clone);

    expect(clone.getCapabilities().contextLimit).toBe(contextLimit);
    expect(request).not.toHaveProperty('reasoning_effort');
  });

  it.each([
    ['Kimi K2.7', 'kimi-k2.7', 200_000],
    ['GPT-4o', 'gpt-4o', 128_000],
  ] as const)(
    'uses generic fallback capabilities when cloning custom K3 to %s',
    async (_label, model, contextLimit) => {
      const legacyCapabilityOverrides = {
        contextLimit: 1_048_576,
        supportsPromptCaching: true,
        supportsImageInput: true,
      };
      const adapter = createTestAdapter({
        providerId: 'kimi',
        providerType: 'custom',
        wireModel: 'k3',
        baseUrl: 'https://api.kimi.com/coding/v1',
        capabilityOverrides: legacyCapabilityOverrides,
        runtimeOptions: { contextLimit: 1_048_576, reasoningEffort: 'max' },
      });

      const clone = adapter.cloneWithModel(model);

      expect(clone.getCapabilities().contextLimit).toBe(contextLimit);
      expect(clone.getCapabilities()).toMatchObject({
        supportsPromptCaching: true,
        supportsImageInput: true,
      });
    },
  );

  it('resolves safe defaults when cloning K2.7 to official K3', async () => {
    const adapter = createTestAdapter({
      providerId: 'kimi',
      providerType: 'first_party',
      wireModel: 'kimi-k2.7',
      baseUrl: 'https://api.kimi.com/coding/v1',
    });

    const clone = adapter.cloneWithModel('k3');
    const request = await captureChatCompletionRequest(clone);

    expect(request.model).toBe('k3');
    expect(clone.harnessContext.identity.capabilities).toEqual(['tools', 'thinking']);
    expect(clone.getCapabilities()).toMatchObject({ contextLimit: 262_144 });
    expect(request.reasoning_effort).toBe('high');
  });

  it('changes strict profile deterministically when cloning between K3 and K2.7 wire models', () => {
    const k3 = createTestAdapter({
      providerId: 'kimi',
      providerType: 'first_party',
      wireModel: 'k3',
      baseUrl: 'https://api.kimi.com/coding/v1',
      capabilities: ['tools', 'thinking'],
      runtimeOptions: { contextLimit: 262_144, reasoningEffort: 'high' },
    });

    const k27 = k3.cloneWithModel('kimi-k2.7');
    const k3Again = k27.cloneWithModel('k3');

    expect(k27.getModelName()).toBe('kimi-k2.7');
    expect(k27.harnessContext.profile.id).toBe('generic-openai');
    expect(k3Again.getModelName()).toBe('k3');
    expect(k3Again.harnessContext.profile.id).toBe('kimi-k3-coding-openai');
  });

  it('keeps a logical kimi-k3 clone value on the wire and outside the strict profile', async () => {
    const adapter = createTestAdapter({
      providerId: 'kimi',
      providerType: 'first_party',
      wireModel: 'kimi-k2.7',
      baseUrl: 'https://api.kimi.com/coding/v1',
      capabilities: ['tools', 'thinking'],
    });

    const wireClone = adapter.cloneWithModel('k3');
    const logicalLookingClone = adapter.cloneWithModel('kimi-k3');
    const logicalRequest = await captureChatCompletionRequest(logicalLookingClone);

    expect(wireClone.getModelName()).toBe('k3');
    expect(wireClone.harnessContext.profile.id).toBe('kimi-k3-coding-openai');
    expect(logicalLookingClone.getModelName()).toBe('kimi-k3');
    expect(logicalRequest.model).toBe('kimi-k3');
    expect(logicalRequest).not.toHaveProperty('reasoning_effort');
    expect(logicalLookingClone.harnessContext.profile.id).toBe('generic-openai');
    expect(logicalLookingClone.getCapabilities().contextLimit).not.toBe(262_144);
  });

  it('keeps custom Kimi clones generic even when the wire model becomes k3', () => {
    const adapter = createTestAdapter({
      providerId: 'kimi',
      providerType: 'custom',
      wireModel: 'kimi-k2.7',
      baseUrl: 'https://api.kimi.com/coding/v1',
      capabilities: ['tools', 'thinking'],
    });

    expect(adapter.cloneWithModel('k3').harnessContext.profile.id).toBe('generic-openai');
  });

  it('reuses the resolved flag snapshot when cloning without rereading process.env', () => {
    const flags = resolveKimiHarnessFeatureFlags({
      XIAOK_EXPERIMENTAL_KIMI_PROMPT_CACHE: '1',
      XIAOK_EXPERIMENTAL_KIMI_PRESERVED_THINKING: '1',
    });
    const adapter = createTestAdapter({
      providerId: 'kimi',
      providerType: 'first_party',
      wireModel: 'kimi-k2.7',
      baseUrl: 'https://api.kimi.com/coding/v1',
      flags,
    });

    const originalEnv = process.env;
    let clone: OpenAIAdapter | undefined;
    try {
      process.env = new Proxy(
        { ...originalEnv },
        {
          get() {
            throw new Error('cloneWithModel must not read process.env');
          },
        },
      );
      clone = adapter.cloneWithModel('k3');
    } finally {
      process.env = originalEnv;
    }

    expect(clone?.harnessContext.flags).toEqual(flags);
    expect(clone?.harnessContext.flags).toBe(flags);
  });

  it('copies the full dialect snapshot only for the same fingerprint without sharing state', () => {
    const adapter = createStrictKimiAdapter();
    const originalState = getReasoningDialectState(adapter);
    originalState.current = 'reasoning';
    originalState.learned = true;

    const clone = adapter.cloneWithModel('k3');
    const cloneState = getReasoningDialectState(clone);

    expect(clone.harnessContext.identityFingerprint)
      .toBe(adapter.harnessContext.identityFingerprint);
    expect(cloneState).toEqual({ current: 'reasoning', learned: true });
    expect(cloneState).not.toBe(originalState);
    cloneState.current = 'reasoning_content';
    cloneState.learned = false;
    expect(originalState).toEqual({ current: 'reasoning', learned: true });
  });

  it('resets dialect state when a different model changes the fingerprint', () => {
    const adapter = createStrictKimiAdapter();
    Object.assign(getReasoningDialectState(adapter), {
      current: 'reasoning',
      learned: true,
    } satisfies ReasoningDialectState);

    const clone = adapter.cloneWithModel('kimi-k2.7');

    expect(clone.harnessContext.identityFingerprint)
      .not.toBe(adapter.harnessContext.identityFingerprint);
    expect(getReasoningDialectState(clone)).toEqual({
      current: 'reasoning_content',
      learned: false,
    });
  });

  it('resets dialect state when the same wire model resolves different capabilities', () => {
    const adapter = createStrictKimiAdapter({
      capabilities: ['tools', 'thinking', 'vision'],
    });
    Object.assign(getReasoningDialectState(adapter), {
      current: 'reasoning',
      learned: true,
    } satisfies ReasoningDialectState);

    const clone = adapter.cloneWithModel('k3');

    expect(clone.harnessContext.identity.wireModel).toBe('k3');
    expect(clone.harnessContext.identity.capabilities).toEqual(['tools', 'thinking']);
    expect(clone.harnessContext.identityFingerprint)
      .not.toBe(adapter.harnessContext.identityFingerprint);
    expect(getReasoningDialectState(clone)).toEqual({
      current: 'reasoning_content',
      learned: false,
    });
  });

  it('resets dialect state when delimiter-like capabilities would collide in a flat fingerprint', () => {
    const adapter = createStrictKimiAdapter({
      capabilities: ['thinking,tools'],
    });
    Object.assign(getReasoningDialectState(adapter), {
      current: 'reasoning',
      learned: true,
    } satisfies ReasoningDialectState);

    const clone = adapter.cloneWithModel('k3');

    expect(clone.harnessContext.identity.capabilities).toEqual(['tools', 'thinking']);
    expect(clone.harnessContext.identityFingerprint)
      .not.toBe(adapter.harnessContext.identityFingerprint);
    expect(getReasoningDialectState(clone)).toEqual({
      current: 'reasoning_content',
      learned: false,
    });
  });

  it('isolates learned dialect across endpoint, provider, and new-adapter restart boundaries', () => {
    const learned = createStrictKimiAdapter();
    Object.assign(getReasoningDialectState(learned), {
      current: 'reasoning',
      learned: true,
    } satisfies ReasoningDialectState);

    const wrongEndpoint = createStrictKimiAdapter({
      baseUrl: 'https://api.kimi.com/coding/v2',
    });
    const wrongProvider = createStrictKimiAdapter({
      providerId: 'moonshot',
    });
    const restarted = createStrictKimiAdapter();

    expect(getReasoningDialectState(learned)).toEqual({
      current: 'reasoning',
      learned: true,
    });
    for (const isolated of [wrongEndpoint, wrongProvider, restarted]) {
      expect(getReasoningDialectState(isolated)).toEqual({
        current: 'reasoning_content',
        learned: false,
      });
    }
    expect(wrongEndpoint.harnessContext.identityFingerprint)
      .not.toBe(learned.harnessContext.identityFingerprint);
    expect(wrongProvider.harnessContext.identityFingerprint)
      .not.toBe(learned.harnessContext.identityFingerprint);
    expect(restarted.harnessContext.identityFingerprint)
      .toBe(learned.harnessContext.identityFingerprint);
  });

  it('emits text chunks from streaming response', async () => {
    const { OpenAIAdapter } = await import('../../../src/ai/adapters/openai.js');

    const mockStream = {
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: 'Hello ' }, finish_reason: null }] };
        yield { choices: [{ delta: { content: 'world' }, finish_reason: null }] };
        yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
      },
    };

    const OpenAI = (await import('openai')).default;
    const instance = new OpenAI({ apiKey: 'test' });
    vi.spyOn(instance.chat.completions, 'create').mockResolvedValue(mockStream as never);

    const adapter = createTestAdapter({ wireModel: 'gpt-4o' });
    (adapter as unknown as { client: typeof instance }).client = instance;

    const chunks: string[] = [];
    for await (const chunk of adapter.stream([], [], 'system')) {
      if (chunk.type === 'text') chunks.push(chunk.delta);
    }
    expect(chunks).toEqual(['Hello ', 'world']);
  });

  it('buffers tool_calls arguments and emits single tool_use chunk', async () => {
    const { OpenAIAdapter } = await import('../../../src/ai/adapters/openai.js');

    const mockStream = {
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'bash', arguments: '' } }] }, finish_reason: null }] };
        yield { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"cmd":"ls"}' } }] }, finish_reason: null }] };
        yield { choices: [{ delta: {}, finish_reason: 'tool_calls' }] };
      },
    };

    const OpenAI = (await import('openai')).default;
    const instance = new OpenAI({ apiKey: 'test' });
    vi.spyOn(instance.chat.completions, 'create').mockResolvedValue(mockStream as never);

    const adapter = createTestAdapter({ wireModel: 'gpt-4o' });
    (adapter as unknown as { client: typeof instance }).client = instance;

    const chunks = [];
    for await (const chunk of adapter.stream([], [], 'system')) {
      chunks.push(chunk);
    }

    const toolChunk = chunks.find(c => c.type === 'tool_use');
    expect(toolChunk).toMatchObject({ type: 'tool_use', id: 'call_1', name: 'bash', input: { cmd: 'ls' } });
    expect(chunks.at(-1)).toMatchObject({ type: 'done' });
  });

  it('emits done even when no finish_reason chunk arrives', async () => {
    const { OpenAIAdapter } = await import('../../../src/ai/adapters/openai.js');

    const mockStream = {
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: 'hi' }, finish_reason: null }] };
        // stream ends without finish_reason
      },
    };

    const OpenAI = (await import('openai')).default;
    const instance = new OpenAI({ apiKey: 'test' });
    vi.spyOn(instance.chat.completions, 'create').mockResolvedValue(mockStream as never);

    const adapter = createTestAdapter({ wireModel: 'gpt-4o' });
    (adapter as unknown as { client: typeof instance }).client = instance;

    const chunks = [];
    for await (const chunk of adapter.stream([], [], 'system')) chunks.push(chunk);
    expect(chunks.at(-1)).toMatchObject({ type: 'done' });
  });

  it('expands multiple tool results into separate OpenAI tool messages', async () => {
    const { OpenAIAdapter } = await import('../../../src/ai/adapters/openai.js');

    // Capture the messages passed to the API
    let capturedMessages: unknown[] = [];
    const mockStream = {
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] };
      },
    };

    const OpenAI = (await import('openai')).default;
    const instance = new OpenAI({ apiKey: 'test' });
    vi.spyOn(instance.chat.completions, 'create').mockImplementation(async (params: unknown) => {
      capturedMessages = (params as { messages: unknown[] }).messages;
      return mockStream as never;
    });

    const adapter = createTestAdapter({ wireModel: 'gpt-4o' });
    (adapter as unknown as { client: typeof instance }).client = instance;

    const messages = [
      {
        role: 'assistant' as const,
        content: [
          { type: 'text' as const, text: 'running tools' },
          { type: 'tool_use' as const, id: 'tu_1', name: 'bash', input: { command: 'ls' } },
          { type: 'tool_use' as const, id: 'tu_2', name: 'glob', input: { pattern: '*.ts' } },
        ],
      },
      {
        role: 'user' as const,
        content: [
          { type: 'tool_result' as const, tool_use_id: 'tu_1', content: 'result1' },
          { type: 'tool_result' as const, tool_use_id: 'tu_2', content: 'result2' },
        ],
      },
    ];

    for await (const _ of adapter.stream(messages, [], 'system')) { /* consume */ }

    const assistantMessages = capturedMessages.filter((m: unknown) => (m as { role: string }).role === 'assistant');
    expect(assistantMessages).toHaveLength(1);
    expect((assistantMessages[0] as { tool_calls?: unknown[] }).tool_calls).toHaveLength(2);

    const toolMessages = capturedMessages.filter((m: unknown) => (m as { role: string }).role === 'tool');
    expect(toolMessages).toHaveLength(2);
    expect((toolMessages[0] as { tool_call_id: string }).tool_call_id).toBe('tu_1');
    expect((toolMessages[1] as { tool_call_id: string }).tool_call_id).toBe('tu_2');
  });

  it('preserves assistant thinking as reasoning_content on tool-call replay', async () => {
    const { OpenAIAdapter } = await import('../../../src/ai/adapters/openai.js');

    let capturedMessages: unknown[] = [];
    const mockStream = {
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
      },
    };

    const OpenAI = (await import('openai')).default;
    const instance = new OpenAI({ apiKey: 'test' });
    vi.spyOn(instance.chat.completions, 'create').mockImplementation(async (params: unknown) => {
      capturedMessages = (params as { messages: unknown[] }).messages;
      return mockStream as never;
    });

    const adapter = createTestAdapter({ wireModel: 'kimi-k2-thinking' });
    (adapter as unknown as { client: typeof instance }).client = instance;

    const messages = [
      {
        role: 'assistant' as const,
        content: [
          { type: 'thinking' as const, thinking: 'first reasoned step' },
          { type: 'tool_use' as const, id: 'tu_1', name: 'search', input: { q: 'slash commands' } },
        ],
      },
      {
        role: 'user' as const,
        content: [
          { type: 'tool_result' as const, tool_use_id: 'tu_1', content: 'search result' },
        ],
      },
    ];

    for await (const _ of adapter.stream(messages, [], 'system')) { /* consume */ }

    const assistantMessage = capturedMessages.find((m: unknown) => (m as { role: string }).role === 'assistant') as
      | { reasoning_content?: string; tool_calls?: unknown[] }
      | undefined;
    expect(assistantMessage).toBeDefined();
    expect(assistantMessage?.reasoning_content).toBe('first reasoned step');
    expect(assistantMessage?.tool_calls).toHaveLength(1);
  });

  it('emits thinking chunks from reasoning_content streaming deltas', async () => {
    const { OpenAIAdapter } = await import('../../../src/ai/adapters/openai.js');

    const mockStream = {
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { reasoning_content: 'step 1' }, finish_reason: null }] };
        yield { choices: [{ delta: { reasoning_content: ' + step 2' }, finish_reason: null }] };
        yield { choices: [{ delta: { content: 'answer' }, finish_reason: null }] };
        yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
      },
    };

    const OpenAI = (await import('openai')).default;
    const instance = new OpenAI({ apiKey: 'test' });
    vi.spyOn(instance.chat.completions, 'create').mockResolvedValue(mockStream as never);

    const adapter = createTestAdapter({ wireModel: 'kimi-k2-thinking' });
    (adapter as unknown as { client: typeof instance }).client = instance;

    const chunks = [];
    for await (const chunk of adapter.stream([], [], 'system')) {
      chunks.push(chunk);
    }

    expect(chunks.filter((chunk) => chunk.type === 'thinking')).toEqual([
      { type: 'thinking', delta: 'step 1', signature: 'reasoning_content' },
      { type: 'thinking', delta: ' + step 2', signature: 'reasoning_content' },
    ]);
    expect(chunks).toContainEqual({ type: 'text', delta: 'answer' });
  });

  it('observes an own empty reasoning_content before the UI extractor falls back to reasoning', async () => {
    const mockStream = {
      async *[Symbol.asyncIterator]() {
        yield {
          choices: [{
            delta: {
              reasoning_content: '',
              reasoning: 'visible fallback',
            },
            finish_reason: null,
          }],
        };
        yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
      },
    };
    const OpenAI = (await import('openai')).default;
    const instance = new OpenAI({ apiKey: 'test' });
    vi.spyOn(instance.chat.completions, 'create').mockResolvedValue(mockStream as never);
    const adapter = createStrictKimiAdapter();
    (adapter as unknown as { client: typeof instance }).client = instance;

    const chunks = [];
    for await (const chunk of adapter.stream([], [], 'system')) {
      chunks.push(chunk);
    }

    expect(chunks).toContainEqual({
      type: 'thinking',
      delta: 'visible fallback',
      signature: 'reasoning',
    });
    expect(getReasoningDialectState(adapter)).toEqual({
      current: 'reasoning_content',
      learned: true,
    });
  });

  it('keeps the first raw dialect observation across retry attempts', async () => {
    let createCalls = 0;
    const OpenAI = (await import('openai')).default;
    const instance = new OpenAI({ apiKey: 'test' });
    vi.spyOn(instance.chat.completions, 'create').mockImplementation(async () => {
      createCalls += 1;
      if (createCalls === 1) {
        return {
          async *[Symbol.asyncIterator]() {
            yield {
              choices: [{
                delta: { reasoning_content: '' },
                finish_reason: null,
              }],
            };
            throw Object.assign(new Error('retry me'), { status: 500 });
          },
        } as never;
      }
      return {
        async *[Symbol.asyncIterator]() {
          yield {
            choices: [{
              delta: { reasoning: 'second attempt' },
              finish_reason: null,
            }],
          };
          yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
        },
      } as never;
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const adapter = createStrictKimiAdapter();
    (adapter as unknown as { client: typeof instance }).client = instance;

    try {
      for await (const _ of adapter.stream([], [], 'system')) { /* consume */ }
      expect(createCalls).toBe(2);
      expect(getReasoningDialectState(adapter)).toEqual({
        current: 'reasoning_content',
        learned: true,
      });
      expect(warn).toHaveBeenCalledWith(
        'reasoningDialectConflict',
        {
          previous: 'reasoning_content',
          candidate: 'reasoning',
        },
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('emits thinking chunks from reasoning_details streaming deltas', async () => {
    const { OpenAIAdapter } = await import('../../../src/ai/adapters/openai.js');

    const mockStream = {
      async *[Symbol.asyncIterator]() {
        yield {
          choices: [{
            delta: {
              reasoning_details: [
                { type: 'reasoning.text', text: 'step A' },
                { type: 'reasoning.text', text: ' + step B' },
              ],
            },
            finish_reason: null,
          }],
        };
        yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
      },
    };

    const OpenAI = (await import('openai')).default;
    const instance = new OpenAI({ apiKey: 'test' });
    vi.spyOn(instance.chat.completions, 'create').mockResolvedValue(mockStream as never);

    const adapter = createTestAdapter({ wireModel: 'kimi-k2-thinking' });
    (adapter as unknown as { client: typeof instance }).client = instance;

    const chunks = [];
    for await (const chunk of adapter.stream([], [], 'system')) {
      chunks.push(chunk);
    }

    expect(chunks.filter((chunk) => chunk.type === 'thinking')).toEqual([
      { type: 'thinking', delta: 'step A', signature: 'reasoning_details' },
      { type: 'thinking', delta: ' + step B', signature: 'reasoning_details' },
    ]);
  });

  it('reclassifies leading raw <think> content blocks into hidden thinking chunks', async () => {
    const { OpenAIAdapter } = await import('../../../src/ai/adapters/openai.js');

    const mockStream = {
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: '<thi' }, finish_reason: null }] };
        yield { choices: [{ delta: { content: 'nk>step 1' }, finish_reason: null }] };
        yield { choices: [{ delta: { content: '\nstep 2</th' }, finish_reason: null }] };
        yield { choices: [{ delta: { content: 'ink>\n\n正式回答' }, finish_reason: null }] };
        yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
      },
    };

    const OpenAI = (await import('openai')).default;
    const instance = new OpenAI({ apiKey: 'test' });
    vi.spyOn(instance.chat.completions, 'create').mockResolvedValue(mockStream as never);

    const adapter = createTestAdapter({ wireModel: 'kimi-k2-thinking' });
    (adapter as unknown as { client: typeof instance }).client = instance;

    const chunks = [];
    for await (const chunk of adapter.stream([], [], 'system')) {
      chunks.push(chunk);
    }

    expect(chunks.filter((chunk) => chunk.type === 'thinking')).toEqual([
      { type: 'thinking', delta: 'step 1', signature: 'raw_think_tag' },
      { type: 'thinking', delta: '\nstep 2', signature: 'raw_think_tag' },
    ]);
    expect(chunks.filter((chunk) => chunk.type === 'text')).toEqual([
      { type: 'text', delta: '正式回答' },
    ]);
  });

  it('keeps literal <think> text once visible assistant prose has already started', async () => {
    const { OpenAIAdapter } = await import('../../../src/ai/adapters/openai.js');

    const mockStream = {
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: '请输出字面量 <think> 标签' }, finish_reason: null }] };
        yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
      },
    };

    const OpenAI = (await import('openai')).default;
    const instance = new OpenAI({ apiKey: 'test' });
    vi.spyOn(instance.chat.completions, 'create').mockResolvedValue(mockStream as never);

    const adapter = createTestAdapter({ wireModel: 'kimi-k2-thinking' });
    (adapter as unknown as { client: typeof instance }).client = instance;

    const chunks = [];
    for await (const chunk of adapter.stream([], [], 'system')) {
      chunks.push(chunk);
    }

    expect(chunks.filter((chunk) => chunk.type === 'thinking')).toEqual([]);
    expect(chunks.filter((chunk) => chunk.type === 'text')).toEqual([
      { type: 'text', delta: '请输出字面量 <think> 标签' },
    ]);
  });

  it('joins multiple assistant thinking blocks into one reasoning_content replay payload', async () => {
    const { OpenAIAdapter } = await import('../../../src/ai/adapters/openai.js');

    let capturedMessages: unknown[] = [];
    const mockStream = {
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
      },
    };

    const OpenAI = (await import('openai')).default;
    const instance = new OpenAI({ apiKey: 'test' });
    vi.spyOn(instance.chat.completions, 'create').mockImplementation(async (params: unknown) => {
      capturedMessages = (params as { messages: unknown[] }).messages;
      return mockStream as never;
    });

    const adapter = createTestAdapter({ wireModel: 'kimi-k2-thinking' });
    (adapter as unknown as { client: typeof instance }).client = instance;

    const messages = [
      {
        role: 'assistant' as const,
        content: [
          { type: 'thinking' as const, thinking: 'first reasoned step' },
          { type: 'text' as const, text: 'working...' },
          { type: 'thinking' as const, thinking: 'second reasoned step' },
          { type: 'tool_use' as const, id: 'tu_1', name: 'search', input: { q: 'daemon isolation' } },
        ],
      },
      {
        role: 'user' as const,
        content: [
          { type: 'tool_result' as const, tool_use_id: 'tu_1', content: 'search result' },
        ],
      },
    ];

    for await (const _ of adapter.stream(messages, [], 'system')) { /* consume */ }

    const assistantMessage = capturedMessages.find((m: unknown) => (m as { role: string }).role === 'assistant') as
      | { content?: string | null; reasoning_content?: string; tool_calls?: unknown[] }
      | undefined;
    expect(assistantMessage).toBeDefined();
    expect(assistantMessage?.content).toBe('working...');
    expect(assistantMessage?.reasoning_content).toBe('first reasoned step\n\nsecond reasoned step');
    expect(assistantMessage?.tool_calls).toHaveLength(1);
  });

  it('does not inject Kimi preserved thinking when the flag is off', async () => {
    const adapter = createStrictKimiAdapter();
    const request = await captureChatCompletionRequest(adapter, [], [{
      role: 'assistant',
      content: [{ type: 'thinking', thinking: 'private' }],
    }]);
    const assistant = request.messages[1]!;

    expect(assistant).not.toHaveProperty('reasoning_content');
    expect(assistant).not.toHaveProperty('reasoning');
  });

  it('does not inject Kimi preserved thinking without thinking capability', async () => {
    const adapter = createStrictKimiAdapter({
      capabilities: ['tools'],
      flags: resolveKimiHarnessFeatureFlags({
        XIAOK_EXPERIMENTAL_KIMI_PRESERVED_THINKING: '1',
      }),
    });
    const request = await captureChatCompletionRequest(adapter, [], [{
      role: 'assistant',
      content: [{ type: 'thinking', thinking: 'private' }],
    }]);
    const assistant = request.messages[1]!;

    expect(assistant).not.toHaveProperty('reasoning_content');
    expect(assistant).not.toHaveProperty('reasoning');
  });

  it.each([
    {
      label: 'flag off',
      capabilities: ['tools', 'thinking'],
      flags: resolveKimiHarnessFeatureFlags({}),
    },
    {
      label: 'thinking capability missing',
      capabilities: ['tools'],
      flags: resolveKimiHarnessFeatureFlags({
        XIAOK_EXPERIMENTAL_KIMI_PRESERVED_THINKING: '1',
      }),
    },
  ])('does not run the Kimi serializer when $label', async ({ capabilities, flags }) => {
    const baseContext = buildOpenAIHarnessContext({
      identity: {
        providerId: 'kimi',
        providerType: 'first_party',
        protocol: 'openai_legacy',
        canonicalBaseUrl: 'https://api.kimi.com/coding/v1',
        wireModel: 'k3',
        capabilities,
      },
      flags,
    });
    const serializeReasoning = vi.fn(baseContext.profile.serializeReasoning!);
    const adapter = new OpenAIAdapter({
      apiKey: 'test-key',
      kimiCodingHeadersApplied: true,
      harnessContext: {
        ...baseContext,
        profile: {
          ...baseContext.profile,
          serializeReasoning,
        },
      },
    });

    await captureChatCompletionRequest(adapter, [], [{
      role: 'assistant',
      content: [{ type: 'thinking', thinking: 'private' }],
    }]);

    expect(serializeReasoning).not.toHaveBeenCalled();
  });

  it('preserves Kimi whitespace and directly concatenates thinking blocks', async () => {
    const adapter = createStrictKimiAdapter({
      flags: resolveKimiHarnessFeatureFlags({
        XIAOK_EXPERIMENTAL_KIMI_PRESERVED_THINKING: '1',
      }),
    });
    const request = await captureChatCompletionRequest(adapter, [], [{
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: '  first  \n' },
        { type: 'thinking', thinking: '\tsecond  ' },
        { type: 'text', text: 'answer' },
      ],
    }]);

    expect(request.messages[1]).toMatchObject({
      role: 'assistant',
      reasoning_content: '  first  \n\tsecond  ',
    });
  });

  it('backfills an empty Kimi reasoning field when an assistant history has no thinking block', async () => {
    const adapter = createStrictKimiAdapter({
      flags: resolveKimiHarnessFeatureFlags({
        XIAOK_EXPERIMENTAL_KIMI_PRESERVED_THINKING: '1',
      }),
    });
    const request = await captureChatCompletionRequest(adapter, [], [{
      role: 'assistant',
      content: [{ type: 'text', text: 'answer' }],
    }]);

    expect(request.messages[1]).toHaveProperty('reasoning_content', '');
  });

  it('replays preserved Kimi thinking with the first observed reasoning dialect', async () => {
    const flags = resolveKimiHarnessFeatureFlags({
      XIAOK_EXPERIMENTAL_KIMI_PRESERVED_THINKING: '1',
    });
    const adapter = createStrictKimiAdapter({ flags });
    const mockStream = {
      async *[Symbol.asyncIterator]() {
        yield {
          choices: [{
            delta: { reasoning_content: null, reasoning: '' },
            finish_reason: null,
          }],
        };
        yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
      },
    };
    const OpenAI = (await import('openai')).default;
    const instance = new OpenAI({ apiKey: 'test' });
    vi.spyOn(instance.chat.completions, 'create').mockResolvedValue(mockStream as never);
    (adapter as unknown as { client: typeof instance }).client = instance;
    for await (const _ of adapter.stream([], [], 'system')) { /* consume */ }

    const request = await captureChatCompletionRequest(adapter, [], [{
      role: 'assistant',
      content: [{ type: 'thinking', thinking: 'private' }],
    }]);

    expect(request.messages[1]).not.toHaveProperty('reasoning_content');
    expect(request.messages[1]).toHaveProperty('reasoning', 'private');
  });

  it('keeps the generic reasoning collector trim/filter/double-newline behavior', async () => {
    const adapter = createTestAdapter({
      wireModel: 'gpt-4o',
      flags: resolveKimiHarnessFeatureFlags({
        XIAOK_EXPERIMENTAL_KIMI_PRESERVED_THINKING: '1',
      }),
    });
    const request = await captureChatCompletionRequest(adapter, [], [{
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: '  first  ' },
        { type: 'thinking', thinking: ' \n\t ' },
        { type: 'thinking', thinking: '\nsecond\n' },
      ],
    }]);

    expect(request.messages[1]).toHaveProperty(
      'reasoning_content',
      'first\n\nsecond',
    );
  });

  it('keeps the complete generic request body unchanged when Kimi flags are enabled', async () => {
    const adapter = createTestAdapter({
      wireModel: 'gpt-4o',
      providerId: 'openai',
      providerType: 'first_party',
      baseUrl: 'https://api.openai.com/v1',
      capabilities: ['tools', 'thinking'],
      flags: resolveKimiHarnessFeatureFlags({
        XIAOK_EXPERIMENTAL_KIMI_PRESERVED_THINKING: '1',
      }),
    });
    const request = await captureChatCompletionRequest(adapter, [], [
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'plain answer' }],
      },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '  first  ' },
          { type: 'thinking', thinking: '\nsecond\n' },
          { type: 'text', text: 'working' },
          {
            type: 'tool_use',
            id: 'tu_generic',
            name: 'search',
            input: { q: 'parity' },
          },
        ],
      },
      {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'tu_generic',
          content: 'generic result',
        }],
      },
      {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'tu_generic_empty',
          name: 'lookup',
          input: {},
        }],
      },
    ]);

    expect(JSON.stringify(request)).toBe(JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'system' },
        { role: 'assistant', content: 'plain answer' },
        {
          role: 'assistant',
          content: 'working',
          tool_calls: [{
            id: 'tu_generic',
            type: 'function',
            function: {
              name: 'search',
              arguments: '{"q":"parity"}',
            },
          }],
          reasoning_content: 'first\n\nsecond',
        },
        {
          role: 'tool',
          tool_call_id: 'tu_generic',
          content: 'generic result',
        },
        {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'tu_generic_empty',
            type: 'function',
            function: {
              name: 'lookup',
              arguments: '{}',
            },
          }],
        },
      ],
      stream: true,
      stream_options: { include_usage: true },
    }));
    expect(Object.hasOwn(request.messages.at(-1)!, 'content')).toBe(true);
  });

  it('does not add Kimi reasoning fields to system, user, or tool messages or send thinking.keep', async () => {
    const adapter = createStrictKimiAdapter({
      flags: resolveKimiHarnessFeatureFlags({
        XIAOK_EXPERIMENTAL_KIMI_PRESERVED_THINKING: '1',
      }),
    });
    const request = await captureChatCompletionRequest(adapter, [], [{
      role: 'user',
      content: [
        { type: 'thinking', thinking: 'ignore user thinking' },
        { type: 'text', text: 'question' },
        { type: 'tool_result', tool_use_id: 'tu_1', content: 'tool result' },
      ],
    }]);

    for (const message of request.messages) {
      expect(message).not.toHaveProperty('reasoning_content');
      expect(message).not.toHaveProperty('reasoning');
    }
    expect(request).not.toHaveProperty('thinking');
  });

  it('keeps per-call tool and raw-thinking buffers isolated across concurrent streams', async () => {
    let createCalls = 0;
    let firstDeltaReady!: () => void;
    let releaseFirst!: () => void;
    const firstDelta = new Promise<void>((resolve) => {
      firstDeltaReady = resolve;
    });
    const firstRelease = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const OpenAI = (await import('openai')).default;
    const instance = new OpenAI({ apiKey: 'test' });
    vi.spyOn(instance.chat.completions, 'create').mockImplementation(async () => {
      createCalls += 1;
      if (createCalls === 1) {
        return {
          async *[Symbol.asyncIterator]() {
            yield {
              choices: [{
                delta: {
                  content: '<think>first',
                  tool_calls: [{
                    index: 0,
                    id: 'tu_first',
                    function: {
                      name: 'first_tool',
                      arguments: '{"value":"',
                    },
                  }],
                },
                finish_reason: null,
              }],
            };
            firstDeltaReady();
            await firstRelease;
            yield {
              choices: [{
                delta: {
                  content: '</think>first visible output',
                  tool_calls: [{
                    index: 0,
                    function: { arguments: 'one"}' },
                  }],
                },
                finish_reason: 'tool_calls',
              }],
            };
          },
        } as never;
      }
      return {
        async *[Symbol.asyncIterator]() {
          releaseFirst();
          yield {
            choices: [{
              delta: {
                content: '<think>second</think>x',
                tool_calls: [{
                  index: 0,
                  id: 'tu_second',
                  function: {
                    name: 'second_tool',
                    arguments: '{"value":"two"}',
                  },
                }],
              },
              finish_reason: 'tool_calls',
            }],
          };
        },
      } as never;
    });
    const adapter = createTestAdapter({ wireModel: 'gpt-4o' });
    (adapter as unknown as { client: typeof instance }).client = instance;

    const consume = async () => {
      const chunks = [];
      for await (const chunk of adapter.stream([], [], 'system')) {
        chunks.push(chunk);
      }
      return chunks;
    };
    const first = consume();
    await firstDelta;
    const second = consume();
    const [firstChunks, secondChunks] = await Promise.all([first, second]);

    expect(firstChunks).toContainEqual({
      type: 'thinking',
      delta: 'first',
      signature: 'raw_think_tag',
    });
    expect(firstChunks).toContainEqual({
      type: 'text',
      delta: 'first visible output',
    });
    expect(firstChunks).toContainEqual({
      type: 'tool_use',
      id: 'tu_first',
      name: 'first_tool',
      input: { value: 'one' },
    });
    expect(secondChunks).toContainEqual({
      type: 'thinking',
      delta: 'second',
      signature: 'raw_think_tag',
    });
    expect(secondChunks).toContainEqual({ type: 'text', delta: 'x' });
    expect(secondChunks).toContainEqual({
      type: 'tool_use',
      id: 'tu_second',
      name: 'second_tool',
      input: { value: 'two' },
    });
    expect(firstChunks.filter((chunk) => chunk.type === 'usage')).toEqual([
      {
        type: 'usage',
        usage: expect.objectContaining({ outputTokens: 5 }),
      },
    ]);
    expect(secondChunks.filter((chunk) => chunk.type === 'usage')).toEqual([
      {
        type: 'usage',
        usage: expect.objectContaining({ outputTokens: 1 }),
      },
    ]);
    expect(firstChunks.filter((chunk) => chunk.type === 'done')).toHaveLength(1);
    expect(secondChunks.filter((chunk) => chunk.type === 'done')).toHaveLength(1);
  });

  it('omits the content own property for strict Kimi tool calls with whitespace-only text', async () => {
    const adapter = createStrictKimiAdapter();
    const request = await captureChatCompletionRequest(adapter, [], [{
      role: 'assistant',
      content: [
        { type: 'text', text: ' ' },
        { type: 'text', text: '\n\t ' },
        { type: 'tool_use', id: 'tu_1', name: 'search', input: {} },
      ],
    }]);

    expect(Object.hasOwn(request.messages[1]!, 'content')).toBe(false);
  });

  it('preserves untrimmed non-empty text beside strict Kimi tool calls', async () => {
    const adapter = createStrictKimiAdapter();
    const request = await captureChatCompletionRequest(adapter, [], [{
      role: 'assistant',
      content: [
        { type: 'text', text: '  keep' },
        { type: 'text', text: ' me  ' },
        { type: 'tool_use', id: 'tu_1', name: 'search', input: {} },
      ],
    }]);

    expect(request.messages[1]).toHaveProperty('content', '  keep me  ');
  });

  it('keeps generic tool-call-only assistant content null', async () => {
    const adapter = createTestAdapter({
      wireModel: 'gpt-4o',
      capabilities: ['tools'],
    });
    const request = await captureChatCompletionRequest(adapter, [], [{
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'tu_1', name: 'search', input: {} },
      ],
    }]);

    expect(request.messages[1]).toHaveProperty('content', null);
  });

  it('keeps generic assistant content when the Kimi omission flag is disabled', async () => {
    const adapter = createStrictKimiAdapter({
      flags: {
        ...resolveKimiHarnessFeatureFlags({}),
        omitEmptyAssistantContent: false,
      },
    });
    const request = await captureChatCompletionRequest(adapter, [], [{
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'tu_1', name: 'search', input: {} },
      ],
    }]);

    expect(request.messages[1]).toHaveProperty('content', null);
  });

  it('does not omit assistant content without tools capability or actual tool calls', async () => {
    const withoutCapability = createStrictKimiAdapter({
      capabilities: ['thinking'],
    });
    const withNoCalls = createStrictKimiAdapter();

    const withoutCapabilityRequest = await captureChatCompletionRequest(
      withoutCapability,
      [],
      [{
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tu_1', name: 'search', input: {} },
        ],
      }],
    );
    const withNoCallsRequest = await captureChatCompletionRequest(
      withNoCalls,
      [],
      [{
        role: 'assistant',
        content: [{ type: 'text', text: ' \n\t ' }],
      }],
    );

    expect(withoutCapabilityRequest.messages[1]).toHaveProperty('content', null);
    expect(withNoCallsRequest.messages[1]).toHaveProperty('content', ' \n\t ');
  });

  it('keeps preserved empty reasoning when strict Kimi tool-call content is omitted', async () => {
    const adapter = createStrictKimiAdapter({
      flags: resolveKimiHarnessFeatureFlags({
        XIAOK_EXPERIMENTAL_KIMI_PRESERVED_THINKING: '1',
      }),
    });
    const request = await captureChatCompletionRequest(adapter, [], [{
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'tu_1', name: 'search', input: {} },
      ],
    }]);
    const assistant = request.messages[1]!;

    expect(Object.hasOwn(assistant, 'content')).toBe(false);
    expect(assistant).toHaveProperty('reasoning_content', '');
  });

  it('ignores prompt cache metadata for OpenAI-compatible payloads', async () => {
    const { OpenAIAdapter } = await import('../../../src/ai/adapters/openai.js');

    let capturedParams: Record<string, unknown> | null = null;
    const mockStream = {
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
      },
    };

    const OpenAI = (await import('openai')).default;
    const instance = new OpenAI({ apiKey: 'test' });
    vi.spyOn(instance.chat.completions, 'create').mockImplementation(async (params: unknown) => {
      capturedParams = params as Record<string, unknown>;
      return mockStream as never;
    });

    const adapter = createTestAdapter({ wireModel: 'gpt-4o' });
    (adapter as unknown as { client: typeof instance }).client = instance;

    for await (const _ of adapter.stream(
      [
        {
          role: 'user',
          content: [{ type: 'text', text: 'hello', cache_control: { type: 'ephemeral' } }],
        },
      ],
      [
        {
          name: 'read',
          description: 'Read a file',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
      'system',
      {
        promptCache: {
          systemPrompt: [{ type: 'text', text: 'cached system', cache_control: { type: 'ephemeral' } }],
          tools: [
            {
              name: 'read',
              description: 'Read a file',
              inputSchema: { type: 'object', properties: {} },
              cache_control: { type: 'ephemeral' },
            },
          ],
          messages: [
            {
              role: 'user',
              content: [{ type: 'text', text: 'hello', cache_control: { type: 'ephemeral' } }],
            },
          ],
        },
      },
    )) { /* consume */ }

    expect(capturedParams).toMatchObject({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'hello' },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'read',
            description: 'Read a file',
          },
        },
      ],
    });
    expect(JSON.stringify(capturedParams)).not.toContain('cache_control');
    expect(JSON.stringify(capturedParams)).not.toContain('cached system');
  });

  it('encodes cache affinity only for strict flagged Kimi requests with a valid key', async () => {
    const validCacheKey = `pc1_${'a'.repeat(64)}`;
    const enabledFlags = resolveKimiHarnessFeatureFlags({
      XIAOK_EXPERIMENTAL_KIMI_PROMPT_CACHE: '1',
    });
    const cases: Array<{
      name: string;
      adapter: OpenAIAdapter;
      cacheKey: string;
      expected?: string;
    }> = [
      {
        name: 'strict Kimi',
        adapter: createStrictKimiAdapter({ flags: enabledFlags }),
        cacheKey: validCacheKey,
        expected: validCacheKey,
      },
      {
        name: 'flag off',
        adapter: createStrictKimiAdapter(),
        cacheKey: validCacheKey,
      },
      {
        name: 'generic provider',
        adapter: createTestAdapter({ wireModel: 'gpt-4o', flags: enabledFlags }),
        cacheKey: validCacheKey,
      },
      {
        name: 'custom Kimi',
        adapter: createStrictKimiAdapter({
          providerType: 'custom',
          flags: enabledFlags,
        }),
        cacheKey: validCacheKey,
      },
      {
        name: 'wrong model',
        adapter: createStrictKimiAdapter({
          wireModel: 'kimi-k2.7',
          flags: enabledFlags,
        }),
        cacheKey: validCacheKey,
      },
      {
        name: 'wrong endpoint',
        adapter: createStrictKimiAdapter({
          baseUrl: 'https://api.kimi.com/coding/v2',
          flags: enabledFlags,
        }),
        cacheKey: validCacheKey,
      },
      {
        name: 'invalid key',
        adapter: createStrictKimiAdapter({ flags: enabledFlags }),
        cacheKey: 'pc1_not-valid',
      },
    ];

    for (const testCase of cases) {
      const request = await captureChatCompletionRequest(
        testCase.adapter,
        [],
        [],
        { cacheKey: testCase.cacheKey },
      );
      if (testCase.expected) {
        expect(request.prompt_cache_key, testCase.name).toBe(testCase.expected);
      } else {
        expect(request, testCase.name).not.toHaveProperty('prompt_cache_key');
      }
    }
  });

  it('keeps the complete generic request body identical when cache affinity is present', async () => {
    const baseline = await captureChatCompletionRequest(
      createTestAdapter({ wireModel: 'gpt-4o' }),
      [tool('read', { type: 'object', properties: {} })],
      [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    );
    const withAffinity = await captureChatCompletionRequest(
      createTestAdapter({ wireModel: 'gpt-4o' }),
      [tool('read', { type: 'object', properties: {} })],
      [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      { cacheKey: `pc1_${'b'.repeat(64)}` },
    );

    expect(withAffinity).toEqual(baseline);
  });

  it('keeps the same cache affinity across retry attempts', async () => {
    vi.useFakeTimers();
    try {
      const requests: CapturedChatCompletionRequest[] = [];
      const OpenAI = (await import('openai')).default;
      const instance = new OpenAI({ apiKey: 'test' });
      vi.spyOn(instance.chat.completions, 'create').mockImplementation(async (request: unknown) => {
        requests.push(request as CapturedChatCompletionRequest);
        if (requests.length === 1) {
          throw Object.assign(new Error('retry cache request'), { status: 503 });
        }
        return {
          async *[Symbol.asyncIterator]() {
            yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
          },
        } as never;
      });
      const adapter = createStrictKimiAdapter({
        flags: resolveKimiHarnessFeatureFlags({
          XIAOK_EXPERIMENTAL_KIMI_PROMPT_CACHE: '1',
        }),
      });
      (adapter as unknown as { client: typeof instance }).client = instance;
      const cacheKey = `pc1_${'c'.repeat(64)}`;
      const consume = collectAdapterChunks(adapter, { cacheKey } as StreamOptions);

      for (let index = 0; index < 20 && requests.length < 1; index += 1) {
        await Promise.resolve();
      }
      await vi.advanceTimersByTimeAsync(1000);
      await consume;

      expect(requests).toHaveLength(2);
      expect(requests.map((request) => request.prompt_cache_key)).toEqual([
        cacheKey,
        cacheKey,
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('propagates external abort signal to OpenAI requests', async () => {
    const { OpenAIAdapter } = await import('../../../src/ai/adapters/openai.js');

    let capturedOptions: { signal?: AbortSignal } | undefined;
    const mockStream = {
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
      },
    };

    const OpenAI = (await import('openai')).default;
    const instance = new OpenAI({ apiKey: 'test' });
    vi.spyOn(instance.chat.completions, 'create').mockImplementation(async (_params: unknown, options: unknown) => {
      capturedOptions = options as { signal?: AbortSignal };
      return mockStream as never;
    });

    const adapter = createTestAdapter({ wireModel: 'gpt-4o' });
    (adapter as unknown as { client: typeof instance }).client = instance;

    const controller = new AbortController();
    for await (const _ of adapter.stream([], [], 'system', { signal: controller.signal } as never)) { /* consume */ }

    expect(capturedOptions?.signal).toBeDefined();
    expect(capturedOptions?.signal?.aborted).toBe(false);
    controller.abort();
    expect(capturedOptions?.signal?.aborted).toBe(true);
  });

  it('serializes image blocks into OpenAI image_url content parts', async () => {
    const { OpenAIAdapter } = await import('../../../src/ai/adapters/openai.js');

    let capturedMessages: unknown[] = [];
    const mockStream = {
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
      },
    };

    const OpenAI = (await import('openai')).default;
    const instance = new OpenAI({ apiKey: 'test' });
    vi.spyOn(instance.chat.completions, 'create').mockImplementation(async (params: unknown) => {
      capturedMessages = (params as { messages: unknown[] }).messages;
      return mockStream as never;
    });

    const adapter = createTestAdapter({ wireModel: 'gpt-4o' });
    (adapter as unknown as { client: typeof instance }).client = instance;

    for await (const _ of adapter.stream([
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: 'YWJj',
            },
          },
        ],
      },
    ], [], 'system')) { /* consume */ }

    expect(capturedMessages).toEqual([
      { role: 'system', content: 'system' },
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: {
              url: 'data:image/png;base64,YWJj',
            },
          },
        ],
      },
    ]);
  });

  it('drops buffered usage from a retryable attempt with no visible output', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const OpenAI = (await import('openai')).default;
      const instance = new OpenAI({ apiKey: 'test' });
      vi.spyOn(instance.chat.completions, 'create').mockImplementation(async () => {
        calls += 1;
        if (calls === 1) {
          return {
            async *[Symbol.asyncIterator]() {
              yield {
                choices: [],
                usage: {
                  prompt_tokens: 100,
                  completion_tokens: 10,
                },
              };
              throw Object.assign(new Error('retry first attempt'), {
                code: 'ERR_STREAM_PREMATURE_CLOSE',
              });
            },
          } as never;
        }
        return {
          async *[Symbol.asyncIterator]() {
            yield {
              choices: [],
              usage: {
                prompt_tokens: 20,
                completion_tokens: 2,
              },
            };
            yield { choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] };
          },
        } as never;
      });
      const adapter = createStrictKimiAdapter();
      (adapter as unknown as { client: typeof instance }).client = instance;

      let chunks: StreamChunk[] | undefined;
      let caught: unknown;
      const consume = collectAdapterChunks(adapter).then(
        (value) => {
          chunks = value;
        },
        (error: unknown) => {
          caught = error;
        },
      );
      await vi.runAllTimersAsync();
      await consume;

      expect(calls).toBe(2);
      expect(caught).toBeUndefined();
      expect(chunks).toEqual([
        { type: 'text', delta: 'ok' },
        {
          type: 'usage',
          usage: {
            inputTokens: 20,
            outputTokens: 2,
          },
        },
        { type: 'done' },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('emits final provider usage before the same non-retryable error object', async () => {
    const sentinel = new Error('terminal provider failure');
    const OpenAI = (await import('openai')).default;
    const instance = new OpenAI({ apiKey: 'test' });
    vi.spyOn(instance.chat.completions, 'create').mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield {
          choices: [],
          usage: {
            prompt_tokens: 7,
            completion_tokens: 2,
          },
        };
        throw sentinel;
      },
    } as never);
    const adapter = createStrictKimiAdapter();
    (adapter as unknown as { client: typeof instance }).client = instance;
    const iterator = adapter.stream([], [], 'system')[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: {
        type: 'usage',
        usage: {
          inputTokens: 7,
          outputTokens: 2,
        },
      },
    });
    await expect(iterator.next()).rejects.toBe(sentinel);
  });

  it('emits only the final attempt usage before the same retry-exhausted error', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const sentinels = Array.from({ length: 4 }, (_, index) =>
        Object.assign(new Error(`retry failure ${index + 1}`), { status: 503 }));
      const OpenAI = (await import('openai')).default;
      const instance = new OpenAI({ apiKey: 'test' });
      vi.spyOn(instance.chat.completions, 'create').mockImplementation(async () => {
        const call = calls;
        calls += 1;
        return {
          async *[Symbol.asyncIterator]() {
            yield {
              choices: [],
              usage: {
                prompt_tokens: call + 1,
                completion_tokens: call + 1,
              },
            };
            throw sentinels[call];
          },
        } as never;
      });
      const adapter = createStrictKimiAdapter();
      (adapter as unknown as { client: typeof instance }).client = instance;
      const chunks: StreamChunk[] = [];
      let caught: unknown;
      const consume = (async () => {
        try {
          for await (const chunk of adapter.stream([], [], 'system')) {
            chunks.push(chunk);
          }
        } catch (error) {
          caught = error;
        }
      })();

      await vi.runAllTimersAsync();
      await consume;

      expect(calls).toBe(4);
      expect(chunks).toEqual([{
        type: 'usage',
        usage: {
          inputTokens: 4,
          outputTokens: 4,
        },
      }]);
      expect(caught).toBe(sentinels[3]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not estimate usage when a strict Kimi stream errors without provider usage', async () => {
    const diagnostics: UsageDiagnostic[] = [];
    const sentinel = new Error('terminal without usage');
    const OpenAI = (await import('openai')).default;
    const instance = new OpenAI({ apiKey: 'test' });
    vi.spyOn(instance.chat.completions, 'create').mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        throw sentinel;
      },
    } as never);
    const adapter = createStrictKimiAdapter({
      onUsageDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    (adapter as unknown as { client: typeof instance }).client = instance;
    const chunks: StreamChunk[] = [];
    let caught: unknown;

    try {
      for await (const chunk of adapter.stream([], [], 'system')) {
        chunks.push(chunk);
      }
    } catch (error) {
      caught = error;
    }

    expect(chunks).toEqual([]);
    expect(caught).toBe(sentinel);
    expect(diagnostics).toEqual([{
      type: 'usage_source',
      harnessProfileId: 'kimi-k3-coding-openai',
      usageSource: 'missing_on_error',
    }]);
  });

  it('does not issue an SDK request when the caller signal is already aborted', async () => {
    const sentinel = new DOMException('caller timeout before attempt', 'TimeoutError');
    const controller = new AbortController();
    controller.abort(sentinel);
    const adapter = createStrictKimiAdapter();
    const createSpy = await attachRequestSpy(adapter);

    await expect(collectAdapterChunks(adapter, {
      signal: controller.signal,
    })).rejects.toBe(sentinel);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('gives caller abort priority over retry classification without scheduling backoff', async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    try {
      let calls = 0;
      const sentinel = new DOMException('caller timeout during attempt', 'TimeoutError');
      const controller = new AbortController();
      const OpenAI = (await import('openai')).default;
      const instance = new OpenAI({ apiKey: 'test' });
      vi.spyOn(instance.chat.completions, 'create').mockImplementation(async () => {
        calls += 1;
        return {
          async *[Symbol.asyncIterator]() {
            controller.abort(sentinel);
            throw Object.assign(new Error('retryable-looking SDK error'), {
              name: 'TimeoutError',
            });
          },
        } as never;
      });
      const adapter = createStrictKimiAdapter();
      (adapter as unknown as { client: typeof instance }).client = instance;

      let caught: unknown;
      const result = collectAdapterChunks(adapter, {
        signal: controller.signal,
      }).catch((error: unknown) => {
        caught = error;
      });
      await vi.runAllTimersAsync();
      await result;

      expect(caught).toBe(sentinel);
      expect(calls).toBe(1);
      expect(setTimeoutSpy.mock.calls.some((call) => call[1] === 1000)).toBe(false);
    } finally {
      setTimeoutSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('emits buffered Kimi usage once before the same caller abort reason', async () => {
    const sentinel = new DOMException('caller timeout after usage', 'TimeoutError');
    const controller = new AbortController();
    const OpenAI = (await import('openai')).default;
    const instance = new OpenAI({ apiKey: 'test' });
    vi.spyOn(instance.chat.completions, 'create').mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield {
          choices: [],
          usage: {
            prompt_tokens: 15,
            completion_tokens: 5,
          },
        };
        controller.abort(sentinel);
        throw Object.assign(new Error('SDK timeout wrapper'), {
          name: 'TimeoutError',
        });
      },
    } as never);
    const adapter = createStrictKimiAdapter();
    (adapter as unknown as { client: typeof instance }).client = instance;
    const iterator = adapter.stream([], [], 'system', {
      signal: controller.signal,
    })[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: {
        type: 'usage',
        usage: {
          inputTokens: 15,
          outputTokens: 5,
        },
      },
    });
    await expect(iterator.next()).rejects.toBe(sentinel);
  });

  it('emits buffered usage before the exact caller abort that interrupts retry backoff', async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    try {
      let calls = 0;
      const sentinel = new DOMException('caller timeout in backoff', 'TimeoutError');
      const controller = new AbortController();
      const OpenAI = (await import('openai')).default;
      const instance = new OpenAI({ apiKey: 'test' });
      vi.spyOn(instance.chat.completions, 'create').mockImplementation(async () => {
        calls += 1;
        return {
          async *[Symbol.asyncIterator]() {
            yield {
              choices: [],
              usage: {
                prompt_tokens: 21,
                completion_tokens: 3,
              },
            };
            throw Object.assign(new Error('retry me'), { status: 503 });
          },
        } as never;
      });
      const adapter = createStrictKimiAdapter();
      (adapter as unknown as { client: typeof instance }).client = instance;
      const chunks: StreamChunk[] = [];
      let caught: unknown;
      const result = (async () => {
        try {
          for await (const chunk of adapter.stream([], [], 'system', {
            signal: controller.signal,
          })) {
            chunks.push(chunk);
          }
        } catch (error) {
          caught = error;
        }
      })();

      for (let index = 0; index < 20; index += 1) {
        await Promise.resolve();
        if (setTimeoutSpy.mock.calls.some((call) => call[1] === 1000)) {
          break;
        }
      }
      expect(setTimeoutSpy.mock.calls.some((call) => call[1] === 1000)).toBe(true);
      controller.abort(sentinel);
      await vi.runAllTimersAsync();
      await result;

      expect(caught).toBe(sentinel);
      expect(calls).toBe(1);
      expect(chunks).toEqual([{
        type: 'usage',
        usage: {
          inputTokens: 21,
          outputTokens: 3,
        },
      }]);
    } finally {
      setTimeoutSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('times out a strict Kimi stream that stalls after finish without retrying visible output', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const OpenAI = (await import('openai')).default;
      const instance = new OpenAI({ apiKey: 'test' });
      vi.spyOn(instance.chat.completions, 'create').mockImplementation(async (
        _request: unknown,
        options: unknown,
      ) => {
        calls += 1;
        const signal = (options as { signal: AbortSignal }).signal;
        return {
          async *[Symbol.asyncIterator]() {
            yield {
              choices: [{
                delta: { content: 'finished text' },
                finish_reason: 'stop',
              }],
            };
            await new Promise<never>((_resolve, reject) => {
              const rejectWithReason = () => reject(signal.reason);
              if (signal.aborted) {
                rejectWithReason();
                return;
              }
              signal.addEventListener('abort', rejectWithReason, { once: true });
            });
          },
        } as never;
      });
      const adapter = createStrictKimiAdapter();
      (adapter as unknown as { client: typeof instance }).client = instance;
      const chunks: StreamChunk[] = [];
      let caught: unknown;
      const consume = (async () => {
        try {
          for await (const chunk of adapter.stream([], [], 'system')) {
            chunks.push(chunk);
          }
        } catch (error) {
          caught = error;
        }
      })();

      await vi.advanceTimersByTimeAsync(5 * 60_000);
      await consume;

      expect(calls).toBe(1);
      expect(chunks).toEqual([{ type: 'text', delta: 'finished text' }]);
      expect(caught).toMatchObject({ name: 'AbortError' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps buffered usage state isolated across concurrent streams on one adapter', async () => {
    const diagnostics: UsageDiagnostic[] = [];
    let calls = 0;
    let firstUsageSeen!: () => void;
    let releaseFirst!: () => void;
    const firstUsage = new Promise<void>((resolve) => {
      firstUsageSeen = resolve;
    });
    const firstRelease = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const OpenAI = (await import('openai')).default;
    const instance = new OpenAI({ apiKey: 'test' });
    vi.spyOn(instance.chat.completions, 'create').mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        return {
          async *[Symbol.asyncIterator]() {
            yield {
              choices: [],
              usage: {
                prompt_tokens: 10,
                completion_tokens: 1,
              },
            };
            firstUsageSeen();
            await firstRelease;
            yield { choices: [{ delta: { content: 'first' }, finish_reason: 'stop' }] };
            yield {
              choices: [],
              usage: {
                prompt_tokens: 12,
                completion_tokens: 2,
              },
            };
          },
        } as never;
      }
      return {
        async *[Symbol.asyncIterator]() {
          releaseFirst();
          yield { choices: [{ delta: { content: 'second' }, finish_reason: 'stop' }] };
          yield {
            choices: [],
            usage: {
              prompt_tokens: 30,
              completion_tokens: 3,
            },
          };
        },
      } as never;
    });
    const adapter = createStrictKimiAdapter({
      onUsageDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    (adapter as unknown as { client: typeof instance }).client = instance;

    const first = collectAdapterChunks(adapter);
    await firstUsage;
    const second = collectAdapterChunks(adapter);
    const [firstChunks, secondChunks] = await Promise.all([first, second]);

    expect(firstChunks).toEqual([
      { type: 'text', delta: 'first' },
      {
        type: 'usage',
        usage: {
          inputTokens: 12,
          outputTokens: 2,
        },
      },
      { type: 'done' },
    ]);
    expect(secondChunks).toEqual([
      { type: 'text', delta: 'second' },
      {
        type: 'usage',
        usage: {
          inputTokens: 30,
          outputTokens: 3,
        },
      },
      { type: 'done' },
    ]);
    expect(diagnostics).toEqual([
      {
        type: 'usage_source',
        harnessProfileId: 'kimi-k3-coding-openai',
        usageSource: 'provider',
      },
      {
        type: 'usage_source',
        harnessProfileId: 'kimi-k3-coding-openai',
        usageSource: 'provider',
      },
    ]);
  });

  it('retries when the stream is dropped mid-flight with "Premature close"', async () => {
    vi.useFakeTimers();
    const { OpenAIAdapter } = await import('../../../src/ai/adapters/openai.js');

    let calls = 0;
    const OpenAI = (await import('openai')).default;
    const instance = new OpenAI({ apiKey: 'test' });
    vi.spyOn(instance.chat.completions, 'create').mockImplementation(async () => {
      calls += 1;
      if (calls < 2) {
        return {
          async *[Symbol.asyncIterator]() {
            throw Object.assign(new Error('Premature close'), { code: 'ERR_STREAM_PREMATURE_CLOSE' });
          },
        } as never;
      }
      return {
        async *[Symbol.asyncIterator]() {
          yield { choices: [{ delta: { content: 'ok' }, finish_reason: null }] };
          yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
        },
      } as never;
    });

    const adapter = createTestAdapter({ wireModel: 'gpt-4o' });
    (adapter as unknown as { client: typeof instance }).client = instance;

    const streamPromise = (async () => {
      const chunks: string[] = [];
      for await (const chunk of adapter.stream([], [], 'sys')) {
        if (chunk.type === 'text') chunks.push(chunk.delta);
      }
      return chunks;
    })();

    await vi.runAllTimersAsync();
    const chunks = await streamPromise;

    expect(calls).toBe(2);
    expect(chunks).toEqual(['ok']);
    vi.useRealTimers();
  });

  it('does not retry AbortError failures', async () => {
    vi.useFakeTimers();
    const { OpenAIAdapter } = await import('../../../src/ai/adapters/openai.js');

    let calls = 0;
    const OpenAI = (await import('openai')).default;
    const instance = new OpenAI({ apiKey: 'test' });
    vi.spyOn(instance.chat.completions, 'create').mockImplementation(async () => {
      calls += 1;
      throw Object.assign(new Error('user aborted'), { name: 'AbortError' });
    });

    const adapter = createTestAdapter({ wireModel: 'gpt-4o' });
    (adapter as unknown as { client: typeof instance }).client = instance;

    let caughtError: Error | undefined;
    const streamPromise = (async () => {
      try {
        for await (const _ of adapter.stream([], [], 'sys')) { /* drain */ }
      } catch (e) {
        caughtError = e as Error;
      }
    })();

    await vi.runAllTimersAsync();
    await streamPromise;

    expect(calls).toBe(1);
    expect(caughtError?.name).toBe('AbortError');
    vi.useRealTimers();
  });

  it('does not retry once a chunk has already been emitted', async () => {
    vi.useFakeTimers();
    const { OpenAIAdapter } = await import('../../../src/ai/adapters/openai.js');

    let calls = 0;
    const OpenAI = (await import('openai')).default;
    const instance = new OpenAI({ apiKey: 'test' });
    vi.spyOn(instance.chat.completions, 'create').mockImplementation(async () => {
      calls += 1;
      return {
        async *[Symbol.asyncIterator]() {
          yield { choices: [{ delta: { content: 'partial' }, finish_reason: null }] };
          throw Object.assign(new Error('Premature close'), { code: 'ERR_STREAM_PREMATURE_CLOSE' });
        },
      } as never;
    });

    const adapter = createTestAdapter({ wireModel: 'gpt-4o' });
    (adapter as unknown as { client: typeof instance }).client = instance;

    let caughtError: Error | undefined;
    const chunks: string[] = [];
    const streamPromise = (async () => {
      try {
        for await (const chunk of adapter.stream([], [], 'sys')) {
          if (chunk.type === 'text') chunks.push(chunk.delta);
        }
      } catch (e) {
        caughtError = e as Error;
      }
    })();

    await vi.runAllTimersAsync();
    await streamPromise;

    expect(calls).toBe(1);
    expect(chunks).toEqual(['partial']);
    expect(caughtError?.message).toBe('Premature close');
    vi.useRealTimers();
  });
});
