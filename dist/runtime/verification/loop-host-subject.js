import { createHash } from 'node:crypto';
import { canonicalVerificationJson as json } from './protocol.js';
import { completionConsumerOwner } from './completion-consumer-owner.js';
function shape(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).sort().join(',') !== keys.sort().join(','))
        throw Error('loop_subject_shape');
}
function id(value) {
    if (typeof value !== 'string' || !value || Buffer.byteLength(value) > 160
        || /[\x00-\x1f\x7f]/.test(value))
        throw Error('loop_subject_identity');
}
/** Immutable host identity only. A Loop run is not a chat session, an execution
 * invocation, native approval, or a completion projection capability. */
export function parseLoopHostSubject(raw) {
    const encoded = json(raw);
    if (Buffer.byteLength(encoded) > 4096)
        throw Error('loop_subject_limit');
    const value = JSON.parse(encoded);
    shape(value, ['kind', 'loopId', 'runId', 'stage']);
    if (value.kind !== 'loop-run')
        throw Error('loop_subject_kind');
    id(value.loopId);
    id(value.runId);
    let stage = null;
    if (value.stage !== null) {
        shape(value.stage, ['stageId', 'stageKind']);
        id(value.stage.stageId);
        const kind = value.stage.stageKind;
        if (kind !== 'scan' && kind !== 'execute' && kind !== 'verify')
            throw Error('loop_subject_stage_kind');
        stage = Object.freeze({ stageId: value.stage.stageId, stageKind: kind });
    }
    return Object.freeze({ kind: 'loop-run', loopId: value.loopId, runId: value.runId, stage });
}
export function loopHostSubjectHash(raw) {
    return createHash('sha256').update('xiaok-loop-host-subject-v1\0')
        .update(json(parseLoopHostSubject(raw))).digest('hex');
}
/** Shared exact identity mapping; this does not register the owner. */
export function loopHostSubjectOwner(raw) {
    const subject = parseLoopHostSubject(raw);
    return completionConsumerOwner(subject.stage
        ? { ownerKind: 'loop_stage', ownerId: subject.stage.stageId }
        : { ownerKind: 'loop_run', ownerId: subject.runId });
}
