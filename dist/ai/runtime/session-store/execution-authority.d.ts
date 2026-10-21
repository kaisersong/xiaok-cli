export interface SessionExecutionClaims {
    requestSource: 'user' | 'agent' | 'scheduler';
    ownerId: string;
    scopeId: string;
}
export interface SessionExecutionContext {
    readonly opaqueSessionExecutionContext: true;
}
/** Host bootstrap only. Never exposed as a tool or IPC deserializer. */
export declare function createSessionExecutionContext(claims: SessionExecutionClaims): SessionExecutionContext;
/** Read-only host identity check. This does not create an execution lease. */
export declare function assertSessionExecutionContext(context: SessionExecutionContext, expected: SessionExecutionClaims): void;
export type SessionExecutionKind = 'compound' | 'direct-mutation' | 'compaction' | 'recovery';
export interface SessionExecutionLease {
    assertCurrent(): void;
    /** Register host work before awaiting it; release cannot unlock while it runs. */
    trackInFlight<T>(work: Promise<T>): Promise<T>;
    releaseAfterDrain(): Promise<void>;
}
export interface SessionExecutionAuthority {
    acquire(input: {
        invocationId: string;
        kind: SessionExecutionKind;
        signal?: AbortSignal;
        assertAdmission?: () => void;
    }): Promise<SessionExecutionLease>;
    dispose(): void;
}
export declare function assertSessionExecutionLease(lease: SessionExecutionLease, target: {
    root: string;
    sessionIdentity: string;
    requestSource?: SessionExecutionClaims['requestSource'];
    kind?: SessionExecutionKind;
    allowedKinds?: readonly SessionExecutionKind[];
}): void;
export declare function createSessionExecutionAuthority(options: {
    root: string;
    sessionIdentity: string;
    hostContext: SessionExecutionContext;
}): SessionExecutionAuthority;
/** Store writer guard. Synchronous and non-waiting: never waits for an execution
 * lock while holding a store transaction. Ordinary sessions without a registered
 * execution lock retain the optional-native startup behavior. */
export declare function acquireSessionStoreExecutionGuard(rootDirectory: string, sessionIdentity: string, lease?: SessionExecutionLease, rootLockHeld?: boolean): () => void;
