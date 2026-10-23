import { ownDataArrayIsArray, ownDataArrayPrototypeIncludes, ownDataArrayPrototypeJoin, ownDataArrayPrototypeSome, ownDataArrayPrototypeSort, ownDataBufferByteLength, ownDataCryptoCreateHash, ownDataHashPrototypeDigest, ownDataHashPrototypeUpdate, ownDataJSONParse, ownDataNumberIsSafeInteger, ownDataObjectFreeze, ownDataObjectKeys, ownDataRegExpPrototypeTest, ownDataSetPrototypeSizeGetter, ownDataStringPrototypeTrim } from './application-native-intrinsics.js';
import { capturedArrayFilter, capturedArrayIterator, capturedArraySome, setFromDenseArray } from './application-iteration-intrinsics.js';
import { captureApplicationData } from './application-value-data.js';
import { createHash } from 'node:crypto';
import { canonicalVerificationJson as json } from './protocol.js';
export const GOAL_APPLICATION_EVIDENCE_KINDS = ['answer', 'file_artifact', 'command_action', 'project_update'] as const;
const privateGOAL_APPLICATION_EVIDENCE_KINDS = ownDataObjectFreeze([...GOAL_APPLICATION_EVIDENCE_KINDS]);
export interface GoalApplicationBinding {
    version: 1;
    kind: 'goal';
    sessionId: string;
    goalId: string;
    epoch: number;
    objective: string;
    completionCriterion: string | null;
    expectedEvidenceKinds: readonly (typeof GOAL_APPLICATION_EVIDENCE_KINDS)[number][];
}
/** Pure immutable business value. This parser never issues native or projection authority. */
export function parseGoalApplicationBinding(raw: unknown): Readonly<GoalApplicationBinding> {
    const serialized = json(captureApplicationData(raw, { maximumBytes: 65536, maximumNodes: 65536, invalid: 'application_binding_shape', limit: 'application_binding_limit' }));
    if (ownDataBufferByteLength(serialized) > 65536)
        throw Error('application_binding_limit');
    const r = ownDataJSONParse(serialized);
    if (!r || typeof r !== 'object' || ownDataArrayIsArray(r) || ownDataArrayPrototypeJoin(ownDataArrayPrototypeSort(ownDataObjectKeys(r)), ',') !== 'completionCriterion,epoch,expectedEvidenceKinds,goalId,kind,objective,sessionId,version' || r.version !== 1 || r.kind !== 'goal')
        throw Error('application_binding_shape');
    for (const value of capturedArrayIterator([r.sessionId, r.goalId]))
        if (typeof value !== 'string' || !value || ownDataBufferByteLength(value) > 160 || ownDataRegExpPrototypeTest(/[\x00-\x1f\x7f]/, value))
            throw Error('application_binding_identity');
    if (!ownDataNumberIsSafeInteger(r.epoch) || r.epoch < 1)
        throw Error('application_binding_epoch');
    if (typeof r.objective !== 'string' || !r.objective.length || r.objective.length > 4000 || ownDataStringPrototypeTrim(r.objective) !== r.objective)
        throw Error('application_binding_objective');
    if (r.completionCriterion !== null && (typeof r.completionCriterion !== 'string' || !r.completionCriterion.length || r.completionCriterion.length > 4000 || ownDataStringPrototypeTrim(r.completionCriterion) !== r.completionCriterion))
        throw Error('application_binding_criterion');
    if (!ownDataArrayIsArray(r.expectedEvidenceKinds) || r.expectedEvidenceKinds.length > 4 || ownDataSetPrototypeSizeGetter(setFromDenseArray(r.expectedEvidenceKinds)) !== r.expectedEvidenceKinds.length || capturedArraySome(r.expectedEvidenceKinds, (v: unknown) => !capturedArraySome(privateGOAL_APPLICATION_EVIDENCE_KINDS, k => k === v)))
        throw Error('application_binding_evidence');
    const ordered = capturedArrayFilter(privateGOAL_APPLICATION_EVIDENCE_KINDS, k => capturedArraySome(r.expectedEvidenceKinds, v => v === k));
    if (json(ordered) !== json(r.expectedEvidenceKinds))
        throw Error('application_binding_evidence_order');
    ownDataObjectFreeze(r.expectedEvidenceKinds);
    return ownDataObjectFreeze(r) as Readonly<GoalApplicationBinding>;
}
export function goalApplicationBindingHash(raw: unknown): string { return ownDataHashPrototypeDigest(ownDataHashPrototypeUpdate(ownDataHashPrototypeUpdate(ownDataCryptoCreateHash('sha256'), 'xiaok-goal-application-binding-v1\0'), json(parseGoalApplicationBinding(raw))), 'hex'); }
export interface ActiveGoalApplicationBinding {
    binding: Readonly<GoalApplicationBinding>;
    bindingHash: string;
    revision: number;
}
export function parseActiveGoalApplicationBinding(raw: unknown): Readonly<ActiveGoalApplicationBinding> {
    const value = ownDataJSONParse(json(captureApplicationData(raw, { maximumBytes: 65536 + 256, maximumNodes: 65536 + 256, invalid: 'application_active_shape', limit: 'application_binding_limit' })));
    if (!value || typeof value !== 'object' || ownDataArrayIsArray(value) || ownDataObjectKeys(value).length !== 3 || ownDataArrayPrototypeSome(ownDataObjectKeys(value), k => !ownDataArrayPrototypeIncludes(['binding', 'bindingHash', 'revision'], k)) || !ownDataNumberIsSafeInteger(value.revision) || value.revision < 1)
        throw Error('application_active_shape');
    const binding = parseGoalApplicationBinding(value.binding);
    if (value.bindingHash !== goalApplicationBindingHash(binding))
        throw Error('application_active_hash');
    return ownDataObjectFreeze({ binding, bindingHash: value.bindingHash, revision: value.revision });
}
/** Current controller observation; never a native approval or local store write capability. */
export interface GoalApplicationObservation {
    state: 'unbound' | 'pending' | 'active';
    current: Readonly<ActiveGoalApplicationBinding> | null;
    pendingTransitionId: string | null;
}
