/** Monetary quantities are integer billionths of the ledger currency. */
export interface SemanticBudgetPolicy {
    grantId: string;
    maxCalls: number;
    maxCostUnits: number;
    expiresAt: number;
}
export type SemanticReservationStatus = 'reserved' | 'dispatched' | 'settled' | 'unknown' | 'cancelled_before_dispatch';
export interface SemanticReservationInput {
    operationId: string;
    grantId: string;
    bodyDigest: string;
    sourceHistoryDigest: string;
    model: string;
    priceRevision: string;
    maximumCostUnits: number;
}
export interface SemanticReservation extends SemanticReservationInput {
    status: SemanticReservationStatus;
}
export interface SemanticCommit {
    operationId: string;
    sourceHistoryDigest: string;
    nextHistoryDigest: string;
    anchorDigest: string;
}
export interface SemanticCompactionLedger {
    version: 1;
    currency: string;
    generation: number;
    policies: SemanticBudgetPolicy[];
    reservations: SemanticReservation[];
    commits: SemanticCommit[];
}
export declare const SEMANTIC_LEDGER_LIMITS: Readonly<{
    policies: 16;
    reservations: 256;
    bytes: number;
}>;
/** Serialization validator, never a capability issuer. Untrusted input cannot authorize a write. */
export declare function validateSemanticCompactionLedger(value: unknown): SemanticCompactionLedger;
/** Persistent facts are append-only. Normal store.save must separately disallow mutations. */
export declare function mergeSemanticCompactionLedgers(previous: SemanticCompactionLedger | undefined, next: SemanticCompactionLedger | undefined): SemanticCompactionLedger | undefined;
export declare function reserveSemanticCompaction(ledger: SemanticCompactionLedger, input: SemanticReservationInput, now: number): SemanticCompactionLedger;
export declare function transitionSemanticReservation(ledger: SemanticCompactionLedger, operationId: string, status: SemanticReservationStatus): SemanticCompactionLedger;
export declare function commitSemanticCompaction(ledger: SemanticCompactionLedger, fact: SemanticCommit): SemanticCompactionLedger;
