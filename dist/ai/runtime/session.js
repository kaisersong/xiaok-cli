import { compactMessages, mergeUsage } from './usage.js';
export class AgentSessionState {
    messages = [];
    usage = { inputTokens: 0, outputTokens: 0 };
    getMessages() {
        return this.messages;
    }
    getUsage() {
        return this.usage;
    }
    updateUsage(next) {
        this.usage = mergeUsage(this.usage, next);
        return this.usage;
    }
    appendUserText(text) {
        this.appendUserBlocks([{ type: 'text', text }]);
    }
    appendUserBlocks(blocks) {
        this.messages.push({
            role: 'user',
            content: blocks,
        });
    }
    appendAssistantBlocks(blocks) {
        if (blocks.length === 0) {
            return;
        }
        this.messages.push({
            role: 'assistant',
            content: blocks,
        });
    }
    appendUserToolResults(blocks) {
        if (blocks.length === 0) {
            return;
        }
        this.messages.push({
            role: 'user',
            content: blocks,
        });
    }
    replaceMessages(messages) {
        this.messages = messages;
    }
    replaceUsage(usage) {
        this.usage = usage;
    }
    forceCompact(placeholder = '[context compacted]') {
        this.messages = compactMessages(this.messages, placeholder);
    }
    exportSnapshot() {
        return {
            messages: this.messages.map((message) => ({
                role: message.role,
                content: message.content.map((block) => ({ ...block })),
            })),
            usage: { ...this.usage },
        };
    }
    restoreSnapshot(snapshot) {
        this.replaceMessages(snapshot.messages.map((message) => ({
            role: message.role,
            content: message.content.map((block) => ({ ...block })),
        })));
        this.replaceUsage({ ...snapshot.usage });
    }
}
