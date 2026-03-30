import type { Message, MessageBlock, UsageStats } from '../../types.js';
export interface AgentSessionSnapshot {
    messages: Message[];
    usage: UsageStats;
}
export declare class AgentSessionState {
    private messages;
    private usage;
    getMessages(): Message[];
    getUsage(): UsageStats;
    updateUsage(next: UsageStats): UsageStats;
    appendUserText(text: string): void;
    appendUserBlocks(blocks: MessageBlock[]): void;
    appendAssistantBlocks(blocks: MessageBlock[]): void;
    appendUserToolResults(blocks: MessageBlock[]): void;
    replaceMessages(messages: Message[]): void;
    replaceUsage(usage: UsageStats): void;
    forceCompact(placeholder?: string): void;
    exportSnapshot(): AgentSessionSnapshot;
    restoreSnapshot(snapshot: AgentSessionSnapshot): void;
}
