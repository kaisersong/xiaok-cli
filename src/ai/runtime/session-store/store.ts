import type { Message, UsageStats } from '../../../types.js';
import type { CompactionRecord } from '../session.js';
import type { SessionIntentLedger } from '../../../runtime/intent-delegation/types.js';
import type { SessionSkillEvalState } from '../../../runtime/intent-delegation/skill-eval.js';
import type { SessionSkillExecutionState } from '../../skills/execution-state.js';

export interface PersistedSessionSnapshot {
  sessionId: string;
  cwd: string;
  model?: string;
  createdAt: number;
  updatedAt: number;
  forkedFromSessionId?: string;
  lineage: string[];
  messages: Message[];
  usage: UsageStats;
  compactions: CompactionRecord[];
  promptSnapshotId?: string;
  memoryRefs: string[];
  approvalRefs: string[];
  backgroundJobRefs: string[];
  intentDelegation?: SessionIntentLedger;
  skillEval?: SessionSkillEvalState;
  skillExecution?: SessionSkillExecutionState;
}

export interface SessionListEntry {
  sessionId: string;
  cwd: string;
  updatedAt: number;
  preview: string;
}

export interface SessionStore {
  save(snapshot: PersistedSessionSnapshot): Promise<void>;
  load(sessionId: string): Promise<PersistedSessionSnapshot | null>;
  loadLast(): Promise<PersistedSessionSnapshot | null>;
  list(): Promise<SessionListEntry[]>;
  fork(sessionId: string): Promise<PersistedSessionSnapshot>;
}
