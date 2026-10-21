import type { SessionExecutionLease } from '../../ai/runtime/session-store/execution-authority.js';
import { type PersistedSessionSnapshot, type SessionStore } from '../../ai/runtime/session-store/store.js';
import { type ProductObservationPolicy } from './product-bootstrap.js';
import { type VerifiedCapacityProfile } from './capacity-admission.js';
import { type SemanticReservation } from './semantic-compaction-ledger.js';
import { type SemanticSnapshotCandidate } from './semantic-snapshot.js';
export interface SemanticSummaryAttempt {
    readonly opaqueSemanticSummaryAttempt: never;
}
interface Input {
    policy: ProductObservationPolicy;
    store: SessionStore;
    lease: SessionExecutionLease;
    logicalInvocationId?: string;
    sessionId: string;
    sourceSnapshot: PersistedSessionSnapshot;
    operationId: string;
    destination: string;
    serializedBody: string;
    capacityProfile: VerifiedCapacityProfile;
    signal?: AbortSignal;
    assertBoundaryCurrent?: () => void;
}
/** Host-only budget barrier. A serialized/restored policy cannot mint an attempt. */
export declare function prepareSemanticSummaryAttempt(input: Input): Promise<SemanticSummaryAttempt>;
/** Actual adapter path. Test counter capabilities never produce a live provider transport. */
export declare function resolveSemanticSummaryAttempt(attempt: SemanticSummaryAttempt): {
    fetch: typeof fetch;
    maxOutputTokens: number;
};
/** Failure remains charged. This never rewrites conversation history or refunds money. */
export declare function finishSemanticSummaryAttempt(attempt: SemanticSummaryAttempt, status: 'settled' | 'unknown'): Promise<PersistedSessionSnapshot>;
/** Commit only a host-built strict candidate; budget was already persisted independently. */
export declare function commitSemanticSummarySnapshot(attempt: SemanticSummaryAttempt, candidate: SemanticSnapshotCandidate): Promise<PersistedSessionSnapshot>;
/** Borrowing is confined to the original summary runner's dynamic extent. The
 * caller never receives a lease from a getter or a serialized reservation. */
export interface SemanticSummaryProviderScope {
    readonly opaqueSemanticSummaryProviderScope: true;
}
export declare function withSemanticSummaryProviderScope<T>(attempt: SemanticSummaryAttempt, work: () => Promise<T>): Promise<T>;
export declare function reserveActiveSemanticSummaryProviderScope(facts: {
    sessionIdentity: string;
    logicalInvocationId: string;
    serializedBodySha256: string;
    destination: string;
}): SemanticSummaryProviderScope | undefined;
export declare function inspectSemanticSummaryProviderLease(scope: SemanticSummaryProviderScope, visit: (lease: SessionExecutionLease) => void): void;
export declare function matchesSemanticSummaryProviderReservation(scope: SemanticSummaryProviderScope, snapshot: PersistedSessionSnapshot, reservation: SemanticReservation, lease: SessionExecutionLease): boolean;
export declare function consumeSemanticSummaryProviderScope(scope: SemanticSummaryProviderScope): void;
export declare function settleSemanticSummaryProviderScope(scope: SemanticSummaryProviderScope, state: 'drained' | 'unknown' | 'cancelled_before_send'): void;
export {};
