import { captureApplicationData } from './application-value-data.js';
import { createHash } from 'node:crypto';
import { canonicalVerificationJson as json } from './protocol.js';
export const GOAL_APPLICATION_EVIDENCE_KINDS = ['answer', 'file_artifact', 'command_action', 'project_update'];
/** Pure immutable business value. This parser never issues native or projection authority. */
export function parseGoalApplicationBinding(raw) {
    const serialized = json(captureApplicationData(raw, { maximumBytes: 65536, maximumNodes: 65536, invalid: 'application_binding_shape', limit: 'application_binding_limit' }));
    if (Buffer.byteLength(serialized) > 65536)
        throw Error('application_binding_limit');
    const r = JSON.parse(serialized);
    if (!r || typeof r !== 'object' || Array.isArray(r) || Object.keys(r).sort().join(',') !== 'completionCriterion,epoch,expectedEvidenceKinds,goalId,kind,objective,sessionId,version' || r.version !== 1 || r.kind !== 'goal')
        throw Error('application_binding_shape');
    for (const value of [r.sessionId, r.goalId])
        if (typeof value !== 'string' || !value || Buffer.byteLength(value) > 160 || /[\x00-\x1f\x7f]/.test(value))
            throw Error('application_binding_identity');
    if (!Number.isSafeInteger(r.epoch) || r.epoch < 1)
        throw Error('application_binding_epoch');
    if (typeof r.objective !== 'string' || !r.objective.length || r.objective.length > 4000 || r.objective.trim() !== r.objective)
        throw Error('application_binding_objective');
    if (r.completionCriterion !== null && (typeof r.completionCriterion !== 'string' || !r.completionCriterion.length || r.completionCriterion.length > 4000 || r.completionCriterion.trim() !== r.completionCriterion))
        throw Error('application_binding_criterion');
    if (!Array.isArray(r.expectedEvidenceKinds) || r.expectedEvidenceKinds.length > 4 || new Set(r.expectedEvidenceKinds).size !== r.expectedEvidenceKinds.length || r.expectedEvidenceKinds.some((v) => !GOAL_APPLICATION_EVIDENCE_KINDS.includes(v)))
        throw Error('application_binding_evidence');
    const ordered = GOAL_APPLICATION_EVIDENCE_KINDS.filter(k => r.expectedEvidenceKinds.includes(k));
    if (json(ordered) !== json(r.expectedEvidenceKinds))
        throw Error('application_binding_evidence_order');
    Object.freeze(r.expectedEvidenceKinds);
    return Object.freeze(r);
}
export function goalApplicationBindingHash(raw) { return createHash('sha256').update('xiaok-goal-application-binding-v1\0').update(json(parseGoalApplicationBinding(raw))).digest('hex'); }
export function parseActiveGoalApplicationBinding(raw) {
    const value = JSON.parse(json(captureApplicationData(raw, { maximumBytes: 65536 + 256, maximumNodes: 65536 + 256, invalid: 'application_active_shape', limit: 'application_binding_limit' })));
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 3 || Object.keys(value).some(k => !['binding', 'bindingHash', 'revision'].includes(k)) || !Number.isSafeInteger(value.revision) || value.revision < 1)
        throw Error('application_active_shape');
    const binding = parseGoalApplicationBinding(value.binding);
    if (value.bindingHash !== goalApplicationBindingHash(binding))
        throw Error('application_active_hash');
    return Object.freeze({ binding, bindingHash: value.bindingHash, revision: value.revision });
}
