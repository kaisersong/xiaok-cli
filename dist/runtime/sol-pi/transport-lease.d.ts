export interface TransportDependency {
    readonly authority: object;
    readonly key: string;
    readonly epoch: number;
}
/** Host-only port: all mutations and this admission must share its lock domain. */
export interface TransportAuthorityPort {
    readonly authority: object;
    withAdmission<T>(operation: () => T): T;
    validate(snapshot: readonly TransportDependency[], destination: string): void;
    onRevoke(listener: () => void): () => void;
}
export interface TransportCapability {
    readonly opaqueTransportCapability: never;
}
export interface TransportRequest {
    invocationId: string;
    input: string;
    init: RequestInit;
}
export interface TransportAttempt {
    attemptId: string;
    response: Promise<Response>;
    finish(): void;
}
type FetchPort = (input: string, init: RequestInit) => Promise<Response>;
export declare function createTransportAuthorizationError(): Error;
export declare function isTransportAuthorizationError(error: unknown): boolean;
export declare function createTransportLeaseIssuer(port: TransportAuthorityPort): {
    issue(input: {
        invocationId: string;
        destination: string;
        serializedBody: string;
        dependencies: readonly TransportDependency[];
    }): TransportCapability;
    /** Holds owner drain during an asynchronous durable reservation. This is
     * not a physical transport attempt and never calls fetch. */
    holdAdmission(capability: TransportCapability, invocationId: string): Readonly<{
        signal: AbortSignal;
        finish(): void;
    }>;
    dispatch(capability: TransportCapability, request: TransportRequest, fetchImpl: FetchPort): TransportAttempt;
    dispose: () => void;
    /** Passive local transport drain. Admission is not closed by this method;
     * the host iteration window must prevent a new producer from dispatching. */
    waitForDrain(): Promise<void>;
    disposeAndDrain(): Promise<void>;
};
export {};
