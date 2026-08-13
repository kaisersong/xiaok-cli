import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import OpenAI from 'openai';
import type { Fetch as OpenAIFetch } from 'openai/core';
import type {
  ModelAdapter,
  Message,
  ToolDefinition,
  StreamChunk,
  UsageStats,
} from '../../types.js';
import { createLogger } from '../../utils/logger.js';
import { isAbortError } from '../runtime/abort-utils.js';
import type { ModelCapabilities, StreamOptions } from '../runtime/model-capabilities.js';
import { estimateTokens } from '../runtime/usage.js';
import { isOfficialKimiK3OpenAIEndpoint, resolveModelRuntimeOptions } from '../providers/model-runtime-options.js';
import {
  buildOpenAIHarnessContext,
  isOwnedStrictOpenAIHarnessContext,
  observeReasoningDialect,
  type KimiUsageDiagnostic,
  type KimiUsageDiagnosticSink,
  type OpenAIAdapterInit,
  type ReasoningDialectState,
} from '../providers/model-harness-profile.js';
import {
  KIMI_SCHEMA_LIMITS,
  KimiToolSchemaError,
  type KimiSchemaLimitKind,
} from '../providers/kimi-tool-schema.js';
import { getProviderProfile, resolveProviderModelVariant } from '../providers/registry.js';
import type { ModelReasoningEffort } from '../providers/types.js';
import {
  consumeProviderConversationAuthorization,
  reserveProviderConversationAuthorization,
  verifyConsumedProviderConversationAuthorizationForRetry,
  type ProviderConversationAuthorizationReservation,
} from '../runtime/provider-conversation-authorization.js';
import { assertKimiTransportAllowed } from '../runtime/kimi-rollback-policy.js';

const MAX_RETRIES = 3;
const STREAM_TIMEOUT_MS = 5 * 60_000; // 5 min per stream call
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 529]);
const usageLogger = createLogger('ai:openai-adapter:usage');
const ownedHarnessProfiles = new WeakMap<
  object,
  OpenAIAdapterInit['harnessContext']['profile']['id']
>();

function recordUsageDiagnostic(diagnostic: KimiUsageDiagnostic): void {
  usageLogger.info('kimiUsageDiagnostic', diagnostic);
}

function isRetryableError(error: unknown): boolean {
  if (isAbortError(error)) return false;
  if (error instanceof Error) {
    if (error.name === 'TimeoutError') return true;
    const record = error as unknown as Record<string, unknown>;
    if (record.retryable === true) return true;
    const status = record.status;
    if (typeof status === 'number' && RETRYABLE_STATUS.has(status)) return true;
    const code = typeof record.code === 'string' ? record.code : '';
    if (/ERR_STREAM_PREMATURE_CLOSE|ECONNRESET|ETIMEDOUT|EPIPE|UND_ERR/i.test(code)) return true;
    if (/overload|502|503|timeout|ECONNRESET|ETIMEDOUT|EPIPE|Bad gateway|Premature close|terminated|socket hang up|network|fetch failed/i.test(error.message)) return true;
  }
  return false;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
}

function throwIfCallerAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw abortReason(signal);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(abortReason(signal));
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(signal ? abortReason(signal) : new DOMException('The operation was aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
const RAW_THINK_OPEN_TAG = '<think>';
const RAW_THINK_CLOSE_TAG = '</think>';
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
const MAX_OPENAI_STREAM_TEXT_CHARS = 2 * 1024 * 1024;
const MAX_OPENAI_STREAM_TOOL_ARGUMENT_CHARS = 2 * 1024 * 1024;

type OpenAIHttpAgent = HttpAgent | HttpsAgent;

interface KimiReasoningEffortRequestExtension {
  reasoning_effort: ModelReasoningEffort;
}

interface StreamAttemptState {
  latestProviderUsage?: UsageStats;
  outputChars: number;
}

interface BufferedToolCall {
  id: string;
  name: string;
  argsBuffer: string;
}

function openAIStreamLimitError(
  code: 'OPENAI_STREAM_TEXT_LIMIT_EXCEEDED' | 'OPENAI_STREAM_TOOL_ARGUMENT_LIMIT_EXCEEDED',
): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

function drainBufferedToolCalls(
  toolBuffers: Map<number, BufferedToolCall>,
  strictKimiK3: boolean,
): Array<Extract<StreamChunk, { type: 'tool_use' }>> {
  const calls: Array<Extract<StreamChunk, { type: 'tool_use' }>> = [];
  for (const buffer of toolBuffers.values()) {
    let input: Record<string, unknown>;
    try {
      const parsed = JSON.parse(buffer.argsBuffer || '{}') as unknown;
      if (
        strictKimiK3
        && (
          typeof parsed !== 'object'
          || parsed === null
          || Array.isArray(parsed)
          || !buffer.id
          || !buffer.name
        )
      ) {
        throw new Error('invalid strict Kimi tool call');
      }
      input = parsed as Record<string, unknown>;
    } catch {
      if (strictKimiK3) {
        throw new Error('KIMI_REASONING_TERMINAL_BOUNDARY_REQUIRED');
      }
      input = { _raw: buffer.argsBuffer };
    }
    calls.push({ type: 'tool_use', id: buffer.id, name: buffer.name, input });
  }
  toolBuffers.clear();
  return calls;
}

function createOpenAIHttpAgent(baseUrl?: string): OpenAIHttpAgent {
  const protocol = new URL(baseUrl ?? DEFAULT_OPENAI_BASE_URL).protocol;
  return protocol === 'http:'
    ? new HttpAgent({ keepAlive: true })
    : new HttpsAgent({ keepAlive: true });
}

function createStrictKimiNoRedirectFetch(): OpenAIFetch {
  const fetchImpl = globalThis.fetch.bind(globalThis);
  const fetchWithoutRedirect: typeof fetch = async (input, init) => {
    const response = await fetchImpl(input, {
      ...init,
      redirect: 'manual',
    });
    if (response.status >= 300 && response.status < 400) {
      throw new Error('KIMI_K3_REDIRECT_FORBIDDEN');
    }
    return response;
  };
  // The SDK's Fetch response is typed through its node-fetch compatibility
  // shim, while Electron provides the WHATWG-compatible global fetch at
  // runtime. The callable contract used here is the same.
  return fetchWithoutRedirect as unknown as OpenAIFetch;
}

function collectReasoningText(blocks: Message['content']): string | undefined {
  const reasoning = blocks
    .filter((block): block is Extract<Message['content'][number], { type: 'thinking' }> => block.type === 'thinking')
    .map((block) => block.thinking.trim())
    .filter(Boolean)
    .join('\n\n');

  return reasoning || undefined;
}

function estimateStreamUsage(
  messages: Message[],
  systemPrompt: string,
  outputChars: number,
): UsageStats {
  const allInputMessages = [
    { role: 'user' as const, content: [{ type: 'text' as const, text: systemPrompt }] },
    ...messages.map(m => ({
      role: m.role,
      content: m.content.map(b => {
        if (b.type === 'text') return { type: 'text' as const, text: b.text };
        if (b.type === 'tool_use') return { type: 'text' as const, text: JSON.stringify(b.input) };
        if (b.type === 'tool_result') return { type: 'text' as const, text: b.content };
        if (b.type === 'image') return { type: 'text' as const, text: '[image]' };
        return { type: 'text' as const, text: '' };
      }),
    })),
  ];
  return {
    inputTokens: estimateTokens(allInputMessages as unknown as Message[]),
    outputTokens: Math.ceil(outputChars / 4),
  };
}

function hasHarnessCapability(
  capabilities: readonly string[],
  expected: string,
): boolean {
  return capabilities.some(
    (capability) => capability.toLowerCase() === expected,
  );
}

function extractReasoningDeltas(
  delta: Record<string, unknown>,
  strictKimiK3 = false,
): StreamChunk[] {
  if (strictKimiK3) {
    if (
      Object.prototype.hasOwnProperty.call(delta, 'reasoning_content')
      && typeof delta.reasoning_content === 'string'
    ) {
      return [{
        type: 'thinking',
        delta: delta.reasoning_content,
        signature: 'reasoning_content',
        reasoningProvenance: {
          captureVersion: 1,
          source: 'reasoning_content',
          fieldPresence: 'present',
        },
      }];
    }
    return [];
  }

  const chunks: StreamChunk[] = [];
  const reasoningDetails = delta.reasoning_details;
  let usedReasoningDetails = false;

  if (Array.isArray(reasoningDetails)) {
    for (const item of reasoningDetails) {
      const detail = item as { type?: unknown; text?: unknown };
      if (detail.type === 'reasoning.text' && typeof detail.text === 'string' && detail.text.length > 0) {
        chunks.push({
          type: 'thinking',
          signature: 'reasoning_details',
          delta: detail.text,
        });
        usedReasoningDetails = true;
      }
    }
  }

  if (!usedReasoningDetails) {
    for (const field of ['reasoning_content', 'reasoning', 'reasoning_text', 'thinking', 'thought'] as const) {
      const value = delta[field];
      if (typeof value === 'string' && value.length > 0) {
        chunks.push({ type: 'thinking', signature: field, delta: value });
        break;
      }
    }
  }

  return chunks;
}

function wrapKimiSchemaError(
  error: KimiToolSchemaError,
  toolName: string,
): KimiToolSchemaError {
  return new KimiToolSchemaError(error.code, {
    limitKind: error.limitKind,
    toolName,
    message: error.message,
  });
}

function requestLimitError(
  limitKind: KimiSchemaLimitKind,
  toolName?: string,
): KimiToolSchemaError {
  return new KimiToolSchemaError('KIMI_SCHEMA_LIMIT_EXCEEDED', {
    limitKind,
    toolName,
    message: `Kimi tool request exceeded ${limitKind}`,
  });
}

async function runProviderOperation<T>(
  strictKimiK3: boolean,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!strictKimiK3) {
      throw error;
    }
    const sanitized = new Error('KIMI_K3_PROVIDER_REQUEST_FAILED') as Error & {
      code: 'KIMI_K3_PROVIDER_REQUEST_FAILED';
      retryable: boolean;
    };
    sanitized.name = 'KimiK3ProviderRequestError';
    sanitized.code = 'KIMI_K3_PROVIDER_REQUEST_FAILED';
    sanitized.retryable = isRetryableError(error);
    throw sanitized;
  }
}

