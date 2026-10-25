import { type ProviderAncestorAdmission } from './compound-provider-admission.js';
import type { ObservationDestination } from './observation-service.js';
import { type TransportDependency, type createTransportLeaseIssuer } from './transport-lease.js';
import { type VerifiedCapacityProfile } from './capacity-admission.js';
import { type FullSendCounterPort } from './full-send-counter.js';
interface FullSendBinding {
    counter: FullSendCounterPort;
    observationIds: readonly string[];
}
export interface ProviderDisclosureContext {
    readonly opaqueProviderDisclosure: never;
}
interface AncestorBinding {
    capability: ProviderAncestorAdmission;
    destination: ObservationDestination;
    closureDigest: string;
}
export declare function createProviderDisclosureContext(input: {
    ancestorAdmission?: AncestorBinding;
    /** Host-built exact wire bytes bound to projection and full-send IDs. */
    expectedSerializedBody?: string;
    capacityProfile?: VerifiedCapacityProfile;
    fullSend?: FullSendBinding;
    issuer: ReturnType<typeof createTransportLeaseIssuer>;
    invocationId: string;
    destination: string;
    model: string;
    dependencies: readonly TransportDependency[];
}): ProviderDisclosureContext;
export declare function getProviderDisclosureSignal(context: ProviderDisclosureContext): AbortSignal;
export declare function assertProviderDisclosureActive(context: ProviderDisclosureContext): void;
export declare function disposeProviderDisclosureContext(context: ProviderDisclosureContext): void;
export declare function createProviderDisclosureFetch(context: ProviderDisclosureContext, rawFetch: typeof fetch): typeof fetch;
export {};
