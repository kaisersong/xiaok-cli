export type CompositeEgressState = 'PREPARING' | 'PREPARED' | 'DISPATCH_COMMITTED' | 'ABORTED_NO_DISPATCH' | 'SUCCEEDED' | 'FAILED_AFTER_DISPATCH' | 'UNKNOWN';
export interface CompositeEgressAttempt {
    attemptId: string;
    invocationId: string;
    bodySha256: string;
    destination: string;
    model: string;
    protocol: string;
    participants: readonly {
        authorityId: string;
        leaseId: string;
        evidenceSha256: string;
    }[];
    reservationSha256: string;
}
export interface CompositeEgressRecord extends CompositeEgressAttempt {
    state: CompositeEgressState;
    egressId: string;
    generation: number;
    bindingSha256: string;
}
/** Durable FACT journal only: this module neither authenticates participant evidence nor
 * grants permission to send/fence anything. The actual host coordinator must verify all
 * participant receipts and physical generation before writing a dispatch decision.
 * Reopening this database does not prove the previous TLS owner has stopped. */
export declare function createCompositeEgressJournal(options: {
    root: string;
    egressId: string;
    generation: number;
}): Readonly<{
    prepare(input: CompositeEgressAttempt): CompositeEgressRecord;
    query: (attemptId: string) => CompositeEgressRecord | undefined;
    markPrepared(attemptId: string): void;
    commitDispatch(attemptId: string): void;
    abortBeforeDispatch(attemptId: string): void;
    settle(attemptId: string, state: "SUCCEEDED" | "FAILED_AFTER_DISPATCH" | "UNKNOWN"): void;
    close(): void;
}>;
