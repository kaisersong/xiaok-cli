import { type SessionExecutionAuthority, type SessionExecutionKind, type SessionExecutionLease } from './execution-authority.js';
/** Host-issued ancestry, never deserialized from tool input or restored JSON. */
export interface SessionExecutionChain {
    readonly opaqueSessionExecutionChain: true;
}
interface Target {
    root: string;
    sessionIdentity: string;
    authority: SessionExecutionAuthority;
}
/** Inspect only this exact currently held chain. A JSON path, another chain
 * over the same IDs, or a released/copied lease cannot authorize an ancestor
 * exception in the canonical tree census. */
export declare function getHeldSessionExecutionChainPath(chain: SessionExecutionChain, childLease: SessionExecutionLease): readonly Readonly<{
    root: string;
    sessionIdentity: string;
}>[];
/** Retrieve an already-held ancestor for root budget CAS. Never acquires a
 * second lock and never treats a copied lease or caller-supplied ID as proof. */
export declare function getSessionExecutionAncestorLease(childLease: SessionExecutionLease, target: {
    root: string;
    sessionIdentity: string;
}): SessionExecutionLease;
/** Extend only an existing host chain, preserving oldest-ancestor-first order.
 * validate reads exact durable admission while this ancestor's real lease is held.
 * It must not perform user approval, dispatch physical effects or acquire children. */
export declare function createSessionExecutionChain(input: {
    target: Target;
    parent?: SessionExecutionChain;
    validate?: (lease: SessionExecutionLease) => Promise<void> | void;
    validatePublication?: (lease: SessionExecutionLease) => Promise<void> | void;
}): SessionExecutionChain;
export declare function assertSessionExecutionChainLeaf(chain: SessionExecutionChain, target: {
    authority: SessionExecutionAuthority;
    sessionIdentity: string;
}): void;
export declare function assertSessionExecutionChainRoot(chain: SessionExecutionChain, target: {
    authority: SessionExecutionAuthority;
    sessionIdentity: string;
}): void;
export declare function assertSessionExecutionChainParents(chain: SessionExecutionChain, parents: readonly {
    root: string;
    sessionIdentity: string;
}[]): void;
export interface AcquiredSessionExecutionChain extends SessionExecutionLease {
    readonly childLease: SessionExecutionLease;
}
/** Only effects use this scope. SDK/UI/whole-child waits must stay outside it. */
export declare function acquireSessionExecutionChain(chain: SessionExecutionChain, input: {
    invocationId: string;
    kind: SessionExecutionKind;
    signal?: AbortSignal;
    assertAdmission?: () => void;
}): Promise<AcquiredSessionExecutionChain>;
/** Host-only factual finalization after revocation. Mutual exclusion is not
 * execution authority: consumers must expose only exact previously issued
 * terminal-fact ports and must never dispatch tools with this scope. */
export declare function acquireSessionExecutionFactChain(chain: SessionExecutionChain, input: {
    invocationId: string;
}): Promise<AcquiredSessionExecutionChain>;
/** Actual coordinator publication only; the original chain fixes validators. */
export declare function acquireSessionPublicationChain(chain: SessionExecutionChain, input: {
    invocationId: string;
    signal?: AbortSignal;
}): Promise<AcquiredSessionExecutionChain>;
export {};
