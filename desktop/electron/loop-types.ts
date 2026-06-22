export const BUILT_IN_LOOP_IDS = {
  ARTIFACT_EVIDENCE_REGRESSION: 'artifact-evidence-regression',
  KSWARM_SERVICE_HEALTH: 'kswarm-service-health',
} as const;

export type BuiltInLoopId = typeof BUILT_IN_LOOP_IDS[keyof typeof BUILT_IN_LOOP_IDS];

export type LoopDefinitionOrigin = 'built_in' | 'user_template';
export type LoopDefinitionStatus = 'active' | 'paused' | 'deleted';

export type LoopRunStatus = 'running' | 'success' | 'failed' | 'blocked';

export type LoopStageStatus = 'pending' | 'running' | 'success' | 'failed' | 'blocked' | 'skipped';
export type LoopStageKind = 'scan' | 'execute' | 'verify';
export type UserLoopTemplateKind = 'markdown_file' | 'task_completion';

export type LoopRunFailureKind =
  | 'executor_crash'
  | 'executor_failed'
  | 'validation_failed'
  | 'evidence_missing'
  | 'evidence_kind_mismatch'
  | 'unknown';

export type LoopRunTrigger = {
  kind: string;
  [key: string]: unknown;
};

export interface LoopDefinition {
  id: string;
  title: string;
  description: string;
  status: LoopDefinitionStatus;
  origin: LoopDefinitionOrigin;
  activeRunId?: string;
  deletedAt?: number;
  deleteReason?: string;
  createdAt: number;
  updatedAt: number;
}

export interface UserLoopTemplate {
  loopId: string;
  kind: UserLoopTemplateKind;
  prompt: string;
  outputDirectory: string;
  outputFileName: string;
  scheduleActionId?: string;
  scheduleEnabled: boolean;
  scheduleTrigger?: Record<string, unknown>;
  autoRunApproved: boolean;
  createdAt: number;
  updatedAt: number;
}

interface CreateLoopInputBase {
  loopId: string;
  title: string;
  description?: string;
  prompt: string;
  scheduleEnabled?: boolean;
  scheduleTrigger?: Record<string, unknown>;
  autoRunApproved?: boolean;
  now: number;
}

export interface CreateMarkdownFileLoopInput extends CreateLoopInputBase {
  kind: 'markdown_file';
  outputDirectory: string;
  outputFileName: string;
}

export interface CreateTaskCompletionLoopInput extends CreateLoopInputBase {
  kind: 'task_completion';
  outputDirectory?: string;
  outputFileName?: string;
}

export type CreateUserLoopTemplateInput = CreateMarkdownFileLoopInput | CreateTaskCompletionLoopInput;

export type IgnoredLegacyScheduleField = 'scheduleEnabled' | 'scheduleTrigger' | 'autoRunApproved';

export interface CreateUserLoopTemplateResult {
  template: UserLoopTemplate;
  ignoredLegacyScheduleFields: IgnoredLegacyScheduleField[];
}

export interface LoopRun {
  id: string;
  loopId: string;
  status: LoopRunStatus;
  trigger: LoopRunTrigger;
  evidenceIds: string[];
  startedAt: number;
  finishedAt?: number;
  updatedAt: number;
  failureKind?: LoopRunFailureKind;
  message?: string;
  summary?: string;
  nextActionKind?: string;
  nextActionSummary?: string;
}

export interface LoopStage {
  id: string;
  runId: string;
  loopId: string;
  stageKind: LoopStageKind;
  status: LoopStageStatus;
  evidenceIds: string[];
  startedAt?: number;
  finishedAt?: number;
  summary?: string;
  failureKind?: LoopRunFailureKind;
  message?: string;
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export type BeginLoopRunResult =
  | { status: 'started'; run: LoopRun }
  | { status: 'already_running'; activeRunId: string }
  | { status: 'skipped'; reason: 'paused' | 'missing_loop' | 'deleted_loop' };

export type RecoverStaleRunsResult =
  | { ok: true; recovered: number; failedRunIds: string[] }
  | { ok: false; recovered: number; failedRunIds: string[]; error: string; partial: boolean };

export type LearnedConstraintSource = 'llm_extraction' | 'rule_extraction' | 'user_manual';

export type DeactivationReason = 'user' | 'stale' | 'ineffective' | 'overflow' | 'superseded';

export interface LearnedConstraint {
  id: string;
  loopId: string;
  source: LearnedConstraintSource;
  rule: string;
  sourceRunId: string;
  failureKind: string | null;
  failureReason: string | null;
  active: boolean;
  hitCount: number;
  consecutiveIneffectiveCount: number;
  createdAt: number;
  updatedAt: number;
  lastHitAt: number | null;
  supersededBy: string | null;
  deactivationReason: DeactivationReason | null;
  extractionContext: string | null;
}
