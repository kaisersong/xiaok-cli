import type { Message, MessageBlock, UsageStats } from '../../types.js';
export interface CompactionRecord {
    id: string;
    createdAt: number;
    summary: string;
    replacedMessages: number;
}
export interface SessionGraphSnapshot {
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
    constructor(snapshot: Partial<SessionGraphSnapshot> & Pick<SessionGraphSnapshot, 'sessionId' | 'cwd' | 'createdAt' | 'updatedAt' | 'lineage'>);
    getMessages(): Message[];
    getUsage(): UsageStats;
    getCompactions(): CompactionRecord[];
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
    restoreSnapshot(snapshot: SessionGraphSnapshot): void;
    private touch;
}
