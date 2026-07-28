import { applyCompactionPlan, estimateTokens, mergeUsage, planCompaction as buildCompactionPlan, } from './usage.js';
import { AgentSessionGraph } from './session-graph.js';
let nextCompactionId = 0;
export class AgentSessionState {
    graph = new AgentSessionGraph({
        sessionId: 'transient',
        cwd: process.cwd(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lineage: ['transient'],
    });
    promptSnapshotId;
    promptMemoryRefs;
    promptCwd;
    getMessages() {
        return this.graph.getMessages();
    }
    getUsage() {
        return this.graph.getUsage();
    }
    getCompactions() {
        return this.graph.getCompactions();
    }
    updateUsage(next) {
        return this.graph.updateUsage(mergeUsage(this.graph.getUsage(), next));
    }
    appendUserText(text) {
        this.graph.appendUserText(text);
    }
    appendUserBlocks(blocks) {
        this.graph.appendUserBlocks(blocks);
    }
    appendAssistantBlocks(blocks) {
        this.graph.appendAssistantBlocks(blocks);
    }
    appendUserToolResults(blocks) {
        this.graph.appendUserToolResults(blocks);
    }
    replaceMessages(messages) {
        this.graph.replaceMessages(messages);
    }
    replaceUsage(usage) {
        this.graph.replaceUsage(usage);
    }
    replaceCompactions(compactions) {
        this.graph.replaceCompactions(compactions);
    }
    attachPromptSnapshot(promptSnapshotId, memoryRefs, cwd) {
        this.promptSnapshotId = promptSnapshotId;
        this.promptMemoryRefs = memoryRefs;
        this.promptCwd = cwd;
        this.graph.attachPromptSnapshot(promptSnapshotId, memoryRefs);
    }
    getPromptSnapshot() {
        if (!this.promptSnapshotId)
            return undefined;
        return {
            id: this.promptSnapshotId,
            cwd: this.promptCwd ?? '',
            memoryRefs: this.promptMemoryRefs ?? [],
        };
    }
    recordApproval(approvalId) {
        this.graph.recordApproval(approvalId);
    }
    recordBackgroundJob(jobId) {
        this.graph.recordBackgroundJob(jobId);
    }
    planCompaction(keepRecent = 2) {
        return buildCompactionPlan(this.graph.getMessages(), this.graph.getRevision(), keepRecent);
    }
    applyCompaction(plan, summaryText) {
        if (this.graph.getRevision() !== plan.sourceRevision ||
            this.graph.getMessages().length !== plan.sourceMessageCount) {
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
        const record = {
            id: `cmp_${Date.now().toString(36)}_${nextCompactionId += 1}`,
            createdAt: Date.now(),
            summary: compacted.summary.text,
            replacedMessages: compacted.summary.replacedMessages,
        };
        this.graph.recordCompaction(record);
        return { status: 'compacted', record };
    }
    forceCompact(summaryText) {
        return this.applyCompaction(this.planCompaction(), summaryText).record;
    }
    exportSnapshot() {
        return this.graph.exportSnapshot();
    }
    restoreSnapshot(snapshot) {
        this.graph.restoreSnapshot(snapshot);
    }
}
