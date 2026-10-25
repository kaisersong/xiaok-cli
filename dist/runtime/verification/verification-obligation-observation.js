import { canonicalVerificationJson as json } from './protocol.js';
import { businessApplicationOwner, parseActiveBusinessApplicationBinding } from './business-application-binding.js';
function fields(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== keys.sort().join(','))
        throw Error('verification_observation_shape');
}
function id(value) {
    if (typeof value !== 'string' || !value || Buffer.byteLength(value) > 160 || /[\x00-\x1f\x7f]/.test(value))
        throw Error('verification_observation_identity');
}
export function parseVerificationObligationQuery(raw) {
    const encoded = json(raw);
    if (Buffer.byteLength(encoded) > 4096)
        throw Error('verification_observation_size');
    const value = JSON.parse(encoded);
    fields(value, ['invocation', 'obligationId']);
    fields(value.invocation, ['sessionIdentity', 'compoundOperationId', 'validationInvocationId']);
    Object.values(value.invocation).forEach(id);
    id(value.obligationId);
    return Object.freeze({ invocation: Object.freeze({ ...value.invocation }), obligationId: value.obligationId });
}
/** A current optimistic-CAS input, never proof, approval or execution authority. */
export function parseVerificationObligationObservation(raw) {
    const encoded = json(raw);
    if (Buffer.byteLength(encoded) > 1024 ** 2)
        throw Error('verification_observation_size');
    const value = JSON.parse(encoded);
    fields(value, ['owner', 'obligationId', 'definitionHash', 'attemptEpoch', 'activeAttemptId', 'application']);
    fields(value.owner, ['profileId', 'ownerKind', 'ownerId']);
    id(value.owner.profileId);
    id(value.owner.ownerId);
    if (!['task', 'intent', 'goal', 'loop', 'project'].includes(value.owner.ownerKind))
        throw Error('verification_observation_owner');
    id(value.obligationId);
    if (typeof value.definitionHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.definitionHash) || !Number.isSafeInteger(value.attemptEpoch) || value.attemptEpoch < 0)
        throw Error('verification_observation_epoch');
    if (value.activeAttemptId !== null)
        id(value.activeAttemptId);
    if ((value.attemptEpoch === 0) !== (value.activeAttemptId === null))
        throw Error('verification_observation_epoch');
    fields(value.application, ['state', 'current', 'pendingTransitionId']);
    const app = value.application, active = app.current === null ? null : parseActiveBusinessApplicationBinding(app.current);
    if (app.state === 'pending')
        id(app.pendingTransitionId);
    else if (!['active', 'unbound'].includes(app.state) || app.pendingTransitionId !== null || (app.state === 'active') !== (active !== null))
        throw Error('verification_observation_application');
    if (active && json(businessApplicationOwner(active.binding)) !== json({ ownerKind: value.owner.ownerKind, ownerId: value.owner.ownerId }))
        throw Error('verification_observation_owner');
    return Object.freeze({ owner: Object.freeze({ ...value.owner }), obligationId: value.obligationId,
        definitionHash: value.definitionHash, attemptEpoch: value.attemptEpoch, activeAttemptId: value.activeAttemptId,
        application: Object.freeze({ state: app.state, current: active, pendingTransitionId: app.pendingTransitionId }) });
}
