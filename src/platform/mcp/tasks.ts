import type { CallToolResult, McpSubscription, Tool, Progress } from '@modelcontextprotocol/client';
import { resultFromTaskOutcome, toolDeclarationFromMcpTool, type SerializedTaskReference, type TaskExecutionEvent } from '@modelcontextprotocol/ext-tasks/client';
import { toJsonValue, type JsonValue } from '@modelcontextprotocol/ext-tasks/core';
import { callMcpToolWithSignal, type McpClientConnection } from './transport.js';

export interface McpTaskObserver {
  handle(reference: SerializedTaskReference): Promise<void> | void;
  event(reference: SerializedTaskReference, event: TaskExecutionEvent<unknown>): Promise<void> | void;
  unavailable?(reference: SerializedTaskReference): Promise<void> | void;
  detached?(reference: SerializedTaskReference): Promise<void> | void;
  immediate?(): Promise<void> | void;
}

/** One initiating call. Observation/reconnection never replays tools/call. */
export async function callMcpToolWithTasks(connection: McpClientConnection, params: { name: string; arguments: Record<string, unknown> },
  options: { signal?: AbortSignal; timeout?: number; declaration?: Tool; observer?: McpTaskObserver; detachOnTask?: boolean; onprogress?: (progress: Progress) => void } = {}): Promise<CallToolResult> {
  if (!connection.tasks?.capabilities.execution) return callMcpToolWithSignal(connection.client, params, options);
  const normalized = toJsonValue(params.arguments);
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) throw new Error('invalid_mcp_tool_arguments');
  const execution = await connection.tasks.callTool(params.name, normalized as Readonly<Record<string, JsonValue>>, {
    signal: options.signal, requestTimeoutMs: options.timeout,
    ...(options.declaration ? { declaration: toolDeclarationFromMcpTool(options.declaration) } : {}),
  });
  let subscription: McpSubscription | undefined;
  try {
    if (execution.kind === 'task') {
      const reference = execution.serializeReference();
      await options.observer?.handle(reference);
      if (options.detachOnTask && options.observer?.detached) {
        // The observer already committed the handle. Transfer observation;
        // returning this receipt says accepted, never says completed.
        await execution.handoff(() => {});
        await options.observer.detached(reference);
        return { content: [{ type: 'text', text: JSON.stringify({ status: 'accepted', taskId: reference.taskId, watchInConversation: true }) }],
          structuredContent: { asyncTask: { status: 'accepted', taskId: reference.taskId } } };
      }
      if (reference.generation === 'v2') {
        try {
          if (!connection.listenTaskEvents) throw new Error('mcp_task_subscription_unsupported');
          subscription = await connection.listenTaskEvents(connection.client, [reference.taskId], { timeout: options.timeout, signal: options.signal });
          void subscription.closed.then(reason => {
            if (reason !== 'local') return options.observer?.unavailable?.(reference);
          }).catch(() => {});
        } catch { await options.observer?.unavailable?.(reference); }
      }
      const settlement = await execution.settle({ close: false, signal: options.signal, onEvent: event => options.observer?.event(reference, event) });
      return resultFromTaskOutcome(settlement.outcome) as CallToolResult;
    }
    const result = resultFromTaskOutcome((await execution.settle({ close: false, signal: options.signal })).outcome) as CallToolResult;
    await options.observer?.immediate?.();
    return result;
  } finally {
    await subscription?.close();
    await execution.detach();
  }
}
