import type { ProtectedObservationClosure, ProtectedObservationReference } from './protected-observation-closure.js';
import { computeSessionHistoryDigest } from './session-store/store.js';
import type { Message, MessageBlock, UsageStats } from '../../types.js';
import {
  applyCompactionPlan,
  estimateTokens,
  mergeUsage,
  planCompaction as buildCompactionPlan,
  type CompactionPlan,
} from './usage.js';
import { AgentSessionGraph, type CompactionRecord, type SessionGraphSnapshot, type SessionGraphPersistenceFacts } from './session-graph.js';

export type { CompactionRecord } from './session-graph.js';
export type { CompactionPlan } from './usage.js';
export interface AgentSessionSnapshot extends SessionGraphSnapshot {}

export type SessionPersistenceFacts = SessionGraphPersistenceFacts
  & Pick<AgentSessionSnapshot, 'sessionId' | 'cwd' | 'messages'>;

export type CompactionApplyOutcome =
  | { status: 'compacted'; record: CompactionRecord }
  | { status: 'stale_plan' | 'invalid_plan' | 'no_gain'; record: null };

let nextCompactionId = 0;

export class AgentSessionState {
  private observationRestoreGeneration = 0;
  private publishedHistoryBasis: string | undefined;

  getPublishedHistoryBasis(): string {
    return this.publishedHistoryBasis ??= computeSessionHistoryDigest(this.graph.exportSnapshot());
  }

  /** Host complete-history publisher only, after the exact snapshot was committed.
   * Generic metadata receipts never advance this lineage. */
  notePublishedHistory(snapshot: AgentSessionSnapshot, expectedBasis: string): void {
    const digest = computeSessionHistoryDigest(snapshot);
    if (snapshot.sessionId !== this.graph.exportSnapshot().sessionId
      || (this.getPublishedHistoryBasis() !== expectedBasis && this.getPublishedHistoryBasis() !== digest)) throw Error('SESSION_PUBLISHED_HISTORY_STALE');
    this.publishedHistoryBasis = digest;
  }

  private readonly observationRestoreListeners = new Set<() => void>();

  onObservationRestoreGeneration(listener: () => void): () => void {
    const listeners = this.observationRestoreListeners;
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }

  getObservationRestoreGeneration(): number {
    return this.observationRestoreGeneration;
  }
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

  addProtectedObservationReferences(refs: ProtectedObservationReference[]): void {
    this.graph.addProtectedObservationReferences(refs);
  }

  getProtectedObservationClosure(): ProtectedObservationClosure | undefined {
    return this.graph.getProtectedObservationClosure();
  }

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

  /** Call only at settled run boundaries, never while a tool is still executing. */
  repairIncompleteToolCalls(): void {
    const messages = this.getMessages();
    const repaired: Message[] = [];
    let changed = false;
    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index];
      repaired.push(message);
      if (message.role !== 'assistant') continue;
      const pending = new Set(message.content.flatMap(block => block.type === 'tool_use' ? [block.id] : []));
      if (!pending.size) continue;
      const results: MessageBlock[] = [];
      let resultMessages = 0;
      let remainingMessage: Message | undefined;
      // Results may occupy several consecutive messages. Preserve every real result.
      while (index + 1 < messages.length) {
        const next = messages[index + 1];
        if (next.role !== 'user' || !next.content.some(block => block.type === 'tool_result')) break;
        for (const block of next.content) {
          if (block.type === 'tool_result') pending.delete(block.tool_use_id);
        }
        results.push(...next.content.filter(block => block.type === 'tool_result'));
        resultMessages += 1;
        index += 1;
        const remaining = next.content.filter(block => block.type !== 'tool_result');
        if (remaining.length) {
          remainingMessage = { ...next, content: remaining };
          break;
        }
      }
      if (pending.size) {
        results.push(...[...pending].map(id => ({
          type: 'tool_result' as const, tool_use_id: id, is_error: true,
          content: '[run-interrupted] Tool result unavailable. Execution may have been interrupted or not started; do not assume no side effects or repeat the operation without checking its state.',
        })));
        changed = true;
      }
      // OpenAI conversion pairs one result message with the preceding assistant.
      if (resultMessages > 1) changed = true;
      repaired.push({ role: 'user', content: results });
      if (remainingMessage) repaired.push(remainingMessage);
    }
    if (changed) this.replaceMessages(repaired);
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

  updatePersistenceFacts(snapshot: SessionPersistenceFacts): void {
    const current = this.graph.exportSnapshot();
    if (snapshot.sessionId !== current.sessionId || snapshot.cwd !== current.cwd
      || !Number.isSafeInteger(snapshot.storeRevision) || (snapshot.storeRevision ?? -1) < (current.storeRevision ?? 0)
      || snapshot.historyDigest !== computeSessionHistoryDigest(snapshot)) throw Error('SESSION_PERSISTENCE_RECEIPT_INVALID');
    this.graph.updatePersistenceFacts(snapshot);
  }

  /** Same-owner installation after a successful durable CAS. This is not a restore
   * and must not invalidate the live observation provenance generation. */
  installCommittedSnapshot(input: { snapshot: AgentSessionSnapshot; expectedRevision: number; expectedHistoryDigest: string }): void {
    const current = this.graph.exportSnapshot(), next = input.snapshot;
    if (this.graph.getRevision() !== input.expectedRevision || computeSessionHistoryDigest(current) !== input.expectedHistoryDigest
      || next.sessionId !== current.sessionId || next.cwd !== current.cwd
      || !Number.isSafeInteger(next.storeRevision) || (next.storeRevision ?? -1) < (current.storeRevision ?? 0)
      || next.historyDigest !== computeSessionHistoryDigest(next)) throw Error('SEMANTIC_LIVE_COMMIT_STALE');
    this.graph.restoreSnapshot(next);
    this.publishedHistoryBasis = computeSessionHistoryDigest(next);
  }

  restoreSnapshot(snapshot: AgentSessionSnapshot): void {
    this.observationRestoreGeneration += 1;
    for (const listener of [...this.observationRestoreListeners]) {
      try { listener(); } catch { /* One failed cleanup cannot suppress the remaining revocations. */ }
    }
    this.graph.restoreSnapshot(snapshot);
    this.publishedHistoryBasis = computeSessionHistoryDigest(snapshot);
  }
}
