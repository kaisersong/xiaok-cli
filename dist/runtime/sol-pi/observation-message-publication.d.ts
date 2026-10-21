import { type PublishedClosureReadAnchor, type ObservationClosedReadAnchor, type ObservationSessionOwner } from './observation-session-owner.js';
import type { ObservationDelegationApproval } from './observation-service.js';
export interface ObservationMessagePublication {
    readonly text: string;
    dispose(): void;
    commit<T>(actualOperationId: string, actualText: string, operation: (text: string) => T): T;
}
interface PublicationBinding extends ObservationMessagePublication {
    readonly sourceOwner: ObservationSessionOwner;
    readonly recipientOwner: ObservationSessionOwner;
    readonly operationId: string;
}
/** Final synchronous visibility boundary for an aggregate of already-published sources. */
export declare function withPublishedObservationMessages<T>(items: readonly ObservationMessagePublication[], operation: () => T, closedSources?: readonly {
    anchor: ObservationClosedReadAnchor;
    recipientOwner: ObservationSessionOwner;
}[], publishedSources?: readonly PublishedClosureReadAnchor[]): T;
/** Host service boundary: callback-shaped DTOs have no publication authority. */
export declare function getObservationMessagePublicationBinding(publication: ObservationMessagePublication): Readonly<PublicationBinding>;
/** Same-authority, host-only preparation. The returned admission has no JSON representation.
 * Its caller must use the exact recipient's synchronous durable journal operation.
 * This is not a cross-authority egress decision or a provider transport lease. */
export declare function prepareObservationMessagePublication(input: {
    sourceOwner: ObservationSessionOwner;
    recipientOwner: ObservationSessionOwner;
    approval: ObservationDelegationApproval;
    operationId: string;
    text: string;
    assertCurrent(): void;
}): Promise<ObservationMessagePublication>;
export {};
