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

export class AgentSessionGraph {
  private snapshot: SessionGraphSnapshot;

  constructor(
    snapshot: Partial<SessionGraphSnapshot> & Pick<SessionGraphSnapshot, 'sessionId' | 'cwd' | 'createdAt' | 'updatedAt' | 'lineage'>,
  ) {
    this.snapshot = {
      ...snapshot,
      messages: snapshot.messages ?? [],
      usage: snapshot.usage ?? { inputTokens: 0, outputTokens: 0 },
      compactions: snapshot.compactions ?? [],
      memoryRefs: snapshot.memoryRefs ?? [],
      approvalRefs: snapshot.approvalRefs ?? [],
      backgroundJobRefs: snapshot.backgroundJobRefs ?? [],
    };
  }

  getMessages(): Message[] {
    return this.snapshot.messages;
  }

  getUsage(): UsageStats {
    return this.snapshot.usage;
  }

  getCompactions(): CompactionRecord[] {
    return this.snapshot.compactions;
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

  restoreSnapshot(snapshot: SessionGraphSnapshot): void {
    this.snapshot = {
      ...structuredClone(snapshot),
      memoryRefs: snapshot.memoryRefs ?? [],
      approvalRefs: snapshot.approvalRefs ?? [],
      backgroundJobRefs: snapshot.backgroundJobRefs ?? [],
    };
  }

  private touch(): void {
    this.snapshot.updatedAt = Date.now();
  }
}
