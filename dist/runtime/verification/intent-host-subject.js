import { createHash } from 'node:crypto';
import { applicationDataDescriptors } from './application-value-data.js';
import { canonicalVerificationJson as json } from './protocol.js';
function identity(value) {
    if (typeof value !== 'string' || !value.length || Buffer.byteLength(value) > 160 || /[\x00-\x1f\x7f]/.test(value))
        throw Error('intent_subject_identity');
}
export function parseIntentHostSubject(raw) {
    const descriptors = applicationDataDescriptors(raw, 4, 'intent_subject_shape');
    if (Array.isArray(raw) || Object.keys(descriptors).sort().join(',') !== 'intentId,sessionId,stageId,version')
        throw Error('intent_subject_shape');
    const version = descriptors.version.value, sessionId = descriptors.sessionId.value, intentId = descriptors.intentId.value, stageId = descriptors.stageId.value;
    if (version !== 1)
        throw Error('intent_subject_version');
    identity(sessionId);
    identity(intentId);
    if (stageId !== null)
        identity(stageId);
    return Object.freeze({ version: 1, sessionId, intentId, stageId });
}
export function intentHostSubjectHash(raw) {
    return createHash('sha256').update('xiaok-intent-host-subject-v1\0').update(json(parseIntentHostSubject(raw))).digest('hex');
}
/** Full subject mapping only; no raw intentId fallback and no registry writes. */
export function intentHostSubjectOwner(raw) {
    return Object.freeze({ ownerKind: 'intent', ownerId: `intent-subject-v1:${intentHostSubjectHash(raw)}` });
}
