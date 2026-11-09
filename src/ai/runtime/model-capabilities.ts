import type { Message, ModelAdapter, ToolDefinition } from '../../types.js';
import type { ProviderConversationAuthorization } from './provider-conversation-authorization.js';
import type { ProviderDisclosureContext } from '../../runtime/sol-pi/provider-disclosure.js';

export interface CacheControl {
  type: 'ephemeral';
}

export interface SystemPromptBlock {
  type: 'text';
  text: string;
  cache_control?: CacheControl;
}

export type CachedToolDefinition = ToolDefinition & {
  cache_control?: CacheControl;
};

export interface PromptCacheSegments {
  systemPrompt: SystemPromptBlock[];
  tools: CachedToolDefinition[];
  messages: Message[];
}

export interface ModelInvocationOptions {
  /** Host-created single-attempt capability; never restored from serialized state. */
  semanticSummaryAttempt?: import('../../runtime/sol-pi/semantic-summary-attempt.js').SemanticSummaryAttempt;
  /** Exact output reserve used by both the request preview and the actual SDK. */
  semanticSummaryOutputTokens?: number;
  providerDisclosure?: ProviderDisclosureContext;
  promptCache?: PromptCacheSegments;
  cacheKey?: string;
  providerConversationAuthorization?: ProviderConversationAuthorization;
}

export interface StreamOptions extends ModelInvocationOptions {
  /** Internal summary contract; not a provider body field or public setting. */
  requireCompleteResponse?: boolean;
  maxOutputTokens?: number;
  reasoningMode?: 'disabled';
  signal?: AbortSignal;
}

export interface RunInvocationContext {
  cacheKey?: string;
}

export interface ModelCapabilities {
  contextLimit: number;
  compactThreshold: number;
  supportsPromptCaching: boolean;
  supportsImageInput: boolean;
}

export interface CapabilityAwareAdapter extends ModelAdapter {
  getCapabilities?(): Partial<ModelCapabilities>;
  stream(
    messages: Message[],
    tools: ToolDefinition[],
    systemPrompt: string,
    options?: StreamOptions,
  ): AsyncIterable<import('../../types.js').StreamChunk>;
}

export const DEFAULT_MODEL_CAPABILITIES: ModelCapabilities = {
  contextLimit: 200_000,
  compactThreshold: 0.85,
  supportsPromptCaching: false,
  supportsImageInput: false,
};

function inferModelCapabilities(modelName: string): Partial<ModelCapabilities> {
  if (/^claude-opus/i.test(modelName)) {
    return {
      contextLimit: 1_000_000,
      supportsPromptCaching: true,
      supportsImageInput: true,
    };
  }

  if (/^claude-.*(sonnet|haiku)/i.test(modelName)) {
    return {
      contextLimit: 200_000,
      supportsPromptCaching: true,
      supportsImageInput: true,
    };
  }

  if (/^(gpt-|o[1-9]|chatgpt)/i.test(modelName)) {
    return {
      contextLimit: 128_000,
      supportsImageInput: true,
    };
  }

  // Vision 仅限 DeepSeek 官方标了 Vision 的名字：canonical `deepseek-flash`
  // 与实验型号 v4-flash-vision-exp（2026-10-18 查证 https://api-docs.deepseek.com/quick_start/pricing）。
  // legacy `deepseek-v4-flash` / `deepseek-v4-pro` 维持纯文本推断——官方 pricing
  // 脚注称旧名由 1017 服务，但未经本端直测前不承诺能力，避免把不支持图片的
  // 会话误投影成视觉请求。
  if (/^deepseek-(flash|v4-flash-vision-exp)$/i.test(modelName)) {
    return {
      supportsImageInput: true,
    };
  }

  return {};
}

export function modelCapabilitiesFromFlags(capabilities?: string[]): Partial<ModelCapabilities> {
  const flags = new Set((capabilities ?? []).map((item) => item.toLowerCase()));
  const overrides: Partial<ModelCapabilities> = {};
  if (flags.has('image_in') || flags.has('vision')) {
    overrides.supportsImageInput = true;
  }
  return overrides;
}

export function resolveModelCapabilities(model: string): ModelCapabilities;
export function resolveModelCapabilities(adapter: ModelAdapter): ModelCapabilities;
export function resolveModelCapabilities(modelOrAdapter: string | ModelAdapter): ModelCapabilities {
  const modelName = typeof modelOrAdapter === 'string'
    ? modelOrAdapter
    : typeof (modelOrAdapter as Partial<ModelAdapter>).getModelName === 'function'
      ? (modelOrAdapter as Partial<ModelAdapter>).getModelName?.() ?? ''
      : '';
  const overrides = typeof modelOrAdapter === 'string'
    ? {}
    : (modelOrAdapter as CapabilityAwareAdapter).getCapabilities?.() ?? {};

  return {
    ...DEFAULT_MODEL_CAPABILITIES,
    ...inferModelCapabilities(modelName),
    ...overrides,
  };
}

function addCacheControlToLastTool(tools: ToolDefinition[]): CachedToolDefinition[] {
  const stableTools = tools.slice().sort((left, right) => left.name.localeCompare(right.name));
  return stableTools.map((tool, index) => {
    if (index !== stableTools.length - 1) {
      return { ...tool };
    }

    return {
      ...tool,
      cache_control: { type: 'ephemeral' },
    };
  });
}

function addCacheControlToHistory(messages: Message[]): Message[] {
  if (messages.length < 2) {
    return messages.map((message) => ({
      role: message.role,
      content: message.content.map((block) => ({ ...block })),
    }));
  }

  const anchorIndex = Math.max(0, messages.length - 2);

  return messages.map((message, messageIndex) => ({
    role: message.role,
    content: message.content.map((block, blockIndex) => {
      if (messageIndex !== anchorIndex || blockIndex !== message.content.length - 1) {
        return { ...block };
      }

      return {
        ...block,
        cache_control: { type: 'ephemeral' },
      };
    }),
  }));
}

export function buildPromptCacheSegments(
  systemPromptOrSegments: string | Array<{ text: string; cacheable: boolean }>,
  tools: ToolDefinition[],
  messages: Message[],
): PromptCacheSegments {
  let systemPromptBlocks: SystemPromptBlock[];

  if (typeof systemPromptOrSegments === 'string') {
    systemPromptBlocks = [{ type: 'text', text: systemPromptOrSegments }];
  } else {
    systemPromptBlocks = systemPromptOrSegments
      .filter((seg) => seg.text)
      .map((seg) => ({
        type: 'text' as const,
        text: seg.text,
        ...(seg.cacheable ? { cache_control: { type: 'ephemeral' } as const } : {}),
      }));
  }

  return {
    systemPrompt: systemPromptBlocks,
    tools: addCacheControlToLastTool(tools),
    messages: addCacheControlToHistory(messages),
  };
}
