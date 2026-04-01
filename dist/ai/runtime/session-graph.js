export class AgentSessionGraph {
    snapshot;
    constructor(snapshot) {
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
    getMessages() {
        return this.snapshot.messages;
    }
    getUsage() {
        return this.snapshot.usage;
    }
    getCompactions() {
        return this.snapshot.compactions;
    }
    updateUsage(next) {
        this.snapshot.usage = next;
        this.touch();
        return this.snapshot.usage;
    }
    appendUserText(text) {
        this.appendUserBlocks([{ type: 'text', text }]);
    }
    appendUserBlocks(blocks) {
        this.snapshot.messages.push({
            role: 'user',
            content: blocks,
        });
        this.touch();
    }
    appendAssistantBlocks(blocks) {
        if (blocks.length === 0) {
            return;
        }
        this.snapshot.messages.push({
            role: 'assistant',
            content: blocks,
        });
        this.touch();
    }
    appendUserToolResults(blocks) {
        if (blocks.length === 0) {
            return;
        }
        this.snapshot.messages.push({
            role: 'user',
            content: blocks,
        });
        this.touch();
    }
    replaceMessages(messages) {
        this.snapshot.messages = messages;
        this.touch();
    }
    replaceUsage(usage) {
        this.snapshot.usage = usage;
        this.touch();
    }
    replaceCompactions(compactions) {
        this.snapshot.compactions = compactions;
        this.touch();
    }
    recordCompaction(compaction) {
        this.snapshot.compactions.push(compaction);
        this.touch();
    }
    attachPromptSnapshot(promptSnapshotId, memoryRefs) {
        this.snapshot.promptSnapshotId = promptSnapshotId;
        this.snapshot.memoryRefs = [...memoryRefs];
        this.touch();
    }
    recordApproval(approvalId) {
        if (!this.snapshot.approvalRefs.includes(approvalId)) {
            this.snapshot.approvalRefs.push(approvalId);
            this.touch();
        }
    }
    recordBackgroundJob(jobId) {
        if (!this.snapshot.backgroundJobRefs.includes(jobId)) {
            this.snapshot.backgroundJobRefs.push(jobId);
            this.touch();
        }
    }
    exportSnapshot() {
        return structuredClone(this.snapshot);
    }
    restoreSnapshot(snapshot) {
        this.snapshot = {
            ...structuredClone(snapshot),
            memoryRefs: snapshot.memoryRefs ?? [],
            approvalRefs: snapshot.approvalRefs ?? [],
            backgroundJobRefs: snapshot.backgroundJobRefs ?? [],
        };
    }
    touch() {
        this.snapshot.updatedAt = Date.now();
    }
}
