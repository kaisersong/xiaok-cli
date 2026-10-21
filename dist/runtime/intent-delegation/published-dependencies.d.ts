import { type IntentHostSubject } from '../verification/intent-host-subject.js';
import { type ActiveIntentApplicationBinding } from '../verification/business-application-binding.js';
import type { IntentContractRegistrationObservation } from '../verification/intent-contract-enrollment.js';
import type { VerificationOwner } from '../verification/proof-authority.js';
import type { ReceiverClockEvidence } from '../verification/receiver-store.js';
export interface CurrentIntentDependencyPublication {
    readonly owner: Readonly<VerificationOwner>;
    readonly registration: Readonly<IntentContractRegistrationObservation>;
    readonly application: Readonly<ActiveIntentApplicationBinding>;
    readonly operationId: string;
    readonly fullTupleHash: string;
    readonly businessRevision: number;
    readonly payloadHash: string;
    readonly bytes: Buffer;
    readonly receiverId: string;
    readonly receiverProtocolVersion: 1;
    readonly receiverInstanceEpoch: number;
}
/** Existing SDK dependency gate deliberately excludes the subject itself. */
export declare function readCurrentIntentPublicationDependencies(raw: Readonly<IntentHostSubject>, signal?: AbortSignal): Promise<Readonly<{
    subject: Readonly<IntentHostSubject>;
    registration: Readonly<IntentContractRegistrationObservation>;
    clock: Readonly<ReceiverClockEvidence>;
    publications: readonly Readonly<CurrentIntentDependencyPublication>[];
    scope?: "self-and-dependencies" | undefined;
}>>;
/** Fixed whole completion read: self and every registered dependency, one final controller clock. Not a write grant. */
export declare function readCurrentIntentPublicationCompletion(raw: Readonly<IntentHostSubject>, signal?: AbortSignal): Promise<Readonly<{
    subject: Readonly<IntentHostSubject>;
    registration: Readonly<IntentContractRegistrationObservation>;
    clock: Readonly<ReceiverClockEvidence>;
    publications: readonly Readonly<CurrentIntentDependencyPublication>[];
    scope?: "self-and-dependencies" | undefined;
}>>;
