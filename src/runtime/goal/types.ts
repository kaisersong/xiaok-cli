import type {
  CompletionEvidenceRecord,
  CompletionKind,
} from '../guards/completion-evidence.js';

export const DEFAULT_GOAL_TURN_LIMIT = 20;
export const MAX_GOAL_TURN_LIMIT = 50;

export type GoalStatus = 'active' | 'paused' | 'blocked' | 'complete' | 'cancelled';
export type GoalRequestSource = 'user' | 'agent' | 'runtime';
export type GoalActivation = 'armed' | 'disarmed';

export type GoalEvidenceKind = Extract<
  CompletionKind,
  'answer' | 'file_artifact' | 'command_action' | 'project_update'
>;

export interface GoalBudgetLimits {
  turnLimit: number;
  tokenLimit?: number;
  activeWallClockLimitMs?: number;
}

export interface GoalInput {
  objective: string;
  completionCriterion?: string;
  expectedEvidenceKinds: GoalEvidenceKind[];
  turnLimit?: number;
}

export interface GoalState {
  goalId: string;
  revision: number;
  epoch: number;
  sessionId: string;
  forkedFromGoalId?: string;
  objective: string;
  completionCriterion?: string;
  expectedEvidenceKinds: GoalEvidenceKind[];
  status: GoalStatus;
  turnsUsed: number;
  tokensUsed: number;
  activeWallClockMs: number;
  budgetLimits: GoalBudgetLimits;
  terminalReason?: string;
  blockerFingerprint?: string;
  consecutiveBlockedTurns: number;
  createdAt: number;
  updatedAt: number;
}

export interface GoalRef {
  goalId: string;
  revision: number;
}

export interface GoalMutationContext {
  sessionId: string;
  instanceId: string;
  requestSource: GoalRequestSource;
  expectedRevision: number | null;
}

export interface GoalTurnRecord {
  goalId: string;
  epoch: number;
  turnId: string;
  tokensUsed: number;
  activeWallClockMs: number;
  recordedAt: number;
}

export interface GoalEvidenceEnvelope {
  goalId: string;
  epoch: number;
  goalTurnId: string;
  evidenceId: string;
  record: CompletionEvidenceRecord;
  recordedAt: number;
}

export interface GoalEvent {
  eventId: string;
  goalId: string;
  revision: number;
  type: string;
  actor: GoalRequestSource;
  recordedAt: number;
  reason?: string;
}

export interface GoalDocument {
  state: GoalState;
  events: GoalEvent[];
  turns: GoalTurnRecord[];
  evidence: GoalEvidenceEnvelope[];
}

export interface GoalCommitInput {
  sessionId: string;
  expectedRevision: number | null;
  next: GoalState;
  events: GoalEvent[];
  turns: GoalTurnRecord[];
  evidence: GoalEvidenceEnvelope[];
}

export interface GoalStore {
  load(sessionId: string): Promise<GoalDocument | null>;
  commit(input: GoalCommitInput): Promise<void>;
}

export interface GoalOwnershipPort {
  assertOwned(sessionId: string, instanceId: string): void | Promise<void>;
}
