import {ownDataArrayIsArray,ownDataArrayPrototypeJoin,ownDataArrayPrototypeSort,ownDataBufferByteLength,ownDataObjectFreeze,ownDataObjectKeys,ownDataRegExpPrototypeTest} from './application-native-intrinsics.js';
import { createHash } from 'node:crypto';
import { canonicalVerificationJson as json } from './protocol.js';
import { completionConsumerOwner } from './completion-consumer-owner.js';
const nativeJsonParse = JSON.parse, apply = Reflect.apply;
export interface LoopHostSubject {
    kind: 'loop-run';
    loopId: string;
    runId: string;
    stage: Readonly<{
        stageId: string;
        stageKind: 'scan' | 'execute' | 'verify';
    }> | null;
}
function shape(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || ownDataArrayIsArray(value)
        || ownDataArrayPrototypeJoin(ownDataArrayPrototypeSort(ownDataObjectKeys(value)), ',') !== ownDataArrayPrototypeJoin(ownDataArrayPrototypeSort(keys), ','))
        throw Error('loop_subject_shape');
}
function id(value: unknown): asserts value is string {
    if (typeof value !== 'string' || !value || ownDataBufferByteLength(value) > 160
        || ownDataRegExpPrototypeTest(/[\x00-\x1f\x7f]/, value))
        throw Error('loop_subject_identity');
}
/** Immutable host identity only. A Loop run is not a chat session, an execution
 * invocation, native approval, or a completion projection capability. */
export function parseLoopHostSubject(raw: unknown): Readonly<LoopHostSubject> {
    const encoded = json(raw);
    if (ownDataBufferByteLength(encoded) > 4096)
        throw Error('loop_subject_limit');
    const value: unknown = apply(nativeJsonParse, JSON, [encoded]);
    shape(value, ['kind', 'loopId', 'runId', 'stage']);
    if (value.kind !== 'loop-run')
        throw Error('loop_subject_kind');
    id(value.loopId);
    id(value.runId);
    let stage: LoopHostSubject['stage'] = null;
    if (value.stage !== null) {
        shape(value.stage, ['stageId', 'stageKind']);
        id(value.stage.stageId);
        const kind = value.stage.stageKind;
        if (kind !== 'scan' && kind !== 'execute' && kind !== 'verify')
            throw Error('loop_subject_stage_kind');
        stage = ownDataObjectFreeze({ stageId: value.stage.stageId, stageKind: kind });
    }
    return ownDataObjectFreeze({ kind: 'loop-run', loopId: value.loopId, runId: value.runId, stage });
}
export function loopHostSubjectHash(raw: unknown): string {
    return createHash('sha256').update('xiaok-loop-host-subject-v1\0')
        .update(json(parseLoopHostSubject(raw))).digest('hex');
}
/** Shared exact identity mapping; this does not register the owner. */
export function loopHostSubjectOwner(raw: unknown) {
    const subject = parseLoopHostSubject(raw);
    return completionConsumerOwner(subject.stage
        ? { ownerKind: 'loop_stage', ownerId: subject.stage.stageId }
        : { ownerKind: 'loop_run', ownerId: subject.runId });
}
