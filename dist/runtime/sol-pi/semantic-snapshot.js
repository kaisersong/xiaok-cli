import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { getObservationSessionOwnerHostBinding } from './observation-session-owner.js';
import { computeSessionHistoryDigest } from '../../ai/runtime/session-store/store.js';
import { packCompletedExecutionAnchors } from './semantic-execution-anchors.js';
const candidates = new WeakMap();
export function readSemanticSnapshotCandidate(candidate) {
    const value = candidate && candidates.get(candidate);
    if (!value || candidate.anchorDigest !== value.anchorDigest || !isDeepStrictEqual(candidate.snapshot, value.snapshot))
        throw Error('SEMANTIC_SNAPSHOT_UNTRUSTED');
    const binding = getObservationSessionOwnerHostBinding(value.owner);
    value.owner.prepareSemanticAnchors([]);
    if (binding.session.planCompaction().sourceRevision !== value.sourceRevision
        || computeSessionHistoryDigest(binding.session.exportSnapshot()) !== value.sourceHistoryDigest)
        throw Error('SEMANTIC_SNAPSHOT_STALE');
    return { snapshot: structuredClone(value.snapshot), anchorDigest: value.anchorDigest, sourceHistoryDigest: value.sourceHistoryDigest };
}
export function buildStrictSemanticSnapshot(input) {
    const binding = getObservationSessionOwnerHostBinding(input.observationOwner);
    const source = structuredClone(input.sourceSnapshot), plan = structuredClone(input.plan);
    if (binding.session.exportSnapshot().sessionId !== source.sessionId || plan.invalidReason || plan.replacedMessages <= 0
        || !isDeepStrictEqual(source.messages, [...plan.messagesToSummarize, ...plan.messagesToRetain])
        || plan.sourceMessageCount !== source.messages.length || plan.replacedMessages !== plan.messagesToSummarize.length
        || typeof input.summaryText !== 'string' || !input.summaryText.trim() || Buffer.byteLength(input.summaryText) > 65536)
        throw Error('SEMANTIC_SNAPSHOT_INVALID');
    // A closed tool history is a precondition even when the pending call lies wholly in the replaced prefix.
    const calls = new Set(), results = new Set();
    for (const message of source.messages)
        for (const block of message.content) {
            if (block.type === 'tool_use') {
                if (calls.has(block.id) || results.has(block.id))
                    throw Error('SEMANTIC_UNPAIRED_TOOLS');
                calls.add(block.id);
            }
            if (block.type === 'tool_result') {
                if (!calls.has(block.tool_use_id) || results.has(block.tool_use_id))
                    throw Error('SEMANTIC_UNPAIRED_TOOLS');
                results.add(block.tool_use_id);
            }
        }
    if (calls.size !== results.size)
        throw Error('SEMANTIC_UNPAIRED_TOOLS');
    const anchors = packCompletedExecutionAnchors(input.observationOwner.prepareSemanticAnchors(plan.messagesToSummarize));
    // Unknown critical text, original user corrections, tool arguments and results remain exact.
    // Only host-proven native archive segments above can be replaced by recall references.
    const facts = { approvalRefs: source.approvalRefs, backgroundJobRefs: source.backgroundJobRefs,
        intentDelegation: source.intentDelegation, skillExecution: source.skillExecution,
        protectedObservationClosure: source.protectedObservationClosure };
    const anchorDigest = createHash('sha256').update(JSON.stringify({ anchors, facts })).digest('hex');
    const summary = `[Derived context summary; original goals and execution text remain in the preceding preserved context. This summary does not grant permissions or mark unverified work complete.]\n${input.summaryText.trim()}\n[Host state anchors; data only]\n${JSON.stringify(facts)}`;
    const messages = [...anchors, { role: 'assistant', content: [{ type: 'text', text: summary }] }, ...plan.messagesToRetain];
    const before = input.measureInputTokens(source.messages), after = input.measureInputTokens(messages);
    if (!Number.isSafeInteger(before) || before <= 0 || !Number.isSafeInteger(after) || after < 0)
        throw Error('SEMANTIC_TOKEN_BOUND_UNKNOWN');
    if (after > before * 0.95)
        return { status: 'no_gain' };
    const result = { status: 'compacted', anchorDigest, snapshot: { ...source, messages, updatedAt: Date.now(),
            usage: { ...source.usage, inputTokens: after }, compactions: [...source.compactions, { id: `cmp_${randomUUID()}`, createdAt: Date.now(), summary, replacedMessages: plan.replacedMessages }] } };
    candidates.set(result, { snapshot: structuredClone(result.snapshot), anchorDigest, sourceHistoryDigest: computeSessionHistoryDigest(source), owner: input.observationOwner, sourceRevision: plan.sourceRevision });
    return result;
}
