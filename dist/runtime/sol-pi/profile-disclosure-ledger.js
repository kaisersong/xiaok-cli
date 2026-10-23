import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';
import { createTransportAuthorizationError } from './transport-lease.js';
const accounts = new WeakMap();
const ledgerServices = new WeakSet();
function reject() { throw createTransportAuthorizationError(); }
/** No callback or serializable descriptor can turn a counter into a shared account. */
export function getProfileDisclosureAccountBinding(account, service, sessionId) {
    const binding = accounts.get(account);
    if (!binding)
        return undefined;
    if (binding.service !== service || binding.sessionId !== sessionId)
        reject();
    binding.validate();
    return binding;
}
/** One authority's existing counter is the sole durable writer. Accounts never
 * create files, reset observations, duplicate reservations, or close that writer.
 * Cross-authority egress must use participant receipts, not this in-process port. */
export function createProfileDisclosureLedger(options) {
    const { service, counter } = options;
    if (ledgerServices.has(service))
        reject();
    const budget = service.getStorageBudget(), storage = counter.getStorageReservation();
    const profileRoot = realpathSync(budget.profileRoot), counterRoot = realpathSync(storage.root);
    const child = relative(profileRoot, counterRoot);
    if (profileRoot !== budget.profileRoot || counterRoot !== storage.root || !child || isAbsolute(child)
        || child === '..' || child.startsWith(`..${sep}`) || child.split(sep)[0].toLowerCase() === 'observations'
        || storage.maximumBytes < 4 * 1024 * 1024 || storage.maximumBytes > budget.reservedBytes)
        reject();
    ledgerServices.add(service);
    let disposed = false;
    const consumers = new Set();
    return Object.freeze({
        createAccount(input) {
            if (disposed || input.requestSource !== 'user' || typeof input.sessionId !== 'string' || !input.sessionId
                || input.sessionId.length > 256 || consumers.size >= 256 || consumers.has(input.sessionId))
                reject();
            const { caller, sessionId } = input;
            const destination = Object.freeze({ ...input.destination });
            let closed = false;
            const validate = () => {
                if (disposed || closed)
                    reject();
                service.assertConsumerSession(caller, sessionId);
                service.getDelegatedReferences(caller, sessionId, destination);
                counter.getStorageReservation();
            };
            validate();
            const authorize = (id) => {
                validate();
                // This page is kept host-private; actual transport still verifies its own
                // frozen dependency set after the durable counter preparation.
                service.read({ caller, id, offset: 0, maxBytes: 4, destination });
            };
            const prepared = new Map();
            const namespace = (id) => createHash('sha256').update(JSON.stringify([service.authorityId, sessionId, id])).digest('hex');
            const signature = (attempt) => {
                if (typeof attempt.logicalInvocationId !== 'string' || !attempt.logicalInvocationId || attempt.logicalInvocationId.length > 256
                    || typeof attempt.serializedBody !== 'string' || !Array.isArray(attempt.observationIds) || !attempt.observationIds.length || attempt.observationIds.length > 128)
                    reject();
                return { digest: createHash('sha256').update(attempt.serializedBody).digest('hex'), ids: [...new Set(attempt.observationIds)].sort() };
            };
            const settlement = (attempt) => {
                const wanted = signature(attempt), prior = prepared.get(attempt.logicalInvocationId);
                if (!prior || prior.digest !== wanted.digest || JSON.stringify(prior.ids) !== JSON.stringify(wanted.ids))
                    reject();
                // Bookkeeping of already dispatched bytes must survive grant revocation.
                // It grants no new read/send, and can only settle this exact prepared body.
                counter.getStorageReservation();
                return { ...attempt, logicalInvocationId: namespace(attempt.logicalInvocationId), observationIds: wanted.ids };
            };
            const bound = (attempt) => {
                validate();
                if (typeof attempt.logicalInvocationId !== 'string' || !attempt.logicalInvocationId || attempt.logicalInvocationId.length > 256
                    || !Array.isArray(attempt.observationIds) || !attempt.observationIds.length || attempt.observationIds.length > 128)
                    reject();
                for (const id of attempt.observationIds)
                    authorize(id);
                const logicalInvocationId = namespace(attempt.logicalInvocationId);
                return { logicalInvocationId, serializedBody: attempt.serializedBody, observationIds: [...attempt.observationIds] };
            };
            const reservation = Object.freeze({ ...storage, sessionId });
            const account = Object.freeze({
                getStorageReservation() { validate(); return reservation; },
                registerNewObservation(id) {
                    authorize(id);
                    // Delegation may read a source's count; it cannot re-register that
                    // already captured source as a fresh zero-count child observation.
                    if (service.getReferenceMetadata(caller, id).sourceSessionId !== sessionId)
                        reject();
                    counter.registerNewObservation(id);
                },
                read(id) { authorize(id); return counter.read(id); },
                prepare(attempt) {
                    if (prepared.size >= 1024 && !prepared.has(attempt.logicalInvocationId))
                        reject();
                    const input = bound(attempt);
                    counter.prepare(input);
                    prepared.set(attempt.logicalInvocationId, signature(attempt));
                },
                confirm(attempt) { counter.confirm(settlement(attempt)); },
                markUnknown(attempt) { counter.markUnknown(settlement(attempt)); },
                dispose() { closed = true; },
            });
            consumers.add(sessionId);
            accounts.set(account, Object.freeze({ service, sessionId, sourceCounter: counter, validate }));
            return account;
        },
        dispose() { disposed = true; },
    });
}