type RawThinkParserState = {
  active: boolean;
  mode: 'outside' | 'inside';
  buffer: string;
};

type ParsedContentSegment =
  | { type: 'thinking'; delta: string; signature: 'raw_think_tag' }
  | { type: 'text'; delta: string };

function getTrailingTagPrefixLength(value: string, tag: string): number {
  const maxLength = Math.min(value.length, tag.length - 1);
  for (let length = maxLength; length > 0; length -= 1) {
    if (tag.startsWith(value.slice(-length))) {
      return length;
    }
  }
  return 0;
}

function drainLeadingRawThinkSegments(
  state: RawThinkParserState,
  chunk: string,
  force = false,
): ParsedContentSegment[] {
  state.buffer += chunk;
  const segments: ParsedContentSegment[] = [];

  while (state.buffer.length > 0) {
    if (!state.active) {
      segments.push({ type: 'text', delta: state.buffer });
      state.buffer = '';
      break;
    }

    if (state.mode === 'inside') {
      const closeIndex = state.buffer.indexOf(RAW_THINK_CLOSE_TAG);
      if (closeIndex >= 0) {
        const reasoning = state.buffer.slice(0, closeIndex);
        if (reasoning.length > 0) {
          segments.push({ type: 'thinking', delta: reasoning, signature: 'raw_think_tag' });
        }
        state.buffer = state.buffer.slice(closeIndex + RAW_THINK_CLOSE_TAG.length);
        state.mode = 'outside';
        continue;
      }

      if (force) {
        segments.push({ type: 'text', delta: `${RAW_THINK_OPEN_TAG}${state.buffer}` });
        state.buffer = '';
        state.mode = 'outside';
        state.active = false;
        break;
      }

      const carryLength = getTrailingTagPrefixLength(state.buffer, RAW_THINK_CLOSE_TAG);
      const stableReasoning = state.buffer.slice(0, state.buffer.length - carryLength);
      if (stableReasoning.length > 0) {
        segments.push({ type: 'thinking', delta: stableReasoning, signature: 'raw_think_tag' });
        state.buffer = state.buffer.slice(state.buffer.length - carryLength);
      }
      break;
    }

    const leadingWhitespace = state.buffer.match(/^\s+/)?.[0] ?? '';
    if (leadingWhitespace.length > 0) {
      state.buffer = state.buffer.slice(leadingWhitespace.length);
      if (state.buffer.length === 0) {
        break;
      }
      continue;
    }

    if (state.buffer.startsWith(RAW_THINK_OPEN_TAG)) {
      state.buffer = state.buffer.slice(RAW_THINK_OPEN_TAG.length);
      state.mode = 'inside';
      continue;
    }

    if (!force && RAW_THINK_OPEN_TAG.startsWith(state.buffer)) {
      break;
    }

    state.active = false;
    segments.push({ type: 'text', delta: state.buffer });
    state.buffer = '';
    break;
  }

  return segments;
}

export class OpenAIAdapter implements ModelAdapter {
  client: OpenAI;
  private readonly apiKey: string;
  private readonly resolvedHeaders?: Readonly<Record<string, string | null>>;
  private readonly kimiCodingHeadersApplied: boolean;
  private readonly onUsageDiagnostic: KimiUsageDiagnosticSink;
  private readonly httpAgent: OpenAIHttpAgent;
  readonly harnessContext: OpenAIAdapterInit['harnessContext'];
  private reasoningDialectState: ReasoningDialectState = {
    current: 'reasoning_content',
    learned: false,
  };

