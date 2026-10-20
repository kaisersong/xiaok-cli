const definitive = new WeakSet();
/** A concrete original policy mismatch, unlike failure to obtain current proof. */
export function definitivePolicyDenial() {
    const error = new Error('not_readable');
    definitive.add(error);
    return error;
}
export function isDefinitivePolicyDenial(error) { return error instanceof Error && definitive.has(error); }
/** Preserve the public denial contract while retaining availability semantics
 * across recursive source checks. This error never authorizes a read. */
export class ContinuityPolicyUnavailable extends Error {
    reason;
    code = 'continuity_policy_unavailable';
    constructor(reason, options) {
        super('not_readable', options);
        this.reason = reason;
        this.name = 'ContinuityPolicyUnavailable';
    }
}
