import type { CallToolResult, Tool, Progress } from '@modelcontextprotocol/client';
import { type SerializedTaskReference, type TaskExecutionEvent } from '@modelcontextprotocol/ext-tasks/client';
import { type McpClientConnection } from './transport.js';
export interface McpTaskObserver {
    handle(reference: SerializedTaskReference): Promise<void> | void;
    event(reference: SerializedTaskReference, event: TaskExecutionEvent<unknown>): Promise<void> | void;
    unavailable?(reference: SerializedTaskReference): Promise<void> | void;
    detached?(reference: SerializedTaskReference): Promise<void> | void;
    immediate?(): Promise<void> | void;
}
/** One initiating call. Observation/reconnection never replays tools/call. */
export declare function callMcpToolWithTasks(connection: McpClientConnection, params: {
    name: string;
    arguments: Record<string, unknown>;
}, options?: {
    signal?: AbortSignal;
    timeout?: number;
    declaration?: Tool;
    observer?: McpTaskObserver;
    detachOnTask?: boolean;
    onprogress?: (progress: Progress) => void;
}): Promise<CallToolResult>;