  constructor(init: OpenAIAdapterInit) {
    assertKimiTransportAllowed(init.harnessContext.identity);
    const strictKimiK3 = init.harnessContext.profile.id !== 'generic-openai';
    if (
      strictKimiK3
      && !isOwnedStrictOpenAIHarnessContext(init.harnessContext)
    ) {
      throw new Error('KIMI_K3_PROFILE_CAPABILITY_REQUIRED');
    }
    this.apiKey = init.apiKey;
    this.resolvedHeaders = init.resolvedHeaders;
    this.kimiCodingHeadersApplied = init.kimiCodingHeadersApplied;
    this.onUsageDiagnostic = init.onUsageDiagnostic ?? recordUsageDiagnostic;
    this.harnessContext = init.harnessContext;
    ownedHarnessProfiles.set(this, init.harnessContext.profile.id);
    this.httpAgent = createOpenAIHttpAgent(init.harnessContext.identity.canonicalBaseUrl);
    this.client = new OpenAI({
      apiKey: init.apiKey,
      baseURL: init.harnessContext.identity.canonicalBaseUrl,
      maxRetries: strictKimiK3 ? 0 : MAX_RETRIES,
      httpAgent: this.httpAgent,
      defaultHeaders: init.resolvedHeaders,
      ...(strictKimiK3
        ? { fetch: createStrictKimiNoRedirectFetch() }
        : {}),
    });
  }

  getModelName(): string {
    return this.harnessContext.identity.wireModel;
  }

  getHarnessProfileId(): string {
    return this.harnessContext.profile.id;
  }

  /**
   * Read-only identity view. Authorization ownership is established by the
   * concrete adapter instance, never by a caller-provided string or registrar.
   */
  getOwnedHarnessProfileId(): OpenAIAdapterInit['harnessContext']['profile']['id'] | undefined {
    return ownedHarnessProfiles.get(this);
  }

  getCapabilities(): Readonly<ModelCapabilities> {
    return this.harnessContext.runtimeCapabilities;
  }

  dispose(): void {
    this.httpAgent.destroy();
  }

  cloneWithModel(newWireModel: string): OpenAIAdapter {
    const currentIdentity = this.harnessContext.identity;
    const providerProfile = currentIdentity.providerType === 'first_party'
      ? getProviderProfile(currentIdentity.providerId)
      : undefined;
    const catalogVariant = providerProfile
      ? resolveProviderModelVariant(providerProfile, newWireModel)
      : undefined;
    const runtimeOptions = newWireModel === currentIdentity.wireModel
      ? this.harnessContext.runtimeOptions
      : resolveModelRuntimeOptions({
          protocol: currentIdentity.protocol,
          baseUrl: currentIdentity.canonicalBaseUrl,
          wireModel: newWireModel,
          catalogOptions: catalogVariant?.runtimeOptions,
          catalogConstraints: catalogVariant?.runtimeConstraints,
        }).runtimeOptions;
    const nextIdentity = {
      ...currentIdentity,
      wireModel: newWireModel,
      capabilities: catalogVariant?.capabilities
        ? [...catalogVariant.capabilities]
        : [...currentIdentity.capabilities],
    };
    const capabilityOverrides = catalogVariant
      ? undefined
      : {
          supportsPromptCaching: this.harnessContext.runtimeCapabilities.supportsPromptCaching,
          supportsImageInput: this.harnessContext.runtimeCapabilities.supportsImageInput,
        };
    const clone = new OpenAIAdapter({
      apiKey: this.apiKey,
      resolvedHeaders: this.resolvedHeaders,
      kimiCodingHeadersApplied: this.kimiCodingHeadersApplied,
      onUsageDiagnostic: this.onUsageDiagnostic,
      harnessContext: buildOpenAIHarnessContext({
        identity: nextIdentity,
        flags: this.harnessContext.flags,
        runtimeOptions,
        capabilityOverrides,
      }),
    });
    if (
      clone.harnessContext.identityFingerprint
      === this.harnessContext.identityFingerprint
    ) {
      clone.reasoningDialectState = { ...this.reasoningDialectState };
    }
    return clone;
  }

