import { isAuthorizedDelegatedObservationHandoff } from './delegated-session-owner.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createTransportAuthorizationError } from './transport-lease.js';
function authorizationFailure(reason) {
    const error = createTransportAuthorizationError();
    error.message += `:${reason}`;
    return error;
}
const executionOwner = new AsyncLocalStorage();
/** Wrap the entire awaited run/iterator consumption, not just iterator creation. */
export function withObservationExecutionOwner(owner, operation) {
    const inherited = executionOwner.getStore();
    if (inherited && inherited !== owner && inherited.hasDependencies()
        && (!owner || !isAuthorizedDelegatedObservationHandoff(inherited, owner))) {
        throw authorizationFailure('SOL_PI_PROTECTED_HANDOFF_NOT_READY');
    }
    return executionOwner.run(owner, operation);
}
export function hasObservationExecutionOwner() { return executionOwner.getStore() !== undefined; }
export function resolveObservationProviderDisclosure(explicit) {
    const owner = executionOwner.getStore();
    if (!owner)
        return explicit;
    if (explicit !== undefined) {
        if (explicit === null || typeof explicit !== 'object' || !owner.ownsDisclosure(explicit)) {
            throw authorizationFailure('SOL_PI_DISCLOSURE_OWNER_MISMATCH');
        }
        return explicit;
    }
    return owner.prepareProviderDisclosure();
}
