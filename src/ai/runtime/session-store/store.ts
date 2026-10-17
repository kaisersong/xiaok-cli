import type { StoredSessionSnapshot } from './stored-snapshot-types.js';
export type { StoredSessionSnapshot } from './stored-snapshot-types.js';
import { validateCompoundOperationLedger, mergeCompoundOperationLedgers, type CompoundOperationLedger } from '../../../runtime/sol-pi/compound-operation.js';
import { isDeepStrictEqual } from 'node:util';
import { validateSemanticCompactionLedger, mergeSemanticCompactionLedgers, type SemanticCompactionLedger } from '../../../runtime/sol-pi/semantic-compaction-ledger.js';
import { createHash } from 'node:crypto';
import type { SessionExecutionLease } from './execution-authority.js';
import { mergeProtectedObservationClosures, type ProtectedObservationClosure } from '../protected-observation-closure.js';
import type { Message, MessageBlock, UsageStats } from '../../../types.js';
import type { CompactionRecord } from '../session.js';
import type { SessionIntentLedger } from '../../../runtime/intent-delegation/types.js';
import type { SessionSkillEvalState } from '../../../runtime/intent-delegation/skill-eval.js';
import type { SessionSkillExecutionState } from '../../skills/execution-state.js';

export interface PersistedSessionSnapshot {
  semanticCompaction?: SemanticCompactionLedger;
  compoundOperations?: CompoundOperationLedger;
  storeRevision?: number;
  historyDigest?: string;
  executionProtected?: true;
  protectedObservationClosure?: ProtectedObservationClosure;
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

export const KIMI_K3_DURABLE_RESUME_UNSUPPORTED =
  'KIMI_K3_DURABLE_RESUME_UNSUPPORTED';

export class KimiK3DurableResumeUnsupportedError extends Error {
  readonly code = KIMI_K3_DURABLE_RESUME_UNSUPPORTED;