  async *stream(
    messages: Message[],
    tools: ToolDefinition[],
    systemPrompt: string,
    options?: StreamOptions,
  ): AsyncIterable<StreamChunk> {
    assertKimiTransportAllowed(this.harnessContext.identity);
    const profileId = this.getOwnedHarnessProfileId();
    const strictProfile = profileId === 'kimi-k3-coding-openai'
      || profileId === 'kimi-k3-256k-coding-openai'
      ? profileId
      : undefined;
    if (!strictProfile && options?.providerConversationAuthorization) {
      throw new Error('KIMI_K3_AUTHORIZATION_PROFILE_MISMATCH');
    }
    const authorizationReservation: ProviderConversationAuthorizationReservation | undefined =
      strictProfile
        ? reserveProviderConversationAuthorization({
            authorization: options?.providerConversationAuthorization,
            adapter: this,
            messages,
          })
        : undefined;
    let authorizationConsumed = false;
    const authorizeDispatch = authorizationReservation
      ? () => {
          if (!authorizationConsumed) {
            consumeProviderConversationAuthorization({
              reservation: authorizationReservation,
              adapter: this,
              messages,
            });
            authorizationConsumed = true;
            return;
          }
          verifyConsumedProviderConversationAuthorizationForRetry({
            reservation: authorizationReservation,
            adapter: this,
            messages,
          });
        }
      : undefined;
    const bufferedUsage = (
      this.harnessContext.flags.normalizeUsage
      && this.harnessContext.profile.extractUsage !== undefined
    );
    let usageSourceEmitted = false;
    const reportUsageSource = (
      usageSource: Extract<KimiUsageDiagnostic, { type: 'usage_source' }>['usageSource'],
    ): void => {
      if (usageSourceEmitted) {
        return;
      }
      usageSourceEmitted = true;
      this.onUsageDiagnostic({
        type: 'usage_source',
        harnessProfileId: 'kimi-k3-coding-openai',
        usageSource,
      });
    };
    let attempt = 0;
    while (true) {
      throwIfCallerAborted(options?.signal);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS);
      const signal = options?.signal
        ? AbortSignal.any([controller.signal, options.signal])
        : controller.signal;
      let emittedAny = false;
      let emittedBufferedUsage = false;
      const attemptState: StreamAttemptState = { outputChars: 0 };
      try {
        for await (const chunk of this.streamOnce(
          messages,
          tools,
          systemPrompt,
          options,
          signal,
          bufferedUsage ? attemptState : undefined,
          authorizeDispatch,
        )) {
          emittedAny = true;
          yield chunk;
        }
        if (options?.signal?.aborted) {
          throw abortReason(options.signal);
        }
        if (bufferedUsage) {
          const providerUsage = attemptState.latestProviderUsage;
          reportUsageSource(providerUsage ? 'provider' : 'estimate');
          emittedBufferedUsage = true;
          yield {
            type: 'usage',
            usage: providerUsage
              ?? estimateStreamUsage(messages, systemPrompt, attemptState.outputChars),
          };
          throwIfCallerAborted(options?.signal);
          yield { type: 'done' };
        }
        return;
      } catch (error) {
        clearTimeout(timer);
        const terminalError = options?.signal?.aborted
          ? (options.signal.reason ?? error)
          : error;
        // 已产出 chunk 后重试会重复输出，必须放弃重试
        if (
          options?.signal?.aborted
          || emittedAny
          || !isRetryableError(error)
          || attempt >= MAX_RETRIES
        ) {
          if (bufferedUsage) {
            if (attemptState.latestProviderUsage && !emittedBufferedUsage) {
              reportUsageSource('provider');
              emittedBufferedUsage = true;
              yield {
                type: 'usage',
                usage: attemptState.latestProviderUsage,
              };
              throwIfCallerAborted(options?.signal);
            } else if (!attemptState.latestProviderUsage && !emittedBufferedUsage) {
              reportUsageSource('missing_on_error');
            }
          }
          throw terminalError;
        }
        const delayMs = Math.min(1000 * 2 ** attempt, 16000);
        try {
          await sleep(delayMs, options?.signal);
        } catch (backoffError) {
          const backoffTerminalError = options?.signal?.aborted
            ? (options.signal.reason ?? backoffError)
            : backoffError;
          if (bufferedUsage) {
            if (attemptState.latestProviderUsage && !emittedBufferedUsage) {
              reportUsageSource('provider');
              emittedBufferedUsage = true;
              yield {
                type: 'usage',
                usage: attemptState.latestProviderUsage,
              };
            } else if (!attemptState.latestProviderUsage && !emittedBufferedUsage) {
              reportUsageSource('missing_on_error');
            }
          }
          throw backoffTerminalError;
        }
        attempt += 1;
      } finally {
        clearTimeout(timer);
      }
    }
  }

  private async *streamOnce(
    messages: Message[],
    tools: ToolDefinition[],
    systemPrompt: string,
    options?: StreamOptions,
    signal?: AbortSignal,
    attemptState?: StreamAttemptState,
    authorizeDispatch?: () => void,
  ): AsyncIterable<StreamChunk> {
    const normalizeToolSchema = this.harnessContext.profile.normalizeToolSchema;
    const shouldNormalizeToolSchemas = (
      this.harnessContext.flags.normalizeToolSchema
      && normalizeToolSchema !== undefined
      && this.harnessContext.identity.capabilities.some(
        (capability) => capability.toLowerCase() === 'tools',
      )
    );
    let openaiTools: OpenAI.ChatCompletionTool[];

    if (!shouldNormalizeToolSchemas) {
      openaiTools = tools.map((tool) => ({
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema as Record<string, unknown>,
        },
      }));
    } else {
      if (tools.length > KIMI_SCHEMA_LIMITS.maxRequestToolCount) {
        throw requestLimitError('request_tool_count');
      }

      openaiTools = [];
      let requestInputNodes = 0;
      let requestOutputNodes = 0;
      let requestToolBytes = 0;
      for (const tool of tools) {
        let normalized;
        try {
          normalized = normalizeToolSchema(tool.inputSchema);
        } catch (error) {
          if (error instanceof KimiToolSchemaError) {
            throw wrapKimiSchemaError(error, tool.name);
          }
          throw error;
        }

        requestInputNodes += normalized.inputNodes;
        if (requestInputNodes > KIMI_SCHEMA_LIMITS.maxRequestInputNodes) {
          throw requestLimitError('request_input_nodes', tool.name);
        }
        requestOutputNodes += normalized.outputNodes;
        if (requestOutputNodes > KIMI_SCHEMA_LIMITS.maxRequestOutputNodes) {
          throw requestLimitError('request_output_nodes', tool.name);
        }
        requestToolBytes += normalized.outputBytes;
        if (requestToolBytes > KIMI_SCHEMA_LIMITS.maxRequestToolBytes) {
          throw requestLimitError('request_tool_bytes', tool.name);
        }

        openaiTools.push({
          type: 'function' as const,
          function: {
            name: tool.name,
            description: tool.description,
            parameters: normalized.schema,
          },
        });
      }
    }

    const openaiMessages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
    ];

    for (const m of messages) {
      if (m.role === 'assistant') {
        const textBlocks = m.content.filter((block) => block.type === 'text');
        const toolUseBlocks = m.content.filter((block) => block.type === 'tool_use');
        const text = textBlocks.map((block) => block.text).join('');
        const shouldOmitContent = (
          this.harnessContext.flags.omitEmptyAssistantContent
          && this.harnessContext.profile.shouldOmitAssistantContent !== undefined
          && hasHarnessCapability(
            this.harnessContext.identity.capabilities,
            'tools',
          )
          && this.harnessContext.profile.shouldOmitAssistantContent({
            hasToolCalls: toolUseBlocks.length > 0,
            text,
          })
        );

        const msg: OpenAI.ChatCompletionAssistantMessageParam & {
          reasoning_content?: string;
          reasoning?: string;
        } = {
          role: 'assistant',
        };
        if (!shouldOmitContent) {
          msg.content = textBlocks.length > 0
            ? text
            : (toolUseBlocks.length > 0 ? null : '');
        }

        if (toolUseBlocks.length > 0) {
          msg.tool_calls = toolUseBlocks.map((block) => ({
            id: block.id,
            type: 'function' as const,
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input),
            },
          }));
        }

        const serializeReasoning = this.harnessContext.profile.serializeReasoning;
        if (serializeReasoning) {
          const preservedThinkingEnabled = (
            this.harnessContext.profile.id !== 'generic-openai'
            || (
              this.harnessContext.flags.preservedThinking
              && hasHarnessCapability(
                this.harnessContext.identity.capabilities,
                'thinking',
              )
            )
          );
          if (preservedThinkingEnabled) {
            const serialized = serializeReasoning(
              m.content,
              this.reasoningDialectState.current,
              true,
            );
            if (serialized) {
              msg[serialized.field] = serialized.value;
            }
          }
        } else {
          const reasoningContent = collectReasoningText(m.content);
          if (reasoningContent) {
            msg.reasoning_content = reasoningContent;
          }
        }

        openaiMessages.push(msg);
        continue;
      }

      const textBlocks = m.content.filter((block) => block.type === 'text');
      const imageBlocks = m.content.filter((block) => block.type === 'image');
      if (imageBlocks.length > 0) {
        const contentParts = [
          ...textBlocks.map((block) => ({
            type: 'text' as const,
            text: block.text,
          })),
          ...imageBlocks.map((block) => ({
            type: 'image_url' as const,
            image_url: {
              url: `data:${block.source.media_type};base64,${block.source.data}`,
            },
          })),
        ];

        openaiMessages.push({
          role: 'user',
          content: contentParts,
        } as OpenAI.ChatCompletionUserMessageParam);
      } else if (textBlocks.length > 0) {
        openaiMessages.push({
          role: 'user',
          content: textBlocks.map((block) => block.text).join(''),
        });
      }

      const toolResults = m.content.filter((block) => block.type === 'tool_result');
      for (const item of toolResults) {
        openaiMessages.push({
          role: 'tool' as const,
          tool_call_id: item.tool_use_id,
          content: item.content,
        });
      }
    }

    const request: OpenAI.ChatCompletionCreateParamsStreaming = {
      model: this.harnessContext.identity.wireModel,
      messages: openaiMessages,
      tools: openaiTools.length > 0 ? openaiTools : undefined,
      stream: true,
      stream_options: { include_usage: true },
    };

    const cacheKey = options?.cacheKey;
    if (
      this.harnessContext.flags.promptCacheKey
      && this.harnessContext.profile.encodeCacheKey
      && typeof cacheKey === 'string'
      && /^pc1_[0-9a-f]{64}$/.test(cacheKey)
    ) {
      Object.assign(
        request,
        this.harnessContext.profile.encodeCacheKey(cacheKey),
      );
    }

    if (
      (
        this.harnessContext.identity.wireModel === 'k3'
        || this.harnessContext.identity.wireModel === 'k3-256k'
      )
      && isOfficialKimiK3OpenAIEndpoint(this.harnessContext.identity.canonicalBaseUrl)
      && this.harnessContext.runtimeOptions?.reasoningEffort
    ) {
      Object.assign(request, {
        reasoning_effort: this.harnessContext.runtimeOptions.reasoningEffort,
      } satisfies KimiReasoningEffortRequestExtension);
    }

    const strictKimiK3 = this.harnessContext.profile.id !== 'generic-openai';
    authorizeDispatch?.();
    const stream = await runProviderOperation(
      strictKimiK3,
      () => this.client.chat.completions.create(request, { signal }),
    );

    const toolBuffers = new Map<number, BufferedToolCall>();
    const rawThinkParser: RawThinkParserState = {
      active: true,
      mode: 'outside',
      buffer: '',
    };
    let emittedDone = false;
    let outputChars = 0;
    let streamTextChars = 0;
    let usageReceived = false;
    let officialReasoningSeen = false;
    const extractBufferedUsage = attemptState
      ? this.harnessContext.profile.extractUsage
      : undefined;

    const streamIterator = stream[Symbol.asyncIterator]();
    while (true) {
      const iteration = await runProviderOperation(
        strictKimiK3,
        () => streamIterator.next(),
      );
      if (iteration.done) {
        break;
      }
      const chunk = iteration.value;
      if (extractBufferedUsage && attemptState) {
        const usage = extractBufferedUsage(
          chunk as unknown as Record<string, unknown>,
          this.onUsageDiagnostic,
        );
        if (usage) {
          attemptState.latestProviderUsage = usage;
        }
      } else if (chunk.usage) {
        // Generic baseline keeps inline usage emission.
        usageReceived = true;
        yield {
          type: 'usage',
          usage: {
            inputTokens: chunk.usage.prompt_tokens ?? 0,
            outputTokens: chunk.usage.completion_tokens ?? 0,
          },
        };
        throwIfCallerAborted(options?.signal);
      }

      if (attemptState && emittedDone) {
        continue;
      }

      const choice = chunk.choices[0];
      if (!choice) continue;
      const delta = choice.delta;
      if (!delta) continue;
      if (
        strictKimiK3
        && Object.prototype.hasOwnProperty.call(delta, 'reasoning_content')
        && typeof (delta as Record<string, unknown>).reasoning_content === 'string'
      ) {
        officialReasoningSeen = true;
      }

      if (this.harnessContext.profile.serializeReasoning) {
        const observation = observeReasoningDialect(
          this.reasoningDialectState,
          delta as Record<string, unknown>,
        );
        if (observation.conflict) {
          console.warn('reasoningDialectConflict', observation.conflict);
        }
      }

      for (const reasoning of extractReasoningDeltas(
        delta as Record<string, unknown>,
        strictKimiK3,
      )) {
        if (reasoning.type !== 'thinking') {
          continue;
        }
        streamTextChars += reasoning.delta.length;
        if (streamTextChars > MAX_OPENAI_STREAM_TEXT_CHARS) {
          await streamIterator.return?.();
          throw openAIStreamLimitError('OPENAI_STREAM_TEXT_LIMIT_EXCEEDED');
        }
        yield reasoning;
      }

      if (delta.content) {
        for (const segment of drainLeadingRawThinkSegments(rawThinkParser, delta.content)) {
          if (segment.type === 'thinking') {
            streamTextChars += segment.delta.length;
            if (streamTextChars > MAX_OPENAI_STREAM_TEXT_CHARS) {
              await streamIterator.return?.();
              throw openAIStreamLimitError('OPENAI_STREAM_TEXT_LIMIT_EXCEEDED');
            }
            if (!strictKimiK3) {
              yield segment;
            }
            continue;
          }
          streamTextChars += segment.delta.length;
          if (streamTextChars > MAX_OPENAI_STREAM_TEXT_CHARS) {
            await streamIterator.return?.();
            throw openAIStreamLimitError('OPENAI_STREAM_TEXT_LIMIT_EXCEEDED');
          }
          outputChars += segment.delta.length;
          if (attemptState) {
            attemptState.outputChars = outputChars;
          }
          yield segment;
        }
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const current = toolBuffers.get(tc.index) ?? { id: '', name: '', argsBuffer: '' };
          if (tc.id) current.id = tc.id;
          if (tc.function?.name) current.name = tc.function.name;
          if (tc.function?.arguments) {
            if (
              current.argsBuffer.length + tc.function.arguments.length
              > MAX_OPENAI_STREAM_TOOL_ARGUMENT_CHARS
            ) {
              await streamIterator.return?.();
              throw openAIStreamLimitError('OPENAI_STREAM_TOOL_ARGUMENT_LIMIT_EXCEEDED');
            }
            current.argsBuffer += tc.function.arguments;
          }
          toolBuffers.set(tc.index, current);
        }
      }

      if (choice?.finish_reason) {
        if (strictKimiK3 && !officialReasoningSeen) {
          throw new Error('KIMI_REASONING_ADMISSION_REQUIRED');
        }
        for (const segment of drainLeadingRawThinkSegments(rawThinkParser, '', true)) {
          if (segment.type === 'thinking') {
            streamTextChars += segment.delta.length;
            if (streamTextChars > MAX_OPENAI_STREAM_TEXT_CHARS) {
              await streamIterator.return?.();
              throw openAIStreamLimitError('OPENAI_STREAM_TEXT_LIMIT_EXCEEDED');
            }
            if (!strictKimiK3) {
              yield segment;
            }
            continue;
          }
          streamTextChars += segment.delta.length;
          if (streamTextChars > MAX_OPENAI_STREAM_TEXT_CHARS) {
            await streamIterator.return?.();
            throw openAIStreamLimitError('OPENAI_STREAM_TEXT_LIMIT_EXCEEDED');
          }
          outputChars += segment.delta.length;
          if (attemptState) {
            attemptState.outputChars = outputChars;
          }
          yield segment;
        }

        for (const toolCall of drainBufferedToolCalls(toolBuffers, strictKimiK3)) {
          yield toolCall;
        }

        if (attemptState) {
          emittedDone = true;
          continue;
        }

        // If the API didn't return usage, estimate locally
        if (!usageReceived) {
          yield {
            type: 'usage',
            usage: estimateStreamUsage(messages, systemPrompt, outputChars),
          };
          throwIfCallerAborted(options?.signal);
        }

        emittedDone = true;
        yield { type: 'done' };
        return;
      }
    }

    if (!emittedDone) {
      if (strictKimiK3) {
        if (toolBuffers.size === 0) {
          throw new Error('KIMI_REASONING_TERMINAL_BOUNDARY_REQUIRED');
        }
        if (!officialReasoningSeen) {
          throw new Error('KIMI_REASONING_ADMISSION_REQUIRED');
        }
        for (const toolCall of drainBufferedToolCalls(toolBuffers, true)) {
          yield toolCall;
        }
        if (attemptState) {
          return;
        }
        if (!usageReceived) {
          yield {
            type: 'usage',
            usage: estimateStreamUsage(messages, systemPrompt, outputChars),
          };
          throwIfCallerAborted(options?.signal);
        }
        yield { type: 'done' };
        return;
      }
      for (const segment of drainLeadingRawThinkSegments(rawThinkParser, '', true)) {
        if (segment.type === 'thinking') {
          streamTextChars += segment.delta.length;
          if (streamTextChars > MAX_OPENAI_STREAM_TEXT_CHARS) {
            await streamIterator.return?.();
            throw openAIStreamLimitError('OPENAI_STREAM_TEXT_LIMIT_EXCEEDED');
          }
          yield segment;
          continue;
        }
        streamTextChars += segment.delta.length;
        if (streamTextChars > MAX_OPENAI_STREAM_TEXT_CHARS) {
          await streamIterator.return?.();
          throw openAIStreamLimitError('OPENAI_STREAM_TEXT_LIMIT_EXCEEDED');
        }
        outputChars += segment.delta.length;
        if (attemptState) {
          attemptState.outputChars = outputChars;
        }
        yield segment;
      }

      for (const toolCall of drainBufferedToolCalls(toolBuffers, false)) {
        yield toolCall;
      }

      if (attemptState) {
        return;
      }

      if (!usageReceived) {
        yield {
          type: 'usage',
          usage: estimateStreamUsage(messages, systemPrompt, outputChars),
        };
        throwIfCallerAborted(options?.signal);
      }

      yield { type: 'done' };
    }
  }
}
