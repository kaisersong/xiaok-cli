import type { Message, MessageBlock, UsageStats } from '../../types.js';
import { compactMessages, mergeUsage } from './usage.js';

export interface AgentSessionSnapshot {
  messages: Message[];
  usage: UsageStats;
}

export class AgentSessionState {
  private messages: Message[] = [];
  private usage: UsageStats = { inputTokens: 0, outputTokens: 0 };

  getMessages(): Message[] {
    return this.messages;
  }

  getUsage(): UsageStats {
    return this.usage;
  }

  updateUsage(next: UsageStats): UsageStats {
    this.usage = mergeUsage(this.usage, next);
    return this.usage;
  }

  appendUserText(text: string): void {
    this.messages.push({
      role: 'user',
      content: [{ type: 'text', text }],
    });
  }

  appendAssistantBlocks(blocks: MessageBlock[]): void {
    if (blocks.length === 0) {
      return;
    }

    this.messages.push({
      role: 'assistant',
      content: blocks,
    });
  }

  appendUserToolResults(blocks: MessageBlock[]): void {
    if (blocks.length === 0) {
      return;
    }

    this.messages.push({
      role: 'user',
      content: blocks,
    });
  }

  replaceMessages(messages: Message[]): void {
    this.messages = messages;
  }

  replaceUsage(usage: UsageStats): void {
    this.usage = usage;
  }

  forceCompact(placeholder = '[context compacted]'): void {
    this.messages = compactMessages(this.messages, placeholder);
  }

  exportSnapshot(): AgentSessionSnapshot {
    return {
      messages: this.messages.map((message) => ({
        role: message.role,
        content: message.content.map((block) => ({ ...block })),
      })),
      usage: { ...this.usage },
    };
  }

  restoreSnapshot(snapshot: AgentSessionSnapshot): void {
    this.replaceMessages(snapshot.messages.map((message) => ({
      role: message.role,
      content: message.content.map((block) => ({ ...block })),
    })));
    this.replaceUsage({ ...snapshot.usage });
  }
}
