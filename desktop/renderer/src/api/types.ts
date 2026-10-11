import type {ScheduledActionDto,ScheduledBindingDto,ScheduledLoopCreateDto} from '../../../shared/scheduled-timed-action-ipc-contract.js';
export type { ScheduledTaskDto, ScheduledCreateDto, ScheduledUpdateDto, ScheduledUpdateResultDto, ScheduledActionDto, ScheduledRunDto, ScheduledBindingDto, ScheduledLoopCreateDto, ScheduledReminderDto, ScheduledReminderStatusDto } from '../../../shared/scheduled-timed-action-ipc-contract.js';
export type { KnowledgeCollectionDto, KnowledgeSourceDto, KnowledgeCreateCollectionInput, KnowledgeAddSourceInput, KnowledgeCollectionStateDto, KnowledgeSourceContentInput, KnowledgeSourceContentDto, KnowledgeSearchInput, KnowledgeSearchResultDto } from '../../../shared/knowledge-ipc-contract.js';
export type { ProjectPrincipleDto as ProjectPrinciple, PrincipleSaveInput, PrincipleSaveResult, PrincipleDeleteResult } from '../../../shared/principles-ipc-contract.js';
import type { LoopCreateTemplateDto, LoopTemplatePatchDto, LoopDefinitionDto, UserLoopTemplateDto, CreateLoopTemplateResultDto, LoopConstraintDto, LoopAnomalyDto, LoopManagementRunResultDto } from '../../../shared/loop-management-ipc-contract.js';
export type { RoomCreateInput, RoomArchiveInput, RoomDeleteInput, RoomMembersInput, RoomSendInput, RoomSeenInput, RoomCancelInput, RoomProjectCreateInput, RoomTaskCreateInput, RoomListResultDto, RoomSnapshotDto, RoomCreateResultDto, RoomArchiveResultDto, RoomDeleteResultDto, RoomMembersResultDto, RoomSendResultDto, RoomSeenResultDto, RoomCancelResultDto, RoomProjectCreateResultDto, RoomTaskCreateResultDto } from '../../../shared/collaboration-room-ipc-contract.js';
export type {LoopArtifactPageRequest,LoopArtifactListView} from '../../../shared/loop-artifacts.js';
import type {LoopCompletionObservation} from '../../../shared/loop-current-view-types';
export type {LoopPublicationActionDto as LoopPublicationAction,LoopPublicationActionResultDto as LoopPublicationActionResult,LoopPublicationStateDto as LoopPublicationStateView,StoredLoopPublicationConfigurationDto as StoredLoopPublicationConfiguration} from '../../../shared/loop-publication-ipc-contract.js';
export type { GoalAttachmentRequest, GoalAttachmentSource } from '../../../shared/goal-attachment';
export type {
  ArtifactWorkspaceEventName,
  ArtifactWorkspaceFeatureAccess,
  ArtifactWorkspaceLayoutPatch,
  ArtifactWorkspaceNode,
  ArtifactWorkspacePreview,
  ArtifactWorkspaceRelation,
  ArtifactWorkspaceRelationKind,
  ArtifactWorkspaceRequestedKind,
  ArtifactWorkspaceSelectedArtifact,
  ArtifactWorkspaceSnapshot,
  ArtifactWorkspaceVersionView,
  WorkspaceGenerationRequest,
} from '../../../shared/artifact-workspace-types';
export type {
  ArtifactWorkspaceIpcError,
  ArtifactWorkspaceIpcResult,
  ArtifactWorkspaceIdentityInput,
  ArtifactWorkspaceVersionInput,
  CancelArtifactGenerationInput,
  CreateArtifactPlaceholderInput,
  CreateArtifactWorkspaceCollectionInput,
  CreateArtifactWorkspaceNoteInput,
  CreateArtifactWorkspaceRelationInput,
  GetArtifactWorkspaceSnapshotInput,
  PreferArtifactVersionInput,
  RecordArtifactWorkspaceEventInput,
  RemoveArtifactWorkspaceNodeInput,
  RetryArtifactGenerationInput,
  SaveArtifactWorkspaceViewportInput,
  SetArtifactCollectionMembershipInput,
  SubmitArtifactGenerationInput,
  UpdateArtifactWorkspaceLayoutInput,
  UpdateArtifactWorkspaceNoteInput,
} from '../../../electron/preload-api';
export type {
  AssistantOverviewView,
  CreateKSwarmProjectSemanticInput,
  KSwarmAgentSemanticInput,
  ProjectTeamOperationView,
  ProjectTeamPlanItemView,
  ProjectTeamPlanView,
} from '../../../electron/preload-api';

