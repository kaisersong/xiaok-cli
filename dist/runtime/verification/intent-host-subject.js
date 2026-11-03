import { ownDataArrayIsArray, ownDataArrayPrototypeJoin, ownDataArrayPrototypeSort, ownDataBufferByteLength, ownDataCryptoCreateHash, ownDataHashPrototypeDigest, ownDataHashPrototypeUpdate, ownDataObjectFreeze, ownDataObjectKeys, ownDataRegExpPrototypeTest } from './application-native-intrinsics.js';
import { applicationDataDescriptors } from './application-value-data.js';
import { canonicalVerificationJson as json } from './protocol.js';
function identity(value) {
    if (typeof value !== 'string' || !value.length || ownDataBufferByteLength(value) > 160 || ownDataRegExpPrototypeTest(/[\x00-\x1f\x7f]/, value))
        throw Error('intent_subject_identity');
}
export function parseIntentHostSubject(raw) {
    const descriptors = applicationDataDescriptors(raw, 4, 'intent_subject_shape');
    if (ownDataArrayIsArray(raw) || ownDataArrayPrototypeJoin(ownDataArrayPrototypeSort(ownDataObjectKeys(descriptors)), ',') !== 'intentId,sessionId,stageId,version')
        throw Error('intent_subject_shape');
    const version = descriptors.version.value, sessionId = descriptors.sessionId.value, intentId = descriptors.intentId.value, stageId = descriptors.stageId.value;
    if (version !== 1)
        throw Error('intent_subject_version');
    identity(sessionId);
    identity(intentId);
    if (stageId !== null)
        identity(stageId);
    return ownDataObjectFreeze({ version: 1, sessionId, intentId, stageId });
}
export function intentHostSubjectHash(raw) {
    return ownDataHashPrototypeDigest(ownDataHashPrototypeUpdate(ownDataHashPrototypeUpdate(ownDataCryptoCreateHash('sha256'), 'xiaok-intent-host-subject-v1\0'), json(parseIntentHostSubject(raw))), 'hex');
}
/** Full subject mapping only; no raw intentId fallback and no registry writes. */
export function intentHostSubjectOwner(raw) {
    return ownDataObjectFreeze({ ownerKind: 'intent', ownerId: `intent-subject-v1:${intentHostSubjectHash(raw)}` });
}
