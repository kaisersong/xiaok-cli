import type { SemanticSummaryProviderScope } from './semantic-summary-attempt.js';
import type { CompoundOperationRecord } from './compound-operation.js';
import type { PersistedSessionSnapshot } from '../../ai/runtime/session-store/store.js';
import type { AgentSessionState } from '../../ai/runtime/session.js';
import type { CompoundRegistryExecutionPort } from '../../ai/tools/index.js';
import { type SessionExecutionChain } from '../../ai/runtime/session-store/execution-chain.js';
import { type SessionExecutionLease } from '../../ai/runtime/session-store/execution-authority.js';
import { type SessionStore } from '../../ai/runtime/session-store/store.js';
import { type ManagedCompoundAdmission } from './compound-managed-admission.js';
import { type DirectOperationRecord } from './compound-direct-operation.js';
import { createCompoundChildInstallation, type BoundCompoundCoordinatorInput, type CompoundTreeOwner } from './compound-child-installation.js';
import type { ProductCompoundCoordinator } from './product-compound-coordinator.js';
import type { ObservationSessionOwner } from './observation-session-owner.js';
type Request = Parameters<CompoundRegistryExecutionPort['execute']>[0];
type WithLease = <T>(callback: (lease: SessionExecutionLease) => Promise<T>, signal?: AbortSignal) => Promise<T>;
type Installation = ReturnType<typeof createCompoundChildInstallation>;
export interface PreparedManagedCompoundChild {
    readonly admission: ManagedCompoundAdmission;
    readonly installChildExecution: Installation['install'];
    onResourcesReleased(receipt: unknown): Promise<void>;
    readonly persistence: Readonly<{
        root: string;
        store: SessionStore;
    }>;
}
export interface PrepareManagedCompoundChildInput {
    preparation: unknown;
    childSession: AgentSessionState;
    /** Fixed main bootstrap registration; never passed in a model/tool context. */
    registerPersistence?(input: Readonly<{
        admission: ManagedCompoundAdmission;
        lease: SessionExecutionLease;
    }>): Promise<void>;
}
/** Issued only by the actual coordinator lifecycle, never from an owner-shaped
 * DTO or a caller-selected tree. Ordinary owners have no compound producer. */
export declare function getCompoundPublicationOwnerBinding(owner: ObservationSessionOwner): Readonly<{
    session: AgentSessionState;
    tree: CompoundTreeOwner;
    providerAdmission?: import("./compound-provider-admission.js").ProviderAncestorAdmission;
    assertCurrent(): void;
}> | undefined;
/** Read-only consumer of actual lifecycle registrations; no public registration
 * callback, serialized tree, or caller-named "live" method issues supervision. */
export declare function assertManagedCompoundBranchesCurrent(tree: CompoundTreeOwner, lease: SessionExecutionLease): () => void;
/** Preparation-only inspection. The caller has just authenticated Main's
 * original preparation; the lifecycle still verifies the actual in-flight
 * metadata invocation before allowing that one row in the complete census. */
export declare function captureCompoundFollowupPreparationSupervision(tree: CompoundTreeOwner, lease: SessionExecutionLease, origin?: Readonly<{
    session: AgentSessionState;
    nativeInvocationId: string;
}>): () => void;
export declare function captureCompoundExistingBranchSupervision(tree: CompoundTreeOwner, chain: SessionExecutionChain, leafLease: SessionExecutionLease, candidate?: PersistedSessionSnapshot, record?: DirectOperationRecord | CompoundOperationRecord): () => void;
export declare function captureCompoundSemanticSupervision(tree: CompoundTreeOwner, lease: SessionExecutionLease, semanticScope: SemanticSummaryProviderScope): () => void;
/** One actual final-authorized native invocation owns this scope. Async work
 * retaining an ALS store after native return cannot allocate another child. */
export declare function createManagedCompoundLifecycle(input: BoundCompoundCoordinatorInput & {
    chain: SessionExecutionChain;
    treeRoot: CompoundTreeOwner;
    installCoordinator(input: BoundCompoundCoordinatorInput): ProductCompoundCoordinator;
    hasPendingEffects(ledger: import('./compound-operation.js').CompoundOperationLedger, lease?: SessionExecutionLease): boolean;
    captureBranches(lease: SessionExecutionLease): () => void;
}): Readonly<{
    registerNamed(record: DirectOperationRecord, installation: Installation): void;
    execute(request: Request, inputHash: string, signal: AbortSignal, withLease: WithLease, settlePrepared: (id: string, outcome: "cancelled" | "denied" | "invalid") => Promise<void>, permissionGeneration: number): Promise<string>;
    prepareManagedChild(args: PrepareManagedCompoundChildInput): Promise<PreparedManagedCompoundChild>;
    publish(lease: SessionExecutionLease): Promise<void>;
}>;
export {};
