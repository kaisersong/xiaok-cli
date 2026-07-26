// tests/ai/adapters/openai.test.ts
import { describe, it, expect, vi } from 'vitest';
import { OpenAIAdapter } from '../../../src/ai/adapters/openai.js';
import { createAdapterFromBinding } from '../../../src/ai/models.js';
import {
  buildOpenAIHarnessContext,
  resolveKimiHarnessFeatureFlags,
  type OpenAIAdapterInit,
  type ReasoningKeyName,
} from '../../../src/ai/providers/model-harness-profile.js';
import type { ModelRuntimeOptions } from '../../../src/ai/providers/types.js';

const openAIConstructorCalls: unknown[] = [];

type KimiReasoningEffort = 'low' | 'high' | 'max';

interface CapturedChatCompletionRequest {
  model: string;
  reasoning_effort?: KimiReasoningEffort;
}

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

async function captureChatCompletionRequest(adapter: unknown): Promise<CapturedChatCompletionRequest> {
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
    stream(messages: never[], tools: never[], systemPrompt: string): AsyncIterable<unknown>;
  };
  for await (const _ of streamAdapter.stream([], [], 'system')) { /* consume */ }

  if (!capturedRequest) {
    throw new Error('OpenAI request was not captured');
  }
  return capturedRequest;
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
    harnessContext: buildOpenAIHarnessContext({
      identity,
      flags: input.flags ?? resolveKimiHarnessFeatureFlags({}),
      runtimeOptions: input.runtimeOptions,
      capabilityOverrides: input.capabilityOverrides,
    }),
  };

  return new OpenAIAdapter(init);
}

describe('OpenAIAdapter', () => {
  it.each(['/coding/v1', '/coding/v2'])(
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

  it('treats cloneWithModel input as a wire model instead of a logical model id', () => {
    const adapter = createTestAdapter({
      providerId: 'kimi',
      providerType: 'first_party',
      wireModel: 'kimi-k2.7',
      baseUrl: 'https://api.kimi.com/coding/v1',
      capabilities: ['tools', 'thinking'],
    });

    const wireClone = adapter.cloneWithModel('k3');
    const logicalLookingClone = adapter.cloneWithModel('kimi-k3');

    expect(wireClone.getModelName()).toBe('k3');
    expect(wireClone.harnessContext.profile.id).toBe('kimi-k3-coding-openai');
    expect(logicalLookingClone.getModelName()).toBe('kimi-k3');
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

  it('reuses the resolved flag snapshot when cloning', () => {
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

    const clone = adapter.cloneWithModel('k3');

    expect(clone.harnessContext.flags).toEqual(flags);
    expect(clone.harnessContext.flags).toBe(flags);
  });

  it('copies the reasoning dialect snapshot without sharing mutable clone state', () => {
    const adapter = createTestAdapter({ wireModel: 'gpt-4o' });
    const originalState = (adapter as unknown as {
      reasoningDialectState: { key: ReasoningKeyName };
    }).reasoningDialectState;
    originalState.key = 'reasoning';

    const clone = adapter.cloneWithModel('gpt-4.1');
    const cloneState = (clone as unknown as {
      reasoningDialectState: { key: ReasoningKeyName };
    }).reasoningDialectState;

    expect(cloneState).toEqual({ key: 'reasoning' });
    expect(cloneState).not.toBe(originalState);
    cloneState.key = 'reasoning_content';
    expect(originalState.key).toBe('reasoning');
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
