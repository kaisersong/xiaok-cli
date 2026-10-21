import { type PublishedArtifactSelection } from './published-artifact-reader.js';
import { type PublicationSource, type PublicationChallenge, type OwnerPublicationObservation } from './publication-client.js';
import type { VerificationOwner } from './proof-authority.js';
/** Fixed installed publisher, with no endpoint/profile/key override. This cannot
 * project a completion into a caller-owned legacy store. */
export declare function createInstalledCompletionPublisher(raw: Pick<VerificationOwner, 'ownerKind' | 'ownerId'>, requestSource: PublicationSource): Readonly<{
    readArtifact(observation: Readonly<OwnerPublicationObservation>, selection: PublishedArtifactSelection, signal?: AbortSignal): Promise<any>;
    readPayload(observation: Readonly<OwnerPublicationObservation>, signal?: AbortSignal): Promise<Readonly<import("./publication-client.js").PublishedPayload>>;
    observe(signal?: AbortSignal): Promise<Readonly<OwnerPublicationObservation>>;
    prepare(signal?: AbortSignal): Promise<Readonly<PublicationChallenge>>;
    prepareRequest(requestId: string, signal?: AbortSignal): Promise<Readonly<PublicationChallenge>>;
    lookupRequest(requestId: string, signal?: AbortSignal): Promise<Readonly<{
        state: "absent";
    }> | Readonly<{
        state: "not_prepared";
    }> | Readonly<{
        state: "prepared";
        challenge: Readonly<PublicationChallenge>;
    }>>;
    recoverRequest(requestId: string, signal?: AbortSignal): Promise<import("./publication-client.js").PublicationRequestRecovery>;
    approve(ticket: Readonly<PublicationChallenge>, signal?: AbortSignal): Promise<Readonly<import("./publication-client.js").PublicationObservation>>;
    reconcile(record: Readonly<PublicationChallenge>, signal?: AbortSignal): Promise<Readonly<import("./publication-client.js").PublicationObservation>>;
    recoverExpired(record: Readonly<PublicationChallenge>, signal?: AbortSignal): Promise<Readonly<import("./publication-client.js").PublicationObservation>>;
    dispose(): void;
}>;
