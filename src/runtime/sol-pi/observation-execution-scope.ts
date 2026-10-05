import { isAuthorizedDelegatedObservationHandoff } from './delegated-session-owner.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { ProviderDisclosureContext } from './provider-disclosure.js';
import { createTransportAuthorizationError } from './transport-lease.js';

function authorizationFailure(reason: string): Error {
  const error = createTransportAuthorizationError();
  error.message += `:${reason}`;
  return error;
}

/** Supplied by a host session owner, never by tool arguments or persisted DTOs. */
export interface ObservationExecutionOwner {
  prepareProviderDisclosure(): ProviderDisclosureContext | undefined;
  ownsDisclosure(context: object): boolean;
  hasDependencies(): boolean;
}

const executionOwner = new AsyncLocalStorage<ObservationExecutionOwner | undefined>();

/** Wrap the entire awaited run/iterator consumption, not just iterator creation. */
export function withObservationExecutionOwner<T>(owner: ObservationExecutionOwner | undefined, operation: () => T): T {
  const inherited = executionOwner.getStore();
  if (inherited && inherited !== owner && inherited.hasDependencies()
    && (!owner || !isAuthorizedDelegatedObservationHandoff(inherited, owner))) {
    throw authorizationFailure('SOL_PI_PROTECTED_HANDOFF_NOT_READY');
  }
  return executionOwner.run(owner, operation);
}

export function hasObservationExecutionOwner(): boolean { return executionOwner.getStore() !== undefined; }

export function resolveObservationProviderDisclosure(explicit?: ProviderDisclosureContext): ProviderDisclosureContext | undefined {
  const owner = executionOwner.getStore();
  if (!owner) return explicit;
  if (explicit !== undefined) {
    if (explicit === null || typeof explicit !== 'object' || !owner.ownsDisclosure(explicit)) {
      throw authorizationFailure('SOL_PI_DISCLOSURE_OWNER_MISMATCH');
    }
    return explicit;
  }
  return owner.prepareProviderDisclosure();
}