  constructor() {
    super(KIMI_K3_DURABLE_RESUME_UNSUPPORTED);
    this.name = 'KimiK3DurableResumeUnsupportedError';
  }
}

export function isKimiK3DurableModel(
  model: string | undefined,
): model is 'k3' | 'k3-256k' {
  return model === 'k3' || model === 'k3-256k';
}

export function toDurableSessionSnapshot(snapshot: PersistedSessionSnapshot): PersistedSessionSnapshot;
export function toDurableSessionSnapshot(snapshot: StoredSessionSnapshot): StoredSessionSnapshot;
export function toDurableSessionSnapshot(snapshot: StoredSessionSnapshot): StoredSessionSnapshot {
  const messages = structuredClone(snapshot.messages);
  const strictKimiModel = isKimiK3DurableModel(snapshot.model);

  return {
    ...snapshot,
    compoundOperations: snapshot.compoundOperations === undefined ? undefined : validateCompoundOperationLedger(snapshot.compoundOperations),
    semanticCompaction: snapshot.semanticCompaction === undefined ? undefined : validateSemanticCompactionLedger(snapshot.semanticCompaction),
    protectedObservationClosure: mergeProtectedObservationClosures(undefined, snapshot.protectedObservationClosure),
    messages: messages.map((message) => ({
      ...message,
      content: message.content.flatMap((block) => {
        const officialKimiReasoning = block.type === 'thinking'
          && block.reasoningProvenance?.captureVersion === 1
          && block.reasoningProvenance.source === 'reasoning_content';
        if (
          block.type === 'thinking'
          && (strictKimiModel || officialKimiReasoning)
        ) {
          return [];
        }
        if (!strictKimiModel) {
          return [block];
        }
        const durableBlock = block as MessageBlock & {
          reasoningProvenance?: unknown;
        };
        delete durableBlock.reasoningProvenance;
        return [durableBlock];
      }),
    })),
  };
}

export function assertKimiK3DurableResumeSupported(
  snapshot: PersistedSessionSnapshot,
): void;
export function assertKimiK3DurableResumeSupported(
  snapshot: StoredSessionSnapshot,
): void;
export function assertKimiK3DurableResumeSupported(
  snapshot: Pick<StoredSessionSnapshot, 'model' | 'messages'>,
): void;
export function assertKimiK3DurableResumeSupported(
  snapshot: Pick<StoredSessionSnapshot, 'model' | 'messages'>,
): void {
  if (
    isKimiK3DurableModel(snapshot.model)
    && snapshot.messages.some((message) => message.role === 'assistant')
  ) {
    throw new KimiK3DurableResumeUnsupportedError();
  }
}

export function assertKimiK3TargetResumeSupported(
  strictKimiTarget: boolean,
  snapshot: PersistedSessionSnapshot,
): void;
export function assertKimiK3TargetResumeSupported(
  strictKimiTarget: boolean,
  snapshot: StoredSessionSnapshot,
): void;
export function assertKimiK3TargetResumeSupported(
  strictKimiTarget: boolean,
  snapshot: Pick<StoredSessionSnapshot, 'model' | 'messages'>,
): void;
export function assertKimiK3TargetResumeSupported(
  strictKimiTarget: boolean,
  snapshot: Pick<StoredSessionSnapshot, 'model' | 'messages'>,
): void {
  if (
    (strictKimiTarget || isKimiK3DurableModel(snapshot.model))
    && snapshot.messages.some((message) => message.role === 'assistant')
  ) {
    throw new KimiK3DurableResumeUnsupportedError();
  }
}

export interface SessionCompareAndSave {
  beforeCommit?: () => void;
  expectedStoreRevision: number;
  expectedHistoryDigest: string;
  nextSnapshot: PersistedSessionSnapshot;
  lease: SessionExecutionLease;
}
export interface SessionCommitReceipt { storeRevision: number; historyDigest: string }
export function computeSessionHistoryDigest(snapshot: Pick<StoredSessionSnapshot, 'messages'>): string {
  return createHash('sha256').update(JSON.stringify(snapshot.messages)).digest('hex');
}
export function prepareSessionStoreCommit(previous: StoredSessionSnapshot | null, next: PersistedSessionSnapshot, cas?: SessionCompareAndSave, forkSource?: StoredSessionSnapshot): PersistedSessionSnapshot;
export function prepareSessionStoreCommit(previous: StoredSessionSnapshot | null, next: StoredSessionSnapshot, cas?: SessionCompareAndSave, forkSource?: StoredSessionSnapshot): StoredSessionSnapshot;
export function prepareSessionStoreCommit(previous: StoredSessionSnapshot | null, next: StoredSessionSnapshot, cas?: SessionCompareAndSave, forkSource?: StoredSessionSnapshot): StoredSessionSnapshot {
  const revision = previous?.storeRevision ?? 0;
  if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) throw Error('session_store_revision_invalid');
  if (cas && (cas.expectedStoreRevision !== revision || cas.expectedHistoryDigest !== computeSessionHistoryDigest(previous ?? { messages: [] }))) throw Error('session_store_cas_conflict');
  if (!cas && previous?.executionProtected && next.storeRevision !== revision) throw Error('session_store_stale_save');
  if (!cas && previous?.executionProtected && next.historyDigest !== previous.historyDigest) throw Error('session_store_stale_history');
  if (!cas && next.executionProtected !== undefined && next.executionProtected !== previous?.executionProtected && next.executionProtected !== forkSource?.executionProtected) throw Error('session_execution_marker_requires_cas');
  if (forkSource && (previous || next.forkedFromSessionId !== forkSource.sessionId || computeSessionHistoryDigest(next) !== computeSessionHistoryDigest(forkSource) || !isDeepStrictEqual(next.semanticCompaction, forkSource.semanticCompaction) || !isDeepStrictEqual(next.compoundOperations, forkSource.compoundOperations))) throw Error('session_fork_source_changed');
  if (!cas && !forkSource && next.semanticCompaction !== undefined && !isDeepStrictEqual(previous?.semanticCompaction, next.semanticCompaction)) throw Error('semantic_compaction_requires_cas');
  if (!cas && !forkSource && next.compoundOperations !== undefined && !isDeepStrictEqual(previous?.compoundOperations, next.compoundOperations)) throw Error('compound_operation_requires_cas');
  const compoundOperations = cas ? mergeCompoundOperationLedgers(previous?.compoundOperations, next.compoundOperations) : (forkSource?.compoundOperations ?? previous?.compoundOperations);
  const semanticCompaction = cas ? mergeSemanticCompactionLedgers(previous?.semanticCompaction, next.semanticCompaction) : (forkSource?.semanticCompaction ?? previous?.semanticCompaction);
  const durable = toDurableSessionSnapshot({ ...next, semanticCompaction, compoundOperations });
  return { ...durable, storeRevision: revision + 1, historyDigest: computeSessionHistoryDigest(durable),
    ...(previous?.executionProtected || cas ? { executionProtected: true as const } : {}) };
}

/** Host notifications report durable facts; exceptions propagate without rolling back commits. */
export class SessionCommitNotifications {
  private readonly listeners = new Set<(snapshot: PersistedSessionSnapshot) => void>();
  subscribe(listener: (snapshot: PersistedSessionSnapshot) => void): () => void {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  }
  publish(snapshot: PersistedSessionSnapshot): void {
    for (const listener of [...this.listeners]) assertSynchronousSessionHook(() => listener(structuredClone(snapshot)));
  }
}
export function assertSynchronousSessionHook(hook?: () => void): void {
  if (!hook) return;
  const result: unknown = hook();
  if (result !== undefined) {
    if (result && (typeof result === 'object' || typeof result === 'function') && typeof (result as {then?: unknown}).then === 'function') {
      void Promise.resolve(result).catch(() => {});
    }
    throw Error('session_commit_hook_must_be_synchronous');
  }
}

