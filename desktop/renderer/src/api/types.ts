// Thread types (local storage + desktop web-client compatibility)
export type ThreadMode = 'chat' | 'work';
export type CollaborationMode = ThreadMode;
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
  taskIds: string[];  // All task IDs for this thread (in order)

  // Compatibility fields mirrored from the web-client API shape. Desktop's
  // IndexedDB store uses camelCase, while shared sidebar code still consumes
  // snake_case metadata from the server-backed client.
  created_at?: string | number;
  updated_at?: string | number;
  active_run_id?: string | null;
  sidebar_work_folder?: string | null;
  sidebar_pinned_at?: string | number | null;
  sidebar_gtd_bucket?: ThreadGtdBucket | null;
  is_private?: boolean;
  collaboration_mode?: CollaborationMode;
  collaboration_mode_revision?: number | null;
}

/** Alias used by thread-list context (web-client naming convention). */
export type ThreadResponse = ThreadRecord;

export interface UpdateThreadSidebarRequest {
  starred?: boolean;
  gtdBucket?: ThreadGtdBucket | null;
  mode?: ThreadMode;
  sidebar_work_folder?: string | null;
  sidebar_pinned?: boolean;
  sidebar_gtd_bucket?: ThreadGtdBucket | null;
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
export type ConnectorsSearchProvider = 'duckduckgo' | 'tavily' | 'brave' | 'searxng';
export type ConnectorsFetchProvider = 'basic' | 'jina' | 'firecrawl';
export interface ConnectorsConfig {
  search: {
    provider: ConnectorsSearchProvider;
    tavilyApiKey?: string;
    braveApiKey?: string;
    searxngBaseUrl?: string;
  };
  fetch: {
    provider: ConnectorsFetchProvider;
    jinaApiKey?: string;
    firecrawlApiKey?: string;
    firecrawlBaseUrl?: string;
  };
}
export type ConnectorsLoadStatus = 'ok' | 'missing' | 'parse_failed';
export interface ConnectorsProviderRuntime {
  provider_name: string;
  runtime_state: 'ready' | 'missing_config' | 'invalid_config' | 'inactive' | 'not_implemented';
  runtime_reason?: string;
}
export interface ConnectorsConfigSnapshot {
  config: ConnectorsConfig;
  loadStatus: ConnectorsLoadStatus;
  providers: ConnectorsProviderRuntime[];
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
export interface ChannelIdentityResponse { id: string; channelType: string; channelName?: string; boundAt?: string }

// Memory types
export type MemoryErrorEvent = { id: string; message: string; timestamp: number; errorType: string }

// Run type
export interface Run { id: string; threadId: string; status: string; createdAt: number; completedAt?: number }

export type LoopDefinitionStatus = 'active' | 'paused';
export type LoopDefinitionOrigin = 'built_in' | 'user_template';
export type LoopRunStatus = 'running' | 'success' | 'failed' | 'blocked';
export type EvidenceAnomalyStatus = 'open' | 'resolved' | 'ignored';

export interface LoopDefinitionView {
  id: string;
  title: string;
  description: string;
  status: LoopDefinitionStatus;
  origin?: LoopDefinitionOrigin;
  activeRunId?: string;
  createdAt: number;
  updatedAt: number;
}

export type UserLoopTemplateKind = 'markdown_file';

export interface UserLoopTemplateView {
  loopId: string;
  title: string;
  description: string;
  status: LoopDefinitionStatus;
  origin?: LoopDefinitionOrigin;
  activeRunId?: string;
  kind: UserLoopTemplateKind;
  prompt: string;
  outputDirectory: string;
  outputFileName: string;
  outputPath: string;
  scheduleActionId?: string;
  scheduleEnabled: boolean;
  scheduleTrigger?: { kind: string; [key: string]: unknown };
  autoRunApproved: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface UserLoopTemplateInput {
  loopId?: string;
  title: string;
  description?: string;
  kind: UserLoopTemplateKind;
  prompt: string;
  outputDirectory: string;
  outputFileName: string;
  scheduleEnabled?: boolean;
  scheduleTrigger?: { kind: string; [key: string]: unknown };
  autoRunApproved?: boolean;
}

export interface LoopRunView {
  id: string;
  loopId: string;
  status: LoopRunStatus;
  trigger: { kind: string; [key: string]: unknown };
  evidenceIds: string[];
  startedAt: number;
  finishedAt?: number;
  updatedAt: number;
  failureKind?: string;
  message?: string;
  summary?: string;
  nextActionKind?: string;
  nextActionSummary?: string;
}

export interface EvidenceAnomalyView {
  id: string;
  loopId: string;
  ownerKind: string;
  ownerId: string;
  kind: string;
  status: EvidenceAnomalyStatus;
  firstSeenAt: number;
  lastSeenAt: number;
  lastResolvedAt?: number;
  seenCount: number;
  ignoredUntil?: number;
  message: string;
  evidenceIds: string[];
  metadata: Record<string, unknown>;
}

export type RunLoopNowResultView =
  | { status: 'success'; run: LoopRunView }
  | { status: 'blocked'; run: LoopRunView }
  | { status: 'failed'; run: LoopRunView }
  | { status: 'already_running'; activeRunId: string }
  | { status: 'skipped'; reason: 'paused' | 'missing_loop' };

export interface UploadedThreadAttachment { id: string; fileName: string; fileSize: number }
