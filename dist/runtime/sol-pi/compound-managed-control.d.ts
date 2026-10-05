import type { Tool } from '../../types.js';
import type { DirectOperationRecord } from './compound-direct-operation.js';
export interface ManagedCompoundQueryAdapter {
    assertCurrent(): void;
}
/** Main factory only, on its actual final service query wrapper. This does not
 * classify a plugin descriptor or grant a new source, mutation, or execution. */
export declare function bindManagedCompoundQueryTool(tool: Tool, adapter: ManagedCompoundQueryAdapter): Tool;
export declare function getManagedCompoundQueryAdapter(tool: Tool): Readonly<ManagedCompoundQueryAdapter> | undefined;
export interface ManagedCompoundMessageAdapter extends ManagedCompoundQueryAdapter {
    inspectCommittedResult(input: Readonly<{
        nativeInvocationId: string;
        finalInput: Readonly<Record<string, unknown>>;
        result: string;
    }>): Readonly<NonNullable<DirectOperationRecord['metadataCommit']>>;
}
/** Actual Main send wrapper only. The inspector must read its original durable
 * service operation, not accept a serialized model claim of delivery. */
export declare function bindManagedCompoundMessageTool(tool: Tool, adapter: ManagedCompoundMessageAdapter): Tool;
export declare function getManagedCompoundMessageAdapter(tool: Tool): Readonly<ManagedCompoundMessageAdapter> | undefined;
export interface ManagedCompoundCancellationAdapter extends ManagedCompoundQueryAdapter {
    prepareCancellation(input: Readonly<{
        nativeInvocationId: string;
        finalInput: Readonly<Record<string, unknown>>;
    }>): unknown;
    runCancellation(ticket: unknown, work: () => Promise<string>): Promise<string>;
}
/** Main's exact existing-target cancellation scope, never a new-turn grant. */
export declare function bindManagedCompoundCancellationTool(tool: Tool, adapter: ManagedCompoundCancellationAdapter): Tool;
export declare function getManagedCompoundCancellationAdapter(tool: Tool): Readonly<ManagedCompoundCancellationAdapter> | undefined;
