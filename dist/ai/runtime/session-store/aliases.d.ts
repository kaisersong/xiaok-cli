export declare const SESSION_ALIAS_RESERVED_BYTES: number;
export interface SessionAliasBinding {
    aliasId: string;
    holderRoot: string;
    holderId: string;
    targetSessionId: string;
    domainInitializationId: string;
    domainGeneration: number;
}
export interface SessionAliasRow extends SessionAliasBinding {
    state: 'active' | 'release_pending' | 'released';
}
export declare function captureSessionAlias(value: SessionAliasBinding): SessionAliasBinding;
export declare function readSessionAliases(root: string): SessionAliasRow[];
/** Original index schema, shared with captured bytes without filesystem reads. */
export declare function parseSessionAliasRows(value: unknown): SessionAliasRow[];
export declare function reserveSessionAliasBytes(root: string, requested?: boolean): number;
/** Caller holds the shared FileSessionStore root mutation lock and actual target
 * execution lease. This low-level identity transaction does not issue grants. */
export declare function registerSessionAliasLocked(root: string, input: SessionAliasBinding): Readonly<{
    markerPath: string;
    binding: Readonly<SessionAliasBinding>;
}>;
export declare function releaseSessionAliasLocked(root: string, input: SessionAliasBinding): void;
export declare function assertNoSessionAliases(root: string, sessionId: string): void;
/** Read-only route. Missing/retired/uncertain marker never falls back to an old
 * holder snapshot and never produces an execution lease or writable store. */
export declare function readSessionAliasBinding(root: string, input: {
    holderRoot: string;
    holderId: string;
}): SessionAliasBinding | null;
