import { validateSemanticCompactionLedger, mergeSemanticCompactionLedgers, type SemanticCompactionLedger } from '../../runtime/sol-pi/semantic-compaction-ledger.js';
import { validateCompoundOperationLedger, mergeCompoundOperationLedgers, type CompoundOperationLedger } from '../../runtime/sol-pi/compound-operation.js';
import { mergeProtectedObservationClosures, type ProtectedObservationClosure, type ProtectedObservationReference } from './protected-observation-closure.js';
import type { Message, MessageBlock, UsageStats } from '../../types.js';

export interface CompactionRecord {
  id: string;
  createdAt: number;
  summary: string;
  replacedMessages: number;
}

export interface SessionGraphSnapshot {
  compoundOperations?: CompoundOperationLedger;
  semanticCompaction?: SemanticCompactionLedger;
  storeRevision?: number;
  historyDigest?: string;
  executionProtected?: true;
  protectedObservationClosure?: ProtectedObservationClosure;
  sessionId: string;
  cwd: string;
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
}

export class AgentSessionGraph {
  private snapshot: SessionGraphSnapshot;
  private revision = 0;

  constructor(
    snapshot: Partial<SessionGraphSnapshot> & Pick<SessionGraphSnapshot, 'sessionId' | 'cwd' | 'createdAt' | 'updatedAt' | 'lineage'>,
  ) {
    this.snapshot = {
      ...snapshot,
      compoundOperations: snapshot.compoundOperations === undefined ? undefined : validateCompoundOperationLedger(snapshot.compoundOperations),
      semanticCompaction: snapshot.semanticCompaction === undefined ? undefined : validateSemanticCompactionLedger(snapshot.semanticCompaction),
      protectedObservationClosure: mergeProtectedObservationClosures(undefined, snapshot.protectedObservationClosure),
      messages: snapshot.messages ?? [],
      usage: snapshot.usage ?? { inputTokens: 0, outputTokens: 0 },
      compactions: snapshot.compactions ?? [],
      memoryRefs: snapshot.memoryRefs ?? [],
      approvalRefs: snapshot.approvalRefs ?? [],
      backgroundJobRefs: snapshot.backgroundJobRefs ?? [],
    };
  }

  addProtectedObservationReferences(observations: ProtectedObservationReference[]): void {
    this.snapshot.protectedObservationClosure = mergeProtectedObservationClosures(this.snapshot.protectedObservationClosure, { version: 1, requiresReauthorization: true, observations });
    this.touch();
  }

  getProtectedObservationClosure(): ProtectedObservationClosure | undefined {
    return mergeProtectedObservationClosures(undefined, this.snapshot.protectedObservationClosure);
  }

  getMessages(): Message[] {
    return structuredClone(this.snapshot.messages);
  }

  getUsage(): UsageStats {
    return this.snapshot.usage;
  }

  getCompactions(): CompactionRecord[] {
    return this.snapshot.compactions;
  }

  getRevision(): number {
    return this.revision;
  }

  updateUsage(next: UsageStats): UsageStats {
    this.snapshot.usage = next;
    this.touch();
    return this.snapshot.usage;
  }

  appendUserText(text: string): void {
    this.appendUserBlocks([{ type: 'text', text }]);
  }

  appendUserBlocks(blocks: MessageBlock[]): void {
    this.snapshot.messages.push({
      role: 'user',
      content: blocks,
    });
    this.touch();
  }

  appendAssistantBlocks(blocks: MessageBlock[]): void {
    if (blocks.length === 0) {
      return;
    }
    this.snapshot.messages.push({
      role: 'assistant',
      content: blocks,
    });
    this.touch();
  }

  appendUserToolResults(blocks: MessageBlock[]): void {
    if (blocks.length === 0) {
      return;
    }
    this.snapshot.messages.push({
      role: 'user',
      content: blocks,
    });
    this.touch();
  }

  replaceMessages(messages: Message[]): void {
    this.snapshot.messages = messages;
    this.touch();
  }

  replaceUsage(usage: UsageStats): void {
    this.snapshot.usage = usage;
    this.touch();
  }

  replaceCompactions(compactions: CompactionRecord[]): void {
    this.snapshot.compactions = compactions;
    this.touch();
  }

  recordCompaction(compaction: CompactionRecord): void {
    this.snapshot.compactions.push(compaction);
    this.touch();
  }

  attachPromptSnapshot(promptSnapshotId: string, memoryRefs: string[]): void {
    this.snapshot.promptSnapshotId = promptSnapshotId;
    this.snapshot.memoryRefs = [...memoryRefs];
    this.touch();
  }

  recordApproval(approvalId: string): void {
    if (!this.snapshot.approvalRefs.includes(approvalId)) {
      this.snapshot.approvalRefs.push(approvalId);
      this.touch();
    }
  }

  recordBackgroundJob(jobId: string): void {
    if (!this.snapshot.backgroundJobRefs.includes(jobId)) {
      this.snapshot.backgroundJobRefs.push(jobId);
      this.touch();
    }
  }

  exportSnapshot(): SessionGraphSnapshot {
    return structuredClone(this.snapshot);
  }

  /** Durable writer receipt only; message revision and live queued input remain owned here. */
  updatePersistenceFacts(snapshot: SessionGraphSnapshot): void {
    const compoundOperations = mergeCompoundOperationLedgers(this.snapshot.compoundOperations, snapshot.compoundOperations);
    const semanticCompaction = mergeSemanticCompactionLedgers(this.snapshot.semanticCompaction, snapshot.semanticCompaction);
    this.snapshot.compoundOperations = compoundOperations;
    this.snapshot.semanticCompaction = semanticCompaction;
    this.snapshot.storeRevision = snapshot.storeRevision;
    this.snapshot.historyDigest = snapshot.historyDigest;
    if (snapshot.executionProtected) this.snapshot.executionProtected = true;
  }

  restoreSnapshot(snapshot: SessionGraphSnapshot): void {
    const protectedObservationClosure = mergeProtectedObservationClosures(this.snapshot.protectedObservationClosure, snapshot.protectedObservationClosure);
    this.snapshot = {
      ...structuredClone(snapshot),
      compoundOperations: mergeCompoundOperationLedgers(this.snapshot.compoundOperations, snapshot.compoundOperations),
      semanticCompaction: mergeSemanticCompactionLedgers(this.snapshot.semanticCompaction, snapshot.semanticCompaction),
      protectedObservationClosure,
      memoryRefs: snapshot.memoryRefs ?? [],
      approvalRefs: snapshot.approvalRefs ?? [],
      backgroundJobRefs: snapshot.backgroundJobRefs ?? [],
    };
    this.revision += 1;
  }

  private touch(): void {
    this.snapshot.updatedAt = Date.now();
    this.revision += 1;
  }
}
