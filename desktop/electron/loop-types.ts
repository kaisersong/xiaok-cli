export const BUILT_IN_LOOP_IDS = {
  ARTIFACT_EVIDENCE_REGRESSION: 'artifact-evidence-regression',
  KSWARM_SERVICE_HEALTH: 'kswarm-service-health',
} as const;

export type BuiltInLoopId = typeof BUILT_IN_LOOP_IDS[keyof typeof BUILT_IN_LOOP_IDS];

export type LoopDefinitionStatus = 'active' | 'paused';

export type LoopRunStatus = 'running' | 'success' | 'failed' | 'blocked';

export type LoopStageStatus = 'pending' | 'running' | 'success' | 'failed' | 'blocked' | 'skipped';
export type LoopStageKind = 'scan';

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
  activeRunId?: string;
  createdAt: number;
  updatedAt: number;
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
  | { status: 'skipped'; reason: 'paused' | 'missing_loop' };
