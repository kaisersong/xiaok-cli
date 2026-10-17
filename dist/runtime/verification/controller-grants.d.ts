export type ControllerRequestSource = 'user' | 'agent' | 'scheduler';
export interface ControllerGrant {
    readonly id: string;
    readonly secret: string;
}
export interface ControllerCaller {
    readonly principalId: string;
    readonly requestSource: ControllerRequestSource;
    readonly grantId: string;
}
/** issue/revoke are host-private and must NEVER be registered as client RPC methods. */
export declare class ControllerGrantStore {
    private readonly db;
    private closed;
    constructor(root: string);
    /** Raw host time input must come from the daemon's qualified clock; this store cannot qualify clocks. */
    private observeClock;
    issue(input: {
        principalId: string;
        requestSource: ControllerRequestSource;
        method: string;
        payload: unknown;
        expiresAt: number;
    }, now: number): ControllerGrant;
    /** Expiry frees active slots only; minimum operation/source/outcome audit is retained permanently. */
    collectExpired(now: number): void;
    consume(grant: ControllerGrant, method: string, payload: unknown, now: number): ControllerCaller;
    revokePrincipal(principalId: string): void;
    close(): void;
}
