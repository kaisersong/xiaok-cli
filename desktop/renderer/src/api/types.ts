// Thread types (local storage)
export type ThreadMode = 'work';
export type ThreadGtdBucket = 'inbox' | 'todo' | 'waiting' | 'someday' | 'archived';

export interface ThreadRecord {
  id: string;
  title: string | null;
  status: 'idle' | 'running' | 'completed' | 'failed';
  mode: ThreadMode;
  createdAt: number;
  updatedAt: number;
  starred: boolean;
  gtdBucket: ThreadGtdBucket | null;
  pinnedAt: number | null;
  currentTaskId: string | null;
}

// LLM Provider types (mapped from config)
export interface LlmProvider {
  id: string;
  label: string;
  type: 'first_party' | 'custom';
  protocol: string;
  baseUrl?: string;
  apiKeyConfigured: boolean;
  advanced_json?: Record<string, unknown>;
}

export interface LlmProviderModel {
  id: string;
  provider: string;
  model: string;
  label: string;
  capabilities?: string[];
  isDefault: boolean;
}

export type AvailableModel = { modelId: string; model: string; label: string; capabilities?: string[] };

export interface AvailableModelView {
  modelId: string;
  model: string;
  label: string;
  capabilities?: string[];
}

export interface TestProviderConnectionResult {
  success: boolean;
  latencyMs?: number;
  error?: string;
}

export interface SpawnProfile {
  name: string;
  model: string;
}

// Persona types (mock)
export interface Persona {
  id?: string;
  persona_key: string;
  display_name: string;
  description?: string;
  scope?: string;
  budgets?: unknown[];
}

// Skill types (mock)
export interface SkillPackage {
  skill_key: string;
  display_name: string;
  is_active: boolean;
}

// User types (local mode)
export interface MeResponse {
  id: string;
  username: string;
  email?: string;
  email_verified: boolean;
  work_enabled: boolean;
}

// Config types
export interface CaptchaConfig { enabled: boolean; }
export interface MemoryConfig { enabled: boolean; }
export interface ConnectorsConfig {
  fetch: { provider: 'none' };
  search: { provider: 'none' };
}
export interface CreditsBalance { balance: number; }

// Channel types
export type ChannelType = 'yunzhijia' | 'discord' | 'feishu' | 'qq' | 'qqbot' | 'weixin' | 'telegram';

export interface ChannelConfig {
  id: string;
  type: ChannelType;
  name: string;
  webhookUrl?: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ChannelBindCode {
  code: string;
  expiresAt: number;
}

// MCP types
export type MCPInstallSource = 'npm' | 'github' | 'local';

export interface MCPInstallConfig {
  id: string;
  name: string;
  source: MCPInstallSource;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
  createdAt: number;
}

// Usage types
export interface MeUsageSummary { totalRequests: number; totalTokens: number }
export interface MeHourlyUsageItem { hour: string; requests: number; tokens: number }
export interface MeDailyUsageItem { date: string; requests: number; tokens: number }
export interface MeModelUsageItem { model: string; requests: number; tokens: number; cost: number }

// Channel / Persona types (for settings shared)
export interface ChannelResponse { id: string; type: string; name: string; enabled: boolean }
export interface ChannelBindingResponse { id: string; channelType: string; bindingType: string }

// Memory types
export type MemoryErrorEvent = { id: string; message: string; timestamp: number; errorType: string }

// Run type
export interface Run { id: string; threadId: string; status: string; createdAt: number; completedAt?: number }

export interface UploadedThreadAttachment { id: string; fileName: string; fileSize: number }
