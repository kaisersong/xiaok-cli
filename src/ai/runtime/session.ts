import type { Message, MessageBlock, UsageStats } from '../../types.js';
import {
  applyCompactionPlan,
  estimateTokens,
  mergeUsage,
  planCompaction as buildCompactionPlan,
  type CompactionPlan,
} from './usage.js';
import { AgentSessionGraph, type CompactionRecord, type SessionGraphSnapshot } from './session-graph.js';

export type { CompactionRecord } from './session-graph.js';
export type { CompactionPlan } from './usage.js';
export interface AgentSessionSnapshot extends SessionGraphSnapshot {}

export type CompactionApplyOutcome =
  | { status: 'compacted'; record: CompactionRecord }
  | { status: 'stale_plan' | 'invalid_plan' | 'no_gain'; record: null };

let nextCompactionId = 0;

export class AgentSessionState {
  private graph = new AgentSessionGraph({
    sessionId: 'transient',
    cwd: process.cwd(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lineage: ['transient'],
  });

  private promptSnapshotId?: string;
  private promptMemoryRefs?: string[];
  private promptCwd?: string;

  getMessages(): Message[] {
    return this.graph.getMessages();
  }

  getUsage(): UsageStats {
    return this.graph.getUsage();
  }

  getCompactions(): CompactionRecord[] {
    return this.graph.getCompactions();
  }

  updateUsage(next: UsageStats): UsageStats {
    return this.graph.updateUsage(mergeUsage(this.graph.getUsage(), next));
  }

  appendUserText(text: string): void {
    this.graph.appendUserText(text);
  }

  appendUserBlocks(blocks: MessageBlock[]): void {
    this.graph.appendUserBlocks(blocks);
  }

  appendAssistantBlocks(blocks: MessageBlock[]): void {
    this.graph.appendAssistantBlocks(blocks);
  }

  appendUserToolResults(blocks: MessageBlock[]): void {
    this.graph.appendUserToolResults(blocks);
  }

  replaceMessages(messages: Message[]): void {
    this.graph.replaceMessages(messages);
  }

  replaceUsage(usage: UsageStats): void {
    this.graph.replaceUsage(usage);
  }

  replaceCompactions(compactions: CompactionRecord[]): void {
    this.graph.replaceCompactions(compactions);
  }

  attachPromptSnapshot(promptSnapshotId: string, memoryRefs: string[], cwd?: string): void {
    this.promptSnapshotId = promptSnapshotId;
    this.promptMemoryRefs = memoryRefs;
    this.promptCwd = cwd;
    this.graph.attachPromptSnapshot(promptSnapshotId, memoryRefs);
  }

  getPromptSnapshot(): { id: string; cwd: string; memoryRefs: string[] } | undefined {
    if (!this.promptSnapshotId) return undefined;
    return {
      id: this.promptSnapshotId,
      cwd: this.promptCwd ?? '',
      memoryRefs: this.promptMemoryRefs ?? [],
    };
  }

  recordApproval(approvalId: string): void {
    this.graph.recordApproval(approvalId);
  }

  recordBackgroundJob(jobId: string): void {
    this.graph.recordBackgroundJob(jobId);
  }

  planCompaction(keepRecent = 2): CompactionPlan {
    return buildCompactionPlan(
      this.graph.getMessages(),
      this.graph.getRevision(),
      keepRecent,
    );
  }

  applyCompaction(plan: CompactionPlan, summaryText?: string): CompactionApplyOutcome {
    if (
      this.graph.getRevision() !== plan.sourceRevision ||
      this.graph.getMessages().length !== plan.sourceMessageCount
    ) {
      return { status: 'stale_plan', record: null };
    }

    if (plan.invalidReason) {
      return { status: 'invalid_plan', record: null };
    }

    const compacted = applyCompactionPlan(plan, summaryText);
    if (compacted.status !== 'compacted') {
      return { status: 'no_gain', record: null };
    }

    this.graph.replaceMessages(compacted.messages);

    // Compact 后更新 usage.inputTokens 为估算值
    const estimatedInput = estimateTokens(this.graph.getMessages());
    const currentUsage = this.graph.getUsage();
    this.graph.replaceUsage({
      inputTokens: estimatedInput,
      outputTokens: currentUsage.outputTokens,
      cacheCreationInputTokens: currentUsage.cacheCreationInputTokens,
      cacheReadInputTokens: currentUsage.cacheReadInputTokens,
    });

    const record: CompactionRecord = {
      id: `cmp_${Date.now().toString(36)}_${nextCompactionId += 1}`,
      createdAt: Date.now(),
      summary: compacted.summary.text,
      replacedMessages: compacted.summary.replacedMessages,
    };
    this.graph.recordCompaction(record);
    return { status: 'compacted', record };
  }

  forceCompact(summaryText?: string): CompactionRecord | null {
    return this.applyCompaction(this.planCompaction(), summaryText).record;
  }

  exportSnapshot(): AgentSessionSnapshot {
    return this.graph.exportSnapshot();
  }

  restoreSnapshot(snapshot: AgentSessionSnapshot): void {
    this.graph.restoreSnapshot(snapshot);
  }
}
