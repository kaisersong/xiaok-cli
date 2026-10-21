export interface OrdinaryChildrenPolicy {
    readonly enabled: true;
    readonly maxDepth: number;
    readonly maxChildren: number;
    readonly expiresAt: number;
    readonly nativeTools: readonly string[];
}
/** Validation only. Parsed data is not a capability and does not authorize an agent. */
export declare function validateOrdinaryChildrenPolicy(input: unknown, now: number, parentExpiresAt: number): OrdinaryChildrenPolicy;
