import type { Message, MessageBlock, UsageStats } from '../../types.js';
import { compactMessages, mergeUsage } from './usage.js';
import { AgentSessionGraph, type CompactionRecord, type SessionGraphSnapshot } from './session-graph.js';

export type { CompactionRecord } from './session-graph.js';
export interface AgentSessionSnapshot extends SessionGraphSnapshot {}

let nextCompactionId = 0;

export class AgentSessionState {
  private graph = new AgentSessionGraph({
    sessionId: 'transient',
    cwd: process.cwd(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lineage: ['transient'],
  });

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

  attachPromptSnapshot(promptSnapshotId: string, memoryRefs: string[]): void {
    this.graph.attachPromptSnapshot(promptSnapshotId, memoryRefs);
  }

  recordApproval(approvalId: string): void {
    this.graph.recordApproval(approvalId);
  }

  recordBackgroundJob(jobId: string): void {
    this.graph.recordBackgroundJob(jobId);
  }

  forceCompact(placeholder = '[context compacted]'): CompactionRecord | null {
    const compacted = compactMessages(this.graph.getMessages(), placeholder);
    this.graph.replaceMessages(compacted.messages);

    if (compacted.summary.replacedMessages <= 0) {
      return null;
    }

    const record: CompactionRecord = {
      id: `cmp_${Date.now().toString(36)}_${nextCompactionId += 1}`,
      createdAt: Date.now(),
      summary: compacted.summary.text,
      replacedMessages: compacted.summary.replacedMessages,
    };
    this.graph.recordCompaction(record);
    return record;
  }

  exportSnapshot(): AgentSessionSnapshot {
    return this.graph.exportSnapshot();
  }

  restoreSnapshot(snapshot: AgentSessionSnapshot): void {
    this.graph.restoreSnapshot(snapshot);
  }
}