export interface SessionStore {
  assertIntentNativeLease?(sessionId:string,requestSource:'user'|'scheduler',lease:SessionExecutionLease):void;
  getIntentNativeLedgerSync?(sessionId:string):import('../../../runtime/intent-delegation/types.js').SessionIntentLedger|undefined;
  getIntentNativeLedger?(sessionId:string):Promise<import('../../../runtime/intent-delegation/types.js').SessionIntentLedger|undefined>;
  retryIntentPublicationApplication?(input:import('../../../runtime/intent-delegation/publication-candidate-journal.js').RetryIntentPublicationInput&{lease:SessionExecutionLease}):Promise<import('../../../runtime/intent-delegation/publication-candidate-journal.js').IntentPublicationCandidate>;
  observeIntentPublicationApplication?(input:import('../../../runtime/intent-delegation/publication-candidate-journal.js').ObserveIntentPublicationInput&{lease:SessionExecutionLease}):Promise<import('../../../runtime/intent-delegation/publication-candidate-journal.js').IntentPublicationCandidate>;
  claimIntentPublicationApplication?(input:import('../../../runtime/intent-delegation/publication-candidate-journal.js').ClaimIntentPublicationInput&{lease:SessionExecutionLease}):Promise<import('../../../runtime/intent-delegation/publication-candidate-journal.js').IntentPublicationCandidate>;
  recordIntentReceiverPublication?(input:import('../../../runtime/intent-delegation/receiver-publication-host.js').IntentReceiverWriteInput):Promise<import('../../../runtime/intent-delegation/publication-candidate-journal.js').IntentPublicationCandidate>;
  recordIntentVerificationOperation?(input:import('../../../runtime/intent-delegation/verification-execution-journal.js').RecordIntentVerificationOperationInput&{lease:SessionExecutionLease}):Promise<import('../../../runtime/intent-delegation/verification-execution-journal.js').IntentVerificationExecution>;
  observeIntentVerificationEnrollment?(input:import('../../../runtime/intent-delegation/verification-execution-journal.js').ObserveIntentVerificationInput&{lease:SessionExecutionLease}):Promise<import('../../../runtime/intent-delegation/verification-execution-journal.js').IntentVerificationExecution>;
  claimIntentVerificationEnrollment?(input:import('../../../runtime/intent-delegation/verification-execution-journal.js').ClaimIntentVerificationInput&{lease:SessionExecutionLease}):Promise<import('../../../runtime/intent-delegation/verification-execution-journal.js').IntentVerificationExecution>;
  reserveIntentVerificationExecution?(input:import('../../../runtime/intent-delegation/verification-execution-journal.js').ReserveIntentVerificationInput&{lease:SessionExecutionLease}):Promise<import('../../../runtime/intent-delegation/verification-execution-journal.js').IntentVerificationExecution>;
  reserveIntentParentPublicationCandidate?(input:import('../../../runtime/intent-delegation/publication-host.js').IntentParentCandidateWrite):Promise<import('../../../runtime/intent-delegation/publication-candidate-journal.js').IntentPublicationCandidate>;
  reserveIntentPublicationCandidate?(input:import('../../../runtime/intent-delegation/publication-candidate-journal.js').ReserveIntentPublicationInput&{lease:SessionExecutionLease}):Promise<import('../../../runtime/intent-delegation/publication-candidate-journal.js').IntentPublicationCandidate>;
  reserveIntentNativeContract?(input:import('../../../runtime/intent-delegation/native-contract-journal.js').ReserveIntentNativeInput&{lease:SessionExecutionLease}):Promise<import('../../../runtime/intent-delegation/native-contract-journal.js').IntentNativeContractRecord>;
  advanceIntentNativeContractSubject?(input:import('../../../runtime/intent-delegation/native-contract-journal.js').AdvanceIntentNativeInput&{lease:SessionExecutionLease}):Promise<import('../../../runtime/intent-delegation/native-contract-journal.js').IntentNativeContractRecord>;
  retryIntentNativeContractSubject?(input:import('../../../runtime/intent-delegation/native-contract-journal.js').RetryIntentNativeInput&{lease:SessionExecutionLease}):Promise<import('../../../runtime/intent-delegation/native-contract-journal.js').IntentNativeContractRecord>;
  transitionIntentSessionOwnership?(input:import('../../../runtime/intent-delegation/native-contract-journal.js').IntentOwnershipInput&{lease:SessionExecutionLease}):Promise<void>;

  recordIntentProducerAction?(input:import('../../../runtime/intent-delegation/producer-facts.js').IntentProducerActionInput&{lease:SessionExecutionLease}):Promise<void>;
  recordIntentExecutionTerminal?(input: import('../../../runtime/intent-delegation/intent-commit-boundary.js').IntentExecutionTerminalInput & {lease:SessionExecutionLease}):Promise<void>;
  onCommit?(listener: (snapshot: PersistedSessionSnapshot) => void): () => void;
  compareAndSave?(input: SessionCompareAndSave): Promise<SessionCommitReceipt>;
  save(snapshot: PersistedSessionSnapshot, options?: { lease?: SessionExecutionLease }): Promise<void>;
  load(sessionId: string): Promise<PersistedSessionSnapshot | null>;
  loadSync?(sessionId: string): PersistedSessionSnapshot | null;
  loadLast(): Promise<PersistedSessionSnapshot | null>;
  list(): Promise<SessionListEntry[]>;
  fork(sessionId: string): Promise<PersistedSessionSnapshot>;
}
