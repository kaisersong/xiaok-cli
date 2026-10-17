import { applicationDataDescriptors, captureApplicationData } from './application-value-data.js';
import { parseOwnerEnrollmentRegistration } from './owner-enrollment-review.js';
import { createHash } from 'node:crypto';
import { parseIntentHostSubject, intentHostSubjectOwner } from './intent-host-subject.js';
import { parseIntentBusinessContract, intentBusinessContractHash } from './intent-business-contract.js';
import { goalVerificationRegistration } from '../goal/verification-definition.js';
import { canonicalVerificationJson as json } from './protocol.js';
export function isIntentContractOwner(owner) { return owner.ownerKind === 'intent' && owner.ownerId.startsWith('intent-subject-v1:'); }
export function parseIntentContractEnrollment(raw) {
    const d = applicationDataDescriptors(raw, 2, 'intent_enrollment_shape');
    if (Array.isArray(raw) || Object.keys(d).sort().join(',') !== 'contract,subject')
        throw Error('intent_enrollment_shape');
    const subject = parseIntentHostSubject(d.subject.value), contract = parseIntentBusinessContract(d.contract.value);
    if (subject.sessionId !== contract.sessionId || subject.intentId !== contract.intentId || subject.stageId !== null && !contract.stages.some(s => s.stageId === subject.stageId))
        throw Error('intent_enrollment_subject');
    return Object.freeze({ subject, contract });
}
export function intentContractOriginalRegistration(raw) {
    const { subject, contract } = parseIntentContractEnrollment(raw);
    return goalVerificationRegistration(subject.stageId === null ? contract.verification : contract.stages.find(s => s.stageId === subject.stageId).verification);
}
export function intentContractDependencies(raw) {
    const { subject, contract } = parseIntentContractEnrollment(raw), ids = subject.stageId === null ? contract.stages.map(s => s.stageId) : contract.stages.find(s => s.stageId === subject.stageId).dependsOnStageIds;
    return Object.freeze(ids.map(stageId => intentHostSubjectOwner({ ...subject, stageId })));
}
export function intentOriginalRegistrationHash(raw) { return createHash('sha256').update('xiaok-intent-original-registration-v1\0').update(json(raw)).digest('hex'); }
export function parseIntentContractRegistrationObservation(raw) {
    const d = applicationDataDescriptors(raw, 5, 'intent_registration_shape');
    if (Array.isArray(raw) || Object.keys(d).sort().join(',') !== 'contract,contractHash,owner,registrationHash,subject')
        throw Error('intent_registration_shape');
    const binding = parseIntentContractEnrollment({ subject: d.subject.value, contract: d.contract.value }), mapped = intentHostSubjectOwner(binding.subject);
    const v = { ...binding, owner: captureApplicationData(d.owner.value, { maximumBytes: 4096, maximumNodes: 4096, invalid: 'intent_registration_data', limit: 'intent_registration_limit' }), contractHash: d.contractHash.value, registrationHash: d.registrationHash.value };
    if (!v.owner || Object.keys(v.owner).sort().join(',') !== 'ownerId,ownerKind,profileId' || v.owner.ownerKind !== mapped.ownerKind || v.owner.ownerId !== mapped.ownerId || typeof v.owner.profileId !== 'string' || !v.owner.profileId || Buffer.byteLength(v.owner.profileId) > 160 || /[\x00-\x1f\x7f]/.test(v.owner.profileId) || v.contractHash !== intentBusinessContractHash(binding.contract) || typeof v.registrationHash !== 'string' || !/^[a-f0-9]{64}$/.test(v.registrationHash))
        throw Error('intent_registration_binding');
    // Preserve this observation's original canonical number normalization only on accepted private data.
    const normalized = JSON.parse(json(v)), captured = parseIntentContractEnrollment({ subject: normalized.subject, contract: normalized.contract });
    return Object.freeze({ ...captured, owner: Object.freeze(normalized.owner), contractHash: normalized.contractHash, registrationHash: normalized.registrationHash });
}
/** Preflight the new enrollment branch before a JSON transport snapshot can drop symbol keys. */
export function assertIntentContractEnrollmentInput(raw) {
    if (!raw || typeof raw !== 'object')
        return;
    const descriptors = applicationDataDescriptors(raw, 65536, 'intent_enrollment_shape'), field = descriptors.intentContract;
    if (!field)
        return;
    parseIntentContractEnrollment(field.value);
}
export function assertIntentEnrollmentEnvelope(raw) {
    if (!raw || typeof raw !== 'object')
        return;
    const descriptor = applicationDataDescriptors(raw, 65536, 'intent_enrollment_shape').enrollment;
    if (descriptor && !('value' in descriptor))
        throw Error('intent_enrollment_shape');
    if (descriptor)
        assertIntentContractEnrollmentInput(descriptor.value);
}
/** Snapshot new read protocol data before serialization; never evaluate accessors. */
export function captureIntentRegistrationData(raw) {
    return captureApplicationData(raw, { maximumBytes: 65536, maximumNodes: 65536, maximumDepth: 128, invalid: 'intent_registration_data', limit: 'intent_registration_limit' });
}
/** Strict data only; the caller compares contractHash with its original durable contract. */
export function parseIntentRegistrationObservation(raw) {
    const v = captureIntentRegistrationData(raw);
    if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).sort().join(',') !== 'contractHash,owner,registration,registrationHash,subject')
        throw Error('intent_registration_shape');
    const subject = parseIntentHostSubject(v.subject), mapped = intentHostSubjectOwner(subject), registration = parseOwnerEnrollmentRegistration(v.registration);
    if (!v.owner || Object.keys(v.owner).sort().join(',') !== 'ownerId,ownerKind,profileId' || v.owner.ownerKind !== mapped.ownerKind || v.owner.ownerId !== mapped.ownerId || typeof v.owner.profileId !== 'string' || !v.owner.profileId || Buffer.byteLength(v.owner.profileId) > 160 || /[\x00-\x1f\x7f]/.test(v.owner.profileId) || typeof v.contractHash !== 'string' || !/^[a-f0-9]{64}$/.test(v.contractHash) || v.registrationHash !== intentOriginalRegistrationHash(registration))
        throw Error('intent_registration_binding');
    return Object.freeze({ owner: Object.freeze({ ...v.owner }), subject, contractHash: v.contractHash, registration, registrationHash: v.registrationHash });
}
