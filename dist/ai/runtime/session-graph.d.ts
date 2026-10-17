import { type SemanticCompactionLedger } from '../../runtime/sol-pi/semantic-compaction-ledger.js';
import { type CompoundOperationLedger } from '../../runtime/sol-pi/compound-operation.js';
import { type ProtectedObservationClosure, type ProtectedObservationReference } from './protected-observation-closure.js';
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
export declare class AgentSessionGraph {
    private snapshot;
    private revision;
    constructor(snapshot: Partial<SessionGraphSnapshot> & Pick<SessionGraphSnapshot, 'sessionId' | 'cwd' | 'createdAt' | 'updatedAt' | 'lineage'>);
    addProtectedObservationReferences(observations: ProtectedObservationReference[]): void;
    getProtectedObservationClosure(): ProtectedObservationClosure | undefined;
    getMessages(): Message[];
    getUsage(): UsageStats;
    getCompactions(): CompactionRecord[];
    getRevision(): number;
    updateUsage(next: UsageStats): UsageStats;
    appendUserText(text: string): void;
    appendUserBlocks(blocks: MessageBlock[]): void;
    appendAssistantBlocks(blocks: MessageBlock[]): void;
    appendUserToolResults(blocks: MessageBlock[]): void;
    replaceMessages(messages: Message[]): void;
    replaceUsage(usage: UsageStats): void;
    replaceCompactions(compactions: CompactionRecord[]): void;
    recordCompaction(compaction: CompactionRecord): void;
    attachPromptSnapshot(promptSnapshotId: string, memoryRefs: string[]): void;
    recordApproval(approvalId: string): void;
    recordBackgroundJob(jobId: string): void;
    exportSnapshot(): SessionGraphSnapshot;
    /** Durable writer receipt only; message revision and live queued input remain owned here. */
    updatePersistenceFacts(snapshot: SessionGraphSnapshot): void;
    restoreSnapshot(snapshot: SessionGraphSnapshot): void;
    private touch;
}
