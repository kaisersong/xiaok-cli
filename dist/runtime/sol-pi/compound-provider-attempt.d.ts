import { type CompoundOperationLedger, type CompoundDispatchIdentity, type CompoundOperationTombstone } from './compound-operation.js';
export interface CompoundProviderAttemptInput {
    issuerIncarnation: string;
    logicalInvocationId: string;
    attemptIndex: 0 | 1 | 2;
    serializedBodySha256: string;
    destination: {
        provider: string;
        model: string;
        url: string;
    };
    closureDigest: string;
    parentAdmission?: {
        parentSessionIdentity: string;
        parentOperationId: string;
        generation: number;
    };
    rootAdmission?: {
        rootSessionIdentity: string;
        authorizationId: string;
        generation: number;
    };
}
export type ProviderTransportState = 'reserved' | 'drained' | 'cancelled_before_send' | 'unknown';
export interface CompoundProviderAttempt extends CompoundProviderAttemptInput {
    id: string;
    dispatch: CompoundDispatchIdentity;
    inputHash: string;
    requestHash: string;
    transportState: ProviderTransportState;
    reservation: {
        recordBytes: number;
        tombstoneBytes: number;
        tombstoneSlot: 1;
    };
}
export interface ProviderAttemptTombstoneBinding {
    logicalInvocationId: string;
    attemptIndex: 0 | 1 | 2;
    requestHash: string;
    transportState: 'drained' | 'cancelled_before_send';
}
/** Pure identity calculation shared by the root reservation and child record. */
export declare function getCompoundProviderAttemptIdentity(sessionIdentity: string, input: CompoundProviderAttemptInput): {
    dispatch: {
        sessionIdentity: string;
        hostProviderInvocationId: string;
        originalToolUseId: string;
    };
    inputHash: string;
};
export declare function validateProviderAttempt(r: unknown): asserts r is CompoundProviderAttempt;
export declare function validateProviderTombstone(t: CompoundOperationTombstone): void;
export declare function assertProviderAttemptTransition(previous: CompoundProviderAttempt, next: CompoundProviderAttempt): void;
export declare function reserveProviderAttempt(value: CompoundOperationLedger, sessionIdentity: string, input: CompoundProviderAttemptInput): {
    ledger: CompoundOperationLedger;
    reservationId: string;
    created: boolean;
    bindingHash: string;
};
/** Facts only: the host transport issuer must authenticate actual close or
 * irreversible cancellation-before-consume. This function grants no permission. */
export declare function settleProviderAttempt(value: CompoundOperationLedger, id: string, state: Exclude<ProviderTransportState, 'reserved'>): CompoundOperationLedger;
export declare function retireProviderAttempt(value: CompoundOperationLedger, id: string): CompoundOperationLedger;
