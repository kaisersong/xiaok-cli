import type { ProtectedObservationClosure, ProtectedObservationReference } from './protected-observation-closure.js';
import type { Message, MessageBlock, UsageStats } from '../../types.js';
import { type CompactionPlan } from './usage.js';
import { type CompactionRecord, type SessionGraphSnapshot } from './session-graph.js';
export type { CompactionRecord } from './session-graph.js';
export type { CompactionPlan } from './usage.js';
export interface AgentSessionSnapshot extends SessionGraphSnapshot {
}
export type CompactionApplyOutcome = {
    status: 'compacted';
    record: CompactionRecord;
} | {
    status: 'stale_plan' | 'invalid_plan' | 'no_gain';
    record: null;
};
export declare class AgentSessionState {
    private observationRestoreGeneration;
    private publishedHistoryBasis;
    getPublishedHistoryBasis(): string;
    /** Host complete-history publisher only, after the exact snapshot was committed.
     * Generic metadata receipts never advance this lineage. */
    notePublishedHistory(snapshot: AgentSessionSnapshot, expectedBasis: string): void;
    private readonly observationRestoreListeners;
    onObservationRestoreGeneration(listener: () => void): () => void;
    getObservationRestoreGeneration(): number;
    private graph;
    private promptSnapshotId?;
    private promptMemoryRefs?;
    private promptCwd?;
    addProtectedObservationReferences(refs: ProtectedObservationReference[]): void;
    getProtectedObservationClosure(): ProtectedObservationClosure | undefined;
    getMessages(): Message[];
    getUsage(): UsageStats;
    getCompactions(): CompactionRecord[];
    updateUsage(next: UsageStats): UsageStats;
    appendUserText(text: string): void;
    appendUserBlocks(blocks: MessageBlock[]): void;
    appendAssistantBlocks(blocks: MessageBlock[]): void;
    appendUserToolResults(blocks: MessageBlock[]): void;
    replaceMessages(messages: Message[]): void;
    /** Call only at settled run boundaries, never while a tool is still executing. */
    repairIncompleteToolCalls(): void;
    replaceUsage(usage: UsageStats): void;
    replaceCompactions(compactions: CompactionRecord[]): void;
    attachPromptSnapshot(promptSnapshotId: string, memoryRefs: string[], cwd?: string): void;
    getPromptSnapshot(): {
        id: string;
        cwd: string;
        memoryRefs: string[];
    } | undefined;
    recordApproval(approvalId: string): void;
    recordBackgroundJob(jobId: string): void;
    planCompaction(keepRecent?: number): CompactionPlan;
    applyCompaction(plan: CompactionPlan, summaryText?: string): CompactionApplyOutcome;
    forceCompact(summaryText?: string): CompactionRecord | null;
    exportSnapshot(): AgentSessionSnapshot;
    updatePersistenceFacts(snapshot: AgentSessionSnapshot): void;
    /** Same-owner installation after a successful durable CAS. This is not a restore
     * and must not invalidate the live observation provenance generation. */
    installCommittedSnapshot(input: {
        snapshot: AgentSessionSnapshot;
        expectedRevision: number;
        expectedHistoryDigest: string;
    }): void;
    restoreSnapshot(snapshot: AgentSessionSnapshot): void;
}
