import type { ManagedCompoundAdmission } from './compound-managed-admission.js';
import type { Tool } from '../../types.js';
import type { ObservationSessionOwner } from './observation-session-owner.js';
import type { AgentSessionState } from '../../ai/runtime/session.js';
/** Main-owned preparation facts. The actual service getter authenticates its
 * opaque preparation before returning these; this shape is not a capability. */
export interface ManagedCompoundPreparationFacts {
    readonly groupId: string;
    readonly agentId: string;
    readonly rootEpoch: number;
    readonly operationId: string;
    readonly nativeInvocationId: string;
    readonly childSessionId: string;
    readonly childSession: AgentSessionState;
    /** Actual Main child context identity/input; becomes mandatory when the turn
     * admission installer is enabled. Never derived from the parent's tool ID. */
    readonly childTurnId?: string;
    readonly initialMessage?: string;
    readonly sourceOwner: ObservationSessionOwner;
    readonly ackBytes: string;
}
export interface ManagedCompoundSpawnAdapter {
    readonly followup?: import('./compound-managed-followup.js').ManagedCompoundFollowupAdapter;
    inspectPreparation(preparation: unknown): Readonly<ManagedCompoundPreparationFacts>;
    inspectResourcesReleased?(receipt: unknown): Readonly<{
        admission: ManagedCompoundAdmission;
        closedSnapshotDigest: string;
    }>;
    assertAdmissionCurrent?(admission: ManagedCompoundAdmission): void;
    assertManagedResourceCurrent?(admission: ManagedCompoundAdmission): void;
}
/** Main factory only, applied to the final scope wrapper. This is classification
 * for the coordinator's native path, never a permission bypass or readonly tag. */
export declare function bindManagedCompoundSpawnTool(tool: Tool, adapter: ManagedCompoundSpawnAdapter): Tool;
export declare function getManagedCompoundSpawnAdapter(tool: Tool): Readonly<ManagedCompoundSpawnAdapter> | undefined;
