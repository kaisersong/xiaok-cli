import { type ManagedCompoundAdmission } from './compound-managed-admission.js';
import type { Tool } from '../../types.js';
import type { ToolRegistry } from '../../ai/tools/index.js';
import type { AgentSessionState } from '../../ai/runtime/session.js';
import { type SessionStore } from '../../ai/runtime/session-store/store.js';
import { type SessionExecutionLease, type SessionExecutionAuthority } from '../../ai/runtime/session-store/execution-authority.js';
import { type SessionExecutionChain } from '../../ai/runtime/session-store/execution-chain.js';
import { createCompoundSessionJournal } from './compound-session-journal.js';
import { type ProviderAncestorAdmission } from './compound-provider-admission.js';
import { type ObservationSessionOwner } from './observation-session-owner.js';
import type { DirectOperationRecord } from './compound-direct-operation.js';
import type { CompoundValidationBackend } from './compound-validation.js';
import type { ProductCompoundCoordinator } from './product-compound-coordinator.js';
export interface CompoundTreeOwner {
    root: string;
    sessionIdentity: string;
    authority: SessionExecutionAuthority;
    journal: ReturnType<typeof createCompoundSessionJournal>;
    domain?: ReturnType<typeof import('./compound-execution-domain.js').openCompoundExecutionDomain>;
}
export interface CompoundParentAdmission {
    root: string;
    sessionIdentity: string;
    operationId: string;
    generation: number;
    store: SessionStore;
}
export interface BoundCompoundCoordinatorInput {
    owner: ObservationSessionOwner;
    recallTool: Tool;
    authority: SessionExecutionAuthority;
    executionSignal: AbortSignal;
    session: AgentSessionState;
    store: SessionStore;
    root: string;
    registry: ToolRegistry;
    journal: ReturnType<typeof createCompoundSessionJournal>;
    assertCurrent(): void;
    persistCurrentHistory(lease: SessionExecutionLease): Promise<void>;
    executionChain?: SessionExecutionChain;
    validationBackend?: CompoundValidationBackend;
    treeRoot?: CompoundTreeOwner;
    ancestors?: readonly CompoundParentAdmission[];
    providerAdmission?: ProviderAncestorAdmission;
    getActiveTurnOrigin?(): Readonly<{
        session: AgentSessionState;
        nativeInvocationId: string;
    }> | undefined;
    assertTurnCurrent?(snapshot: import('../../ai/runtime/session-store/store.js').PersistedSessionSnapshot): void;
}
/** Host-only common installation. It accepts an already durable exact parent
 * admission and authenticates the actual D1 owner/session; no tool context can
 * supply this installer or manufacture its live completion facts. */
export declare function createCompoundChildInstallation(input: {
    root: string;
    store: SessionStore;
    sessionIdentity: string;
    childSession: AgentSessionState;
    record: DirectOperationRecord;
    parent: CompoundParentAdmission;
    ancestors: readonly CompoundParentAdmission[];
    treeRoot: CompoundTreeOwner;
    chain: SessionExecutionChain;
    journal: ReturnType<typeof createCompoundSessionJournal>;
    executionSignal: AbortSignal;
    signal: AbortSignal;
    assertCurrent(): void;
    validationBackend?: CompoundValidationBackend;
    installCoordinator(input: BoundCompoundCoordinatorInput): ProductCompoundCoordinator;
    managedTurn?: {
        admission: ManagedCompoundAdmission;
        followup?: import('./compound-managed-followup.js').ManagedCompoundFollowupAdapter;
        turnId: string;
        initialMessage: string;
        assertApplied(): void;
        assertResourceCurrent(): void;
    };
}): Readonly<{
    install: (child: {
        owner: ObservationSessionOwner;
        session: AgentSessionState;
        registry: ToolRegistry;
        recallTool: Tool;
    }) => Promise<{
        assertTurnInput: (() => void) | undefined;
        prepareManagedFollowup: ((request: {
            preparation: unknown;
            pausedTicket: object;
        }) => Promise<Readonly<{
            commitApplied: (receipt: unknown) => Promise<void>;
            cancelBeforeApplied: (receipt: unknown) => Promise<void>;
        }>>) | undefined;
        prepareInitialTurn: (() => Promise<void>) | undefined;
        activateInitialTurn: (() => Promise<void>) | undefined;
        prepareManagedChild: (args: Parameters<ProductCompoundCoordinator["prepareManagedChild"]>[0]) => Promise<import("./compound-managed-lifecycle.js").PreparedManagedCompoundChild>;
        bindRegistry: (registry: ToolRegistry) => Promise<void>;
        dispose: () => Promise<void>;
    }>;
    assertLive(): void;
    hasInstalled: () => boolean;
    hasDrained: () => boolean;
}>;
