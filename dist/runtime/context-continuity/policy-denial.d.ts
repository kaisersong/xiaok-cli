/** A concrete original policy mismatch, unlike failure to obtain current proof. */
export declare function definitivePolicyDenial(): Error;
export declare function isDefinitivePolicyDenial(error: unknown): boolean;
/** Preserve the public denial contract while retaining availability semantics
 * across recursive source checks. This error never authorizes a read. */
export declare class ContinuityPolicyUnavailable extends Error {
    readonly reason: string;
    readonly code = "continuity_policy_unavailable";
    constructor(reason: string, options?: ErrorOptions);
}
