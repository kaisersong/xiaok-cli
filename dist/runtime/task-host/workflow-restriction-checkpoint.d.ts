import type { ToolRegistry } from '../../ai/tools/index.js';
import type { Tool } from '../../types.js';
export interface WorkflowRestrictionBinding {
    projectId: string;
    workflowRunId: string;
    workflowId: string;
    nodeId: string;
    nodeKind: string;
    attempt: number;
    handoffId: string;
    participantId: string;
    admittedRoot?: string;
}
export interface NativeWorkflowReadPort {
    readonly opaqueNativeWorkflowReadPort: never;
}
export interface NativeWorkflowRestrictionCheckpoint {
    readonly opaqueNativeWorkflowRestrictionCheckpoint: never;
}
/** Concrete fixed HTTP reader only. This does not attest a Main instance or mint a grant. */
export declare function createNativeWorkflowReadPort(): NativeWorkflowReadPort;
export declare function closeNativeWorkflowReadPort(port: NativeWorkflowReadPort): Promise<void>;
export declare function assertNativeWorkflowReadPort(port: NativeWorkflowReadPort): void;
/** Fixed data read only; this does not issue a checkpoint or execution grant. */
export declare function readNativeWorkflowRun(port: NativeWorkflowReadPort, projectId: string, workflowRunId: string): Promise<Record<string, any>>;
export declare function createNativeWorkflowRestrictionCheckpoint(port: NativeWorkflowReadPort, input: WorkflowRestrictionBinding): Promise<{
    checkpoint: NativeWorkflowRestrictionCheckpoint;
    readonly: boolean;
    root: string;
}>;
export declare function bindNativeWorkflowRestrictionCheckpoint(registry: ToolRegistry, checkpoint: NativeWorkflowRestrictionCheckpoint): void;
export declare function assertNativeRegistryCheckpointCurrent(registry: ToolRegistry): Promise<void>;
/** A dispatch description/boolean cannot select this authority. */
export declare function isNativeWorkflowArtifactCheckpoint(checkpoint: NativeWorkflowRestrictionCheckpoint): boolean;
/**
 * Ordinary workspace confinement, not a same-UID directory-race/native writer
 * capability. No UI/editor lease or artifact-workspace scope is fabricated.
 */
export declare function createNativeWorkflowArtifactRegistry(checkpoint: NativeWorkflowRestrictionCheckpoint): Promise<{
    registry: ToolRegistry;
    tools: Tool[];
}>;