// Thread types (local storage + desktop web-client compatibility)
export type ThreadMode = 'chat' | 'work';
export type CollaborationMode = ThreadMode;
export type ThreadGtdBucket = 'inbox' | 'todo' | 'waiting' | 'someday' | 'archived';

export interface ThreadRecord {
  /** Local association reservation only; main owns execution/deletion status. */
  deletionPending?: boolean;
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
export type ConnectorsSearchProvider = 'duckduckgo' | 'tavily' | 'brave' | 'firecrawl' | 'searxng';
export type ConnectorsFetchProvider = 'basic' | 'jina' | 'firecrawl';
export type ConnectorsConfig = import('../../../shared/connectors-ipc-contract.js').ConnectorsConfigDto;
export type ConnectorsLoadStatus = 'ok' | 'missing' | 'parse_failed';
export type ConnectorsProviderRuntime = import('../../../shared/connectors-ipc-contract.js').ConnectorsRuntimeDto;
export type ConnectorsConfigSnapshot = import('../../../shared/connectors-ipc-contract.js').ConnectorsSnapshotDto;
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

export type LoopDefinitionStatus = 'active' | 'paused' | 'deleted';
export type LoopDefinitionOrigin = 'built_in' | 'user_template';
export type LoopRunStatus = 'running' | 'success' | 'failed' | 'blocked';
export type EvidenceAnomalyStatus = 'open' | 'resolved' | 'ignored';

export type LoopDefinitionView = LoopDefinitionDto;

export type UserLoopTemplateKind = 'markdown_file' | 'task_completion';

export type UserLoopTemplateView = UserLoopTemplateDto;

export type CreateUserLoopTemplateInputView = LoopCreateTemplateDto;

export type CreateUserLoopTemplateResultView = CreateLoopTemplateResultDto;

export type CreateLoopScheduleInputView = ScheduledLoopCreateDto;

export type LoopScheduleBindingView = ScheduledBindingDto;

export type TimedActionView = ScheduledActionDto;

export type AutomationsConfigView = import('../../../shared/automation-config-ipc-contract.js').AutomationConfigDto;
export type AutomationOverviewSnapshotView = import('../../../shared/automation-config-ipc-contract.js').AutomationOverviewDto;
export type AutomationRecentFailureItemView = AutomationOverviewSnapshotView['recentFailures'][number];
export type AutomationRecentFailureSourceView = AutomationRecentFailureItemView['source'];

export type AutomationRunHistoryItemView = import('../../../shared/loop-current-view-ipc-contract.js').AutomationRunHistoryDto;

export type {LoopOutputActionResultView,LoopOutputPreviewView,LoopTaskResultView} from '../../../shared/loop-output-ipc-contract.js';

export type LoopRunView = import('../../../shared/loop-current-view-ipc-contract.js').LoopRunObservationDto;

export type EvidenceAnomalyView = LoopAnomalyDto;

export type RunLoopNowResultView = LoopManagementRunResultDto;

export interface UploadedThreadAttachment { id: string; fileName: string; fileSize: number }

export type LearnedConstraintSourceView = 'llm_extraction' | 'rule_extraction' | 'user_manual';
export type LearnedConstraintDeactivationReasonView = 'user' | 'stale' | 'ineffective' | 'overflow' | 'superseded';

export type LearnedConstraintView = LoopConstraintDto;

export type { AssistantProfileDto, AssistantCandidateDto, AssistantAcceptResultDto, AssistantOverviewDto } from '../../../shared/assistant-ipc-contract';

export type { ProjectTeamPlanItemDto, ProjectTeamPlanDto, ProjectTeamOperationDto } from '../../../shared/kswarm-team-ipc-contract';

export type { KSwarmProjectFactDto, KSwarmProjectModeResultDto, KSwarmProjectDeleteResultDto, KSwarmAgentFactDto, KSwarmProbeFactDto, KSwarmProjectCreateDto, KSwarmAgentCreateDto } from '../../../shared/kswarm-project-agent-ipc-contract';

export type { ProxyJsonResult, ProxyTextResult, ProxyDeleteResult, ProxyHttpBody, ProxyStreamResult, ProxyStatusResult, ProxyHealthResult } from '../../../shared/kswarm-proxy-ipc-contract';

export type { ModelConfigResult, SaveModelConfigInput, UpdateModelRuntimeInput, SystemOneConfigResult, SystemOneConfigPatch, ManagedAgentInput, ManagedAgentResult, ProviderConnectionInput, ProviderConnectionResult, AvailableModelResult } from '../../../shared/model-provider-ipc-contract.js';
