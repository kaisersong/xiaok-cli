import type { ProviderDisclosureContext } from './provider-disclosure.js';
/** Supplied by a host session owner, never by tool arguments or persisted DTOs. */
export interface ObservationExecutionOwner {
    prepareProviderDisclosure(): ProviderDisclosureContext | undefined;
    ownsDisclosure(context: object): boolean;
    hasDependencies(): boolean;
}
/** Wrap the entire awaited run/iterator consumption, not just iterator creation. */
export declare function withObservationExecutionOwner<T>(owner: ObservationExecutionOwner | undefined, operation: () => T): T;
export declare function hasObservationExecutionOwner(): boolean;
export declare function resolveObservationProviderDisclosure(explicit?: ProviderDisclosureContext): ProviderDisclosureContext | undefined;
