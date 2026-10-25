import type { createProfileDisclosureLedger } from './profile-disclosure-ledger.js';
import type { Tool } from '../../types.js';
import { ToolRegistry } from '../../ai/tools/index.js';
import type { AgentSessionState, AgentSessionSnapshot } from '../../ai/runtime/session.js';
import { createObservationSessionOwner, type ObservationSessionOwner } from './observation-session-owner.js';
import type { ObservationCaller, ObservationDelegation, ObservationDelegationApproval } from './observation-service.js';
type BaseOptions = Parameters<typeof createObservationSessionOwner>[0];
/** Host-only creation. Returned owners are ready only after durable consumer publication.
 * Its ALS handoff is limited to the exact parent. It does not authorize restricted tools or OS execution. */
export declare function createDelegatedObservationSessionOwner(options: Omit<BaseOptions, 'caller' | 'fullSendCounter'> & {
    disclosureLedger?: ReturnType<typeof createProfileDisclosureLedger>;
    captureApproval?: {
        approval: ObservationDelegationApproval;
        approver: ObservationCaller;
    };
    parentOwner: ObservationSessionOwner;
    capability: ObservationDelegation;
    recipient: ObservationCaller;
    registry: ToolRegistry;
    allowedNativeToolNames?: readonly string[];
}): Promise<ObservationSessionOwner>;
export declare function assertDelegatedObservationOwner(owner: ObservationSessionOwner, session: AgentSessionState, registry: ToolRegistry): void;
/** Only this frozen host view may seed a delegated conversation. Apply the actual
 * provider's completed-prefix/synthesized projection before setting messages. */
export declare function getDelegatedObservationHandoff(owner: ObservationSessionOwner): AgentSessionSnapshot;
export declare function isAuthorizedDelegatedObservationHandoff(parent: object, child: object): boolean;
/** A host-local, single-consumer plan. A serialized option or tool argument has no authority. */
export type DelegatedObservationExecutionPlan = object;
export interface DelegatedChildExecutionInstallation {
    prepareManagedFollowup?(input: {
        preparation: unknown;
        pausedTicket: object;
    }): Promise<import('./compound-managed-followup.js').PreparedManagedCompoundFollowup>;
    assertTurnInput?(): void;
    prepareInitialTurn?(): Promise<void>;
    activateInitialTurn?(): Promise<void>;
    prepareManagedChild?: import('./product-compound-coordinator.js').ProductCompoundCoordinator['prepareManagedChild'];
    dispose(): Promise<void>;
    bindRegistry(registry: ToolRegistry): Promise<void>;
}
type ExecutionPlanOptions = Omit<Parameters<typeof createDelegatedObservationSessionOwner>[0], 'registry'> & {
    /** Host plan factory only. Installs the child's own effect journal/authority before any execution. */
    installChildExecution?: (input: Readonly<{
        owner: ObservationSessionOwner;
        session: AgentSessionState;
        registry: ToolRegistry;
        recallTool: Tool;
    }>) => Promise<DelegatedChildExecutionInstallation>;
};
export declare function createDelegatedObservationExecutionPlan(options: ExecutionPlanOptions): DelegatedObservationExecutionPlan;
export declare function consumeDelegatedObservationExecutionPlan(plan: DelegatedObservationExecutionPlan, registry: ToolRegistry): Promise<Readonly<{
    owner: ObservationSessionOwner;
    execution: DelegatedChildExecutionInstallation | undefined;
    recallTool: Tool;
    session: AgentSessionState;
    source: AgentSessionSnapshot;
    complete: (result: string) => Promise<string>;
}>>;
export declare function suspendDelegatedObservationOwner(owner: ObservationSessionOwner, registry: ToolRegistry): Promise<object>;
/** Host-only observation; does not consume or reactivate the original ticket. */
export declare function assertDelegatedObservationPaused(owner: ObservationSessionOwner, ticket: object): void;
export declare function resumeDelegatedObservationOwner(ticket: object, registry: ToolRegistry): void;
export declare function publishDelegatedObservationResult(owner: ObservationSessionOwner, result: string, approval?: ObservationDelegationApproval): Promise<string>;
export {};
