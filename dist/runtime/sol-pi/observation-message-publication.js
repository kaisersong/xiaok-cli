import { createHash } from 'node:crypto';
import { adoptDelegatedObservationClosure, getObservationSessionOwnerHostBinding, getObservationClosedReadBinding, getPublishedClosureReadBinding } from './observation-session-owner.js';
import { createTransportAuthorizationError } from './transport-lease.js';
const retained = new WeakMap();
/** Final synchronous visibility boundary for an aggregate of already-published sources. */
export function withPublishedObservationMessages(items, operation, closedSources = [], publishedSources = []) {
    const claims = [...items.map(item => { const entry = retained.get(item); if (!entry)
            reject(); return entry; }), ...closedSources.map(item => getObservationClosedReadBinding(item.anchor, item.recipientOwner)), ...publishedSources.map(getPublishedClosureReadBinding)];
    if (!claims.length)
        return operation();
    const service = claims[0].service;
    if (claims.some(entry => entry.service !== service))
        reject();
    return service.transportPort.withAdmission(() => { for (const entry of claims)
        entry.validate(); for (const entry of claims)
        entry.current(); const result = operation(); if (result && typeof result === 'object' && 'then' in result) {
        void Promise.resolve(result).catch(() => { });
        reject();
    } return result; });
}
const publications = new WeakMap();
/** Host service boundary: callback-shaped DTOs have no publication authority. */
export function getObservationMessagePublicationBinding(publication) {
    const binding = publications.get(publication);
    if (!binding)
        throw createTransportAuthorizationError();
    return binding;
}
function reject() { throw createTransportAuthorizationError(); }
function synchronous(check) {
    if (check.constructor?.name === 'AsyncFunction')
        reject();
    const result = check();
    if (result && (typeof result === 'object' || typeof result === 'function') && 'then' in result) {
        void Promise.resolve(result).catch(() => { });
        reject();
    }
    if (result !== undefined)
        reject();
}
function fingerprint(owner) {
    const binding = getObservationSessionOwnerHostBinding(owner);
    owner.assertSession(binding.session);
    return createHash('sha256').update(JSON.stringify({ generation: binding.session.getObservationRestoreGeneration(),
        revision: binding.session.planCompaction().sourceRevision, closure: binding.session.getProtectedObservationClosure() })).digest('hex');
}
/** Same-authority, host-only preparation. The returned admission has no JSON representation.
 * Its caller must use the exact recipient's synchronous durable journal operation.
 * This is not a cross-authority egress decision or a provider transport lease. */
export async function prepareObservationMessagePublication(input) {
    if (typeof input.operationId !== 'string' || !/^[A-Za-z0-9_.:-]{1,256}$/.test(input.operationId))
        reject();
    if (typeof input.text !== 'string' || Buffer.byteLength(input.text) > 65536 || typeof input.assertCurrent !== 'function')
        reject();
    input = Object.freeze({ ...input });
    synchronous(input.assertCurrent);
    const source = getObservationSessionOwnerHostBinding(input.sourceOwner), recipient = getObservationSessionOwnerHostBinding(input.recipientOwner);
    if (source.service !== recipient.service || input.sourceOwner === input.recipientOwner)
        reject();
    const state = { invalidated: false }, weakState = new WeakRef(state);
    const unsubscribe = source.service.transportPort.onRevoke(() => {
        const current = weakState.deref();
        if (current)
            current.invalidated = true;
        else
            unsubscribe();
    });
    const deadline = performance.now() + 300000;
    const timer = setTimeout(() => { const current = weakState.deref(); if (current)
        current.invalidated = true; unsubscribe(); }, 300000);
    timer.unref();
    const release = () => { clearTimeout(timer); unsubscribe(); };
    try {
        const sourceRevision = fingerprint(input.sourceOwner);
        const ids = source.session.getProtectedObservationClosure()?.observations.map(ref => ref.observationId) ?? [];
        const capability = source.service.issueDelegationMessage({ requestSource: 'agent', caller: source.caller, recipient: recipient.caller,
            approval: input.approval, observationIds: ids, destination: recipient.destination });
        source.service.attachDelegationReturn({ capability, recipient: recipient.caller });
        await adoptDelegatedObservationClosure(input.recipientOwner, input.sourceOwner);
        synchronous(input.assertCurrent);
        if (fingerprint(input.sourceOwner) !== sourceRevision)
            reject();
        const recipientRevision = fingerprint(input.recipientOwner), text = input.text;
        let consumed = false, committed = false, disposed = false;
        const publication = Object.freeze({ text, dispose() { consumed = true; disposed = true; release(); }, commit(actualOperationId, actualText, operation) {
                if (consumed)
                    reject();
                consumed = true;
                if (state.invalidated || performance.now() >= deadline || actualOperationId !== input.operationId || actualText !== text || typeof operation !== 'function' || operation.constructor?.name === 'AsyncFunction')
                    reject();
                return source.service.transportPort.withAdmission(() => {
                    synchronous(input.assertCurrent);
                    source.service.validateDelegationMessage({ capability, issuer: source.caller, recipient: recipient.caller, destination: recipient.destination });
                    if (fingerprint(input.sourceOwner) !== sourceRevision || fingerprint(input.recipientOwner) !== recipientRevision)
                        reject();
                    for (const id of ids) {
                        source.service.getReferenceMetadata(source.caller, id);
                        recipient.service.getReferenceMetadata(recipient.caller, id);
                    }
                    const result = operation(text);
                    if (result && (typeof result === 'object' || typeof result === 'function') && 'then' in result) {
                        void Promise.resolve(result).catch(() => { });
                        reject();
                    }
                    committed = true;
                    return result;
                });
            } });
        const binding = Object.freeze({ ...publication, sourceOwner: input.sourceOwner, recipientOwner: input.recipientOwner, operationId: input.operationId });
        const current = () => { if (!committed || disposed || state.invalidated || performance.now() >= deadline)
            reject(); };
        const retainedClaim = { service: source.service, current, validate() {
                current();
                synchronous(input.assertCurrent);
                source.service.validateDelegationMessage({ capability, issuer: source.caller, recipient: recipient.caller, destination: recipient.destination });
                if (fingerprint(input.sourceOwner) !== sourceRevision)
                    reject();
                input.recipientOwner.assertSession(recipient.session);
                for (const id of ids) {
                    source.service.getReferenceMetadata(source.caller, id);
                    recipient.service.getReferenceMetadata(recipient.caller, id);
                }
                current();
            } };
        publications.set(publication, binding);
        retained.set(publication, retainedClaim);
        retained.set(binding, retainedClaim);
        return publication;
    }
    catch (error) {
        release();
        throw error;
    }
}
