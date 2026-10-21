import type { SessionExecutionLease } from '../../ai/runtime/session-store/execution-authority.js';
import type { CompoundRegistryExecutionPort } from '../../ai/tools/index.js';
import type { BoundCompoundCoordinatorInput } from './compound-child-installation.js';
import { type DirectOperationRecord } from './compound-direct-operation.js';
import type { CompoundOperationLedger } from './compound-operation.js';
type Request = Parameters<CompoundRegistryExecutionPort['execute']>[0];
type WithLease = <T>(work: (lease: SessionExecutionLease) => Promise<T>, signal?: AbortSignal) => Promise<T>;
export declare function assertManagedFollowupInvocationCurrent(session: BoundCompoundCoordinatorInput['session'], row: DirectOperationRecord): void;
/** Main metadata side effects are admitted separately from physical child work.
 * The inspector is bound to the actual service operation by its final wrapper. */
export declare function createManagedCompoundMessages(input: BoundCompoundCoordinatorInput & {
    hasPendingEffects(ledger: CompoundOperationLedger, lease?: SessionExecutionLease): boolean;
    captureBranches(lease: SessionExecutionLease, ledger: CompoundOperationLedger): () => void;
}): Readonly<{
    execute(request: Request, inputHash: string, signal: AbortSignal, withLease: WithLease, settlePrepared: (id: string, outcome: "cancelled" | "denied" | "invalid") => Promise<void>, permissionGeneration: number, getPermissionRevision: () => number): Promise<string>;
    publish(lease: SessionExecutionLease): Promise<void>;
}>;
export {};
