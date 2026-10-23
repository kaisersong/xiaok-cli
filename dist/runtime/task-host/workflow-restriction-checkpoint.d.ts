import type { ToolRegistry } from '../../ai/tools/index.js';
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
export declare function createNativeWorkflowRestrictionCheckpoint(port: NativeWorkflowReadPort, input: WorkflowRestrictionBinding): Promise<{
    checkpoint: NativeWorkflowRestrictionCheckpoint;
    readonly: boolean;
    root: string;
}>;
export declare function bindNativeWorkflowRestrictionCheckpoint(registry: ToolRegistry, checkpoint: NativeWorkflowRestrictionCheckpoint): void;
export declare function assertNativeRegistryCheckpointCurrent(registry: ToolRegistry): Promise<void>;
