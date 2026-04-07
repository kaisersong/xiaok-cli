// AI Agent 与模型适配层的共享接口

import type { MessageBlock } from './ai/runtime/blocks.js';
import type { UsageStats } from './ai/runtime/usage.js';
import type { RuntimeEvent } from './runtime/events.js';
import type { AgentSessionSnapshot } from './ai/runtime/session.js';
import type { PromptCacheSegments } from './ai/runtime/model-capabilities.js';
import type { PromptSnapshot } from './ai/prompts/types.js';

export type { MessageBlock, UsageStats };

export interface ModelAdapter {
  stream(
    messages: Message[],
    tools: ToolDefinition[],
    systemPrompt: string
  ): AsyncIterable<StreamChunk>;
  getModelName(): string;
}

export type StreamChunk =
  | { type: 'text'; delta: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'usage'; usage: UsageStats }
  | { type: 'done' };

export type ToolCall = Extract<MessageBlock, { type: 'tool_use' }>;

export interface Message {
  role: 'user' | 'assistant';
  content: MessageBlock[];
}

export type ToolResultContent = Extract<MessageBlock, { type: 'tool_result' }>;

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolExecutionContext {
  session: AgentSessionSnapshot;
  messages: Message[];
  systemPrompt: string;
  toolDefinitions: ToolDefinition[];
  promptCache?: PromptCacheSegments;
  promptSnapshot?: PromptSnapshot;
}

export type PermissionClass = 'safe' | 'write' | 'bash';

export interface Tool {
  definition: ToolDefinition;
  permission: PermissionClass;
  execute(input: Record<string, unknown>, context?: ToolExecutionContext): Promise<string>;
}

export interface RuntimeHookSink {
  emit(event: RuntimeEvent): void;
}

// credentials.json schema
export interface Credentials {
  schemaVersion: 1;
  accessToken: string;
  refreshToken: string;
  enterpriseId: string;
  userId: string;
  expiresAt: string; // ISO 8601
}

export type YZJInboundMode = 'webhook' | 'websocket';

export interface YZJNamedChannel {
  name: string;
  robotId: string;
}

export interface YZJChannelConfig {
  enabled?: boolean;
  webhookUrl?: string;
  inboundMode?: YZJInboundMode;
  webhookPath?: string;
  webhookPort?: number;
  secret?: string;
  namedChannels?: YZJNamedChannel[];
}

// config.json schema
export interface Config {
  schemaVersion: 1;
  defaultModel: 'claude' | 'openai' | 'custom';
  models: {
    claude?: { model: string; apiKey?: string; baseUrl?: string };
    openai?: { model: string; apiKey?: string };
    custom?: { baseUrl: string; apiKey?: string; model?: string };
  };
  devApp?: { appKey: string; appSecret: string };
  defaultMode: 'interactive';
  channels?: {
    yzj?: YZJChannelConfig;
  };
}

const VALID_PROVIDERS = ['claude', 'openai', 'custom'] as const;

export const DEFAULT_CONFIG: Config = {
  schemaVersion: 1,
  defaultModel: 'claude',
  models: {
    claude: { model: 'claude-opus-4-6' },
  },
  defaultMode: 'interactive',
  channels: {},
};

/** 校验 defaultModel 是否合法，防止脏数据写入 */
export function isValidProvider(v: unknown): v is Config['defaultModel'] {
  return VALID_PROVIDERS.includes(v as Config['defaultModel']);
}

// Permission settings schema
export interface PermissionSettings {
  permissions?: {
    allow?: string[];
    deny?: string[];
  };
}

// Permission choice for interactive prompts
export type PermissionChoice =
  | { action: 'allow_once' }
  | { action: 'allow_session'; rule: string }
  | { action: 'allow_project'; rule: string }
  | { action: 'allow_global'; rule: string }
  | { action: 'deny' };
