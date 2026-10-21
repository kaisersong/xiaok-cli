import { validateSemanticCompactionLedger, mergeSemanticCompactionLedgers } from '../../runtime/sol-pi/semantic-compaction-ledger.js';
import { validateCompoundOperationLedger, mergeCompoundOperationLedgers } from '../../runtime/sol-pi/compound-operation.js';
import { mergeProtectedObservationClosures } from './protected-observation-closure.js';
export class AgentSessionGraph {
    snapshot;
    revision = 0;
    constructor(snapshot) {
        this.snapshot = {
            ...snapshot,
            compoundOperations: snapshot.compoundOperations === undefined ? undefined : validateCompoundOperationLedger(snapshot.compoundOperations),
            semanticCompaction: snapshot.semanticCompaction === undefined ? undefined : validateSemanticCompactionLedger(snapshot.semanticCompaction),
            protectedObservationClosure: mergeProtectedObservationClosures(undefined, snapshot.protectedObservationClosure),
            messages: snapshot.messages ?? [],
            usage: snapshot.usage ?? { inputTokens: 0, outputTokens: 0 },
            compactions: snapshot.compactions ?? [],
            memoryRefs: snapshot.memoryRefs ?? [],
            approvalRefs: snapshot.approvalRefs ?? [],
            backgroundJobRefs: snapshot.backgroundJobRefs ?? [],
        };
    }
    addProtectedObservationReferences(observations) {
        this.snapshot.protectedObservationClosure = mergeProtectedObservationClosures(this.snapshot.protectedObservationClosure, { version: 1, requiresReauthorization: true, observations });
        this.touch();
    }
    getProtectedObservationClosure() {
        return mergeProtectedObservationClosures(undefined, this.snapshot.protectedObservationClosure);
    }
    getMessages() {
        return structuredClone(this.snapshot.messages);
    }
    getUsage() {
        return this.snapshot.usage;
    }
    getCompactions() {
        return this.snapshot.compactions;
    }
    getRevision() {
        return this.revision;
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
    /** Durable writer receipt only; message revision and live queued input remain owned here. */
    updatePersistenceFacts(snapshot) {
        const compoundOperations = mergeCompoundOperationLedgers(this.snapshot.compoundOperations, snapshot.compoundOperations);
        const semanticCompaction = mergeSemanticCompactionLedgers(this.snapshot.semanticCompaction, snapshot.semanticCompaction);
        this.snapshot.compoundOperations = compoundOperations;
        this.snapshot.semanticCompaction = semanticCompaction;
        this.snapshot.storeRevision = snapshot.storeRevision;
        this.snapshot.historyDigest = snapshot.historyDigest;
        if (snapshot.executionProtected)
            this.snapshot.executionProtected = true;
    }
    restoreSnapshot(snapshot) {
        const protectedObservationClosure = mergeProtectedObservationClosures(this.snapshot.protectedObservationClosure, snapshot.protectedObservationClosure);
        this.snapshot = {
            ...structuredClone(snapshot),
            compoundOperations: mergeCompoundOperationLedgers(this.snapshot.compoundOperations, snapshot.compoundOperations),
            semanticCompaction: mergeSemanticCompactionLedgers(this.snapshot.semanticCompaction, snapshot.semanticCompaction),
            protectedObservationClosure,
            memoryRefs: snapshot.memoryRefs ?? [],
            approvalRefs: snapshot.approvalRefs ?? [],
            backgroundJobRefs: snapshot.backgroundJobRefs ?? [],
        };
        this.revision += 1;
    }
    touch() {
        this.snapshot.updatedAt = Date.now();
        this.revision += 1;
    }
}
