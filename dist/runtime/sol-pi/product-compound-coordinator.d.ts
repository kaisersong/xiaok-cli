import type { CompoundValidationBackend } from './compound-validation.js';
import type { ToolRegistry } from '../../ai/tools/index.js';
import type { AgentSessionSnapshot, AgentSessionState } from '../../ai/runtime/session.js';
import { type SessionStore } from '../../ai/runtime/session-store/store.js';
import type { createProductObservationOwner } from './product-bootstrap.js';
import { type CompoundExecutionCoordinator } from './compound-execution-coordinator.js';
import { type PreparedManagedCompoundChild, type PrepareManagedCompoundChildInput } from './compound-managed-lifecycle.js';
type Product = Awaited<ReturnType<typeof createProductObservationOwner>>;
/** Only the actual installed root handle can request this fixed readonly check. */
export declare function assertProductIntentExecutionCurrent(handle: object, signal?: AbortSignal): Promise<void>;
/** Fixed actual factory port. No registration callback or store-selected writer. */
export declare function persistCompoundPublicationSnapshot(session: AgentSessionState, snapshot: AgentSessionSnapshot): Promise<void> | undefined;
export interface ProductCompoundCoordinator extends CompoundExecutionCoordinator {
    drainCurrentTurn(): Promise<void>;
    rebindRegistry(registry: ToolRegistry): Promise<void>;
    retireCurrentRegistry(restore: () => ToolRegistry | undefined): Promise<boolean>;
    prepareManagedChild(args: PrepareManagedCompoundChildInput): Promise<PreparedManagedCompoundChild>;
}
/** Shared CLI/Desktop main bootstrap; a serialized policy or tool readOnly label
 * is insufficient. Reuses the actual product owner and sole execution authority. */
export declare function installProductCompoundCoordinator(input: {
    product: Product;
    session: AgentSessionState;
    store: SessionStore;
    root: string;
    registry: ToolRegistry;
    executionChain?: import('../../ai/runtime/session-store/execution-chain.js').SessionExecutionChain;
    validationBackend?: CompoundValidationBackend;
}): Promise<ProductCompoundCoordinator | undefined>;
export {};
