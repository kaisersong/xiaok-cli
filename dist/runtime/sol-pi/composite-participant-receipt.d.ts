import { type KeyObject } from 'node:crypto';
export interface CompositeParticipantIdentity {
    readonly authorityId: string;
    readonly authorityGeneration: number;
    readonly instanceIncarnation: string;
    readonly keyId: string;
}
export interface CompositeParticipantExpectation {
    readonly egressId: string;
    readonly egressGeneration: number;
    readonly attemptId: string;
    readonly invocationId: string;
    readonly bodySha256: string;
    readonly destination: string;
    readonly model: string;
    readonly protocol: string;
}
export interface CompositeParticipantFacts extends CompositeParticipantIdentity, CompositeParticipantExpectation {
    readonly version: 1;
    readonly domain: 'xiaok.composite.participant.prepared.v1';
    readonly leaseId: string;
    readonly evidenceSha256: string;
}
declare const receiptBrand: unique symbol;
export interface CompositeParticipantReceipt {
    readonly [receiptBrand]: true;
}
export interface CompositeParticipantVerifier {
    verify(bytes: Buffer, expected: CompositeParticipantExpectation): CompositeParticipantReceipt;
}
/** Authenticity only. This module does not assert that the issuer holds a live
 * source lease or has a protected installation. The coordinator must also hold
 * the complete original manifest and the current deployment registration. */
export declare function createCompositeParticipantVerifier(registration: CompositeParticipantIdentity & {
    publicKey: KeyObject;
}): CompositeParticipantVerifier;
/** An authenticated PREPARED assertion cannot be used as an egress decision or fence. */
export declare function readCompositeParticipantReceipt(verifier: CompositeParticipantVerifier, receipt: CompositeParticipantReceipt): Readonly<CompositeParticipantFacts>;
export {};
