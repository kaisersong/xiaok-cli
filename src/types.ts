// AI Agent 与模型适配层的共享接口

export interface ModelAdapter {
  stream(
    messages: Message[],
    tools: ToolDefinition[],
    systemPrompt: string
  ): AsyncIterable<StreamChunk>;
}

export type StreamChunk =
  | { type: 'text'; delta: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'done' };

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface Message {
  role: 'user' | 'assistant' | 'tool_result';
  content: string | ToolResultContent[];
  // OpenAI 要求 assistant 消息携带 tool_calls 以便后续 turn 关联 tool 结果
  toolCalls?: ToolCall[];
}

export interface ToolResultContent {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export type PermissionClass = 'safe' | 'write' | 'bash';

export interface Tool {
  definition: ToolDefinition;
  permission: PermissionClass;
  execute(input: Record<string, unknown>): Promise<string>;
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

// config.json schema
export interface Config {
  schemaVersion: 1;
  defaultModel: 'claude' | 'openai' | 'custom';
  models: {
    claude?: { model: string; apiKey?: string };
    openai?: { model: string; apiKey?: string };
    custom?: { baseUrl: string; apiKey?: string; model?: string };
  };
  devApp?: { appKey: string; appSecret: string };
  defaultMode: 'interactive';
  contextBudget: number;
}

const VALID_PROVIDERS = ['claude', 'openai', 'custom'] as const;

export const DEFAULT_CONFIG: Config = {
  schemaVersion: 1,
  defaultModel: 'claude',
  models: {
    claude: { model: 'claude-opus-4-6' },
  },
  defaultMode: 'interactive',
  contextBudget: 4000,
};

/** 校验 defaultModel 是否合法，防止脏数据写入 */
export function isValidProvider(v: unknown): v is Config['defaultModel'] {
  return VALID_PROVIDERS.includes(v as Config['defaultModel']);
}
