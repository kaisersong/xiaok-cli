import { ownDataArrayPrototypeJoin, ownDataArrayPrototypeSort, ownDataBufferByteLength, ownDataNumberIsSafeInteger, ownDataObjectFreeze, ownDataObjectKeys, ownDataRegExpPrototypeTest } from './application-native-intrinsics.js';
import { applicationDataDescriptors } from './application-value-data.js';
import { canonicalVerificationJson as json } from './protocol.js';
import { parseGoalApplicationBinding, goalApplicationBindingHash } from './goal-application-binding.js';
import { parseLoopApplicationBinding, loopApplicationBindingHash } from './loop-application-binding.js';
import { parseIntentApplicationBinding, intentApplicationBindingHash } from './intent-application-binding.js';
import { intentHostSubjectOwner } from './intent-host-subject.js';
import { loopHostSubjectOwner } from './loop-host-subject.js';
/** Strict closed union of business values, never an approval or projection. */
export function parseBusinessApplicationBinding(raw) {
    const descriptors = applicationDataDescriptors(raw, 65536, 'intent_application_data'), kind = descriptors.kind?.value;
    if (typeof kind !== 'string')
        throw Error('business_application_kind');
    if (kind === 'intent')
        return parseIntentApplicationBinding(raw);
    if (kind === 'goal')
        return parseGoalApplicationBinding(raw);
    if (kind === 'loop')
        return parseLoopApplicationBinding(raw);
    throw Error('business_application_kind');
}
export function businessApplicationBindingHash(raw) {
    const binding = parseBusinessApplicationBinding(raw);
    return binding.kind === 'goal' ? goalApplicationBindingHash(binding) : binding.kind === 'loop' ? loopApplicationBindingHash(binding) : intentApplicationBindingHash(binding);
}
export function businessApplicationOwner(raw) {
    const binding = parseBusinessApplicationBinding(raw);
    return binding.kind === 'goal' ? ownDataObjectFreeze({ ownerKind: 'goal', ownerId: binding.goalId }) : binding.kind === 'loop' ? loopHostSubjectOwner(binding.subject) : intentHostSubjectOwner(binding.subject);
}
export function businessApplicationEpoch(raw) {
    const binding = parseBusinessApplicationBinding(raw);
    return binding.kind === 'goal' ? binding.epoch : binding.candidateRevision;
}
export function sameBusinessApplicationSubject(left, right) {
    const a = parseBusinessApplicationBinding(left), b = parseBusinessApplicationBinding(right);
    if (a.kind === 'goal' && b.kind === 'goal')
        return a.goalId === b.goalId && a.sessionId === b.sessionId;
    return ((a.kind === 'loop' && b.kind === 'loop') || (a.kind === 'intent' && b.kind === 'intent')) && json(a.subject) === json(b.subject);
}
export function parseActiveBusinessApplicationBinding(raw) {
    const descriptors = applicationDataDescriptors(raw, 3, 'intent_application_data');
    if (ownDataArrayPrototypeJoin(ownDataArrayPrototypeSort(ownDataObjectKeys(descriptors)), ',') !== 'binding,bindingHash,revision')
        throw Error('business_application_active');
    const bindingHash = descriptors.bindingHash.value, revision = descriptors.revision.value;
    if (typeof bindingHash !== 'string' || !ownDataRegExpPrototypeTest(/^[a-f0-9]{64}$/, bindingHash) || !ownDataNumberIsSafeInteger(revision) || revision < 1)
        throw Error('business_application_active');
    const binding = parseBusinessApplicationBinding(descriptors.binding.value), value = { binding, bindingHash, revision };
    const bindingBytes = ownDataBufferByteLength(json(binding));
    if (ownDataBufferByteLength(json(value)) > (binding.kind === 'intent' ? bindingBytes + 256 : 65536))
        throw Error('business_application_limit');
    if (bindingHash !== businessApplicationBindingHash(binding))
        throw Error('business_application_hash');
    return ownDataObjectFreeze(value);
}
